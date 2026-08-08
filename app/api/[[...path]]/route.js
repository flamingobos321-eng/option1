import { NextResponse } from 'next/server';
import { LlmChat, UserMessage } from 'emergentintegrations';
import { MongoClient } from 'mongodb';
import { KiteConnect } from 'kiteconnect';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ------------- MONGO -------------
let mongoPromise = null;
function getMongo() {
  if (!mongoPromise) {
    const uri = process.env.MONGO_URL || 'mongodb://localhost:27017';
    mongoPromise = new MongoClient(uri).connect();
  }
  return mongoPromise;
}
async function getDb() {
  const client = await getMongo();
  return client.db(process.env.DB_NAME && process.env.DB_NAME !== 'your_database_name' ? process.env.DB_NAME : 'optionai');
}

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

// ------------- SIGNAL ENGINE (deterministic) -------------
const LOT_SIZES = { NIFTY: 75, BANKNIFTY: 15, FINNIFTY: 40 };
const INDEX_TICK_KEY = { NIFTY: 'NIFTY 50', BANKNIFTY: 'NIFTY BANK', FINNIFTY: 'NIFTY FIN SERVICE' };

function inferStep(rows) {
  const s = [];
  for (let i = 1; i < Math.min(rows.length, 25); i++) {
    const d = rows[i].strikePrice - rows[i - 1].strikePrice;
    if (d > 0) s.push(d);
  }
  s.sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] || 50;
}
function median(arr) {
  const a = arr.filter((x) => Number.isFinite(x) && x > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.floor(a.length / 2)];
}

