const CHARS_PER_TOKEN = 4;

function chunkText(text, options = {}) {
  const { maxTokens = 1000, overlapTokens = 200 } = options;
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  if (!text || text.trim().length === 0) {
    return [];
  }

  const cleanedText = text.replace(/\s+/g, ' ').trim();
  const chunks = [];
  let startIndex = 0;

  while (startIndex < cleanedText.length) {
    let endIndex = Math.min(startIndex + maxChars, cleanedText.length);

    // Try to break at a sentence boundary
    if (endIndex < cleanedText.length) {
      const searchStart = Math.max(endIndex - 200, startIndex);
      const searchWindow = cleanedText.substring(searchStart, endIndex);
      const lastBreak = Math.max(
        searchWindow.lastIndexOf('. '),
        searchWindow.lastIndexOf('! '),
        searchWindow.lastIndexOf('? '),
        searchWindow.lastIndexOf('\n')
      );
      if (lastBreak > 0) {
        endIndex = searchStart + lastBreak + 2;
      }
    }

    const chunkContent = cleanedText.substring(startIndex, endIndex).trim();
    if (chunkContent.length > 0) {
      chunks.push({
        content: chunkContent,
        tokenCount: Math.ceil(chunkContent.length / CHARS_PER_TOKEN)
      });
    }

    const nextStart = endIndex - overlapChars;
    if (nextStart <= startIndex) {
      startIndex = endIndex;
    } else {
      startIndex = nextStart;
    }

    if (endIndex >= cleanedText.length) break;
  }

  return chunks;
}

module.exports = { chunkText };
