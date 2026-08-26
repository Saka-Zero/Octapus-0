const { ReadableStream } = require('stream/web');
let fakeChunks = [];
global.fetch = async () => {
  const enc = new TextEncoder();
  const stream = new ReadableStream({ start(c) { for (const ch of fakeChunks) c.enqueue(enc.encode(ch)); c.close(); } });
  return { ok: true, body: stream, headers: new Map(), text: async () => '' };
};
const { streamOpenAI, ProviderHttpError } = require('./dist/providers/openai-stream');

async function run(name, chunks, validate) {
  fakeChunks = chunks;
  const events = []; let error = null;
  try {
    for await (const ev of streamOpenAI({ baseURL: 'https://fake', apiKey: 'none', messages: [{ role: 'user', content: 'x' }], options: { model: 'm' }, providerName: 'fake' })) events.push(ev);
  } catch (e) { error = e; }
  const ok = validate(events, error);
  console.log(ok ? '✓' : '✗', name);
  if (!ok) console.log('   ', error ? error.message.slice(0, 80) : JSON.stringify(events).slice(0, 150));
  return ok;
}

(async () => {
  let pass = 0; const total = 10;
  const D = (delta) => `data: {"choices":[{"delta":${delta}}]}\n\n`;

  if (await run('normal flow', [D('{"content":"Hel"}'), D('{"content":"lo"}'), 'data: [DONE]\n\n'],
    (ev) => ev.filter(e => e.type === 'text').map(e => e.text).join('') === 'Hello')) pass++;

  if (await run('no-space data:', ['data:{"choices":[{"delta":{"content":"X"}}]}\n\n', 'data: [DONE]\n\n'],
    (ev) => ev.some(e => e.type === 'text' && e.text === 'X'))) pass++;

  if (await run('CRLF endings', ['data: {"choices":[{"delta":{"content":"Y"}}]}\r\n\r\n', 'data: [DONE]\r\n\n'],
    (ev) => ev.some(e => e.type === 'text' && e.text === 'Y'))) pass++;

  if (await run('split mid-JSON across chunks', ['data: {"choices":[{"del', 'ta":{"content":"SP"}}]}\n\ndata: [DONE]\n\n'],
    (ev) => ev.some(e => e.type === 'text' && e.text === 'SP'))) pass++;

  if (await run('multi-line data field', ['data: {"choices":[{"del\n', 'data: ta":{"content":"ML"}}]}\n\n', 'data: [DONE]\n\n'],
    (ev) => ev.some(e => e.type === 'text' && e.text === 'ML'))) pass++;

  if (await run('non-string content safe',
    ['data: {"choices":[{"delta":{"content":{"evil":1}}}]}]\n\n', D('{"content":"after"}'), 'data: [DONE]\n\n'],
    (ev) => !ev.some(e => e.type === 'text' && String(e.text).includes('[object')) && ev.some(e => e.type === 'text' && e.text === 'after'))) pass++;

  if (await run('bad tool index filtered',
    ['data: {"choices":[{"delta":{"tool_calls":[{"index":-5,"function":{"name":"x"}}]}}]}\n\n', 'data: [DONE]\n\n'],
    (ev) => !ev.some(e => e.type === 'tool_calls'))) pass++;

  if (await run('tool calls assembled',
    ['data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"f","arguments":"{\\"a\\":"}}]}}]}\n\n',
     'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n', 'data: [DONE]\n\n'],
    (ev) => { const tc = ev.find(e => e.type === 'tool_calls'); return tc && tc.calls[0].function.arguments === '{"a":1}'; })) pass++;

  if (await run('in-stream error throws', ['data: {"error":{"message":"quota"}}\n\n'],
    (ev, err) => err instanceof ProviderHttpError)) pass++;

  if (await run('usage captured',
    ['data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n'],
    (ev) => ev.some(e => e.type === 'usage' && e.usage.total_tokens === 15))) pass++;

  console.log(`\n${pass}/${total} PASS`);
})();
