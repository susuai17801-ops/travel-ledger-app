import * as db from './db.js';
import { parseExpenseText, CURRENCIES, CATEGORIES } from './parse.js';
import { summarize, tripDays, toCsv, localDate } from './stats.js';
import { getRate, toHome } from './fx.js';
import { syncNow, getConfig, setConfig, pendingCount } from './sync.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const fmt = n => n == null ? '—' : Math.round(n).toLocaleString('en-US');
const PAYMENTS = ['', '現金', '信用卡', '行動支付'];

// 國家 → [名稱, 幣別, 時區]
const COUNTRIES = {
  JP: ['日本', 'JPY', 'Asia/Tokyo'], KR: ['韓國', 'KRW', 'Asia/Seoul'], TW: ['台灣', 'TWD', 'Asia/Taipei'],
  HK: ['香港／澳門', 'HKD', 'Asia/Hong_Kong'], CN: ['中國', 'CNY', 'Asia/Shanghai'], TH: ['泰國', 'THB', 'Asia/Bangkok'],
  US: ['美國', 'USD', 'America/New_York'], GB: ['英國', 'GBP', 'Europe/London'], EU: ['歐洲', 'EUR', 'Europe/Paris']
};

const state = { trips: [], expenses: [], tripId: null, view: 'add', syncing: false, syncTimer: null };
let draft = null;      // 正在確認／編輯的帳目
let draftEdit = false;
let rateReq = 0;

const curTrip = () => state.trips.find(t => t.trip_id === state.tripId) || null;
const tripCountry = t => ((t && t.countries) || '').split(',')[0];
const tripCurrency = t => (COUNTRIES[tripCountry(t)] || [])[1] || localStorage.getItem('last_cur') || 'TWD';
const tripTz = t => (COUNTRIES[tripCountry(t)] || [])[2] || Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------- 載入 ----------
async function load() {
  state.trips = (await db.all('Trips')).filter(t => !t.deleted_at).sort((a, b) => (b.created_at || '') < (a.created_at || '') ? -1 : 1);
  const saved = localStorage.getItem('trip_id');
  state.tripId = state.trips.some(t => t.trip_id === saved) ? saved : (state.trips[0] && state.trips[0].trip_id) || null;
  const all = await db.all('Expenses');
  state.expenses = all.filter(e => e.trip_id === state.tripId);
  renderAll();
}

function renderAll() {
  renderTripSel();
  renderRecent();
  if (state.view === 'list') renderList();
  if (state.view === 'stats') renderStats();
  if (state.view === 'set') renderSettings();
  updateBadge();
}

function renderTripSel() {
  const sel = $('tripSel');
  sel.innerHTML = state.trips.length
    ? state.trips.map(t => `<option value="${esc(t.trip_id)}">${esc(t.name)}</option>`).join('')
    : '<option value="">（尚無旅程，請先新增）</option>';
  sel.value = state.tripId || '';
}

async function updateBadge() {
  const n = await pendingCount();
  $('syncBadge').textContent = n ? String(n) : '';
  $('btnSync').title = n ? `${n} 筆待同步` : '已同步';
}

// ---------- 視圖切換 ----------
function setView(v) {
  state.view = v;
  for (const id of ['add', 'list', 'stats', 'set']) $('v-' + id).hidden = id !== v;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'list') renderList();
  if (v === 'stats') renderStats();
  if (v === 'set') renderSettings();
  window.scrollTo(0, 0);
}

function showBanner(msg) {
  $('banner').hidden = !msg;
  $('banner').textContent = msg || '';
}
function refreshOfflineBanner() { showBanner(navigator.onLine ? '' : '離線中：記帳會先存在手機，連線後自動同步'); }

// ---------- 記帳 ----------
function toLocalInput(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function timeStr(e) {
  try { return new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: e.tz || undefined }).format(new Date(e.occurred_at)); }
  catch (x) { return ''; }
}

