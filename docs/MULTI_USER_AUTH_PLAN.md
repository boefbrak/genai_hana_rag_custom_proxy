# Multi-User Authentication Implementation Plan

## Overview

Enable user authentication via SAP IDP "academy-platform" with per-user document isolation.

**Requirements:**
- Users must authenticate using SAP IDP called "academy-platform"
- Users pre-exist in the academy-platform IDP
- Application needs to support multiple concurrent users

---

## Current State Analysis

| Component | Status |
|-----------|--------|
| Authentication | `"kind": "dummy"` (no auth) |
| User isolation | None (all documents shared) |
| App Router | Not present (static files only) |
| XSUAA | Not configured |
| xs-security.json | Does not exist |

---

## Implementation Phases

### Phase 1: XSUAA Service Instance Configuration

#### 1.1 Create xs-security.json

**File to create: `xs-security.json`**

```json
{
  "xsappname": "genai-hana-rag",
  "tenant-mode": "dedicated",
  "description": "Security descriptor for RAG Chat Application",
  "scopes": [
    {
      "name": "$XSAPPNAME.User",
      "description": "Basic user access to the RAG application"
    },
    {
      "name": "$XSAPPNAME.Admin",
      "description": "Administrator access for managing all documents"
    }
  ],
  "attributes": [],
  "role-templates": [
    {
      "name": "RAGUser",
      "description": "Standard user with access to own documents",
      "scope-references": [
        "$XSAPPNAME.User"
      ]
    },
    {
      "name": "RAGAdmin",
      "description": "Administrator with access to all documents",
      "scope-references": [
        "$XSAPPNAME.User",
        "$XSAPPNAME.Admin"
      ]
    }
  ],
  "role-collections": [
    {
      "name": "RAG_User",
      "description": "Standard RAG User",
      "role-template-references": [
        "$XSAPPNAME.RAGUser"
      ]
    },
    {
      "name": "RAG_Admin",
      "description": "RAG Administrator",
      "role-template-references": [
        "$XSAPPNAME.RAGAdmin"
      ]
    }
  ],
  "oauth2-configuration": {
    "redirect-uris": [
      "https://*.cfapps.eu10-004.hana.ondemand.com/**"
    ]
  }
}
```

#### 1.2 IDP Trust Configuration

The SAP BTP subaccount needs to establish trust with the "academy-platform" IDP:

1. Navigate to SAP BTP Cockpit > Subaccount > Security > Trust Configuration
2. Add "academy-platform" as a trusted identity provider
3. Configure attribute mapping to ensure user email/name are passed through
4. Ensure users in academy-platform have the necessary role collections assigned

---

### Phase 2: Data Model Changes for User Isolation

**Decision: Per-User Document Isolation**

Each user sees only their own documents. The `managed` aspect already provides `createdBy`/`modifiedBy` fields.

**No schema changes needed** - the `db/schema.cds` already uses the `managed` aspect which automatically populates `createdBy`. Authorization will be enforced at the service layer.

---

### Phase 3: Service Authorization Annotations

#### 3.1 Modify srv/document-service.cds

```cds
using { genai.rag as db } from '../db/schema';

@requires: 'authenticated-user'
service DocumentService @(path: '/api/documents') {

  @(restrict: [
    { grant: ['READ', 'WRITE', 'DELETE'], to: 'User', where: 'createdBy = $user' },
    { grant: '*', to: 'Admin' }
  ])
  entity Documents as projection on db.Documents excluding { chunks };

  @(restrict: [
    { grant: 'WRITE', to: 'User' },
    { grant: '*', to: 'Admin' }
  ])
  action deleteDocument(documentId: UUID) returns Boolean;

  function getStatus(documentId: UUID) returns {
    status: String;
    chunkCount: Integer;
    errorMsg: String;
  };

  function getDeletePreview(documentId: UUID) returns {
    sessionCount: Integer;
    messageCount: Integer;
    chunkCount: Integer;
  };
}
```

#### 3.2 Modify srv/chat-service.cds

```cds
using { genai.rag as db } from '../db/schema';

@requires: 'authenticated-user'
service ChatService @(path: '/api/chat') {

  @(restrict: [
    { grant: ['READ', 'WRITE', 'DELETE'], to: 'User', where: 'createdBy = $user' },
    { grant: '*', to: 'Admin' }
  ])
  entity ChatSessions as projection on db.ChatSessions excluding { messages };

  @(restrict: [
    { grant: 'READ', to: 'User' },
    { grant: '*', to: 'Admin' }
  ])
  entity ChatMessages as projection on db.ChatMessages;

  action sendMessage(sessionId: UUID, message: String) returns {
    reply: String;
    messageId: UUID;
    sources: array of {
      chunkId: UUID;
      documentName: String;
      content: String;
      similarity: Double;
    };
  };

  action createSession(documentId: UUID, title: String) returns ChatSessions;
  action updateSession(sessionId: UUID, documentId: UUID, title: String) returns ChatSessions;

  function getSessionMessages(sessionId: UUID) returns array of ChatMessages;
  function getDocumentSessions(documentId: UUID) returns array of ChatSessions;
}
```

