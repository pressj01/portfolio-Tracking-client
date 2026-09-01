import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDialog } from '../components/DialogProvider'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useMarketRefresh } from '../context/MarketRefreshContext'
import { clearAllDashboardCache } from '../utils/dashboardCache'
import { formatMoney } from '../utils/money'
import ColumnCustomizer from '../components/ColumnCustomizer'
import { useColumnLayout } from '../utils/useColumnLayout'
import { insertMissingKeysAfter } from '../utils/columnLayout'
import {
  MIN_PERFORMANCE_DATE,
  PERFORMANCE_PERIODS,
  PERFORMANCE_RANGE_NOTE,
  addCustomRangeParams,
  customRangeError,
  formatPerformanceRange,
  HOLDINGS_LIFETIME_MATCH_NOTE,
  TRACKER_SCOPE_NOTE,
  OPEN_LOT_SCOPE_NOTE,
  COST_BASIS_SCOPE_NOTE,
  isLifetimePerformancePeriod,
  readSharedPerformanceRange,
  todayInputValue,
} from '../utils/performancePeriods'
import useSharedPerformanceRange from '../utils/useSharedPerformanceRange'
import useSharedTrackerCharts from '../utils/useSharedTrackerCharts'
import {
  accountPercent,
  computeHoldingsTableTotals,
  sharesIfReinvested,
} from '../utils/holdingsTableTotals'
import { prorateAnnualYield, returnVsYield } from '../utils/returnVsYield'
import { useTickerResearch } from '../context/TickerResearchContext'

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

// Payments per year by frequency code. '' is a deliberate "no distributions"
// (a growth stock, a non-payer like a penny stock) and must annualize to zero
// rather than falling back to a default cadence, or the holding is credited
// with income it never pays.
const FREQ_PAYMENTS_PER_YEAR = { W: 52, M: 12, Q: 4, SA: 2, A: 1 }

function paymentsPerYear(freq) {
  return FREQ_PAYMENTS_PER_YEAR[String(freq || '').toUpperCase()] || 0
}

// The table stores purchase_date as ISO (YYYY-MM-DD) and ex_div_date /
// div_pay_date as MM/DD/YY — neither matches the MM/DD/YYYY the rest of the
// app uses, so both get normalized to that for display.
function formatMDY(value) {
  const raw = String(value || '')
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (mdy) {
    const month = mdy[1].padStart(2, '0')
    const day = mdy[2].padStart(2, '0')
    const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]
    return `${month}/${day}/${year}`
  }
  return value
}

// Override expiry arrives as a plain ISO date. Split it by hand rather than
// letting Date parse it, which reads bare YYYY-MM-DD as UTC and shows the day
// before for anyone west of Greenwich.
function formatOverrideDate(value) {
  const parts = String(value || '').split('-')
  if (parts.length !== 3) return value
  const [y, m, d] = parts.map(Number)
  if (!y || !m || !d) return value
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

const OVERRIDE_NOTE_STYLE = {
  fontSize: '0.72rem', color: 'var(--text-dim-2)', marginTop: '0.25rem', lineHeight: 1.35,
}
const OVERRIDE_LINK_STYLE = {
  background: 'none', border: 'none', padding: 0, color: 'var(--accent)',
  cursor: 'pointer', font: 'inherit', textDecoration: 'underline',
}

function invalidateDashboardCache() {
  try {
    // A holding can feed its individual account, Owner, and one or more
    // aggregate portfolios. Clear every Dashboard view so none of those
    // dependent views can preload values from before the edit.
    clearAllDashboardCache()
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
      const value = key === 'div_pay_date' && holding.stored_div_pay_date != null
        ? holding.stored_div_pay_date
        : holding[key]
      f[key] = value != null ? value : ''
    }
    // An existing holding keeps a blank frequency as "detect it for me".
    // Only a brand-new holding falls back to the EMPTY_HOLDING default.
    return f
  })
  const [looking, setLooking] = useState(false)
  const [lookupMsg, setLookupMsg] = useState(null)
  const [categories, setCategories] = useState([])
  const [hasTxns, setHasTxns] = useState(false)
  // A hand-typed Div/Share holds off the market refresh until the fund declares
  // its next distribution. Show when that is, and let it be handed back early.
  const [clearDivOverride, setClearDivOverride] = useState(false)
  const divOverrideUntil = holding?.div_manual_until || null
  // Hand-typed ex-div/pay dates hold until the pay date they name has passed,
  // after which the projected schedule is the better answer again.
  const [clearDatesOverride, setClearDatesOverride] = useState(false)
  const datesOverrideUntil = holding?.div_dates_manual_until || null
  // The cadence pin is the one with no clock on it: a wrong frequency is
  // permanently wrong. Clearing the field is how it comes off.
  const freqPinned = !!holding?.div_frequency_locked

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
      const annual = div * qty * paymentsPerYear(next.div_frequency)
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
    // Send a blank frequency through untouched: it is the user choosing "no
    // distributions", and coercing it to a default here is what made that
    // choice impossible to express.
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
    const mult = paymentsPerYear(payload.div_frequency)
    if (payload.div && payload.quantity && mult) {
      payload.estim_payment_per_year = parseFloat((payload.div * payload.quantity * mult).toFixed(3))
      payload.approx_monthly_income = parseFloat((payload.estim_payment_per_year / 12).toFixed(3))
    }
    // A blank cadence means "work it out", not "pays nothing", so the income
    // figures are left alone: the backend carries the current annual estimate
    // forward until the refresh re-derives a frequency to recompute it from.
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
    if (clearDivOverride) payload.div_manual_clear = true
    if (clearDatesOverride) payload.div_dates_manual_clear = true

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
              {isEdit && form.ticker.trim().toUpperCase() !== holding?.ticker?.toUpperCase() && (
                <small style={{ display: 'block', marginTop: '0.35rem', color: 'var(--warning-text)', lineHeight: 1.35 }}>
                  Saving will rename {holding.ticker} to {form.ticker.trim().toUpperCase()} across every portfolio that holds it, including its transactions, dividends, categories, and ticker settings.
                </small>
              )}
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
              {divOverrideUntil && !clearDivOverride && (
                <div style={OVERRIDE_NOTE_STYLE}>
                  Your amount is in use through {formatOverrideDate(divOverrideUntil)}, then market data resumes.{' '}
                  <button type="button" onClick={() => setClearDivOverride(true)} style={OVERRIDE_LINK_STYLE}>
                    Use market data now
                  </button>
                </div>
              )}
              {clearDivOverride && (
                <div style={OVERRIDE_NOTE_STYLE}>
                  Market data resumes on the next refresh.{' '}
                  <button type="button" onClick={() => setClearDivOverride(false)} style={OVERRIDE_LINK_STYLE}>
                    Undo
                  </button>
                </div>
              )}
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select value={form.div_frequency || ''} onChange={(e) => set('div_frequency', e.target.value)} style={{ width: '100%' }}>
                <option value="">Auto — detect from market data</option>
                <option value="W">Weekly</option>
                <option value="M">Monthly</option>
                <option value="Q">Quarterly</option>
                <option value="SA">Semi-Annual</option>
                <option value="A">Annual</option>
              </select>
              {freqPinned && form.div_frequency && (
                <div style={OVERRIDE_NOTE_STYLE}>
                  Your cadence is in use everywhere until you change it.{' '}
                  <button type="button" onClick={() => set('div_frequency', '')} style={OVERRIDE_LINK_STYLE}>
                    Use market data now
                  </button>
                </div>
              )}
              {freqPinned && !form.div_frequency && (
                <div style={OVERRIDE_NOTE_STYLE}>
                  Market data resumes on save.{' '}
                  <button type="button" onClick={() => set('div_frequency', holding?.div_frequency || 'M')} style={OVERRIDE_LINK_STYLE}>
                    Undo
                  </button>
                </div>
              )}
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
              {datesOverrideUntil && !clearDatesOverride && (
                <div style={OVERRIDE_NOTE_STYLE}>
                  Your dates are in use through {formatOverrideDate(datesOverrideUntil)}, then projected dates resume.{' '}
                  <button type="button" onClick={() => setClearDatesOverride(true)} style={OVERRIDE_LINK_STYLE}>
                    Use market data now
                  </button>
                </div>
              )}
              {clearDatesOverride && (
                <div style={OVERRIDE_NOTE_STYLE}>
                  Projected dates resume on the next refresh.{' '}
                  <button type="button" onClick={() => setClearDatesOverride(false)} style={OVERRIDE_LINK_STYLE}>
                    Undo
                  </button>
                </div>
              )}
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