$('addForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const trip = curTrip();
  if (!trip) { openTripDialog(null); return; }
  const text = $('quick').value;
  const p = parseExpenseText(text, tripCurrency(trip));
  if (!p) { $('addHint').textContent = '找不到金額。請寫成「品項 金額 幣別」，例如：拉麵 980 円'; return; }
  $('addHint').textContent = '';
  draft = {
    expense_id: crypto.randomUUID(), trip_id: trip.trip_id,
    occurred_at: new Date().toISOString(), tz: tripTz(trip),
    amount_orig: p.amount_orig, currency_orig: p.currency_orig,
    fx_rate: null, fx_source: '', amount_home: null,
    category: p.category, merchant_orig: p.merchant_orig, merchant_zh: '', note: '',
    payment_method: '', is_proxy: p.is_proxy, proxy_for: p.proxy_for,
    input_mode: 'text', status: 'confirmed', created_at: new Date().toISOString(),
    _guessed: p.currency_guessed
  };
  draftEdit = false;
  renderCard();
  await loadRate();
});

function renderCard() {
  const el = $('card');
  if (!draft) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const opt = (list, cur) => list.map(v => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v || '（未填）')}</option>`).join('');
  el.innerHTML = `<div class="card">
    <div class="row"><b>${draftEdit ? '編輯帳目' : '確認這筆'}</b>
      ${draft._guessed ? `<span class="tag warn">沒寫幣別，先用 ${esc(draft.currency_orig)}</span>` : ''}</div>
    <div class="two">
      <label>金額<input id="cAmt" type="number" step="any" inputmode="decimal"></label>
      <label>幣別<select id="cCur">${opt(CURRENCIES, draft.currency_orig)}</select></label>
    </div>
    <label>品項／店名<input id="cMer" maxlength="100"></label>
    <div class="two">
      <label>分類<select id="cCat">${opt(CATEGORIES, draft.category)}</select></label>
      <label>付款<select id="cPay">${opt(PAYMENTS, draft.payment_method)}</select></label>
    </div>
    <label>時間<input id="cWhen" type="datetime-local"></label>
    <label>匯率（1 ${esc(draft.currency_orig)} = ? TWD）<input id="cRate" type="number" step="any" inputmode="decimal"></label>
    <div class="fx" id="cFx"></div>
    <label class="row"><input type="checkbox" id="cProxy" style="width:auto;min-height:0"> 代購（不算個人旅費）</label>
    <input id="cProxyFor" placeholder="幫誰買（選填）" maxlength="30">
    <label>備註<input id="cNote" maxlength="200"></label>
    <div class="row">
      <button class="primary" id="cOk">確認入帳</button>
      <button id="cCancel" type="button">取消</button>
      ${draftEdit ? '<button id="cDel" type="button" class="danger">刪除</button>' : ''}
    </div></div>`;
  $('cAmt').value = draft.amount_orig;
  $('cMer').value = draft.merchant_orig || '';
  $('cWhen').value = toLocalInput(new Date(draft.occurred_at));
  $('cRate').value = draft.fx_rate ?? '';
  $('cProxy').checked = !!draft.is_proxy;
  $('cProxyFor').value = draft.proxy_for || '';
  $('cNote').value = draft.note || '';
  updateFx();

  $('cAmt').oninput = () => { draft.amount_orig = Number($('cAmt').value); recompute(); };
  $('cCur').onchange = async () => { draft.currency_orig = $('cCur').value; draft._guessed = false; draft.fx_rate = null; await loadRate(true); };
  $('cRate').oninput = () => { const r = Number($('cRate').value); draft.fx_rate = r > 0 ? r : null; draft.fx_source = r > 0 ? 'manual' : ''; recompute(); };
  $('cOk').onclick = confirmDraft;
  $('cCancel').onclick = closeCard;
  if (draftEdit) $('cDel').onclick = deleteDraft;
  el.scrollIntoView({ block: 'nearest' });
}

function recompute() {
  draft.amount_home = draft.fx_rate && draft.amount_orig > 0 ? toHome(draft.amount_orig, draft.fx_rate) : null;
  updateFx();
}

function updateFx() {
  const fx = $('cFx');
  if (!fx) return;
  if (!draft.fx_rate) { fx.textContent = '目前沒有匯率：先存起來，連線後到「設定」按「補算匯率」'; return; }
  const src = { live: '即時', cached: '快取（估算）', manual: '手動' }[draft.fx_source] || '';
  fx.textContent = `≈ NT$ ${fmt(draft.amount_home)}　（${src}）`;
}

async function loadRate(force) {
  if (draftEdit && !force && draft.fx_rate) { updateFx(); return; } // 編輯舊帳目：沿用入帳當下的匯率
  const id = ++rateReq;
  const cur = draft.currency_orig;
  $('cFx').textContent = '查詢匯率…';
  const r = await getRate(cur);
  if (id !== rateReq || !draft) return; // 使用者已切換幣別或關閉
  draft.fx_rate = r ? r.rate : null;
  draft.fx_source = r ? r.source : '';
  $('cRate').value = draft.fx_rate ?? '';
  recompute();
}

async function confirmDraft() {
  const amt = Number($('cAmt').value);
  if (!(amt > 0)) { $('cAmt').focus(); return; }
  draft.amount_orig = amt;
  draft.currency_orig = $('cCur').value;
  draft.merchant_orig = $('cMer').value.trim();
  draft.category = $('cCat').value;
  draft.payment_method = $('cPay').value;
  draft.occurred_at = new Date($('cWhen').value || Date.now()).toISOString();
  draft.is_proxy = $('cProxy').checked;
  draft.proxy_for = $('cProxyFor').value.trim();
  draft.note = $('cNote').value.trim();
  recompute();
  const rec = { ...draft }; delete rec._guessed;
  await db.save('Expenses', rec);
  localStorage.setItem('last_cur', rec.currency_orig);
  $('quick').value = '';
  closeCard();
  await load();
  scheduleSync();
}

async function deleteDraft() {
  if (!confirm('刪除這筆帳目？')) return;
  const rec = { ...draft }; delete rec._guessed;
  await db.remove('Expenses', rec);
  closeCard();
  await load();
  scheduleSync();
}

function closeCard() { draft = null; rateReq++; renderCard(); }

function expenseRow(e) {
  const title = e.merchant_zh || e.merchant_orig || e.category;
  return `<li data-id="${esc(e.expense_id)}">
    <div><div>${esc(title)}${e.is_proxy ? '<span class="tag">代購</span>' : ''}${e.amount_home == null ? '<span class="tag warn">待補匯率</span>' : ''}</div>
      <div class="sub">${esc(timeStr(e))} · ${esc(e.category)}${e.payment_method ? ' · ' + esc(e.payment_method) : ''}</div></div>
    <div class="amt"><div>${e.amount_home == null ? '—' : 'NT$ ' + fmt(e.amount_home)}</div>
      <div class="sub">${esc(fmt(e.amount_orig))} ${esc(e.currency_orig)}</div></div></li>`;
}

function liveExpenses() {
  return state.expenses.filter(e => !e.deleted_at).sort((a, b) => a.occurred_at < b.occurred_at ? 1 : -1);
}

function bindRows(ul) {
  ul.querySelectorAll('li[data-id]').forEach(li => li.onclick = () => {
    const e = state.expenses.find(x => x.expense_id === li.dataset.id);
    if (!e) return;
    draft = { ...e }; draftEdit = true;
    setView('add');
    renderCard();
  });
}

function renderRecent() {
  const ul = $('recent');
  const list = liveExpenses().slice(0, 5);
  ul.innerHTML = list.length ? list.map(expenseRow).join('') : '<li style="cursor:default"><span class="sub">還沒有帳目</span></li>';
  bindRows(ul);
}

// ---------- 帳目 ----------
function renderList() {
  const ul = $('expList');
  const list = liveExpenses();
  if (!list.length) { ul.innerHTML = '<li style="cursor:default"><span class="sub">還沒有帳目</span></li>'; return; }
  let day = '', html = '';
  for (const e of list) {
    const d = localDate(e.occurred_at, e.tz);
    if (d !== day) { day = d; html += `<li class="day">${esc(d)}</li>`; }
    html += expenseRow(e);
  }
  ul.innerHTML = html;
  bindRows(ul);
}

// ---------- 分析 ----------
function elapsedDays(trip) {
  const total = tripDays(trip);
  if (!total) return 0;
  const today = Date.parse(localDate(new Date().toISOString()));
  const passed = Math.round((today - Date.parse(trip.start_date)) / 86400000) + 1;
  return Math.min(Math.max(passed, 1), total);
}

function renderStats() {
  const trip = curTrip();
  const s = summarize(state.expenses, {
    includeProxy: $('inclProxy').checked, budget: trip ? Number(trip.budget) || 0 : 0, days: trip ? elapsedDays(trip) : 0
  });
  const bars = s.byCategory.map(c => `<div class="stat"><div class="head"><span>${esc(c.category)}</span>
    <span>NT$ ${fmt(c.amount)}　${Math.round(c.pct * 100)}%</span></div>
    <div class="bar"><i style="width:${(c.pct * 100).toFixed(1)}%"></i></div></div>`).join('');
  const days = s.byDay.slice().reverse().map(d => `<li style="cursor:default"><span>${esc(d.date)}</span><span class="amt">NT$ ${fmt(d.amount)}</span></li>`).join('');
  $('statsBody').innerHTML = `
    <div class="card"><div class="sub">總支出</div><div class="big">NT$ ${fmt(s.total)}</div>
      <div class="row"><span>日均 NT$ ${fmt(s.avgPerDay)}</span>
      ${s.remaining != null ? `<span>· 剩餘預算 NT$ ${fmt(s.remaining)}</span>` : ''}</div>
      ${s.pending ? `<div class="fx">有 ${s.pending} 筆還沒有匯率，未計入</div>` : ''}
      ${$('inclProxy').checked ? '' : `<div class="fx">已排除代購 NT$ ${fmt(s.proxyTotal)}</div>`}</div>
    <h3>類別</h3>${bars || '<p class="hint">還沒有資料</p>'}
    <h3>每日</h3><ul class="list">${days || ''}</ul>`;
}
$('inclProxy').addEventListener('change', renderStats);

// ---------- 旅程 ----------
function openTripDialog(trip) {
  const f = $('tripForm');
  $('tripDlgTitle').textContent = trip ? '編輯旅程' : '新增旅程';
  f.elements.country.innerHTML = Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}">${esc(v[0])}（${v[1]}）</option>`).join('');
  f.elements.name.value = trip ? trip.name : '';
  f.elements.country.value = trip ? tripCountry(trip) || 'JP' : 'JP';
  f.elements.start_date.value = trip ? trip.start_date : '';
  f.elements.end_date.value = trip ? trip.end_date : '';
  f.elements.budget.value = trip && trip.budget ? trip.budget : '';
  f.elements.type.value = trip ? trip.type || 'solo' : 'solo';
  f.dataset.editing = trip ? trip.trip_id : '';
  // 新裝置第一次開：本機沒旅程且還沒設定同步 → 提供「從雲端還原」入口
  $('dlgRestore').classList.toggle('show', !trip && !state.trips.length && !getConfig().url);
  $('tripDlg').showModal();
}

