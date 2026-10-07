const cds = require('@sap/cds');

module.exports = class DocumentService extends cds.ApplicationService {
  async init() {
    const { Documents, DocumentChunks, ChatSessions, ChatMessages } = cds.entities('genai.rag');

    this.on('deleteDocument', async (req) => {
      const { documentId } = req.data;

      // 1. Find all sessions linked to this document
      const sessions = await SELECT.from(ChatSessions)
        .where({ document_ID: documentId })
        .columns('ID');

      // 2. Delete all messages from those sessions
      if (sessions.length > 0) {
        const sessionIds = sessions.map(s => s.ID);
        await DELETE.from(ChatMessages).where({ session_ID: { in: sessionIds } });
      }

      // 3. Delete all sessions linked to this document
      await DELETE.from(ChatSessions).where({ document_ID: documentId });

      // 4. Delete all chunks
      await DELETE.from(DocumentChunks).where({ document_ID: documentId });

      // 5. Delete the document
      const count = await DELETE.from(Documents).where({ ID: documentId });
      return count > 0;
    });

    this.on('getStatus', async (req) => {
      const { documentId } = req.data;
      const doc = await SELECT.one.from(Documents)
        .where({ ID: documentId })
        .columns('status', 'chunkCount', 'errorMsg');
      return doc;
    });

    this.on('getDeletePreview', async (req) => {
      const { documentId } = req.data;

      // Get session count
      const sessions = await SELECT.from(ChatSessions)
        .where({ document_ID: documentId })
        .columns('ID');

      // Get message count from those sessions
      let messageCount = 0;
      if (sessions.length > 0) {
        const sessionIds = sessions.map(s => s.ID);
        const msgResult = await SELECT.one.from(ChatMessages)
          .where({ session_ID: { in: sessionIds } })
          .columns('count(*) as count');
        messageCount = msgResult?.count || 0;
      }

      // Get chunk count
      const chunkResult = await SELECT.one.from(DocumentChunks)
        .where({ document_ID: documentId })
        .columns('count(*) as count');

      return {
        sessionCount: sessions.length,
        messageCount: messageCount,
        chunkCount: chunkResult?.count || 0
      };
    });

    await super.init();
  }
};
