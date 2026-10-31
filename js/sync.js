// 與 Apps Script 後端同步：推送本機 _dirty 列、拉取增量。協定見 docs/schema-and-api.md §3
import { STORES, all, get, put, metaGet, metaSet } from './db.js';

const CFG_KEY = 'travel_ledger_cfg'; // { url, key }，只存本機，不進原始碼

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null') || { url: '', key: '' }; } catch (e) { return { url: '', key: '' }; }
}
export function setConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify({ url: cfg.url.trim(), key: cfg.key })); }

async function call(payload) {
  const cfg = getConfig();
  if (!cfg.url || !cfg.key) throw new Error('尚未設定後端網址與金鑰');
  // text/plain 避免 CORS 預檢（Apps Script 不處理 OPTIONS）
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key: cfg.key, ...payload })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '後端錯誤');
  return data;
}

const strip = rec => { const o = { ...rec }; delete o._dirty; delete o.srv_seq; return o; };

// 回傳 { pushed, pulled, conflicts }
export async function syncNow() {
  let pushed = 0, pulled = 0, conflicts = 0;
  let cursor = await metaGet('cursor', 0);

  // 1. 收集待推送列（最多 400 筆一批，後端上限 500）
  const changes = {};
  const sent = {}; // store → { id: updated_at }
  let count = 0;
  for (const [store, key] of Object.entries(STORES)) {
    for (const rec of await all(store)) {
      if (!rec._dirty || count >= 400) continue;
      (changes[store] = changes[store] || []).push(strip(rec));
      (sent[store] = sent[store] || {})[rec[key]] = rec.updated_at;
      count++;
    }
  }

  let first = true;
  for (;;) {
    const r = await call({ action: 'sync', since: cursor, changes: first ? changes : {} });
    if (first) {
      const bad = new Set((r.conflicts || []).map(c => c.table + '|' + c.id));
      for (const [store, ids] of Object.entries(sent)) {
        for (const [id, upd] of Object.entries(ids)) {
          if (bad.has(store + '|' + id)) { conflicts++; continue; }
          const cur = await get(store, id);
          if (cur && cur.updated_at === upd) { cur._dirty = 0; await put(store, cur); pushed++; } // 同步期間又被改過就保留待送
        }
      }
      first = false;
    }
    for (const [store, rows] of Object.entries(r.changes || {})) {
      if (!STORES[store]) continue; // 例如 Attachments：目前不存本機
      for (const row of rows) {
        const local = await get(store, row[STORES[store]]);
        if (!local || !local._dirty || row.updated_at >= local.updated_at) {
          await put(store, { ...row, _dirty: 0 });
          pulled++;
        }
      }
    }
    cursor = r.cursor;
    await metaSet('cursor', cursor);
    if (!r.more) break;
  }
  await metaSet('last_sync', new Date().toISOString());
  return { pushed, pulled, conflicts };
}

export async function pendingCount() {
  let n = 0;
  for (const store of Object.keys(STORES)) n += (await all(store)).filter(r => r._dirty).length;
  return n;
}
