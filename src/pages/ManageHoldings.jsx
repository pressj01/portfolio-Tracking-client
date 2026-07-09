import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDialog } from '../components/DialogProvider'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useMarketRefresh } from '../context/MarketRefreshContext'
import { clearDashboardCacheForSelection } from '../utils/dashboardCache'
import { formatMoney } from '../utils/money'

const EMPTY_HOLDING = {
  ticker: '', description: '', category: '',
  quantity: '', price_paid: '', current_price: '',
  div: '', div_frequency: 'M', reinvest: 'N',
  ex_div_date: '', div_pay_date: '', purchase_date: '',
  dividend_paid: '', ytd_divs: '', total_divs_received: '',
  paid_for_itself: '',
  estim_payment_per_year: '', approx_monthly_income: '',
  cash_not_reinvested: '', total_cash_reinvested: '',
  shares_bought_from_dividend: '',
}

function normalizeHoldingRow(row) {
  return {
    ...row,
    div_frequency: row?.div_frequency || EMPTY_HOLDING.div_frequency,
  }
}

function invalidateDashboardCache() {
  try {
    clearDashboardCacheForSelection(localStorage.getItem('portfolio_selectedProfileId') || 'p:1')
  } catch {
    // Cache invalidation is best-effort; data refresh still comes from the API.
  }
}