function TransactionModal({ ticker, onClose, onSaved, onOpeningLotRecorded, pf, isNew }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(!isNew)
  const [form, setForm] = useState({
    ticker: ticker || '', transaction_type: 'BUY', shares: '', price_per_share: '', fees: '', transaction_date: '', acquired_date: '', notes: '',
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
  const [reorderingId, setReorderingId] = useState(null)
  const [basisGap, setBasisGap] = useState(null)
  // The shares the tracker invents when the ledger cannot account for the
  // position. Offering to record them turns a silent assumption into a row.
  const [openingLot, setOpeningLot] = useState(null)
  const [recordingLot, setRecordingLot] = useState(false)
  const handleOpeningLotAction = () => {
    if (openingLot?.requires_account_selection || openingLot?.editable_here === false) {
      window.alert(
        openingLot?.repair_message
        || `You must be in the ${openingLot?.account || 'underlying'} account to use this repair.`,
      )
      return
    }
    recordOpeningLot()
  }
  const recordOpeningLot = async () => {
    setRecordingLot(true)
    try {
      const res = await pf(`/api/holdings/${ticker}/opening-lot`, { method: 'POST' })
      const data = await res.json()
      if (data.error) setOpeningLot({ ...openingLot, error: data.error })
      else {
        const before = data.holding_before?.average_cost
        const after = data.holding_after?.average_cost
        const priceChange = before != null && after != null
          ? `Transaction-derived average cost: ${formatMoney(before)} before → ${formatMoney(after)} after.`
          : null
        window.alert([
          data.message || 'Opening lot recorded.',
          `Opening lot price: ${formatMoney(data.price_per_share)} per share.`,
          priceChange,
          'Original and broker cost-basis figures were preserved.',
        ].filter(Boolean).join('\n\n'))
        onSaved()
        onClose()
        onOpeningLotRecorded?.(data)
      }
    } catch (err) {
      setOpeningLot({ ...openingLot, error: String(err?.message || err) })
    } finally {
      setRecordingLot(false)
    }
  }
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
    try {
      const res = await pf(`/api/holdings/${ticker}/basis-gap`)
      setBasisGap(await res.json())
    } catch { /* the gap panel is advisory; failing to load it is not an error */ }
    try {
      const res = await pf(`/api/holdings/${ticker}/opening-lot`)
      setOpeningLot(await res.json())
    } catch { /* advisory as well */ }
  }
  // `pf` changes with the account selector. Keep an Owner-opened repair modal
  // in sync so selecting the named source account enables the same button
  // without making the user close and reopen the ticker.
  useEffect(() => { if (ticker) fetchTxns() }, [ticker, pf])

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
      acquired_date: '',
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
      acquired_date: form.acquired_date || null,
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
      acquired_date: txn.acquired_date || '',
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

  const handleMoveTxn = async (txn, direction) => {
    setError(null)
    const transactionDate = txn.transaction_date || ''
    const sameDay = transactions.filter(item => (
      (item.transaction_date || '') === transactionDate
      && item.profile_id === txn.profile_id
    ))
    const currentIndex = sameDay.findIndex(item => item.id === txn.id)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sameDay.length) return

    const orderedIds = sameDay.map(item => item.id)
    ;[orderedIds[currentIndex], orderedIds[targetIndex]] = [orderedIds[targetIndex], orderedIds[currentIndex]]
    setReorderingId(txn.id)
    try {
      const res = await pf(`/api/holdings/${ticker}/transactions/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: orderedIds }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not update transaction order')
      setSuccessMsg(data.message || 'Transaction order updated and cost basis recalculated.')
      setTimeout(() => setSuccessMsg(null), 4000)
      await fetchTxns()
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setReorderingId(null)
    }
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
            <div style={{ color: 'var(--text-dim-2)', fontSize: '0.78rem', marginBottom: '0.45rem' }}>
              Use the arrows to place same-day buys and sells in their real execution order. FIFO lot matching and cost basis recalculate after each move.
            </div>
            <table style={{ width: '100%', fontSize: '0.85rem', minWidth: '1020px' }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Type</th>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>Date</th>
                  <th
                    title="Execution order for buys and sells sharing this date. This order controls FIFO lot matching."
                    style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}
                  >Same-day Order</th>
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
                  const sameDay = transactions.filter(item => (
                    (item.transaction_date || '') === (txn.transaction_date || '')
                    && item.profile_id === txn.profile_id
                  ))
                  const sameDayIndex = sameDay.findIndex(item => item.id === txn.id)
                  const amount = isSell
                    ? ((txn.shares || 0) * (txn.price_per_share || 0)) - (txn.fees || 0)
                    : ((txn.shares || 0) * (txn.price_per_share || 0)) + (txn.fees || 0)
                  return (
                  <tr key={txn.id}>
                    <td style={{ color: isSell ? 'var(--p-ef9a9a)' : 'var(--p-81c784)', fontWeight: 600 }}>{isSell ? 'SELL' : 'BUY'}</td>
                    <td>
                      <div>{txn.transaction_date || '-'}</div>
                      {txn.acquired_date && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim-2)' }}
                          title="Originally acquired at the delivering broker; the holding period runs from this date.">
                          held since {txn.acquired_date}
                        </div>
                      )}
                      {txn.created_at && <div style={{ fontSize: '0.7rem', color: 'var(--text-dim-2)' }}>{new Date(txn.created_at + 'Z').toLocaleString()}</div>}
                    </td>
                    <td>
                      {sameDay.length > 1 ? (
                        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
                          <span style={{ minWidth: '1.5rem', textAlign: 'center', fontWeight: 700 }}>
                            {sameDayIndex + 1}
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            aria-label={`Move transaction ${txn.id} earlier on ${txn.transaction_date || 'the undated group'}`}
                            title="Move earlier on this date"
                            disabled={sameDayIndex <= 0 || reorderingId != null}
                            onClick={() => handleMoveTxn(txn, -1)}
                            style={{ padding: '0.15rem 0.38rem', fontSize: '0.75rem' }}
                          >↑</button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            aria-label={`Move transaction ${txn.id} later on ${txn.transaction_date || 'the undated group'}`}
                            title="Move later on this date"
                            disabled={sameDayIndex >= sameDay.length - 1 || reorderingId != null}
                            onClick={() => handleMoveTxn(txn, 1)}
                            style={{ padding: '0.15rem 0.38rem', fontSize: '0.75rem' }}
                          >↓</button>
                        </div>
                      ) : (
                        <span title="No other transaction for this ticker shares this date">-</span>
                      )}
                    </td>
                    <td>{fmt(txn.shares, 3)}</td>
                    <td>
                      {fmtM(txn.price_per_share)}
                      {txn.basis_unknown && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => handleEditTxn(txn)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleEditTxn(txn) } }}
                          style={{
                            fontSize: '0.7rem', color: 'var(--p-ffb74d, #ffb74d)', marginTop: '0.15rem',
                            cursor: 'pointer', textDecoration: 'underline dotted',
                          }}
                          title={txn.basis_note || 'Set the cost per share for these shares'}>
                          needs cost basis
                        </div>
                      )}
                    </td>
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

        {/* Shares the tracker is assuming: offer to make them a real row. */}
        {!isNew && openingLot?.needed && (
          <div style={{
            marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 4,
            background: 'rgba(255,184,108,0.10)', border: '1px solid rgba(255,184,108,0.35)',
            fontSize: '0.85rem', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--p-ffb86c)' }}>
              {Number(openingLot.shares).toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
              here are not accounted for by any transaction
            </strong>{' '}
            — {openingLot.account} holds {Number(openingLot.saved_quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })},
            but these buys and sells net to {Number(openingLot.ledger_net).toLocaleString(undefined, { maximumFractionDigits: 4 })}.
            The history starts on {openingLot.first_transaction_date}, so the original purchase is
            not in it. Performance screens already price those shares as if you owned them; recording
            the lot makes that assumption a row you can see, edit, and delete.
            {openingLot.price_per_share != null && (
              <div style={{ marginTop: '0.5rem' }}>
                Would record a <strong>BUY of {Number(openingLot.shares).toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
                on {openingLot.date}</strong> at {fmtM(openingLot.price_per_share)} per share
                ({fmtM(openingLot.cost)} total). {openingLot.price_source} — <strong>not a broker
                figure</strong>. Edit the row afterwards if you have the real purchase price; your
                broker cost basis for the position is left untouched either way.
              </div>
            )}
            {openingLot.error && (
              <div style={{ marginTop: '0.5rem', color: 'var(--neg)' }}>{openingLot.error}</div>
            )}
            <div style={{ marginTop: '0.6rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={recordingLot || (
                  !openingLot.requires_account_selection
                  && openingLot.price_per_share == null
                )}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                onClick={handleOpeningLotAction}
              >
                {recordingLot ? 'Recording…' : 'Record the opening lot'}
              </button>
            </div>
          </div>
        )}

        {/* Cost basis gap: why sells here report no gain, and what fixes it */}
        {!isNew && basisGap?.unpriced_sells > 0 && (
          <div style={{
            marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 4,
            background: 'rgba(255,184,108,0.10)', border: '1px solid rgba(255,184,108,0.35)',
            fontSize: '0.85rem', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--p-ffb86c)' }}>
              {basisGap.unpriced_sells} sale{basisGap.unpriced_sells === 1 ? '' : 's'} here
              report no gain
            </strong>{' '}
            ({fmtM(basisGap.unpriced_proceeds)} of proceeds). Their cost basis could not be
            established, so no gain is calculated rather than the whole proceeds being counted
            as profit. The Annual Tax Report leaves them out of its totals.

            {(basisGap.accounts || []).map(acct => (
              <div key={acct.profile_id} style={{
                marginTop: '0.6rem', paddingTop: '0.5rem',
                borderTop: '1px solid rgba(255,184,108,0.25)',
              }}>
                <div style={{ fontWeight: 600 }}>
                  {acct.profile_name || `Account ${acct.profile_id}`}
                  {!acct.editable_here && (
                    <span style={{ fontWeight: 400, color: 'var(--text-dim-2)' }}>
                      {' '}— switch to this account to make changes
                    </span>
                  )}
                </div>

                {acct.zero_priced_buys.length > 0 && (
                  <div style={{ marginTop: '0.35rem' }}>
                    {acct.zero_priced_buys.length} transferred-in buy
                    {acct.zero_priced_buys.length === 1 ? '' : 's'} arrived with no price.
                    Enter what the shares originally cost and the sales behind them recalculate.
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                      {acct.zero_priced_buys.map(b => (
                        acct.editable_here ? (
                          <button
                            key={b.transaction_id}
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
                            onClick={() => {
                              const txn = transactions.find(t => t.id === b.transaction_id)
                              if (txn) handleEditTxn(txn)
                            }}
                          >
                            Set cost — {fmt(b.shares, 3)} sh on {b.transaction_date}
                          </button>
                        ) : (
                          <span key={b.transaction_id} style={{ fontSize: '0.78rem', color: 'var(--text-dim-2)' }}>
                            {fmt(b.shares, 3)} sh on {b.transaction_date}
                          </span>
                        )
                      ))}
                    </div>
                  </div>
                )}

                {acct.shares_missing_purchase > 0 && (
                  <div style={{ marginTop: '0.35rem' }}>
                    Only {fmt(acct.shares_bought, 3)} shares were ever recorded as bought here,
                    but {fmt(acct.shares_sold, 3)} were sold
                    {acct.shares_transferred_out > 0 &&
                      <>{' '}and {fmt(acct.shares_transferred_out, 3)} transferred out</>}
                    {' '}— leaving <strong>{fmt(acct.shares_missing_purchase, 3)} shares with no
                    purchase behind them</strong>. There is no buy to correct, so import the
                    missing history, or record the opening lot if you know what those shares cost.
                    {acct.editable_here && (
                      <div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem', marginTop: '0.35rem' }}
                          onClick={() => {
                            const base = acct.earliest_transaction || acct.first_unpriced_sell
                            let openingDate = ''
                            if (base) {
                              const d = new Date(`${base}T00:00:00`)
                              d.setDate(d.getDate() - 1)
                              openingDate = d.toISOString().slice(0, 10)
                            }
                            setEditId(null)
                            setForm(prev => ({
                              ...prev,
                              transaction_type: 'BUY',
                              shares: String(acct.shares_missing_purchase),
                              price_per_share: '',
                              fees: '',
                              transaction_date: openingDate,
                              acquired_date: '',
                              notes: '[Opening lot] Purchase history before this date not imported',
                            }))
                            setSuccessMsg('Opening lot prefilled below — enter the cost per share and save.')
                            setTimeout(() => setSuccessMsg(null), 6000)
                          }}
                        >
                          Record opening lot ({fmt(acct.shares_missing_purchase, 3)} sh)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

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
          {form.transaction_type === 'BUY' && (
            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label>Originally Acquired</label>
                <input type="date" min="1900-01-01" max="2099-12-31" value={form.acquired_date || ''}
                  onChange={(e) => setForm(prev => ({ ...prev, acquired_date: e.target.value }))}
                  style={{ width: '100%' }} />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim-2)', marginTop: '0.25rem' }}>
                  Only for shares transferred in from another broker. Set this to the
                  date they were originally bought so the long-term holding period
                  carries over. Leave blank otherwise.
                </div>
              </div>
            </div>
          )}
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

const transactionTypeColor = (type) => {
  if (type === 'SELL') return 'var(--p-ef9a9a)'
  if (type === 'DIVIDEND') return 'var(--p-4fc3f7)'
  return 'var(--p-81c784)'
}

const transactionCashAmount = (txn) => {
  const type = String(txn.transaction_type || 'BUY').toUpperCase()
  if (type === 'DIVIDEND') return Number(txn.dividend_amount) || 0
  const shares = Number(txn.shares) || 0
  const price = Number(txn.price_per_share) || 0
  const fees = Number(txn.fees) || 0
  return type === 'SELL' ? (shares * price) - fees : (shares * price) + fees
}

const isDripBuyTransaction = (txn) => {
  if (String(txn.transaction_type || 'BUY').toUpperCase() !== 'BUY') return false
  const notes = `${txn.notes || ''} ${txn.raw_notes || ''}`.toUpperCase()
  return notes.includes('DIVIDEND_REINVEST') || notes.includes('[DRIP]')
}

const isClosedBuyLot = (txn) => {
  if (String(txn.transaction_type || 'BUY').toUpperCase() !== 'BUY') return false
  return txn.shares_remaining != null && Number(txn.shares_remaining) <= 1e-9
}

function TransactionHistoryModal({ onClose, pf }) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [closedOnly, setClosedOnly] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    pf('/api/transactions/history', { signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Failed to load transaction history')
        return data
      })
      .then(data => {
        if (controller.signal.aborted) return
        setPayload(data)
        setError(null)
      })
      .catch(err => {
        if (err?.name === 'AbortError' || controller.signal.aborted) return
        setError(err.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [pf])

  useEffect(() => {
    const onKeyDown = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const events = useMemo(() => {
    const search = query.trim().toLowerCase()
    return (payload?.events || []).filter(event => {
      const type = String(event.transaction_type || 'BUY').toUpperCase()
      if (typeFilter !== 'ALL' && type !== typeFilter) return false
      if (closedOnly && !event.closed_position) return false
      if (!search) return true
      return [event.ticker, event.notes, event.raw_notes, event.source_account_name]
        .some(value => String(value || '').toLowerCase().includes(search))
    })
  }, [payload, query, typeFilter, closedOnly])

  const summary = payload?.summary || {}
  const fmtNumber = (value, digits = 3) => value == null
    ? '-'
    : Number(value).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
    }}>
      <div className="card" style={{ width: '97vw', maxWidth: 1500, maxHeight: '92vh', overflow: 'hidden', padding: 0 }}>
        <div style={{ padding: '1rem 1.25rem 0.85rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0 }}>Transaction History</h2>
              <div style={{ color: 'var(--text-dim-2)', fontSize: '0.82rem', marginTop: '0.3rem' }}>
                Every saved buy, sell, and actual dividend, including tickers that are no longer held.
              </div>
            </div>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>

          {!loading && !error && (
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
              {[
                ['All', summary.transactions || 0, 'var(--text-strong)'],
                ['Buys', summary.buys || 0, 'var(--p-81c784)'],
                ['Sells', summary.sells || 0, 'var(--p-ef9a9a)'],
                ['Dividends', summary.dividends || 0, 'var(--p-4fc3f7)'],
                ['Closed-position rows', summary.closed_position_events || 0, 'var(--p-ffb74d)'],
              ].map(([label, value, color]) => (
                <span key={label} style={{
                  padding: '0.25rem 0.55rem', borderRadius: 999,
                  border: '1px solid var(--border)', color, fontSize: '0.76rem', fontWeight: 700,
                }}>
                  {label}: {value.toLocaleString()}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', marginTop: '0.85rem', alignItems: 'center' }}>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search ticker, account, or notes"
              aria-label="Search transaction history"
              style={{ minWidth: 260, flex: '1 1 320px' }}
            />
            <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} aria-label="Filter transaction type">
              <option value="ALL">All types</option>
              <option value="BUY">Buys</option>
              <option value="SELL">Sells</option>
              <option value="DIVIDEND">Dividends</option>
            </select>
            <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={closedOnly} onChange={event => setClosedOnly(event.target.checked)} />
              Closed positions only
            </label>
            <span style={{ color: 'var(--text-dim-2)', fontSize: '0.78rem' }}>
              Showing {events.length.toLocaleString()}
            </span>
          </div>
        </div>

        <div style={{ overflow: 'auto', maxHeight: 'calc(92vh - 190px)' }}>
          {loading && <div style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner" /> Loading history...</div>}
          {error && <div className="alert alert-error" style={{ margin: '1rem' }}>{error}</div>}
          {!loading && !error && events.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim-2)' }}>No transactions match these filters.</div>
          )}
          {!loading && !error && events.length > 0 && (
            <table style={{ width: '100%', minWidth: 1180, fontSize: '0.8rem', margin: 0 }}>
              <thead>
                <tr>
                  {['Date', 'Ticker', 'Type', 'Shares', 'Price', 'Fees', 'Cash Amount', 'Realized G/L', 'Account', 'Status', 'Notes'].map(label => (
                    <th key={label} style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2, whiteSpace: 'nowrap' }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(event => {
                  const type = String(event.transaction_type || 'BUY').toUpperCase()
                  const isDividend = type === 'DIVIDEND'
                  const isBuy = type === 'BUY'
                  return (
                    <tr key={event.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{event.transaction_date || '-'}</td>
                      <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{event.ticker || '-'}</td>
                      <td style={{ color: transactionTypeColor(type), fontWeight: 700 }}>{type}</td>
                      <td title={isDividend ? 'This dividend was recorded as cash, so it did not directly add shares.' : undefined}>
                        {isDividend ? fmtNumber(0) : fmtNumber(event.shares)}
                      </td>
                      <td title={isDividend ? 'A cash dividend has no purchase or sale price.' : undefined}>
                        {formatMoney(isDividend ? 0 : event.price_per_share, { fallback: '$0.00' })}
                      </td>
                      <td title={isDividend ? 'No transaction fee was recorded for this dividend.' : undefined}>
                        {formatMoney(isDividend ? 0 : event.fees, { fallback: '$0.00' })}
                      </td>
                      <td>{formatMoney(transactionCashAmount(event), { fallback: '-' })}</td>
                      <td
                        title={isDividend
                          ? 'Dividend income is shown in Cash Amount, not as realized capital gain.'
                          : isBuy
                            ? 'A BUY does not realize a gain or loss. Any result is recorded on the later SELL.'
                            : undefined}
                        style={{ color: event.realized_gain > 0 ? 'var(--p-81c784)' : event.realized_gain < 0 ? 'var(--p-ef9a9a)' : undefined }}
                      >
                        {formatMoney(event.realized_gain, { fallback: '$0.00' })}
                      </td>
                      <td>{event.source_account_name || '-'}</td>
                      <td>
                        {event.closed_position
                          ? <span style={{ color: 'var(--p-ffb74d)', whiteSpace: 'nowrap' }}>Closed position</span>
                          : <span style={{ color: 'var(--p-81c784)' }}>Open</span>}
                      </td>
                      <td title={event.raw_notes || event.notes || ''} style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {event.raw_notes || event.notes || '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// Column definitions for sortable table
// The first FROZEN_COLS visible columns are frozen horizontally. Widths live on
// the column definitions so hiding or reordering cannot shift them out of line.
const FROZEN_COLS = 5
const HOLDINGS_LOCKED_COLS = ['ticker']
// Truncation the frozen cells used to hard-code; now it follows its column.
const TRUNCATED_CELL = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

const CURRENT_MONTH_SHORT = new Date().toLocaleString('en-US', { month: 'short' })

const dripSharePrice = (h) => {
  const currentPrice = Number(h?.current_price || 0)
  if (currentPrice > 0) return currentPrice
  const currentValue = Number(h?.current_value || 0)
  const quantity = Number(h?.quantity || 0)
  return currentValue > 0 && quantity > 0 ? currentValue / quantity : 0
}

const sharesFromDrip = (income, h) => {
  const price = dripSharePrice(h)
  return price > 0 ? Number(income || 0) / price : 0
}

const GRADE_RANK = {
  'A+': 13, A: 12, 'A-': 11, 'B+': 10, B: 9, 'B-': 8,
  'C+': 7, C: 6, 'C-': 5, 'D+': 4, D: 3, 'D-': 2, F: 1,
}

function GradeBadge({ grade }) {
  if (!grade || grade === 'N/A') return <span className="grade-badge grade-na">N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls}`}>{grade}</span>
}

const CLOSURE_TIER = {
  high: { label: 'High', color: 'var(--neg)' },
  elevated: { label: 'Elevated', color: 'var(--warning-money)' },
  watch: { label: 'Watch', color: 'var(--warning-text)' },
  ok: { label: 'OK', color: 'var(--pos)' },
  unknown: { label: '?', color: 'var(--text-dim)' },
}

function ClosureRiskBadge({ info }) {
  if (!info) return <span style={{ color: 'var(--text-dim)' }} title="Not an ETF — individual stocks aren't rated for closure risk.">—</span>
  const tier = CLOSURE_TIER[info.tier] || CLOSURE_TIER.unknown
  if (info.tier === 'ok' || info.tier === 'unknown') {
    return <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }} title={info.reason || ''}>{tier.label}</span>
  }
  return (
    <span
      title={info.reason || ''}
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 10,
        fontSize: '0.68rem',
        fontWeight: 700,
        color: tier.color,
        background: `color-mix(in srgb, ${tier.color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tier.color} 45%, transparent)`,
        whiteSpace: 'nowrap',
      }}
    >
      {tier.label}
    </span>
  )
}

