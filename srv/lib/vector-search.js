const cds = require('@sap/cds');

async function searchSimilarChunks(queryEmbedding, topK = 10, documentIds = null) {
  const embeddingStr = JSON.stringify(queryEmbedding);

  let sql = `
    SELECT TOP ${topK}
      c."ID",
      c."CONTENT",
      c."CHUNKINDEX",
      c."DOCUMENT_ID",
      d."FILENAME" AS "documentName",
      COSINE_SIMILARITY(c."EMBEDDING", TO_REAL_VECTOR('${embeddingStr}')) AS "similarity"
    FROM "GENAI_RAG_DOCUMENTCHUNKS" c
    INNER JOIN "GENAI_RAG_DOCUMENTS" d ON c."DOCUMENT_ID" = d."ID"
    WHERE d."STATUS" = 'READY'
  `;

  if (documentIds && documentIds.length > 0) {
    const idList = documentIds.map(id => `'${id}'`).join(',');
    sql += ` AND c."DOCUMENT_ID" IN (${idList})`;
  }

  sql += ` ORDER BY "similarity" DESC`;

  const results = await cds.run(sql);

  return results.map(row => ({
    ID: row.ID,
    content: row.CONTENT,
    chunkIndex: row.CHUNKINDEX,
    documentId: row.DOCUMENT_ID,
    documentName: row.documentName,
    similarity: row.similarity
  }));
}

module.exports = { searchSimilarChunks };
