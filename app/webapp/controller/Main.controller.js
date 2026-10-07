sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "../model/formatter"
], function (Controller, JSONModel, MessageToast, MessageBox, formatter) {
    "use strict";

    return Controller.extend("genai.rag.app.controller.Main", {
        formatter: formatter,

        onInit: function () {
            this._apiBase = (window.RAG_CONFIG && window.RAG_CONFIG.apiBaseUrl) ||
                "https://trial---shared-sap-core-ai-chatbot-eu10-chatbot-dev-gen6bd87a39.cfapps.eu10-004.hana.ondemand.com";

            // Initialize models
            this._oDocumentsModel = new JSONModel({ value: [] });
            this.getView().setModel(this._oDocumentsModel, "documents");

            this._oMessagesModel = new JSONModel([]);
            this.getView().setModel(this._oMessagesModel, "messages");

            this._oDeletePreviewModel = new JSONModel({});
            this.getView().setModel(this._oDeletePreviewModel, "deletePreview");

            // App state
            var oAppModel = this.getOwnerComponent().getModel("app");
            oAppModel.setProperty("/selectedDocumentId", null);
            oAppModel.setProperty("/selectedDocumentName", null);
            oAppModel.setProperty("/currentSessionId", null);
            oAppModel.setProperty("/sortDescending", true); // Newest first by default

            this._loadDocuments();
        },

        // ==================== Document Methods ====================

        _loadDocuments: function () {
            var that = this;
            fetch(this._apiBase + "/api/documents/Documents")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    that._sortAndSetDocuments(data);
                })
                .catch(function (err) {
                    console.error("Failed to load documents:", err);
                });
        },

        _sortAndSetDocuments: function (data) {
            var oAppModel = this.getOwnerComponent().getModel("app");
            var bDescending = oAppModel.getProperty("/sortDescending");
            var aDocuments = data.value || data || [];

            // Sort by createdAt
            aDocuments.sort(function (a, b) {
                var dateA = new Date(a.createdAt || 0);
                var dateB = new Date(b.createdAt || 0);
                return bDescending ? (dateB - dateA) : (dateA - dateB);
            });

            this._oDocumentsModel.setData({ value: aDocuments });
        },

        onToggleSort: function () {
            var oAppModel = this.getOwnerComponent().getModel("app");
            var bDescending = oAppModel.getProperty("/sortDescending");
            oAppModel.setProperty("/sortDescending", !bDescending);

            // Re-sort existing data
            var data = this._oDocumentsModel.getData();
            this._sortAndSetDocuments(data);
        },

        onDocumentSelect: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var oContext = oItem.getBindingContext("documents");
            var sDocId = oContext.getProperty("ID");
            var sDocName = oContext.getProperty("fileName");
            var sStatus = oContext.getProperty("status");

            // Block PROCESSING and ERROR documents
            if (sStatus === "PROCESSING") {
                MessageToast.show("Document is still processing. Please wait.");
                oEvent.getSource().removeSelections();
                return;
            }
            if (sStatus === "ERROR") {
                MessageToast.show("Document processing failed. Please delete and re-upload.");
                oEvent.getSource().removeSelections();
                return;
            }

            var oAppModel = this.getOwnerComponent().getModel("app");
            oAppModel.setProperty("/selectedDocumentId", sDocId);
            oAppModel.setProperty("/selectedDocumentName", sDocName);
            oAppModel.setProperty("/currentSessionId", null);

            this._oMessagesModel.setData([]);

            // Auto-select most recent session or create one
            this._autoSelectOrCreateSession(sDocId);
        },

        onCloseChat: function () {
            var oAppModel = this.getOwnerComponent().getModel("app");
            oAppModel.setProperty("/selectedDocumentId", null);
            oAppModel.setProperty("/selectedDocumentName", null);
            oAppModel.setProperty("/currentSessionId", null);

            this._oMessagesModel.setData([]);

            // Clear document list selection
            var oList = this.byId("documentList");
            if (oList) {
                oList.removeSelections();
            }
        },

        _autoSelectOrCreateSession: function (documentId) {
            var that = this;
            var oAppModel = this.getOwnerComponent().getModel("app");

            // First, try to get existing sessions
            fetch(this._apiBase + "/api/chat/getDocumentSessions(documentId='" + documentId + "')")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var aSessions = data.value || data || [];

                    if (aSessions.length > 0) {
                        // Auto-select the most recent session (first in list, sorted by createdAt desc)
                        var sSessionId = aSessions[0].ID;
                        oAppModel.setProperty("/currentSessionId", sSessionId);
                        that._loadMessages(sSessionId);
                    } else {
                        // No sessions exist, create one
                        that._createSessionForDocument(documentId);
                    }
                })
                .catch(function (err) {
                    console.error("Failed to load sessions:", err);
                    // Fallback: try to create a session
                    that._createSessionForDocument(documentId);
                });
        },

        _createSessionForDocument: function (documentId) {
            var that = this;
            var oAppModel = this.getOwnerComponent().getModel("app");
            var sTitle = "Chat " + new Date().toLocaleString();

            fetch(this._apiBase + "/api/chat/createSession", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: documentId, title: sTitle })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                oAppModel.setProperty("/currentSessionId", data.ID);
                that._oMessagesModel.setData([]);
            })
            .catch(function (err) {
                console.error("Failed to create session:", err);
                MessageBox.error("Failed to start chat session");
            });
        },

        onDeleteDocument: function () {
            var oAppModel = this.getOwnerComponent().getModel("app");
            var sDocumentId = oAppModel.getProperty("/selectedDocumentId");
            var sDocumentName = oAppModel.getProperty("/selectedDocumentName");

            if (!sDocumentId) return;

            var that = this;

            // Fetch delete preview
            fetch(this._apiBase + "/api/documents/getDeletePreview(documentId='" + sDocumentId + "')")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    that._oDeletePreviewModel.setData({
                        documentId: sDocumentId,
                        documentName: sDocumentName,
                        sessionCount: data.sessionCount,
                        messageCount: data.messageCount,
                        chunkCount: data.chunkCount
                    });
                    that._showDeleteConfirmDialog();
                })
                .catch(function (err) {
                    console.error("Failed to get delete preview:", err);
                    MessageBox.error("Failed to prepare deletion");
                });
        },

        _showDeleteConfirmDialog: function () {
            var oData = this._oDeletePreviewModel.getData();
            var sMessage = "Are you sure you want to delete \"" + oData.documentName + "\"?\n\n";
            sMessage += "This will also delete:\n";
            sMessage += "- " + oData.chunkCount + " text chunk(s)\n";
            sMessage += "- " + oData.sessionCount + " chat session(s)\n";
            sMessage += "- " + oData.messageCount + " message(s)";

            var that = this;
            MessageBox.confirm(sMessage, {
                title: "Delete Document",
                onClose: function (oAction) {
                    if (oAction === MessageBox.Action.OK) {
                        that._executeDelete();
                    }
                }
            });
        },

        _executeDelete: function () {
            var that = this;
            var sDocumentId = this._oDeletePreviewModel.getProperty("/documentId");

            fetch(this._apiBase + "/api/documents/deleteDocument", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: sDocumentId })
            })
            .then(function (r) { return r.json(); })
            .then(function () {
                MessageToast.show("Document deleted successfully");

                // Reset selection
                var oAppModel = that.getOwnerComponent().getModel("app");
                oAppModel.setProperty("/selectedDocumentId", null);
                oAppModel.setProperty("/selectedDocumentName", null);
                oAppModel.setProperty("/currentSessionId", null);
                that._oMessagesModel.setData([]);

                // Clear list selection
                var oList = that.byId("documentList");
                if (oList) {
                    oList.removeSelections();
                }

                that._loadDocuments();
            })
            .catch(function (err) {
                console.error("Failed to delete document:", err);
                MessageBox.error("Failed to delete document");
            });
        },

        // ==================== Upload Methods ====================

        onOpenUploadDialog: function () {
            if (!this._oUploadDialog) {
                this._oUploadDialog = sap.ui.xmlfragment(
                    this.getView().getId(),
                    "genai.rag.app.fragment.UploadDialog",
                    this
                );
                this.getView().addDependent(this._oUploadDialog);
            }
            this._oUploadDialog.open();
        },

        onUploadConfirm: function () {
            var oFileUploader = sap.ui.core.Fragment.byId(this.getView().getId(), "dialogFileUploader");
            var oFileInput = oFileUploader.oFileUpload;
            var oFile = oFileInput && oFileInput.files && oFileInput.files[0];

            if (!oFile) {
                MessageToast.show("Please select a file first");
                return;
            }

            var oFormData = new FormData();
            oFormData.append("file", oFile);

            var that = this;
            this._oUploadDialog.setBusy(true);

            fetch(this._apiBase + "/api/documents/upload", {
                method: "POST",
                body: oFormData
            })
            .then(function (response) {
                if (!response.ok) {
                    return response.json().then(function (err) {
                        throw new Error(err.error || "Upload failed");
                    });
                }
                return response.json();
            })
            .then(function (data) {
                MessageToast.show("File uploaded. Processing started...");
                oFileUploader.clear();
                that._oUploadDialog.close();
                that._loadDocuments();
                that._pollStatus(data.ID);
            })
            .catch(function (error) {
                MessageBox.error("Upload failed: " + error.message);
            })
            .finally(function () {
                that._oUploadDialog.setBusy(false);
            });
        },

        onUploadCancel: function () {
            this._oUploadDialog.close();
        },

        onTypeMismatch: function () {
            MessageBox.error("Only PDF, TXT, and CSV files are supported.");
        },

        onFileSizeExceed: function () {
            MessageBox.error("File size must not exceed 10 MB.");
        },

        _pollStatus: function (docId) {
            var that = this;
            var apiBase = this._apiBase;
            var interval = setInterval(function () {
                fetch(apiBase + "/api/documents/getStatus(documentId='" + docId + "')")
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data.status === "READY" || data.status === "ERROR") {
                            clearInterval(interval);
                            that._loadDocuments();
                            if (data.status === "READY") {
                                MessageToast.show("Document processed: " + data.chunkCount + " chunks created.");
                            } else {
                                MessageBox.error("Processing failed: " + data.errorMsg);
                            }
                        }
                    })
                    .catch(function () {
                        clearInterval(interval);
                    });
            }, 3000);
        },

        // ==================== Session Methods ====================

        _loadMessages: function (sessionId) {
            var that = this;
            fetch(this._apiBase + "/api/chat/getSessionMessages(sessionId='" + sessionId + "')")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    that._oMessagesModel.setData(data.value || data || []);
                    that._scrollToBottom();
                })
                .catch(function (err) {
                    console.error("Failed to load messages:", err);
                });
        },

        // ==================== Chat Methods ====================

        onSendMessage: function () {
            var oInput = this.byId("messageInput");
            var sMessage = oInput.getValue().trim();
            if (!sMessage) return;

            var oAppModel = this.getOwnerComponent().getModel("app");
            var sSessionId = oAppModel.getProperty("/currentSessionId");

            if (!sSessionId) {
                MessageToast.show("Please create or select a chat session first.");
                return;
            }

            // Add user message to UI
            var aMessages = this._oMessagesModel.getData() || [];
            aMessages.push({ role: "user", content: sMessage });
            this._oMessagesModel.setData(aMessages.slice());
            oInput.setValue("");
            this._scrollToBottom();

            // Show typing indicator
            aMessages.push({ role: "assistant", content: "Thinking..." });
            this._oMessagesModel.setData(aMessages.slice());

            var that = this;
            fetch(this._apiBase + "/api/chat/sendMessage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: sSessionId, message: sMessage })
            })
            .then(function (r) {
                if (!r.ok) throw new Error("Request failed");
                return r.json();
            })
            .then(function (data) {
                var msgs = that._oMessagesModel.getData();
                msgs.pop(); // Remove "Thinking..."
                msgs.push({ role: "assistant", content: data.reply, sources: data.sources });
                that._oMessagesModel.setData(msgs.slice());
                that._scrollToBottom();
            })
            .catch(function (error) {
                var msgs = that._oMessagesModel.getData();
                msgs.pop();
                msgs.push({ role: "assistant", content: "Error: " + error.message });
                that._oMessagesModel.setData(msgs.slice());
            });
        },

        _scrollToBottom: function () {
            var oScroll = this.byId("chatScroll");
            if (oScroll) {
                setTimeout(function () {
                    oScroll.scrollTo(0, 99999);
                }, 100);
            }
        }
    });
});