function scoreCandidate({ side, strike, chain, indexTick, vixTick, step, lotSize }) {
  const { spot, atm, pcr, maxPain, walls, rows } = chain;
  const row = rows.find((r) => r.strikePrice === strike);
  if (!row) return null;
  const leg = side === 'CE' ? row.CE : row.PE;
  if (!leg || !leg.lastPrice || leg.lastPrice < 1) return null;

  const atmIdx = rows.findIndex((r) => r.strikePrice === atm);
  const nearRows = rows.slice(Math.max(0, atmIdx - 4), Math.min(rows.length, atmIdx + 5));
  const medVol = median(nearRows.map((r) => (side === 'CE' ? r.CE?.totalTradedVolume : r.PE?.totalTradedVolume) || 0));
  const medOi = median(nearRows.map((r) => (side === 'CE' ? r.CE?.openInterest : r.PE?.openInterest) || 0));
  const legVol = leg.totalTradedVolume || 0;
  const legOi = leg.openInterest || 0;
  const chgPct = indexTick?.percentChange || 0;

  const bull = [spot > (maxPain || spot), pcr != null && pcr > 1.1, chgPct > 0.1].filter(Boolean).length;
  const bear = [spot < (maxPain || spot), pcr != null && pcr < 0.9, chgPct < -0.1].filter(Boolean).length;

  const b = {};
  // Trend (20)
  b.trend = side === 'CE'
    ? (bull >= 2 ? 20 : bull === 1 ? 12 : 4)
    : (bear >= 2 ? 20 : bear === 1 ? 12 : 4);

  // Momentum (15)
  const abs = Math.abs(chgPct);
  const momOk = (side === 'CE' && chgPct > 0) || (side === 'PE' && chgPct < 0);
  b.momentum = momOk ? Math.min(15, Math.round(5 + abs * 12)) : Math.max(2, Math.round(6 - abs * 5));

  // VWAP proxy (10) — pivot = (H+L+C)/3 when intraday range known
  const H = indexTick?.high, L = indexTick?.low;
  let vwapOk = null;
  if (H && L) {
    const pivot = (H + L + spot) / 3;
    const above = spot >= pivot;
    vwapOk = (side === 'CE' && above) || (side === 'PE' && !above);
    b.vwap = vwapOk ? 10 : 3;
  } else b.vwap = 5;

  // Volume (10)
  const vr = medVol > 0 ? legVol / medVol : 0;
  b.volume = vr >= 2 ? 10 : vr >= 1 ? 7 : vr >= 0.5 ? 4 : 2;

  // OI (15)
  let oi = 0;
  const resDist = (walls.resistance.strike ?? spot) - spot;
  const supDist = spot - (walls.support.strike ?? spot);
  if (side === 'CE') {
    if (resDist > step && resDist <= step * 4) oi += 10;
    else if (resDist > step * 4) oi += 6;
    else if (resDist > 0) oi += 4;
    if (walls.support.oi > medOi * 1.8) oi += 5;
  } else {
    if (supDist > step && supDist <= step * 4) oi += 10;
    else if (supDist > step * 4) oi += 6;
    else if (supDist > 0) oi += 4;
    if (walls.resistance.oi > medOi * 1.8) oi += 5;
  }
  b.oi = Math.min(15, oi);

  // PCR (5)
  if (pcr == null) b.pcr = 2;
  else if (side === 'CE') b.pcr = pcr >= 1.0 && pcr <= 1.4 ? 5 : pcr > 0.9 ? 3 : 1;
  else b.pcr = pcr >= 0.6 && pcr <= 0.9 ? 5 : pcr < 1.0 ? 3 : 1;

  // IV proxy via VIX (10) — low VIX = cheap premium = good for long premium buy
  const vix = vixTick?.last;
  if (vix == null) b.iv = 5;
  else if (vix < 13) b.iv = 10;
  else if (vix < 16) b.iv = 7;
  else if (vix < 20) b.iv = 4;
  else b.iv = 2;

  // Liquidity (5)
  const liq = (legOi > medOi * 1.5 ? 3 : legOi > medOi * 0.7 ? 2 : 1) + (legVol > medVol ? 2 : legVol > 0 ? 1 : 0);
  b.liquidity = Math.min(5, liq);

  // R:R (10) — targets designed at 1:2, penalise if strike far OTM (thin premium)
  const rrPenalty = Math.abs(strike - atm) / (step * 2);
  b.rr = Math.max(4, Math.round(10 - rrPenalty * 2));

  const total = Object.values(b).reduce((x, y) => x + y, 0);

  // Trade parameters
  const ltp = +leg.lastPrice;
  const entryLow = +(ltp * 0.97).toFixed(1);
  const entryHigh = +(ltp * 1.03).toFixed(1);
  const stop = +(ltp * 0.75).toFixed(1);
  const target1 = +(ltp * 1.5).toFixed(1);
  const target2 = +(ltp * 2.0).toFixed(1);
  const maxLoss = Math.round((ltp - stop) * lotSize);
  const rr = ((target1 - ltp) / (ltp - stop));
  const invalidation = side === 'CE'
    ? `${chain.symbol} closes below ${walls.support.strike}`
    : `${chain.symbol} closes above ${walls.resistance.strike}`;

  // Deterministic reasoning bullets
  const reasoning = [];
  if (b.trend >= 15) reasoning.push(`${side === 'CE' ? 'Bullish' : 'Bearish'} bias: spot ${spot} ${side === 'CE' ? 'above' : 'below'} Max Pain ${maxPain}, PCR ${pcr}`);
  else if (b.trend >= 10) reasoning.push(`Mild ${side === 'CE' ? 'bullish' : 'bearish'} bias from Max Pain / PCR mix`);
  if (b.momentum >= 10) reasoning.push(`Index momentum ${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}% aligns with ${side}`);
  if (vwapOk === true) reasoning.push(`Spot ${side === 'CE' ? 'above' : 'below'} intraday pivot — direction confirmed`);
  if (b.volume >= 7) reasoning.push(`Volume expansion at ${strike} ${side} (${legVol.toLocaleString('en-IN')} contracts)`);
  if (b.oi >= 10) reasoning.push(side === 'CE'
    ? `Room to ${walls.resistance.strike} resistance (${(resDist).toFixed(0)} pts); Put wall ${walls.support.strike} anchors downside`
    : `Room to ${walls.support.strike} support (${(supDist).toFixed(0)} pts); Call wall ${walls.resistance.strike} caps upside`);
  if (b.pcr >= 4) reasoning.push(`PCR ${pcr} sits in ${side === 'CE' ? 'bullish' : 'bearish'} sweet spot`);
  if (b.iv >= 7) reasoning.push(`India VIX ${vix?.toFixed?.(2)} — premium not expensive for long ${side}`);
  else if (b.iv <= 3) reasoning.push(`⚠ India VIX ${vix?.toFixed?.(2)} — premium elevated`);
  if (b.liquidity >= 4) reasoning.push(`Good liquidity — OI ${legOi.toLocaleString('en-IN')}, Vol ${legVol.toLocaleString('en-IN')}`);

  const warnings = [];
  if (legVol === 0) warnings.push('Zero volume this session — liquidity risk');
  if (legOi < medOi * 0.3) warnings.push('OI is below median for this expiry — thin market');
  if (ltp < 5) warnings.push('Premium too low — high theta bleed risk');
  if (rr < 1.5) warnings.push(`R:R only 1:${rr.toFixed(1)} — below preferred 1:2`);

  return {
    symbol: chain.symbol, side, strike, expiry: chain.expiry,
    strikeLabel: `${chain.symbol} ${strike} ${side}`,
    ltp,
    entry: { low: entryLow, high: entryHigh },
    stop, target1, target2, maxLoss, lotSize,
    riskReward: `1:${rr.toFixed(1)}`,
    riskRewardNum: +rr.toFixed(2),
    score: total, breakdown: b,
    reasoning, warnings,
    invalidation,
    context: {
      spot, atm, pcr, maxPain,
      resistance: walls.resistance.strike, resistanceOi: walls.resistance.oi,
      support: walls.support.strike, supportOi: walls.support.oi,
      vix: vixTick?.last ?? null, indexChgPct: chgPct,
    },
    leg: { openInterest: legOi, volume: legVol },
  };
}

