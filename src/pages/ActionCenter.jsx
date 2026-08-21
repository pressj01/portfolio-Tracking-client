import React, { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useMarketRefresh } from '../context/MarketRefreshContext'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { convertMoneyText, formatMoney } from '../utils/money'

const PRIORITY_LABEL = {
  all: 'All',
  warning: 'Needs Review',
  info: 'Watch',
  success: 'Clear',
  completed: 'Completed',
}

const KIND_LABEL = {
  allocation: 'Allocation',
  data: 'Data',
  dividend: 'Dividend',
  income: 'Income',
  nav: 'NAV / CEF',
  options: 'Options',
  portfolio: 'Portfolio',
  rebalance: 'Rebalance',
  risk: 'Risk',
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

function ActionItem({ item, onComplete, onRestore, onRefresh, busy, refreshing }) {
  const kind = KIND_LABEL[item.kind] || item.kind || 'Portfolio'
  const isRefresh = item.action === 'refresh'
  return (
    <div className={`ac-item ac-${item.priority || 'info'}${item.completed ? ' ac-completed' : ''}`}>
      <div className="ac-item-main">
        <div className="ac-item-top">
          <span className="ac-kind">{kind}</span>
          <span className={`ac-priority ${item.priority || 'info'}`}>
            {item.priority === 'warning' ? 'Needs review' : item.priority === 'success' ? 'Clear' : 'Watch'}
          </span>
          {item.completed && <span className="ac-complete-status">Completed</span>}
        </div>
        <h2>{convertMoneyText(item.title)}</h2>
        <p>{convertMoneyText(item.detail)}</p>
      </div>
      <div className="ac-item-actions">
        {item.completed ? (
          <button
            type="button"
            className="btn btn-secondary ac-complete-btn"
            onClick={() => onRestore(item)}
            disabled={busy}
          >
            {busy ? 'Saving...' : 'Restore'}
          </button>
        ) : item.can_complete ? (
          <button
            type="button"
            className="btn btn-secondary ac-complete-btn"
            onClick={() => onComplete(item)}
            disabled={busy}
            title="Mark this action complete and remove it from the active list"
          >
            {busy ? 'Saving...' : 'Mark complete'}
          </button>
        ) : null}
        {isRefresh ? (
          <button
            type="button"
            className="btn btn-primary ac-item-link"
            onClick={() => onRefresh(item)}
            disabled={refreshing || busy}
          >
            {refreshing ? 'Refreshing...' : (item.cta || 'Refresh')}
          </button>
        ) : (
          <NavLink className="btn btn-secondary ac-item-link" to={item.route || '/'}>
            {item.cta || 'Open'}
          </NavLink>
        )}
      </div>
    </div>
  )
}

export default function ActionCenter() {
  const pf = useProfileFetch()
  const { selection, currentProfileName } = useProfile()
  const { runMarketRefresh, isRefreshing, message: refreshMessage } = useMarketRefresh()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [busyItemId, setBusyItemId] = useState(null)
  const [refreshVersion, setRefreshVersion] = useState(0)

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
  }, [pf, selection, refreshVersion])

  const items = data?.items || []
  const completedItems = data?.completed_items || []
  const filteredItems = filter === 'completed'
    ? completedItems
    : filter === 'all'
      ? items
      : items.filter(item => item.priority === filter)

  const counts = data?.summary?.counts || {}
  const warningCount = counts.warning || 0
  const infoCount = counts.info || 0
  const portfolioName = data?.summary?.profile || currentProfileName

  const updateCompletion = async (item, method) => {
    setBusyItemId(item.id)
    setError(null)
    try {
      const res = await pf(
        method === 'complete'
          ? '/api/action-center/completions'
          : `/api/action-center/completions/${encodeURIComponent(item.id)}`,
        method === 'complete'
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action_id: item.id }),
            }
          : { method: 'DELETE' },
      )
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.error || 'Could not update this action.')
      setRefreshVersion(version => version + 1)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyItemId(null)
    }
  }

  const handleRefreshData = async () => {
    setError(null)
    try {
      await runMarketRefresh({ statusMessage: 'Updating prices & dividends...' })
      setRefreshVersion(version => version + 1)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="page action-center-page">
      <div className="ac-title-row">
        <div>
          <h1>Action Center</h1>
          <p>{portfolioName} follow-ups, generated from the data already in the app.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleRefreshData}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>

      {loading && <div className="ac-loading"><span className="spinner" /> Loading action items...</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {!error && refreshMessage && <div className="alert alert-info">{refreshMessage}</div>}

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
            {['all', 'warning', 'info', 'success', 'completed'].map(key => {
              const count = key === 'all'
                ? items.length
                : key === 'completed'
                  ? completedItems.length
                  : counts[key] || 0
              return (
                <button
                  key={key}
                  type="button"
                  className={`tr-pbtn${filter === key ? ' tr-pbtn-active' : ''}`}
                  onClick={() => setFilter(key)}
                >
                  {PRIORITY_LABEL[key]} ({count})
                </button>
              )
            })}
          </div>

          {filteredItems.length === 0 ? (
            <div className="card ac-empty">
              {filter === 'completed'
                ? 'No completed action items.'
                : data.summary.holding_count
                  ? 'No active action items match this filter.'
                  : 'No holdings are available for this portfolio yet. Import or add holdings to begin generating action items.'}
            </div>
          ) : (
            <div className="ac-list">
              {filteredItems.map(item => (
                <ActionItem
                  key={item.id}
                  item={item}
                  busy={busyItemId === item.id}
                  refreshing={isRefreshing}
                  onComplete={action => updateCompletion(action, 'complete')}
                  onRestore={action => updateCompletion(action, 'restore')}
                  onRefresh={handleRefreshData}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
