# DocChat — RAG over your own documents

Ask questions about PDFs, Markdown, and code files you upload. Answers are grounded in
retrieved passages and every claim carries a citation you can inspect.

Built on the Gemini API: `gemini-embedding-001` for retrieval, `gemini-2.5-flash` for
generation. No LangChain, no vector database — the index is a JSON file on disk, which
makes the whole retrieval path readable end to end.

## How it works

1. **Ingest** — text is extracted (`pdf-parse` for PDFs, utf-8 otherwise), split into
   overlapping ~320-token chunks on paragraph and sentence boundaries, then embedded in
   batches and stored alongside the document.
2. **Retrieve** — the question is embedded and compared to every chunk by cosine
   similarity. Passages below a 0.2 floor are dropped, and no single document may occupy
   more than 3 of the top slots, so one dense section cannot crowd out the rest.
3. **Generate** — the top passages are handed to the model as numbered sources `[S1]`,
   `[S2]`, … with a system instruction to answer *only* from that context and to admit
   when the documents do not cover the question. The response streams back over SSE and
   the client renders `[S1]` as a clickable marker with the underlying passage beneath it.

## Getting started

```bash
npm install
cp server/.env.example server/.env    # then add your GEMINI_API_KEY
npm run dev
```

Open http://localhost:5173. Drop a file on the left, then ask a question.

Get a key at https://aistudio.google.com/apikey.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Server on :8787 and Vite on :5173 (proxied) |
| `npm test` | Chunking, extraction, and similarity checks |
| `npm run typecheck` | `tsc --noEmit` across both workspaces |
| `npm run build` | Typechecked production build of the frontend |

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness and active model |
| `GET /api/documents` | Indexed document summaries (no vectors) |
| `POST /api/documents` | Upload (`multipart/form-data`, field `file`) |
| `DELETE /api/documents/:id` | Remove a document and its vectors |
| `POST /api/query` | `{ question, history }` → SSE stream of `sources` / `delta` / `done` |

## Configuration

All optional except the key — see `server/.env.example`.

| Variable | Default | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Required |
| `CHAT_MODEL` | `gemini-2.5-flash` | |
| `EMBED_MODEL` | `gemini-embedding-001` | 768-dim output |
| `TOP_K` | `6` | Chunks passed to the model |
| `MAX_UPLOAD_MB` | `15` | |
| `DATA_DIR` | `.data` | Index location, gitignored |

## Known limits

- **No OCR.** Image-only or scanned PDFs return a 422 with an explanation rather than an
  empty index. Adding Tesseract.js is the obvious next step.
- **No auth.** The server binds to localhost and is meant to run locally. Putting it on a
  public host means adding Firebase Admin token verification and a per-user index.
- **Single-process JSON store.** Fine for tens of thousands of chunks; beyond that swap
  `store.ts` for SQLite with a `sqlite-vec` extension and the rest is unchanged.
- **Exponential-decay retrieval.** Pure cosine similarity, so a question with two halves
  ("summarise X, and what does it say about Y") favours whichever half dominates. A
  reranking pass would fix it.

## Layout

```
server/src
  index.ts      express app and startup
  routes.ts     HTTP handlers, SSE streaming, retrieval orchestration
  store.ts      on-disk document index
  chunk.ts      paragraph-aware chunking with overlap
  extract.ts    text extraction per file type
  gemini.ts     embedding calls and cosine similarity
  chat.ts       grounded streaming generation
  selfcheck.ts  offline tests
web/src
  App.tsx       upload panel, chat, citation rendering
  api.ts        typed fetch client with SSE frame parsing
```