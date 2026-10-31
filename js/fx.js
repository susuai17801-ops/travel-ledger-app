// 即時匯率：主要 open.er-api.com，備援 jsDelivr currency-api；失敗時用本機快取（標記 cached）
const PRIMARY = c => `https://open.er-api.com/v6/latest/${c}`;
const FALLBACK = c => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${c.toLowerCase()}.json`;
const TIMEOUT_MS = 4000;

async function fetchJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function cacheKey(from, to) { return `fx_${from}_${to}`; }
function readCache(from, to) {
  try { return JSON.parse(localStorage.getItem(cacheKey(from, to)) || 'null'); } catch (e) { return null; }
}
function writeCache(from, to, rate) {
  try { localStorage.setItem(cacheKey(from, to), JSON.stringify({ rate, at: new Date().toISOString() })); } catch (e) { /* 無痕或容量滿 */ }
}

// 回傳 { rate, source: 'live'|'cached', at } 或 null（完全沒有匯率）
export async function getRate(from, to = 'TWD') {
  if (from === to) return { rate: 1, source: 'live', at: new Date().toISOString() };
  try {
    let rate;
    try {
      const j = await fetchJson(PRIMARY(from));
      rate = j && j.rates && j.rates[to];
    } catch (e) {
      const j = await fetchJson(FALLBACK(from));
      rate = j && j[from.toLowerCase()] && j[from.toLowerCase()][to.toLowerCase()];
    }
    if (typeof rate === 'number' && rate > 0) {
      writeCache(from, to, rate);
      return { rate, source: 'live', at: new Date().toISOString() };
    }
  } catch (e) { /* 離線或服務失敗，退回快取 */ }
  const c = readCache(from, to);
  return c ? { rate: c.rate, source: 'cached', at: c.at } : null;
}

export const toHome = (amount, rate) => Math.round(amount * rate);
