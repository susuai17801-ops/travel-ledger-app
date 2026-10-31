// 旅遊分析（純函式）：只計 confirmed、未刪除、已有 amount_home 的帳目

export function localDate(iso, tz) {
  const d = new Date(iso);
  try { return new Intl.DateTimeFormat('sv-SE', { timeZone: tz || undefined }).format(d); }
  catch (e) { return new Intl.DateTimeFormat('sv-SE').format(d); }
}

export function summarize(expenses, { includeProxy = true, budget = 0, days = 0 } = {}) {
  const live = expenses.filter(e => !e.deleted_at && e.status === 'confirmed');
  const pending = live.filter(e => e.amount_home == null).length;
  const used = live.filter(e => e.amount_home != null && (includeProxy || !e.is_proxy));
  const total = used.reduce((s, e) => s + e.amount_home, 0);

  const cat = {};
  used.forEach(e => { cat[e.category || '其他'] = (cat[e.category || '其他'] || 0) + e.amount_home; });
  const byCategory = Object.entries(cat).map(([category, amount]) => ({
    category, amount, pct: total ? amount / total : 0
  })).sort((a, b) => b.amount - a.amount);

  const day = {};
  used.forEach(e => { const k = localDate(e.occurred_at, e.tz); day[k] = (day[k] || 0) + e.amount_home; });
  const byDay = Object.entries(day).map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date < b.date ? -1 : 1);

  const spanDays = days || byDay.length;
  return {
    total, byCategory, byDay, pending,
    avgPerDay: spanDays ? total / spanDays : 0,
    remaining: budget ? budget - total : null,
    proxyTotal: live.filter(e => e.amount_home != null && e.is_proxy).reduce((s, e) => s + e.amount_home, 0)
  };
}

// 旅程天數（含頭尾）；日期缺漏回 0
export function tripDays(trip) {
  if (!trip || !trip.start_date || !trip.end_date) return 0;
  const a = Date.parse(trip.start_date), b = Date.parse(trip.end_date);
  return isFinite(a) && isFinite(b) && b >= a ? Math.round((b - a) / 86400000) + 1 : 0;
}

export function toCsv(expenses) {
  const cols = ['occurred_at', 'tz', 'category', 'merchant_orig', 'merchant_zh', 'amount_orig', 'currency_orig',
    'fx_rate', 'amount_home', 'is_proxy', 'proxy_for', 'payment_method', 'note', 'status'];
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 防止在試算表開啟時被當公式
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = expenses.filter(e => !e.deleted_at).sort((a, b) => a.occurred_at < b.occurred_at ? -1 : 1);
  return '﻿' + [cols.join(',')].concat(rows.map(e => cols.map(c => cell(e[c])).join(','))).join('\r\n');
}
