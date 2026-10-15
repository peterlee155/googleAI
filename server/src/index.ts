import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { router } from './routes.js';
import { initStore } from './store.js';

async function main(): Promise<void> {
  await initStore();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', router);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    console.log(`[server] models: chat=${config.model} embed=${config.embedModel}`);
    console.log(`[server] data dir: ${config.dataDir}`);
  });
}

main().catch((error: unknown) => {
  console.error('[server] failed to start:', error);
  process.exit(1);
});