$('dlgRestore').addEventListener('click', () => {
  $('tripDlg').close('cancel');
  setView('set');
  showBanner('貼上後端網址與金鑰，按「儲存並同步」就能把旅程與帳目還原');
});

$('tripDlg').addEventListener('close', async () => {
  const dlg = $('tripDlg');
  if (dlg.returnValue !== 'ok') return;
  const f = $('tripForm').elements;
  const id = $('tripForm').dataset.editing;
  const old = id ? state.trips.find(t => t.trip_id === id) : null;
  const rec = {
    ...(old || { trip_id: crypto.randomUUID(), created_at: new Date().toISOString(), cover_att_id: '' }),
    name: f.name.value.trim(), countries: f.country.value, type: f.type.value, home_currency: 'TWD',
    start_date: f.start_date.value, end_date: f.end_date.value, budget: f.budget.value ? Number(f.budget.value) : null
  };
  if (!rec.name) return;
  await db.save('Trips', rec);
  localStorage.setItem('trip_id', rec.trip_id);
  dlg.returnValue = '';
  await load();
  scheduleSync();
});

$('tripSel').addEventListener('change', async () => {
  localStorage.setItem('trip_id', $('tripSel').value);
  closeCard();
  await load();
});

// ---------- 設定／同步 ----------
async function renderSettings() {
  const t = curTrip();
  $('tripInfo').innerHTML = t
    ? `<div class="card"><b>${esc(t.name)}</b><div class="sub">${esc((COUNTRIES[tripCountry(t)] || ['—'])[0])} · ${esc(t.start_date || '日期未設')} ～ ${esc(t.end_date || '')}${t.budget ? ' · 預算 NT$ ' + fmt(t.budget) : ''}</div></div>`
    : '<p class="hint">還沒有旅程，先按「新增旅程」。</p>';
  const cfg = getConfig();
  $('cfgUrl').value = cfg.url; $('cfgKey').value = cfg.key;
  const last = await db.metaGet('last_sync');
  const n = await pendingCount();
  $('syncInfo').textContent = (last ? `上次同步：${new Date(last).toLocaleString('zh-TW')}` : '尚未同步過') + `　待同步 ${n} 筆`;
}

