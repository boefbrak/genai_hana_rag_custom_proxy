using { genai.rag as db } from '../db/schema';

service ChatService @(path: '/api/chat') {

  entity ChatSessions as projection on db.ChatSessions excluding { messages };
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