function priorityOf(score) {
  if (score >= 90) return 'VERY_STRONG';
  if (score >= 80) return 'STRONG';
  if (score >= 75) return 'MODERATE';
  return 'NO_TRADE';
}

async function computeSignalForSymbol(symbol, indices) {
  const chain = await getOptionChain(symbol);
  const step = inferStep(chain.rows);
  const atmIdx = chain.rows.findIndex((r) => r.strikePrice === chain.atm);
  const lotSize = LOT_SIZES[symbol] || 1;
  const indexTick = indices?.indices?.[INDEX_TICK_KEY[symbol]];
  const vixTick = indices?.indices?.['INDIA VIX'];

  const cands = [];
  for (const off of [-2, -1, 0, 1, 2]) {
    const idx = atmIdx + off;
    if (idx < 0 || idx >= chain.rows.length) continue;
    const strike = chain.rows[idx].strikePrice;
    for (const side of ['CE', 'PE']) {
      const c = scoreCandidate({ side, strike, chain, indexTick, vixTick, step, lotSize });
      if (c) cands.push(c);
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0] || null;
  const priority = best ? priorityOf(best.score) : 'NO_TRADE';
  const action = priority === 'NO_TRADE' ? 'NO_TRADE' : 'TRADE';

  const noTradeReasons = [];
  if (!best) noTradeReasons.push('No viable candidates found in near-ATM strikes');
  else if (action === 'NO_TRADE') {
    noTradeReasons.push(`Top score ${best.score}/100 is below 75 threshold`);
    if (best.breakdown.trend < 10) noTradeReasons.push('Direction bias inconclusive');
    if (best.breakdown.momentum < 8) noTradeReasons.push('Momentum too weak');
    if (best.breakdown.oi < 8) noTradeReasons.push('No clear OI structure supports either side');
    noTradeReasons.push(`Wait for underlying above ${chain.walls.resistance.strike} or below ${chain.walls.support.strike}`);
  }

  return {
    symbol,
    action, priority,
    best,
    alternatives: cands.slice(1, 4),
    noTradeReasons,
    chainSummary: {
      spot: chain.spot, expiry: chain.expiry, atm: chain.atm,
      pcr: chain.pcr, maxPain: chain.maxPain,
      resistance: chain.walls.resistance, support: chain.walls.support,
    },
    indexTick: indexTick || null,
    timestamp: new Date().toISOString(),
  };
}

async function scanAll(symbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY']) {
  const indices = await getIndices().catch(() => null);
  const results = await Promise.allSettled(symbols.map((s) => computeSignalForSymbol(s, indices)));
  const perSymbol = [];
  const errors = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') perSymbol.push(r.value);
    else errors.push({ symbol: symbols[i], error: r.reason?.message || String(r.reason) });
  }
  // Rank by best score across symbols (NO_TRADE => 0 for ranking)
  const ranked = [...perSymbol].sort((a, b) => (b.best?.score || 0) - (a.best?.score || 0));
  const bestOverall = ranked.find((r) => r.action === 'TRADE') || ranked[0] || null;

  // Persist meaningful signals (score >= 60 or state change)
  try { await persistSignals(perSymbol); } catch (e) { /* non-fatal */ }

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    indices: indices?.indices || {},
    perSymbol,
    ranked,
    bestOverall,
    errors,
  };
}