const COLUMNS = [
  { key: 'ticker', label: 'Ticker', width: 80, type: 'string', tip: 'Security ticker symbol' },
  { key: 'description', label: 'Description', width: 180, truncate: true, type: 'string', tip: 'Security name / description' },
  { key: 'category', label: 'Category', width: 96, truncate: true, type: 'string', tip: 'Investment category assigned to this holding' },
  { key: 'percent_of_account', label: '% Acct', width: 76, truncate: true, type: 'number', compact: true, tip: 'Percent of total account value held in this security' },
  { key: 'quantity', label: 'Shares', width: 76, truncate: true, type: 'number', tip: 'Total shares currently held (base + DRIP shares)' },
  { key: 'purchase_date', label: 'Purchased', type: 'string', width: 92, tip: 'Date of original purchase (or earliest lot date)' },
  { key: 'base_quantity', label: 'Base', type: 'number', width: 80, tip: 'Original shares purchased, excluding DRIP-acquired shares' },
  { key: 'shares_bought_from_dividend', label: 'DRIP Sh', type: 'number', width: 80, tip: 'Shares acquired through dividend reinvestment (DRIP)' },
  { key: 'total_cash_reinvested', label: 'Cash Reinv', type: 'number', width: 92, tip: 'Total cash dividend income that has been reinvested via DRIP' },
  { key: 'price_paid', label: 'Paid', type: 'number', width: 84, tip: 'Average price paid per share (cost basis per share)' },
  { key: 'current_price', label: 'Current', type: 'number', width: 84, tip: 'Current market price per share' },
  { key: 'purchase_value', label: 'Cost', type: 'number', width: 92, tip: 'Total original cost basis (price paid × shares)' },
  { key: 'current_value', label: 'Value', type: 'number', width: 92, tip: 'Current market value (current price × shares)' },
  { key: 'gain_or_loss', label: 'G/L $', type: 'number', width: 92, tip: 'Each row is this ticker\'s current lot during the selected range. The Totals row is the portfolio tracker Price Return for the range, including lots you sold — the same figure as Growth and Total Return cards. Not lifetime cost-basis G/L.' },
  { key: 'gain_or_loss_percentage', label: 'G/L %', type: 'number', width: 84, tip: 'Each row is this ticker\'s current-lot price return for the range. The Totals row is the portfolio tracker Price Return %, including lots you sold — the same figure as Growth. Life G/L % is cost basis instead.' },
  { key: 'lifetime_gain_or_loss', label: 'Life G/L', type: 'number', width: 88, tip: 'Current value minus what you paid for shares you still hold. Does not follow the date range and does not include sold lots.' },
  { key: 'lifetime_gain_or_loss_percentage', label: 'Life G/L %', type: 'number', width: 88, tip: 'Lifetime cost-basis G/L as a percent of what you paid for shares you still hold. Does not follow the date range.' },
  { key: 'div', label: 'Div$', type: 'number', width: 76, tip: 'Most recent dividend paid per share' },
  { key: 'div_frequency', label: 'Freq', type: 'string', width: 56, tip: 'Dividend payment frequency (M = Monthly, Q = Quarterly, W = Weekly, A = Annual)' },
  { key: 'ex_div_date', label: 'Ex-Div', type: 'string', width: 80, tip: 'Ex-dividend date — you must own shares before this date to receive the next dividend' },
  { key: 'div_pay_date', label: 'Pay Date', type: 'string', width: 80, tip: 'Date the dividend is actually paid to shareholders' },
  { key: 'reinvest', label: 'DRIP', type: 'string', width: 56, tip: 'Whether dividends are being reinvested (Y = reinvesting, N = taking as cash)' },
  { key: 'estim_payment_per_year', label: 'Yr$', type: 'number', width: 84, tip: 'Estimated total annual dividend income from this holding' },
  { key: 'approx_monthly_income', label: 'Mo$', type: 'number', width: 80, tip: 'Estimated monthly dividend income from this holding' },
  { key: 'monthly_income_reinvested', label: 'DRIP$', type: 'number', width: 80, tip: 'Estimated monthly income being reinvested (DRIP)' },
  { key: 'monthly_income_not_reinvested', label: 'Cash$', type: 'number', width: 80, tip: 'Estimated monthly income taken as cash (not reinvested)' },
  { key: 'drip_shares_monthly', label: 'MoShr', type: 'number', width: 76, tip: 'Estimated shares bought per month if monthly dividends are fully reinvested at the current price' },
  { key: 'drip_shares_yearly', label: 'YrShr', type: 'number', width: 76, tip: 'Estimated shares bought per year if annual dividends are fully reinvested at the current price' },
  { key: 'current_month_income', label: `${CURRENT_MONTH_SHORT}$`, type: 'number', width: 80, tip: `Dividend income received in ${CURRENT_MONTH_SHORT}` },
  { key: 'beta', label: 'Beta', type: 'number', width: 92, tip: "Price-return beta versus the ticker's best-fitting benchmark, usually SPY or QQQ" },
  { key: 'delta_up', label: 'Δ Up', type: 'number', width: 72, tip: 'Approximate effective delta on benchmark up-days from return regression' },
  { key: 'delta_down', label: 'Δ Down', type: 'number', width: 80, tip: 'Approximate effective delta on benchmark down-days from return regression' },
  { key: 'ret_vs_yld', label: 'RvY', type: 'string', width: 88, tip: 'Return vs yield over the selected range. Good means total return exceeds yield; Poor means yield exceeds total return.' },
  { key: 'closure_risk', label: 'Close?', type: 'string', width: 76, tip: 'Risk the ETF issuer shuts the fund down for being too small. Stocks are not rated.' },
  { key: 'grade', label: 'Grd', type: 'string', sortFirst: 'desc', width: 56, tip: 'Composite grade for the selected market window. Blank on Life.' },
  { key: 'annual_yield_on_cost', label: 'YOC', type: 'number', width: 80, tip: 'Yield on Cost — annual dividend income as a percentage of your original cost basis' },
  { key: 'current_annual_yield', label: 'Yield', type: 'number', width: 80, tip: 'Current annual dividend yield based on the current market price' },
  { key: 'dividend_paid', label: 'Div Paid', type: 'number', width: 100, tip: 'Last dividend amount actually paid per share' },
  { key: 'ytd_divs', label: 'YTD Divs', type: 'number', width: 100, tip: 'Total dividend income received year-to-date for this holding' },
  { key: 'total_divs_received', label: 'Total Divs', type: 'number', width: 105, tip: 'Cumulative total dividend income received since purchase' },
  { key: 'paid_for_itself', label: 'PFI%', type: 'number', width: 72, tip: 'Percentage of original cost basis recovered through dividends received' },
  { key: 'dividend_actuals_source', label: 'Div Src', type: 'string', width: 76, tip: 'Source of dividend actuals data (e.g. Schwab, Fidelity, Yahoo, Snapshot)' },
  { key: '_shares_if_reinvested', label: 'If DRIP', type: 'number', width: 80, tip: 'Hypothetical total shares if all dividends ever received had been reinvested at current price' },
  { key: 'realized_gains', label: 'Realized G/L', type: 'number', width: 120, tip: 'Realized gain or loss from shares already sold' },
]

