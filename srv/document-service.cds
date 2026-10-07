using { genai.rag as db } from '../db/schema';

service DocumentService @(path: '/api/documents') {

  entity Documents as projection on db.Documents excluding { chunks };

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
