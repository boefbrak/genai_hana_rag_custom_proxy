# CAP RAG — Proxy Migration

This is a copy of [genai_hana_rag_pub](https://github.com/boefbrak/genai_hana_rag_pub) migrated to use the `genai-proxy-secure` OpenAI-compatible proxy instead of the SAP AI SDK's direct AI Core binding.

## What changed

| File | Before | After |
|---|---|---|
| `srv/lib/embedder.js` | `AzureOpenAiEmbeddingClient` from `@sap-ai-sdk/foundation-models` | `openai` SDK with `baseURL` + `apiKey` from env vars |
| `srv/lib/rag-engine.js` | `AzureOpenAiChatClient` from `@sap-ai-sdk/foundation-models` | `openai` SDK `chat.completions.create` |
| `package.json` | `@sap-ai-sdk/foundation-models: ^2` | `openai: ^4` |
| `mta.yaml` | `requires: aicore` + `aicore` resource (existing CF service) | Removed; proxy config injected as env vars |

## Required environment variables

| Variable | Description | Default |
|---|---|---|
| `PROXY_BASE_URL` | Proxy base URL (must end with `/v1`) | — (required) |
| `PROXY_API_KEY` | Proxy API key | — (required) |
| `CHAT_MODEL` | Chat model name as known by the proxy | `gpt-4o` |
| `EMBEDDING_MODEL` | Embedding model name as known by the proxy | `text-embedding-3-large` |

## Local development

1. Copy `.env.example` to `.env` and fill in your proxy URL and API key
2. Add a `default-env.json` for your HANA Cloud credentials (see CDS docs)
3. `npm install`
4. `cds watch` (SQLite) or `cds watch --profile hybrid` (HANA)

## CF deployment

Set the env vars in `mta.yaml` `properties` block (already wired) or via `cf set-env` after deploy. The `aicore` service binding is no longer needed.