function InfoHint({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        aria-label="More information"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: '1px solid var(--p-4fc3f7)',
          background: 'rgba(79, 195, 247, 0.12)',
          color: 'var(--accent-2)',
          fontSize: '0.72rem',
          fontWeight: 700,
          lineHeight: '16px',
          padding: 0,
          cursor: 'help',
        }}
      >
        i
      </button>
      {open && (
        <span style={{
          position: 'absolute',
          zIndex: 20,
          left: 22,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 240,
          maxWidth: '70vw',
          padding: '0.45rem 0.55rem',
          borderRadius: 6,
          border: '1px solid var(--p-31517a)',
          background: 'var(--p-101a33)',
          boxShadow: '0 8px 22px rgba(0,0,0,0.35)',
          color: 'var(--p-c8d8ef)',
          fontSize: '0.72rem',
          lineHeight: 1.35,
          whiteSpace: 'normal',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

function AddEditModal({ holding, onSave, onCancel, isEdit, pf }) {
  const [form, setForm] = useState(() => {
    if (!holding) return EMPTY_HOLDING
    const f = {}
    for (const key of Object.keys(EMPTY_HOLDING)) {
      f[key] = holding[key] != null ? holding[key] : ''
    }
    f.div_frequency = f.div_frequency || EMPTY_HOLDING.div_frequency
    return f
  })
  const [looking, setLooking] = useState(false)
  const [lookupMsg, setLookupMsg] = useState(null)
  const [categories, setCategories] = useState([])
  const [hasTxns, setHasTxns] = useState(false)

  useEffect(() => {
    pf('/api/categories/data')
      .then(r => r.json())
      .then(d => setCategories(d.categories || []))
      .catch(() => {})
    // Check if this ticker has transactions (position fields become read-only)
    if (isEdit && holding?.ticker) {
      pf(`/api/holdings/${holding.ticker}/has_transactions`)
        .then(r => r.json())
        .then(d => setHasTxns(d.has_transactions))
        .catch(() => {})
    }
  }, [pf, isEdit, holding])

  const set = (field, value) => setForm(prev => {
    const next = { ...prev, [field]: value }
    if (['reinvest', 'div', 'quantity', 'div_frequency', 'current_price'].includes(field)) {
      const div = parseFloat(next.div) || 0
      const qty = parseFloat(next.quantity) || 0
      const price = parseFloat(next.current_price) || 0
      const freqMult = { W: 52, M: 12, Q: 4, SA: 2, A: 1 }
      const mult = freqMult[(next.div_frequency || 'M').toUpperCase()] || 12
      const annual = div * qty * mult
      if (next.reinvest === 'Y' && annual > 0 && price > 0) {
        next.shares_bought_from_dividend = parseFloat((annual / price).toFixed(3))
      } else if (next.reinvest === 'N') {
        next.shares_bought_from_dividend = ''
      }
    }
    return next
  })

  const lookupTicker = async (ticker) => {
    ticker = ticker.trim().toUpperCase()
    if (!ticker || ticker.length < 1) return
    setLooking(true)
    setLookupMsg(null)
    try {
      const res = await pf(`/api/lookup/${ticker}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setForm(prev => ({
        ...prev,
        description: prev.description || data.description,
        classification_type: data.classification_type || prev.classification_type || '',
        current_price: data.current_price || prev.current_price,
        price_paid: prev.price_paid || data.current_price || '',
        div: data.div || prev.div,
        div_frequency: data.div_frequency || prev.div_frequency,
        ex_div_date: data.ex_div_date || prev.ex_div_date,
        div_pay_date: data.div_pay_date || prev.div_pay_date,
        dividend_paid: prev.dividend_paid || 0,
        ytd_divs: prev.ytd_divs || 0,
        total_divs_received: prev.total_divs_received || 0,
        paid_for_itself: prev.paid_for_itself || 0,
      }))
      setLookupMsg(`Fetched data for ${ticker}`)
    } catch (e) {
      setLookupMsg(`Could not find ${ticker}`)
    } finally {
      setLooking(false)
    }
  }

  const round3 = (v) => v !== '' && v != null ? parseFloat(Number(v).toFixed(3)) : ''

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.ticker.trim()) return

    const payload = { ...form }
    payload.div_frequency = payload.div_frequency || EMPTY_HOLDING.div_frequency
    const numericFields = [
      'quantity', 'price_paid', 'current_price', 'div',
      'dividend_paid', 'ytd_divs', 'total_divs_received', 'paid_for_itself',
      'estim_payment_per_year', 'approx_monthly_income',
      'cash_not_reinvested', 'total_cash_reinvested', 'shares_bought_from_dividend',
    ]
    for (const f of numericFields) {
      if (payload[f] !== '' && payload[f] != null) {
        payload[f] = parseFloat(payload[f])
      } else {
        payload[f] = null
      }
    }
    if (payload.quantity && payload.price_paid) {
      payload.purchase_value = payload.quantity * payload.price_paid
    }
    if (payload.quantity && payload.current_price) {
      payload.current_value = payload.quantity * payload.current_price
    }
    if (payload.purchase_value && payload.current_value) {
      payload.gain_or_loss = payload.current_value - payload.purchase_value
      payload.gain_or_loss_percentage = payload.purchase_value > 0
        ? payload.gain_or_loss / payload.purchase_value : 0
      payload.percent_change = payload.gain_or_loss_percentage
    }
    if (payload.div && payload.quantity) {
      const freqMult = { W: 52, M: 12, Q: 4, SA: 2, A: 1 }
      const mult = freqMult[(payload.div_frequency || 'M').toUpperCase()] || 12
      payload.estim_payment_per_year = parseFloat((payload.div * payload.quantity * mult).toFixed(3))
      payload.approx_monthly_income = parseFloat((payload.estim_payment_per_year / 12).toFixed(3))
    }
    if (payload.estim_payment_per_year && payload.current_price && payload.reinvest === 'Y') {
      payload.shares_bought_from_dividend = parseFloat((payload.estim_payment_per_year / payload.current_price).toFixed(3))
    }
    if (payload.estim_payment_per_year && payload.purchase_value) {
      payload.annual_yield_on_cost = payload.estim_payment_per_year / payload.purchase_value
    }
    if (payload.estim_payment_per_year && payload.current_value) {
      payload.current_annual_yield = payload.estim_payment_per_year / payload.current_value
    }
    if (payload.total_divs_received && payload.purchase_value) {
      payload.paid_for_itself = payload.total_divs_received / payload.purchase_value
    }

    onSave(payload)
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div className="card" style={{ width: '700px', maxHeight: '85vh', overflow: 'auto' }}>
        <h2>{isEdit ? `Edit ${form.ticker}` : 'Add New Holding'}</h2>
        <form onSubmit={handleSubmit}>

          {/* Section: Basic Info */}
          <h3 style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem' }}>BASIC INFO</h3>
          {lookupMsg && (
            <div className={`alert ${lookupMsg.startsWith('Could not') ? 'alert-error' : 'alert-info'}`} style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
              {lookupMsg}
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Ticker *</label>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  value={form.ticker}
                  onChange={(e) => set('ticker', e.target.value.toUpperCase())}
                  onBlur={(e) => { if (!isEdit && e.target.value.trim()) lookupTicker(e.target.value) }}
                  disabled={isEdit}
                  required
                  style={{ flex: 1 }}
                />
                {!isEdit && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    onClick={() => lookupTicker(form.ticker)}
                    disabled={!form.ticker.trim() || looking}
                  >
                    {looking ? <span className="spinner" /> : 'Lookup'}
                  </button>
                )}
              </div>
            </div>
            <div className="form-group">
              <label>Description</label>
              <input
                value={form.description || ''}
                onChange={(e) => set('description', e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select value={form.category || ''} onChange={(e) => set('category', e.target.value)} style={{ width: '100%' }}>
                <option value="">— None —</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Section: Position */}
          <h3 style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginBottom: '0.5rem', marginTop: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem' }}>POSITION</h3>
          {hasTxns && (
            <div className="alert alert-info" style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
              Shares, Price Paid, and Purchase Date are managed by transactions. Use the Txn button to add or edit lots.
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Shares {!hasTxns && '*'}</label>
              <input type="number" step="any" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} style={{ width: '100%', ...(hasTxns ? { opacity: 0.6 } : {}) }} required={!hasTxns} disabled={hasTxns} />
            </div>
            <div className="form-group">
              <label>Price Paid</label>
              <input type="number" step="0.001" value={round3(form.price_paid)} onChange={(e) => set('price_paid', e.target.value)} style={{ width: '100%', ...(hasTxns ? { opacity: 0.6 } : {}) }} disabled={hasTxns} />
            </div>
            <div className="form-group">
              <label>Current Price</label>
              <input type="number" step="0.001" value={round3(form.current_price)} onChange={(e) => set('current_price', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Purchase Date</label>
              <input type="date" min="1900-01-01" max="2099-12-31" value={form.purchase_date || ''}
                onChange={(e) => set('purchase_date', e.target.value)}
                style={{ width: '100%', ...(hasTxns ? { opacity: 0.6 } : {}) }} disabled={hasTxns} />
            </div>
          </div>

          {/* Section: Dividend Info */}
          <h3 style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginBottom: '0.5rem', marginTop: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem' }}>DIVIDEND INFO</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Div/Share</label>
              <input type="number" step="any" value={form.div || ''} onChange={(e) => set('div', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select value={form.div_frequency || 'M'} onChange={(e) => set('div_frequency', e.target.value)} style={{ width: '100%' }}>
                <option value="W">Weekly</option>
                <option value="M">Monthly</option>
                <option value="Q">Quarterly</option>
                <option value="SA">Semi-Annual</option>
                <option value="A">Annual</option>
              </select>
            </div>
            <div className="form-group">
              <label>DRIP</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', height: '36px' }}>
                <input
                  type="checkbox"
                  checked={form.reinvest === 'Y'}
                  onChange={(e) => set('reinvest', e.target.checked ? 'Y' : 'N')}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>{form.reinvest === 'Y' ? 'Yes' : 'No'}</span>
              </div>
            </div>
            <div className="form-group">
              <label>Ex-Div Date</label>
              <input value={form.ex_div_date || ''} onChange={(e) => set('ex_div_date', e.target.value)} placeholder="MM/DD/YY" style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Pay Date</label>
              <input value={form.div_pay_date || ''} onChange={(e) => set('div_pay_date', e.target.value)} placeholder="MM/DD/YY" style={{ width: '100%' }} />
            </div>
          </div>

          {/* Section: Dividend Tracking / Total Returns */}
          <h3 style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginBottom: '0.5rem', marginTop: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem' }}>DIVIDEND TRACKING / TOTAL RETURNS</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Dividends Paid</label>
              <input type="number" step="any" value={form.dividend_paid || ''} onChange={(e) => set('dividend_paid', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>YTD Divs</label>
              <input type="number" step="any" value={form.ytd_divs || ''} onChange={(e) => set('ytd_divs', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Total Divs Received</label>
              <input type="number" step="any" value={form.total_divs_received || ''} onChange={(e) => set('total_divs_received', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Paid For Itself</label>
              <input type="number" step="any" value={form.paid_for_itself || ''} onChange={(e) => set('paid_for_itself', e.target.value)} placeholder="Auto-calculated" style={{ width: '100%' }} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Est. Annual Dividend</label>
              <input type="number" step="0.001" value={round3(form.estim_payment_per_year)} onChange={(e) => set('estim_payment_per_year', e.target.value)} placeholder="Auto-calculated" style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Est. Monthly Dividend</label>
              <input type="number" step="0.001" value={round3(form.approx_monthly_income)} onChange={(e) => set('approx_monthly_income', e.target.value)} placeholder="Auto-calculated" style={{ width: '100%' }} />
            </div>
          </div>

          {/* Section: Reinvestment */}
          <h3 style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginBottom: '0.5rem', marginTop: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem' }}>REINVESTMENT</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Cash Not Reinvested</label>
              <input type="number" step="0.001" value={round3(form.cash_not_reinvested)} onChange={(e) => set('cash_not_reinvested', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Cash Reinvested</label>
              <input type="number" step="0.001" value={round3(form.total_cash_reinvested)} onChange={(e) => set('total_cash_reinvested', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Shares from Dividends</label>
              <input type="number" step="0.001" value={round3(form.shares_bought_from_dividend)} onChange={(e) => set('shares_bought_from_dividend', e.target.value)} placeholder={form.reinvest === 'Y' ? 'Auto-calculated' : ''} style={{ width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="submit" className="btn btn-success">{isEdit ? 'Update' : 'Add'}</button>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TransactionModal({ ticker, onClose, onSaved, pf, isNew }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(!isNew)
  const [form, setForm] = useState({
    ticker: ticker || '', transaction_type: 'BUY', shares: '', price_per_share: '', fees: '', transaction_date: '', notes: '',
    // Fields for new ticker creation (lookup data)
    description: '', classification_type: '', current_price: '',
    div: '', div_frequency: 'M', ex_div_date: '', div_pay_date: '', reinvest: 'N', category: '',
  })
  const [looking, setLooking] = useState(false)
  const [lookupMsg, setLookupMsg] = useState(null)
  const [categories, setCategories] = useState([])
  const [editId, setEditId] = useState(null)
  const [error, setError] = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)
  const [openLots, setOpenLots] = useState([])
  const [lotAlloc, setLotAlloc] = useState({})   // {buy_txn_id: shares_to_sell}
  const [lotMode, setLotMode] = useState('FIFO') // 'FIFO' or 'SPECIFIC'
  const lotTotal = Object.values(lotAlloc).reduce((sum, value) => sum + (parseFloat(value) || 0), 0)
  const openLotTotal = openLots.reduce((sum, lot) => sum + (parseFloat(lot.shares_remaining) || 0), 0)

  useEffect(() => {
    if (isNew) {
      pf('/api/categories/data')
        .then(r => r.json())
        .then(d => setCategories(d.categories || []))
        .catch(() => {})
    }
  }, [pf, isNew])

  const fetchTxns = async () => {
    if (!ticker) return
    try {
      const res = await pf(`/api/holdings/${ticker}/transactions`)
      const data = await res.json()
      setTransactions(data)
    } catch { /* ignore */ } finally { setLoading(false) }
  }
  useEffect(() => { if (ticker) fetchTxns() }, [ticker])

  const lookupTicker = async (t) => {
    t = t.trim().toUpperCase()
    if (!t) return
    setLooking(true)
    setLookupMsg(null)
    try {
      const res = await pf(`/api/lookup/${t}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setForm(prev => ({
        ...prev,
        description: prev.description || data.description,
        classification_type: data.classification_type || prev.classification_type || '',
        current_price: data.current_price || prev.current_price,
        price_per_share: prev.price_per_share || data.current_price || '',
        div: data.div || prev.div,
        div_frequency: data.div_frequency || prev.div_frequency,
        ex_div_date: data.ex_div_date || prev.ex_div_date,
        div_pay_date: data.div_pay_date || prev.div_pay_date,
      }))
      setLookupMsg(`Fetched data for ${t}`)
    } catch (e) {
      setLookupMsg(`Could not find ${t}`)
    } finally { setLooking(false) }
  }

  const resetTransactionEditor = () => {
    setForm(prev => ({
      ...prev,
      transaction_type: 'BUY',
      shares: '',
      price_per_share: '',
      fees: '',
      transaction_date: '',
      notes: '',
    }))
    setEditId(null)
    setOpenLots([])
    setLotAlloc({})
    setLotMode('FIFO')
  }

  const fetchOpenLots = async (excludeTxnId = null, initialAlloc = null) => {
    if (!ticker) return
    try {
      const suffix = excludeTxnId ? `?exclude_txn_id=${excludeTxnId}` : ''
      const res = await pf(`/api/holdings/${ticker}/open-lots${suffix}`)
      const data = await res.json()
      setOpenLots(data)
      if (initialAlloc) {
        setLotAlloc(initialAlloc)
        setLotMode(Object.keys(initialAlloc).length > 0 ? 'SPECIFIC' : 'FIFO')
      } else {
        setLotAlloc({})
        setLotMode('FIFO')
      }
    } catch { setOpenLots([]) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    const effectiveTicker = (ticker || form.ticker).trim().toUpperCase()
    if (!effectiveTicker) return

    // Validate date year if provided
    if (form.transaction_date) {
      const year = parseInt(form.transaction_date.split('-')[0], 10)
      if (year < 1900 || year > 2099) {
        setError(`Invalid year ${year} — must be between 1900 and 2099`)
        return
      }
    }

    const payload = {
      transaction_type: form.transaction_type || 'BUY',
      shares: parseFloat(form.shares),
      price_per_share: form.price_per_share ? parseFloat(form.price_per_share) : null,
      fees: form.fees ? parseFloat(form.fees) : 0,
      transaction_date: form.transaction_date || null,
      notes: form.notes || null,
    }
    if (!Number.isFinite(payload.shares) || payload.shares <= 0) {
      setError('Shares must be greater than 0')
      return
    }
    if (payload.transaction_type === 'SELL' && openLots.length > 0 && payload.shares - openLotTotal > 0.000001) {
      setError(`Cannot sell ${payload.shares.toFixed(6)} shares; only ${openLotTotal.toFixed(6)} shares are available.`)
      return
    }
    // Include lot allocations for SELL with specific lots
    if (payload.transaction_type === 'SELL' && lotMode === 'SPECIFIC') {
      const allocs = Object.entries(lotAlloc)
        .filter(([, sh]) => parseFloat(sh) > 0)
        .map(([buyId, sh]) => ({ buy_txn_id: parseInt(buyId), shares: parseFloat(sh) }))
      if (allocs.length === 0) {
        setError('Choose one or more lots, or switch back to FIFO')
        return
      }
      if (Math.abs(lotTotal - payload.shares) > 0.000001) {
        setError(`Specific-lot shares must add up to the sell quantity (${lotTotal.toFixed(6)} allocated vs ${payload.shares.toFixed(6)} entered)`)
        return
      }
      const availableByLot = Object.fromEntries(openLots.map(lot => [String(lot.id), parseFloat(lot.shares_remaining) || 0]))
      const overAllocated = allocs.find(alloc => alloc.shares - (availableByLot[String(alloc.buy_txn_id)] || 0) > 0.000001)
      if (overAllocated) {
        setError(`Lot ${overAllocated.buy_txn_id} only has ${(availableByLot[String(overAllocated.buy_txn_id)] || 0).toFixed(6)} shares available.`)
        return
      }
      payload.lot_allocations = allocs
    } else if (payload.transaction_type === 'SELL' && editId) {
      payload.lot_allocations = []
    }
    // For new tickers, include lookup data
    if (isNew) {
      for (const f of ['description', 'classification_type', 'current_price', 'div',
                        'div_frequency', 'ex_div_date', 'div_pay_date', 'reinvest', 'category']) {
        if (form[f]) payload[f] = form[f]
      }
    }

    try {
      let res
      const isEdit = !!editId
      if (editId) {
        res = await pf(`/api/holdings/${effectiveTicker}/transactions/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await pf(`/api/holdings/${effectiveTicker}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const action = isEdit ? 'updated' : 'added'
      setSuccessMsg(`${payload.transaction_type} ${payload.shares} shares @ $${payload.price_per_share ?? 0} ${action} successfully`)
      setTimeout(() => setSuccessMsg(null), 4000)
      resetTransactionEditor()
      await fetchTxns()
      onSaved()
    } catch (e) { setError(e.message) }
  }

  const handleEditTxn = async (txn) => {
    setEditId(txn.id)
    setForm(prev => ({
      ...prev,
      transaction_type: txn.transaction_type || 'BUY',
      shares: txn.shares || '',
      price_per_share: txn.price_per_share || '',
      fees: txn.fees || '',
      transaction_date: txn.transaction_date || '',
      notes: txn.raw_notes ?? txn.notes ?? '',
    }))
    if ((txn.transaction_type || 'BUY') === 'SELL') {
      const initialAlloc = Object.fromEntries(
        (txn.lot_allocations || []).map(alloc => [alloc.buy_txn_id, String(alloc.shares)])
      )
      await fetchOpenLots(txn.id, initialAlloc)
    } else {
      setOpenLots([])
      setLotAlloc({})
      setLotMode('FIFO')
    }
  }

  const handleDeleteTxn = async (txnId) => {
    setError(null)
    try {
      const res = await pf(`/api/holdings/${ticker}/transactions/${txnId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccessMsg('Transaction deleted successfully')
      setTimeout(() => setSuccessMsg(null), 4000)
      await fetchTxns()
      onSaved()
    } catch (e) { setError(e.message) }
  }

  const fmt = (v, d = 2) => v != null ? Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '-'
  const fmtM = (v, d = 2) => formatMoney(v, { digits: d, fallback: '-' })

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div className="card" style={{ width: '95vw', maxWidth: '1200px', maxHeight: '85vh', overflow: 'auto', paddingTop: 0 }}>
        <h2 style={{ marginTop: '1.5rem' }}>{isNew ? 'Add Ticker via Transaction' : `Transactions — ${ticker}`}</h2>

        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        {successMsg && <div className="alert alert-success" style={{ marginBottom: '0.75rem' }}>{successMsg}</div>}

        {/* Existing transactions list */}
        {!isNew && transactions.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <table style={{ width: '100%', fontSize: '0.85rem', minWidth: '900px' }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Type</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Date</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Shares</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Price</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Fees</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Cost/Proceeds</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Realized G/L</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2, borderLeft: '1px solid var(--p-1a3a5c)' }}>Position</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Avg Cost</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Total Cost</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Notes</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(txn => {
                  const isSell = (txn.transaction_type || 'BUY') === 'SELL'
                  const amount = isSell
                    ? ((txn.shares || 0) * (txn.price_per_share || 0)) - (txn.fees || 0)
                    : ((txn.shares || 0) * (txn.price_per_share || 0)) + (txn.fees || 0)
                  return (
                  <tr key={txn.id}>
                    <td style={{ color: isSell ? 'var(--p-ef9a9a)' : 'var(--p-81c784)', fontWeight: 600 }}>{isSell ? 'SELL' : 'BUY'}</td>
                    <td>
                      <div>{txn.transaction_date || '-'}</div>
                      {txn.created_at && <div style={{ fontSize: '0.7rem', color: 'var(--text-dim-2)' }}>{new Date(txn.created_at + 'Z').toLocaleString()}</div>}
                    </td>
                    <td>{fmt(txn.shares, 3)}</td>
                    <td>{fmtM(txn.price_per_share)}</td>
                    <td>{fmtM(txn.fees)}</td>
                    <td>{fmtM(amount)}</td>
                    <td style={{ color: txn.realized_gain > 0 ? 'var(--p-81c784)' : txn.realized_gain < 0 ? 'var(--p-ef9a9a)' : undefined }}>
                      {formatMoney(txn.realized_gain, { fallback: '-' })}
                    </td>
                    <td style={{ borderLeft: '1px solid var(--p-1a3a5c)', fontWeight: 600 }}>{fmt(txn.position_after, 3)}</td>
                    <td>{fmtM(txn.avg_cost_after)}</td>
                    <td>{fmtM(txn.total_cost_after)}</td>
                    <td style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txn.notes || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button className="btn btn-primary" style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }} onClick={() => handleEditTxn(txn)}>Edit</button>
                        <button className="btn btn-danger" style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }} onClick={() => handleDeleteTxn(txn.id)}>Del</button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isNew && loading && <div style={{ textAlign: 'center', padding: '1rem' }}><span className="spinner" /></div>}

        {/* Add/Edit transaction form */}
        <h3 style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem' }}>
          {editId ? 'EDIT TRANSACTION' : 'ADD TRANSACTION'}
        </h3>
        <form onSubmit={handleSubmit}>
          {/* Ticker field for new tickers */}
          {isNew && (
            <>
              {lookupMsg && (
                <div className={`alert ${lookupMsg.startsWith('Could not') ? 'alert-error' : 'alert-info'}`} style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
                  {lookupMsg}
                </div>
              )}
              <div className="form-row" style={{ gridTemplateColumns: '1fr 2fr 1fr' }}>
                <div className="form-group">
                  <label>Ticker *</label>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <input
                      value={form.ticker}
                      onChange={(e) => setForm(prev => ({ ...prev, ticker: e.target.value.toUpperCase() }))}
                      onBlur={(e) => { if (e.target.value.trim()) lookupTicker(e.target.value) }}
                      required
                      style={{ width: '80px' }}
                    />
                    <button type="button" className="btn btn-primary"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                      onClick={() => lookupTicker(form.ticker)}
                      disabled={!form.ticker.trim() || looking}>
                      {looking ? <span className="spinner" /> : 'Lookup'}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <input value={form.description || ''} onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))} style={{ width: '100%' }} />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select value={form.category || ''} onChange={(e) => setForm(prev => ({ ...prev, category: e.target.value }))} style={{ width: '100%' }}>
                    <option value="">— None —</option>
                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* BUY/SELL toggle — hidden for new tickers (must be BUY) */}
          {!isNew && (
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {['BUY', 'SELL'].map(t => (
                <button key={t} type="button"
                  style={{
                    padding: '0.4rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, border: 'none', borderRadius: '4px', cursor: 'pointer',
                    background: form.transaction_type === t
                      ? (t === 'BUY' ? 'var(--success-solid)' : 'var(--danger-solid)')
                      : 'rgba(255,255,255,0.1)',
                    color: form.transaction_type === t ? 'var(--white)' : 'var(--text-dim-2)',
                  }}
                  onClick={() => {
                    setForm(prev => ({ ...prev, transaction_type: t }))
                    if (t === 'SELL') fetchOpenLots(editId || null)
                    else { setOpenLots([]); setLotAlloc({}); setLotMode('FIFO') }
                  }}
                >{t}</button>
              ))}
            </div>
          )}

          {/* Lot picker for SELL */}
          {!isNew && form.transaction_type === 'SELL' && openLots.length > 0 && (
            <div style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--p-1a3a5c)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-dim-2)' }}>Cost Basis Method:</span>
                {['FIFO', 'SPECIFIC'].map(m => (
                  <button key={m} type="button"
                    style={{
                      padding: '0.25rem 0.8rem', fontSize: '0.8rem', fontWeight: 600, border: 'none', borderRadius: '4px', cursor: 'pointer',
                      background: lotMode === m ? 'var(--primary-hover)' : 'rgba(255,255,255,0.1)',
                      color: lotMode === m ? 'var(--white)' : 'var(--text-dim-2)',
                    }}
                    onClick={() => { setLotMode(m); if (m === 'FIFO') setLotAlloc({}) }}
                  >{m === 'FIFO' ? 'FIFO (default)' : 'Specific Lots'}</button>
                ))}
              </div>
              {lotMode === 'SPECIFIC' && (
                <>
                  <table style={{ width: '100%', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--p-1a3a5c)' }}>
                        <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, color: 'var(--text-dim-2)', textAlign: 'left' }}>Buy Date</th>
                        <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, color: 'var(--text-dim-2)', textAlign: 'right' }}>Price</th>
                        <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, color: 'var(--text-dim-2)', textAlign: 'right' }}>Cost/Share</th>
                        <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, color: 'var(--text-dim-2)', textAlign: 'right' }}>Available</th>
                        <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, color: 'var(--text-dim-2)', textAlign: 'right' }}>Sell Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openLots.map(lot => (
                        <tr key={lot.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '0.3rem 0.5rem' }}>{lot.transaction_date || '-'}</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{fmtM(lot.price_per_share)}</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{fmtM(lot.cost_per_share)}</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{fmt(lot.shares_remaining, 3)}</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>
                            <input type="number" step="any" min="0" max={lot.shares_remaining}
                              value={lotAlloc[lot.id] || ''}
                              onChange={(e) => {
                                const v = e.target.value
                                setLotAlloc(prev => ({ ...prev, [lot.id]: v }))
                                // Auto-sum shares into the main shares field
                                const newAlloc = { ...lotAlloc, [lot.id]: v }
                                const total = Object.values(newAlloc).reduce((s, x) => s + (parseFloat(x) || 0), 0)
                                if (total > 0) setForm(prev => ({ ...prev, shares: total.toString() }))
                              }}
                              placeholder="0"
                              style={{ width: '80px', textAlign: 'right', padding: '0.2rem 0.4rem', fontSize: '0.82rem' }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim-2)' }}>
                    Total to sell: <span style={{ color: 'var(--p-e0e8f0)', fontWeight: 600 }}>
                      {fmt(lotTotal, 3)}
                    </span> shares
                  </div>
                </>
              )}
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>Date</label>
              <input type="date" min="1900-01-01" max="2099-12-31" value={form.transaction_date}
                onChange={(e) => setForm(prev => ({ ...prev, transaction_date: e.target.value }))}
                style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>{form.transaction_type === 'SELL' ? 'Shares Sold *' : 'Shares *'}</label>
              <input
                type="number"
                step="any"
                min="0"
                max={form.transaction_type === 'SELL' && openLots.length > 0 ? openLotTotal : undefined}
                value={form.shares}
                onChange={(e) => setForm(prev => ({ ...prev, shares: e.target.value }))}
                required
                style={{ width: '100%' }}
              />
              {form.transaction_type === 'SELL' && openLots.length > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim-2)', marginTop: '0.25rem' }}>
                  Available: {fmt(openLotTotal, 3)} shares
                </div>
              )}
            </div>
            <div className="form-group">
              <label>Price Per Share</label>
              <input type="number" step="0.001" value={form.price_per_share} onChange={(e) => setForm(prev => ({ ...prev, price_per_share: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Fees</label>
              <input type="number" step="0.01" value={form.fees} onChange={(e) => setForm(prev => ({ ...prev, fees: e.target.value }))} placeholder="0.00" style={{ width: '100%' }} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Notes</label>
              <input value={form.notes || ''} onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="submit" className="btn btn-success">{editId ? 'Edit via Transaction' : 'Add via Transaction'}</button>
            {editId && <button type="button" className="btn btn-secondary" onClick={resetTransactionEditor}>Cancel Edit</button>}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Column definitions for sortable table
const FROZEN_COLS = 5 // first 5 columns are frozen
const FROZEN_WIDTHS = [80, 180, 96, 76, 76] // px widths for frozen cols
const FROZEN_LEFT = FROZEN_WIDTHS.map((_, i) =>
  FROZEN_WIDTHS.slice(0, i).reduce((s, w) => s + w, 0)
)

const COLUMNS = [
  { key: 'ticker', label: 'Ticker', type: 'string', tip: 'Security ticker symbol' },
  { key: 'description', label: 'Description', type: 'string', tip: 'Security name / description' },
  { key: 'category', label: 'Category', type: 'string', tip: 'Investment category assigned to this holding' },
  { key: 'percent_of_account', label: '% Acct', type: 'number', compact: true, tip: 'Percent of total account value held in this security' },
  { key: 'quantity', label: 'Shares', type: 'number', tip: 'Total shares currently held (base + DRIP shares)' },
  { key: 'purchase_date', label: 'Purchase Date', type: 'string', width: 120, tip: 'Date of original purchase (or earliest lot date)' },
  { key: 'base_quantity', label: 'Base Shares', type: 'number', width: 105, tip: 'Original shares purchased, excluding DRIP-acquired shares' },
  { key: 'shares_bought_from_dividend', label: 'DRIP Shares', type: 'number', width: 110, tip: 'Shares acquired through dividend reinvestment (DRIP)' },
  { key: 'total_cash_reinvested', label: 'Cash Reinvested', type: 'number', width: 130, tip: 'Total cash dividend income that has been reinvested via DRIP' },
  { key: 'price_paid', label: 'Price Paid', type: 'number', width: 115, tip: 'Average price paid per share (cost basis per share)' },
  { key: 'current_price', label: 'Current', type: 'number', width: 95, tip: 'Current market price per share' },
  { key: 'purchase_value', label: 'Cost Basis', type: 'number', width: 115, tip: 'Total original cost basis (price paid × shares)' },
  { key: 'current_value', label: 'Value', type: 'number', width: 105, tip: 'Current market value (current price × shares)' },
  { key: 'gain_or_loss', label: 'Gain/Loss', type: 'number', width: 115, tip: 'Unrealized gain or loss in dollars (current value − cost basis)' },
  { key: 'gain_or_loss_percentage', label: 'G/L %', type: 'number', width: 90, tip: 'Unrealized gain or loss as a percentage of cost basis' },
  { key: 'div', label: 'Div/Share', type: 'number', width: 95, tip: 'Most recent dividend paid per share' },
  { key: 'div_frequency', label: 'Freq', type: 'string', width: 70, tip: 'Dividend payment frequency (M = Monthly, Q = Quarterly, W = Weekly, A = Annual)' },
  { key: 'ex_div_date', label: 'Ex-Div Date', type: 'string', width: 110, tip: 'Ex-dividend date — you must own shares before this date to receive the next dividend' },
  { key: 'div_pay_date', label: 'Pay Date', type: 'string', width: 95, tip: 'Date the dividend is actually paid to shareholders' },
  { key: 'reinvest', label: 'DRIP', type: 'string', width: 70, tip: 'Whether dividends are being reinvested (Y = reinvesting, N = taking as cash)' },
  { key: 'estim_payment_per_year', label: 'Est. Annual', type: 'number', width: 110, tip: 'Estimated total annual dividend income from this holding' },
  { key: 'approx_monthly_income', label: 'Monthly', type: 'number', width: 100, tip: 'Estimated monthly dividend income from this holding' },
  { key: 'annual_yield_on_cost', label: 'YOC', type: 'number', width: 80, tip: 'Yield on Cost — annual dividend income as a percentage of your original cost basis' },
  { key: 'current_annual_yield', label: 'Yield', type: 'number', width: 80, tip: 'Current annual dividend yield based on the current market price' },
  { key: 'dividend_paid', label: 'Div Paid', type: 'number', width: 100, tip: 'Last dividend amount actually paid per share' },
  { key: 'ytd_divs', label: 'YTD Divs', type: 'number', width: 100, tip: 'Total dividend income received year-to-date for this holding' },
  { key: 'total_divs_received', label: 'Total Divs', type: 'number', width: 105, tip: 'Cumulative total dividend income received since purchase' },
  { key: 'paid_for_itself', label: 'Paid For Itself', type: 'number', width: 125, tip: 'Percentage of original cost basis recovered through dividends received' },
  { key: 'dividend_actuals_source', label: 'Div Src', type: 'string', width: 85, tip: 'Source of dividend actuals data (e.g. Schwab, Fidelity, Yahoo, Snapshot)' },
  { key: '_shares_if_reinvested', label: 'Shares if Reinvested', type: 'number', width: 155, tip: 'Hypothetical total shares if all dividends ever received had been reinvested at current price' },
  { key: 'realized_gains', label: 'Realized G/L', type: 'number', width: 120, tip: 'Realized gain or loss from shares already sold' },
]

const DEFAULT_COLUMN_WIDTH = 96
const ACTIONS_COLUMN_WIDTH = 150
const columnWidth = (col, i) => i < FROZEN_COLS ? FROZEN_WIDTHS[i] : (col.width || DEFAULT_COLUMN_WIDTH)
const HOLDINGS_TABLE_MIN_WIDTH = COLUMNS.reduce((sum, col, i) => sum + columnWidth(col, i), ACTIONS_COLUMN_WIDTH)

const DIV_SOURCE_OPTIONS = [
  { value: 'all', label: 'All Div Src' },
  { value: 'imported', label: 'Imported actuals' },
  { value: 'schwab', label: 'Schwab' },
  { value: 'fidelity', label: 'Fidelity' },
  { value: 'snowball', label: 'Snowball' },
  { value: 'etrade', label: 'E*Trade' },
  { value: 'robinhood', label: 'Robinhood' },
  { value: 'shear_group', label: 'Shear Group' },
  { value: 'snapshot', label: 'Snapshot' },
  { value: 'yahoo', label: 'Yahoo' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'none', label: 'No source' },
]

const DIV_REPAIR_MODES = [
  { value: 'mixed', label: 'Imported actuals + Yahoo' },
  { value: 'broker', label: 'Imported actuals only' },
  { value: 'yahoo', label: 'Yahoo only' },
]

const IMPORTED_DIV_SOURCES = ['broker', 'schwab', 'fidelity', 'snowball', 'etrade', 'robinhood', 'shear_group', 'imported']

const DIV_SOURCE_META = {
  broker: { label: 'Imported', color: '#81c784' },
  schwab: { label: 'Schwab', color: '#81c784' },
  fidelity: { label: 'Fidelity', color: '#a5d6a7' },
  snowball: { label: 'Snowball', color: '#4db6ac' },
  etrade: { label: 'E*Trade', color: '#80cbc4' },
  robinhood: { label: 'Robinhood', color: '#81c784' },
  shear_group: { label: 'Shear Group', color: '#9fa8da' },
  imported: { label: 'Imported', color: '#81c784' },
  snapshot: { label: 'Snapshot', color: '#ce93d8' },
  yahoo: { label: 'Yahoo', color: '#64b5f6' },
  mixed: { label: 'Mixed', color: '#ffd54f' },
  none: { label: '-', color: '#78909c' },
}

const PREVIEW_SOURCE_COLUMNS = [
  { key: 'schwab', label: 'Schwab' },
  { key: 'fidelity', label: 'Fidelity' },
  { key: 'snowball', label: 'Snowball' },
  { key: 'etrade', label: 'E*Trade' },
  { key: 'robinhood', label: 'Robinhood' },
  { key: 'shear_group', label: 'Shear Group' },
  { key: 'imported', label: 'Other' },
  { key: 'snapshot', label: 'Snapshot' },
  { key: 'yahoo', label: 'Yahoo' },
  { key: 'none', label: 'No source' },
]

const normalizeDivSource = (source) => {
  const value = (source || 'none').toString().toLowerCase()
  if (value.startsWith('shear_group') || value.startsWith('shear group')) return 'shear_group'
  return value
}

function DripMatrixModal({ onClose, onSynced, pf }) {
  const [profiles, setProfiles] = useState([])
  const [tickers, setTickers] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState('')
  const [dirty, setDirty] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await pf('/api/drip-matrix')
      const data = await res.json()
      setProfiles(data.profiles || [])
      setTickers(data.tickers || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [pf])

  const handleToggle = async (ticker, profileId, currentVal) => {
    const newVal = !currentVal
    // Optimistic update
    setTickers(prev => prev.map(t => {
      if (t.ticker !== ticker) return t
      const accounts = { ...t.accounts }
      if (accounts[String(profileId)]) {
        accounts[String(profileId)] = { ...accounts[String(profileId)], reinvest: newVal }
      }
      // Recalculate owner_drip and drip_qty
      let anyDrip = false, allDrip = true, dripQty = 0
      for (const p of profiles) {
        const a = accounts[String(p.id)]
        if (!a) continue
        if (a.reinvest) { anyDrip = true; dripQty += a.qty }
        else { allDrip = false }
      }
      const newDripQty = anyDrip ? (allDrip ? t.total_qty : dripQty) : 0
      const newDripIncome = (anyDrip && t.total_qty > 0) ? t.annual_income * newDripQty / t.total_qty : 0
      return {
        ...t,
        accounts,
        owner_drip: anyDrip,
        drip_qty: newDripQty,
        drip_income: Math.round(newDripIncome * 100) / 100,
      }
    }))
    setDirty(true)
    try {
      await pf('/api/drip-matrix/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, profile_id: profileId, reinvest: newVal }),
      })
    } catch (e) { console.error(e) }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await pf('/api/sync-drip-to-owner', { method: 'POST' })
      const data = await res.json()
      await load()
      setDirty(false)
      if (onSynced) onSynced(data.message)
    } catch (e) { console.error(e) }
    setSyncing(false)
  }

  const filtered = filter
    ? tickers.filter(t => t.ticker.toLowerCase().includes(filter.toLowerCase()))
    : tickers

  const thStyle = { padding: '6px 10px', textAlign: 'center', borderBottom: '2px solid var(--p-334155)', position: 'sticky', top: 0, background: 'var(--p-0a1929)', zIndex: 2 }
  const tdStyle = { padding: '5px 10px', borderBottom: '1px solid var(--grid-line)' }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div className="card" style={{ width: Math.min(900, 300 + profiles.length * 140), maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>DRIP Matrix</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text" placeholder="Filter ticker..." value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--p-334155)', background: 'var(--p-0f1b2d)', color: 'var(--text)', fontSize: '0.8rem', width: 130 }}
            />
            <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
              {syncing ? <><span className="spinner" /> Syncing...</> : 'Sync to Owner'}
            </button>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--p-888)', margin: '0 0 0.5rem' }}>
          Toggle DRIP per ticker per account. Click "Sync to Owner" to update Owner's DRIP flags and share counts.
        </p>

        {!loading && tickers.length > 0 && (() => {
          const totalIncome = tickers.reduce((s, t) => s + (t.annual_income || 0), 0)
          const dripIncome = tickers.reduce((s, t) => s + (t.drip_income || 0), 0)
          const pct = totalIncome > 0 ? (dripIncome / totalIncome * 100) : 0
          return (
            <div style={{ display: 'flex', gap: '2rem', marginBottom: '0.75rem', padding: '0.6rem 1rem', background: 'var(--p-0f1b2d)', borderRadius: 6, fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--p-888)' }}>Total Annual Income: </span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{formatMoney(totalIncome)}</span>
              </div>
              <div>
                <span style={{ color: 'var(--p-888)' }}>DRIP Income: </span>
                <span style={{ color: 'var(--pos-muted)', fontWeight: 600 }}>{formatMoney(dripIncome)}</span>
              </div>
              <div>
                <span style={{ color: 'var(--p-888)' }}>% Reinvested: </span>
                <span style={{ color: 'var(--accent-bright)', fontWeight: 600 }}>{pct.toFixed(1)}%</span>
              </div>
            </div>
          )
        })()}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /> Loading...</div>
        ) : (
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left', minWidth: 80 }}>Ticker</th>
                  <th style={{ ...thStyle, minWidth: 80 }} title="Total shares across all accounts">Total</th>
                  {profiles.map(p => (
                    <th key={p.id} style={{ ...thStyle, minWidth: 110 }}>{p.name}</th>
                  ))}
                  <th style={{ ...thStyle, minWidth: 80 }} title="Owner aggregate DRIP status and DRIP-eligible shares">Owner</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.ticker}>
                    <td style={{ ...tdStyle, fontWeight: 600, textAlign: 'left' }}>{t.ticker}</td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--p-aaa)' }}>{t.total_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    {profiles.map(p => {
                      const a = t.accounts[String(p.id)]
                      if (!a) return <td key={p.id} style={{ ...tdStyle, textAlign: 'center', color: 'var(--p-555)' }}>—</td>
                      return (
                        <td key={p.id} style={{ ...tdStyle, textAlign: 'center' }}>
                          <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="checkbox" checked={a.reinvest}
                              onChange={() => handleToggle(t.ticker, p.id, a.reinvest)}
                              style={{ accentColor: 'var(--p-4caf50)', cursor: 'pointer' }}
                            />
                            <span style={{ color: a.reinvest ? 'var(--pos-muted)' : 'var(--p-888)', fontSize: '0.75rem' }}>
                              {a.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </span>
                          </label>
                        </td>
                      )
                    })}
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: t.owner_drip ? 'var(--pos-muted)' : 'var(--p-888)' }}>
                      {t.owner_drip ? `✓ ${t.drip_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dirty && (
          <div style={{ padding: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--warning)', textAlign: 'center' }}>
            Changes made — click "Sync to Owner" to update Owner's DRIP flags
          </div>
        )}
      </div>
    </div>
  )
}

export default function ManageHoldings() {
  const navigate = useNavigate()
  const pf = useProfileFetch()
  const { runMarketRefresh } = useMarketRefresh()
  const { profileId, isAggregate, selection, basisMode } = useProfile()
  const dialog = useDialog()
  const holdingsRequestRef = useRef(0)
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [repairingDivs, setRepairingDivs] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editHolding, setEditHolding] = useState(null)
  const [message, setMessage] = useState(null)
  const [dividendRefreshAccounts, setDividendRefreshAccounts] = useState(null)
  const [dividendRefreshDate, setDividendRefreshDate] = useState(null)
  const [accrualSummary, setAccrualSummary] = useState(null)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('ticker')
  const [sortDir, setSortDir] = useState('asc')
  const [syncingDrip, setSyncingDrip] = useState(false)
  const [showDripMatrix, setShowDripMatrix] = useState(false)
  const [divSourceFilter, setDivSourceFilter] = useState('all')
  const [repairMode, setRepairMode] = useState('mixed')
  const [repairPreview, setRepairPreview] = useState(null)
  const [applyingRepair, setApplyingRepair] = useState(false)
  const [txnTicker, setTxnTicker] = useState(null)    // ticker for transaction modal
  const [txnIsNew, setTxnIsNew] = useState(false)      // true = new ticker via transaction
  const [expandedTickers, setExpandedTickers] = useState({})  // { ticker: [txns] | 'loading' }

  // `silent` re-fetches without flashing the table spinner — used to reconcile
  // a single optimistic edit (e.g. a DRIP toggle) against the backend's
  // authoritative computed values.
  const fetchHoldings = async ({ silent = false } = {}) => {
    const requestId = ++holdingsRequestRef.current
    if (!silent) setLoading(true)
    try {
      const res = await pf('/api/holdings')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load holdings')
      if (requestId !== holdingsRequestRef.current) return
      setHoldings(Array.isArray(data) ? data.map(normalizeHoldingRow) : [])
      setError(null)
    } catch (e) {
      if (requestId !== holdingsRequestRef.current) return
      setError('Failed to load holdings')
    } finally {
      if (requestId === holdingsRequestRef.current && !silent) setLoading(false)
    }
  }

  const fetchAccrualSummary = async () => {
    try {
      const res = await pf('/api/holdings/accrual-summary')
      const data = await res.json()
      setAccrualSummary(data.accounts || [])
    } catch (e) {
      // non-critical — don't surface error
    }
  }

  useEffect(() => {
    setDividendRefreshAccounts(null)
    setDividendRefreshDate(null)
    fetchHoldings()
    fetchAccrualSummary()
  }, [selection, basisMode])

  // Clear any stale repair preview when the selected portfolio changes,
  // so an Apply can't target a scope the preview wasn't built against.
  useEffect(() => { setRepairPreview(null) }, [selection])

  // Close the repair preview modal on Escape.
  useEffect(() => {
    if (!repairPreview) return
    const onKey = (e) => { if (e.key === 'Escape' && !applyingRepair) setRepairPreview(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repairPreview, applyingRepair])

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const getSortValue = (h, key) => {
    if (key === '_shares_if_reinvested') {
      return (h.reinvest === 'Y' && h.estim_payment_per_year && h.current_price)
        ? h.estim_payment_per_year / h.current_price : 0
    }
    if (key === 'percent_of_account') {
      return h.percent_of_account ?? (totalCurrentValue > 0 ? (Number(h.current_value) || 0) / totalCurrentValue : 0)
    }
    return h[key]
  }

  const filteredHoldings = holdings.filter(h => {
    if (divSourceFilter === 'all') return true
    const source = normalizeDivSource(h.dividend_actuals_source)
    if (divSourceFilter === 'imported') return IMPORTED_DIV_SOURCES.includes(source)
    return source === divSourceFilter
  })

  const totalCurrentValue = holdings.reduce((sum, h) => sum + (Number(h.current_value) || 0), 0)

  const sortedHoldings = [...filteredHoldings].sort((a, b) => {
    const col = COLUMNS.find(c => c.key === sortKey)
    const av = getSortValue(a, sortKey)
    const bv = getSortValue(b, sortKey)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    let cmp
    if (col?.type === 'number') {
      cmp = Number(av) - Number(bv)
    } else {
      cmp = String(av).localeCompare(String(bv))
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  const handleRefresh = async () => {
    setRefreshing(true)
    setError(null)
    setMessage(null)
    setDividendRefreshAccounts(null)
    setDividendRefreshDate(null)
    try {
      const data = await runMarketRefresh({ statusMessage: 'Refreshing holdings prices & dividends...' })
      setDividendRefreshAccounts(data.dividend_update_accounts || [])
      setDividendRefreshDate(data.refresh_date || null)
      setMessage(data.message)
      invalidateDashboardCache()
      await fetchHoldings()
      await fetchAccrualSummary()
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleRepairDividendsFromTransactions = async () => {
    setRepairingDivs(true)
    setError(null)
    setMessage(null)
    setDividendRefreshAccounts(null)
    setDividendRefreshDate(null)
    setRepairPreview(null)
    try {
      const res = await pf('/api/repair-dividends-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: repairMode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRepairPreview(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setRepairingDivs(false)
    }
  }

  const handleApplyDividendRepair = async () => {
    setApplyingRepair(true)
    setError(null)
    setMessage(null)
    setDividendRefreshAccounts(null)
    setDividendRefreshDate(null)
    try {
      const res = await pf('/api/repair-dividends-from-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: repairPreview?.mode || repairMode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRepairPreview(null)
      setMessage(data.message)
      await fetchHoldings()
    } catch (e) {
      setError(e.message)
    } finally {
      setApplyingRepair(false)
    }
  }

  const handleSyncDrip = async () => {
    setSyncingDrip(true)
    setError(null)
    setMessage(null)
    setDividendRefreshAccounts(null)
    setDividendRefreshDate(null)
    try {
      const res = await pf('/api/sync-drip-to-owner', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage(data.message)
      await fetchHoldings()
    } catch (e) {
      setError(e.message)
    } finally {
      setSyncingDrip(false)
    }
  }

  const toggleExpand = async (ticker) => {
    if (expandedTickers[ticker]) {
      setExpandedTickers(prev => { const next = { ...prev }; delete next[ticker]; return next })
      return
    }
    setExpandedTickers(prev => ({ ...prev, [ticker]: 'loading' }))
    try {
      const res = await pf(`/api/holdings/${ticker}/transactions`)
      const data = await res.json()
      setExpandedTickers(prev => ({ ...prev, [ticker]: data }))
    } catch {
      setExpandedTickers(prev => ({ ...prev, [ticker]: [] }))
    }
  }

  const handleAdd = () => {
    setEditHolding(null)
    setShowModal(true)
  }

  const handleEdit = (h) => {
    setEditHolding(h)
    setShowModal(true)
  }

  const handleDelete = async (ticker) => {
    if (!await dialog.confirm(`Delete ${ticker}?`)) return
    setError(null)
    setDividendRefreshAccounts(null)
    setDividendRefreshDate(null)
    try {
      const res = await pf(`/api/holdings/${ticker}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage(`${ticker} deleted`)
      invalidateDashboardCache()
      fetchHoldings()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleSave = async (payload) => {
    setError(null)
    setMessage(null)
    setDividendRefreshAccounts(null)
    setDividendRefreshDate(null)
    const isEdit = !!editHolding

    try {
      const url = isEdit ? `/api/holdings/${payload.ticker}` : `/api/holdings`
      const res = await pf(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage(data.message)
      setShowModal(false)
      invalidateDashboardCache()
      fetchHoldings()
    } catch (e) {
      setError(e.message)
    }
  }

  const fmt = (v, decimals = 2) => {
    if (v == null) return '-'
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  }

  const fmtM = (v, decimals = 2) => formatMoney(v, { digits: decimals, fallback: '-' })

  const fmtPct = (v) => {
    if (v == null) return '-'
    return (Number(v) * 100).toFixed(2) + '%'
  }

  const fmtCurrency = (v) => formatMoney(v, { zeroIfInvalid: true })

  const fmtDateLabel = (v) => {
    if (!v) return 'refresh date'
    const parsed = new Date(`${v}T00:00:00`)
    return Number.isNaN(parsed.getTime())
      ? v
      : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const fmtShortDate = (v) => {
    if (!v) return '-'
    const parsed = new Date(`${v}T00:00:00`)
    return Number.isNaN(parsed.getTime())
      ? v
      : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const sourceBadge = (source) => {
    const value = normalizeDivSource(source)
    const meta = DIV_SOURCE_META[value]
    const label = meta ? meta.label : value
    const color = meta ? meta.color : DIV_SOURCE_META.none.color
    return <span title={`Dividend actuals source: ${value}`} style={{ color, fontWeight: value === 'none' ? 400 : 700 }}>{label}</span>
  }

  const sortArrow = (key) => {
    if (sortKey !== key) return ' \u2195'
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC'
  }

  const incTotals = React.useMemo(() => {
    const sum = (key) => filteredHoldings.reduce((s, h) => s + (Number(h[key]) || 0), 0)
    const monthlyIncome = sum('approx_monthly_income')
    const reinvested = sum('monthly_income_reinvested')
    return {
      monthlyIncome,
      reinvested,
      notReinvested: sum('monthly_income_not_reinvested'),
      reinvestPct: monthlyIncome > 0 ? (reinvested / monthlyIncome) * 100 : 0,
    }
  }, [filteredHoldings])

  const activeRepairModeLabel = DIV_REPAIR_MODES.find(opt => opt.value === (repairPreview?.mode || repairMode))?.label || DIV_REPAIR_MODES[0].label
  const previewTotals = repairPreview?.source_totals || {}
  const previewImportedTotal = repairPreview?.broker_updated ?? IMPORTED_DIV_SOURCES.reduce((sum, key) => sum + (previewTotals[key] || 0), 0)
  const hasDividendRefreshResult = Array.isArray(dividendRefreshAccounts)
  const dividendRefreshDateLabel = fmtDateLabel(dividendRefreshDate)

  return (
    <div className="page">
      {isAggregate && (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          Aggregate view — edits will apply to the portfolio with the largest position for each ticker.
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <h1>Manage Holdings</h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => navigate('/import')}>
            Import Holdings
          </button>
          <select
            value={divSourceFilter}
            onChange={(e) => setDivSourceFilter(e.target.value)}
            title="Filter dividend actuals source"
            aria-label="Filter holdings by dividend actuals source"
            style={{ minWidth: 120, padding: '0.55rem 0.65rem' }}
          >
            {DIV_SOURCE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <button className="btn btn-primary" onClick={handleRefresh} disabled={refreshing || holdings.length === 0}>
            {refreshing ? <><span className="spinner" /> Refreshing...</> : 'Refresh Prices & Divs'}
          </button>
          <select
            value={repairMode}
            onChange={(e) => setRepairMode(e.target.value)}
            title="Dividend repair mode"
            aria-label="Dividend repair source mode"
            disabled={repairingDivs || applyingRepair}
            style={{ minWidth: 170, padding: '0.55rem 0.65rem' }}
          >
            {DIV_REPAIR_MODES.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={handleRepairDividendsFromTransactions} disabled={repairingDivs || applyingRepair || holdings.length === 0}>
            {repairingDivs ? <><span className="spinner" /> Previewing...</> : 'Preview Div Repair'}
          </button>
          {profileId === 1 && (
            <>
              <button className="btn btn-secondary" onClick={() => setShowDripMatrix(true)} disabled={holdings.length === 0}>
                DRIP Matrix
              </button>
              <button className="btn btn-secondary" onClick={handleSyncDrip} disabled={syncingDrip || holdings.length === 0}>
                {syncingDrip ? <><span className="spinner" /> Syncing...</> : 'Sync DRIP from Accounts'}
              </button>
            </>
          )}
          <button className="btn btn-success" onClick={handleAdd}>+ Add Holding</button>
          <button className="btn btn-success" style={{ background: 'var(--success-solid)' }} onClick={() => { setTxnTicker(null); setTxnIsNew(true) }}>+ Add/Edit via Transaction</button>
        </div>
      </div>

      {hasDividendRefreshResult && (
        <section style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--accent-2)' }}>Latest Refresh Result</h2>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim-2)' }}>{dividendRefreshDateLabel}</div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {dividendRefreshAccounts.map(account => {
              const distributions = account.distributions_today || []
              const distributionTotal = distributions.reduce((sum, item) => sum + Number(item.amount || 0), 0)
              const insertedPayments = Number(account.history_payments_inserted || 0)
              const updatedPayments = Number(account.history_payments_updated || 0)
              const existingPayments = Number(account.history_payments_existing || 0)
              const changedDividendFields = Number(account.dividend_updates || 0)
              return (
                <div key={account.profile_id} className="card" style={{
                  flex: '1 1 220px', minWidth: 180, padding: '0.75rem 1rem',
                  borderTop: '3px solid var(--success-solid)',
                }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                    {account.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--p-4fc3f7)' }}>
                      {fmtCurrency(distributionTotal)}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: 'var(--p-a5d6a7)' }}>
                      month-to-date payable distributions
                      <InfoHint text="Total estimated cash from holdings with pay dates from the start of the refresh month through the refresh date. These can be inserted, updated, or skipped if payment history already has the row." />
                    </span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--p-78909c)', marginTop: '0.2rem' }}>
                    {fmtCurrency(account.accrued_dividends)} post-refresh accrual estimate
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--p-78909c)', marginTop: '0.2rem' }}>
                    <span>{changedDividendFields} holding dividend field{changedDividendFields === 1 ? '' : 's'} changed</span>
                    <InfoHint text="Holding fields are the dividend metadata columns on the holdings row, such as dividend/share, ex-date, pay date, frequency, YTD, and current-month income." />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--p-78909c)', marginTop: '0.2rem', lineHeight: 1.35 }}>
                    <span>Payment history: {insertedPayments} recorded, {updatedPayments} updated, {existingPayments} already existed</span>
                    <InfoHint text="Payment history rows are dividend_payments entries created by Refresh for payable distributions. Existing imported or already-matching refresh rows are counted separately." />
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim-2)', marginTop: '0.45rem' }}>
                    {distributions.length > 0 ? `Payable distributions through ${dividendRefreshDateLabel}` : `No payable distributions through ${dividendRefreshDateLabel}`}
                  </div>
                  {distributions.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
                      {distributions.map(item => (
                        <span key={item.ticker} style={{
                          display: 'inline-flex', gap: '0.25rem', alignItems: 'center',
                          padding: '0.2rem 0.45rem', borderRadius: 4,
                          background: 'rgba(76, 175, 80, 0.12)', color: 'var(--p-c8e6c9)',
                          fontSize: '0.72rem', whiteSpace: 'nowrap',
                        }}>
                          <strong style={{ color: 'var(--p-81c784)' }}>{item.ticker}</strong>
                          {fmtCurrency(item.amount)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {accrualSummary && accrualSummary.length > 0 && (
        <section style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: 'var(--accent-2)' }}>Post-Refresh Accrual Estimate</h2>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {accrualSummary.map(account => {
              const days = account.days_since_last_refresh
              const hasData = days != null
              const payments = Array.isArray(account.payment_details) ? account.payment_details : []
              return (
                <div key={account.profile_id} className="card" style={{
                  flex: '1 1 250px', minWidth: 220, padding: '0.65rem 1rem',
                  borderTop: '3px solid var(--primary-hover)',
                }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>
                    {account.name}
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--p-4fc3f7)' }}>
                    {hasData ? fmtCurrency(account.accrued_dividends) : '-'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--p-78909c)', marginTop: '0.15rem' }}>
                    {hasData
                      ? account.confirmed_payments > 0
                        ? `${account.confirmed_payments} payment${account.confirmed_payments !== 1 ? 's' : ''} since refresh`
                        : `est. over ${days < 1 ? '<1' : Math.round(days)} day${Math.round(days) !== 1 ? 's' : ''}`
                      : 'no prior refresh'}
                  </div>
                  {payments.length > 0 && (
                    <div style={{ display: 'grid', gap: '0.25rem', marginTop: '0.5rem' }}>
                      {payments.map((payment, idx) => (
                        <div
                          key={`${account.profile_id}-${payment.ticker}-${payment.expected_pay_date}-${idx}`}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(3.25rem, 1fr) auto auto',
                            alignItems: 'center',
                            gap: '0.45rem',
                            fontSize: '0.72rem',
                            color: 'var(--p-b7c7d9)',
                          }}
                        >
                          <strong style={{ color: 'var(--p-81d4fa)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {payment.ticker}
                          </strong>
                          <span style={{ color: 'var(--text-dim-2)', whiteSpace: 'nowrap' }}>{fmtShortDate(payment.expected_pay_date)}</span>
                          <span style={{ color: 'var(--p-c8e6c9)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {fmtCurrency(payment.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!loading && holdings.length > 0 && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div className="card" style={{ flex: '1 1 140px', minWidth: 140, padding: '0.65rem 1rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Est. Monthly Income</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--pos)' }}>{fmtM(incTotals.monthlyIncome)}</div>
          </div>
          <div className="card" style={{ flex: '1 1 140px', minWidth: 140, padding: '0.65rem 1rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mo$ Reinvested</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--accent-bright)' }}>{fmtM(incTotals.reinvested)}</div>
          </div>
          <div className="card" style={{ flex: '1 1 140px', minWidth: 140, padding: '0.65rem 1rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mo$ Not Reinvested</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--warning-money)' }}>{fmtM(incTotals.notReinvested)}</div>
          </div>
          <div className="card" style={{ flex: '1 1 140px', minWidth: 140, padding: '0.65rem 1rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>% Reinvested</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--pos-muted)' }}>{incTotals.reinvestPct.toFixed(1)}%</div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
      ) : holdings.length === 0 ? (
        <div className="card">
          <p>No holdings yet. Add one manually or import from the Import page.</p>
        </div>
      ) : (
        <div className="sticky-table-wrap">
          <table style={{ minWidth: HOLDINGS_TABLE_MIN_WIDTH, tableLayout: 'fixed' }}>
            <colgroup>
              {COLUMNS.map((col, i) => (
                <col key={col.key} style={{ width: columnWidth(col, i) }} />
              ))}
              <col style={{ width: ACTIONS_COLUMN_WIDTH }} />
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map((col, i) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={i < FROZEN_COLS ? 'frozen-col' : undefined}
                    title={col.tip || ''}
                    style={{
                      cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
                      textAlign: col.align || 'left',
                      ...(i < FROZEN_COLS ? {
                        position: 'sticky',
                        left: FROZEN_LEFT[i],
                        width: FROZEN_WIDTHS[i],
                        minWidth: FROZEN_WIDTHS[i],
                        maxWidth: FROZEN_WIDTHS[i],
                        boxSizing: 'border-box',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        zIndex: 4,
                      } : {
                        width: col.width || DEFAULT_COLUMN_WIDTH,
                        minWidth: col.width || DEFAULT_COLUMN_WIDTH,
                        boxSizing: 'border-box',
                      }),
                    }}
                  >
                    {col.label}{col.tip && !col.compact ? ' ⓘ' : ''}<span style={{ fontSize: '0.65rem', opacity: 0.7 }}>{sortArrow(col.key)}</span>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map(h => (
                <React.Fragment key={h.ticker}>
                <tr>
                  <td className="frozen-col" style={{ fontWeight: 600, position: 'sticky', left: FROZEN_LEFT[0], width: FROZEN_WIDTHS[0], minWidth: FROZEN_WIDTHS[0], maxWidth: FROZEN_WIDTHS[0], boxSizing: 'border-box', overflow: 'hidden', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span
                        onClick={() => toggleExpand(h.ticker)}
                        style={{ cursor: 'pointer', fontSize: '0.7rem', opacity: 0.7, userSelect: 'none', width: '12px' }}
                        title="Show/hide transaction lots"
                      >
                        {expandedTickers[h.ticker] ? '\u25BC' : '\u25B6'}
                      </span>
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); handleEdit(h) }}
                        style={{ color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer' }}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                      >
                        {h.ticker}
                      </a>
                    </div>
                  </td>
                  <td className="frozen-col" style={{ position: 'sticky', left: FROZEN_LEFT[1], width: FROZEN_WIDTHS[1], minWidth: FROZEN_WIDTHS[1], maxWidth: FROZEN_WIDTHS[1], boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 1 }}>
                    {h.description || '-'}
                  </td>
                  <td className="frozen-col" style={{ position: 'sticky', left: FROZEN_LEFT[2], width: FROZEN_WIDTHS[2], minWidth: FROZEN_WIDTHS[2], maxWidth: FROZEN_WIDTHS[2], boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 1 }}>{h.category || '-'}</td>
                  <td className="frozen-col" style={{ position: 'sticky', left: FROZEN_LEFT[3], width: FROZEN_WIDTHS[3], minWidth: FROZEN_WIDTHS[3], maxWidth: FROZEN_WIDTHS[3], boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 1 }}>{fmtPct(h.percent_of_account ?? (totalCurrentValue > 0 ? (Number(h.current_value) || 0) / totalCurrentValue : 0))}</td>
                  <td className="frozen-col" style={{ position: 'sticky', left: FROZEN_LEFT[4], width: FROZEN_WIDTHS[4], minWidth: FROZEN_WIDTHS[4], maxWidth: FROZEN_WIDTHS[4], boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 1 }}>{fmt(h.quantity)}</td>
                  <td>{h.purchase_date || '-'}</td>
                  <td>{fmt(h.base_quantity, 4)}</td>
                  <td>{fmt(h.shares_bought_from_dividend, 4)}</td>
                  <td>{formatMoney(h.total_cash_reinvested, { fallback: '-' })}</td>
                  <td>{fmtM(h.price_paid, 4)}</td>
                  <td>{fmtM(h.current_price)}</td>
                  <td>{fmtM(h.purchase_value)}</td>
                  <td>{fmtM(h.current_value)}</td>
                  <td style={{ color: h.gain_or_loss >= 0 ? 'var(--p-81c784)' : 'var(--p-ef9a9a)' }}>
                    {fmtM(h.gain_or_loss)}
                  </td>
                  <td style={{ color: h.gain_or_loss_percentage >= 0 ? 'var(--p-81c784)' : 'var(--p-ef9a9a)' }}>
                    {fmtPct(h.gain_or_loss_percentage)}
                  </td>
                  <td>{fmtM(h.div, 4)}</td>
                  <td>{h.div_frequency || '-'}</td>
                  <td>{h.ex_div_date || '-'}</td>
                  <td>{h.div_pay_date || '-'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={h.reinvest === 'Y'}
                      onChange={async () => {
                        const newVal = h.reinvest === 'Y' ? 'N' : 'Y'
                        const mi = Number(h.approx_monthly_income) || 0
                        const ri = Number(h.monthly_income_reinvested) || 0
                        // Only fake an all-or-nothing split when the holding is
                        // already wholly reinvested or wholly not (single account).
                        // A partial DRIP ratio (Owner/aggregate, where some
                        // sub-accounts reinvest and others don't) must NOT snap to
                        // 100%/0% — flip just the flag and let the silent refetch
                        // below pull the backend's true split.
                        const isAllOrNothing = ri < 0.005 || Math.abs(ri - mi) < 0.005
                        setHoldings(prev => prev.map(row => {
                          if (row.ticker !== h.ticker) return row
                          if (!isAllOrNothing) return { ...row, reinvest: newVal }
                          return {
                            ...row,
                            reinvest: newVal,
                            monthly_income_reinvested: newVal === 'Y' ? mi : 0,
                            monthly_income_not_reinvested: newVal === 'Y' ? 0 : mi,
                          }
                        }))
                        try {
                          await pf(`/api/holdings/${h.ticker}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ reinvest: newVal }),
                          })
                          invalidateDashboardCache()
                          // Reconcile with the backend's authoritative split so
                          // partial reinvestment ratios stay accurate.
                          await fetchHoldings({ silent: true })
                        } catch (e) {
                          setHoldings(prev => prev.map(row =>
                            row.ticker === h.ticker ? { ...row, reinvest: h.reinvest, monthly_income_reinvested: h.monthly_income_reinvested, monthly_income_not_reinvested: h.monthly_income_not_reinvested } : row
                          ))
                          setError(e.message)
                        }
                      }}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                  </td>
                  <td>{fmtM(h.estim_payment_per_year, 3)}</td>
                  <td>{fmtM(h.approx_monthly_income, 3)}</td>
                  <td>{fmtPct(h.annual_yield_on_cost)}</td>
                  <td>{fmtPct(h.current_annual_yield)}</td>
                  <td>{fmtM(h.dividend_paid)}</td>
                  <td>{fmtM(h.ytd_divs)}</td>
                  <td>{fmtM(h.total_divs_received)}</td>
                  <td>{fmtPct(h.paid_for_itself)}</td>
                  <td>{sourceBadge(h.dividend_actuals_source)}</td>
                  <td>
                    {h.reinvest === 'Y' && h.estim_payment_per_year && h.current_price
                      ? fmt(h.estim_payment_per_year / h.current_price, 3)
                      : '-'}
                  </td>
                  <td style={{ color: h.realized_gains > 0 ? 'var(--p-81c784)' : h.realized_gains < 0 ? 'var(--p-ef9a9a)' : undefined }}>
                    {h.realized_gains ? formatMoney(h.realized_gains) : '-'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="btn btn-primary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={() => handleEdit(h)}>Edit</button>
                      <button className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={() => { setTxnTicker(h.ticker); setTxnIsNew(false) }}>Txn</button>
                      <button className="btn btn-danger" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={() => handleDelete(h.ticker)}>Del</button>
                    </div>
                  </td>
                </tr>
                {expandedTickers[h.ticker] && (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} style={{ padding: 0, background: 'rgba(0,0,0,0.2)' }}>
                      {expandedTickers[h.ticker] === 'loading' ? (
                        <div style={{ padding: '0.75rem', textAlign: 'center' }}><span className="spinner" /></div>
                      ) : expandedTickers[h.ticker].length === 0 ? (
                        <div style={{ padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--text-dim-2)' }}>
                          No transaction lots recorded. Use the Txn button to add purchase lots.
                        </div>
                      ) : (
                        <div style={{ padding: '0.5rem 1rem' }}>
                          <table style={{ width: 'auto', fontSize: '0.82rem', marginBottom: 0 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--p-1a3a5c)' }}>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Type</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Date</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Shares</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Price</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Fees</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Cost/Proceeds</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Unrealized G/L</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Realized G/L</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2, borderLeft: '1px solid var(--p-1a3a5c)' }}>Position</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Avg Cost</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Total Cost</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: 'var(--text-dim-2)', position: 'sticky', top: 30, background: 'var(--p-13203a)', zIndex: 2 }}>Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedTickers[h.ticker].map(txn => {
                                const isSell = (txn.transaction_type || 'BUY') === 'SELL'
                                const lotCost = isSell
                                  ? ((txn.shares || 0) * (txn.price_per_share || 0)) - (txn.fees || 0)
                                  : ((txn.shares || 0) * (txn.price_per_share || 0)) + (txn.fees || 0)
                                const lotValue = isSell ? null : (txn.shares || 0) * (h.current_price || 0)
                                const lotGL = isSell ? null : lotValue - (((txn.shares || 0) * (txn.price_per_share || 0)) + (txn.fees || 0))
                                return (
                                  <tr key={txn.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '0.3rem 0.75rem', color: isSell ? 'var(--p-ef9a9a)' : 'var(--p-81c784)', fontWeight: 600 }}>{isSell ? 'SELL' : 'BUY'}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>
                                      <div>{txn.transaction_date || '-'}</div>
                                      {txn.created_at && <div style={{ fontSize: '0.7rem', color: 'var(--text-dim-2)' }}>{new Date(txn.created_at + 'Z').toLocaleString()}</div>}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>{fmt(txn.shares, 3)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>{fmtM(txn.price_per_share)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>{fmtM(txn.fees)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>{fmtM(lotCost)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem', color: lotGL != null ? (lotGL >= 0 ? 'var(--p-81c784)' : 'var(--p-ef9a9a)') : undefined }}>
                                      {formatMoney(lotGL, { fallback: '-' })}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.75rem', color: txn.realized_gain != null ? (txn.realized_gain >= 0 ? 'var(--p-81c784)' : 'var(--p-ef9a9a)') : undefined }}>
                                      {formatMoney(txn.realized_gain, { fallback: '-' })}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.75rem', borderLeft: '1px solid var(--p-1a3a5c)', fontWeight: 600 }}>{fmt(txn.position_after, 3)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>{fmtM(txn.avg_cost_after)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>{fmtM(txn.total_cost_after)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txn.notes || '-'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {sortedHoldings.length === 0 && (
            <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-dim-2)' }}>
              No holdings match the selected Div Src filter.
            </div>
          )}
        </div>
      )}

      {repairPreview && (
        <div
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget && !applyingRepair) setRepairPreview(null) }}
        >
          <div className="modal-content" style={{ maxWidth: 980 }}>
            <button
              className="modal-close"
              onClick={() => setRepairPreview(null)}
              disabled={applyingRepair}
              aria-label="Close"
            >
              &times;
            </button>
            <h2>Dividend Repair Preview</h2>
            <p style={{ color: 'var(--p-cfd8dc)', marginTop: 0 }}>{repairPreview.message}</p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', margin: '1rem 0' }}>
              <div style={{ color: 'var(--p-81c784)', fontWeight: 700 }}>Imported: {previewImportedTotal}</div>
              <div style={{ color: 'var(--accent)', fontWeight: 700 }}>Yahoo: {previewTotals.yahoo ?? repairPreview.yahoo_updated}</div>
              <div style={{ color: 'var(--p-ce93d8)', fontWeight: 700 }}>Snapshot: {previewTotals.snapshot ?? repairPreview.snapshot_updated ?? 0}</div>
              <div style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Dates/Amounts: {repairPreview.metadata_updated ?? 0}</div>
              <div style={{ color: 'var(--p-ffcc80)', fontWeight: 700 }}>Official: {repairPreview.official_updated ?? 0}</div>
              <div style={{ color: 'var(--text-dim-2)', fontWeight: 700 }}>No source: {repairPreview.none_updated}</div>
              <div style={{ color: 'var(--text)', fontWeight: 700 }}>Mode: {activeRepairModeLabel}</div>
            </div>
            <table style={{ width: '100%', fontSize: '0.86rem', marginBottom: '1rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Account</th>
                  {PREVIEW_SOURCE_COLUMNS.map(col => <th key={col.key}>{col.label}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(repairPreview.accounts || []).map(account => (
                  <tr key={account.profile_id}>
                    <td style={{ textAlign: 'left', fontWeight: 600 }}>{account.name}</td>
                    {PREVIEW_SOURCE_COLUMNS.map(col => <td key={col.key}>{account[col.key] || 0}</td>)}
                    <td>{account.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button className="btn btn-secondary" onClick={() => setRepairPreview(null)} disabled={applyingRepair}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleApplyDividendRepair} disabled={applyingRepair || refreshing || repairingDivs}>
                {applyingRepair ? <><span className="spinner" /> Applying...</> : 'Apply Repair'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <AddEditModal
          holding={editHolding}
          onSave={handleSave}
          onCancel={() => setShowModal(false)}
          isEdit={!!editHolding}
          pf={pf}
        />
      )}

      {(txnTicker !== null || txnIsNew) && (
        <TransactionModal
          ticker={txnTicker}
          isNew={txnIsNew}
          onClose={() => { setTxnTicker(null); setTxnIsNew(false) }}
          onSaved={() => {
            invalidateDashboardCache()
            fetchHoldings()
          }}
          pf={pf}
        />
      )}

      {showDripMatrix && (
        <DripMatrixModal
          onClose={() => setShowDripMatrix(false)}
          onSynced={(msg) => { setMessage(msg); fetchHoldings() }}
          pf={pf}
        />
      )}
    </div>
  )
}