const LOT_COLUMNS = [
  { key: 'transaction_type', label: 'Type', type: 'string', tip: 'BUY adds shares, SELL removes shares, and DIVIDEND records cash income.' },
  { key: 'transaction_date', label: 'Date', type: 'date', tip: 'The transaction date from the imported brokerage history.' },
  { key: 'shares', label: 'Shares', type: 'number', tip: 'Shares bought or sold. Cash dividend rows display 0.000 because the separate DRIP BUY adds the shares.' },
  { key: 'price_per_share', label: 'Price', type: 'number', tip: 'Purchase or sale price per share. Cash dividend rows display $0.00.' },
  { key: 'fees', label: 'Fees', type: 'number', tip: 'Brokerage fees recorded for this event. No recorded fee displays $0.00.' },
  { key: 'cost_proceeds', label: 'Cost/Proceeds / Amount', type: 'number', tip: 'BUY cost, SELL proceeds, or DIVIDEND cash amount.' },
  { key: 'unrealized_gain', label: 'Unrealized G/L', type: 'number', tip: 'Current gain or loss only for BUY lots that still have shares. Closed lots display Closed and $0.00.' },
  { key: 'realized_gain', label: 'Realized G/L', type: 'number', tip: 'Gain or loss recorded by a SELL. BUY and DIVIDEND rows display $0.00.' },
  { key: 'position_after', label: 'Position', type: 'number', divider: true, tip: 'Total position immediately after a BUY or SELL. DIVIDEND rows say No change.' },
  { key: 'avg_cost_after', label: 'Avg Cost', type: 'number', tip: 'Average cost immediately after a BUY or SELL. DIVIDEND rows say No change.' },
  { key: 'total_cost_after', label: 'Total Cost', type: 'number', tip: 'Total cost basis immediately after a BUY or SELL. DIVIDEND rows say No change.' },
  { key: 'notes', label: 'Notes', type: 'string', tip: 'Brokerage description imported with the event.' },
]

const lotCostOrProceeds = (txn) => {
  return transactionCashAmount(txn)
}

const lotUnrealizedGain = (txn, holding) => {
  if ((txn.transaction_type || 'BUY') !== 'BUY') return null
  const originalShares = Number(txn.shares) || 0
  const remaining = txn.shares_remaining
  const shares = remaining == null ? originalShares : Number(remaining)
  if (!Number.isFinite(shares) || shares <= 1e-9) return null
  const currentPrice = Number(holding.current_price) || 0
  const cost = originalShares > 0
    ? lotCostOrProceeds(txn) * (shares / originalShares)
    : 0
  return (shares * currentPrice) - cost
}

const lotSortValue = (txn, holding, key) => {
  if (key === 'transaction_type') return txn.transaction_type || 'BUY'
  if (key === 'cost_proceeds') return lotCostOrProceeds(txn)
  if (key === 'unrealized_gain') return lotUnrealizedGain(txn, holding)
  return txn[key]
}

const sortLotTransactions = (transactions, holding, sort) => {
  if (!Array.isArray(transactions) || !sort?.key) return transactions || []
  const column = LOT_COLUMNS.find(col => col.key === sort.key)

  return transactions
    .map((txn, index) => ({ txn, index }))
    .sort((a, b) => {
      const av = lotSortValue(a.txn, holding, sort.key)
      const bv = lotSortValue(b.txn, holding, sort.key)
      const aMissing = av == null || av === ''
      const bMissing = bv == null || bv === ''
      if (aMissing && bMissing) return a.index - b.index
      if (aMissing) return 1
      if (bMissing) return -1

      let comparison
      if (column?.type === 'number') {
        comparison = Number(av) - Number(bv)
      } else if (column?.type === 'date') {
        const aTime = Date.parse(av)
        const bTime = Date.parse(bv)
        comparison = Number.isNaN(aTime) || Number.isNaN(bTime)
          ? String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
          : aTime - bTime
      } else {
        comparison = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      }

      if (comparison === 0) return a.index - b.index
      return sort.direction === 'asc' ? comparison : -comparison
    })
    .map(({ txn }) => txn)
}

const DEFAULT_COLUMN_WIDTH = 96
const ACTIONS_COLUMN_WIDTH = 150
const columnWidth = (col) => col.width || DEFAULT_COLUMN_WIDTH

