/**
 * Minimal client for TinyFish Search and Fetch (both free to use).
 * Docs: https://docs.tinyfish.ai/search-api and https://docs.tinyfish.ai/fetch-api/reference
 *
 * Reads the API key from process.env.TINYFISH_API_KEY (put it in reporting/.env, never commit it).
 * Uses Node's built-in fetch (Node 18+), so no extra packages are needed.
 */

const SEARCH_URL = 'https://api.search.tinyfish.ai';
const FETCH_URL = 'https://api.fetch.tinyfish.ai';

class TinyFishError extends Error {}

class TinyFishClient {
  constructor(apiKey = process.env.TINYFISH_API_KEY) {
    if (!apiKey) throw new TinyFishError('TINYFISH_API_KEY is not set. Add it to reporting/.env');
    this.headers = { 'X-API-Key': apiKey };
  }

  /** Returns results: [{ position, site_name, title, snippet, url }] */
  async search(query, params = {}) {
    const qs = new URLSearchParams({ query, ...params });
    const resp = await fetch(`${SEARCH_URL}?${qs}`, { headers: this.headers, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new TinyFishError(`Search failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    return data.results || [];
  }

  /** Fetches up to 10 URLs as Markdown. Returns { results, errors }. */
  async fetchPages(urls, { links = true } = {}) {
    const resp = await fetch(FETCH_URL, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: urls.slice(0, 10),
        format: 'markdown',
        links,
        purpose: 'Find the accessibility or feedback contact for this website',
      }),
      signal: AbortSignal.timeout(150000),
    });
    if (!resp.ok) throw new TinyFishError(`Fetch failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    return { results: data.results || [], errors: data.errors || [] };
  }
}

module.exports = { TinyFishClient, TinyFishError };