async function persistSignals(perSymbol) {
  const db = await getDb();
  const col = db.collection('signal_history');
  const now = new Date();
  for (const s of perSymbol) {
    const key = s.best ? `${s.symbol}-${s.best.side}-${s.best.strike}` : `${s.symbol}-NO_TRADE`;
    const score = s.best?.score || 0;
    const prev = await col.findOne({ symbol: s.symbol }, { sort: { created_at: -1 } });

    // Decide if we insert a new row (material change) or just update last one
    let status = 'NEW';
    let insertNew = true;
    if (prev) {
      const sameKey = prev.key === key;
      const scoreDelta = Math.abs((prev.score || 0) - score);
      if (sameKey && scoreDelta < 5) {
        // No material change → update
        insertNew = false;
        if (score < 65 && (prev.score || 0) >= 75) status = 'WEAKENING';
        else if (score >= 75) status = 'ACTIVE';
        else status = prev.status || 'ACTIVE';
        await col.updateOne({ _id: prev._id }, { $set: { updated_at: now, score, status } });
      } else if (sameKey && scoreDelta >= 5) {
        status = score > (prev.score || 0) ? 'STRENGTHENING' : 'WEAKENING';
      } else {
        // Different contract or NO_TRADE toggle
        if (prev.action === 'TRADE') {
          await col.updateOne({ _id: prev._id }, { $set: { status: 'INVALIDATED', updated_at: now } });
        }
        status = 'NEW';
      }
    }
    if (insertNew) {
      await col.insertOne({
        key, symbol: s.symbol, action: s.action, priority: s.priority,
        side: s.best?.side || null, strike: s.best?.strike || null, expiry: s.best?.expiry || null,
        score, status,
        best: s.best || null,
        chainSummary: s.chainSummary,
        created_at: now, updated_at: now,
      });
    }
  }
}

async function getSignalHistory(limit = 20) {
  const db = await getDb();
  const col = db.collection('signal_history');
  const rows = await col.find({}).sort({ created_at: -1 }).limit(limit).toArray();
  return rows.map((r) => ({ ...r, _id: String(r._id) }));
}

// ------------- BROKER: ZERODHA KITE -------------
const KITE = {
  API_KEY: process.env.KITE_API_KEY,
  API_SECRET: process.env.KITE_API_SECRET,
  REDIRECT: process.env.KITE_REDIRECT_URL,
};

function newKiteClient(withToken = null) {
  const k = new KiteConnect({ api_key: KITE.API_KEY });
  if (withToken) k.setAccessToken(withToken);
  return k;
}

async function getBrokerToken(broker = 'kite') {
  const db = await getDb();
  return db.collection('broker_tokens').findOne({ broker });
}
async function saveBrokerToken(broker, data) {
  const db = await getDb();
  await db.collection('broker_tokens').updateOne(
    { broker },
    { $set: { broker, ...data, updated_at: new Date() } },
    { upsert: true }
  );
}
async function clearBrokerToken(broker) {
  const db = await getDb();
  await db.collection('broker_tokens').deleteOne({ broker });
}

async function requireKite() {
  const doc = await getBrokerToken('kite');
  if (!doc?.access_token) throw new Error('Kite not connected');
  return { kite: newKiteClient(doc.access_token), token: doc };
}

// Instrument cache (NFO options universe)
let instrumentCache = { data: null, ts: 0 };
async function getNfoInstruments(kite) {
  const age = Date.now() - instrumentCache.ts;
  if (instrumentCache.data && age < 12 * 60 * 60 * 1000) return instrumentCache.data;
  const list = await kite.getInstruments('NFO');
  instrumentCache = { data: list, ts: Date.now() };
  return list;
}

async function resolveTradingsymbol(kite, { name, expiry, strike, type }) {
  const list = await getNfoInstruments(kite);
  const targetIso = new Date(parseNseDate(expiry)).toISOString().slice(0, 10);
  const wantedName = String(name).toUpperCase();
  const wantedType = String(type).toUpperCase();
  const match = list.find((i) => {
    if ((i.name || '').toUpperCase() !== wantedName) return false;
    if ((i.instrument_type || '').toUpperCase() !== wantedType) return false;
    const iso = i.expiry instanceof Date ? i.expiry.toISOString().slice(0, 10) : String(i.expiry || '').slice(0, 10);
    if (iso !== targetIso) return false;
    return Number(i.strike) === Number(strike);
  });
  if (!match) throw new Error(`Instrument not found: ${wantedName} ${expiry} ${strike} ${wantedType}`);
  return match;
}

