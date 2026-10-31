// 文字記帳解析：「拉麵 980 円」「Taxi 12 euro 機場」→ 結構化草稿（純函式，無 DOM／網路）

// [幣別, 關鍵字…]；較長／較明確的放前面，通用的「元」「塊」放最後
const CUR_TOKENS = [
  ['CNY', '人民幣', 'cny', 'rmb'],
  ['KRW', '韓元', '韓圜', '韓幣', 'krw', '₩', 'won'],
  ['HKD', '港幣', '港元', 'hkd', 'hk$'],
  ['USD', '美金', '美元', 'usd', 'us$', '$'],
  ['EUR', '歐元', 'euros', 'euro', 'eur', '€'],
  ['GBP', '英鎊', 'gbp', '£'],
  ['THB', '泰銖', 'thb', 'baht'],
  ['TWD', '新台幣', '台幣', 'ntd', 'nt$', 'twd', '塊', '元'],
  ['JPY', '日圓', '日元', '円', 'yen', 'jpy', '¥', '￥']
];

export const CURRENCIES = CUR_TOKENS.map(c => c[0]).concat([]).sort();

const TOKEN_MAP = new Map();
for (const [code, ...toks] of CUR_TOKENS) for (const t of toks) TOKEN_MAP.set(t.toLowerCase(), code);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN_RE = [...TOKEN_MAP.keys()].sort((a, b) => b.length - a.length).map(escRe).join('|');
const AMOUNT_RE = new RegExp(`(?:(${TOKEN_RE})\\s*)?(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${TOKEN_RE})?`, 'gi');

const CATEGORY_RULES = [
  ['住宿', /hotel|飯店|旅館|民宿|住宿|airbnb|hostel|青旅/i],
  ['交通', /taxi|計程|地鐵|電車|\bjr\b|巴士|\bbus\b|機場|uber|新幹線|捷運|高鐵|火車|租車|加油|停車|車資/i],
  ['娛樂', /門票|票券|樂園|電影|展覽|按摩|spa|遊樂|溫泉|博物館|演唱會/i],
  ['購物', /藥妝|伴手禮|紀念|衣|包|商店|超市|便利|7-?11|唐吉|donki|購物|買/i],
  ['餐飲', /麵|飯|餐|咖啡|coffee|cafe|ramen|sushi|壽司|居酒屋|飲|酒|麥當勞|星巴克|吃|早|午|晚|甜點|冰/i]
];

export const CATEGORIES = ['餐飲', '交通', '住宿', '購物', '娛樂', '其他'];

export function guessCategory(text) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return '其他';
}

const PROXY_RE = /(?:代購|代買)|幫\s*([^\s買买]{1,6})\s*(?:買|买)/;

export function parseExpenseText(input, defaultCurrency = 'TWD') {
  const text = String(input || '').trim();
  if (!text) return null;

  // 先挑「帶幣別」的數字；沒有就取最後一個數字（避開「7-11」這類店名數字）
  const matches = [...text.matchAll(AMOUNT_RE)];
  if (!matches.length) return null;
  const withCur = matches.find(m => m[1] || m[3]);
  const m = withCur || matches[matches.length - 1];
  const amount = Number(m[2].replace(/,/g, ''));
  if (!isFinite(amount) || amount <= 0) return null;
  const tok = (m[1] || m[3] || '').toLowerCase();
  const currency = TOKEN_MAP.get(tok) || null;

  let rest = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
  let is_proxy = false, proxy_for = '';
  const pm = rest.match(PROXY_RE);
  if (pm) { is_proxy = true; proxy_for = pm[1] || ''; rest = rest.replace(PROXY_RE, ' '); }
  const merchant = rest.replace(/\s+/g, ' ').trim();

  return {
    amount_orig: amount,
    currency_orig: currency || defaultCurrency,
    currency_guessed: !currency,
    merchant_orig: merchant,
    category: guessCategory(text),
    is_proxy, proxy_for
  };
}
