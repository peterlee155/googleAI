import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export interface Source {
  chunkId: string;
  documentId: string;
  documentName: string;
  snippet: string;
  score: number;
}

export interface Document {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  charCount: number;
  chunkCount: number;
  createdAt: string;
  vectors: number[][];
  texts: string[];
  offsets: Array<{ start: number; end: number }>;
}

const INDEX_FILE = 'index.json';

export async function initStore(): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
}

function indexPath(): string {
  return path.join(config.dataDir, INDEX_FILE);
}

export async function listDocuments(): Promise<
  Array<Omit<Document, 'vectors' | 'texts' | 'offsets'>>
> {
  const docs = await loadAll();
  return docs.map(({ vectors: _v, texts: _t, offsets: _o, ...rest }) => rest);
}

export async function getDocument(id: string): Promise<Document | undefined> {
  const docs = await loadAll();
  return docs.find((doc) => doc.id === id);
}

export async function saveDocument(doc: Document): Promise<void> {
  const docs = await loadAll();
  const next = docs.filter((existing) => existing.id !== doc.id);
  next.push(doc);
  await persist(next);
}

export async function deleteDocument(id: string): Promise<boolean> {
  const docs = await loadAll();
  const next = docs.filter((doc) => doc.id !== id);
  if (next.length === docs.length) return false;
  await persist(next);
  return true;
}

/** Every chunk across every document, tagged with its owning document. */
export async function allChunks(): Promise<
  Array<{ chunkId: string; documentId: string; documentName: string; text: string }>
> {
  const docs = await loadAll();
  return docs.flatMap((doc) =>
    doc.texts.map((text, index) => ({
      chunkId: `${doc.id}:${index}`,
      documentId: doc.id,
      documentName: doc.name,
      text,
    })),
  );
}

export function newDocumentId(): string {
  return randomUUID();
}

async function loadAll(): Promise<Document[]> {
  try {
    const raw = await readFile(indexPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Document[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function persist(docs: Document[]): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(indexPath(), JSON.stringify(docs), 'utf8');
}