'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, BarChart3, Bell, BellRing, Bot, Brain, ChevronRight,
  CircleDot, Clock, Flame, Gauge, LayoutDashboard, LineChart, Link2, ListOrdered, Loader2,
  Radio, Send, Settings, ShieldAlert, Sparkles, TrendingDown, TrendingUp, Unlink,
  Wallet, Zap, RefreshCw, XCircle, CheckCircle2, ShieldCheck
} from 'lucide-react'

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY']
const SCAN_INTERVAL_MS = 3 * 60 * 1000

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
function timeAgo(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

// ---------- HOOKS ----------
function useSignalScan() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [lastAt, setLastAt] = useState(null)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/signal/scan', { cache: 'no-store' })
      const j = await r.json()
      if (j.ok) { setData(j); setErr(null); setLastAt(new Date().toISOString()) }
      else setErr(j.error || 'scan failed')
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  return { data, loading, err, lastAt, refresh: load }
}

function useSignalHistory(tick) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    let alive = true
    fetch('/api/signal/history?limit=25').then(r => r.json()).then(j => {
      if (alive && j.ok) setRows(j.rows || [])
    }).catch(() => {})
    return () => { alive = false }
  }, [tick])
  return rows
}

function useBrokerStatus() {
  const [status, setStatus] = useState({ connected: false, loading: true })
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/broker/kite/status', { cache: 'no-store' })
      const j = await r.json()
      setStatus({ ...j, loading: false })
    } catch (e) { setStatus({ connected: false, loading: false, error: e.message }) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [load])
  return { status, refresh: load }
}

