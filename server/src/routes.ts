import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { config } from './config.js';
import { chunkText } from './chunk.js';
import { streamAnswer, type HistoryTurn } from './chat.js';
import { extractText } from './extract.js';
import { cosineSimilarity, embedTexts } from './gemini.js';
import {
  allChunks,
  deleteDocument,
  getDocument,
  listDocuments,
  newDocumentId,
  saveDocument,
  type Source,
} from './store.js';

const EMBED_BATCH_SIZE = 100;
const SNIPPET_CHARS = 700;

export const router: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

function wrap(handler: AsyncHandler) {
  return (req: Request, res: Response): void => {
    handler(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      console.error('[api]', message);
      if (!res.headersSent) {
        // Upstream bodies can echo the key or internal detail back to the client.
        res.status(502).json({ error: 'Upstream request failed. See the server log.' });
      }
    });
  };
}

router.get(
  '/health',
  wrap(async (_req, res) => {
    res.json({ ok: true, model: process.env.CHAT_MODEL ?? 'gemini-2.5-flash' });
  }),
);

router.get(
  '/documents',
  wrap(async (_req, res) => {
    res.json({ documents: await listDocuments() });
  }),
);

router.delete(
  '/documents/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id);
    const removed = await deleteDocument(id);
    if (!removed) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({ ok: true });
  }),
);

router.post(
  '/documents',
  upload.single('file'),
  wrap(async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Attach a file in the "file" field' });
      return;
    }

    const { text, empty } = await extractText(file.buffer, file.mimetype, file.originalname);
    if (empty) {
      res.status(422).json({
        error:
          'No selectable text found. Scanned or image-only PDFs need OCR, which this server does not do yet.',
      });
      return;
    }

    const id = newDocumentId();
    const chunks = chunkText(text, id);
    if (chunks.length === 0) {
      res.status(422).json({ error: 'File produced no indexable content' });
      return;
    }

    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      vectors.push(...(await embedTexts(batch.map((chunk) => chunk.text))));
    }

    await saveDocument({
      id,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      charCount: text.length,
      chunkCount: chunks.length,
      createdAt: new Date().toISOString(),
      vectors,
      texts: chunks.map((chunk) => chunk.text),
      offsets: chunks.map((chunk) => ({ start: chunk.start, end: chunk.end })),
    });

    res.status(201).json({
      id,
      name: file.originalname,
      charCount: text.length,
      chunkCount: chunks.length,
    });
  }),
);

router.post(
  '/query',
  wrap(async (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const history: HistoryTurn[] = Array.isArray(req.body?.history)
      ? req.body.history
          .slice(-6)
          .filter(
            (turn: unknown): turn is HistoryTurn =>
              typeof turn === 'object' &&
              turn !== null &&
              (turn as HistoryTurn).role !== undefined &&
              typeof (turn as HistoryTurn).text === 'string',
          )
      : [];

    if (!question) {
      res.status(400).json({ error: 'Send a non-empty "question"' });
      return;
    }

    const sources = await retrieve(question);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('sources', sources);

    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    try {
      for await (const delta of streamAnswer({ question, history, sources })) {
        if (aborted) break;
        send('delta', { text: delta });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      console.error('[query]', message);
      if (!aborted) send('error', { error: 'The model call failed. See the server log.' });
    }

    send('done', { ok: !aborted });
    res.end();
  }),
);

async function retrieve(question: string): Promise<Source[]> {
  const docs = await listDocuments();
  if (docs.length === 0) return [];

  const chunks = await allChunks();
  if (chunks.length === 0) return [];

  const names = new Map(docs.map((doc) => [doc.id, doc.name]));
  const vectorsByChunk = new Map<string, number[]>();
  for (const summary of docs) {
    const loaded = await getDocument(summary.id);
    if (!loaded) continue;
    loaded.texts.forEach((_, index) => {
      vectorsByChunk.set(`${loaded.id}:${index}`, loaded.vectors[index] ?? []);
    });
  }

  const [queryVector] = await embedTexts([question]);
  if (!queryVector) return [];

  const scored = chunks.map((chunk) => {
    const vector = vectorsByChunk.get(chunk.chunkId) ?? [];
    return {
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentName: names.get(chunk.documentId) ?? chunk.documentName,
      snippet: chunk.text.slice(0, SNIPPET_CHARS),
      score: cosineSimilarity(queryVector, vector),
    };
  });

  // Drop near-duplicate chunks so one dense section cannot fill every slot.
  const MIN_SCORE = 0.2;
  const MAX_PER_DOC = 3;
  const perDoc = new Map<string, number>();

  return scored
    .filter((candidate) => candidate.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      const used = perDoc.get(candidate.documentId) ?? 0;
      if (used >= MAX_PER_DOC) return false;
      perDoc.set(candidate.documentId, used + 1);
      return true;
    })
    .slice(0, config.topK);
}