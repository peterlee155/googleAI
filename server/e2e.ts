const BASE = process.env.BASE ?? 'http://localhost:8787/api';

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function ask(question: string): Promise<void> {
  console.log(`\nQ: ${question}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  const response = await post('/query', { question });
  if (!response.ok || !response.body) {
    console.log(`  HTTP ${response.status}: ${await response.text()}`);
    clearTimeout(timer);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let sources: Array<{ documentName: string; score: number }> = [];
  let error: string | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const ev = frame.split('\n').find((l) => l.startsWith('event: '))?.slice(7).trim();
        const dt = frame.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
        if (!ev || !dt) continue;
        const data = JSON.parse(dt) as any;
        if (ev === 'sources') sources = data;
        else if (ev === 'delta') answer += data.text;
        else if (ev === 'error') error = data.error;
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
    console.log('  TIMED OUT after 90s');
  }
  clearTimeout(timer);

  console.log(`  sources: ${sources.map((s) => `${s.documentName}@${s.score.toFixed(3)}`).join(', ') || 'none'}`);
  if (error) console.log(`  ERROR: ${error}`);
  console.log(`  answer: ${answer.slice(0, 600) || '(empty)'}`);
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  console.log('health:', JSON.stringify(health));

  await ask('Who won the Nobel Prize for quantum tunneling work and when?');
  await ask('How does current behave as voltage increases in a resonant tunneling diode?');
  await ask('What is the capital of France?');
}

void main();