function usePositionsAndFunds(connected) {
  const [positions, setPositions] = useState(null)
  const [funds, setFunds] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [lastAt, setLastAt] = useState(null)

  const load = useCallback(async () => {
    if (!connected) return
    setLoading(true)
    try {
      const [pr, fr] = await Promise.all([
        fetch('/api/broker/kite/positions', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/broker/kite/funds', { cache: 'no-store' }).then(r => r.json()),
      ])
      if (pr.ok) setPositions(pr.positions); else setErr(pr.error)
      if (fr.ok) setFunds(fr.margins); else setErr(fr.error)
      setLastAt(new Date().toISOString())
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [connected])

  useEffect(() => {
    if (!connected) { setPositions(null); setFunds(null); return }
    load()
    const id = setInterval(load, 12000)
    return () => clearInterval(id)
  }, [connected, load])

  return { positions, funds, loading, err, lastAt, refresh: load }
}

function PositionActionModal({ open, onOpenChange, position, action, onDone }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [triggerPrice, setTriggerPrice] = useState('')
  const [orderType, setOrderType] = useState('SL-M')
  const [limitPrice, setLimitPrice] = useState('')

  useEffect(() => {
    if (open && position && action === 'STOP') {
      // Suggest a stop 25% below/above LTP based on direction
      const isLong = Number(position.quantity) > 0
      const ltp = Number(position.last_price) || Number(position.average_price) || 0
      const suggested = isLong ? +(ltp * 0.75).toFixed(1) : +(ltp * 1.25).toFixed(1)
      setTriggerPrice(String(suggested))
      setOrderType('SL-M')
      setLimitPrice('')
      setResult(null)
    } else if (open) {
      setResult(null)
    }
  }, [open, position, action])

  if (!position) return null
  const isLong = Number(position.quantity) > 0
  const qty = Math.abs(Number(position.quantity))
  const ltp = Number(position.last_price) || 0
  const avg = Number(position.average_price) || 0
  const pnl = Number(position.pnl) || 0
  const exitSide = isLong ? 'SELL' : 'BUY'
  const isExit = action === 'EXIT'

  async function submit() {
    setBusy(true); setResult(null)
    try {
      const url = isExit ? '/api/broker/kite/exit-position' : '/api/broker/kite/place-stop'
      const payload = isExit
        ? { tradingsymbol: position.tradingsymbol, product: position.product, exchange: position.exchange }
        : { tradingsymbol: position.tradingsymbol, product: position.product, exchange: position.exchange,
            trigger_price: Number(triggerPrice), order_type: orderType,
            price: orderType === 'SL' ? Number(limitPrice) : undefined }
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (j.ok) {
        setResult({ ok: true, ...j })
        toast.success(`${isExit ? 'Exit' : 'Stop-loss'} placed · ID ${j.order_id}`, { duration: 6000 })
        onDone?.(j)
      } else {
        setResult({ ok: false, error: j.error })
        toast.error(`${isExit ? 'Exit' : 'Stop'} failed: ${j.error}`)
      }
    } catch (e) { setResult({ ok: false, error: e.message }); toast.error(e.message) }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {isExit ? <><XCircle className="w-5 h-5 text-rose-400" /> Exit Position</>
                    : <><ShieldAlert className="w-5 h-5 text-amber-400" /> Set Stop-Loss</>}
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            {isExit
              ? <>This will place a <span className="text-rose-300 font-semibold">{exitSide} MARKET order</span> to close your position immediately.</>
              : <>This will place a <span className="text-amber-300 font-semibold">{exitSide} SL-M order</span> that fires only when price crosses your trigger.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-1 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Contract</span>
            <span className="text-slate-100 font-semibold">{position.tradingsymbol}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Position</span>
            <span className={isLong ? 'text-emerald-300' : 'text-rose-300'}>{isLong ? 'LONG' : 'SHORT'} {qty} · {position.product}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Avg / LTP</span>
            <span>₹{fmt(avg, 1)} → ₹{fmt(ltp, 1)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Current P&amp;L</span>
            <span className={pnl >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{pnl >= 0 ? '+' : ''}₹{fmt(pnl, 0)}</span>
          </div>
        </div>

        {isExit ? (
          <div className="border border-rose-500/30 bg-rose-500/5 rounded p-3 space-y-1 text-xs font-mono">
            <div className="text-rose-300 font-semibold">You will {exitSide} {qty} @ MARKET</div>
            <div className="text-slate-500">Realises current P&amp;L of ≈ <span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>₹{fmt(pnl, 0)}</span> instantly. No stop, no target — full close.</div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Trigger Price ₹</label>
                <Input type="number" step="0.05" value={triggerPrice} onChange={e => setTriggerPrice(e.target.value)} className="bg-slate-900 border-slate-800 text-slate-100 h-9 font-mono" />
                <div className="text-[10px] font-mono text-slate-500 mt-1">
                  {isLong ? 'below' : 'above'} current ₹{fmt(ltp, 1)} · Δ ≈ ₹{fmt(Math.abs(ltp - Number(triggerPrice || 0)), 1)}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Order Type</label>
                <div className="flex gap-1 mt-1">
                  {['SL-M', 'SL'].map(t => (
                    <button key={t} onClick={() => setOrderType(t)}
                      className={`flex-1 h-9 rounded text-xs font-mono font-semibold border ${orderType === t ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-slate-900 border-slate-800 text-slate-400'}`}
                    >{t}</button>
                  ))}
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-1">{orderType === 'SL-M' ? 'Market on trigger' : 'Limit on trigger'}</div>
              </div>
              {orderType === 'SL' && (
                <div className="col-span-2">
                  <label className="text-[10px] uppercase tracking-widest text-slate-500">Limit Price ₹</label>
                  <Input type="number" step="0.05" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} className="bg-slate-900 border-slate-800 text-slate-100 h-9 font-mono" />
                </div>
              )}
            </div>
            <div className="border border-amber-500/30 bg-amber-500/5 rounded p-2 text-xs font-mono text-amber-200">
              Est. worst-case loss if triggered: <span className="font-bold">≈ ₹{fmt(Math.abs((Number(triggerPrice || 0) - avg) * qty), 0)}</span>
            </div>
          </div>
        )}

        {result && (
          <div className={`p-2 rounded text-xs font-mono ${result.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200' : 'bg-rose-500/10 border border-rose-500/30 text-rose-200'}`}>
            {result.ok ? `✓ Order ID: ${result.order_id}` : `✗ ${result.error}`}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="border-slate-700 text-slate-300" onClick={() => onOpenChange(false)} disabled={busy}>
            {result?.ok ? 'Close' : 'Cancel'}
          </Button>
          {!result?.ok && (
            <Button onClick={submit} disabled={busy || (!isExit && !triggerPrice)}
              className={`font-bold ${isExit ? 'bg-rose-500 hover:bg-rose-400 text-slate-950' : 'bg-amber-500 hover:bg-amber-400 text-slate-950'}`}
            >
              {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Placing…</> :
                isExit ? <>CONFIRM EXIT · {exitSide} {qty}</> : <>PLACE STOP · trigger ₹{fmt(Number(triggerPrice || 0), 1)}</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PositionsPanel({ positions, funds, loading, err, lastAt, onRefresh, onAction }) {
  const day = positions?.day || []
  const openPositions = day.filter(p => p.quantity !== 0)
  const totalPnl = day.reduce((sum, p) => sum + (Number(p.pnl) || 0), 0)
  const unrealised = day.reduce((sum, p) => sum + (Number(p.unrealised) || 0), 0)
  const realised = day.reduce((sum, p) => sum + (Number(p.realised) || 0), 0)

  const equity = funds?.equity || {}
  const available = equity?.available?.live_balance ?? equity?.available?.cash ?? null
  const utilised = equity?.utilised?.debits ?? equity?.utilised?.m2m_unrealised ?? null

  return (
    <Card className="bg-slate-900/50 border-slate-800/70 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Wallet className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-bold text-slate-100">Live Positions & P&amp;L</span>
        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[9px]">KITE</Badge>
        <div className="flex-1" />
        <span className="text-[9px] font-mono text-slate-500">{lastAt ? timeAgo(lastAt) : '—'}</span>
        <button onClick={onRefresh} className="text-slate-500 hover:text-slate-300 p-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </button>
      </div>

      {/* Aggregate P&L strip */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <div className={`border rounded px-2 py-1.5 ${totalPnl >= 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Today P&amp;L</div>
          <div className={`text-lg font-mono font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalPnl >= 0 ? '+' : ''}₹{compact(Math.abs(Math.round(totalPnl)))}
          </div>
        </div>
        <div className="border border-slate-800 rounded px-2 py-1.5 bg-slate-950/40">
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Available</div>
          <div className="text-sm font-mono font-bold text-slate-100">
            {available != null ? '₹' + compact(Math.round(available)) : '—'}
          </div>
        </div>
        <div className="border border-slate-800 rounded px-2 py-1.5 bg-slate-950/40">
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Used Margin</div>
          <div className="text-sm font-mono font-bold text-slate-300">
            {utilised != null ? '₹' + compact(Math.round(utilised)) : '—'}
          </div>
        </div>
      </div>

      {/* Realized / Unrealized split */}
      <div className="flex items-center gap-2 mb-2 text-[10px] font-mono">
        <span className="text-slate-500">Unrealised:</span>
        <span className={unrealised >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          {unrealised >= 0 ? '+' : ''}₹{fmt(unrealised, 0)}
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500">Realised:</span>
        <span className={realised >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          {realised >= 0 ? '+' : ''}₹{fmt(realised, 0)}
        </span>
      </div>

      {err && <div className="text-xs text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5 mb-2 font-mono">{err}</div>}

      {/* Positions Table */}
      {openPositions.length === 0 ? (
        <div className="text-xs text-slate-500 py-4 text-center border border-dashed border-slate-800 rounded">
          No open positions. When you place a trade it will appear here in ~10s.
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-[9px] uppercase text-slate-500 sticky top-0 bg-slate-900/95">
              <tr className="border-b border-slate-800">
                <th className="text-left py-1.5 px-1">Contract</th>
                <th className="text-right px-1">Qty</th>
                <th className="text-right px-1">Avg</th>
                <th className="text-right px-1">LTP</th>
                <th className="text-right px-1">P&amp;L</th>
                <th className="text-right px-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {openPositions.map((p, i) => {
                const pnl = Number(p.pnl) || 0
                const pnlPct = p.average_price ? (pnl / (p.average_price * Math.abs(p.quantity))) * 100 : 0
                const isBuy = p.quantity > 0
                return (
                  <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                    <td className="py-1.5 px-1">
                      <div className="text-slate-200 truncate max-w-[140px]" title={p.tradingsymbol}>{p.tradingsymbol}</div>
                      <div className="text-[9px] text-slate-500">{p.product} · {isBuy ? 'LONG' : 'SHORT'}</div>
                    </td>
                    <td className={`px-1 text-right ${isBuy ? 'text-emerald-300' : 'text-rose-300'}`}>{p.quantity}</td>
                    <td className="px-1 text-right text-slate-400">{fmt(p.average_price, 1)}</td>
                    <td className="px-1 text-right text-slate-200 font-semibold">{fmt(p.last_price, 1)}</td>
                    <td className={`px-1 text-right font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {pnl >= 0 ? '+' : ''}{fmt(pnl, 0)}
                      <div className="text-[9px] text-slate-500">{pnl >= 0 ? '+' : ''}{fmt(pnlPct, 1)}%</div>
                    </td>
                    <td className="px-1 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          title="Set stop-loss order"
                          onClick={() => onAction?.(p, 'STOP')}
                          className="h-6 w-6 rounded border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/25 text-amber-400 flex items-center justify-center transition"
                        >
                          <ShieldAlert className="w-3 h-3" />
                        </button>
                        <button
                          title="Exit position (market)"
                          onClick={() => onAction?.(p, 'EXIT')}
                          className="h-6 rounded border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 flex items-center justify-center px-1.5 gap-1 text-[10px] font-bold transition"
                        >
                          <XCircle className="w-3 h-3" /> EXIT
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

async function connectKite() {
  try {
    const r = await fetch('/api/broker/kite/login-url')
    const j = await r.json()
    if (j.ok && j.url) window.location.href = j.url
    else toast.error('Kite login URL error: ' + (j.error || 'unknown'))
  } catch (e) { toast.error(e.message) }
}

async function disconnectKite(onDone) {
  try {
    await fetch('/api/broker/kite/disconnect', { method: 'POST' })
    toast.success('Disconnected from Kite')
    onDone?.()
  } catch (e) { toast.error(e.message) }
}

function PlaceTradeModal({ open, onOpenChange, signal, brokerConnected, onOrderPlaced }) {
  const [lots, setLots] = useState(1)
  const [orderType, setOrderType] = useState('MARKET')
  const [product, setProduct] = useState('MIS')
  const [limitPrice, setLimitPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState(null) // { tradingsymbol, lot_size, tick_size, last_price_kite }
  const [resolveErr, setResolveErr] = useState(null)

  // Resolve authoritative Kite lot size + tradingsymbol whenever modal opens
  useEffect(() => {
    if (!open || !signal || !brokerConnected) return
    let alive = true
    setResolving(true); setResolved(null); setResolveErr(null)
    const q = new URLSearchParams({
      symbol: signal.symbol, expiry: signal.expiry,
      strike: String(signal.strike), type: signal.side,
    })
    fetch(`/api/broker/kite/resolve?${q}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!alive) return
        if (j.ok) setResolved(j)
        else setResolveErr(j.error)
      })
      .catch(e => { if (alive) setResolveErr(e.message) })
      .finally(() => { if (alive) setResolving(false) })
    return () => { alive = false }
  }, [open, signal, brokerConnected])

  useEffect(() => {
    if (open) {
      setLots(1); setOrderType('MARKET'); setProduct('MIS');
      setLimitPrice(signal?.ltp ? String(signal.ltp) : ''); setResult(null)
    }
  }, [open, signal])

  if (!signal) return null
  const kiteLotSize = resolved?.lot_size || signal.lotSize || 1
  const signalLotSize = signal.lotSize || 1
  const qty = lots * kiteLotSize
  const liveLtp = resolved?.last_price_kite ?? signal.ltp
  const estCost = orderType === 'MARKET' ? Math.round(liveLtp * qty) : Math.round(Number(limitPrice || 0) * qty)
  const estMaxLoss = Math.round((liveLtp - signal.stop) * qty)
  const lotSizeMismatch = resolved && signalLotSize !== resolved.lot_size
  const priceMovedPct = resolved?.last_price_kite ? ((resolved.last_price_kite - signal.ltp) / signal.ltp) * 100 : 0
  const priceMoved = Math.abs(priceMovedPct) > 5

  async function submit() {
    setBusy(true)
    setResult(null)
    try {
      const r = await fetch('/api/broker/kite/place-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: signal.symbol,
          side: 'BUY',
          strike: signal.strike,
          type: signal.side,
          expiry: signal.expiry,
          quantity: qty,
          orderType, product,
          price: orderType === 'LIMIT' ? Number(limitPrice) : undefined,
          signal_ref: `${signal.symbol}-${signal.side}-${signal.strike}-${signal.expiry}`,
        }),
      })
      const j = await r.json()
      if (j.ok) {
        setResult({ ok: true, ...j })
        toast.success(`Order placed · ID ${j.order_id}${j.duplicate ? ' (duplicate ignored)' : ''}`, { duration: 8000 })
        onOrderPlaced?.(j)
      } else {
        setResult({ ok: false, error: j.error })
        toast.error('Order failed: ' + j.error)
      }
    } catch (e) { setResult({ ok: false, error: e.message }); toast.error(e.message) }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Confirm Order
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            Review carefully. This will place a <span className="text-rose-300 font-semibold">REAL order</span> on Zerodha Kite using your live account.
          </DialogDescription>
        </DialogHeader>

        {!brokerConnected ? (
          <div className="p-4 border border-amber-500/30 bg-amber-500/5 rounded text-xs text-amber-300">
            Kite is not connected. Click <span className="font-bold">Connect Kite</span> in the header first.
          </div>
        ) : (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge className={`text-base font-bold px-3 py-1.5 ${signal.side === 'CE' ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-slate-950'}`}>
                  BUY {signal.side}
                </Badge>
                <span className="text-lg font-mono font-bold">{signal.strikeLabel}</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                Expiry {signal.expiry} · Signal score {signal.score}/100 · Signal LTP ₹{fmt(signal.ltp)}
                {resolved?.last_price_kite && ` · Kite LTP ₹${fmt(resolved.last_price_kite)}`}
              </div>
              {resolved?.tradingsymbol && (
                <div className="text-[10px] font-mono text-emerald-400/80">
                  Kite tradingsymbol: <span className="font-bold">{resolved.tradingsymbol}</span>
                </div>
              )}
              {resolving && (
                <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Resolving contract from Kite…
                </div>
              )}
              {resolveErr && (
                <div className="text-[10px] font-mono text-rose-400 border border-rose-500/30 bg-rose-500/5 rounded px-2 py-1">
                  ⚠ Kite resolve failed: {resolveErr}
                </div>
              )}
            </div>

            {lotSizeMismatch && (
              <div className="border border-amber-500/40 bg-amber-500/10 rounded p-2 text-xs text-amber-300 font-mono">
                ⚠ Lot size updated from Kite: <span className="line-through text-slate-500">{signalLotSize}</span> → <span className="font-bold text-amber-200">{resolved.lot_size}</span> (SEBI/NSE per-series adjustment). Quantity below now uses <span className="font-bold">{resolved.lot_size}</span>/lot.
              </div>
            )}
            {priceMoved && (
              <div className="border border-amber-500/40 bg-amber-500/10 rounded p-2 text-xs text-amber-300 font-mono">
                ⚠ Price moved {priceMovedPct >= 0 ? '+' : ''}{fmt(priceMovedPct, 1)}% since signal · Signal ₹{fmt(signal.ltp)} → Kite ₹{fmt(resolved.last_price_kite)}. Reconsider entry.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Lots</label>
                <Input type="number" min={1} max={20} value={lots} onChange={e => setLots(Math.max(1, +e.target.value || 1))} className="bg-slate-900 border-slate-800 text-slate-100 h-9 font-mono" disabled={resolving} />
                <div className="text-[10px] font-mono text-slate-500 mt-1">
                  = {qty} qty ({resolved ? <span className="text-emerald-400">Kite lot {resolved.lot_size}</span> : `signal lot ${signalLotSize}`})
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Order Type</label>
                <div className="flex gap-1 mt-1">
                  {['MARKET', 'LIMIT'].map(t => (
                    <button key={t} onClick={() => setOrderType(t)}
                      className={`flex-1 h-9 rounded text-xs font-mono font-semibold border ${orderType === t ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-900 border-slate-800 text-slate-400'}`}
                    >{t}</button>
                  ))}
                </div>
              </div>
              {orderType === 'LIMIT' && (
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-slate-500">Limit Price ₹</label>
                  <Input type="number" step={resolved?.tick_size || 0.05} value={limitPrice} onChange={e => setLimitPrice(e.target.value)} className="bg-slate-900 border-slate-800 text-slate-100 h-9 font-mono" />
                  <div className="text-[10px] font-mono text-slate-500 mt-1">tick {resolved?.tick_size ?? 0.05} · entry ₹{fmt(signal.entry.low, 1)}–{fmt(signal.entry.high, 1)}</div>
                </div>
              )}
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Product</label>
                <div className="flex gap-1 mt-1">
                  {['MIS', 'NRML'].map(p => (
                    <button key={p} onClick={() => setProduct(p)}
                      className={`flex-1 h-9 rounded text-xs font-mono font-semibold border ${product === p ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-900 border-slate-800 text-slate-400'}`}
                    >{p}</button>
                  ))}
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-1">{product === 'MIS' ? 'Intraday' : 'Carry-forward'}</div>
              </div>
            </div>

            <div className="border border-rose-500/20 bg-rose-500/5 rounded p-3 space-y-1.5 font-mono text-xs">
              <div className="flex justify-between"><span className="text-slate-500">Estimated cost</span><span className="text-slate-200">≈ ₹{compact(estCost)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Max loss if stopped out</span><span className="text-rose-300">≈ ₹{compact(estMaxLoss)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Target 1 (potential gain)</span><span className="text-emerald-300">≈ ₹{compact((signal.target1 - liveLtp) * qty)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Invalidation</span><span className="text-amber-300 text-right">{signal.invalidation}</span></div>
            </div>

            <div className="text-[10px] text-slate-500 border-l-2 border-slate-700 pl-2">
              ⓘ This app has NO daily-loss enforcement yet (Phase 2). You are personally responsible for position sizing and risk.
              You can cancel/modify this order from Kite Web or here after submission.
            </div>

            {result && (
              <div className={`p-2 rounded text-xs font-mono ${result.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200' : 'bg-rose-500/10 border border-rose-500/30 text-rose-200'}`}>
                {result.ok ? `✓ Order ID: ${result.order_id}${result.duplicate ? ' (already existed)' : ''}` : `✗ ${result.error}`}
              </div>
            )}
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="border-slate-700 text-slate-300" onClick={() => onOpenChange(false)} disabled={busy}>
            {result?.ok ? 'Close' : 'Cancel'}
          </Button>
          {brokerConnected && !result?.ok && (
            <Button onClick={submit} disabled={busy || resolving || !resolved} className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold">
              {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Placing…</> :
                resolving ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Resolving…</> :
                !resolved ? <>Waiting for Kite…</> :
                <>CONFIRM ORDER · {lots} lot{lots > 1 ? 's' : ''} = {qty} qty</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- COMPONENTS ----------
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

function Sidebar({ active, onSelect, brokerConnected }) {
  const items = [
    { id: 'signal', label: 'Trade Signal', icon: Flame },
    { id: 'chain', label: 'Option Chain', icon: BarChart3 },
    { id: 'copilot', label: 'Copilot', icon: Bot },
    { id: 'history', label: 'Signal Log', icon: Clock },
    { id: 'positions', label: 'Positions', icon: Wallet, locked: !brokerConnected, hint: brokerConnected ? 'RAIL' : 'P2' },
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
          <div className="text-[9px] uppercase tracking-widest text-slate-500">Terminal · v0.3</div>
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
              {(it.locked || it.hint) && <Badge variant="outline" className={`text-[8px] px-1 py-0 h-4 ${it.hint === 'RAIL' ? 'border-emerald-500/30 text-emerald-400' : 'border-slate-700 text-slate-500'}`}>{it.hint || 'P2'}</Badge>}
            </button>
          )
        })}
      </nav>
      <div className="p-3 border-t border-slate-800/60 space-y-2">
        <div className="text-[9px] uppercase tracking-widest text-slate-500 px-1">Trading Mode</div>
        <div className={`flex items-center justify-between px-2 py-1.5 rounded text-xs ${brokerConnected ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/5 border border-amber-500/20'}`}>
          <span className={brokerConnected ? 'text-emerald-400 font-bold' : 'text-amber-400'}>{brokerConnected ? 'ASSISTED LIVE' : 'ANALYSIS'}</span>
          {brokerConnected ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <ShieldAlert className="w-3 h-3 text-amber-400" />}
        </div>
        <Button size="sm" variant="destructive" className="w-full h-8 text-xs font-bold" disabled>
          <AlertTriangle className="w-3 h-3 mr-1" /> KILL SWITCH
        </Button>
      </div>
    </aside>
  )
}

function priorityStyle(priority) {
  switch (priority) {
    case 'VERY_STRONG': return {
      wrap: 'border-emerald-400/60 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 shadow-[0_0_50px_-15px_rgba(52,211,153,0.35)]',
      label: '🔥 VERY STRONG', color: 'text-emerald-400', badge: 'bg-emerald-500 text-slate-950',
    }
    case 'STRONG': return {
      wrap: 'border-emerald-500/40 bg-emerald-500/5',
      label: '🟢 STRONG', color: 'text-emerald-400', badge: 'bg-emerald-500/90 text-slate-950',
    }
    case 'MODERATE': return {
      wrap: 'border-amber-500/40 bg-amber-500/5',
      label: '🟡 MODERATE', color: 'text-amber-400', badge: 'bg-amber-500/90 text-slate-950',
    }
    default: return {
      wrap: 'border-slate-700 bg-slate-900/60',
      label: '⛔ NO TRADE', color: 'text-slate-400', badge: 'bg-slate-700 text-slate-300',
    }
  }
}

function TradeSignalCard({ symbolResult, isBest, onExplain, brokerConnected, onPlaceTrade }) {
  if (!symbolResult) return null
  const { symbol, action, priority, best, noTradeReasons, chainSummary, indexTick } = symbolResult
  const st = priorityStyle(priority)
  const isTrade = action === 'TRADE' && best

  return (
    <Card className={`p-4 border-2 ${st.wrap} relative overflow-hidden`}>
      {isBest && (
        <Badge className="absolute top-3 right-3 bg-emerald-400 text-slate-950 font-bold text-[10px] tracking-widest">
          ★ BEST OPPORTUNITY
        </Badge>
      )}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`text-xl font-bold ${st.color}`}>{st.label}</div>
          <Badge variant="outline" className="border-slate-700 text-slate-400 font-mono text-[10px]">
            {symbol} · spot {fmt(chainSummary?.spot)} {indexTick && `(${fmt(indexTick.percentChange)}%)`}
          </Badge>
        </div>
        {best && (
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-widest text-slate-500">Signal Score</div>
            <div className={`text-3xl font-mono font-bold ${st.color}`}>{best.score}<span className="text-slate-600 text-base">/100</span></div>
          </div>
        )}
      </div>

      {isTrade ? (
        <>
          <div className="flex items-center gap-3 mb-4">
            <Badge className={`text-lg font-bold px-4 py-2 ${best.side === 'CE' ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-slate-950'}`}>
              BUY {best.side}
            </Badge>
            <div className="flex-1">
              <div className="text-2xl font-bold text-slate-100 font-mono">{best.strikeLabel}</div>
              <div className="text-xs text-slate-500 font-mono">Expiry: {best.expiry} · LTP ₹{fmt(best.ltp)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono mb-4">
            <MetricBox label="Entry Zone" value={`₹${fmt(best.entry.low, 1)}–${fmt(best.entry.high, 1)}`} color="text-slate-100" />
            <MetricBox label="Stop" value={`₹${fmt(best.stop, 1)}`} color="text-rose-400" />
            <MetricBox label="Target 1" value={`₹${fmt(best.target1, 1)}`} color="text-emerald-400" />
            <MetricBox label="Target 2" value={`₹${fmt(best.target2, 1)}`} color="text-emerald-400" />
            <MetricBox label="Max Loss / lot" value={`₹${compact(best.maxLoss)}`} color="text-rose-300" small />
            <MetricBox label="Lot Size" value={best.lotSize} color="text-slate-200" small />
            <MetricBox label="Risk : Reward" value={best.riskReward} color="text-slate-100" small />
            <MetricBox label="Confidence" value={priority === 'VERY_STRONG' ? 'HIGH' : priority === 'STRONG' ? 'HIGH' : 'MEDIUM'} color={st.color} small />
          </div>

          <div className="grid md:grid-cols-2 gap-3 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Why This Trade</div>
              <ul className="space-y-1 text-xs text-slate-300">
                {best.reasoning.map((r, i) => (
                  <li key={i} className="flex gap-2"><ChevronRight className="w-3 h-3 mt-0.5 text-emerald-400 shrink-0" />{r}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Invalidation</div>
                <div className="text-xs text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5 font-mono">
                  {best.invalidation}
                </div>
              </div>
              {best.warnings?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Warnings</div>
                  <ul className="space-y-1 text-xs text-rose-300">
                    {best.warnings.map((w, i) => <li key={i} className="flex gap-2"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}</li>)}
                  </ul>
                </div>
              )}
              <ScoreBreakdown breakdown={best.breakdown} />
            </div>
          </div>

          <Separator className="bg-slate-800 my-3" />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              className={`flex-1 min-w-[200px] text-slate-950 font-bold ${best.side === 'CE' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-rose-500 hover:bg-rose-400'} disabled:opacity-50`}
              disabled={!brokerConnected}
              onClick={() => onPlaceTrade?.(best)}
            >
              {brokerConnected ? (
                <>PLACE TRADE · BUY {best.side} {best.strike}</>
              ) : (
                <>Connect Kite to Place <Badge variant="outline" className="ml-2 border-slate-950/40 text-slate-950 text-[9px]">Header ↑</Badge></>
              )}
            </Button>
            <Button variant="outline" className="border-slate-700 text-slate-300" onClick={onExplain}>
              <Brain className="w-3.5 h-3.5 mr-1.5" /> Explain via AI
            </Button>
            <Button variant="outline" className="border-slate-700 text-slate-300" onClick={() => navigator.clipboard.writeText(JSON.stringify(best, null, 2))}>
              Copy JSON
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-slate-400">The signal engine did not find a setup above the 75/100 threshold for <span className="text-slate-200 font-semibold">{symbol}</span>.</div>
          <ul className="space-y-1 text-xs text-slate-300">
            {noTradeReasons.map((r, i) => (
              <li key={i} className="flex gap-2"><ChevronRight className="w-3 h-3 mt-0.5 text-amber-400 shrink-0" />{r}</li>
            ))}
          </ul>
          {best && (
            <div className="text-[10px] font-mono text-slate-500 pt-1">
              Highest-scored candidate (below threshold): {best.strikeLabel} · score {best.score}/100
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function MetricBox({ label, value, color, small }) {
  return (
    <div className={`border border-slate-800/60 rounded ${small ? 'px-2 py-1.5' : 'px-3 py-2'} bg-slate-950/40`}>
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`${small ? 'text-sm' : 'text-lg'} font-mono font-bold ${color}`}>{value}</div>
    </div>
  )
}

function ScoreBreakdown({ breakdown }) {
  const items = [
    ['Trend', breakdown.trend, 20], ['Momentum', breakdown.momentum, 15],
    ['VWAP', breakdown.vwap, 10], ['Volume', breakdown.volume, 10],
    ['OI', breakdown.oi, 15], ['PCR', breakdown.pcr, 5],
    ['IV', breakdown.iv, 10], ['Liq', breakdown.liquidity, 5], ['R:R', breakdown.rr, 10],
  ]
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Score Breakdown</div>
      <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
        {items.map(([k, v, mx]) => {
          const pct = (v / mx) * 100
          const color = pct >= 75 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-rose-400'
          return (
            <div key={k} className="flex items-center justify-between px-1.5 py-1 bg-slate-950/40 rounded border border-slate-800/50">
              <span className="text-slate-500">{k}</span>
              <span className={`font-bold ${color}`}>{v}/{mx}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OpportunityRail({ ranked, activeSymbol, onPick }) {
  if (!ranked?.length) return null
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {ranked.map((s) => {
        const st = priorityStyle(s.priority)
        const b = s.best
        const active = s.symbol === activeSymbol
        return (
          <button key={s.symbol} onClick={() => onPick(s.symbol)}
            className={`text-left rounded-md border p-3 transition hover:bg-slate-800/30 ${active ? 'border-emerald-400/60 bg-emerald-500/5' : 'border-slate-800 bg-slate-900/40'}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-slate-200">{s.symbol}</span>
              <span className={`text-[10px] font-mono ${st.color}`}>{st.label}</span>
            </div>
            {b ? (
              <>
                <div className="text-sm font-mono font-bold text-slate-100">
                  {s.action === 'TRADE' ? `BUY ${b.side} ${b.strike}` : `${b.side} ${b.strike}`}
                </div>
                <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
                  <span className="text-slate-500">LTP ₹{fmt(b.ltp)}</span>
                  <span className={`font-bold ${st.color}`}>{b.score}/100</span>
                </div>
              </>
            ) : <div className="text-xs text-slate-500 font-mono">No candidate</div>}
          </button>
        )
      })}
    </div>
  )
}

function SignalHistoryPanel({ rows }) {
  return (
    <Card className="bg-slate-900/50 border-slate-800/70 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-bold text-slate-100">Signal History</span>
        <Badge variant="outline" className="border-slate-700 text-slate-500 text-[9px]">{rows.length} events</Badge>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-slate-500 py-4 text-center">No signals recorded yet. Run a scan to populate.</div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-[10px] uppercase text-slate-500">
              <tr className="border-b border-slate-800">
                <th className="text-left py-1.5 px-1">Time</th>
                <th className="text-left px-1">Symbol</th>
                <th className="text-left px-1">Signal</th>
                <th className="text-right px-1">Score</th>
                <th className="text-left px-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const statusColor = r.status === 'NEW' ? 'text-emerald-400' :
                  r.status === 'ACTIVE' ? 'text-emerald-300' :
                  r.status === 'STRENGTHENING' ? 'text-emerald-400' :
                  r.status === 'WEAKENING' ? 'text-amber-400' :
                  r.status === 'INVALIDATED' ? 'text-rose-400' : 'text-slate-400'
                return (
                  <tr key={r._id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                    <td className="py-1.5 px-1 text-slate-500">{timeAgo(r.created_at)}</td>
                    <td className="px-1 text-slate-300">{r.symbol}</td>
                    <td className="px-1 text-slate-200">{r.action === 'TRADE' ? `BUY ${r.side} ${r.strike}` : 'NO TRADE'}</td>
                    <td className={`px-1 text-right font-bold ${r.score >= 80 ? 'text-emerald-400' : r.score >= 75 ? 'text-amber-400' : 'text-slate-500'}`}>{r.score || 0}</td>
                    <td className={`px-1 ${statusColor}`}>{r.status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function OptionChainTable({ chain }) {
  if (!chain) return null
  const { rows, atm, walls } = chain
  const atmIdx = rows.findIndex(r => r.strikePrice === atm)
  const visible = rows.slice(Math.max(0, atmIdx - 7), Math.min(rows.length, atmIdx + 8))
  const maxOi = Math.max(1, ...rows.flatMap(r => [(r.CE?.openInterest) || 0, (r.PE?.openInterest) || 0]))
  return (
    <div className="overflow-auto rounded-md border border-slate-800/60 max-h-96">
      <table className="w-full text-xs font-mono">
        <thead className="sticky top-0 bg-slate-900/95 backdrop-blur text-[10px] uppercase tracking-wider text-slate-500">
          <tr className="border-b border-slate-800">
            <th className="px-2 py-2 text-right">OI</th>
            <th className="px-2 py-2 text-right">Vol</th>
            <th className="px-2 py-2 text-right text-emerald-400">CE LTP</th>
            <th className="px-3 py-2 text-center text-slate-300">STRIKE</th>
            <th className="px-2 py-2 text-left text-rose-400">PE LTP</th>
            <th className="px-2 py-2 text-left">Vol</th>
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
                <td className={`px-2 py-1.5 text-right ${ceItm ? 'bg-slate-800/20' : ''} text-slate-400`}>{compact(ce.totalTradedVolume)}</td>
                <td className={`px-2 py-1.5 text-right font-semibold ${ceItm ? 'bg-slate-800/20' : ''} text-emerald-300`}>{ce.lastPrice ? fmt(ce.lastPrice) : '—'}</td>
                <td className={`px-3 py-1.5 text-center font-bold ${isAtm ? 'text-emerald-400' : 'text-slate-200'}`}>
                  <div className="flex items-center justify-center gap-1">
                    {isSupport && <span title="Put OI wall (support)" className="w-1.5 h-1.5 rounded-full bg-rose-400" />}
                    {r.strikePrice}
                    {isResistance && <span title="Call OI wall (resistance)" className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                  </div>
                </td>
                <td className={`px-2 py-1.5 text-left font-semibold ${peItm ? 'bg-slate-800/20' : ''} text-rose-300`}>{pe.lastPrice ? fmt(pe.lastPrice) : '—'}</td>
                <td className={`px-2 py-1.5 text-left ${peItm ? 'bg-slate-800/20' : ''} text-slate-400`}>{compact(pe.totalTradedVolume)}</td>
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

function Copilot({ context }) {
  const [sessionId] = useState(() => (typeof crypto !== 'undefined' ? crypto.randomUUID() : 'sess-' + Date.now()))
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi. I am OptionAI Copilot. Ask me about the current signal, PCR, Max Pain, or any candidate strike.' },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  async function send(overrideText) {
    const text = (overrideText ?? input).trim()
    if (!text || busy) return
    if (!overrideText) setInput('')
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
    <Card className="bg-slate-900/50 border-slate-800/70 p-0 flex flex-col h-[520px]">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
        <Bot className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-bold text-slate-100">OptionAI Copilot</span>
        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[9px]">Claude 4.5</Badge>
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
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask about the signal…"
          className="bg-slate-950 border-slate-800 text-slate-100 text-xs h-9"
          disabled={busy}
        />
        <Button size="sm" onClick={() => send()} disabled={busy || !input.trim()} className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 h-9">
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </Card>
  )
}

// ---------- MAIN APP ----------
const App = () => {
  const [active, setActive] = useState('signal')
  const [pickedSymbol, setPickedSymbol] = useState('NIFTY')
  const [chain, setChain] = useState(null)
  const [chainLoading, setChainLoading] = useState(true)
  const [chainErr, setChainErr] = useState(null)
  const { data: scan, loading: scanning, err: scanErr, lastAt, refresh: refreshScan } = useSignalScan()

  // Auto Trade Watch
  const [autoWatch, setAutoWatch] = useState(false)
  const [notifOk, setNotifOk] = useState(false)
  const lastKeyRef = useRef({})
  const [historyTick, setHistoryTick] = useState(0)
  const historyRows = useSignalHistory(historyTick)

  // Broker state
  const { status: broker, refresh: refreshBroker } = useBrokerStatus()
  const { positions, funds, loading: posLoading, err: posErr, lastAt: posLastAt, refresh: refreshPositions } = usePositionsAndFunds(broker.connected)
  const [tradeModalOpen, setTradeModalOpen] = useState(false)
  const [positionAction, setPositionAction] = useState({ open: false, position: null, action: null })

  // Handle ?broker=connected|failed on return from Kite OAuth
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('broker') === 'connected') {
      toast.success('Kite connected ✓')
      refreshBroker()
      window.history.replaceState({}, '', window.location.pathname)
    } else if (sp.get('broker') === 'failed') {
      toast.error('Kite connect failed: ' + (sp.get('reason') || 'unknown'))
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [refreshBroker])

  useEffect(() => {
    setHistoryTick(t => t + 1)
  }, [scan])

  // Ask browser notification permission when Auto Watch turns on
  useEffect(() => {
    if (!autoWatch) return
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') { setNotifOk(true); return }
    if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => setNotifOk(p === 'granted'))
    }
  }, [autoWatch])

  // Auto-scan loop
  useEffect(() => {
    if (!autoWatch) return
    const id = setInterval(() => { refreshScan() }, SCAN_INTERVAL_MS)
    return () => clearInterval(id)
  }, [autoWatch, refreshScan])

  // Notify on strong new/changed signals
  useEffect(() => {
    if (!scan?.perSymbol) return
    for (const s of scan.perSymbol) {
      const key = s.best ? `${s.symbol}-${s.best.side}-${s.best.strike}` : `${s.symbol}-NT`
      const score = s.best?.score || 0
      const prev = lastKeyRef.current[s.symbol]
      const material = !prev || prev.key !== key || Math.abs(prev.score - score) >= 5
      if (material && s.action === 'TRADE' && score >= 75) {
        const title = `🔥 ${s.priority.replace('_', ' ')} · ${s.symbol}`
        const body = `BUY ${s.best.side} ${s.best.strike} · Score ${score}/100 · Entry ₹${fmt(s.best.entry.low, 1)}–${fmt(s.best.entry.high, 1)}`
        toast.success(body, { description: title, duration: 8000 })
        if (autoWatch && notifOk && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { new Notification(title, { body, tag: key, requireInteraction: false }) } catch (_) {}
        }
      }
      lastKeyRef.current[s.symbol] = { key, score }
    }
  }, [scan, autoWatch, notifOk])

  // Load option chain for the picked symbol
  useEffect(() => {
    let alive = true
    setChainLoading(true)
    fetch(`/api/market/option-chain?symbol=${pickedSymbol}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (!alive) return; if (j.ok) { setChain(j.data); setChainErr(null) } else setChainErr(j.error) })
      .catch(e => { if (alive) setChainErr(e.message) })
      .finally(() => { if (alive) setChainLoading(false) })
    return () => { alive = false }
  }, [pickedSymbol, scan?.timestamp])

  const activeResult = useMemo(() => {
    return scan?.perSymbol?.find(s => s.symbol === pickedSymbol) || null
  }, [scan, pickedSymbol])
  const bestOverall = scan?.bestOverall || null

  const nifty = scan?.indices?.['NIFTY 50']
  const bnk = scan?.indices?.['NIFTY BANK']
  const fin = scan?.indices?.['NIFTY FIN SERVICE']
  const vix = scan?.indices?.['INDIA VIX']

  const copilotContext = useMemo(() => activeResult ? {
    symbol: activeResult.symbol,
    signal: activeResult.best ? {
      side: activeResult.best.side, strike: activeResult.best.strike, expiry: activeResult.best.expiry,
      ltp: activeResult.best.ltp, entry: activeResult.best.entry, stop: activeResult.best.stop,
      target1: activeResult.best.target1, target2: activeResult.best.target2,
      score: activeResult.best.score, breakdown: activeResult.best.breakdown,
      reasoning: activeResult.best.reasoning, invalidation: activeResult.best.invalidation,
    } : null,
    action: activeResult.action, priority: activeResult.priority,
    chain: activeResult.chainSummary,
    vix: vix?.last,
  } : null, [activeResult, vix])

  async function explainWithAI() {
    if (!activeResult?.best) return
    toast.info('Sending signal to Claude 4.5 for deeper explanation…')
    try {
      const sid = 'explain-' + Date.now()
      const r = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sid,
          message: `Give me a 3-4 sentence deeper interpretation of this signal, focusing on WHAT COULD GO WRONG and WHEN TO EXIT EARLY. Be direct, no fluff.`,
          context: copilotContext,
        }),
      })
      const j = await r.json()
      if (j.ok) toast.success(j.reply, { duration: 15000 })
      else toast.error(j.error || 'AI explain failed')
    } catch (e) { toast.error(e.message) }
  }

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
          <StatusPill label="Data" state={scanErr ? 'STALE' : nifty ? 'LIVE' : 'INIT'} color={scanErr ? 'amber' : nifty ? 'green' : 'slate'} />
          <StatusPill label="Broker" state={broker.connected ? `KITE·${broker.user?.user_id || 'OK'}` : 'NOT CFG'} color={broker.connected ? 'green' : 'slate'} />
          {broker.connected ? (
            <Button size="sm" variant="outline" className="border-slate-700 text-slate-300 h-7 text-[10px]" onClick={() => disconnectKite(refreshBroker)}>
              <Unlink className="w-3 h-3 mr-1" /> Disconnect
            </Button>
          ) : (
            <Button size="sm" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 h-7 text-[10px] font-bold" onClick={connectKite}>
              <Link2 className="w-3 h-3 mr-1" /> Connect Kite
            </Button>
          )}
          <StatusPill label="Trading" state={broker.connected ? 'ASSISTED' : 'ANALYSIS'} color={broker.connected ? 'green' : 'amber'} />
          <StatusPill label="AI" state="ONLINE" color="green" />
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <Sidebar active={active} onSelect={setActive} brokerConnected={broker.connected} />

        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Auto Trade Watch Bar */}
          <Card className="bg-slate-900/50 border-slate-800/70 p-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              {autoWatch ? <BellRing className="w-4 h-4 text-emerald-400 animate-pulse" /> : <Bell className="w-4 h-4 text-slate-500" />}
              <span className="text-sm font-bold text-slate-100">Auto Trade Watch</span>
              <span className="text-[10px] font-mono text-slate-500">scans every {SCAN_INTERVAL_MS / 60000}m · alerts on score ≥ 75</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={autoWatch} onCheckedChange={setAutoWatch} />
              <Badge variant="outline" className={`text-[10px] ${autoWatch ? 'border-emerald-500/40 text-emerald-400' : 'border-slate-700 text-slate-500'}`}>
                {autoWatch ? (notifOk ? 'BROWSER ALERTS ON' : 'IN-APP ONLY') : 'OFF'}
              </Badge>
            </div>
            <div className="flex-1" />
            <span className="text-[10px] font-mono text-slate-500">
              {scanning ? 'scanning…' : lastAt ? `last scan ${timeAgo(lastAt)}` : ''}
            </span>
            <Button size="sm" variant="outline" className="border-slate-700 text-slate-300 h-8" onClick={refreshScan} disabled={scanning}>
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span className="ml-1.5">Rescan Now</span>
            </Button>
          </Card>

          {scanErr && (
            <Card className="p-3 bg-rose-500/5 border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <XCircle className="w-4 h-4" /> Scan error: {scanErr}
            </Card>
          )}

          {scan && (
            <>
              {/* Opportunity Rail */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-bold text-slate-100">Multi-Market Scan</span>
                    {bestOverall && (
                      <Badge className="bg-emerald-400 text-slate-950 font-bold text-[10px]">
                        BEST: {bestOverall.symbol} · {bestOverall.best?.strikeLabel} · {bestOverall.best?.score}/100
                      </Badge>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">{scan.timestamp && `snapshot ${timeAgo(scan.timestamp)}`}</span>
                </div>
                <OpportunityRail ranked={scan.ranked} activeSymbol={pickedSymbol} onPick={setPickedSymbol} />
              </div>

              {/* MAIN SIGNAL CARD */}
              <TradeSignalCard
                symbolResult={activeResult}
                isBest={bestOverall?.symbol === pickedSymbol && activeResult?.action === 'TRADE'}
                onExplain={explainWithAI}
                brokerConnected={broker.connected}
                onPlaceTrade={(signal) => setTradeModalOpen(true)}
              />

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 space-y-4">
                  {chain && (
                    <Card className="bg-slate-900/50 border-slate-800/70 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-emerald-400" />
                          <span className="text-sm font-bold text-slate-100">Option Chain · {pickedSymbol}</span>
                          <Badge variant="outline" className="border-slate-700 text-slate-400 text-[9px]">{chain.expiry}</Badge>
                          <Badge variant="outline" className="border-slate-700 text-slate-500 text-[9px] font-mono">
                            PCR {chain.pcr} · MaxPain {chain.maxPain} · ATM {chain.atm}
                          </Badge>
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">Updated {timeAgo(chain.timestamp)}</div>
                      </div>
                      <OptionChainTable chain={chain} />
                    </Card>
                  )}
                  {chainLoading && !chain && (
                    <div className="flex items-center gap-2 text-slate-500 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading option chain…</div>
                  )}
                  {chainErr && (
                    <Card className="p-3 bg-rose-500/5 border-rose-500/20 text-rose-300 text-xs">
                      Chain error: {chainErr}
                    </Card>
                  )}
                </div>

                <div className="space-y-4">
                  {broker.connected && (
                    <PositionsPanel
                      positions={positions} funds={funds}
                      loading={posLoading} err={posErr} lastAt={posLastAt}
                      onRefresh={refreshPositions}
                      onAction={(pos, action) => setPositionAction({ open: true, position: pos, action })}
                    />
                  )}
                  <SignalHistoryPanel rows={historyRows} />
                  <Copilot context={copilotContext} />
                </div>
              </div>
            </>
          )}

          {!scan && !scanErr && (
            <div className="flex items-center gap-2 text-slate-500 text-xs py-10 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Scanning NIFTY / BANKNIFTY / FINNIFTY for actionable trades…
            </div>
          )}
        </main>
      </div>

      <footer className="h-8 border-t border-slate-800/60 bg-slate-950 flex items-center px-4 text-[10px] font-mono text-slate-500 justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-3 h-3" />
          <span>Personal Terminal · {broker.connected ? 'Assisted Live Trading' : 'Analysis Mode'} · Signal Score is NOT a probability of profit</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Data: NSE India (public)</span>
          <span>·</span>
          <span>Broker: {broker.connected ? `Zerodha Kite (${broker.user?.user_id})` : 'Not connected'}</span>
          <span>·</span>
          <span>Engine: Deterministic Quant + Claude 4.5</span>
        </div>
      </footer>

      <PlaceTradeModal
        open={tradeModalOpen}
        onOpenChange={setTradeModalOpen}
        signal={activeResult?.best || null}
        brokerConnected={broker.connected}
        onOrderPlaced={() => { setTimeout(refreshPositions, 3000) }}
      />

      <PositionActionModal
        open={positionAction.open}
        onOpenChange={(o) => setPositionAction((s) => ({ ...s, open: o }))}
        position={positionAction.position}
        action={positionAction.action}
        onDone={() => { setTimeout(refreshPositions, 2000) }}
      />
    </div>
  )
}

export default App
