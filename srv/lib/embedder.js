const { OpenAI } = require('openai');

let embeddingClient = null;

function getEmbeddingClient() {
  if (!embeddingClient) {
    embeddingClient = new OpenAI({
      baseURL: process.env.PROXY_BASE_URL,
      apiKey:  process.env.PROXY_API_KEY,
    });
  }
  return embeddingClient;
}

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-large';

async function embedTexts(texts, batchSize = 20) {
  const client = getEmbeddingClient();
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (text) => {
        const response = await client.embeddings.create({ model: EMBEDDING_MODEL, input: text });
        return response.data[0].embedding;
      })
    );
    allEmbeddings.push(...batchResults);
  }

  return allEmbeddings;
}

module.exports = { embedTexts };