#### 3.3 Modify srv/document-service.js

Add authorization checks to custom actions:

```javascript
const cds = require('@sap/cds');

module.exports = class DocumentService extends cds.ApplicationService {
  async init() {
    const { Documents, DocumentChunks, ChatSessions, ChatMessages } = cds.entities('genai.rag');

    // Add authorization check for deleteDocument
    this.before('deleteDocument', async (req) => {
      const { documentId } = req.data;
      const user = req.user.id;
      const isAdmin = req.user.is('Admin');

      if (!isAdmin) {
        const doc = await SELECT.one.from(Documents)
          .where({ ID: documentId, createdBy: user });
        if (!doc) {
          req.reject(403, 'Not authorized to delete this document');
        }
      }
    });

    // Add authorization check for getStatus
    this.before('getStatus', async (req) => {
      const { documentId } = req.data;
      const user = req.user.id;
      const isAdmin = req.user.is('Admin');

      if (!isAdmin) {
        const doc = await SELECT.one.from(Documents)
          .where({ ID: documentId, createdBy: user });
        if (!doc) {
          req.reject(403, 'Not authorized to access this document');
        }
      }
    });

    // ... existing handlers remain unchanged
    await super.init();
  }
};
```

#### 3.4 Modify srv/server.js

Add user context to upload endpoint:

```javascript
const cds = require('@sap/cds');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

cds.on('bootstrap', (app) => {
  // CORS headers can be removed - App Router will handle this

  app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
    try {
      // Get user from request (populated by CAP/XSUAA)
      const user = req.user?.id || req.headers['x-user-id'];

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { file } = req;
      if (!file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const fileExtension = file.originalname.split('.').pop().toLowerCase();
      const allowedExtensions = ['pdf', 'txt', 'csv'];

      if (!allowedExtensions.includes(fileExtension)) {
        return res.status(400).json({ error: 'Unsupported file type. Use PDF, TXT, or CSV.' });
      }

      const { processUpload } = require('./lib/upload-processor');
      const result = await processUpload({
        fileName: file.originalname,
        fileType: fileExtension,
        fileSize: file.size,
        buffer: file.buffer,
        createdBy: user  // Pass user to upload processor
      });

      res.status(201).json(result);
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

module.exports = cds.server;
```

#### 3.5 Modify srv/lib/upload-processor.js

Store user when creating document:

```javascript
async function processUpload({ fileName, fileType, fileSize, buffer, createdBy }) {
  const { Documents } = cds.entities('genai.rag');
  const docId = cds.utils.uuid();

  // Create document record with PROCESSING status and user
  await cds.run(INSERT.into(Documents).entries({
    ID: docId,
    fileName,
    fileType,
    fileSize,
    status: 'PROCESSING',
    createdBy: createdBy,  // Store the user who uploaded
    createdAt: new Date()
  }));

  // ... rest of existing implementation unchanged
}
```

---

### Phase 4: App Router Setup

#### 4.1 Create approuter/package.json

```json
{
  "name": "genai-hana-rag-approuter",
  "version": "1.0.0",
  "dependencies": {
    "@sap/approuter": "^20.0.0"
  },
  "scripts": {
    "start": "node node_modules/@sap/approuter/approuter.js"
  }
}
```

#### 4.2 Create approuter/xs-app.json

```json
{
  "authenticationMethod": "route",
  "sessionTimeout": 30,
  "routes": [
    {
      "source": "^/api/(.*)$",
      "target": "/api/$1",
      "destination": "srv-api",
      "authenticationType": "xsuaa",
      "csrfProtection": true
    },
    {
      "source": "^/user-api/currentUser$",
      "target": "/currentUser",
      "service": "sap-approuter-userapi"
    },
    {
      "source": "^(.*)$",
      "target": "$1",
      "destination": "ui",
      "authenticationType": "xsuaa"
    }
  ]
}
```

---

### Phase 5: MTA.yaml Configuration Updates

