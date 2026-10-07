# Deployment Guide — CAP RAG with genai-proxy-secure

This guide walks through deploying the migrated CAP HANA RAG application to SAP BTP Cloud Foundry using `genai-proxy-secure` as the AI backend instead of a direct AI Core service binding.

---

## Prerequisites

- SAP BTP Cloud Foundry account with:
  - HANA Cloud instance (hdi-shared service plan available)
  - Space with sufficient quota (≥ 700 MB memory)
- Cloud Foundry CLI (`cf`) installed and logged in
- Node.js 18+ and npm installed
- MTA Build Tool (`mbt`) installed: `npm install -g mbt`
- A `genai-proxy-secure` API key with access to `gpt-4o` and `text-embedding-3-large`

---

## Step 1 — Clone or copy the project

The migrated project is under `code-migration/cap-rag-dev/` in the `genai_proxy_secure` repository. Copy it to a standalone working directory:

```bash
cp -r code-migration/cap-rag-dev ~/my-rag-app
cd ~/my-rag-app
```

---

## Step 2 — Install dependencies

```bash
npm install
```

This installs the `openai` SDK (v4) along with `@sap/cds`, `express`, `multer`, `pdf-parse`, and `csv-parse`. The original `@sap-ai-sdk/foundation-models` dependency has been removed.

---

## Step 3 — Configure the HANA database ID in mta.yaml

Open `mta.yaml` and replace the placeholder `database_id` with your HANA Cloud instance ID:

```yaml
resources:
  - name: hana-hdi-rag
    type: com.sap.xs.hdi-container
    parameters:
      service: hana
      service-plan: hdi-shared
      config:
        database_id: <YOUR_HANA_CLOUD_INSTANCE_ID>   # ← replace this
```

Find your HANA Cloud instance ID in the SAP BTP Cockpit under **Services → Instances**, or run:

```bash
cf service <your-hana-cloud-service-name> --guid
```

---

## Step 4 — Set proxy environment variables in mta.yaml

The `genai-hana-rag-srv` module reads four environment variables. Set them in the `properties` block of `mta.yaml`:

```yaml
modules:
  - name: genai-hana-rag-srv
    ...
    properties:
      PROXY_BASE_URL:  https://genai-proxy-secure.cfapps.eu10-004.hana.ondemand.com/v1
      PROXY_API_KEY:   <your-proxy-api-key>
      CHAT_MODEL:      gpt-4o
      EMBEDDING_MODEL: text-embedding-3-large
```

> **Note:** `CHAT_MODEL` and `EMBEDDING_MODEL` must match model names as configured in the proxy — check the proxy Admin UI under **Models** to confirm.

---

## Step 5 — Update the frontend API URL

The UI app has a hardcoded backend URL in `app/webapp/config.js`. Update it to your CF app name:

```js
window.RAG_CONFIG = {
    apiBaseUrl: "https://<your-cf-org-or-prefix>-genai-hana-rag-srv.cfapps.<region>.hana.ondemand.com"
};
```

You may not know the exact URL until after the first deploy. Run `cf app genai-hana-rag-srv` after deploying to get it, then redeploy the static app module only.

---

## Step 6 — Build the MTA archive

```bash
mbt build
```

This runs `npm ci` and `npx cds build --production` internally, then packages everything into a `.mtar` file under `mta_archives/`.

---

## Step 7 — Deploy to Cloud Foundry

```bash
cf deploy mta_archives/genai-hana-rag_1.0.0.mtar
```

The deployment creates three CF apps:
- `genai-hana-rag-srv` — Node.js CAP backend (512 MB)
- `genai-hana-rag-db-deployer` — one-off HANA schema deployer (stops after deploy)
- `genai-hana-rag-app` — static UI (64 MB)

And one HDI container service: `hana-hdi-rag`

Wait for all modules to reach state `started`. The db-deployer will stop automatically — that is expected.

---

## Step 8 — Verify the deployment

Check all apps are running:

```bash
cf apps
```

Test the backend health:

```bash
cf app genai-hana-rag-srv
curl https://<srv-url>/
```

Check logs if anything failed:

```bash
cf logs genai-hana-rag-srv --recent
```

---

## Step 9 — Update the frontend URL (if needed)

Once the `genai-hana-rag-srv` URL is known, update `app/webapp/config.js` with the correct value, rebuild, and redeploy only the app module:

```bash
# Redeploy only the static app (faster than full mbt build)
cf push genai-hana-rag-app -p app/webapp --no-start
cf start genai-hana-rag-app
```

---

## Step 10 — Test end-to-end

1. Open the UI app URL in a browser (`cf app genai-hana-rag-app` shows the route)
2. Upload a PDF, TXT, or CSV document (max 10 MB)
3. Wait for the document status to change to **Ready** — this triggers chunking and embedding via the proxy's `text-embedding-3-large` endpoint
4. Start a chat session and ask a question about the document
5. Confirm the answer is returned — this calls the proxy's `gpt-4o` endpoint

Check the **proxy Admin UI → Audit Log** to confirm both embedding and chat calls are being tracked.

---

## Local development (optional)

For local testing with SQLite (no HANA needed):

```bash
cp .env.example .env
# Fill in PROXY_BASE_URL and PROXY_API_KEY in .env
npm run watch    # cds watch uses SQLite automatically
```

For local testing against HANA Cloud:

1. Create a `default-env.json` with your HDI container credentials (see [CAP hybrid testing docs](https://cap.cloud.sap/docs/advanced/hybrid-testing))
2. `cds watch --profile hybrid`

---

## Environment variable reference

| Variable | Required | Description |
|---|---|---|
| `PROXY_BASE_URL` | Yes | Proxy base URL, must end with `/v1` |
| `PROXY_API_KEY` | Yes | API key issued by the proxy admin |
| `CHAT_MODEL` | No | Chat model name (default: `gpt-4o`) |
| `EMBEDDING_MODEL` | No | Embedding model name (default: `text-embedding-3-large`) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Document stuck in `PROCESSING` | Embedding call failing | Check `cf logs genai-hana-rag-srv --recent` for proxy errors; verify `PROXY_BASE_URL` ends with `/v1` |
| `401 Unauthorized` in logs | Wrong API key | Re-check `PROXY_API_KEY` in `mta.yaml` and redeploy |
| `404 Not Found` for model | Model not in proxy allowlist | Check proxy Admin UI → Models, ensure `text-embedding-3-large` and `gpt-4o` are allowed for the key's tenant |
| UI shows blank / CORS error | `config.js` has wrong `apiBaseUrl` | Update `app/webapp/config.js` with the correct srv URL and redeploy the app module |
| HDI deploy fails | Wrong `database_id` in `mta.yaml` | Replace with your actual HANA Cloud instance GUID |
