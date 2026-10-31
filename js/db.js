// IndexedDB 封裝。每筆記錄多一個本機欄位 _dirty（1＝尚未同步），推送時會剝掉。
export const STORES = {
  Trips: 'trip_id', Expenses: 'expense_id', ExpenseItems: 'item_id',
  Places: 'place_id', Notes: 'note_id', Persons: 'person_id'
};

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open('travel-ledger', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [name, key] of Object.entries(STORES)) db.createObjectStore(name, { keyPath: key });
      db.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const all = store => run(store, 'readonly', s => s.getAll());
export const get = (store, id) => run(store, 'readonly', s => s.get(id));
export const put = (store, rec) => run(store, 'readwrite', s => s.put(rec));
export const metaGet = async (k, d = null) => { const r = await run('meta', 'readonly', s => s.get(k)); return r ? r.v : d; };
export const metaSet = (k, v) => run('meta', 'readwrite', s => s.put({ k, v }));

export const nowIso = () => new Date().toISOString();

// 寫入並標記待同步；updated_at 由本機寫（同步用來判斷新舊）
export async function save(store, rec) {
  rec.updated_at = nowIso();
  rec._dirty = 1;
  await put(store, rec);
  return rec;
}

export async function remove(store, rec) {
  rec.deleted_at = nowIso();
  return save(store, rec);
}
