export interface Chunk {
  id: string;
  text: string;
  /** Character offset of the chunk within the document body. */
  start: number;
  end: number;
}

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 320;
const OVERLAP_TOKENS = 60;

const TARGET_CHARS = CHARS_PER_TOKEN * TARGET_TOKENS;
const OVERLAP_CHARS = CHARS_PER_TOKEN * OVERLAP_TOKENS;

const PARAGRAPH_BREAK = /\n\s*\n/;
const SENTENCE_END = /(?<=[.!?])\s+/;

/**
 * Split text into paragraph-aware chunks. Paragraphs shorter than the target
 * are merged with the following one; longer ones are split on sentence
 * boundaries. Consecutive chunks overlap so a fact spanning a boundary is
 * still retrievable.
 */
export function chunkText(text: string, sourceId: string): Chunk[] {
  const body = text.replace(/\r\n/g, '\n').trim();
  if (!body) return [];

  const blocks = body
    .split(PARAGRAPH_BREAK)
    .map((block) => block.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  let buffer = '';

  for (const block of blocks) {
    if (block.length > TARGET_CHARS) {
      if (buffer) {
        pieces.push(buffer);
        buffer = '';
      }
      pieces.push(...splitLongBlock(block));
      continue;
    }
    if (buffer.length + block.length + 2 > TARGET_CHARS) {
      pieces.push(buffer);
      buffer = block;
      continue;
    }
    buffer = buffer ? `${buffer}\n\n${block}` : block;
  }
  if (buffer) pieces.push(buffer);

  const chunks: Chunk[] = [];
  let cursor = 0;

  for (const piece of pieces) {
    const start = body.indexOf(piece, cursor);
    const from = start === -1 ? cursor : start;
    const text2 = piece.slice(0, TARGET_CHARS + OVERLAP_CHARS);
    chunks.push({
      id: `${sourceId}:${chunks.length}`,
      text: text2,
      start: from,
      end: from + text2.length,
    });
    cursor = from + Math.max(1, piece.length - OVERLAP_CHARS);
  }

  return chunks;
}

function splitLongBlock(block: string): string[] {
  const sentences = block.split(SENTENCE_END).filter(Boolean);
  const out: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    if (buffer.length + sentence.length > TARGET_CHARS && buffer) {
      out.push(buffer.trim());
      buffer = '';
    }
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
  }
  if (buffer.trim()) out.push(buffer.trim());

  return out.length ? out : [block.slice(0, TARGET_CHARS)];
}