```yaml
_schema-version: "3.1"
ID: genai-hana-rag
description: RAG Application with SAP CAP, HANA Vector Engine, and Generative AI Hub
version: 1.0.0

parameters:
  enable-parallel-deployments: true

build-parameters:
  before-all:
    - builder: custom
      commands:
        - npm ci
        - npx cds build --production

modules:
  # CAP Server Module
  - name: genai-hana-rag-srv
    type: nodejs
    path: gen/srv
    parameters:
      buildpack: nodejs_buildpack
      memory: 512M
      disk-quota: 1024M
    requires:
      - name: genai-hana-rag-db
      - name: genai-hana-rag-aicore
      - name: genai-hana-rag-auth    # NEW: XSUAA binding
    provides:
      - name: srv-api
        properties:
          srv-url: ${default-url}
    build-parameters:
      builder: npm
      ignore: ["node_modules/"]

  # DB Deployer Module
  - name: genai-hana-rag-db-deployer
    type: hdb
    path: gen/db
    parameters:
      buildpack: nodejs_buildpack
    requires:
      - name: genai-hana-rag-db
    build-parameters:
      ignore: ["node_modules/"]

  # NEW: App Router Module (replaces static file app)
  - name: genai-hana-rag-approuter
    type: approuter.nodejs
    path: approuter
    parameters:
      keep-existing-routes: true
      disk-quota: 256M
      memory: 256M
    requires:
      - name: genai-hana-rag-auth
      - name: srv-api
        group: destinations
        properties:
          name: srv-api
          url: ~{srv-url}
          forwardAuthToken: true
      - name: genai-hana-rag-ui
        group: destinations
        properties:
          name: ui
          url: ~{ui-url}
          forwardAuthToken: true
    build-parameters:
      builder: npm
      ignore: ["node_modules/"]

  # UI Module (served via App Router)
  - name: genai-hana-rag-ui
    type: html5
    path: app/webapp
    parameters:
      buildpack: staticfile_buildpack
      memory: 64M
    provides:
      - name: genai-hana-rag-ui
        properties:
          ui-url: ${default-url}
    build-parameters:
      builder: custom
      commands: []

resources:
  # HANA Database
  - name: genai-hana-rag-db
    type: com.sap.xs.hdi-container
    parameters:
      service: hana
      service-plan: hdi-shared
      config:
        database_id: 1159f744-6592-4c54-a96e-a6a924da3fbb

  # AI Core Service
  - name: genai-hana-rag-aicore
    type: org.cloudfoundry.existing-service
    parameters:
      service-name: ch-sbb-aicore

  # NEW: XSUAA Service Instance
  - name: genai-hana-rag-auth
    type: org.cloudfoundry.managed-service
    parameters:
      service: xsuaa
      service-plan: application
      path: ./xs-security.json
      config:
        xsappname: genai-hana-rag-${org}-${space}
        tenant-mode: dedicated
```

---

### Phase 6: Package.json Updates

```json
{
  "name": "genai-hana-rag",
  "version": "1.0.0",
  "description": "RAG Application with SAP CAP, HANA Vector Engine, and Generative AI Hub",
  "private": true,
  "dependencies": {
    "@sap/cds": "^8",
    "@cap-js/hana": "^1",
    "@sap-ai-sdk/foundation-models": "^2",
    "@sap/xssec": "^4",
    "express": "^4",
    "multer": "1.4.4-lts.1",
    "pdf-parse": "^1",
    "csv-parse": "^5"
  },
  "devDependencies": {
    "@sap/cds-dk": "^8",
    "@cap-js/sqlite": "^1"
  },
  "scripts": {
    "start": "cds-serve",
    "build": "cds build --production",
    "watch": "cds watch"
  },
  "cds": {
    "requires": {
      "db": {
        "kind": "sql",
        "[production]": {
          "kind": "hana-cloud",
          "deploy-format": "hdbtable"
        },
        "[hybrid]": {
          "kind": "hana-cloud",
          "deploy-format": "hdbtable"
        }
      },
      "auth": {
        "[production]": {
          "kind": "xsuaa"
        },
        "[hybrid]": {
          "kind": "xsuaa"
        }
      }
    },
    "hana": {
      "deploy-format": "hdbtable"
    }
  }
}
```

---

### Phase 7: UI Changes for Authentication

#### 7.1 Modify app/webapp/config.js

```javascript
window.RAG_CONFIG = {
    // API base URL - use relative paths as App Router proxies requests
    apiBaseUrl: ""
};
```

#### 7.2 Modify app/webapp/Component.js

```javascript
sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
    "use strict";

    return UIComponent.extend("genai.rag.app.Component", {
        metadata: {
            manifest: "json"
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            this.getRouter().initialize();

            var oAppModel = new JSONModel({
                busy: false,
                currentSessionId: null,
                user: null
            });
            this.setModel(oAppModel, "app");

            // Load user info
            this._loadUserInfo();
        },

        _loadUserInfo: function () {
            var that = this;
            fetch("/user-api/currentUser")
                .then(function (response) {
                    return response.json();
                })
                .then(function (userData) {
                    var oAppModel = that.getModel("app");
                    oAppModel.setProperty("/user", {
                        name: userData.firstname + " " + userData.lastname,
                        email: userData.email,
                        id: userData.name
                    });
                })
                .catch(function (error) {
                    console.error("Failed to load user info:", error);
                });
        },

        logout: function () {
            window.location.href = "/logout";
        }
    });
});
```