const DIV_SOURCE_OPTIONS = [
  { value: 'all', label: 'All Div Src' },
  { value: 'imported', label: 'Imported actuals' },
  { value: 'schwab', label: 'Schwab' },
  { value: 'fidelity', label: 'Fidelity' },
  { value: 'snowball', label: 'Snowball' },
  { value: 'etrade', label: 'E*Trade' },
  { value: 'robinhood', label: 'Robinhood' },
  { value: 'shear_group', label: 'Shear Group' },
  { value: 'interactive_brokers', label: 'Interactive Brokers' },
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

const IMPORTED_DIV_SOURCES = ['broker', 'schwab', 'fidelity', 'snowball', 'etrade', 'robinhood', 'shear_group', 'interactive_brokers', 'imported']

const DIV_SOURCE_META = {
  broker: { label: 'Imported', color: '#81c784' },
  schwab: { label: 'Schwab', color: '#81c784' },
  fidelity: { label: 'Fidelity', color: '#a5d6a7' },
  snowball: { label: 'Snowball', color: '#4db6ac' },
  etrade: { label: 'E*Trade', color: '#80cbc4' },
  robinhood: { label: 'Robinhood', color: '#81c784' },
  shear_group: { label: 'Shear Group', color: '#9fa8da' },
  interactive_brokers: { label: 'Interactive Brokers', color: '#90caf9' },
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
  { key: 'interactive_brokers', label: 'Interactive Brokers' },
  { key: 'imported', label: 'Other' },
  { key: 'snapshot', label: 'Snapshot' },
  { key: 'yahoo', label: 'Yahoo' },
  { key: 'none', label: 'No source' },
]

const normalizeDivSource = (source) => {
  const value = (source || 'none').toString().toLowerCase()
  if (value.startsWith('schwab')) return 'schwab'
  if (value.startsWith('fidelity')) return 'fidelity'
  if (value.startsWith('etrade') || value.startsWith('e*trade')) return 'etrade'
  if (value.startsWith('robinhood')) return 'robinhood'
  if (value.startsWith('snowball')) return 'snowball'
  if (value.startsWith('shear_group') || value.startsWith('shear group')) return 'shear_group'
  if (value.startsWith('interactive_brokers') || value.startsWith('interactive broker') || value.startsWith('ibkr')) return 'interactive_brokers'
  if (value.startsWith('generic')) return 'imported'
  return value
}

function DripMatrixModal({ onClose, onSynced, pf }) {
  const [profiles, setProfiles] = useState([])
  const [tickers, setTickers] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loadError, setLoadError] = useState(null)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await pf('/api/drip-matrix')
      const data = await res.json()
      setProfiles(data.profiles || [])
      setTickers(data.tickers || [])
    } catch (e) {
      console.error(e)
      setProfiles([])
      setTickers([])
      setLoadError(e?.message || String(e))
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [pf])

  // Escape always closes — the header Close button can be pushed out of view
  // on narrow layouts, so never leave the modal without an exit.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !syncing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, syncing])

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
    <div
      onMouseDown={e => { if (e.target === e.currentTarget && !syncing) onClose() }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      {/* Width floor keeps the header controls (incl. Close) inside the card even
          with zero sub-profiles, which would otherwise size this to 300px.
          maxWidth/maxHeight are viewport-relative so this still fits small monitors. */}
      <div className="card" style={{ width: Math.max(640, Math.min(900, 300 + profiles.length * 140)), maxWidth: '95vw', maxHeight: '90vh', margin: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* flexShrink 0: on a short window the table must absorb the squeeze, never the
            header — otherwise the Close button gets clipped vertically instead. */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', flexShrink: 0, marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>DRIP Matrix</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text" placeholder="Filter ticker..." value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--p-334155)', background: 'var(--p-0f1b2d)', color: 'var(--text)', fontSize: '0.8rem', width: 130 }}
            />
            <button className="btn btn-primary" style={{ whiteSpace: 'nowrap' }} onClick={handleSync} disabled={syncing || tickers.length === 0}>
              {syncing ? <><span className="spinner" /> Syncing...</> : 'Sync to Owner'}
            </button>
            <button className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }} onClick={onClose} disabled={syncing}>Close</button>
          </div>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--p-888)', margin: '0 0 0.5rem', flexShrink: 0 }}>
          Toggle DRIP per ticker per account. Click "Sync to Owner" to update Owner's DRIP flags and share counts.
        </p>

        {!loading && tickers.length > 0 && (() => {
          const totalIncome = tickers.reduce((s, t) => s + (t.annual_income || 0), 0)
          const dripIncome = tickers.reduce((s, t) => s + (t.drip_income || 0), 0)
          const pct = totalIncome > 0 ? (dripIncome / totalIncome * 100) : 0
          return (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', flexShrink: 0, marginBottom: '0.75rem', padding: '0.6rem 1rem', background: 'var(--p-0f1b2d)', borderRadius: 6, fontSize: '0.85rem' }}>
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
        ) : loadError ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.85rem' }}>
            <div style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '0.4rem' }}>Couldn't load the DRIP matrix</div>
            <div style={{ color: 'var(--p-888)', marginBottom: '0.9rem' }}>
              {loadError.includes('JSON')
                ? 'The backend is not responding. Make sure the Flask server on port 5001 is running, then retry.'
                : loadError}
            </div>
            <button className="btn btn-secondary" onClick={load}>Retry</button>
          </div>
        ) : profiles.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--p-888)' }}>
            No sub-accounts are included in Owner, so there is nothing to toggle here.
            <div style={{ marginTop: '0.5rem' }}>
              Turn on "Include in Owner" for your brokerage accounts on the Manage Portfolios screen, then reopen this matrix.
            </div>
          </div>
        ) : tickers.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--p-888)' }}>
            None of Owner's tickers are held in the included sub-accounts, so there is nothing to map.
          </div>
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
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={profiles.length + 3} style={{ ...tdStyle, textAlign: 'center', color: 'var(--p-888)', padding: '1.25rem' }}>
                      No ticker matches "{filter}".
                    </td>
                  </tr>
                )}
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
  const { profileId, isAggregate, selection, basisMode, profileQueryString } = useProfile()
  const dialog = useDialog()
  const { openTickerResearch } = useTickerResearch()
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
  const [showTransactionHistory, setShowTransactionHistory] = useState(false)
  const [tickerRisk, setTickerRisk] = useState({})
  const [tickerGrades, setTickerGrades] = useState({})
  const [tickerClosureRisk, setTickerClosureRisk] = useState({})
  const [rvyMode, setRvyMode] = useState('cur')
  const [transactionReturnPath] = useState(() => {
    const query = window.location.hash.split('?')[1]
    if (!query) return null
    return new URLSearchParams(query).get('return') === 'total-return'
      ? '/total-return'
      : null
  })

  // ?txn=TICKER opens the transaction modal directly. Positions needing a cost
  // basis are usually closed, so they have no holdings row to click — without
  // this the repair advice points at a screen the ticker cannot be reached on.
  useEffect(() => {
    const query = window.location.hash.split('?')[1]
    if (!query) return
    const wanted = new URLSearchParams(query).get('txn')
    if (wanted) {
      setTxnTicker(wanted.toUpperCase())
      setTxnIsNew(false)
    }
  }, [])
  const [expandedTickers, setExpandedTickers] = useState({})  // { ticker: [txns] | 'loading' }
  const [lotSorts, setLotSorts] = useState({})          // { ticker: { key, direction } }
  const [initialPerformanceRange] = useState(() => readSharedPerformanceRange())
  const [performancePeriod, setPerformancePeriod] = useState(initialPerformanceRange.period)
  const [customStart, setCustomStart] = useState(initialPerformanceRange.start)
  const [customEnd, setCustomEnd] = useState(initialPerformanceRange.end)
  const performanceRangeError = customRangeError(performancePeriod, customStart, customEnd)
  const isLifetimeRange = isLifetimePerformancePeriod(performancePeriod)

  useSharedPerformanceRange(performancePeriod, customStart, customEnd, (next) => {
    setPerformancePeriod(next.period)
    setCustomStart(next.start)
    setCustomEnd(next.end)
  })

  const trackerChartsEnabled = holdings.length > 0 && !isLifetimeRange && !performanceRangeError
  const sharedTrackerCharts = useSharedTrackerCharts({
    pf,
    profileQueryString,
    period: performancePeriod,
    start: customStart,
    end: customEnd,
    enabled: trackerChartsEnabled,
  })
  const trackerPerformance = sharedTrackerCharts.data
  const trackerPerformanceLoading = trackerChartsEnabled && sharedTrackerCharts.loading
  const trackerPerformanceError = trackerChartsEnabled ? sharedTrackerCharts.error : null

  useEffect(() => {
    if (isLifetimeRange || performanceRangeError || holdings.length === 0) {
      setTickerRisk({})
      setTickerGrades({})
      setTickerClosureRisk({})
      return undefined
    }
    const controller = new AbortController()
    const params = new URLSearchParams({ period: performancePeriod })
    addCustomRangeParams(params, performancePeriod, customStart, customEnd)
    pf(`/api/portfolio-summary/data?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`)
        return payload
      })
      .then(data => {
        if (controller.signal.aborted || !data) return
        setTickerGrades(data.ticker_grades || {})
        setTickerRisk(data.ticker_risk || {})
        setTickerClosureRisk(data.ticker_closure_risk || {})
      })
      .catch(error => {
        if (error?.name === 'AbortError' || controller.signal.aborted) return
        setTickerRisk({})
        setTickerGrades({})
        setTickerClosureRisk({})
      })
    return () => controller.abort()
  }, [pf, selection, performancePeriod, customStart, customEnd, isLifetimeRange, performanceRangeError, holdings.length])

  const holdingsLayout = useColumnLayout({
    storageKey: 'manage-holdings-columns-v1',
    columns: COLUMNS,
    lockedKeys: HOLDINGS_LOCKED_COLS,
    adoptNewKeys: layout => insertMissingKeysAfter(layout, [
      { key: 'lifetime_gain_or_loss', after: 'gain_or_loss_percentage' },
      { key: 'lifetime_gain_or_loss_percentage', after: 'lifetime_gain_or_loss' },
      { key: 'monthly_income_reinvested', after: 'approx_monthly_income' },
      { key: 'monthly_income_not_reinvested', after: 'monthly_income_reinvested' },
      { key: 'drip_shares_monthly', after: 'monthly_income_not_reinvested' },
      { key: 'drip_shares_yearly', after: 'drip_shares_monthly' },
      { key: 'current_month_income', after: 'drip_shares_yearly' },
      { key: 'beta', after: 'current_month_income' },
      { key: 'delta_up', after: 'beta' },
      { key: 'delta_down', after: 'delta_up' },
      { key: 'ret_vs_yld', after: 'delta_down' },
      { key: 'closure_risk', after: 'ret_vs_yld' },
      { key: 'grade', after: 'closure_risk' },
    ]),
  })

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
      // Rows are shown as stored: a blank frequency reads as "no distributions"
      // in the grid instead of being displayed as Monthly.
      setHoldings(Array.isArray(data) ? data : [])
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
      setSortDir(COLUMNS.find(c => c.key === key)?.sortFirst || 'asc')
    }
  }

  const getSortValue = (h, key) => {
    if (key === '_shares_if_reinvested') return sharesIfReinvested(h)
    if (key === 'percent_of_account') return accountPercent(h, totalCurrentValue)
    if (key === 'drip_shares_monthly') return h.drip_shares_monthly
    if (key === 'drip_shares_yearly') return h.drip_shares_yearly
    if (key === 'beta') return h._risk?.beta ?? null
    if (key === 'delta_up') return h._risk?.delta_up ?? null
    if (key === 'delta_down') return h._risk?.delta_down ?? null
    if (key === 'ret_vs_yld') return h.ret_vs_yld_sort
    if (key === 'closure_risk') return h._closure_sort
    if (key === 'grade') return h._grade_sort
    return h[key]
  }

  const filteredHoldings = useMemo(() => holdings.filter(h => {
    if (divSourceFilter === 'all') return true
    const source = normalizeDivSource(h.dividend_actuals_source)
    if (divSourceFilter === 'imported') return IMPORTED_DIV_SOURCES.includes(source)
    return source === divSourceFilter
  }), [holdings, divSourceFilter])

  const totalCurrentValue = holdings.reduce((sum, h) => sum + (Number(h.current_value) || 0), 0)
  const isHoldingsFiltered = divSourceFilter !== 'all'

  const trackerPerformanceByTicker = useMemo(() => new Map(
    (trackerPerformance?.performance_rows || []).map(row => [
      String(row.ticker || '').trim().toUpperCase(),
      row,
    ]),
  ), [trackerPerformance])

  const displayHoldings = useMemo(() => (
    filteredHoldings.map(holding => {
      const trackerRow = trackerPerformanceByTicker.get(
        String(holding.ticker || '').trim().toUpperCase(),
      )
      const periodPct = trackerRow?.price_return_pct
      const periodTotalReturn = trackerRow?.total_return_pct
      const rvyYield = rvyMode === 'yoc' ? holding.annual_yield_on_cost : holding.current_annual_yield
      const rvyWindowYieldPct = prorateAnnualYield(
        (rvyYield || 0) * 100,
        trackerRow?.actual_start_date,
        trackerRow?.actual_end_date,
      )
      const rvy = periodTotalReturn != null && rvyWindowYieldPct != null
        ? returnVsYield(periodTotalReturn, rvyWindowYieldPct)
        : null
      const risk = tickerRisk[holding.ticker] || null
      const closure = tickerClosureRisk[holding.ticker] || null
      const grade = tickerGrades[holding.ticker]?.grade
      return {
        ...holding,
        percent_of_account: accountPercent(holding, totalCurrentValue),
        lifetime_gain_or_loss: holding.gain_or_loss,
        lifetime_gain_or_loss_percentage: holding.gain_or_loss_percentage,
        gain_or_loss: isLifetimeRange
          ? holding.gain_or_loss
          : (trackerRow?.price_return_dollar ?? null),
        gain_or_loss_percentage: isLifetimeRange
          ? holding.gain_or_loss_percentage
          : (periodPct == null ? null : Number(periodPct) / 100),
        tracker_start_value: trackerRow?.start_value,
        tracker_actual_start_date: trackerRow?.actual_start_date,
        tracker_actual_end_date: trackerRow?.actual_end_date,
        drip_shares_monthly: sharesFromDrip(holding.approx_monthly_income, holding),
        drip_shares_yearly: sharesFromDrip(holding.estim_payment_per_year, holding),
        ret_vs_yld: rvy,
        ret_vs_yld_sort: rvy ? rvy.spread : -999,
        _risk: risk,
        _closure: closure,
        _closure_sort: CLOSURE_TIER[closure?.tier] ? { high: 3, elevated: 2, watch: 1, ok: 0, unknown: -1 }[closure.tier] : -2,
        _grade_sort: GRADE_RANK[grade] ?? null,
        grade,
      }
    })
  ), [filteredHoldings, trackerPerformanceByTicker, totalCurrentValue, isLifetimeRange, tickerRisk, tickerGrades, tickerClosureRisk, rvyMode])

  // Same series Growth, Total Return cards, Dashboard PrRtn, and Gains & Losses
  // use: the portfolio replay for the shared range, including lots that closed
  // during the window. The open-position-only footer is a different total and
  // belongs on the Total Return "Open Position Total" row, not here.
  const trackerPortfolioMetrics = trackerPerformance?.portfolio_metrics || null
  const tableTotals = useMemo(() => computeHoldingsTableTotals(displayHoldings, {
    accountValue: totalCurrentValue,
    openPositionMetrics: trackerPortfolioMetrics,
    matchOpenPositionTotals: !isHoldingsFiltered && !isLifetimeRange && !!trackerPortfolioMetrics,
  }), [displayHoldings, totalCurrentValue, trackerPortfolioMetrics, isHoldingsFiltered, isLifetimeRange])

  const trackerPerformanceRange = formatPerformanceRange(
    trackerPortfolioMetrics?.actual_start_date
      || trackerPerformance?.actual_start_date
      || trackerPerformance?.requested_start_date,
    trackerPortfolioMetrics?.actual_end_date
      || trackerPerformance?.actual_end_date
      || trackerPerformance?.requested_end_date,
  )

  const sortedHoldings = [...displayHoldings].sort((a, b) => {
    const col = COLUMNS.find(c => c.key === sortKey)
    const av = getSortValue(a, sortKey)
    const bv = getSortValue(b, sortKey)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    let cmp
    // Grd, Close? and RvY are laid out as string columns but sort on a numeric
    // rank, so trust the value's own type before falling back to the column's.
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv
    } else if (col?.type === 'number') {
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
      invalidateDashboardCache()
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
      invalidateDashboardCache()
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
      const res = await pf(`/api/holdings/${ticker}/transactions?include_dividends=true`)
      const data = await res.json()
      setExpandedTickers(prev => ({ ...prev, [ticker]: data }))
    } catch {
      setExpandedTickers(prev => ({ ...prev, [ticker]: [] }))
    }
  }

  const handleLotSort = (ticker, key) => {
    setLotSorts(prev => {
      const current = prev[ticker]
      return {
        ...prev,
        [ticker]: {
          key,
          direction: current?.key === key && current.direction === 'asc' ? 'desc' : 'asc',
        },
      }
    })
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
    const oldTicker = String(editHolding?.ticker || '').trim().toUpperCase()
    const newTicker = String(payload.ticker || '').trim().toUpperCase()

    if (isEdit && oldTicker && newTicker !== oldTicker) {
      const confirmed = await dialog.confirm(
        `Rename ${oldTicker} to ${newTicker} across every portfolio that holds it? ` +
        'Transactions, dividend history, categories, and ticker settings will move to the new symbol.'
      )
      if (!confirmed) return
    }

    try {
      const url = isEdit ? `/api/holdings/${oldTicker}` : `/api/holdings`
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

  const glColor = (v) => {
    if (v == null || v === '') return undefined
    const number = Number(v)
    if (!Number.isFinite(number) || number === 0) return undefined
    return number >= 0 ? 'var(--p-81c784)' : 'var(--p-ef9a9a)'
  }

  const trackerCellTitle = (h) => {
    if (isLifetimeRange) return COST_BASIS_SCOPE_NOTE
    const range = formatPerformanceRange(h.tracker_actual_start_date, h.tracker_actual_end_date)
    const scope = OPEN_LOT_SCOPE_NOTE
    if (range) return `${range}. ${scope}`
    if (trackerPerformanceLoading) return 'Loading period price return…'
    if (trackerPerformanceError) return trackerPerformanceError
    return scope
  }

  const periodButtonLabel = PERFORMANCE_PERIODS.find(option => option.key === performancePeriod)?.label
  const holdingsColumnLabel = (col) => {
    if (col.key === 'gain_or_loss' || col.key === 'gain_or_loss_percentage') {
      return periodButtonLabel ? `${col.label} (${periodButtonLabel})` : col.label
    }
    return col.label
  }

  const columnAlign = (col) => col.align || (col.type === 'number' ? 'right' : 'left')

  const riskNum = (value) => (
    value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2)
  )

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
    return (
      <span
        title={`Dividend actuals source: ${value}`}
        style={{
          color,
          display: 'block',
          fontWeight: value === 'none' ? 400 : 700,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    )
  }

  const sortArrow = (key) => {
    if (sortKey !== key) return ' \u2195'
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC'
  }

  const incTotals = React.useMemo(() => {
    const sum = (key) => filteredHoldings.reduce((s, h) => s + (Number(h[key]) || 0), 0)
    const monthlyIncome = sum('approx_monthly_income')
    const reinvested = sum('monthly_income_reinvested')
    const tickerCount = filteredHoldings.length
    const drippedTickerCount = filteredHoldings.filter(h => h.reinvest === 'Y').length
    const notDrippedTickerCount = tickerCount - drippedTickerCount
    return {
      monthlyIncome,
      reinvested,
      notReinvested: sum('monthly_income_not_reinvested'),
      reinvestPct: monthlyIncome > 0 ? (reinvested / monthlyIncome) * 100 : 0,
      tickerCount,
      drippedTickerCount,
      notDrippedTickerCount,
      drippedTickerPct: tickerCount > 0 ? (drippedTickerCount / tickerCount) * 100 : 0,
      notDrippedTickerPct: tickerCount > 0 ? (notDrippedTickerCount / tickerCount) * 100 : 0,
    }
  }, [filteredHoldings])

  const activeRepairModeLabel = DIV_REPAIR_MODES.find(opt => opt.value === (repairPreview?.mode || repairMode))?.label || DIV_REPAIR_MODES[0].label
  const previewTotals = repairPreview?.source_totals || {}
  const previewImportedTotal = repairPreview?.broker_updated ?? IMPORTED_DIV_SOURCES.reduce((sum, key) => sum + (previewTotals[key] || 0), 0)
  const hasDividendRefreshResult = Array.isArray(dividendRefreshAccounts)
  const dividendRefreshDateLabel = fmtDateLabel(dividendRefreshDate)

  const activeCols = holdingsLayout.activeColumns
  const frozenCount = Math.min(FROZEN_COLS, activeCols.length)
  // Left offsets come from the widths of the columns actually on screen, so
  // freezing still lines up after a column is hidden or dragged elsewhere.
  const frozenLefts = activeCols.slice(0, frozenCount).map((_, i) => (
    activeCols.slice(0, i).reduce((sum, col) => sum + columnWidth(col), 0)
  ))
  const holdingsTableMinWidth = activeCols.reduce(
    (sum, col) => sum + columnWidth(col), ACTIONS_COLUMN_WIDTH,
  )
  const frozenCellStyle = (i) => {
    const width = columnWidth(activeCols[i])
    return {
      position: 'sticky',
      left: frozenLefts[i],
      width,
      minWidth: width,
      maxWidth: width,
      boxSizing: 'border-box',
      overflow: 'hidden',
      zIndex: 1,
    }
  }

  // One renderer per column, so a row is built from whatever layout is saved
  // rather than from a fixed run of <td>s. Frozen positioning is applied by the
  // row above, never in here.
  const renderHoldingCell = (col, h) => {
    switch (col.key) {
      case 'ticker':
        return (
          <td style={{ fontWeight: 600 }}>
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
                onClick={(e) => { e.preventDefault(); openTickerResearch(h.ticker, { holding: h, closure: tickerClosureRisk[h.ticker] }) }}
                style={{ color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer' }}
                title="Open ticker research sheet"
                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
              >
                {h.ticker}
              </a>
            </div>
          </td>
        )
      case 'description':
        return <td>{h.description || '-'}</td>
      case 'category':
        return <td>{h.category || '-'}</td>
      case 'percent_of_account':
        return <td>{fmtPct(h.percent_of_account)}</td>
      case 'quantity':
        return <td>{fmt(h.quantity)}</td>
      case 'purchase_date':
        return <td>{formatMDY(h.purchase_date) || '-'}</td>
      case 'base_quantity':
        return <td>{fmt(h.base_quantity, 4)}</td>
      case 'shares_bought_from_dividend':
        return <td>{fmt(h.shares_bought_from_dividend, 4)}</td>
      case 'total_cash_reinvested':
        return <td>{formatMoney(h.total_cash_reinvested, { fallback: '-' })}</td>
      case 'price_paid':
        return <td>{fmtM(h.price_paid, 4)}</td>
      case 'current_price':
        return <td>{fmtM(h.current_price)}</td>
      case 'purchase_value':
        return <td>{fmtM(h.purchase_value)}</td>
      case 'current_value':
        return <td>{fmtM(h.current_value)}</td>
      case 'gain_or_loss':
        return (
          <td style={{ color: glColor(h.gain_or_loss) }} title={trackerCellTitle(h)}>
            {!isLifetimeRange && trackerPerformanceLoading && h.gain_or_loss == null ? '…' : fmtM(h.gain_or_loss)}
          </td>
        )
      case 'gain_or_loss_percentage':
        return (
          <td style={{ color: glColor(h.gain_or_loss_percentage) }} title={trackerCellTitle(h)}>
            {!isLifetimeRange && trackerPerformanceLoading && h.gain_or_loss_percentage == null ? '…' : fmtPct(h.gain_or_loss_percentage)}
          </td>
        )
      case 'lifetime_gain_or_loss':
        return (
          <td style={{ color: glColor(h.lifetime_gain_or_loss) }}>
            {fmtM(h.lifetime_gain_or_loss)}
          </td>
        )
      case 'lifetime_gain_or_loss_percentage':
        return (
          <td style={{ color: glColor(h.lifetime_gain_or_loss_percentage) }}>
            {fmtPct(h.lifetime_gain_or_loss_percentage)}
          </td>
        )
      case 'div':
        return <td>{fmtM(h.div, 4)}</td>
      case 'div_frequency':
        return <td>{h.div_frequency || '-'}</td>
      case 'ex_div_date':
        return <td>{formatMDY(h.ex_div_date) || '-'}</td>
      case 'div_pay_date':
        return (
          <td title={h.div_pay_date_estimated ? 'Estimated from dividend schedule and payment history' : 'Confirmed pay date'}>
            {h.div_pay_date_estimated ? '~' : ''}{formatMDY(h.div_pay_date) || '-'}
          </td>
        )
      case 'reinvest':
        return (
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
        )
      case 'estim_payment_per_year':
        return <td>{fmtM(h.estim_payment_per_year, 3)}</td>
      case 'approx_monthly_income':
        return <td style={{ textAlign: 'right' }}>{fmtM(h.approx_monthly_income, 3)}</td>
      case 'monthly_income_reinvested':
        return <td style={{ textAlign: 'right', color: 'var(--accent-bright)' }}>{fmtM(h.monthly_income_reinvested, 3)}</td>
      case 'monthly_income_not_reinvested':
        return <td style={{ textAlign: 'right', color: 'var(--warning-money)' }}>{fmtM(h.monthly_income_not_reinvested, 3)}</td>
      case 'drip_shares_monthly':
        return <td style={{ textAlign: 'right', color: 'var(--accent-soft)' }}>{Number(h.drip_shares_monthly || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
      case 'drip_shares_yearly':
        return <td style={{ textAlign: 'right', color: 'var(--accent-soft)' }}>{Number(h.drip_shares_yearly || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
      case 'current_month_income':
        return <td style={{ textAlign: 'right', color: 'var(--pos)' }}>{fmtM(h.current_month_income, 3)}</td>
      case 'beta': {
        const risk = h._risk || {}
        return (
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title={risk.beta_benchmark ? `Beta vs ${risk.beta_benchmark}` : 'Beta unavailable'}>
            {riskNum(risk.beta)}
            {risk.beta_benchmark && risk.beta != null && (
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8em', marginLeft: 3 }}>vs {risk.beta_benchmark}</span>
            )}
          </td>
        )
      }
      case 'delta_up':
        return (
          <td style={{ textAlign: 'right', color: 'var(--p-2f9d55)' }} title={h._risk?.beta_benchmark ? `Up-day delta vs ${h._risk.beta_benchmark}` : 'Up-delta unavailable'}>
            {riskNum(h._risk?.delta_up)}
          </td>
        )
      case 'delta_down':
        return (
          <td style={{ textAlign: 'right', color: 'var(--p-d94b4b)' }} title={h._risk?.beta_benchmark ? `Down-day delta vs ${h._risk.beta_benchmark}` : 'Down-delta unavailable'}>
            {riskNum(h._risk?.delta_down)}
          </td>
        )
      case 'ret_vs_yld': {
        const rvy = h.ret_vs_yld
        return (
          <td style={{ textAlign: 'center', color: rvy?.color || 'var(--text-dim)', fontWeight: 600 }} title={rvy ? `Total return ${rvy.totalReturnPct?.toFixed(2)}% vs yield ${rvy.yieldOnCost?.toFixed(2)}%` : 'N/A'}>
            {rvy?.label || '—'}
          </td>
        )
      }
      case 'closure_risk':
        return <td style={{ textAlign: 'center' }}><ClosureRiskBadge info={h._closure} /></td>
      case 'grade':
        return <td style={{ textAlign: 'center' }}>{h.grade ? <GradeBadge grade={h.grade} /> : '—'}</td>
      case 'annual_yield_on_cost':
        return <td>{fmtPct(h.annual_yield_on_cost)}</td>
      case 'current_annual_yield':
        return <td>{fmtPct(h.current_annual_yield)}</td>
      case 'dividend_paid':
        return <td>{fmtM(h.dividend_paid)}</td>
      case 'ytd_divs':
        return <td>{fmtM(h.ytd_divs)}</td>
      case 'total_divs_received':
        return <td>{formatMoney(h.total_divs_received, { zeroIfInvalid: true })}</td>
      case 'paid_for_itself':
        return <td>{fmtPct(h.paid_for_itself)}</td>
      case 'dividend_actuals_source':
        return <td>{sourceBadge(h.dividend_actuals_source)}</td>
      case '_shares_if_reinvested': {
        const shares = sharesIfReinvested(h)
        return <td>{shares ? fmt(shares, 3) : '-'}</td>
      }
      case 'realized_gains':
        return (
          <td style={{ color: h.realized_gains > 0 ? 'var(--p-81c784)' : h.realized_gains < 0 ? 'var(--p-ef9a9a)' : undefined }}>
            {h.realized_gains ? formatMoney(h.realized_gains) : '-'}
          </td>
        )
      default:
        return <td>{h[col.key] ?? '-'}</td>
    }
  }

  const renderFooterValue = (col) => {
    const value = tableTotals[col.key]
    if (col.key === 'gain_or_loss' || col.key === 'gain_or_loss_percentage') {
      if (!isLifetimeRange && trackerPerformanceLoading && value == null) return '…'
      if (value == null) return ''
      return col.key === 'gain_or_loss_percentage' ? fmtPct(value) : fmtM(value)
    }
    if (value == null) return ''
    switch (col.key) {
      case 'percent_of_account':
      case 'lifetime_gain_or_loss_percentage':
      case 'annual_yield_on_cost':
      case 'current_annual_yield':
      case 'paid_for_itself':
        return fmtPct(value)
      case 'quantity':
      case 'base_quantity':
      case 'shares_bought_from_dividend':
        return fmt(value, col.key === 'quantity' ? 2 : 4)
      case '_shares_if_reinvested':
        return fmt(value, 3)
      case 'lifetime_gain_or_loss':
      case 'realized_gains':
      case 'total_cash_reinvested':
      case 'purchase_value':
      case 'current_value':
      case 'estim_payment_per_year':
      case 'approx_monthly_income':
      case 'monthly_income_reinvested':
      case 'monthly_income_not_reinvested':
      case 'current_month_income':
      case 'dividend_paid':
      case 'ytd_divs':
      case 'total_divs_received':
        return col.key === 'estim_payment_per_year' || col.key === 'approx_monthly_income'
          || col.key === 'monthly_income_reinvested' || col.key === 'monthly_income_not_reinvested'
          || col.key === 'current_month_income'
          ? fmtM(value, 3)
          : fmtM(value)
      case 'drip_shares_monthly':
      case 'drip_shares_yearly':
        return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
      default:
        return ''
    }
  }

  const footerValueColor = (col) => {
    if (col.key === 'gain_or_loss' || col.key === 'gain_or_loss_percentage'
      || col.key === 'lifetime_gain_or_loss' || col.key === 'lifetime_gain_or_loss_percentage'
      || col.key === 'realized_gains') {
      return glColor(tableTotals[col.key])
    }
    if (col.key === 'monthly_income_reinvested') return 'var(--accent-bright)'
    if (col.key === 'monthly_income_not_reinvested') return 'var(--warning-money)'
    if (col.key === 'current_month_income') return 'var(--pos)'
    return undefined
  }

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
          <button className="btn btn-secondary" onClick={() => setShowTransactionHistory(true)}>
            Transaction History
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
          <div
            className="card"
            title="Ticker counts follow each holding's DRIP checkbox and reflect the current dividend-source filter."
            style={{ flex: '2 1 300px', minWidth: 280, padding: '0.65rem 1rem' }}
          >
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Ticker DRIP Coverage
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.1rem' }}>
              <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-strong)' }}>{incTotals.tickerCount}</span>
              <span style={{ fontSize: '0.76rem', color: 'var(--text-dim-2)' }}>
                ticker{incTotals.tickerCount === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.5rem',
                borderRadius: 999, background: 'rgba(76, 175, 80, 0.13)', color: 'var(--pos)',
                fontSize: '0.74rem', fontWeight: 700,
              }}>
                {incTotals.drippedTickerCount} DRIP ({incTotals.drippedTickerPct.toFixed(1)}%)
              </span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.5rem',
                borderRadius: 999, background: 'rgba(255, 179, 0, 0.13)', color: 'var(--warning-money)',
                fontSize: '0.74rem', fontWeight: 700,
              }}>
                {incTotals.notDrippedTickerCount} Not DRIP ({incTotals.notDrippedTickerPct.toFixed(1)}%)
              </span>
            </div>
          </div>
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

      {!loading && holdings.length > 0 && (
        <details className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--accent-2)', fontWeight: 500 }}>
            Why the DRIP Percentages Can Be Different
          </summary>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem', lineHeight: 1.5, marginTop: '0.75rem' }}>
            <p style={{ margin: '0 0 0.65rem' }}>
              The two percentages answer different questions, so they are not expected to match.
            </p>
            <ul style={{ margin: '0 0 0.65rem', paddingLeft: '1.2rem' }}>
              <li>
                <strong style={{ color: 'var(--text-strong)' }}>DRIP ticker percentage</strong> counts ticker
                names. Every ticker counts once, whether the position is large or small.
              </li>
              <li>
                <strong style={{ color: 'var(--text-strong)' }}>Income reinvested percentage</strong> counts
                dividend dollars. A holding that pays more income has more effect on this percentage.
              </li>
            </ul>
            <div style={{
              padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--surface-inset)', marginBottom: '0.65rem',
            }}>
              <strong style={{ color: 'var(--text-strong)' }}>Simple example:</strong> If 2 of 4 tickers have
              DRIP turned on, then 50% of the tickers are being dripped. But if those two tickers produce only $20
              of the portfolio&apos;s $100 monthly income, then only 20% of the income is being reinvested.
            </div>
            <p style={{ margin: '0 0 0.65rem' }}>
              The number of shares can affect how much income a holding produces, but the dividend amount and payment
              frequency also matter. This is why a small DRIP position may raise the ticker percentage without moving
              the income percentage very much.
            </p>
            <p style={{ margin: 0 }}>
              In a combined or Owner view, the same ticker may have DRIP on in one account and off in another. The
              ticker bubble counts the ticker once, while the income percentage uses the actual dollar split across
              those accounts.
            </p>
          </div>
        </details>
      )}

      <div className="holdings-column-bar">
        <span className="column-bar-hint">
          This table is customizable &mdash; use <strong>Columns</strong> to choose which ones show,
          and drag a header to reorder them.
        </span>
        <ColumnCustomizer
          layout={holdingsLayout}
          detailOf={col => col.tip}
          buttonLabel="Columns"
        />
      </div>

      {!loading && holdings.length > 0 && (
        <div className="growth-filter-group" style={{ marginBottom: '0.75rem' }}>
          <label>Shared Performance Date Range</label>
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            {PERFORMANCE_PERIODS.map(periodOption => (
              <button
                type="button"
                key={periodOption.key}
                className={`tr-pbtn${performancePeriod === periodOption.key ? ' tr-pbtn-active' : ''}`}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                title={periodOption.hint}
                onClick={() => setPerformancePeriod(periodOption.key)}
              >
                {periodOption.label}
              </button>
            ))}
          </div>
          <p className="tr-note perf-range-note">{PERFORMANCE_RANGE_NOTE}</p>
          {performancePeriod === 'custom' && (
            <div className="g2-custom-range" role="group" aria-label="Custom performance date range">
              <label>
                <span>Start date</span>
                <input
                  type="date"
                  value={customStart}
                  min={MIN_PERFORMANCE_DATE}
                  max={customEnd || todayInputValue()}
                  onChange={e => setCustomStart(e.target.value)}
                />
              </label>
              <label>
                <span>End date</span>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart || MIN_PERFORMANCE_DATE}
                  max={todayInputValue()}
                  onChange={e => setCustomEnd(e.target.value)}
                />
              </label>
            </div>
          )}
          {isLifetimeRange && (
            <p className="tr-note" style={{ marginTop: '0.45rem' }}>{HOLDINGS_LIFETIME_MATCH_NOTE}</p>
          )}
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.4 }}>
            This range does not hide tickers or change Cost Basis, Value, or shares — those are always the current position.
            {isLifetimeRange
              ? ` Gain/Loss is ${COST_BASIS_SCOPE_NOTE}`
              : ` Each Gain/Loss row is that ticker's current lot. The Totals row is the portfolio Price Return${trackerPerformanceRange ? ` (${trackerPerformanceRange})` : ''}: ${TRACKER_SCOPE_NOTE} Life G/L is ${COST_BASIS_SCOPE_NOTE}`}
            {performanceRangeError ? ` ${performanceRangeError}` : ''}
            {trackerPerformanceError ? ` ${trackerPerformanceError}` : ''}
            {trackerPerformanceLoading ? ' Loading period Gain/Loss…' : ''}
          </p>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
      ) : holdings.length === 0 ? (
        <div className="card">
          <p>No holdings yet. Add one manually or import from the Import page.</p>
        </div>
      ) : (
        <div className="sticky-table-wrap manage-holdings-table-wrap">
          <table style={{ minWidth: holdingsTableMinWidth, tableLayout: 'fixed' }}>
            <colgroup>
              {activeCols.map(col => (
                <col key={col.key} style={{ width: columnWidth(col) }} />
              ))}
              <col style={{ width: ACTIONS_COLUMN_WIDTH }} />
            </colgroup>
            <thead>
              <tr>
                {activeCols.map((col, i) => {
                  const frozen = i < frozenCount
                  const width = columnWidth(col)
                  return (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={holdingsLayout.dragClass(col.key, frozen ? 'frozen-col' : undefined)}
                      title={`${col.tip || col.label}\u000a\u000aDrag this header to reorder the columns.`}
                      style={{
                        cursor: 'grab', whiteSpace: 'nowrap', userSelect: 'none',
                        textAlign: columnAlign(col),
                        width, minWidth: width, boxSizing: 'border-box',
                        ...(frozen ? {
                          position: 'sticky',
                          left: frozenLefts[i],
                          maxWidth: width,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          zIndex: 4,
                        } : null),
                      }}
                      {...holdingsLayout.dragHandlers(col.key)}
                    >
                      <span className="mh-th">
                        <span className="mh-th-label">{holdingsColumnLabel(col)}</span>
                        {col.key === 'ret_vs_yld' && (
                          <button
                            type="button"
                            className="mh-rvy-toggle"
                            onClick={event => {
                              event.stopPropagation()
                              setRvyMode(mode => mode === 'yoc' ? 'cur' : 'yoc')
                            }}
                            title={rvyMode === 'yoc' ? 'Using Yield on Cost — click for Current Yield' : 'Using Current Yield — click for Yield on Cost'}
                          >
                            {rvyMode === 'yoc' ? 'YOC' : 'CYld'}
                          </button>
                        )}
                        <span className="mh-th-sort">{sortArrow(col.key)}</span>
                      </span>
                    </th>
                  )
                })}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map(h => (
                <React.Fragment key={h.ticker}>
                <tr>
                  {activeCols.map((col, i) => {
                    const cell = renderHoldingCell(col, h)
                    const frozen = i < frozenCount
                    return React.cloneElement(cell, {
                      key: col.key,
                      className: [cell.props.className, frozen ? 'frozen-col' : null].filter(Boolean).join(' ') || undefined,
                      style: {
                        ...(col.truncate ? TRUNCATED_CELL : null),
                        ...cell.props.style,
                        ...(frozen ? frozenCellStyle(i) : null),
                      },
                    })
                  })}
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
                    <td colSpan={activeCols.length + 1} style={{ padding: 0, background: 'rgba(0,0,0,0.2)' }}>
                      {expandedTickers[h.ticker] === 'loading' ? (
                        <div style={{ padding: '0.75rem', textAlign: 'center' }}><span className="spinner" /></div>
                      ) : expandedTickers[h.ticker].length === 0 ? (
                        <div style={{ padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--text-dim-2)' }}>
                          No transaction lots recorded. Use the Txn button to add purchase lots.
                        </div>
                      ) : (
                        <div style={{ padding: '0.5rem 1rem' }}>
                          <details style={{
                            margin: '0 0 0.5rem', padding: '0.45rem 0.65rem', borderRadius: 4,
                            background: 'rgba(79, 195, 247, 0.08)', color: 'var(--text-dim)',
                            fontSize: '0.76rem', lineHeight: 1.45,
                          }}>
                            <summary style={{ cursor: 'pointer', color: 'var(--p-4fc3f7)', fontWeight: 700 }}>
                              How to read this transaction table
                            </summary>
                            <div style={{ marginTop: '0.4rem', display: 'grid', gap: '0.2rem' }}>
                              <div><strong>Closed · $0.00</strong> means a BUY lot was fully sold. Its result is included on the related SELL row.</div>
                              <div><strong>BUY Realized G/L $0.00</strong> means buying did not realize a gain or loss; realization happens when shares are sold.</div>
                              <div><strong>DIVIDEND $0.00 fields</strong> do not represent missing data. The cash income is in Amount, and the dividend itself has no shares or capital gain/loss.</div>
                              <div><strong>DIVIDEND + DRIP reinvestment</strong> are two related events: cash was received, then used by the separate BUY to acquire shares.</div>
                              <div>Hover a value or column heading for additional help.</div>
                            </div>
                          </details>
                          <table style={{ width: 'auto', fontSize: '0.82rem', marginBottom: 0 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--p-1a3a5c)' }}>
                                {LOT_COLUMNS.map(col => {
                                  const activeSort = lotSorts[h.ticker]?.key === col.key
                                  const direction = activeSort ? lotSorts[h.ticker].direction : null
                                  return (
                                    <th
                                      key={col.key}
                                      aria-sort={activeSort ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                                      style={{
                                        padding: '0.3rem 0.75rem',
                                        fontWeight: 600,
                                        color: 'var(--text-dim-2)',
                                        position: 'sticky',
                                        top: 30,
                                        background: 'var(--p-13203a)',
                                        zIndex: 2,
                                        ...(col.divider ? { borderLeft: '1px solid var(--p-1a3a5c)' } : {}),
                                      }}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => handleLotSort(h.ticker, col.key)}
                                        title={`${col.tip || col.label} Click to sort by ${col.label}.`}
                                        style={{
                                          alignItems: 'center',
                                          background: 'transparent',
                                          border: 0,
                                          color: 'inherit',
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          font: 'inherit',
                                          fontWeight: 'inherit',
                                          gap: '0.25rem',
                                          padding: 0,
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        {col.label}
                                        <span aria-hidden="true" style={{ fontSize: '0.65rem', opacity: activeSort ? 1 : 0.55 }}>
                                          {activeSort ? (direction === 'asc' ? '\u25B2' : '\u25BC') : '\u2195'}
                                        </span>
                                      </button>
                                    </th>
                                  )
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {sortLotTransactions(expandedTickers[h.ticker], h, lotSorts[h.ticker]).map(txn => {
                                const txnType = String(txn.transaction_type || 'BUY').toUpperCase()
                                const isDividend = txnType === 'DIVIDEND'
                                const isDripBuy = isDripBuyTransaction(txn)
                                const isClosedBuy = isClosedBuyLot(txn)
                                const lotCost = lotCostOrProceeds(txn)
                                const lotGL = lotUnrealizedGain(txn, h)
                                const unrealizedHelp = isClosedBuy
                                  ? 'This BUY lot has no remaining shares. Its gain or loss was realized on the related SELL transaction.'
                                  : isDividend
                                    ? 'Dividend income is cash, not an open security lot, so it has no unrealized capital gain or loss.'
                                    : txnType === 'SELL'
                                      ? 'A SELL has no remaining open lot. Its result is shown in Realized G/L.'
                                      : 'Current unrealized gain or loss for the shares still open in this BUY lot.'
                                const realizedHelp = txnType === 'SELL'
                                  ? 'Gain or loss realized by this sale.'
                                  : isDividend
                                    ? 'Dividend income is shown in Amount, not as realized capital gain.'
                                    : 'A BUY does not realize a gain or loss. Any result is recorded on the later SELL.'
                                return (
                                  <tr
                                    key={txn.id}
                                    style={{
                                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                                      background: (isDividend || isDripBuy) ? 'rgba(79, 195, 247, 0.025)' : undefined,
                                    }}
                                  >
                                    <td
                                      title={isDividend
                                        ? 'Cash dividend received. A separate DRIP BUY may reinvest the same amount.'
                                        : isDripBuy
                                          ? 'Dividend reinvestment BUY: cash from a dividend was used to acquire these shares.'
                                          : undefined}
                                      style={{
                                        padding: '0.3rem 0.75rem', color: transactionTypeColor(txnType), fontWeight: 600,
                                        borderLeft: (isDividend || isDripBuy) ? '3px solid var(--p-4fc3f7)' : '3px solid transparent',
                                      }}
                                    >
                                      <div>{txnType}</div>
                                      {(isDividend || isDripBuy) && (
                                        <div style={{ fontSize: '0.62rem', color: 'var(--text-dim-2)', whiteSpace: 'nowrap', fontWeight: 500 }}>
                                          {isDividend ? 'Cash payment' : 'DRIP reinvestment'}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>
                                      <div>{txn.transaction_date || '-'}</div>
                                      {txn.created_at && <div style={{ fontSize: '0.7rem', color: 'var(--text-dim-2)' }}>{new Date(txn.created_at + 'Z').toLocaleString()}</div>}
                                    </td>
                                    <td title={isDividend ? 'This cash dividend did not directly add shares; the separate DRIP BUY did.' : undefined} style={{ padding: '0.3rem 0.75rem' }}>
                                      {fmt(isDividend ? 0 : txn.shares, 3)}
                                    </td>
                                    <td title={isDividend ? 'A cash dividend has no purchase or sale price.' : undefined} style={{ padding: '0.3rem 0.75rem' }}>
                                      {fmtM(isDividend ? 0 : txn.price_per_share)}
                                    </td>
                                    <td title={isDividend ? 'No transaction fee was recorded for this dividend.' : undefined} style={{ padding: '0.3rem 0.75rem' }}>
                                      {fmtM(isDividend ? 0 : txn.fees)}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.75rem' }}>{fmtM(lotCost)}</td>
                                    <td title={unrealizedHelp} style={{ padding: '0.3rem 0.75rem', color: lotGL != null ? (lotGL >= 0 ? 'var(--p-81c784)' : 'var(--p-ef9a9a)') : undefined }}>
                                      {isClosedBuy ? (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}>
                                          <span style={{ color: 'var(--p-ffb74d)', fontSize: '0.68rem', fontWeight: 700 }}>Closed</span>
                                          <span>$0.00</span>
                                        </span>
                                      ) : formatMoney(lotGL, { fallback: '$0.00' })}
                                    </td>
                                    <td title={realizedHelp} style={{ padding: '0.3rem 0.75rem', color: txn.realized_gain != null ? (txn.realized_gain >= 0 ? 'var(--p-81c784)' : 'var(--p-ef9a9a)') : undefined }}>
                                      {formatMoney(txn.realized_gain, { fallback: '$0.00' })}
                                    </td>
                                    <td title={isDividend ? 'The dividend did not change the share position.' : undefined} style={{ padding: '0.3rem 0.75rem', borderLeft: '1px solid var(--p-1a3a5c)', fontWeight: 600 }}>
                                      {isDividend ? 'No change' : fmt(txn.position_after, 3)}
                                    </td>
                                    <td title={isDividend ? 'The dividend did not change average cost; any DRIP BUY is shown separately.' : undefined} style={{ padding: '0.3rem 0.75rem' }}>
                                      {isDividend ? 'No change' : fmtM(txn.avg_cost_after)}
                                    </td>
                                    <td title={isDividend ? 'The dividend did not change cost basis; any DRIP BUY is shown separately.' : undefined} style={{ padding: '0.3rem 0.75rem' }}>
                                      {isDividend ? 'No change' : fmtM(txn.total_cost_after)}
                                    </td>
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
            {sortedHoldings.length > 0 && (
              <tfoot>
                <tr>
                  {activeCols.map((col, i) => {
                    const frozen = i < frozenCount
                    const width = columnWidth(col)
                    return (
                      <td
                        key={col.key}
                        className={frozen ? 'frozen-col' : undefined}
                        style={{
                          fontWeight: 700,
                          textAlign: col.align || 'left',
                          color: footerValueColor(col),
                          width,
                          minWidth: width,
                          boxSizing: 'border-box',
                          ...(frozen ? {
                            ...frozenCellStyle(i),
                            zIndex: 3,
                            background: 'var(--surface)',
                          } : null),
                        }}
                        title={
                          col.key === 'gain_or_loss' || col.key === 'gain_or_loss_percentage'
                            ? (isLifetimeRange
                              ? COST_BASIS_SCOPE_NOTE
                              : isHoldingsFiltered
                                ? 'Sum of the visible current holdings for this range.'
                                : TRACKER_SCOPE_NOTE)
                            : (col.key === 'lifetime_gain_or_loss' || col.key === 'lifetime_gain_or_loss_percentage'
                              ? COST_BASIS_SCOPE_NOTE
                              : undefined)
                        }
                      >
                        {i === 0
                          ? (isHoldingsFiltered
                            ? 'Filtered Totals'
                            : (isLifetimeRange ? 'Totals' : 'Portfolio total'))
                          : renderFooterValue(col)}
                      </td>
                    )
                  })}
                  <td />
                </tr>
              </tfoot>
            )}
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
          onOpeningLotRecorded={() => {
            if (transactionReturnPath) navigate(transactionReturnPath)
          }}
          pf={pf}
        />
      )}

      {showTransactionHistory && (
        <TransactionHistoryModal
          onClose={() => setShowTransactionHistory(false)}
          pf={pf}
        />
      )}

      {showDripMatrix && (
        <DripMatrixModal
          onClose={() => setShowDripMatrix(false)}
          onSynced={(msg) => {
            setMessage(msg)
            invalidateDashboardCache()
            fetchHoldings()
          }}
          pf={pf}
        />
      )}
    </div>
  )
}
