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

  useEffect(() => {
    pf('/api/categories/data')
      .then(r => r.json())
      .then(d => setCategories(d.categories || []))
      .catch(() => {})
  }, [pf])

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
          <div className="form-row">
            <div className="form-group">
              <label>Shares *</label>
              <input type="number" step="any" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} style={{ width: '100%' }} required />
            </div>
            <div className="form-group">
              <label>Price Paid</label>
              <input type="number" step="0.001" value={round3(form.price_paid)} onChange={(e) => set('price_paid', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Current Price</label>
              <input type="number" step="0.001" value={round3(form.current_price)} onChange={(e) => set('current_price', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Purchase Date</label>
              <input type="date" value={form.purchase_date || ''} onChange={(e) => set('purchase_date', e.target.value)} style={{ width: '100%' }} />
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
]

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
            <button className="btn btn-secondary" onClick={handleSyncDrip} disabled={syncingDrip || holdings.length === 0}>
              {syncingDrip ? <><span className="spinner" /> Syncing...</> : 'Sync DRIP from Accounts'}
            </button>
          )}
          <button className="btn btn-success" onClick={handleAdd}>+ Add Holding</button>
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
                <tr key={h.ticker}>
                  <td className="frozen-col" style={{ fontWeight: 600, position: 'sticky', left: FROZEN_LEFT[0], minWidth: FROZEN_WIDTHS[0], maxWidth: FROZEN_WIDTHS[0], zIndex: 1 }}>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); handleEdit(h) }}
                      style={{ color: '#64b5f6', textDecoration: 'none', cursor: 'pointer' }}
                      onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                      onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                    >
                      {h.ticker}
                    </a>
                  </td>
                  <td className="frozen-col" style={{ position: 'sticky', left: FROZEN_LEFT[1], minWidth: FROZEN_WIDTHS[1], maxWidth: FROZEN_WIDTHS[1], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 1 }}>
                    {h.description || '-'}
                  </td>
                  <td className="frozen-col" style={{ position: 'sticky', left: FROZEN_LEFT[2], minWidth: FROZEN_WIDTHS[2], maxWidth: FROZEN_WIDTHS[2], zIndex: 1 }}>{h.category || '-'}</td>
                  <td className="frozen-col" style={{ position: 'sticky', left: FROZEN_LEFT[3], minWidth: FROZEN_WIDTHS[3], maxWidth: FROZEN_WIDTHS[3], zIndex: 1 }}>{fmt(h.quantity)}</td>
                  <td>${fmt(h.price_paid)}</td>
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
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="btn btn-primary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={() => handleEdit(h)}>Edit</button>
                      <button className="btn btn-danger" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={() => handleDelete(h.ticker)}>Del</button>
                    </div>
                  </td>
                </tr>
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
    </div>
  )
}