async function doSync(manual) {
  if (state.syncing) return;
  const cfg = getConfig();
  if (!cfg.url || !cfg.key) { if (manual) { setView('set'); showBanner('請先填後端網址與金鑰'); } return; }
  state.syncing = true;
  $('btnSync').disabled = true;
  try {
    const r = await syncNow();
    refreshOfflineBanner();
    if (manual) showBanner(`同步完成：送出 ${r.pushed}、收到 ${r.pulled}${r.conflicts ? `、${r.conflicts} 筆被其他裝置較新的版本取代` : ''}`);
    await load();
  } catch (e) {
    showBanner('同步失敗（資料仍在手機裡，稍後會重試）：' + (e.message || e));
  } finally {
    state.syncing = false;
    $('btnSync').disabled = false;
    updateBadge();
  }
}

function scheduleSync() {
  updateBadge();
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(() => doSync(false), 2000);
}

$('btnSync').addEventListener('click', () => doSync(true));
$('btnSave').addEventListener('click', async () => {
  setConfig({ url: $('cfgUrl').value, key: $('cfgKey').value });
  await doSync(true);
  renderSettings();
});
$('btnNewTrip').addEventListener('click', () => openTripDialog(null));
$('btnEditTrip').addEventListener('click', () => { const t = curTrip(); if (t) openTripDialog(t); });

