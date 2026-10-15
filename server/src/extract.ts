export interface ExtractedText {
  text: string;
  /** True when the file yielded no selectable text (e.g. a scanned PDF). */
  empty: boolean;
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'py',
  'go',
  'kt',
  'java',
  'css',
  'html',
  'yml',
  'yaml',
  'sh',
  'sql',
  'xml',
  'toml',
]);
const TEXT_EXTENSIONS = new Set(['txt', 'text', 'csv', 'log', 'env', 'ini']);

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<ExtractedText> {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';

  if (MARKDOWN_EXTENSIONS.has(extension) || CODE_EXTENSIONS.has(extension)) {
    return finish(buffer.toString('utf8'));
  }
  if (TEXT_EXTENSIONS.has(extension) || mimeType.startsWith('text/')) {
    return finish(buffer.toString('utf8'));
  }
  if (mimeType === 'application/pdf' || extension === 'pdf') {
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(buffer);
    return finish(parsed.text);
  }

  return {
    text: '',
    empty: true,
  };
}

function finish(text: string): ExtractedText {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  return { text: cleaned, empty: cleaned.length === 0 };
}