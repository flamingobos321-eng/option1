'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, BarChart3, Bot, Brain, ChevronRight,
  CircleDot, Gauge, LayoutDashboard, LineChart, ListOrdered, Loader2,
  Radio, Send, Settings, ShieldAlert, Sparkles, TrendingDown, TrendingUp,
  Wallet, Zap
} from 'lucide-react'

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY']

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function compact(n) {
  if (n === null || n === undefined) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e7) return (n / 1e7).toFixed(2) + 'Cr'
  if (abs >= 1e5) return (n / 1e5).toFixed(2) + 'L'
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

function useIndices() {
  const [data, setData] = useState(null)
  const [stale, setStale] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const r = await fetch('/api/market/indices', { cache: 'no-store' })
        const j = await r.json()
        if (!alive) return
        if (j.ok) { setData(j); setStale(false); setErr(null) }
        else { setStale(true); setErr(j.error) }
      } catch (e) { setStale(true); setErr(e.message) }
    }
    tick()
    const id = setInterval(tick, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return { data, stale, err }
}

function useOptionChain(symbol) {
  const [chain, setChain] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      try {
        const r = await fetch(`/api/market/option-chain?symbol=${symbol}`, { cache: 'no-store' })
        const j = await r.json()
        if (!alive) return
        if (j.ok) { setChain(j.data); setErr(null) } else { setErr(j.error) }
      } catch (e) { if (alive) setErr(e.message) }
      finally { if (alive) setLoading(false) }
    }
    load()
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => { alive = false; clearInterval(id) }
  }, [symbol, tick])
  return { chain, loading, err, refresh: () => setTick(t => t + 1) }
}

