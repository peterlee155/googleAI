export interface DocumentSummary {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  charCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface Source {
  chunkId: string;
  documentId: string;
  documentName: string;
  snippet: string;
  score: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  error?: string;
}

const BASE = '/api';

async function json<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const data = await json<{ documents: DocumentSummary[] }>(await fetch(`${BASE}/documents`));
  return data.documents;
}

export async function deleteDocument(id: string): Promise<void> {
  await json<{ ok: boolean }>(await fetch(`${BASE}/documents/${id}`, { method: 'DELETE' }));
}

export interface UploadResult {
  id: string;
  name: string;
  charCount: number;
  chunkCount: number;
}

export async function uploadDocument(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  return json<UploadResult>(await fetch(`${BASE}/documents`, { method: 'POST', body: form }));
}

export interface StreamHandlers {
  onSources(sources: Source[]): void;
  onDelta(text: string): void;
  onError(message: string): void;
  signal?: AbortSignal;
}

export async function streamQuery(
  question: string,
  history: Array<{ role: 'user' | 'model'; text: string }>,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history }),
    signal: handlers.signal,
  });

  if (!response.ok || !response.body) {
    await json(response);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const eventLine = frame.split('\n').find((line) => line.startsWith('event: '));
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
      if (!eventLine || !dataLine) continue;

      const event = eventLine.slice(7).trim();
      const data: unknown = JSON.parse(dataLine.slice(6));

      if (event === 'sources') handlers.onSources(data as Source[]);
      else if (event === 'delta') handlers.onDelta((data as { text: string }).text);
      else if (event === 'error') handlers.onError((data as { error: string }).error);
    }
  }
}