$('btnCsv').addEventListener('click', () => {
  const t = curTrip();
  if (!t) return;
  const url = URL.createObjectURL(new Blob([toCsv(state.expenses)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = (t.name || 'trip').replace(/[\\/:*?"<>|]/g, '_') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('btnRecalc').addEventListener('click', async () => {
  const todo = state.expenses.filter(e => !e.deleted_at && e.amount_home == null);
  let n = 0;
  for (const e of todo) {
    const r = await getRate(e.currency_orig);
    if (!r) continue;
    e.fx_rate = r.rate; e.fx_source = r.source; e.amount_home = toHome(e.amount_orig, r.rate);
    await db.save('Expenses', e); n++;
  }
  showBanner(todo.length ? `已補算 ${n} / ${todo.length} 筆` : '沒有需要補算的帳目');
  await load();
  scheduleSync();
});

// ---------- 啟動 ----------
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));
window.addEventListener('online', () => { refreshOfflineBanner(); doSync(false); });
window.addEventListener('offline', refreshOfflineBanner);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // 新版 service worker 接手時重載一次，確保畫面與程式同一版（第一次安裝不重載）
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js').catch(() => { /* 離線快取失敗不影響記帳 */ });
}

await load();
refreshOfflineBanner();
// 新手機：本機是空的但已設定後端 → 先同步拉回資料，再決定要不要請使用者建立旅程
const cfg0 = getConfig();
if (!state.trips.length && cfg0.url && cfg0.key && navigator.onLine) await doSync(false);
if (!state.trips.length) openTripDialog(null);
else doSync(false);