async function placeBrokerOrder(orderReq, idempotencyKey) {
  const db = await getDb();
  const ordersCol = db.collection('orders');

  // Idempotency check
  if (idempotencyKey) {
    const existing = await ordersCol.findOne({ idempotency_key: idempotencyKey });
    if (existing) {
      return { ok: true, duplicate: true, order_id: existing.order_id, message: 'Idempotent replay — order already submitted', existing };
    }
  }

  const { kite } = await requireKite();

  // Resolve tradingsymbol from our signal fields
  const inst = await resolveTradingsymbol(kite, {
    name: orderReq.symbol,
    expiry: orderReq.expiry,
    strike: orderReq.strike,
    type: orderReq.type, // 'CE' | 'PE'
  });

  const qty = Number(orderReq.quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('Invalid quantity');
  if (inst.lot_size && qty % inst.lot_size !== 0) {
    throw new Error(`Quantity ${qty} must be a multiple of lot size ${inst.lot_size} for ${inst.tradingsymbol}`);
  }

  const params = {
    exchange: 'NFO',
    tradingsymbol: inst.tradingsymbol,
    transaction_type: orderReq.side === 'SELL' ? 'SELL' : 'BUY',
    order_type: orderReq.orderType || 'MARKET',
    product: orderReq.product || 'MIS',
    quantity: qty,
    validity: 'DAY',
  };
  if ((orderReq.orderType || 'MARKET') === 'LIMIT') {
    if (!orderReq.price) throw new Error('LIMIT order requires price');
    params.price = Number(orderReq.price);
  }

  // Preflight record
  const preflight = {
    idempotency_key: idempotencyKey || null,
    broker: 'kite',
    status: 'SUBMITTING',
    params,
    tradingsymbol: inst.tradingsymbol,
    signal_ref: orderReq.signal_ref || null,
    created_at: new Date(),
  };
  const ins = await ordersCol.insertOne(preflight);

  try {
    const resp = await kite.placeOrder('regular', params);
    await ordersCol.updateOne(
      { _id: ins.insertedId },
      { $set: { status: 'SUBMITTED', order_id: resp.order_id, broker_response: resp, submitted_at: new Date() } }
    );
    return { ok: true, order_id: resp.order_id, tradingsymbol: inst.tradingsymbol, params };
  } catch (e) {
    await ordersCol.updateOne(
      { _id: ins.insertedId },
      { $set: { status: 'FAILED', error: e.message, failed_at: new Date() } }
    );
    throw e;
  }
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

  if (path === 'signal/scan') {
    const sp = new URL(request.url).searchParams;
    const symbolsParam = sp.get('symbols');
    const symbols = symbolsParam ? symbolsParam.split(',').map((s) => s.trim().toUpperCase()) : ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];
    try {
      const data = await scanAll(symbols);
      return json(data);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  if (path === 'signal/history') {
    const limit = Math.min(50, +new URL(request.url).searchParams.get('limit') || 20);
    try {
      const rows = await getSignalHistory(limit);
      return json({ ok: true, rows });
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  // ----- BROKER: KITE -----
  if (path === 'broker/kite/login-url') {
    if (!KITE.API_KEY) return json({ ok: false, error: 'Kite API key not configured' }, 500);
    const kite = newKiteClient();
    const url = kite.getLoginURL();
    return json({ ok: true, url });
  }

  if (path === 'broker/kite/callback') {
    // Kite redirects here with ?request_token=...&action=login&status=success
    const sp = new URL(request.url).searchParams;
    const rt = sp.get('request_token');
    const status = sp.get('status');
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
    if (status !== 'success' || !rt) {
      return NextResponse.redirect(`${baseUrl}/?broker=failed&reason=${encodeURIComponent(status || 'no_token')}`);
    }
    try {
      const kite = newKiteClient();
      const sess = await kite.generateSession(rt, KITE.API_SECRET);
      // Persist: access_token + user info; NEVER log token
      await saveBrokerToken('kite', {
        access_token: sess.access_token,
        public_token: sess.public_token,
        user_id: sess.user_id,
        user_name: sess.user_name,
        user_shortname: sess.user_shortname,
        email: sess.email,
        broker_name: sess.broker,
        connected_at: new Date(),
      });
      return NextResponse.redirect(`${baseUrl}/?broker=connected`);
    } catch (e) {
      return NextResponse.redirect(`${baseUrl}/?broker=failed&reason=${encodeURIComponent(e.message).slice(0, 200)}`);
    }
  }

  if (path === 'broker/kite/status') {
    const doc = await getBrokerToken('kite');
    if (!doc?.access_token) return json({ ok: true, connected: false });
    // Best effort: verify by calling getProfile (cheap)
    try {
      const kite = newKiteClient(doc.access_token);
      const profile = await kite.getProfile();
      return json({
        ok: true, connected: true, broker: 'kite',
        user: {
          user_id: profile.user_id, user_name: profile.user_name,
          email: profile.email, broker: profile.broker,
        },
        connected_at: doc.connected_at,
      });
    } catch (e) {
      // Token likely expired (daily 6 AM IST invalidation)
      return json({ ok: true, connected: false, reason: 'token_invalid', detail: e.message });
    }
  }

  if (path === 'broker/kite/funds') {
    try {
      const { kite } = await requireKite();
      const m = await kite.getMargins();
      return json({ ok: true, margins: m });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  if (path === 'broker/kite/positions') {
    try {
      const { kite } = await requireKite();
      const p = await kite.getPositions();
      return json({ ok: true, positions: p });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  if (path === 'broker/kite/orders') {
    try {
      const { kite } = await requireKite();
      const o = await kite.getOrders();
      return json({ ok: true, orders: o });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  return json({ error: 'not_found', path }, 404);
}

async function routePost(request, path) {
  const body = await request.json().catch(() => ({}));

  // ----- BROKER: KITE -----
  if (path === 'broker/kite/disconnect') {
    await clearBrokerToken('kite');
    return json({ ok: true });
  }

  if (path === 'broker/kite/place-order') {
    // Server-side validation before ANY broker call.
    // NOTE: risk engine (daily-loss cap, position sizing) is Phase 2. This endpoint currently
    // performs only sanity checks + broker submission. DO NOT REMOVE these checks.
    try {
      const { symbol, side, strike, type, expiry, quantity, orderType, price, product, idempotency_key, signal_ref } = body;
      if (!symbol || !side || !strike || !type || !expiry || !quantity) {
        return json({ ok: false, error: 'Missing required fields (symbol, side, strike, type, expiry, quantity)' }, 400);
      }
      if (!['BUY', 'SELL'].includes(side)) return json({ ok: false, error: 'side must be BUY or SELL' }, 400);
      if (!['CE', 'PE'].includes(type)) return json({ ok: false, error: 'type must be CE or PE' }, 400);
      const idem = idempotency_key || crypto.createHash('sha256').update(`${symbol}|${expiry}|${strike}|${type}|${side}|${quantity}|${signal_ref || ''}|${Date.now()}`).digest('hex').slice(0, 32);
      const out = await placeBrokerOrder(
        { symbol, side, strike, type, expiry, quantity, orderType, price, product, signal_ref },
        idem
      );
      return json({ ...out, idempotency_key: idem });
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

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
      const db = await getDb();
      const col = db.collection('chat_sessions');
      const doc = await col.findOne({ session_id: sessionId });
      const history = Array.isArray(doc?.messages) ? doc.messages : [];
      const initialMessages = [{ role: 'system', content: COPILOT_SYSTEM }, ...history];

      const chat = new LlmChat(process.env.EMERGENT_LLM_KEY, sessionId, COPILOT_SYSTEM, initialMessages)
        .withModel('anthropic', 'claude-sonnet-4-5-20250929')
        .withParams({ temperature: 0.2, max_tokens: 1500 });

      const composed = context
        ? `[Live market snapshot JSON: ${JSON.stringify(context).slice(0, 6000)}]\n\n${message}`
        : message;

      const reply = String(await chat.sendMessage(new UserMessage({ text: composed })));

      // Persist ONLY the raw user question + assistant reply so future turns are not
      // polluted by stale snapshot JSON.
      await col.updateOne(
        { session_id: sessionId },
        {
          $set: { session_id: sessionId, updated_at: new Date() },
          $setOnInsert: { created_at: new Date() },
          $push: { messages: { $each: [
            { role: 'user', content: message },
            { role: 'assistant', content: reply },
          ] } },
        },
        { upsert: true }
      );

      return json({ ok: true, reply, session_id: sessionId });
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