#### 7.3 Modify app/webapp/view/App.view.xml

```xml
<mvc:View
    controllerName="genai.rag.app.controller.App"
    xmlns:mvc="sap.ui.core.mvc"
    xmlns="sap.m">
    <Shell>
        <App id="appControl">
            <customHeader>
                <Bar>
                    <contentLeft>
                        <Title text="RAG Chat Assistant"/>
                    </contentLeft>
                    <contentRight>
                        <Avatar
                            src="sap-icon://person-placeholder"
                            displaySize="XS"
                            press=".onUserMenuPress"
                            class="sapUiSmallMarginEnd"/>
                        <Text text="{app>/user/name}"/>
                        <Button
                            icon="sap-icon://log"
                            tooltip="Logout"
                            press=".onLogout"
                            type="Transparent"
                            class="sapUiSmallMarginBegin"/>
                    </contentRight>
                </Bar>
            </customHeader>
        </App>
    </Shell>
</mvc:View>
```

#### 7.4 Modify app/webapp/controller/App.controller.js

```javascript
sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    return Controller.extend("genai.rag.app.controller.App", {
        onLogout: function () {
            this.getOwnerComponent().logout();
        },

        onUserMenuPress: function (oEvent) {
            var oAppModel = this.getOwnerComponent().getModel("app");
            var oUser = oAppModel.getProperty("/user");

            if (!this._oUserPopover) {
                this._oUserPopover = new sap.m.Popover({
                    title: "User Info",
                    placement: "Bottom",
                    content: [
                        new sap.m.VBox({
                            items: [
                                new sap.m.Label({ text: "Name:" }),
                                new sap.m.Text({ text: oUser ? oUser.name : "" }),
                                new sap.m.Label({ text: "Email:", class: "sapUiSmallMarginTop" }),
                                new sap.m.Text({ text: oUser ? oUser.email : "" })
                            ]
                        }).addStyleClass("sapUiSmallMargin")
                    ]
                });
            }

            this._oUserPopover.openBy(oEvent.getSource());
        }
    });
});
```

#### 7.5 Modify Main.controller.js

Change the `_apiBase` initialization to use relative URL:

```javascript
onInit: function () {
    // Use relative URL - App Router handles routing
    this._apiBase = (window.RAG_CONFIG && window.RAG_CONFIG.apiBaseUrl) || "";

    // ... rest of existing code
}
```

---

### Phase 8: BTP Configuration (Manual Steps)

#### 8.1 Establish Trust with academy-platform IDP

1. Navigate to SAP BTP Cockpit
2. Go to your Subaccount > Security > Trust Configuration
3. Click "New Trust Configuration"
4. Configure:
   - Name: `academy-platform`
   - Origin Key: (provided by academy-platform IDP)
   - Metadata URL or upload metadata XML from academy-platform

#### 8.2 Assign Role Collections to Users

After deployment, for each user in academy-platform:

1. Navigate to SAP BTP Cockpit > Subaccount > Security > Role Collections
2. Assign users to either:
   - `RAG_User` - For standard users (access to own documents)
   - `RAG_Admin` - For administrators (access to all documents)

---

### Phase 9: Deployment Steps

```bash
# 1. Build the MTA archive
mbt build

# 2. Deploy to Cloud Foundry
cf deploy mta_archives/genai-hana-rag_1.0.0.mtar

# 3. Verify deployment
cf apps
cf services

# 4. Check XSUAA service
cf service genai-hana-rag-auth
```

---

## Files Summary

| Action | File |
|--------|------|
| **Create** | `xs-security.json` |
| **Create** | `approuter/package.json` |
| **Create** | `approuter/xs-app.json` |
| **Modify** | `mta.yaml` |
| **Modify** | `package.json` |
| **Modify** | `srv/document-service.cds` |
| **Modify** | `srv/chat-service.cds` |
| **Modify** | `srv/document-service.js` |
| **Modify** | `srv/server.js` |
| **Modify** | `srv/lib/upload-processor.js` |
| **Modify** | `app/webapp/config.js` |
| **Modify** | `app/webapp/Component.js` |
| **Modify** | `app/webapp/view/App.view.xml` |
| **Modify** | `app/webapp/controller/App.controller.js` |
| **Modify** | `app/webapp/controller/Main.controller.js` |

---

## Key Decisions

1. **User isolation:** Per-user (each user sees only their documents)
2. **Admin role:** Admins can see all documents
3. **Authentication flow:** App Router handles OAuth2 flow with XSUAA

---

## Prerequisites Before Implementation

1. Obtain academy-platform IDP metadata/origin key
2. Verify BTP subaccount has XSUAA service available
3. Confirm user attributes mapping from academy-platform (email, name, etc.)
