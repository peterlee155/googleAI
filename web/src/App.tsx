import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteDocument,
  listDocuments,
  streamQuery,
  uploadDocument,
  type DocumentSummary,
  type Message,
  type Source,
} from './api.js';

let nextId = 0;
const makeId = () => `m${Date.now()}-${nextId++}`;

const CITATION = /\[S(\d{1,2})]/g;

function renderAnswer(text: string, sources: Source[]) {
  const parts: Array<string | JSX.Element> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(CITATION)) {
    const index = Number(match[1]) - 1;
    const source = sources[index];
    if (index < 0 || !source) continue;

    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    parts.push(
      <span
        className="cite"
        key={`${match.index}-${index}`}
        title={source.documentName}
      >
        S{index + 1}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function App() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await listDocuments());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load documents');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setStatus(null);
      for (const file of Array.from(files)) {
        setStatus(`Indexing ${file.name}…`);
        try {
          const result = await uploadDocument(file);
          setStatus(`${result.name}: ${result.chunkCount} chunks from ${result.charCount.toLocaleString()} characters`);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : `Failed on ${file.name}`);
        }
      }
      await refresh();
    },
    [refresh],
  );

  const ask = useCallback(async () => {
    const text = question.trim();
    if (!text || busy) return;

    const history = messages
      .filter((message) => !message.error && message.content)
      .map((message) => ({
        role: message.role === 'user' ? ('user' as const) : ('model' as const),
        text: message.content,
      }));

    const userMessage: Message = { id: makeId(), role: 'user', content: text };
    const replyId = makeId();
    setMessages((prev) => [...prev, userMessage, { id: replyId, role: 'assistant', content: '' }]);
    setQuestion('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const patch = (update: Partial<Message>) =>
      setMessages((prev) =>
        prev.map((message) => (message.id === replyId ? { ...message, ...update } : message)),
      );

    try {
      await streamQuery(text, history, {
        signal: controller.signal,
        onSources: (sources) => patch({ sources }),
        onDelta: (delta) =>
          setMessages((prev) =>
            prev.map((message) =>
              message.id === replyId
                ? { ...message, content: message.content + delta }
                : message,
            ),
          ),
        onError: (message) => patch({ error: message }),
      });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        patch({ error: error instanceof Error ? error.message : 'Request failed' });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [busy, messages, question]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div>
          <h1>DocChat</h1>
          <p className="sub">RAG over your own files, powered by Gemini</p>
        </div>

        <label
          className={`dropzone${dragging ? ' over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files);
          }}
        >
          <input
            type="file"
            hidden
            multiple
            onChange={(event) => {
              if (event.target.files?.length) void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
          Drop files here or click to browse
          <div style={{ marginTop: 6, fontSize: 11 }}>PDF, Markdown, text, code</div>
        </label>

        {status ? (
          <div className={`status${status.includes('Failed') ? ' error' : ''}`}>{status}</div>
        ) : null}

        <div className="doc-list">
          {documents.map((doc) => (
            <div className="doc" key={doc.id}>
              <div className="name">
                {doc.name}
                <div className="meta">
                  {doc.chunkCount} chunks · {(doc.size / 1024).toFixed(0)} KB
                </div>
              </div>
              <button
                type="button"
                title="Remove document"
                onClick={async () => {
                  await deleteDocument(doc.id);
                  setStatus(`Removed ${doc.name}`);
                  await refresh();
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          {documents.length === 0
            ? 'No documents indexed yet — add one on the left.'
            : `${documents.length} document${documents.length === 1 ? '' : 's'} indexed · answers are grounded with citations`}
        </header>

        <div className="messages" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="empty">
              Upload a document, then ask a question. Answers cite the specific passages they
              used, and the model is instructed to say when your documents do not cover
              something.
            </div>
          ) : (
            messages.map((message) => (
              <div className="message" key={message.id}>
                <div className="who">{message.role === 'user' ? 'You' : 'Assistant'}</div>
                <div className={`bubble${message.error ? ' error' : ''}`}>
                  {message.error
                    ? message.error
                    : message.content
                      ? renderAnswer(message.content, message.sources ?? [])
                      : busy
                        ? 'Thinking…'
                        : ''}
                </div>
                {message.sources && message.sources.length > 0 ? (
                  <div className="sources">
                    {message.sources.map((source, index) => (
                      <div className="source" key={source.chunkId}>
                        <div className="head">
                          <span>
                            S{index + 1} · {source.documentName}
                          </span>
                          <span>{source.score.toFixed(3)}</span>
                        </div>
                        {source.snippet.slice(0, 260)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <textarea
            value={question}
            placeholder="Ask a question about your documents…"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
          />
          <button
            type={busy ? 'button' : 'submit'}
            disabled={!busy && !question.trim()}
            onClick={() => {
              if (busy) abortRef.current?.abort();
            }}
          >
            {busy ? 'Stop' : 'Ask'}
          </button>
        </form>
      </main>
    </div>
  );
}