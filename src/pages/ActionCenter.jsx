import React, { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { convertMoneyText, formatMoney } from '../utils/money'

const PRIORITY_LABEL = {
  all: 'All',
  warning: 'Needs Review',
  info: 'Watch',
  success: 'Clear',
}

const KIND_LABEL = {
  allocation: 'Allocation',
  data: 'Data',
  dividend: 'Dividend',
  income: 'Income',
  portfolio: 'Portfolio',
  rebalance: 'Rebalance',
  tax: 'Tax',
}

function ActionSummaryCard({ label, value, sub, tone }) {
  return (
    <div className={`ac-stat ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  )
}

function ActionItem({ item }) {
  const kind = KIND_LABEL[item.kind] || item.kind || 'Portfolio'
  return (
    <div className={`ac-item ac-${item.priority || 'info'}`}>
      <div className="ac-item-main">
        <div className="ac-item-top">
          <span className="ac-kind">{kind}</span>
          <span className={`ac-priority ${item.priority || 'info'}`}>
            {item.priority === 'warning' ? 'Needs review' : item.priority === 'success' ? 'Clear' : 'Watch'}
          </span>
        </div>
        <h2>{convertMoneyText(item.title)}</h2>
        <p>{convertMoneyText(item.detail)}</p>
      </div>
      <NavLink className="btn btn-secondary ac-item-link" to={item.route || '/'}>
        {item.cta || 'Open'}
      </NavLink>
    </div>
  )
}

export default function ActionCenter() {
  const pf = useProfileFetch()
  const { selection, currentProfileName } = useProfile()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)
    pf('/api/action-center')
      .then(async r => {
        const body = await r.json()
        if (!r.ok || body.error) throw new Error(body.error || 'Could not load Action Center.')
        return body
      })
      .then(body => {
        if (!stale) setData(body)
      })
      .catch(e => {
        if (!stale) setError(e.message)
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => { stale = true }
  }, [pf, selection])

  const items = data?.items || []
  const filteredItems = useMemo(() => (
    filter === 'all' ? items : items.filter(item => item.priority === filter)
  ), [items, filter])

  const counts = data?.summary?.counts || {}
  const warningCount = counts.warning || 0
  const infoCount = counts.info || 0
  const successCount = counts.success || 0
  const portfolioName = data?.summary?.profile || currentProfileName

  return (
    <div className="page action-center-page">
      <div className="ac-title-row">
        <div>
          <h1>Action Center</h1>
          <p>{portfolioName} follow-ups, generated from the data already in the app.</p>
        </div>
        <NavLink className="btn btn-primary" to="/holdings">Refresh Data</NavLink>
      </div>

      {loading && <div className="ac-loading"><span className="spinner" /> Loading action items...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && !loading && (
        <>
          <div className="ac-stat-grid">
            <ActionSummaryCard label="Items" value={data.summary.item_count || 0} sub={`As of ${data.summary.as_of}`} />
            <ActionSummaryCard label="Needs Review" value={warningCount} tone={warningCount ? 'warn' : 'good'} />
            <ActionSummaryCard label="Watch" value={infoCount} />
            <ActionSummaryCard label="Portfolio Value" value={formatMoney(data.summary.total_value, { zeroIfInvalid: true })} sub={`${data.summary.holding_count} holdings`} />
            <ActionSummaryCard label="Monthly Income" value={formatMoney(data.summary.monthly_income, { zeroIfInvalid: true })} />
          </div>

          <div className="ac-filter-row" role="tablist" aria-label="Action priority filters">
            {['all', 'warning', 'info', 'success'].map(key => (
              <button
                key={key}
                type="button"
                className={`tr-pbtn${filter === key ? ' tr-pbtn-active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {PRIORITY_LABEL[key]} {key !== 'all' ? `(${counts[key] || 0})` : `(${items.length})`}
              </button>
            ))}
          </div>

          {filteredItems.length === 0 ? (
            <div className="card ac-empty">
              No action items match this filter.
            </div>
          ) : (
            <div className="ac-list">
              {filteredItems.map(item => <ActionItem key={item.id} item={item} />)}
            </div>
          )}

          {items.length === 0 && (
            <div className="card ac-empty">
              No holdings are available for this portfolio yet. Import or add holdings to begin generating action items.
            </div>
          )}
        </>
      )}
    </div>
  )
}
