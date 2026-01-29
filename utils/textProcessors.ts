/**
 * Splits a long string of text into manageable chunks for TTS processing.
 * Keeps chunks around 1200-1500 characters to balance latency and context.
 * respecting paragraph breaks and sentence endings.
 */
export function chunkText(text: string, maxChunkSize: number = 1500): string[] {
  if (!text) return [];
  if (text.length <= maxChunkSize) return [text];

  const chunks: string[] = [];
  // Split by double newlines to preserve paragraphs
  const paragraphs = text.split(/\n\s*\n/);
  
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    // If adding this paragraph exceeds max size
    if (currentChunk.length + paragraph.length > maxChunkSize) {
      // If the current chunk is not empty, push it
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }

      // If the paragraph ITSELF is huge (bigger than max chunk), we must split it by sentences
      if (paragraph.length > maxChunkSize) {
        let subChunks = paragraph.match(/[^.!?]+[.!?]+(\s+|$)/g);

        // Fallback: Hard split if no sentences found
        if (!subChunks) {
            subChunks = paragraph.match(new RegExp(`[\\s\\S]{1,${maxChunkSize}}`, 'g'));
        }

        const segments = subChunks || [paragraph];

        for (const segment of segments) {
           if (currentChunk.length + segment.length > maxChunkSize) {
              if (currentChunk.trim()) chunks.push(currentChunk.trim());
              currentChunk = segment;
           } else {
              currentChunk += segment;
           }
        }
      } else {
        currentChunk = paragraph;
      }
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}