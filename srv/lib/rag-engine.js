const { OpenAI } = require('openai');

let chatClient = null;

function getChatClient() {
  if (!chatClient) {
    chatClient = new OpenAI({
      baseURL: process.env.PROXY_BASE_URL,
      apiKey:  process.env.PROXY_API_KEY,
    });
  }
  return chatClient;
}

const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o';

const SYSTEM_PROMPT = `You are a helpful AI assistant that answers questions based on the provided document context.

Rules:
1. Answer ONLY based on the provided context. If the context doesn't contain enough information, say so clearly.
2. Cite which document(s) your answer is based on when possible.
3. Be concise but thorough.
4. If the user's question is a greeting or general conversation, respond naturally.
5. Maintain a professional and helpful tone.`;

async function generateRAGResponse({ query, chunks, history }) {
  const client = getChatClient();

  const contextParts = chunks.map((chunk, idx) => {
    const similarity = (chunk.similarity * 100).toFixed(1);
    // Handle NCLOB content - may be Buffer or string
    let contentStr = chunk.content;
    if (Buffer.isBuffer(contentStr)) {
      contentStr = contentStr.toString('utf8');
    } else if (typeof contentStr !== 'string') {
      contentStr = String(contentStr || '');
    }
    return `[Source ${idx + 1}: "${chunk.documentName}", relevance: ${similarity}%]\n${contentStr}`;
  });

  const contextBlock = contextParts.length > 0
    ? `\n\n--- DOCUMENT CONTEXT ---\n${contextParts.join('\n\n---\n\n')}\n--- END CONTEXT ---\n\n`
    : '\n\n[No relevant documents found in the knowledge base.]\n\n';

  const messages = [];

  messages.push({
    role: 'system',
    content: SYSTEM_PROMPT + contextBlock
  });

  // Add chat history (excluding the current user message which is last)
  const historyWithoutCurrent = history.slice(0, -1);
  for (const msg of historyWithoutCurrent) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      // Handle NCLOB content - may be Buffer or string
      let msgContent = msg.content;
      if (Buffer.isBuffer(msgContent)) {
        msgContent = msgContent.toString('utf8');
      } else if (typeof msgContent !== 'string') {
        msgContent = String(msgContent || '');
      }
      messages.push({ role: msg.role, content: msgContent });
    }
  }

  messages.push({ role: 'user', content: query });

  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    max_tokens: 2000,
    temperature: 0.3,
  });

  return response.choices[0].message.content;
}

module.exports = { generateRAGResponse };
