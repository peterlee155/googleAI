import assert from 'node:assert/strict';
import { chunkText } from './chunk.js';
import { extractText } from './extract.js';
import { cosineSimilarity } from './gemini.js';

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.error(`        ${message}`);
  }
}

async function main() {
  console.log('chunkText');

  await check('returns nothing for empty input', () => {
    assert.deepEqual(chunkText('   \n\n  ', 'doc'), []);
  });

  await check('keeps a short document as one chunk', () => {
    const chunks = chunkText('Hello world. Short enough to stay whole.', 'doc');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.id, 'doc:0');
  });

  await check('splits a long document into multiple chunks', () => {
    const paragraph = `${'word '.repeat(120)}\n\n`;
    const chunks = chunkText(paragraph.repeat(12), 'doc');
    assert.ok(chunks.length > 1, `expected >1 chunk, got ${chunks.length}`);
    assert.ok(chunks.every((chunk) => chunk.text.length <= 1900));
  });

  await check('offsets point back into the original text', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}. ${'x'.repeat(200)}`).join('\n\n');
    const chunks = chunkText(text, 'doc');
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.equal(text.slice(chunk.start, chunk.end), chunk.text);
    }
  });

  await check('merges short paragraphs instead of one chunk each', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Short line ${i}.`).join('\n\n');
    assert.ok(chunkText(text, 'doc').length < 20);
  });

  await check('splits an oversized paragraph on sentence boundaries', () => {
    const sentence = 'This is a sentence with several words in it. ';
    const chunks = chunkText(sentence.repeat(300), 'doc');
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.text.trim().length > 0));
  });

  console.log('extractText');

  await check('reads markdown', async () => {
    const result = await extractText(Buffer.from('# Title\n\nSome body text.\n'), 'text/markdown', 'a.md');
    assert.equal(result.empty, false);
    assert.match(result.text, /Some body text\./);
  });

  await check('reads source files as utf8', async () => {
    const result = await extractText(Buffer.from('const a = 1;'), '', 'b.ts');
    assert.match(result.text, /const a = 1;/);
  });

  await check('normalises CRLF and trailing whitespace', async () => {
    const result = await extractText(Buffer.from('a\r\nb   \r\n'), 'text/plain', 'c.txt');
    assert.equal(result.text, 'a\nb');
  });

  await check('reports unsupported types as empty', async () => {
    const result = await extractText(Buffer.from([0, 1, 2]), 'application/octet-stream', 'x.bin');
    assert.equal(result.empty, true);
  });

  console.log('cosineSimilarity');

  await check('identical vectors score 1', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
  });

  await check('orthogonal vectors score 0', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  });

  await check('zero vectors score 0 instead of NaN', () => {
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  });

  await check('opposite vectors score -1', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 1], [-1, -1]) + 1) < 1e-9);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();