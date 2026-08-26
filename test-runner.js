const { ReadableStream } = require('stream/web');
global.fetch = async () => {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    }
  });
  return { ok: true, body: stream, headers: new Map(), text: async () => '' };
};
const { streamOpenAI } = require('./dist/providers/openai-stream');
(async () => {
  const evs = [];
  for await (const ev of streamOpenAI({ baseURL: 'https://fake', apiKey: 'none', messages: [{ role: 'user', content: 'x' }], options: { model: 'm' }, providerName: 'fake' })) {
    evs.push(ev);
  }
  console.error('EVENTS:', evs.length, JSON.stringify(evs));
})();
