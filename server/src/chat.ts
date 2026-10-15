import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import type { Source } from './store.js';

const SYSTEM_PROMPT = `You are a research assistant that answers questions about a user's own documents.

Rules:
- Answer only from the CONTEXT provided. Context is retrieved by semantic similarity, not by keyword, so it may contain loosely related passages.
- If the context does not contain the answer, say so plainly. Never guess, and never fill gaps from general knowledge.
- Cite every claim with the bracketed markers in the context, for example [S1] or [S2]. Put the marker at the end of the sentence it supports.
- Combine multiple sources when the answer spans them.
- Be concise and concrete. Prefer short paragraphs and bullet lists.
`;

export interface HistoryTurn {
  role: 'user' | 'model';
  text: string;
}

function buildContext(sources: Source[]): string {
  return sources
    .map((source, index) => {
      const marker = `S${index + 1}`;
      const snippet = source.snippet.replace(/\s+/g, ' ').trim();
      return `[${marker}] (${source.documentName}, similarity ${source.score.toFixed(3)})\n${snippet}`;
    })
    .join('\n\n');
}

export async function* streamAnswer(options: {
  question: string;
  history: HistoryTurn[];
  sources: Source[];
}): AsyncGenerator<string> {
  if (options.sources.length === 0) {
    yield 'I could not find anything relevant to that in your documents. Try rephrasing, or upload a document that covers it.';
    return;
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });

  const history = options.history
    .slice(-6)
    .map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] }));

  const stream = await ai.models.generateContentStream({
    model: config.model,
    contents: [
      ...history,
      {
        role: 'user',
        parts: [
          {
            text: `CONTEXT\n${buildContext(options.sources)}\n\nQUESTION\n${options.question}`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.2,
      maxOutputTokens: 1200,
    },
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) yield text;
  }
}