function IndexTile({ label, tick }) {
  const up = tick?.percentChange >= 0
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-r border-slate-800/60 min-w-[180px]">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
        <span className="font-mono text-base font-semibold text-slate-100">{tick ? fmt(tick.last) : '—'}</span>
      </div>
      {tick && (
        <div className={`flex items-center gap-1 text-xs font-mono ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
          {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {fmt(tick.change)} ({fmt(tick.percentChange)}%)
        </div>
      )}
    </div>
  )
}

function StatusPill({ label, state, color }) {
  const colors = {
    green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    red: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    slate: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  }
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1 rounded border text-[10px] uppercase tracking-wider font-mono ${colors[color]}`}>
      <CircleDot className="w-3 h-3" />
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold">{state}</span>
    </div>
  )
}

function Sidebar({ active, onSelect }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'chain', label: 'Option Chain', icon: BarChart3 },
    { id: 'ai', label: 'AI Analysis', icon: Brain },
    { id: 'copilot', label: 'Copilot', icon: Bot },
    { id: 'positions', label: 'Positions', icon: Wallet, locked: true },
    { id: 'orders', label: 'Orders', icon: ListOrdered, locked: true },
    { id: 'journal', label: 'Journal', icon: LineChart, locked: true },
    { id: 'strategies', label: 'Strategies', icon: Sparkles, locked: true },
    { id: 'settings', label: 'Settings', icon: Settings, locked: true },
  ]
  return (
    <aside className="w-56 border-r border-slate-800/60 bg-slate-950/40 flex flex-col">
      <div className="px-4 py-4 border-b border-slate-800/60 flex items-center gap-2">
        <div className="w-8 h-8 rounded-md bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center">
          <Zap className="w-4 h-4 text-slate-950" />
        </div>
        <div>
          <div className="text-sm font-bold text-slate-100">OptionAI</div>
          <div className="text-[9px] uppercase tracking-widest text-slate-500">Terminal · v0.1</div>
        </div>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-1">
        {items.map(it => {
          const Icon = it.icon
          const isActive = active === it.id
          return (
            <button
              key={it.id}
              disabled={it.locked}
              onClick={() => !it.locked && onSelect(it.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition ${
                isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : it.locked ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">{it.label}</span>
              {it.locked && <Badge variant="outline" className="text-[8px] px-1 py-0 h-4 border-slate-700 text-slate-500">P2</Badge>}
            </button>
          )
        })}
      </nav>
      <div className="p-3 border-t border-slate-800/60 space-y-2">
        <div className="text-[9px] uppercase tracking-widest text-slate-500 px-1">Trading Mode</div>
        <div className="flex items-center justify-between px-2 py-1.5 bg-amber-500/5 border border-amber-500/20 rounded text-xs">
          <span className="text-amber-400">ANALYSIS</span>
          <ShieldAlert className="w-3 h-3 text-amber-400" />
        </div>
        <Button size="sm" variant="destructive" className="w-full h-8 text-xs font-bold" disabled>
          <AlertTriangle className="w-3 h-3 mr-1" /> KILL SWITCH
        </Button>
      </div>
    </aside>
  )
}

function OptionChainTable({ chain }) {
  if (!chain) return null
  const { rows, atm, walls } = chain
  const atmIdx = rows.findIndex(r => r.strikePrice === atm)
  const visible = rows.slice(Math.max(0, atmIdx - 8), Math.min(rows.length, atmIdx + 9))
  const maxOi = Math.max(1, ...rows.flatMap(r => [(r.CE?.openInterest) || 0, (r.PE?.openInterest) || 0]))
  return (
    <div className="overflow-auto rounded-md border border-slate-800/60">
      <table className="w-full text-xs font-mono">
        <thead className="sticky top-0 bg-slate-900/95 backdrop-blur text-[10px] uppercase tracking-wider text-slate-500">
          <tr className="border-b border-slate-800">
            <th className="px-2 py-2 text-right">OI</th>
            <th className="px-2 py-2 text-right">ChgOI</th>
            <th className="px-2 py-2 text-right">Vol</th>
            <th className="px-2 py-2 text-right">IV</th>
            <th className="px-2 py-2 text-right text-emerald-400">CE LTP</th>
            <th className="px-3 py-2 text-center text-slate-300">STRIKE</th>
            <th className="px-2 py-2 text-left text-rose-400">PE LTP</th>
            <th className="px-2 py-2 text-left">IV</th>
            <th className="px-2 py-2 text-left">Vol</th>
            <th className="px-2 py-2 text-left">ChgOI</th>
            <th className="px-2 py-2 text-left">OI</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(r => {
            const ce = r.CE || {}
            const pe = r.PE || {}
            const isAtm = r.strikePrice === atm
            const isResistance = r.strikePrice === walls?.resistance?.strike
            const isSupport = r.strikePrice === walls?.support?.strike
            const ceItm = r.strikePrice < chain.spot
            const peItm = r.strikePrice > chain.spot
            const ceOiPct = ((ce.openInterest || 0) / maxOi) * 100
            const peOiPct = ((pe.openInterest || 0) / maxOi) * 100
            return (
              <tr key={r.strikePrice} className={`border-b border-slate-800/40 hover:bg-slate-800/30 ${isAtm ? 'bg-emerald-500/5' : ''}`}>
                <td className={`px-2 py-1.5 text-right relative ${ceItm ? 'bg-slate-800/20' : ''}`}>
                  <div className="absolute inset-y-0 right-0 bg-amber-500/10" style={{ width: `${ceOiPct}%` }} />
                  <span className="relative">{compact(ce.openInterest)}</span>
                </td>
                <td className={`px-2 py-1.5 text-right ${ceItm ? 'bg-slate-800/20' : ''} ${(ce.changeinOpenInterest||0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{compact(ce.changeinOpenInterest)}</td>
                <td className={`px-2 py-1.5 text-right ${ceItm ? 'bg-slate-800/20' : ''} text-slate-400`}>{compact(ce.totalTradedVolume)}</td>
                <td className={`px-2 py-1.5 text-right ${ceItm ? 'bg-slate-800/20' : ''} text-slate-400`}>{ce.impliedVolatility ? fmt(ce.impliedVolatility, 1) : '—'}</td>
                <td className={`px-2 py-1.5 text-right font-semibold ${ceItm ? 'bg-slate-800/20' : ''} text-emerald-300`}>{ce.lastPrice ? fmt(ce.lastPrice) : '—'}</td>
                <td className={`px-3 py-1.5 text-center font-bold ${isAtm ? 'text-emerald-400' : 'text-slate-200'}`}>
                  <div className="flex items-center justify-center gap-1">
                    {isSupport && <span title="Put OI wall (support)" className="w-1.5 h-1.5 rounded-full bg-rose-400" />}
                    {r.strikePrice}
                    {isResistance && <span title="Call OI wall (resistance)" className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                  </div>
                </td>
                <td className={`px-2 py-1.5 text-left font-semibold ${peItm ? 'bg-slate-800/20' : ''} text-rose-300`}>{pe.lastPrice ? fmt(pe.lastPrice) : '—'}</td>
                <td className={`px-2 py-1.5 text-left ${peItm ? 'bg-slate-800/20' : ''} text-slate-400`}>{pe.impliedVolatility ? fmt(pe.impliedVolatility, 1) : '—'}</td>
                <td className={`px-2 py-1.5 text-left ${peItm ? 'bg-slate-800/20' : ''} text-slate-400`}>{compact(pe.totalTradedVolume)}</td>
                <td className={`px-2 py-1.5 text-left ${peItm ? 'bg-slate-800/20' : ''} ${(pe.changeinOpenInterest||0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{compact(pe.changeinOpenInterest)}</td>
                <td className={`px-2 py-1.5 text-left relative ${peItm ? 'bg-slate-800/20' : ''}`}>
                  <div className="absolute inset-y-0 left-0 bg-teal-500/10" style={{ width: `${peOiPct}%` }} />
                  <span className="relative">{compact(pe.openInterest)}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ChainSummary({ chain }) {
  if (!chain) return null
  const bias = chain.pcr > 1.2 ? 'BULLISH' : chain.pcr < 0.8 ? 'BEARISH' : 'NEUTRAL'
  const biasColor = bias === 'BULLISH' ? 'text-emerald-400' : bias === 'BEARISH' ? 'text-rose-400' : 'text-slate-300'
  const items = [
    { label: 'Spot', val: fmt(chain.spot), sub: chain.symbol },
    { label: 'ATM', val: chain.atm, sub: chain.expiry },
    { label: 'PCR', val: chain.pcr ?? '—', sub: bias, subColor: biasColor },
    { label: 'Max Pain', val: chain.maxPain ?? '—', sub: chain.maxPain && chain.spot ? `${chain.spot > chain.maxPain ? '+' : ''}${fmt(chain.spot - chain.maxPain, 0)}` : '' },
    { label: 'ATM IV', val: chain.atmIv ? fmt(chain.atmIv, 1) + '%' : '—', sub: 'implied vol' },
    { label: 'Resistance', val: chain.walls?.resistance?.strike ?? '—', sub: `CE OI ${compact(chain.walls?.resistance?.oi)}`, subColor: 'text-amber-400' },
    { label: 'Support', val: chain.walls?.support?.strike ?? '—', sub: `PE OI ${compact(chain.walls?.support?.oi)}`, subColor: 'text-rose-400' },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
      {items.map(it => (
        <div key={it.label} className="border border-slate-800/60 rounded-md px-3 py-2 bg-slate-900/40">
          <div className="text-[9px] uppercase tracking-widest text-slate-500">{it.label}</div>
          <div className="text-lg font-mono font-bold text-slate-100">{it.val}</div>
          <div className={`text-[10px] font-mono ${it.subColor || 'text-slate-500'}`}>{it.sub}</div>
        </div>
      ))}
    </div>
  )
}

function TradeCard({ analysis }) {
  if (!analysis) return null
  const a = analysis
  const isTrade = a.action === 'TRADE' && a.trade
  const biasColor = a.bias?.includes('BULLISH') ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5'
    : a.bias?.includes('BEARISH') ? 'text-rose-400 border-rose-500/30 bg-rose-500/5'
    : 'text-slate-300 border-slate-700 bg-slate-800/30'
  const scoreColor = a.score >= 75 ? 'text-emerald-400' : a.score >= 55 ? 'text-amber-400' : 'text-rose-400'

  return (
    <Card className="bg-slate-900/50 border-slate-800/70 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-bold text-slate-100">AI Setup</span>
          <Badge className={`${biasColor} font-mono border`}>{a.bias?.replace('_', ' ')}</Badge>
          <Badge variant="outline" className="border-slate-700 text-slate-400 font-mono">VOL: {a.volatility_regime}</Badge>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-widest text-slate-500">AI Score</div>
          <div className={`text-2xl font-mono font-bold ${scoreColor}`}>{a.score}<span className="text-slate-600 text-sm">/100</span></div>
        </div>
      </div>

      {isTrade ? (
        <>
          <div className="bg-slate-950/60 border border-emerald-500/20 rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Strategy</div>
                <div className="text-base font-bold text-emerald-400">{a.trade.strategy}</div>
              </div>
              <Badge className="bg-emerald-500 hover:bg-emerald-500 text-slate-950 font-bold text-xs">
                {a.trade.instrument_label}
              </Badge>
            </div>
            <Separator className="bg-slate-800" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-sm">
              <div><div className="text-[9px] uppercase text-slate-500">Entry</div><div className="text-slate-100 font-semibold">₹{fmt(a.trade.entry)}</div></div>
              <div><div className="text-[9px] uppercase text-slate-500">Stop</div><div className="text-rose-400 font-semibold">₹{fmt(a.trade.stop)}</div></div>
              <div><div className="text-[9px] uppercase text-slate-500">Target 1</div><div className="text-emerald-400 font-semibold">₹{fmt(a.trade.target1)}</div></div>
              <div><div className="text-[9px] uppercase text-slate-500">Target 2</div><div className="text-emerald-400 font-semibold">₹{fmt(a.trade.target2)}</div></div>
              <div><div className="text-[9px] uppercase text-slate-500">Max Loss / lot</div><div className="text-rose-300">₹{compact(a.trade.max_loss_per_lot)}</div></div>
              <div><div className="text-[9px] uppercase text-slate-500">Max Profit / lot</div><div className="text-emerald-300">{a.trade.max_profit_per_lot != null ? '₹' + compact(a.trade.max_profit_per_lot) : 'Open'}</div></div>
              <div><div className="text-[9px] uppercase text-slate-500">R:R</div><div className="text-slate-100">{a.trade.risk_reward}</div></div>
              <div><div className="text-[9px] uppercase text-slate-500">Size hint</div><div className="text-slate-100">{a.trade.lot_size_hint}</div></div>
            </div>
            <Separator className="bg-slate-800" />
            <div className="space-y-1.5">
              <div className="text-[9px] uppercase tracking-widest text-slate-500">Legs</div>
              <div className="flex flex-wrap gap-2">
                {(a.trade.legs || []).map((l, i) => (
                  <div key={i} className={`px-2 py-1 rounded text-xs font-mono border ${l.action === 'BUY' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' : 'text-rose-400 border-rose-500/30 bg-rose-500/5'}`}>
                    {l.action} {l.strike} {l.type} @ ₹{fmt(l.ltp)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Why this trade</div>
              <ul className="space-y-1 text-xs text-slate-300">
                {(a.reasoning || []).map((r, i) => (
                  <li key={i} className="flex gap-2"><ChevronRight className="w-3 h-3 mt-0.5 text-emerald-400 shrink-0" />{r}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Invalidation</div>
                <div className="text-xs text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5 font-mono">
                  {a.trade.invalidation}
                </div>
              </div>
              {a.warnings?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Warnings</div>
                  <ul className="space-y-1 text-xs text-rose-300">
                    {a.warnings.map((w, i) => <li key={i} className="flex gap-2"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold" disabled>
              CONFIRM TRADE <Badge variant="outline" className="ml-2 border-slate-950/40 text-slate-950 text-[9px]">P2 · Broker</Badge>
            </Button>
            <Button variant="outline" className="border-slate-700 text-slate-300" onClick={() => navigator.clipboard.writeText(JSON.stringify(a.trade, null, 2))}>
              Copy JSON
            </Button>
          </div>
        </>
      ) : (
        <div className="bg-slate-950/60 border border-amber-500/20 rounded-md p-4 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <div className="text-base font-bold text-amber-400">NO TRADE</div>
          </div>
          <ul className="space-y-1 text-xs text-slate-300 pl-1">
            {(a.reasoning || []).map((r, i) => (
              <li key={i} className="flex gap-2"><ChevronRight className="w-3 h-3 mt-0.5 text-amber-400 shrink-0" />{r}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function Copilot({ context }) {
  const [sessionId] = useState(() => (typeof crypto !== 'undefined' ? crypto.randomUUID() : 'sess-' + Date.now()))
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi. I am OptionAI Copilot. Ask me about the live market snapshot on the left — "Why bullish on NIFTY?", "Interpret the PCR", "Explain Max Pain", "Is this setup safe?"' },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text }])
    setBusy(true)
    try {
      const r = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: sessionId, context }),
      })
      const j = await r.json()
      if (j.ok) setMessages(m => [...m, { role: 'assistant', text: j.reply }])
      else setMessages(m => [...m, { role: 'assistant', text: 'Error: ' + (j.error || 'unknown') }])
    } catch (e) { setMessages(m => [...m, { role: 'assistant', text: 'Error: ' + e.message }]) }
    finally { setBusy(false) }
  }

  return (
    <Card className="bg-slate-900/50 border-slate-800/70 p-0 flex flex-col h-[560px]">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
        <Bot className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-bold text-slate-100">OptionAI Copilot</span>
        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[9px]">Claude Sonnet 4.5</Badge>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-md px-3 py-2 text-xs whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-emerald-500/10 text-emerald-100 border border-emerald-500/20' : 'bg-slate-800/60 text-slate-200 border border-slate-700'
            }`}>{m.text}</div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-slate-800/60 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> thinking…
            </div>
          </div>
        )}
      </div>
      <div className="p-2 border-t border-slate-800 flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask about the market…"
          className="bg-slate-950 border-slate-800 text-slate-100 text-xs h-9"
          disabled={busy}
        />
        <Button size="sm" onClick={send} disabled={busy || !input.trim()} className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 h-9">
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </Card>
  )
}

const App = () => {
  const [active, setActive] = useState('dashboard')
  const [symbol, setSymbol] = useState('NIFTY')
  const { data: indices, stale } = useIndices()
  const { chain, loading: chainLoading, err: chainErr, refresh } = useOptionChain(symbol)
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)

  const nifty = indices?.indices?.['NIFTY 50']
  const bnk = indices?.indices?.['NIFTY BANK']
  const fin = indices?.indices?.['NIFTY FIN SERVICE']
  const vix = indices?.indices?.['INDIA VIX']

  async function runAnalysis() {
    setAnalyzing(true)
    setAnalysis(null)
    try {
      const r = await fetch('/api/ai/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
      const j = await r.json()
      if (j.ok) {
        setAnalysis(j.analysis)
        toast.success(`AI analysis complete · Score ${j.analysis.score}/100`)
      } else {
        toast.error('AI analysis failed: ' + (j.error || 'unknown'))
      }
    } catch (e) { toast.error(e.message) }
    finally { setAnalyzing(false) }
  }

  const copilotContext = useMemo(() => {
    if (!chain) return null
    return {
      symbol: chain.symbol, spot: chain.spot, expiry: chain.expiry, atm: chain.atm,
      pcr: chain.pcr, maxPain: chain.maxPain, atmIv: chain.atmIv,
      walls: chain.walls, totals: chain.totals,
      indices: {
        nifty: nifty ? { ltp: nifty.last, chgPct: nifty.percentChange } : null,
        vix: vix ? { ltp: vix.last, chgPct: vix.percentChange } : null,
      },
      latestAnalysis: analysis || null,
    }
  }, [chain, nifty, vix, analysis])

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      <header className="h-14 border-b border-slate-800/60 bg-slate-950 flex items-center">
        <div className="flex-1 flex items-center overflow-x-auto">
          <IndexTile label="NIFTY 50" tick={nifty} />
          <IndexTile label="BANK NIFTY" tick={bnk} />
          <IndexTile label="FINNIFTY" tick={fin} />
          <IndexTile label="INDIA VIX" tick={vix} />
        </div>
        <div className="flex items-center gap-2 px-4">
          <StatusPill label="Data" state={stale ? 'STALE' : nifty ? 'LIVE' : 'INIT'} color={stale ? 'amber' : nifty ? 'green' : 'slate'} />
          <StatusPill label="Broker" state="NOT CFG" color="slate" />
          <StatusPill label="Trading" state="ANALYSIS" color="amber" />
          <StatusPill label="AI" state="ONLINE" color="green" />
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <Sidebar active={active} onSelect={setActive} />

        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-slate-800 overflow-hidden">
              {SYMBOLS.map(s => (
                <button
                  key={s}
                  onClick={() => setSymbol(s)}
                  className={`px-3 py-1.5 text-xs font-mono font-semibold transition ${
                    symbol === s ? 'bg-emerald-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                  }`}
                >{s}</button>
              ))}
            </div>
            <Button size="sm" variant="outline" className="border-slate-700 text-slate-300 h-8" onClick={refresh}>
              <Radio className="w-3 h-3 mr-1" /> Refresh Chain
            </Button>
            <div className="flex-1" />
            <Button size="sm" onClick={runAnalysis} disabled={analyzing || !chain} className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 h-8 font-bold">
              {analyzing ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Analyzing…</> : <><Brain className="w-3 h-3 mr-1" /> Analyze {symbol}</>}
            </Button>
          </div>

          {chainErr && (
            <Card className="p-3 bg-rose-500/5 border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Market data error: {chainErr} · NSE may be rate-limiting. Retry in a few seconds.
              <Button size="sm" variant="outline" className="ml-auto h-7 border-rose-500/30 text-rose-300" onClick={refresh}>Retry</Button>
            </Card>
          )}

          {chainLoading && !chain && (
            <div className="flex items-center gap-2 text-slate-500 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading live option chain from NSE…</div>
          )}

          {chain && (
            <>
              <ChainSummary chain={chain} />

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 space-y-4">
                  <Card className="bg-slate-900/50 border-slate-800/70 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-bold text-slate-100">Option Chain · {symbol}</span>
                        <Badge variant="outline" className="border-slate-700 text-slate-400 text-[9px]">{chain.expiry}</Badge>
                      </div>
                      <div className="text-[10px] font-mono text-slate-500">Updated {new Date(chain.timestamp).toLocaleTimeString('en-IN')}</div>
                    </div>
                    <OptionChainTable chain={chain} />
                  </Card>

                  {analysis && <TradeCard analysis={analysis} />}

                  {!analysis && !analyzing && (
                    <Card className="bg-slate-900/30 border-dashed border-slate-800 p-6 text-center">
                      <Brain className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                      <div className="text-sm text-slate-400">Press <span className="text-emerald-400 font-bold">Analyze {symbol}</span> to let OptionAI scan the live chain, compute the setup, and explain its reasoning.</div>
                    </Card>
                  )}
                </div>

                <div className="space-y-4">
                  <Card className="bg-slate-900/50 border-slate-800/70 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Gauge className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm font-bold text-slate-100">Risk (Config · P2)</span>
                    </div>
                    <div className="space-y-1.5 text-xs font-mono">
                      <div className="flex justify-between text-slate-400"><span>Capital</span><span className="text-slate-200">₹1,00,000</span></div>
                      <div className="flex justify-between text-slate-400"><span>Risk / trade</span><span className="text-slate-200">1% (₹1,000)</span></div>
                      <div className="flex justify-between text-slate-400"><span>Daily max loss</span><span className="text-slate-200">₹3,000</span></div>
                      <div className="flex justify-between text-slate-400"><span>Today&apos;s P&amp;L</span><span className="text-slate-500">— broker not connected</span></div>
                      <div className="flex justify-between text-slate-400"><span>Daily risk left</span><span className="text-emerald-400">₹3,000</span></div>
                    </div>
                  </Card>

                  <Copilot context={copilotContext} />
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="h-8 border-t border-slate-800/60 bg-slate-950 flex items-center px-4 text-[10px] font-mono text-slate-500 justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-3 h-3" />
          <span>Personal Terminal · Analysis Mode · No orders will be placed</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Data: NSE India (public)</span>
          <span>·</span>
          <span>AI: Claude Sonnet 4.5 via Emergent</span>
          <span>·</span>
          <span className="text-slate-600">Phase 1 · Broker + OMS in Phase 2</span>
        </div>
      </footer>
    </div>
  )
}

export default App
