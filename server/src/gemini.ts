import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: config.apiKey });
  }
  return client;
}

export async function embedTexts(
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await getClient().models.embedContent({
    model: config.embedModel,
    contents: texts,
    config: { outputDimensionality: 768 },
  });

  const embeddings = response.embeddings ?? [];
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedding API returned ${embeddings.length} vectors for ${texts.length} inputs.`,
    );
  }

  return embeddings.map((embedding, index) => {
    const values = embedding.values;
    if (!values || values.length === 0) {
      throw new Error(`Embedding ${index} came back empty.`);
    }
    return values;
  });
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}