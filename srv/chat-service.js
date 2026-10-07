const cds = require('@sap/cds');
const { embedTexts } = require('./lib/embedder');
const { searchSimilarChunks } = require('./lib/vector-search');
const { generateRAGResponse } = require('./lib/rag-engine');

const MAX_HISTORY_MESSAGES = 10;

module.exports = class ChatService extends cds.ApplicationService {
  async init() {
    const { ChatSessions, ChatMessages, Documents } = cds.entities('genai.rag');

    this.on('createSession', async (req) => {
      const { documentId, title } = req.data;

      // Validate document exists and is ready
      if (!documentId) {
        req.error(400, 'Document ID is required');
        return;
      }

      const doc = await SELECT.one.from(Documents).where({ ID: documentId });
      if (!doc) {
        req.error(404, 'Document not found');
        return;
      }
      if (doc.status !== 'READY') {
        req.error(400, 'Document is not ready for chat');
        return;
      }

      const sessionId = cds.utils.uuid();
      const sessionTitle = title || `Chat: ${doc.fileName}`;
      await INSERT.into(ChatSessions).entries({
        ID: sessionId,
        document_ID: documentId,
        title: sessionTitle
      });
      return { ID: sessionId, document_ID: documentId, title: sessionTitle };
    });

    this.on('updateSession', async (req) => {
      const { sessionId, documentId, title } = req.data;

      // Validate new document if provided
      if (documentId) {
        const doc = await SELECT.one.from(Documents).where({ ID: documentId });
        if (!doc) {
          req.error(404, 'Document not found');
          return;
        }
        if (doc.status !== 'READY') {
          req.error(400, 'Document is not ready for chat');
          return;
        }
      }

      const updates = {};
      if (documentId) updates.document_ID = documentId;
      if (title) updates.title = title;

      await UPDATE(ChatSessions).where({ ID: sessionId }).with(updates);
      return await SELECT.one.from(ChatSessions).where({ ID: sessionId });
    });

    this.on('getSessionMessages', async (req) => {
      const { sessionId } = req.data;
      return await SELECT.from(ChatMessages)
        .where({ session_ID: sessionId })
        .orderBy('timestamp asc');
    });

    this.on('getDocumentSessions', async (req) => {
      const { documentId } = req.data;
      return await SELECT.from(ChatSessions)
        .where({ document_ID: documentId })
        .orderBy('createdAt desc');
    });

    this.on('sendMessage', async (req) => {
      const { sessionId, message } = req.data;

      // Get session's document
      const session = await SELECT.one.from(ChatSessions)
        .where({ ID: sessionId })
        .columns('document_ID');

      if (!session) {
        req.error(404, 'Session not found');
        return;
      }

      if (!session.document_ID) {
        req.error(400, 'Session is not linked to a document');
        return;
      }

      // Store user message
      const userMsgId = cds.utils.uuid();
      await INSERT.into(ChatMessages).entries({
        ID: userMsgId,
        session_ID: sessionId,
        role: 'user',
        content: message
      });

      // Embed the user query
      const [queryEmbedding] = await embedTexts([message]);

      // Retrieve relevant chunks - filtered by session's document
      const relevantChunks = await searchSimilarChunks(queryEmbedding, 10, [session.document_ID]);

      // Get chat history for context
      const history = await SELECT.from(ChatMessages)
        .where({ session_ID: sessionId })
        .orderBy('timestamp desc')
        .limit(MAX_HISTORY_MESSAGES);
      history.reverse();

      // Generate RAG response
      const reply = await generateRAGResponse({
        query: message,
        chunks: relevantChunks,
        history: history
      });

      // Store assistant response
      const assistantMsgId = cds.utils.uuid();
      const sourcesJson = JSON.stringify(relevantChunks.map(c => ({
        chunkId: c.ID,
        documentName: c.documentName,
        similarity: c.similarity
      })));

      await INSERT.into(ChatMessages).entries({
        ID: assistantMsgId,
        session_ID: sessionId,
        role: 'assistant',
        content: reply,
        sources: sourcesJson
      });

      return {
        reply,
        messageId: assistantMsgId,
        sources: relevantChunks.map(c => {
          // Handle NCLOB content - may be Buffer or string
          let contentStr = c.content;
          if (Buffer.isBuffer(contentStr)) {
            contentStr = contentStr.toString('utf8');
          } else if (typeof contentStr !== 'string') {
            contentStr = String(contentStr || '');
          }
          return {
            chunkId: c.ID,
            documentName: c.documentName,
            content: contentStr.substring(0, 200) + (contentStr.length > 200 ? '...' : ''),
            similarity: c.similarity
          };
        })
      };
    });

    await super.init();
  }
};
