import React, { useState, useEffect } from 'react'
import { useDialog } from '../components/DialogProvider'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

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

function AddEditModal({ holding, onSave, onCancel, isEdit, pf }) {
  const [form, setForm] = useState(() => {
    if (!holding) return EMPTY_HOLDING
    const f = {}
    for (const key of Object.keys(EMPTY_HOLDING)) {
      f[key] = holding[key] != null ? holding[key] : ''
    }
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
    if (payload.div && payload.price_paid) {
      payload.annual_yield_on_cost = payload.div / payload.price_paid
    }
    if (payload.div && payload.current_price) {
      payload.current_annual_yield = payload.div / payload.current_price
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
          <h3 style={{ color: '#90a4ae', fontSize: '0.85rem', marginBottom: '0.5rem', borderBottom: '1px solid #0f3460', paddingBottom: '0.3rem' }}>BASIC INFO</h3>
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
          <h3 style={{ color: '#90a4ae', fontSize: '0.85rem', marginBottom: '0.5rem', marginTop: '1rem', borderBottom: '1px solid #0f3460', paddingBottom: '0.3rem' }}>POSITION</h3>
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
          <h3 style={{ color: '#90a4ae', fontSize: '0.85rem', marginBottom: '0.5rem', marginTop: '1rem', borderBottom: '1px solid #0f3460', paddingBottom: '0.3rem' }}>DIVIDEND INFO</h3>
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
                <span style={{ color: '#90a4ae', fontSize: '0.85rem' }}>{form.reinvest === 'Y' ? 'Yes' : 'No'}</span>
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
          <h3 style={{ color: '#90a4ae', fontSize: '0.85rem', marginBottom: '0.5rem', marginTop: '1rem', borderBottom: '1px solid #0f3460', paddingBottom: '0.3rem' }}>DIVIDEND TRACKING / TOTAL RETURNS</h3>
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
          <h3 style={{ color: '#90a4ae', fontSize: '0.85rem', marginBottom: '0.5rem', marginTop: '1rem', borderBottom: '1px solid #0f3460', paddingBottom: '0.3rem' }}>REINVESTMENT</h3>
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
      notes: txn.notes || '',
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

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div className="card" style={{ width: '95vw', maxWidth: '1200px', maxHeight: '85vh', overflow: 'auto' }}>
        <h2>{isNew ? 'Add Ticker via Transaction' : `Transactions — ${ticker}`}</h2>

        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        {successMsg && <div className="alert alert-success" style={{ marginBottom: '0.75rem' }}>{successMsg}</div>}

        {/* Existing transactions list */}
        {!isNew && transactions.length > 0 && (
          <div style={{ marginBottom: '1rem', overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.85rem', minWidth: '900px' }}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Shares</th>
                  <th>Price</th>
                  <th>Fees</th>
                  <th>Cost/Proceeds</th>
                  <th>Realized G/L</th>
                  <th style={{ borderLeft: '1px solid #1a3a5c' }}>Position</th>
                  <th>Avg Cost</th>
                  <th>Total Cost</th>
                  <th>Notes</th>
                  <th>Actions</th>
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
                    <td style={{ color: isSell ? '#ef9a9a' : '#81c784', fontWeight: 600 }}>{isSell ? 'SELL' : 'BUY'}</td>
                    <td>
                      <div>{txn.transaction_date || '-'}</div>
                      {txn.created_at && <div style={{ fontSize: '0.7rem', color: '#90a4ae' }}>{new Date(txn.created_at + 'Z').toLocaleString()}</div>}
                    </td>
                    <td>{fmt(txn.shares, 3)}</td>
                    <td>${fmt(txn.price_per_share)}</td>
                    <td>${fmt(txn.fees)}</td>
                    <td>${fmt(amount)}</td>
                    <td style={{ color: txn.realized_gain > 0 ? '#81c784' : txn.realized_gain < 0 ? '#ef9a9a' : undefined }}>
                      {txn.realized_gain != null ? '$' + fmt(txn.realized_gain) : '-'}
                    </td>
                    <td style={{ borderLeft: '1px solid #1a3a5c', fontWeight: 600 }}>{fmt(txn.position_after, 3)}</td>
                    <td>${fmt(txn.avg_cost_after)}</td>
                    <td>${fmt(txn.total_cost_after)}</td>
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
        <h3 style={{ color: '#90a4ae', fontSize: '0.85rem', marginBottom: '0.5rem', borderBottom: '1px solid #0f3460', paddingBottom: '0.3rem' }}>
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
                      ? (t === 'BUY' ? '#2e7d32' : '#c62828')
                      : 'rgba(255,255,255,0.1)',
                    color: form.transaction_type === t ? '#fff' : '#90a4ae',
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
            <div style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid #1a3a5c' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#90a4ae' }}>Cost Basis Method:</span>
                {['FIFO', 'SPECIFIC'].map(m => (
                  <button key={m} type="button"
                    style={{
                      padding: '0.25rem 0.8rem', fontSize: '0.8rem', fontWeight: 600, border: 'none', borderRadius: '4px', cursor: 'pointer',
                      background: lotMode === m ? '#1565c0' : 'rgba(255,255,255,0.1)',
                      color: lotMode === m ? '#fff' : '#90a4ae',
                    }}
                    onClick={() => { setLotMode(m); if (m === 'FIFO') setLotAlloc({}) }}
                  >{m === 'FIFO' ? 'FIFO (default)' : 'Specific Lots'}</button>
                ))}
              </div>
              {lotMode === 'SPECIFIC' && (
                <>
                  <table style={{ width: '100%', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1a3a5c' }}>
                        <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, color: '#90a4ae', textAlign: 'left' }}>Buy Date</th>
                        <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, color: '#90a4ae', textAlign: 'right' }}>Price</th>
                        <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, color: '#90a4ae', textAlign: 'right' }}>Cost/Share</th>
                        <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, color: '#90a4ae', textAlign: 'right' }}>Available</th>
                        <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, color: '#90a4ae', textAlign: 'right' }}>Sell Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openLots.map(lot => (
                        <tr key={lot.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '0.3rem 0.5rem' }}>{lot.transaction_date || '-'}</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>${fmt(lot.price_per_share)}</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>${fmt(lot.cost_per_share)}</td>
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
                  <div style={{ fontSize: '0.8rem', color: '#90a4ae' }}>
                    Total to sell: <span style={{ color: '#e0e8f0', fontWeight: 600 }}>
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
              <input type="number" step="any" value={form.shares} onChange={(e) => setForm(prev => ({ ...prev, shares: e.target.value }))} required style={{ width: '100%' }} />
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
const FROZEN_COLS = 4 // first 4 columns are frozen
const FROZEN_WIDTHS = [80, 180, 90, 70] // px widths for frozen cols
const FROZEN_LEFT = FROZEN_WIDTHS.map((_, i) =>
  FROZEN_WIDTHS.slice(0, i).reduce((s, w) => s + w, 0)
)

const COLUMNS = [
  { key: 'ticker', label: 'Ticker', type: 'string' },
  { key: 'description', label: 'Description', type: 'string' },
  { key: 'category', label: 'Category', type: 'string' },
  { key: 'quantity', label: 'Shares', type: 'number' },
  { key: 'price_paid', label: 'Price Paid', type: 'number' },
  { key: 'current_price', label: 'Current', type: 'number' },
  { key: 'purchase_date', label: 'Purchase Date', type: 'string' },
  { key: 'purchase_value', label: 'Cost Basis', type: 'number' },
  { key: 'current_value', label: 'Value', type: 'number' },
  { key: 'gain_or_loss', label: 'Gain/Loss', type: 'number' },
  { key: 'gain_or_loss_percentage', label: 'G/L %', type: 'number' },
  { key: 'div', label: 'Div/Share', type: 'number' },
  { key: 'div_frequency', label: 'Freq', type: 'string' },
  { key: 'ex_div_date', label: 'Ex-Div Date', type: 'string' },
  { key: 'div_pay_date', label: 'Pay Date', type: 'string' },
  { key: 'reinvest', label: 'DRIP', type: 'string' },
  { key: 'estim_payment_per_year', label: 'Est. Annual', type: 'number' },
  { key: 'approx_monthly_income', label: 'Monthly', type: 'number' },
  { key: 'annual_yield_on_cost', label: 'YOC', type: 'number' },
  { key: 'current_annual_yield', label: 'Yield', type: 'number' },
  { key: 'dividend_paid', label: 'Div Paid', type: 'number' },
  { key: 'ytd_divs', label: 'YTD Divs', type: 'number' },
  { key: 'total_divs_received', label: 'Total Divs', type: 'number' },
  { key: 'paid_for_itself', label: 'Paid For Itself', type: 'number' },
  { key: '_shares_if_reinvested', label: 'Shares if Reinvested', type: 'number' },
  { key: 'realized_gains', label: 'Realized G/L', type: 'number' },
]

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

  const thStyle = { padding: '6px 10px', textAlign: 'center', borderBottom: '2px solid #334155', position: 'sticky', top: 0, background: '#0a1929', zIndex: 2 }
  const tdStyle = { padding: '5px 10px', borderBottom: '1px solid #1a2233' }

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
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f1b2d', color: '#e0e0e0', fontSize: '0.8rem', width: 130 }}
            />
            <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
              {syncing ? <><span className="spinner" /> Syncing...</> : 'Sync to Owner'}
            </button>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
        <p style={{ fontSize: '0.75rem', color: '#888', margin: '0 0 0.5rem' }}>
          Toggle DRIP per ticker per account. Click "Sync to Owner" to update Owner's DRIP flags and share counts.
        </p>

        {!loading && tickers.length > 0 && (() => {
          const totalIncome = tickers.reduce((s, t) => s + (t.annual_income || 0), 0)
          const dripIncome = tickers.reduce((s, t) => s + (t.drip_income || 0), 0)
          const pct = totalIncome > 0 ? (dripIncome / totalIncome * 100) : 0
          return (
            <div style={{ display: 'flex', gap: '2rem', marginBottom: '0.75rem', padding: '0.6rem 1rem', background: '#0f1b2d', borderRadius: 6, fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: '#888' }}>Total Annual Income: </span>
                <span style={{ color: '#e0e0e0', fontWeight: 600 }}>${totalIncome.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span style={{ color: '#888' }}>DRIP Income: </span>
                <span style={{ color: '#66bb6a', fontWeight: 600 }}>${dripIncome.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span style={{ color: '#888' }}>% Reinvested: </span>
                <span style={{ color: '#7ecfff', fontWeight: 600 }}>{pct.toFixed(1)}%</span>
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
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#aaa' }}>{t.total_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    {profiles.map(p => {
                      const a = t.accounts[String(p.id)]
                      if (!a) return <td key={p.id} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>—</td>
                      return (
                        <td key={p.id} style={{ ...tdStyle, textAlign: 'center' }}>
                          <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="checkbox" checked={a.reinvest}
                              onChange={() => handleToggle(t.ticker, p.id, a.reinvest)}
                              style={{ accentColor: '#4caf50', cursor: 'pointer' }}
                            />
                            <span style={{ color: a.reinvest ? '#66bb6a' : '#888', fontSize: '0.75rem' }}>
                              {a.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </span>
                          </label>
                        </td>
                      )
                    })}
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: t.owner_drip ? '#66bb6a' : '#888' }}>
                      {t.owner_drip ? `✓ ${t.drip_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dirty && (
          <div style={{ padding: '0.5rem 0 0', fontSize: '0.75rem', color: '#f9a825', textAlign: 'center' }}>
            Changes made — click "Sync to Owner" to update Owner's DRIP flags
          </div>
        )}
      </div>
    </div>
  )
}

export default function ManageHoldings() {
  const pf = useProfileFetch()
  const { profileId, isAggregate, selection } = useProfile()
  const dialog = useDialog()
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editHolding, setEditHolding] = useState(null)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('ticker')
  const [sortDir, setSortDir] = useState('asc')
  const [syncingDrip, setSyncingDrip] = useState(false)
  const [showDripMatrix, setShowDripMatrix] = useState(false)
  const [txnTicker, setTxnTicker] = useState(null)    // ticker for transaction modal
  const [txnIsNew, setTxnIsNew] = useState(false)      // true = new ticker via transaction
  const [expandedTickers, setExpandedTickers] = useState({})  // { ticker: [txns] | 'loading' }

  const fetchHoldings = async () => {
    try {
      const res = await pf('/api/holdings')
      const data = await res.json()
      setHoldings(data)
    } catch (e) {
      setError('Failed to load holdings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchHoldings() }, [selection])

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
    return h[key]
  }

  const sortedHoldings = [...holdings].sort((a, b) => {
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
    try {
      const res = await pf('/api/refresh', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage(data.message)
      await fetchHoldings()
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleSyncDrip = async () => {
    setSyncingDrip(true)
    setError(null)
    setMessage(null)
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
    try {
      const res = await pf(`/api/holdings/${ticker}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage(`${ticker} deleted`)
      fetchHoldings()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleSave = async (payload) => {
    setError(null)
    setMessage(null)
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
      fetchHoldings()
    } catch (e) {
      setError(e.message)
    }
  }

  const fmt = (v, decimals = 2) => {
    if (v == null) return '-'
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  }

  const fmtPct = (v) => {
    if (v == null) return '-'
    return (Number(v) * 100).toFixed(2) + '%'
  }

  const sortArrow = (key) => {
    if (sortKey !== key) return ' \u2195'
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC'
  }

  return (
    <div className="page">
      {isAggregate && (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          Aggregate view — edits will apply to the portfolio with the largest position for each ticker.
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Manage Holdings</h1>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-primary" onClick={handleRefresh} disabled={refreshing || holdings.length === 0}>
            {refreshing ? <><span className="spinner" /> Refreshing...</> : 'Refresh Prices & Divs'}
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
          <button className="btn btn-success" style={{ background: '#2e7d32' }} onClick={() => { setTxnTicker(null); setTxnIsNew(true) }}>+ Add/Edit via Transaction</button>
        </div>
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
      ) : holdings.length === 0 ? (
        <div className="card">
          <p>No holdings yet. Add one manually or import from the Import page.</p>
        </div>
      ) : (
        <div className="sticky-table-wrap">
          <table>
            <thead>
              <tr>
                {COLUMNS.map((col, i) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={i < FROZEN_COLS ? 'frozen-col' : undefined}
                    style={{
                      cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
                      ...(i < FROZEN_COLS ? {
                        position: 'sticky',
                        left: FROZEN_LEFT[i],
                        minWidth: FROZEN_WIDTHS[i],
                        maxWidth: FROZEN_WIDTHS[i],
                        zIndex: 4,
                      } : {}),
                    }}
                  >
                    {col.label}<span style={{ fontSize: '0.65rem', opacity: 0.7 }}>{sortArrow(col.key)}</span>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map(h => (
                <React.Fragment key={h.ticker}>
                <tr>
                  <td className="frozen-col" style={{ fontWeight: 600, position: 'sticky', left: FROZEN_LEFT[0], minWidth: FROZEN_WIDTHS[0], maxWidth: FROZEN_WIDTHS[0], zIndex: 1 }}>
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
                        style={{ color: '#64b5f6', textDecoration: 'none', cursor: 'pointer' }}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                      >
                        {h.ticker}
                      </a>
                    </div>
                  </td>
                  <td className="frozen-col" style={{ position: 'sticky', left: FROZEN_LEFT[1], minWidth: FROZEN_WIDTHS[1], maxWidth: FROZEN_WIDTHS[1], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 1 }}>
                    {h.description || '-'}
                  </td>
                  <td className="frozen-col" style={{ position: 'sticky', left: FROZEN_LEFT[2], minWidth: FROZEN_WIDTHS[2], maxWidth: FROZEN_WIDTHS[2], zIndex: 1 }}>{h.category || '-'}</td>
                  <td className="frozen-col" style={{ position: 'sticky', left: FROZEN_LEFT[3], minWidth: FROZEN_WIDTHS[3], maxWidth: FROZEN_WIDTHS[3], zIndex: 1 }}>{fmt(h.quantity)}</td>
                  <td>${fmt(h.price_paid, 4)}</td>
                  <td>${fmt(h.current_price)}</td>
                  <td>{h.purchase_date || '-'}</td>
                  <td>${fmt(h.purchase_value)}</td>
                  <td>${fmt(h.current_value)}</td>
                  <td style={{ color: h.gain_or_loss >= 0 ? '#81c784' : '#ef9a9a' }}>
                    ${fmt(h.gain_or_loss)}
                  </td>
                  <td style={{ color: h.gain_or_loss_percentage >= 0 ? '#81c784' : '#ef9a9a' }}>
                    {fmtPct(h.gain_or_loss_percentage)}
                  </td>
                  <td>${fmt(h.div, 4)}</td>
                  <td>{h.div_frequency || '-'}</td>
                  <td>{h.ex_div_date || '-'}</td>
                  <td>{h.div_pay_date || '-'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={h.reinvest === 'Y'}
                      onChange={async () => {
                        const newVal = h.reinvest === 'Y' ? 'N' : 'Y'
                        try {
                          await pf(`/api/holdings/${h.ticker}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ reinvest: newVal }),
                          })
                          fetchHoldings()
                        } catch (e) { setError(e.message) }
                      }}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                  </td>
                  <td>${fmt(h.estim_payment_per_year, 3)}</td>
                  <td>${fmt(h.approx_monthly_income, 3)}</td>
                  <td>{fmtPct(h.annual_yield_on_cost)}</td>
                  <td>{fmtPct(h.current_annual_yield)}</td>
                  <td>${fmt(h.dividend_paid)}</td>
                  <td>${fmt(h.ytd_divs)}</td>
                  <td>${fmt(h.total_divs_received)}</td>
                  <td>{fmtPct(h.paid_for_itself)}</td>
                  <td>
                    {h.reinvest === 'Y' && h.estim_payment_per_year && h.current_price
                      ? fmt(h.estim_payment_per_year / h.current_price, 3)
                      : '-'}
                  </td>
                  <td style={{ color: h.realized_gains > 0 ? '#81c784' : h.realized_gains < 0 ? '#ef9a9a' : undefined }}>
                    {h.realized_gains ? '$' + fmt(h.realized_gains) : '-'}
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
                        <div style={{ padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#90a4ae' }}>
                          No transaction lots recorded. Use the Txn button to add purchase lots.
                        </div>
                      ) : (
                        <div style={{ padding: '0.5rem 1rem' }}>
                          <table style={{ width: 'auto', fontSize: '0.82rem', marginBottom: 0 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #1a3a5c' }}>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Type</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Date</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Shares</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Price</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Fees</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Cost/Proceeds</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Unrealized G/L</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Realized G/L</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae', borderLeft: '1px solid #1a3a5c' }}>Position</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Avg Cost</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Total Cost</th>
                                <th style={{ padding: '0.3rem 0.75rem', fontWeight: 600, color: '#90a4ae' }}>Notes</th>
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
                                    <td style={{ padding: '0.3rem 0.75rem', color: isSell ? '#ef9a9a' : '#81c784', fontWeight: 600 }}>{isSell ? 'SELL' : 'BUY'}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>
                                      <div>{txn.transaction_date || '-'}</div>
                                      {txn.created_at && <div style={{ fontSize: '0.7rem', color: '#90a4ae' }}>{new Date(txn.created_at + 'Z').toLocaleString()}</div>}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>{fmt(txn.shares, 3)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>${fmt(txn.price_per_share)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>${fmt(txn.fees)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>${fmt(lotCost)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem', color: lotGL != null ? (lotGL >= 0 ? '#81c784' : '#ef9a9a') : undefined }}>
                                      {lotGL != null ? '$' + fmt(lotGL) : '-'}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.75rem', color: txn.realized_gain != null ? (txn.realized_gain >= 0 ? '#81c784' : '#ef9a9a') : undefined }}>
                                      {txn.realized_gain != null ? '$' + fmt(txn.realized_gain) : '-'}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.75rem', borderLeft: '1px solid #1a3a5c', fontWeight: 600 }}>{fmt(txn.position_after, 3)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>${fmt(txn.avg_cost_after)}</td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>${fmt(txn.total_cost_after)}</td>
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
          onSaved={fetchHoldings}
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
