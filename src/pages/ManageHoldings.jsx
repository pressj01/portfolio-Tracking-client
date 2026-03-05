import React, { useState, useEffect } from 'react'

const EMPTY_HOLDING = {
  ticker: '', description: '', classification_type: 'ETF',
  quantity: '', price_paid: '', current_price: '',
  div: '', div_frequency: 'M', reinvest: 'N',
  ex_div_date: '', purchase_date: '',
}

function AddEditModal({ holding, onSave, onCancel, isEdit }) {
  const [form, setForm] = useState(holding || EMPTY_HOLDING)

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.ticker.trim()) return

    const payload = { ...form }
    // Convert numeric fields
    for (const f of ['quantity', 'price_paid', 'current_price', 'div']) {
      if (payload[f] !== '' && payload[f] != null) {
        payload[f] = parseFloat(payload[f])
      } else {
        payload[f] = null
      }
    }
    // Compute derived values
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
    }
    if (payload.div && payload.quantity) {
      payload.estim_payment_per_year = payload.div * payload.quantity
      payload.approx_monthly_income = payload.estim_payment_per_year / 12
    }
    if (payload.div && payload.price_paid) {
      payload.annual_yield_on_cost = payload.div / payload.price_paid
    }
    if (payload.div && payload.current_price) {
      payload.current_annual_yield = payload.div / payload.current_price
    }

    onSave(payload)
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div className="card" style={{ width: '600px', maxHeight: '80vh', overflow: 'auto' }}>
        <h2>{isEdit ? `Edit ${form.ticker}` : 'Add New Holding'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Ticker</label>
              <input
                value={form.ticker}
                onChange={(e) => set('ticker', e.target.value.toUpperCase())}
                disabled={isEdit}
                required
                style={{ width: '100%' }}
              />
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
              <label>Type</label>
              <select value={form.classification_type || 'ETF'} onChange={(e) => set('classification_type', e.target.value)} style={{ width: '100%' }}>
                <option value="ETF">ETF</option>
                <option value="EQUITY">Stock</option>
                <option value="CEF">CEF</option>
                <option value="BDC">BDC</option>
                <option value="REIT">REIT</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Shares</label>
              <input type="number" step="any" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} style={{ width: '100%' }} required />
            </div>
            <div className="form-group">
              <label>Price Paid</label>
              <input type="number" step="any" value={form.price_paid} onChange={(e) => set('price_paid', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Current Price</label>
              <input type="number" step="any" value={form.current_price} onChange={(e) => set('current_price', e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>

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
              <select value={form.reinvest || 'N'} onChange={(e) => set('reinvest', e.target.value)} style={{ width: '100%' }}>
                <option value="Y">Yes</option>
                <option value="N">No</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Ex-Div Date</label>
              <input value={form.ex_div_date || ''} onChange={(e) => set('ex_div_date', e.target.value)} placeholder="MM/DD/YY" style={{ width: '100%' }} />
            </div>
            <div className="form-group">
              <label>Purchase Date</label>
              <input type="date" value={form.purchase_date || ''} onChange={(e) => set('purchase_date', e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="submit" className="btn btn-success">{isEdit ? 'Update' : 'Add'}</button>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ManageHoldings() {
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editHolding, setEditHolding] = useState(null)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  const fetchHoldings = async () => {
    try {
      const res = await fetch('/api/holdings')
      const data = await res.json()
      setHoldings(data)
    } catch (e) {
      setError('Failed to load holdings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchHoldings() }, [])

  const handleAdd = () => {
    setEditHolding(null)
    setShowModal(true)
  }

  const handleEdit = (h) => {
    setEditHolding(h)
    setShowModal(true)
  }

  const handleDelete = async (ticker) => {
    if (!confirm(`Delete ${ticker}?`)) return
    setError(null)
    try {
      const res = await fetch(`/api/holdings/${ticker}`, { method: 'DELETE' })
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
      const url = isEdit ? `/api/holdings/${payload.ticker}` : '/api/holdings'
      const res = await fetch(url, {
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

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Manage Holdings</h1>
        <button className="btn btn-success" onClick={handleAdd}>+ Add Holding</button>
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
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Description</th>
                <th>Shares</th>
                <th>Price Paid</th>
                <th>Current</th>
                <th>Value</th>
                <th>Gain/Loss</th>
                <th>G/L %</th>
                <th>Div/Share</th>
                <th>Freq</th>
                <th>Est. Annual</th>
                <th>Monthly</th>
                <th>Yield</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map(h => (
                <tr key={h.ticker}>
                  <td style={{ fontWeight: 600, color: '#64b5f6' }}>{h.ticker}</td>
                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.description || '-'}
                  </td>
                  <td>{fmt(h.quantity)}</td>
                  <td>${fmt(h.price_paid)}</td>
                  <td>${fmt(h.current_price)}</td>
                  <td>${fmt(h.current_value)}</td>
                  <td style={{ color: h.gain_or_loss >= 0 ? '#81c784' : '#ef9a9a' }}>
                    ${fmt(h.gain_or_loss)}
                  </td>
                  <td style={{ color: h.gain_or_loss_percentage >= 0 ? '#81c784' : '#ef9a9a' }}>
                    {fmtPct(h.gain_or_loss_percentage)}
                  </td>
                  <td>${fmt(h.div, 4)}</td>
                  <td>{h.div_frequency || '-'}</td>
                  <td>${fmt(h.estim_payment_per_year)}</td>
                  <td>${fmt(h.approx_monthly_income)}</td>
                  <td>{fmtPct(h.current_annual_yield)}</td>
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
        />
      )}
    </div>
  )
}
