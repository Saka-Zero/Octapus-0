import chalk from 'chalk';

/**
 * Keyless web search + fetch via DuckDuckGo HTML endpoints.
 * Gives the AI live internet access — no API key, no registration.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** DuckDuckGo HTML search — parse result links/snippets out of the page */
export async function webSearch(query: string, maxResults = 6): Promise<SearchResult[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' }
  });
  if (!res.ok) throw new Error(`DDG returned ${res.status}`);
  const html = await res.text();

  const results: SearchResult[] = [];
  // Result blocks: <a rel="nofollow" class="result__a" href="...">TITLE</a>
  // href is a redirect like //duckduckgo.com/l/?uddg=<encoded-url>&rut=...
  const linkRx = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRx = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snipRx.exec(html)) && snippets.length < maxResults * 2) {
    snippets.push(stripTags(sm[1]));
  }

  let lm: RegExpExecArray | null;
  while ((lm = linkRx.exec(html)) && results.length < maxResults) {
    let url = lm[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    // Skip ads (duckduckgo click-tracking redirects)
    if (/duckduckgo\.com\/y\.js|ad_domain=|bing\.com\/aclick/i.test(url)) continue;
    results.push({
      title: stripTags(lm[2]),
      url,
      snippet: snippets[results.length] || ''
    });
  }
  return results;
}

/** Fetch a URL and reduce HTML to readable text */
export async function webFetch(url: string, maxChars = 12000): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs allowed');
  // SSRF guard: never probe private/loopback ranges
  const host = new URL(url).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\])/i.test(host)) {
    throw new Error('Blocked: private/loopback host');
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const ctype = res.headers.get('content-type') || '';
  let body = await res.text();
  if (ctype.includes('html')) {
    body = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n');
  }
  return body.slice(0, maxChars);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

/**
 * High-level helper used by the agent tool: search then optionally
 * fetch the top result's page for deeper context.
 */
export async function researchQuery(query: string, deep = false): Promise<string> {
  const results = await webSearch(query, deep ? 5 : 6);
  if (results.length === 0) return `No results found for: ${query}`;

  let out = results.map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet.slice(0, 200)}`).join('\n');

  if (deep && results[0]) {
    try {
      const page = await webFetch(results[0].url, 6000);
      out += `\n\n=== TOP RESULT PAGE (${results[0].url}) ===\n${page}`;
    } catch {
      out += `\n(top page fetch failed — snippets only)`;
    }
  }
  return out;
}
