import { NextResponse } from 'next/server';
import { LlmChat, UserMessage } from 'emergentintegrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ------------- NSE HELPERS -------------
let nseCookieCache = { cookie: null, ts: 0 };
const NSE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function refreshNseCookies() {
  const res = await fetch('https://www.nseindia.com/option-chain', {
    headers: {
      'User-Agent': NSE_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
    cache: 'no-store',
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('set-cookie') || '').split(/,(?=\s*\w+=)/);
  const parts = (raw || []).map((c) => c.split(';')[0].trim()).filter(Boolean);
  const cookieStr = parts.join('; ');
  nseCookieCache = { cookie: cookieStr, ts: Date.now() };
  return cookieStr;
}

async function getNseCookies() {
  const age = Date.now() - nseCookieCache.ts;
  if (nseCookieCache.cookie && age < 4 * 60 * 1000) return nseCookieCache.cookie;
  return await refreshNseCookies();
}

async function nseFetch(url, retry = true) {
  const cookie = await getNseCookies();
  const res = await fetch(url, {
    headers: {
      'User-Agent': NSE_UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.nseindia.com/option-chain',
      'Cookie': cookie,
      'X-Requested-With': 'XMLHttpRequest',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    if (retry && (res.status === 401 || res.status === 403)) {
      await refreshNseCookies();
      return nseFetch(url, false);
    }
    throw new Error(`NSE ${res.status}`);
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error('NSE returned non-JSON'); }
}

// ------------- INDICES -------------
async function getIndices() {
  const data = await nseFetch('https://www.nseindia.com/api/allIndices');
  const wanted = ['NIFTY 50', 'NIFTY BANK', 'NIFTY FIN SERVICE', 'INDIA VIX'];
  const map = {};
  for (const idx of (data.data || [])) {
    if (wanted.includes(idx.index)) {
      map[idx.index] = {
        name: idx.index,
        last: idx.last,
        change: idx.variation,
        percentChange: idx.percentChange,
        open: idx.open,
        high: idx.high,
        low: idx.low,
        previousClose: idx.previousClose,
      };
    }
  }
  return { indices: map, timestamp: data.timestamp || new Date().toISOString() };
}

// ------------- OPTION CHAIN -------------
const INDEX_CODE = { NIFTY: 'nse50_opt', BANKNIFTY: 'nifty_bank_opt', FINNIFTY: 'finnifty_opt' };
const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function parseNseDate(s) {
  const [d, m, y] = String(s).split('-');
  return new Date(+y, MONTHS[m], +d).getTime();
}

async function getOptionChain(symbol) {
  const s = (symbol || 'NIFTY').toUpperCase();
  const code = INDEX_CODE[s];
  if (!code) throw new Error(`Unsupported symbol ${s}`);
  const raw = await nseFetch(`https://www.nseindia.com/api/liveEquity-derivatives?index=${code}`);
  const contracts = raw.data || [];
  if (!contracts.length) throw new Error('No contracts returned from NSE');

  const spot = contracts.find((c) => typeof c.underlyingValue === 'number')?.underlyingValue;
  const now = Date.now();
  const expiries = [...new Set(contracts.map((c) => c.expiryDate))]
    .filter((e) => parseNseDate(e) + 86400000 > now)
    .sort((a, b) => parseNseDate(a) - parseNseDate(b));
  const currentExpiry = expiries[0];

  // Build strike -> { CE, PE } for current expiry
  const map = new Map();
  for (const c of contracts) {
    if (c.expiryDate !== currentExpiry) continue;
    const k = c.strikePrice;
    if (!map.has(k)) map.set(k, { strikePrice: k, expiryDate: c.expiryDate, CE: null, PE: null });
    const row = map.get(k);
    const leg = {
      lastPrice: c.lastPrice, openInterest: c.openInterest,
      changeinOpenInterest: null, // not exposed by this endpoint
      totalTradedVolume: c.volume,
      impliedVolatility: null, // not exposed
      change: c.change, pChange: c.pChange,
    };
    if (c.optionType === 'Call') row.CE = leg;
    else if (c.optionType === 'Put') row.PE = leg;
  }
  const rows = [...map.values()].sort((a, b) => a.strikePrice - b.strikePrice);

  // Compute ATM
  let atm = null;
  let atmDiff = Infinity;
  for (const r of rows) {
    const d = Math.abs(r.strikePrice - spot);
    if (d < atmDiff) { atmDiff = d; atm = r.strikePrice; }
  }

  // Totals + PCR + Max Pain
  let totalCeOi = 0, totalPeOi = 0, totalCeVol = 0, totalPeVol = 0;
  let totalCeChg = 0, totalPeChg = 0;
  let maxCallOi = { strike: null, oi: 0 };
  let maxPutOi = { strike: null, oi: 0 };
  let maxCallChg = { strike: null, chg: -Infinity };
  let maxPutChg = { strike: null, chg: -Infinity };

  for (const r of rows) {
    const ce = r.CE || {};
    const pe = r.PE || {};
    const ceOi = ce.openInterest || 0;
    const peOi = pe.openInterest || 0;
    totalCeOi += ceOi; totalPeOi += peOi;
    totalCeVol += ce.totalTradedVolume || 0;
    totalPeVol += pe.totalTradedVolume || 0;
    totalCeChg += ce.changeinOpenInterest || 0;
    totalPeChg += pe.changeinOpenInterest || 0;
    if (ceOi > maxCallOi.oi) maxCallOi = { strike: r.strikePrice, oi: ceOi };
    if (peOi > maxPutOi.oi) maxPutOi = { strike: r.strikePrice, oi: peOi };
    if ((ce.changeinOpenInterest || 0) > maxCallChg.chg) maxCallChg = { strike: r.strikePrice, chg: ce.changeinOpenInterest || 0 };
    if ((pe.changeinOpenInterest || 0) > maxPutChg.chg) maxPutChg = { strike: r.strikePrice, chg: pe.changeinOpenInterest || 0 };
  }

  // Max pain: strike where total payoff to option writers is minimum
  let maxPain = null;
  let minPain = Infinity;
  for (const target of rows) {
    const strike = target.strikePrice;
    let pain = 0;
    for (const r of rows) {
      const ceOi = (r.CE && r.CE.openInterest) || 0;
      const peOi = (r.PE && r.PE.openInterest) || 0;
      if (strike > r.strikePrice) pain += (strike - r.strikePrice) * ceOi;
      if (strike < r.strikePrice) pain += (r.strikePrice - strike) * peOi;
    }
    if (pain < minPain) { minPain = pain; maxPain = strike; }
  }

  const pcr = totalCeOi > 0 ? +(totalPeOi / totalCeOi).toFixed(3) : null;

  // ATM IV (avg of ATM CE + PE IV)
  const atmRow = rows.find((r) => r.strikePrice === atm) || {};
  const atmCeIv = (atmRow.CE && atmRow.CE.impliedVolatility) || null;
  const atmPeIv = (atmRow.PE && atmRow.PE.impliedVolatility) || null;
  const atmIv = (atmCeIv && atmPeIv) ? +(((atmCeIv + atmPeIv) / 2).toFixed(2)) : (atmCeIv || atmPeIv);

  return {
    symbol: s,
    spot,
    expiry: currentExpiry,
    expiries,
    atm,
    pcr,
    maxPain,
    atmIv,
    totals: {
      ceOi: totalCeOi, peOi: totalPeOi,
      ceVol: totalCeVol, peVol: totalPeVol,
      ceChgOi: totalCeChg, peChgOi: totalPeChg,
    },
    walls: {
      resistance: maxCallOi,
      support: maxPutOi,
      topCeChg: maxCallChg,
      topPeChg: maxPutChg,
    },
    rows,
    timestamp: raw.timestamp || new Date().toISOString(),
    marketStatus: raw.marketStatus || null,
  };
}

// ------------- LLM -------------
function getChat(sessionId, system) {
  if (!process.env.EMERGENT_LLM_KEY) throw new Error('Missing EMERGENT_LLM_KEY');
  return new LlmChat(process.env.EMERGENT_LLM_KEY, sessionId, system)
    .withModel('anthropic', 'claude-sonnet-4-5-20250929')
    .withParams({ temperature: 0.2, max_tokens: 2500 });
}

function summarizeChainForAI(chain, indices) {
  const rows = chain.rows;
  const atmIdx = rows.findIndex((r) => r.strikePrice === chain.atm);
  const near = rows.slice(Math.max(0, atmIdx - 5), Math.min(rows.length, atmIdx + 6));
  const nearSummary = near.map((r) => ({
    strike: r.strikePrice,
    isATM: r.strikePrice === chain.atm,
    CE: r.CE ? {
      ltp: r.CE.lastPrice, iv: r.CE.impliedVolatility,
      oi: r.CE.openInterest, chgOi: r.CE.changeinOpenInterest,
      vol: r.CE.totalTradedVolume,
    } : null,
    PE: r.PE ? {
      ltp: r.PE.lastPrice, iv: r.PE.impliedVolatility,
      oi: r.PE.openInterest, chgOi: r.PE.changeinOpenInterest,
      vol: r.PE.totalTradedVolume,
    } : null,
  }));
  const nifty = indices?.indices?.['NIFTY 50'];
  const vix = indices?.indices?.['INDIA VIX'];
  const bnk = indices?.indices?.['NIFTY BANK'];
  return {
    symbol: chain.symbol,
    spot: chain.spot,
    expiry: chain.expiry,
    atm: chain.atm,
    pcr: chain.pcr,
    maxPain: chain.maxPain,
    atmIv: chain.atmIv,
    totals: chain.totals,
    walls: chain.walls,
    context: {
      nifty50: nifty ? { ltp: nifty.last, chgPct: nifty.percentChange } : null,
      niftyBank: bnk ? { ltp: bnk.last, chgPct: bnk.percentChange } : null,
      indiaVix: vix ? { ltp: vix.last, chgPct: vix.percentChange } : null,
    },
    nearAtmChain: nearSummary,
    dataTimestamp: chain.timestamp,
  };
}

const ANALYZE_SYSTEM = `You are OptionAI, a disciplined Indian index options analyst.

You will receive REAL live NSE option-chain data plus index context.

Rules:
1. Analyse ONLY the numbers given. Never invent prices, OI or IV.
2. NO_TRADE is a normal, frequent outcome. If setup is not clean, return NO_TRADE.
3. Use PCR, Max Pain, OI walls, ATM IV, change-in-OI shifts and spot vs walls to decide bias.
4. All prices you cite must exist in the near-ATM chain snapshot you were given.
5. Never claim probability of profit. Use the term "AI Score" (0-100).
6. Compute risk_reward as "1:X" using (target1 - entry) / (entry - stop) for long premium; for spreads use net debit vs net max profit.
7. Return STRICT JSON only. No markdown, no prose outside JSON.

Schema:
{
  "bias": "STRONG_BULLISH|BULLISH|SIDEWAYS|BEARISH|STRONG_BEARISH",
  "volatility_regime": "LOW|NORMAL|HIGH|EXTREME",
  "score": <0-100 integer>,
  "action": "TRADE" or "NO_TRADE",
  "trade": {
    "strategy": "Long Call|Long Put|Bull Call Spread|Bear Put Spread|Bull Put Spread|Bear Call Spread|Long Straddle|Long Strangle|Iron Condor",
    "instrument_label": "e.g., NIFTY 25000 CE 26-Jun",
    "legs": [{ "action":"BUY|SELL", "strike": <number>, "type":"CE|PE", "ltp": <number> }],
    "entry": <number>,
    "stop": <number>,
    "target1": <number>,
    "target2": <number>,
    "lot_size_hint": "e.g., 1 lot (75 qty)",
    "max_loss_per_lot": <number>,
    "max_profit_per_lot": <number|null>,
    "risk_reward": "1:X.X",
    "invalidation": "human readable rule"
  } | null,
  "reasoning": [ "bullet", "bullet", ... ],
  "warnings": [ "bullet", ... ],
  "key_levels": { "support": <number|null>, "resistance": <number|null> }
}

If action = NO_TRADE, trade must be null but reasoning must explain WHY no trade.`;

const COPILOT_SYSTEM = `You are OptionAI Copilot for a personal Indian options trader.

You will be given a JSON snapshot of the current market and, if available, the latest AI analysis. Answer concisely, referencing only the numbers in the snapshot.

- Never invent live values. If data is missing, say so.
- Never promise profit. Never give SEBI-regulated advice.
- Use short paragraphs and bullet points.
- If asked "why bullish/bearish", cite PCR, Max Pain, OI walls, IV and spot position vs walls.
- If asked about a position or trade you cannot see in the snapshot, ask the user to share it.`;

// ------------- ROUTES -------------
function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function routeGet(request, path) {
  if (path === 'health') return json({ ok: true, ts: Date.now() });

  if (path === 'market/indices') {
    try {
      const data = await getIndices();
      return json({ ok: true, ...data });
    } catch (e) {
      return json({ ok: false, error: e.message }, 502);
    }
  }

  if (path === 'market/option-chain') {
    const symbol = new URL(request.url).searchParams.get('symbol') || 'NIFTY';
    try {
      const data = await getOptionChain(symbol);
      return json({ ok: true, data });
    } catch (e) {
      return json({ ok: false, error: e.message }, 502);
    }
  }

  return json({ error: 'not_found', path }, 404);
}

async function routePost(request, path) {
  const body = await request.json().catch(() => ({}));

  if (path === 'ai/analyze') {
    const symbol = (body.symbol || 'NIFTY').toUpperCase();
    try {
      const [chain, indices] = await Promise.all([getOptionChain(symbol), getIndices().catch(() => null)]);
      const snapshot = summarizeChainForAI(chain, indices);
      const chat = getChat(`analyze-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, ANALYZE_SYSTEM);
      const raw = await chat.sendMessage(new UserMessage({ text: `Live snapshot (JSON):\n${JSON.stringify(snapshot)}\n\nAnalyse and return STRICT JSON per schema.` }));
      let parsed;
      try {
        const cleaned = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
        parsed = JSON.parse(cleaned);
      } catch (e) {
        return json({ ok: false, error: 'AI returned invalid JSON', raw }, 502);
      }
      return json({ ok: true, analysis: parsed, snapshot, generated_at: new Date().toISOString() });
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  if (path === 'ai/chat') {
    const message = String(body.message || '').trim();
    const sessionId = String(body.session_id || '').trim();
    const context = body.context || null;
    if (!message) return json({ error: 'message required' }, 400);
    if (!sessionId) return json({ error: 'session_id required' }, 400);
    try {
      const chat = getChat(sessionId, COPILOT_SYSTEM);
      const composed = context
        ? `Current market snapshot (JSON):\n${JSON.stringify(context).slice(0, 8000)}\n\nUser: ${message}`
        : message;
      const reply = await chat.sendMessage(new UserMessage({ text: composed }));
      return json({ ok: true, reply: String(reply), session_id: sessionId });
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  return json({ error: 'not_found', path }, 404);
}

export async function GET(request, { params }) {
  const p = (await params).path || [];
  return routeGet(request, p.join('/'));
}
export async function POST(request, { params }) {
  const p = (await params).path || [];
  return routePost(request, p.join('/'));
}
