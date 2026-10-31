import assert from 'node:assert/strict';
import { parseExpenseText, guessCategory } from '../js/parse.js';
import { summarize, tripDays, toCsv, localDate } from '../js/stats.js';

// ---- parse ----
const p = (t, d) => parseExpenseText(t, d);
let r = p('拉麵 980 円', 'TWD');
assert.deepEqual([r.amount_orig, r.currency_orig, r.merchant_orig, r.category, r.currency_guessed], [980, 'JPY', '拉麵', '餐飲', false]);

r = p('Taxi 12 euro 機場');
assert.deepEqual([r.amount_orig, r.currency_orig, r.merchant_orig, r.category], [12, 'EUR', 'Taxi 機場', '交通']);

r = p('7-11 咖啡 150', 'JPY'); // 店名數字不是金額；沒寫幣別 → 用預設並標記猜測
assert.deepEqual([r.amount_orig, r.currency_orig, r.currency_guessed, r.merchant_orig], [150, 'JPY', true, '7-11 咖啡']);

r = p('¥1,200 藥妝 幫媽媽買');
assert.deepEqual([r.amount_orig, r.currency_orig, r.is_proxy, r.proxy_for, r.category], [1200, 'JPY', true, '媽媽', '購物']);

r = p('代購 面膜 5000 yen');
assert.deepEqual([r.amount_orig, r.currency_orig, r.is_proxy, r.proxy_for], [5000, 'JPY', true, '']);

r = p('hotel 25000won');
assert.deepEqual([r.amount_orig, r.currency_orig, r.category], [25000, 'KRW', '住宿']);

r = p('晚餐 NT$ 380');
assert.deepEqual([r.amount_orig, r.currency_orig], [380, 'TWD']);

r = p('coffee $4.5');
assert.deepEqual([r.amount_orig, r.currency_orig], [4.5, 'USD']);

assert.equal(p('沒有數字'), null);
assert.equal(p('   '), null);
assert.equal(p('拉麵 0 円'), null);
assert.equal(guessCategory('未知東西'), '其他');

// ---- stats ----
const e = (o) => ({ status: 'confirmed', tz: 'Asia/Tokyo', category: '餐飲', is_proxy: false, deleted_at: '', ...o });
const list = [
  e({ occurred_at: '2026-10-30T03:00:00Z', amount_home: 200 }),
  e({ occurred_at: '2026-10-30T15:30:00Z', amount_home: 100, category: '交通' }), // 日本已是 10/31 00:30
  e({ occurred_at: '2026-10-31T03:00:00Z', amount_home: 700, is_proxy: true, category: '購物' }),
  e({ occurred_at: '2026-10-31T03:00:00Z', amount_home: null }),
  e({ occurred_at: '2026-10-31T03:00:00Z', amount_home: 999, status: 'draft' }),
  e({ occurred_at: '2026-10-31T03:00:00Z', amount_home: 999, deleted_at: '2026-10-31T04:00:00Z' })
];
assert.equal(localDate('2026-10-30T15:30:00Z', 'Asia/Tokyo'), '2026-10-31');
let s = summarize(list, { includeProxy: true, budget: 2000 });
assert.equal(s.total, 1000); assert.equal(s.pending, 1); assert.equal(s.remaining, 1000);
assert.deepEqual(s.byDay, [{ date: '2026-10-30', amount: 200 }, { date: '2026-10-31', amount: 800 }]);
assert.equal(s.byCategory[0].category, '購物'); assert.ok(Math.abs(s.byCategory.reduce((a, c) => a + c.pct, 0) - 1) < 1e-9);
s = summarize(list, { includeProxy: false });
assert.equal(s.total, 300); assert.equal(s.proxyTotal, 700);
assert.equal(s.avgPerDay, 150);
assert.equal(summarize([]).total, 0);
assert.equal(tripDays({ start_date: '2026-10-30', end_date: '2026-11-01' }), 3);
assert.equal(tripDays({ start_date: '', end_date: '' }), 0);

// ---- csv ----
const csv = toCsv([e({ occurred_at: '2026-10-30T03:00:00Z', merchant_orig: '=HYPERLINK("x")', note: 'a,"b"', amount_home: 1 })]);
assert.ok(csv.startsWith('﻿'));
assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), csv);
assert.ok(csv.includes('"a,""b"""'));

console.log('ALL PASS');
