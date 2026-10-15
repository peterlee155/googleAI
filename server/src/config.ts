const EMBED_MODEL = 'gemini-embedding-001';
const CHAT_MODEL = 'gemini-2.5-flash';

const PORT = Number(process.env.PORT ?? 8787);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy server/.env.example to server/.env and fill it in.`,
    );
  }
  return value;
}

export const config = {
  get apiKey() {
    return requireEnv('GEMINI_API_KEY');
  },
  get model() {
    return process.env.CHAT_MODEL ?? CHAT_MODEL;
  },
  get embedModel() {
    return process.env.EMBED_MODEL ?? EMBED_MODEL;
  },
  get dataDir() {
    return process.env.DATA_DIR ?? '.data';
  },
  get maxUploadMb() {
    return Number(process.env.MAX_UPLOAD_MB ?? 15);
  },
  get topK() {
    return Number(process.env.TOP_K ?? 6);
  },
  port: PORT,
};