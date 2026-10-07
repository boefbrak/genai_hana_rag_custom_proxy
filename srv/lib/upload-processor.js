const cds = require('@sap/cds');
const { parseFile } = require('./file-parser');
const { chunkText } = require('./chunker');
const { embedTexts } = require('./embedder');

async function processUpload({ fileName, fileType, fileSize, buffer }) {
  const { Documents } = cds.entities('genai.rag');
  const docId = cds.utils.uuid();

  // Create document record with PROCESSING status
  await cds.run(INSERT.into(Documents).entries({
    ID: docId,
    fileName,
    fileType,
    fileSize,
    status: 'PROCESSING'
  }));

  // Process asynchronously
  processDocument(docId, fileType, buffer).catch(async (err) => {
    console.error(`Error processing document ${docId}:`, err);
    const { Documents: Docs } = cds.entities('genai.rag');
    await cds.run(UPDATE(Docs).set({
      status: 'ERROR',
      errorMsg: err.message.substring(0, 1000)
    }).where({ ID: docId }));
  });

  return { ID: docId, fileName, fileType, fileSize, status: 'PROCESSING' };
}

async function processDocument(docId, fileType, buffer) {
  const { Documents } = cds.entities('genai.rag');

  // Parse file to text
  const text = await parseFile(buffer, fileType);

  if (!text || text.trim().length === 0) {
    throw new Error('No text content could be extracted from the file');
  }

  // Chunk the text
  const chunks = chunkText(text, { maxTokens: 1000, overlapTokens: 200 });

  if (chunks.length === 0) {
    throw new Error('No chunks could be generated from the file content');
  }

  // Generate embeddings
  const embeddings = await embedTexts(chunks.map(c => c.content));

  // Store chunks with embeddings using raw SQL for vector support
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = cds.utils.uuid();
    const embeddingStr = JSON.stringify(embeddings[i]);

    await cds.run(
      `INSERT INTO "GENAI_RAG_DOCUMENTCHUNKS"
       ("ID", "DOCUMENT_ID", "CONTENT", "CHUNKINDEX", "TOKENCOUNT", "EMBEDDING")
       VALUES (?, ?, ?, ?, ?, TO_REAL_VECTOR(?))`,
      [chunkId, docId, chunks[i].content, i, chunks[i].tokenCount, embeddingStr]
    );
  }

  // Update document status to READY
  await cds.run(UPDATE(Documents).set({
    status: 'READY',
    chunkCount: chunks.length
  }).where({ ID: docId }));
}

module.exports = { processUpload };
