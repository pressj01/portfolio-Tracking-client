import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { API_BASE } from '../config'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useMarketRefresh } from '../context/MarketRefreshContext'
import ImportWorkflowPicker, { TransactionOrderWarning } from '../components/ImportWorkflowPicker'
import { clearAllDashboardCache } from '../utils/dashboardCache'
import { formatMoney as formatDisplayMoney } from '../utils/money'
import {
  NO_FORMAT,
  TXN_FORMATS,
  completedWorkflowSteps,
  describeWorkflow,
  formatForWorkflow,
  formatImportDetail,
  formatLabel,
  isPinnableFormat,
  isSnowballFormat,
  brokerIdFromSource,
  needsPositionsSnapshotFirst,
  workflowStepForFormat,
} from '../utils/importWorkflow'
import {
  applySchwabDestSelection,
  assignFileAccountToProfile,
  defaultSchwabDestSelection,
  destSelectionMatchesSaved,
  fileAccountForProfile,
  isSchwabBrokerSource,
  leftoverFileAccounts,
  mergeSchwabDestSelection,
  parseSavedDestinationIds,
  savedSchwabDestSelection,
  serializeDestinationIds,
  shouldAutodetectSchwabAllAccounts,
  schwabImportDestinations,
  SCHWAB_DEFAULT_DESTINATIONS_KEY,
} from '../utils/schwabAllAccountsImport'

const dateInputToday = () => {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const blankValue = '-'
const formatMoney = (value, decimals = 2) => (
  formatDisplayMoney(value, { digits: decimals, fallback: blankValue })
)
const formatShares = (value) => (
  value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(4) : blankValue
)

const BROKER_FORMAT_KEY = 'portfolio_defaultBrokerImportFormat'

const readDefaultBrokerFormat = () => {
  try {
    const saved = localStorage.getItem(BROKER_FORMAT_KEY)
    return isPinnableFormat(saved) ? saved : NO_FORMAT
  } catch {
    return NO_FORMAT
  }
}

function FileUpload({ onFileSelect, accept, file }) {
  const inputRef = useRef()
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) onFileSelect(f)
  }

  return (
    <div
      className={`file-drop ${dragOver ? 'drag-over' : ''}`}
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => onFileSelect(e.target.files[0])}
      />
      {file ? (
        <p className="filename">{file.name}</p>
      ) : (
        <>
          <p>Drag & drop your spreadsheet here</p>
          <p style={{ fontSize: '0.85rem' }}>or click to browse</p>
        </>
      )}
    </div>
  )
}

function SchwabDestinationPicker({
  destinations,
  destSelected,
  onToggle,
  onSelectAll,
  onSelectNone,
  accounts,
  accountMap,
  onAssignAccount,
  previewed,
  savedDestIds,
  onSaveDefaults,
  onClearDefaults,
  savingDefaults,
}) {
  const selectedCount = destinations.filter(profile => destSelected[String(profile.id)]).length
  const isSavedDefault = destSelectionMatchesSaved(destSelected, savedDestIds)

  if (!destinations.length) {
    return (
      <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
        No portfolios are set up to receive a Charles Schwab import. Set Broker Source
        to Charles Schwab on the Manage Portfolios page, or create a new portfolio
        after previewing the file.
      </div>
    )
  }

  return (
    <div className="form-group" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <label style={{ margin: 0 }}>Schwab accounts</label>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onSelectAll}
          style={{ padding: '0.2rem 0.65rem', fontSize: '0.8rem' }}
        >
          Select all
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onSelectNone}
          style={{ padding: '0.2rem 0.65rem', fontSize: '0.8rem' }}
        >
          Select none
        </button>
        <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
          {selectedCount} selected
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onSaveDefaults}
          disabled={savingDefaults || isSavedDefault}
          title={isSavedDefault
            ? 'These accounts are already your saved default'
            : 'Remember these accounts and pre-check them next time'}
          style={{ padding: '0.2rem 0.65rem', fontSize: '0.8rem' }}
        >
          {savingDefaults ? 'Saving…' : isSavedDefault ? '✓ Saved as default' : 'Save as default'}
        </button>
        {savedDestIds != null && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClearDefaults}
            disabled={savingDefaults}
            title="Go back to checking every Schwab-tagged portfolio"
            style={{ padding: '0.2rem 0.65rem', fontSize: '0.8rem' }}
          >
            Clear default
          </button>
        )}
      </div>
      <p style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
        Choose which of your Schwab portfolios this file should update. Unchecked accounts are left alone.
        {savedDestIds != null
          ? ' Your saved default is pre-checked each time you open this page.'
          : ' Use Save as default to have these same accounts pre-checked next time.'}
      </p>
      <div style={{ border: '1px solid var(--p-333)', borderRadius: '6px', overflow: 'hidden' }}>
        {destinations.map((profile, index) => {
          const id = String(profile.id)
          const checked = Boolean(destSelected[id])
          const matched = fileAccountForProfile(accounts, accountMap, id)
          const summary = matched?.summary || {}
          return (
            <div
              key={id}
              style={{
                padding: '0.75rem 1rem',
                borderBottom: index === destinations.length - 1 ? 'none' : '1px solid var(--p-333)',
                opacity: checked ? 1 : 0.65,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', flex: '1 1 220px', minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onToggle(id, e.target.checked)}
                  />
                  <span>
                    <span style={{ fontWeight: 600 }}>{profile.name}</span>
                    {!isSchwabBrokerSource(profile.broker_source) && (
                      <span style={{ color: 'var(--text-dim-2)', fontSize: '0.8rem' }}> (broker source not set)</span>
                    )}
                  </span>
                </label>
                {previewed && checked && (
                  <div style={{ flex: '1 1 280px', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Import from</span>
                    <select
                      value={matched?.account_key || ''}
                      onChange={(e) => onAssignAccount(e.target.value, id)}
                      style={{ flex: 1, minWidth: '180px' }}
                    >
                      <option value="">No matching account in this file</option>
                      {(accounts || []).map(account => (
                        <option key={account.account_key} value={account.account_key}>
                          {account.account_label}
                          {account.summary
                            ? ` · ${account.summary.holdings} holdings · ${formatMoney(account.summary.account_value)}`
                            : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {previewed && checked && matched && (
                <div style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginTop: '0.35rem', paddingLeft: '1.6rem' }}>
                  {summary.holdings} holdings, {formatMoney(summary.account_value)}
                  {summary.cash > 0 && <> including {formatMoney(summary.cash)} cash</>}
                </div>
              )}
              {previewed && checked && !matched && (
                <div style={{ color: 'var(--p-ffb74d)', fontSize: '0.8rem', marginTop: '0.35rem', paddingLeft: '1.6rem' }}>
                  Pick an account from the file, or uncheck to skip this portfolio.
                </div>
              )}
              {matched?.match_reason === 'saved_mapping' && (
                <div style={{ color: 'var(--text-dim-2)', fontSize: '0.8rem', marginTop: '0.25rem', paddingLeft: '1.6rem' }}>
                  Matched from your last All-Accounts import.
                </div>
              )}
              {summary.options > 0 && (
                <div style={{ color: 'var(--text-dim-2)', fontSize: '0.8rem', marginTop: '0.25rem', paddingLeft: '1.6rem' }}>
                  {summary.options} option position{summary.options === 1 ? '' : 's'} ({formatMoney(summary.options_value)})
                  are skipped, so Schwab's account total of {formatMoney(summary.reported_total)} counts them and this does not.
                </div>
              )}
              {previewed && checked && matched && (
                <details style={{ marginTop: '0.5rem', paddingLeft: '1.6rem' }}>
                  <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--accent-bright)' }}>
                    Show {summary.holdings} holdings
                  </summary>
                  <div style={{ maxHeight: '320px', overflow: 'auto', border: '1px solid var(--p-333)', borderRadius: '6px', marginTop: '0.5rem' }}>
                    <table className="data-table" style={{ fontSize: '0.8rem' }}>
                      <thead>
                        <tr>
                          <th>Ticker</th>
                          <th>Description</th>
                          <th style={{ textAlign: 'right' }}>Shares</th>
                          <th style={{ textAlign: 'right' }}>Cost/Share</th>
                          <th style={{ textAlign: 'right' }}>Price</th>
                          <th style={{ textAlign: 'right' }}>Mkt Value</th>
                          <th style={{ textAlign: 'right' }}>G/L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(matched.positions || []).map((p, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{p.ticker}</td>
                            <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</td>
                            <td style={{ textAlign: 'right' }}>{formatShares(p.quantity)}</td>
                            <td style={{ textAlign: 'right' }}>{formatMoney(p.cost_per_share)}</td>
                            <td style={{ textAlign: 'right' }}>{formatMoney(p.current_price, 4)}</td>
                            <td style={{ textAlign: 'right' }}>{formatMoney(p.current_value)}</td>
                            <td style={{ textAlign: 'right', color: (p.gain_or_loss || 0) >= 0 ? 'var(--p-4caf50)' : 'var(--p-f44336)' }}>
                              {formatMoney(p.gain_or_loss || 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SnowballImportTypeSwitch({ format, onSelect }) {
  const options = [
    { value: 'snowball_holdings', label: 'Holdings' },
    { value: 'snowball_categories', label: 'Categories' },
    { value: 'snowball', label: 'Transactions' },
  ]
  return (
    <div
      className="alert alert-info"
      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}
    >
      <strong>Snowball file:</strong>
      {options.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`btn ${format === item.value ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onSelect(item.value)}
          aria-pressed={format === item.value}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function GenericImportTypeSwitch({ activeType, onPositions, onTransactions }) {
  return (
    <div
      className="alert alert-info"
      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}
    >
      <strong>Choose what you are importing:</strong>
      <button
        type="button"
        className={`btn ${activeType === 'positions' ? 'btn-primary' : 'btn-secondary'}`}
        onClick={onPositions}
        aria-pressed={activeType === 'positions'}
      >
        Positions
      </button>
      <button
        type="button"
        className={`btn ${activeType === 'transactions' ? 'btn-primary' : 'btn-secondary'}`}
        onClick={onTransactions}
        aria-pressed={activeType === 'transactions'}
      >
        Transactions
      </button>
    </div>
  )
}

export default function Import() {
  const pf = useProfileFetch()
  const {
    isRefreshing: marketRefreshing,
    waitForMarketRefresh,
    runMarketRefresh,
    message: refreshMessage,
  } = useMarketRefresh()
  const { selection, profiles, profileId, isAggregate, refreshProfiles, currentProfileName } = useProfile()
  const [activeTab, setActiveTab] = useState('txnHistory')
  const [file, setFile] = useState(null)
  const [sheetName, setSheetName] = useState('All Accounts')
  const [loading, setLoading] = useState(false)
  const [waitingForRefresh, setWaitingForRefresh] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [multiSheet, setMultiSheet] = useState(false)
  const [navSnapshotDate, setNavSnapshotDate] = useState(dateInputToday)

  const [hasData, setHasData] = useState(false)
  const [hasPositions, setHasPositions] = useState(false)

  // Owner-format additional imports
  const [importWeekly, setImportWeekly] = useState(true)
  const [importMonthly, setImportMonthly] = useState(true)
  const [importMonthlyTickers, setImportMonthlyTickers] = useState(true)
  const [asTransactions, setAsTransactions] = useState(false)

  // Transaction History tab state
  const [txnFormat, setTxnFormat] = useState(readDefaultBrokerFormat)
  const [defaultTxnFormat, setDefaultTxnFormat] = useState(readDefaultBrokerFormat)
  const [txnFile, setTxnFile] = useState(null)
  const [txnPreview, setTxnPreview] = useState(null)
  const [txnPreviewLoading, setTxnPreviewLoading] = useState(false)
  const [txnImporting, setTxnImporting] = useState(false)
  const [txnNavOnly, setTxnNavOnly] = useState(false)
  // Account key -> portfolio id (or 'new' / 'skip') for multi-account files
  const [txnAccountMap, setTxnAccountMap] = useState({})
  // Portfolio id -> whether this All-Accounts import should write to it
  const [txnDestSelected, setTxnDestSelected] = useState({})
  const [savedDestIds, setSavedDestIds] = useState(null)
  const [savedDestLoaded, setSavedDestLoaded] = useState(false)
  const [savingDestDefaults, setSavingDestDefaults] = useState(false)
  const [workflowStep, setWorkflowStep] = useState(() => workflowStepForFormat(readDefaultBrokerFormat(), 'positions'))
  const [txnOrderAck, setTxnOrderAck] = useState(false)
  const [completedSteps, setCompletedSteps] = useState({})
  const [lastImportKind, setLastImportKind] = useState('')

  // Backup / restore state
  const [backups, setBackups] = useState([])
  const [restoring, setRestoring] = useState(false)

  // Cost-basis repair state
  const [basisReport, setBasisReport] = useState(null)
  const [basisChecking, setBasisChecking] = useState(false)
  const [basisRepairing, setBasisRepairing] = useState(false)
  const [basisResult, setBasisResult] = useState(null)
  const [basisError, setBasisError] = useState(null)

  // Watchlist import state
  const [wlFile, setWlFile] = useState(null)
  const [wlReplace, setWlReplace] = useState(false)
  const [wlLoading, setWlLoading] = useState(false)
  const [wlResult, setWlResult] = useState(null)
  const [wlError, setWlError] = useState(null)

  const loadBackups = useCallback((shouldApply) => {
    pf('/api/import/backups')
      .then(r => r.json())
      .then(d => {
        if (!shouldApply || shouldApply()) setBackups(d.backups || [])
      })
      .catch(() => {})
  }, [pf])

  const loadDataStats = useCallback(async (shouldApply) => {
    try {
      const response = await pf('/api/data/stats')
      if (!response.ok) return null
      const data = await response.json()
      if (!shouldApply || shouldApply()) {
        setHasData(data.holdings > 0)
        setHasPositions((data.active_holdings ?? data.dividends) > 0)
      }
      return data
    } catch {
      return null
    }
  }, [pf])

  const checkCostBasis = async () => {
    setBasisChecking(true)
    setBasisError(null)
    setBasisResult(null)
    try {
      const res = await pf('/api/transactions/cost-basis-report')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not check cost basis.')
      setBasisReport(data)
    } catch (e) {
      setBasisError(e.message)
    } finally {
      setBasisChecking(false)
    }
  }

  const repairCostBasis = async () => {
    if (!window.confirm(
      'Recalculate realized gains?\n\n' +
      'This rebuilds the gain or loss on every past sale from your transaction ' +
      'history, applying the recovered cost basis.\n\n' +
      'Expect some totals to go DOWN. Sales that were reporting their whole ' +
      'proceeds as profit were wrong, and where the basis cannot be recovered ' +
      'at all the gain becomes blank rather than a made-up number.\n\n' +
      'Only the recorded gain is rewritten — shares, prices and holdings are ' +
      'untouched, and a database backup is taken first.'
    )) return
    setBasisRepairing(true)
    setBasisError(null)
    setBasisResult(null)
    try {
      const res = await pf('/api/transactions/repair-cost-basis', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Repair failed.')
      setBasisResult(data)
      setBasisReport(null)
      loadBackups()
    } catch (e) {
      setBasisError(e.message)
    } finally {
      setBasisRepairing(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setHasData(false)
      setHasPositions(false)
      setCompletedSteps({})
      setLastImportKind('')
      setTxnOrderAck(false)
      setTxnFile(null)
      setTxnPreview(null)
      setTxnAccountMap({})
      setTxnDestSelected({})
      setTxnNavOnly(false)
      setResult(null)
      setError(null)
      setBackups([])
      loadDataStats(() => !cancelled)
      loadBackups(() => !cancelled)
    })
    return () => { cancelled = true }
  }, [selection, loadBackups, loadDataStats])

  // A positions file describes one brokerage account, so it needs a single
  // account as its destination. Two selections fail that: an aggregate, and
  // Owner once Owner is fed by more than one account. Only the All-Accounts
  // format is exempt — it names its own target per account block.
  const ownerSourceCount = useMemo(
    () => profiles.filter(p => p.id !== 1 && p.include_in_owner).length,
    [profiles],
  )
  const isOwnerRollup = !isAggregate && profileId === 1 && ownerSourceCount > 1
  const isRollupTarget = isAggregate || isOwnerRollup

  const txnIsMultiAccount = txnPreview?.format_type === 'positions_multi'
  const schwabDestinations = useMemo(
    () => schwabImportDestinations(
      txnIsMultiAccount ? (txnPreview.profile_choices || []) : profiles
    ),
    [txnIsMultiAccount, txnPreview, profiles],
  )
  const txnMappedAccounts = txnIsMultiAccount
    ? (txnPreview.accounts || []).filter(a => (txnAccountMap[a.account_key] ?? '') !== 'skip'
        && (txnAccountMap[a.account_key] ?? '') !== '')
    : []
  const txnLeftoverAccounts = txnIsMultiAccount
    ? leftoverFileAccounts(txnPreview.accounts, txnAccountMap)
    : []

  // Saved destination default. Loaded once; the seeding effect below waits for
  // it, otherwise it would seed the broker-source default first and the saved
  // picks would never get a chance to apply.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/settings`)
      .then(r => r.json())
      .then((all) => {
        if (cancelled) return
        setSavedDestIds(parseSavedDestinationIds(all?.[SCHWAB_DEFAULT_DESTINATIONS_KEY]))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSavedDestLoaded(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (txnFormat !== 'schwab_all_accounts' || !savedDestLoaded) return undefined
    let cancelled = false
    const destinations = schwabImportDestinations(profiles)
    queueMicrotask(() => {
      if (cancelled) return
      setTxnDestSelected((prev) => (
        Object.keys(prev).length
          ? mergeSchwabDestSelection(prev, destinations)
          : (savedSchwabDestSelection(destinations, savedDestIds)
            || defaultSchwabDestSelection(destinations))
      ))
    })
    return () => { cancelled = true }
  }, [txnFormat, profiles, savedDestLoaded, savedDestIds])

  const saveDestDefaults = async () => {
    const payload = serializeDestinationIds(txnDestSelected)
    setSavingDestDefaults(true)
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [SCHWAB_DEFAULT_DESTINATIONS_KEY]: payload }),
      })
      if (res.ok) setSavedDestIds(parseSavedDestinationIds(payload))
    } finally {
      setSavingDestDefaults(false)
    }
  }

  const clearDestDefaults = async () => {
    setSavingDestDefaults(true)
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [SCHWAB_DEFAULT_DESTINATIONS_KEY]: '' }),
      })
      if (res.ok) setSavedDestIds(null)
    } finally {
      setSavingDestDefaults(false)
    }
  }

  const txnHasRows = txnPreview
    ? (txnPreview.format_type === 'positions_multi'
        ? txnMappedAccounts.length > 0
        : txnPreview.format_type === 'combined_export'
        ? ((txnPreview.summary?.holdings || 0) > 0 || (txnPreview.summary?.transactions || 0) > 0)
        : txnPreview.format_type === 'categories'
        ? (txnPreview.summary?.categories || 0) > 0
        : txnPreview.format_type === 'positions'
        ? txnPreview.positions.length > 0
        : txnPreview.transactions.length > 0)
    : false
  const txnAccountMismatch = Boolean(txnPreview?.account_match && txnPreview.account_match.matched === false)
  const currentProfile = useMemo(
    () => profiles.find(profile => profile.id === profileId) || null,
    [profiles, profileId],
  )
  const workflow = useMemo(() => describeWorkflow(txnFormat), [txnFormat])
  const txnNeedsPositionsAck = needsPositionsSnapshotFirst(txnFormat) && !hasPositions
  const txnImportBlocked = txnNeedsPositionsAck && !txnOrderAck

  const resetState = () => {
    setFile(null)
    setResult(null)
    setError(null)
  }

  const applyTxnFormat = useCallback((nextFormat, nextStep) => {
    setTxnFormat(nextFormat)
    setTxnPreview(null)
    setTxnAccountMap({})
    setTxnDestSelected({})
    setTxnFile(null)
    setTxnNavOnly(false)
    setResult(null)
    setError(null)
    setTxnOrderAck(false)
    setLastImportKind('')
    if (nextStep) setWorkflowStep(nextStep)
    else setWorkflowStep((current) => workflowStepForFormat(nextFormat, current))
  }, [])

  useEffect(() => {
    if (txnFormat || isRollupTarget) return
    const brokerId = brokerIdFromSource(currentProfile?.broker_source)
    if (!brokerId) return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        applyTxnFormat(formatForWorkflow({ brokerId, role: 'positions' }), 'positions')
      }
    })
    return () => { cancelled = true }
  }, [applyTxnFormat, currentProfile, isRollupTarget, txnFormat])

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    resetState()
    setTxnFile(null)
    setTxnPreview(null)
    setTxnAccountMap({})
    setTxnNavOnly(false)
    if (tab === 'txnHistory') {
      setWorkflowStep(workflowStepForFormat(txnFormat, 'positions'))
    }
  }

  const selectWorkflowStep = (step) => {
    setWorkflowStep(step)
    setResult(null)
    setError(null)
    setLastImportKind('')
    if (step === 'refresh') return
    if (workflow.brokerId) {
      applyTxnFormat(formatForWorkflow({
        brokerId: workflow.brokerId,
        role: step,
        schwabAllAccounts: step === 'positions' && workflow.schwabAllAccounts,
      }), step)
      return
    }
    const brokerId = brokerIdFromSource(currentProfile?.broker_source)
    if (brokerId) {
      applyTxnFormat(formatForWorkflow({ brokerId, role: step }), step)
    }
  }

  const selectImportBroker = (brokerId) => {
    const role = workflowStep === 'transactions' ? 'transactions' : 'positions'
    applyTxnFormat(formatForWorkflow({
      brokerId,
      role,
      schwabAllAccounts: brokerId === 'schwab' && workflow.schwabAllAccounts && role === 'positions',
    }), role)
  }

  const selectSchwabScope = (allAccounts) => {
    applyTxnFormat(formatForWorkflow({
      brokerId: 'schwab',
      role: 'positions',
      schwabAllAccounts: allAccounts,
    }), 'positions')
  }

  const selectSchwabAllAccounts = () => {
    setActiveTab('txnHistory')
    applyTxnFormat('schwab_all_accounts', 'positions')
  }

  const maybeAutodetectSchwabAllAccounts = (file) => {
    if (file && shouldAutodetectSchwabAllAccounts(file.name, txnFormat)) {
      applyTxnFormat('schwab_all_accounts', 'positions')
      // applyTxnFormat clears the previous upload; keep the file that triggered
      // autodetection so the user can preview it without selecting it twice.
      setTxnFile(file)
    }
  }

  const handleToggleSchwabDest = (profileId, checked) => {
    const nextSelected = { ...txnDestSelected, [String(profileId)]: checked }
    setTxnDestSelected(nextSelected)
    if (txnIsMultiAccount) {
      setTxnAccountMap(applySchwabDestSelection(nextSelected, txnPreview.accounts, txnAccountMap))
    }
  }

  const handleSelectAllSchwabDest = () => {
    const nextSelected = Object.fromEntries(schwabDestinations.map(profile => [String(profile.id), true]))
    setTxnDestSelected(nextSelected)
    if (txnIsMultiAccount) {
      setTxnAccountMap(applySchwabDestSelection(nextSelected, txnPreview.accounts, txnAccountMap))
    }
  }

  const handleSelectNoneSchwabDest = () => {
    const nextSelected = Object.fromEntries(schwabDestinations.map(profile => [String(profile.id), false]))
    setTxnDestSelected(nextSelected)
    if (txnIsMultiAccount) {
      setTxnAccountMap(applySchwabDestSelection(nextSelected, txnPreview.accounts, txnAccountMap))
    }
  }

  const handleAssignSchwabAccount = (accountKey, profileId) => {
    setTxnDestSelected(prev => ({ ...prev, [String(profileId)]: true }))
    setTxnAccountMap(prev => assignFileAccountToProfile(prev, accountKey, profileId))
  }

  const handleLeftoverAccountChange = (accountKey, value) => {
    if (value === 'new') {
      setTxnAccountMap(prev => ({ ...prev, [accountKey]: 'new' }))
      return
    }
    if (!value) {
      setTxnAccountMap(prev => ({ ...prev, [accountKey]: '' }))
      return
    }
    setTxnDestSelected(prev => ({ ...prev, [String(value)]: true }))
    setTxnAccountMap(prev => assignFileAccountToProfile(prev, accountKey, value))
  }

  const handleGenericTransactionsTab = () => {
    handleTabChange('txnHistory')
    applyTxnFormat('generic_transactions', 'transactions')
  }

  const handleSnowballTab = () => {
    handleTabChange('txnHistory')
    if (!isSnowballFormat(txnFormat)) applyTxnFormat('snowball_holdings', 'migration')
  }

  const handleBrokerageImportTab = () => {
    handleTabChange('txnHistory')
    if (txnFormat === 'generic_transactions' || isSnowballFormat(txnFormat)) {
      const fallback = defaultTxnFormat || formatForWorkflow({
        brokerId: brokerIdFromSource(currentProfile?.broker_source) || 'schwab',
        role: 'positions',
      })
      applyTxnFormat(fallback, 'positions')
    }
  }

  const pinDefaultTxnFormat = () => {
    try {
      localStorage.setItem(BROKER_FORMAT_KEY, txnFormat)
    } catch {
      // A blocked localStorage only costs the preference, not the import.
    }
    setDefaultTxnFormat(txnFormat)
  }

  const uploadFile = async (endpoint, extraFields = {}) => {
    if (!file) return
    setLoading(true)
    setResult(null)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)
    for (const [k, v] of Object.entries(extraFields)) {
      formData.append(k, v)
    }

    const res = await pf(endpoint, { method: 'POST', body: formData })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Import failed')
    return data
  }

  const waitForRefreshBeforeImport = async () => {
    if (marketRefreshing) setWaitingForRefresh(true)
    try {
      await waitForMarketRefresh()
    } finally {
      setWaitingForRefresh(false)
    }
  }

  const handleOwnerImport = async () => {
    setLoading(true)
    setResult(null)
    setError(null)

    const results = []

    try {
      await waitForRefreshBeforeImport()
      // Main import
      const extraFields = multiSheet ? { multi_sheet: 'true' } : { sheet_name: sheetName }
      extraFields.nav_date = navSnapshotDate
      if (asTransactions) extraFields.as_transactions = 'true'
      const main = await uploadFile(`/api/import/excel`, extraFields)
      results.push(main.message)
      if (main.details) {
        main.details.forEach(d => results.push(`  ${d.profile_name}: ${d.message}`))
        refreshProfiles()
      }

      // Additional imports from the same file
      if (importWeekly) {
        try {
          const w = await uploadFile(`/api/import/weekly-payouts`)
          results.push(w.message)
        } catch (e) {
          results.push(`Weekly payouts: ${e.message}`)
        }
      }
      if (importMonthly) {
        try {
          const m = await uploadFile(`/api/import/monthly-payouts`)
          results.push(m.message)
        } catch (e) {
          results.push(`Monthly payouts: ${e.message}`)
        }
      }
      if (importMonthlyTickers) {
        try {
          const mt = await uploadFile(`/api/import/monthly-payout-tickers`)
          results.push(mt.message)
        } catch (e) {
          results.push(`Monthly tickers: ${e.message}`)
        }
      }

      setResult(results)
      clearAllDashboardCache()
      await loadDataStats()
      loadBackups()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGenericImport = async () => {
    setLoading(true)
    setResult(null)
    setError(null)

    try {
      await waitForRefreshBeforeImport()
      const extraFields = multiSheet ? { multi_sheet: 'true' } : {}
      extraFields.nav_date = navSnapshotDate
      if (asTransactions) extraFields.as_transactions = 'true'
      const data = await uploadFile(`/api/import/generic`, extraFields)
      setResult([data.message])
      if (data.details) {
        setResult([data.message, ...data.details.map(d => `  ${d.profile_name}: ${d.message}`)])
        refreshProfiles()
      }
      clearAllDashboardCache()
      await loadDataStats()
      loadBackups()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadTemplate = () => {
    window.open(`${API_BASE}/api/template/download`, '_blank')
  }

  const handleDownloadGenericTransactionsTemplate = () => {
    window.open(`${API_BASE}/api/template/generic-transactions-download`, '_blank')
  }

  const handleDownloadEtradeTemplate = () => {
    window.open(`${API_BASE}/api/template/etrade-download`, '_blank')
  }

  const handleDownloadSchwabTemplate = () => {
    window.open(`${API_BASE}/api/template/schwab-download`, '_blank')
  }

  const handleDownloadSchwabTransactionsTemplate = () => {
    window.open(`${API_BASE}/api/template/schwab-transactions-download`, '_blank')
  }

  const handleDownloadSnowballHoldingsTemplate = () => {
    window.open(`${API_BASE}/api/template/snowball-holdings-download`, '_blank')
  }

  const handleDownloadEtradeTransactionsTemplate = () => {
    window.open(`${API_BASE}/api/template/etrade-transactions-download`, '_blank')
  }

  const handleDownloadFidelityTemplate = () => {
    window.open(`${API_BASE}/api/template/fidelity-download`, '_blank')
  }

  const handleDownloadFidelityTransactionsTemplate = () => {
    window.open(`${API_BASE}/api/template/fidelity-transactions-download`, '_blank')
  }

  const handleDownloadRobinhoodHoldingsTemplate = () => {
    window.open(`${API_BASE}/api/template/robinhood-holdings-download`, '_blank')
  }

  const handleDownloadRobinhoodTransactionsTemplate = () => {
    window.open(`${API_BASE}/api/template/robinhood-transactions-download`, '_blank')
  }

  const handleDownloadWatchlistTemplate = () => {
    window.open(`${API_BASE}/api/template/watchlist-download`, '_blank')
  }

  const handleWatchlistImport = async () => {
    if (!wlFile) return
    setWlLoading(true)
    setWlResult(null)
    setWlError(null)
    const formData = new FormData()
    formData.append('file', wlFile)
    if (wlReplace) formData.append('replace', 'true')
    try {
      const res = await pf('/api/import/watchlist', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setWlResult(data.message)
      setWlFile(null)
    } catch (e) {
      setWlError(e.message)
    } finally {
      setWlLoading(false)
    }
  }

  const allAccountsFromRollup = (
    isRollupTarget && activeTab === 'txnHistory' && txnFormat === 'schwab_all_accounts'
  )

  if (isRollupTarget && !allAccountsFromRollup) {
    return (
      <div className="page">
        <h1>Import Portfolio Data</h1>
        <div className="alert alert-info">
          {isAggregate
            ? 'Cannot import while viewing an Aggregate portfolio. Please select a specific portfolio from the navbar dropdown.'
            : `Cannot import into ${currentProfileName}, which is a rollup of ${ownerSourceCount} accounts. Please select one of those accounts from the navbar dropdown.`}
        </div>
        <p style={{ color: 'var(--text-dim-2)', marginTop: '0.75rem' }}>
          Positions, transactions, and Snowball files describe one brokerage account, so they
          import into the single selected account. The exception is a Schwab All-Accounts
          Positions export: that one file can update several Schwab portfolios because you map
          accounts after preview. There is no All-Accounts importer for transactions or for
          other brokers.
        </p>
        <button className="btn btn-primary" style={{ marginTop: '0.75rem' }} onClick={selectSchwabAllAccounts}>
          Import Charles Schwab (All Accounts Positions)
        </button>
      </div>
    )
  }

  const snapshotDateControl = (
    <div className="form-group" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
      <label>NAV Snapshot Date</label>
      <input
        type="date"
        value={navSnapshotDate}
        onChange={(e) => setNavSnapshotDate(e.target.value)}
        style={{ width: '180px' }}
      />
    </div>
  )

  return (
    <div className="page">
      <h1>Import Portfolio Data</h1>
      <p style={{ color: 'var(--accent-bright)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        {txnFormat === 'schwab_all_accounts'
          ? 'Each selected Schwab account is imported from the All-Accounts file into its own portfolio.'
          : <>Importing into: <strong>{currentProfileName}</strong></>}
      </p>
      {isRollupTarget && (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          {isAggregate
            ? 'Viewing an aggregate. Other import types need a single account selected.'
            : `${currentProfileName} is a rollup of ${ownerSourceCount} accounts. Other import types need a single account selected.`}
          {' '}This All-Accounts import still works because each Schwab account is routed on its own.
        </div>
      )}
      {(marketRefreshing || waitingForRefresh) && (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          Price and dividend refresh is finishing. Imports will be available as soon as the refresh completes.
        </div>
      )}

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'txnHistory' && txnFormat !== 'generic_transactions' && !isSnowballFormat(txnFormat) ? 'active' : ''}`}
          onClick={handleBrokerageImportTab}
        >
          Broker Import
        </button>
        <button
          className={`tab ${activeTab === 'generic' ? 'active' : ''}`}
          onClick={() => handleTabChange('generic')}
          disabled={isRollupTarget}
          title={isRollupTarget ? 'Select a single account to use Generic Positions' : undefined}
        >
          Generic Positions
        </button>
        <button
          className={`tab ${activeTab === 'txnHistory' && txnFormat === 'generic_transactions' ? 'active' : ''}`}
          onClick={handleGenericTransactionsTab}
          disabled={isRollupTarget}
          title={isRollupTarget ? 'Select a single account to use Generic Transactions' : undefined}
        >
          Generic Transactions
        </button>
        <button
          className={`tab ${activeTab === 'txnHistory' && isSnowballFormat(txnFormat) ? 'active' : ''}`}
          onClick={handleSnowballTab}
          disabled={isRollupTarget}
          title={isRollupTarget ? 'Select a single account to import Snowball data' : undefined}
        >
          Snowball
        </button>
      </div>

      {/* ── Owner Excel Import ─────────────────────────────────────────── */}
      {activeTab === 'owner' && (
        <div className="card">
          <h2>Import Your Dividend Tracking Spreadsheet</h2>
          <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
            Upload your Excel file (.xlsm or .xlsx) with the "All Accounts" sheet format.
            This will import your holdings, dividend data, and payout history.
          </p>

          <FileUpload
            onFileSelect={setFile}
            accept=".xlsx,.xlsm,.xls"
            file={file}
          />
          {snapshotDateControl}

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '1rem' }}>
              <input
                type="checkbox"
                checked={multiSheet}
                onChange={(e) => setMultiSheet(e.target.checked)}
              />
              <strong>Import all sheets as separate portfolios</strong>
              <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                (each sheet becomes its own portfolio, named after the sheet)
              </span>
            </label>

            {!multiSheet && (
              <div className="form-group">
                <label>Sheet Name</label>
                <input
                  type="text"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  style={{ width: '250px' }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={importWeekly}
                  onChange={(e) => setImportWeekly(e.target.checked)}
                />
                Import Weekly Payouts
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={importMonthly}
                  onChange={(e) => setImportMonthly(e.target.checked)}
                />
                Import Monthly Payouts
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={importMonthlyTickers}
                  onChange={(e) => setImportMonthlyTickers(e.target.checked)}
                />
                Import Dividend Months
              </label>
            </div>
          </div>

          {hasData && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              Merge mode: existing holdings will be updated with spreadsheet values. New tickers will be added. App-only fields (like DRIP toggles or pay dates you edited) are preserved unless the spreadsheet provides them.
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '1rem' }}>
            <input
              type="checkbox"
              checked={asTransactions}
              onChange={(e) => setAsTransactions(e.target.checked)}
            />
            <strong>Import rows as transactions</strong>
            <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
              (compares imported shares to current position — creates a BUY or SELL transaction for the difference)
            </span>
          </label>

          <button
            className="btn btn-primary"
            onClick={handleOwnerImport}
            disabled={!file || loading || marketRefreshing || waitingForRefresh}
          >
            {waitingForRefresh || marketRefreshing ? <><span className="spinner" /> Waiting...</> : loading ? <><span className="spinner" /> Importing...</> : hasData ? 'Merge Spreadsheet' : 'Import Spreadsheet'}
          </button>
        </div>
      )}

      {/* ── Generic Upload ─────────────────────────────────────────────── */}
      {activeTab === 'generic' && (
        <div className="card">
          <h2>Import Generic Positions</h2>
          <GenericImportTypeSwitch
            activeType="positions"
            onTransactions={handleGenericTransactionsTab}
          />
          <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
            Upload an Excel file with at minimum <strong>Ticker</strong> and <strong>Shares</strong> columns.
            Optional columns: Price Paid, Dividend, Frequency, Ex-Div Date, DRIP.
            Market data will be enriched automatically via Yahoo Finance.
            The template includes up to 12 portfolio tabs.
          </p>

          <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleDownloadTemplate}>
              Download Holdings Template
            </button>
          </div>

          <FileUpload
            onFileSelect={setFile}
            accept=".xlsx,.xlsm,.xls,.csv"
            file={file}
          />
          {snapshotDateControl}

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '1rem' }}>
              <input
                type="checkbox"
                checked={multiSheet}
                onChange={(e) => setMultiSheet(e.target.checked)}
              />
              <strong>Import all tabs as separate portfolios</strong>
              <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                (each filled tab creates a portfolio named after the tab)
              </span>
            </label>

            {hasData && (
              <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
                Merge mode: existing holdings will be updated with spreadsheet values. New tickers will be added. App-only fields are preserved unless the spreadsheet provides them.
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '1rem' }}>
              <input
                type="checkbox"
                checked={asTransactions}
                onChange={(e) => setAsTransactions(e.target.checked)}
              />
              <strong>Import rows as transactions</strong>
              <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                (compares imported shares to current position — creates a BUY or SELL transaction for the difference)
              </span>
            </label>

            <button
              className="btn btn-primary"
              onClick={handleGenericImport}
              disabled={!file || loading || marketRefreshing || waitingForRefresh}
            >
              {waitingForRefresh || marketRefreshing ? <><span className="spinner" /> Waiting...</> : loading ? <><span className="spinner" /> Importing...</> : hasData ? 'Merge Portfolio' : 'Import Portfolio'}
            </button>
          </div>

          <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--p-2a3344)' }}>
            <h2 style={{ marginTop: 0 }}>Import Watchlist</h2>
            <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
              Import a watchlist file (.xlsx or .csv) with at minimum a <strong>Ticker</strong> column.
              Optional: <strong>Notes</strong>, <strong>Div Yield Override</strong>, <strong>NAV Erosion Scope</strong>,
              and <strong>NAV Benchmark Override</strong>. The watchlist is global &mdash; it is not tied to the selected portfolio.
              Use the <em>Export Watchlist</em> button on the Export page to round-trip your list.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <button className="btn btn-secondary" onClick={handleDownloadWatchlistTemplate}>
                Download Watchlist Template
              </button>
            </div>

            <FileUpload
              onFileSelect={(f) => { setWlFile(f); setWlResult(null); setWlError(null) }}
              accept=".xlsx,.xls,.csv"
              file={wlFile}
            />

            <div style={{ marginTop: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '1rem' }}>
                <input
                  type="checkbox"
                  checked={wlReplace}
                  onChange={(e) => setWlReplace(e.target.checked)}
                />
                <strong>Replace existing watchlist</strong>
                <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                  (otherwise: merge &mdash; new tickers added, notes updated for existing)
                </span>
              </label>

              <button
                className="btn btn-primary"
                onClick={handleWatchlistImport}
                disabled={!wlFile || wlLoading}
              >
                {wlLoading ? <><span className="spinner" /> Importing...</> : 'Import Watchlist'}
              </button>
            </div>

            {wlError && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{wlError}</div>}
            {wlResult && <div className="alert alert-success" style={{ marginTop: '1rem' }}>{wlResult}</div>}
          </div>
        </div>
      )}

      {/* ── Transaction History Import ─────────────────────────────────── */}
      {activeTab === 'txnHistory' && (
        <div className="card">
          <h2>
            {txnFormat === 'generic_transactions'
              ? 'Import Generic Transactions'
              : isSnowballFormat(txnFormat)
                ? 'Import Snowball (Migration)'
                : 'Broker Import'}
          </h2>
          {isSnowballFormat(txnFormat) && (
            <>
              <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
                Use this tab only when moving an old Snowball portfolio into the app.
                If you import from Schwab or another broker, stay on <strong>Broker Import</strong> —
                you do not need Snowball.
              </p>
              <SnowballImportTypeSwitch
                format={txnFormat}
                onSelect={(value) => applyTxnFormat(value, 'migration')}
              />
            </>
          )}
          {txnFormat !== 'generic_transactions' && !isSnowballFormat(txnFormat) && (
            <ImportWorkflowPicker
              format={txnFormat}
              step={workflowStep}
              workflow={workflow}
              completedSteps={completedSteps}
              hasPositions={hasPositions}
              currentProfileName={currentProfileName}
              isRollupTarget={isRollupTarget}
              txnOrderAck={txnOrderAck}
              onTxnOrderAckChange={setTxnOrderAck}
              onSelectStep={selectWorkflowStep}
              onSelectBroker={selectImportBroker}
              onSelectSchwabScope={selectSchwabScope}
              onSelectOtherFormat={(value) => applyTxnFormat(value, workflowStepForFormat(value, 'positions'))}
              onRefresh={async () => {
                setError(null)
                try {
                  await runMarketRefresh({ statusMessage: 'Updating prices & dividends...' })
                  setCompletedSteps((prev) => ({ ...prev, refresh: true }))
                  setResult(['Prices and dividend fields refreshed.'])
                } catch (e) {
                  setError(e.message)
                }
              }}
              refreshing={marketRefreshing}
              refreshMessage={refreshMessage}
            />
          )}
          {txnFormat === 'generic_transactions' && (
            <GenericImportTypeSwitch
              activeType="transactions"
              onPositions={() => handleTabChange('generic')}
            />
          )}
          {(txnFormat === 'generic_transactions' || isSnowballFormat(txnFormat)) && (
            <TransactionOrderWarning
              format={txnFormat}
              hasPositions={hasPositions}
              currentProfileName={currentProfileName}
              txnOrderAck={txnOrderAck}
              onTxnOrderAckChange={setTxnOrderAck}
            />
          )}
          {(txnFormat === 'generic_transactions' || workflowStep !== 'refresh') && (
          <>
          <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
            {txnFormat === 'portfolio_export'
              ? <>Import the app's <strong>Holdings + Transactions Excel export</strong>. Preview shows the portfolio sheets and the Transactions sheet, then import restores both together from one file.</>
            : txnFormat === 'generic_transactions'
              ? <>Import broker-neutral transaction history from the app's <strong>Generic Transactions XLSX or CSV</strong> format. BUY, SELL, DIVIDEND, and DRIP rows use the same preview, duplicate protection, position rollup, dividend tracking, and realized-gain workflow as broker transaction imports.</>
            : txnFormat === 'snowball_categories'
              ? <>Import categories, slash-delimited sub-categories, and ticker assignments from a Snowball <strong>Holdings CSV or XLSX</strong>. Existing assignments are preserved; position values and transactions are not imported.</>
            : txnFormat === 'schwab'
              ? <>Import current positions from a Schwab <strong>Positions CSV or XLSX</strong> export. In Schwab, go to Accounts {'>'} Positions, then export to CSV or Excel. This sets holdings, cost basis, and current prices directly.</>
            : txnFormat === 'schwab_all_accounts'
              ? <>Import every Schwab account from one <strong>All-Accounts Positions CSV or XLSX</strong> export. In Schwab, go to Accounts {'>'} Positions, switch the account selector to <strong>All Accounts</strong>, then export. Choose which of your Schwab portfolios to import into; preview then matches each selected portfolio to an account in the file.</>
              : txnFormat === 'snowball_holdings'
                ? <>Import a Snowball <strong>Holdings CSV or XLSX</strong> as a migration snapshot. This keeps only the holdings, dividend, and category fields the app can actually use, and ignores Snowball-only analytics columns.</>
              : txnFormat === 'schwab_transactions'
                ? <>Import transaction history from a Schwab <strong>Transactions CSV or XLSX</strong> export. In Schwab, go to Accounts {'>'} History, set the date range, then export to CSV or Excel. Imports buys, sells, DRIP reinvestments, and dividend payments.</>
              : txnFormat === 'etrade'
                ? <>Import current positions from an E*TRADE <strong>portfolio download CSV or XLSX</strong>. The file account must match the portfolio you currently have selected before import is allowed.</>
              : txnFormat === 'etrade_transactions'
                ? <>Import buy, sell, dividend, and DRIP rows from one E*TRADE <strong>All Transactions XLSX or CSV</strong> export. In E*TRADE, go to Accounts {'>'} Transaction History, choose all transaction activity types, then download.</>
                : txnFormat === 'fidelity'
                  ? <>Import current positions from a Fidelity <strong>Positions XLSX or CSV</strong> export. This uses only the holdings and dividend fields the app already supports, and treats money market rows as cash.</>
                  : txnFormat === 'fidelity_transactions'
                    ? <>Import transaction history from a Fidelity <strong>Transactions XLSX or CSV</strong> export. This imports buys, sells, dividend cash receipts, and DRIP reinvestments for recordkeeping.</>
                  : txnFormat === 'robinhood'
                    ? <>Import current positions from a Robinhood <strong>Holdings PDF</strong>. Robinhood does not include cost basis in this PDF, so current value is used as the initial cost basis.</>
                  : txnFormat === 'robinhood_transactions'
                    ? <>Import transaction history from a Robinhood <strong>Transactions CSV or XLSX</strong> export. This imports buys, sells, cash/manufactured dividends, capital gains, and ACAT share transfers.</>
                  : txnFormat === 'shear_group'
                    ? <>Import current positions from a Shear Group <strong>Positions CSV or Excel</strong> export. This sets holdings, cost basis, current prices, and unrealized gain/loss directly.</>
                  : txnFormat === 'shear_group_activity'
                    ? <>Import activity history from a Shear Group <strong>Activity CSV or Excel</strong> export. This imports buys, sells, cash dividends, capital gains, and dividend reinvestments.</>
                 : <>Import BUY/SELL transactions and dividend payments from your broker or tracking app.
                 Each file should be a <strong>single account</strong> export — combined/merged exports will be rejected.</>
            }
          </p>

          {['generic_transactions', 'snowball', 'schwab_transactions', 'etrade_transactions', 'fidelity_transactions', 'robinhood_transactions', 'shear_group_activity'].includes(txnFormat) && (
            <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
              <strong>Partial history warning:</strong> If this file does not cover the full account history
              (e.g. only the last 1–2 years), imported buy/sell transactions will recalculate your share
              counts and cost basis from the transactions alone — which may not match your actual holdings.
              {txnFormat === 'snowball' && (<>
                {' '}Snowball Analytics exports may also not exactly match the broker's live positions or account value.
              </>)}
              <br /><br />
              <strong>Recommended approach:</strong> Import a <em>Positions</em> file first (Schwab, E*TRADE, Fidelity, Robinhood, or Shear Group)
              to set accurate current holdings, then import transaction history for dividend tracking and
              realized gain records. When a Positions import has been done first, transaction imports store
              history without overwriting your holdings data.
              <br /><br />
              A database backup is created automatically before every import and dividend repair — you can restore from the
              bottom of this page if needed.
            </div>
          )}

          {txnFormat === 'generic_transactions' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Generic transactions template available:</strong> download the XLSX template, replace the sample rows, and keep one transaction per row. CSV files with the same headers are also supported.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadGenericTransactionsTemplate}>
                  Download Generic Transactions Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'etrade' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>E*TRADE template available:</strong> the downloadable template contains the exact account summary and holdings field names this importer reads.
              If you build or edit an E*TRADE CSV/XLSX manually, keep those headers unchanged.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadEtradeTemplate}>
                  Download E*TRADE Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'schwab' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Schwab template available:</strong> the downloadable template contains the exact holdings field names this importer reads.
              If you build or edit a Schwab CSV/XLSX manually, keep those headers unchanged and leave the first "Positions for account ..." line in place when using CSV.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadSchwabTemplate}>
                  Download Schwab Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'schwab_all_accounts' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>One file, selected accounts:</strong> Schwab's All-Accounts export stacks each account
              under its own label row (for example <em>Roth_IRA ...995</em>). Check the Schwab portfolios
              you want this import to update. Preview matches each selected portfolio to an account in the
              file; anything unmatched can be pointed at a portfolio or given a new one. Unchecked
              portfolios are left alone. Your choices are remembered, so the next export maps itself.
              Options positions are listed for reconciliation but are not imported as holdings.
            </div>
          )}

          {txnFormat === 'snowball_holdings' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Snowball holdings template available:</strong> the downloadable CSV contains the exact migration fields this importer reads. CSV and XLSX files with those fields are supported.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadSnowballHoldingsTemplate}>
                  Download Snowball Holdings Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'snowball_categories' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Snowball categories import:</strong> the file must include a <strong>Category</strong> column. Labels such as <em>GROWTH / Growth-Stocks</em> import as category <em>GROWTH</em> with subcategory <em>Growth-Stocks</em>. A label without a slash, such as <em>CASH</em>, is a top-level category. Duplicate entries in the file and categories already in this account are skipped. Existing categories are never deleted.
            </div>
          )}

          {txnFormat === 'schwab_transactions' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Schwab transactions template available:</strong> the downloadable template contains the exact transaction columns this importer reads for buys, sells, cash dividends, DRIP share purchases, and reinvestment adjustments. CSV and XLSX files with those fields are supported.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadSchwabTransactionsTemplate}>
                  Download Schwab Transactions Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'etrade_transactions' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>E*TRADE transactions template available:</strong> the downloadable XLSX matches the all-transactions export this importer reads for buys, sells, cash dividends, and DRIP reinvestments. CSV files with the same headers are also supported.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadEtradeTransactionsTemplate}>
                  Download E*TRADE Transactions Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'fidelity' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Fidelity positions template available:</strong> the downloadable XLSX contains the exact positions columns this importer reads. CSV exports with the same fields are also supported.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadFidelityTemplate}>
                  Download Fidelity Positions Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'fidelity_transactions' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Fidelity transactions template available:</strong> the downloadable XLSX keeps the transaction header row where this parser expects it and only includes the fields this importer reads. CSV exports with the same fields are also supported.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadFidelityTransactionsTemplate}>
                  Download Fidelity Transactions Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'robinhood' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Robinhood holdings reference available:</strong> the downloadable CSV shows the fields read from the Robinhood Holdings PDF. The actual import still expects the PDF export.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadRobinhoodHoldingsTemplate}>
                  Download Robinhood Holdings Reference
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'robinhood_transactions' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Robinhood transactions template available:</strong> the downloadable CSV contains the exact activity columns this importer reads for buys, sells, dividends, capital gains, and ACAT share transfers. XLSX files with those fields are also supported.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadRobinhoodTransactionsTemplate}>
                  Download Robinhood Transactions Template
                </button>
              </div>
            </div>
          )}

          {txnFormat !== 'generic_transactions' && workflowStep !== 'refresh' && !isSnowballFormat(txnFormat) && (
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label>Format</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <select
                  value={txnFormat}
                  onChange={(e) => applyTxnFormat(e.target.value)}
                  style={{ width: '250px' }}
                  disabled={isRollupTarget}
                >
                  <option value={NO_FORMAT} disabled>Select a format...</option>
                  {TXN_FORMATS.filter(f => (
                    (!isRollupTarget || f.value === 'schwab_all_accounts')
                    && (workflowStep === 'migration' || !isSnowballFormat(f.value))
                  )).map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                {!isPinnableFormat(txnFormat) ? (
                  <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
                    {defaultTxnFormat
                      ? `Default: ${formatLabel(defaultTxnFormat)}`
                      : 'Pick a broker above to continue'}
                  </span>
                ) : txnFormat === defaultTxnFormat ? (
                  <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
                    This tab opens here by default
                  </span>
                ) : (
                  <button className="btn btn-secondary" onClick={pinDefaultTxnFormat}>
                    Set as default
                  </button>
                )}
              </div>
            </div>
          )}

          {txnFormat === 'schwab_all_accounts' && (
            <SchwabDestinationPicker
              destinations={schwabDestinations}
              destSelected={txnDestSelected}
              onToggle={handleToggleSchwabDest}
              onSelectAll={handleSelectAllSchwabDest}
              onSelectNone={handleSelectNoneSchwabDest}
              accounts={txnIsMultiAccount ? txnPreview.accounts : []}
              accountMap={txnAccountMap}
              onAssignAccount={handleAssignSchwabAccount}
              previewed={txnIsMultiAccount}
              savedDestIds={savedDestIds}
              onSaveDefaults={saveDestDefaults}
              onClearDefaults={clearDestDefaults}
              savingDefaults={savingDestDefaults}
            />
          )}

          <FileUpload
            onFileSelect={(f) => {
              setTxnFile(f)
              setTxnPreview(null)
              setTxnAccountMap({})
              setTxnNavOnly(false)
              setResult(null)
              setError(null)
              maybeAutodetectSchwabAllAccounts(f)
            }}
            accept={txnFormat === 'robinhood' ? '.pdf' : txnFormat === 'portfolio_export' ? '.xlsx' : '.xlsx,.xls,.csv'}
            file={txnFile}
          />
          {snapshotDateControl}

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
            <button
              className="btn btn-secondary"
              disabled={!txnFile || txnPreviewLoading || !txnFormat}
              onClick={async () => {
                setTxnPreviewLoading(true)
                setError(null)
                setResult(null)
                setTxnPreview(null)
                const formData = new FormData()
                formData.append('file', txnFile)
                formData.append('format', txnFormat)
                try {
                  const res = await pf(`/api/import/transactions/preview`, { method: 'POST', body: formData })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data.error || 'Preview failed')
                  setTxnPreview(data)
                  if (data.as_of) setNavSnapshotDate(data.as_of)
                  if (data.format_type === 'positions_multi') {
                    const destSelected = mergeSchwabDestSelection(
                      txnDestSelected,
                      data.profile_choices || [],
                    )
                    setTxnDestSelected(destSelected)
                    setTxnAccountMap(applySchwabDestSelection(
                      destSelected,
                      data.accounts || [],
                      {},
                    ))
                  }
                } catch (e) {
                  setError(e.message)
                } finally {
                  setTxnPreviewLoading(false)
                }
              }}
            >
              {txnPreviewLoading ? <><span className="spinner" /> Parsing...</> : 'Preview'}
            </button>

            {txnPreview && (
              <button
                className="btn btn-primary"
                disabled={txnImporting || marketRefreshing || waitingForRefresh || !txnHasRows || txnAccountMismatch || txnImportBlocked}
                onClick={async () => {
                  setTxnImporting(true)
                  setError(null)
                  setResult(null)
                  const formData = new FormData()
                  formData.append('file', txnFile)
                  formData.append('format', txnFormat)
                  formData.append('nav_date', navSnapshotDate)
                  if (txnNavOnly && (txnPreview?.format_type === 'positions' || txnIsMultiAccount)) formData.append('nav_only', 'true')
                  if (txnIsMultiAccount) formData.append('account_map', JSON.stringify(txnAccountMap))
                  try {
                    await waitForRefreshBeforeImport()
                    const res = await pf(`/api/import/transactions`, { method: 'POST', body: formData })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Import failed')
                    const completedKinds = completedWorkflowSteps(txnFormat, { navOnly: txnNavOnly })
                    const nextKind = completedKinds.includes('transactions')
                      ? 'transactions'
                      : completedKinds[0] || ''
                    setLastImportKind(nextKind)
                    setCompletedSteps((prev) => ({
                      ...prev,
                      ...Object.fromEntries(completedKinds.map((kind) => [kind, true])),
                    }))
                    setResult([
                      data.message,
                      ...(data.details || []).map(formatImportDetail),
                    ])
                    setTxnPreview(null)
                    setTxnAccountMap({})
                    setTxnFile(null)
                    setTxnNavOnly(false)
                    if (data.created_profiles?.length) refreshProfiles()
                    clearAllDashboardCache()
                    await loadDataStats()
                    loadBackups()
                  } catch (e) {
                    setError(e.message)
                  } finally {
                    setTxnImporting(false)
                  }
                }}
              >
                {marketRefreshing || waitingForRefresh
                  ? <><span className="spinner" /> Waiting...</>
                  : txnImporting
                    ? <><span className="spinner" /> Importing...</>
                    : txnIsMultiAccount
                      ? `Import ${txnMappedAccounts.length} account${txnMappedAccounts.length === 1 ? '' : 's'}`
                      : `Import into ${currentProfileName}`}
              </button>
            )}
          </div>

          {/* ── Positions preview (Schwab) ── */}
          {txnPreview && txnPreview.format_type === 'combined_export' && (
            <div style={{ marginTop: '1rem' }}>
              {txnPreview.preserve_positions_message && (
                <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
                  {txnPreview.preserve_positions_message}
                </div>
              )}
              <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
                <strong>{txnPreview.summary?.portfolios || 0}</strong> portfolio sheet{(txnPreview.summary?.portfolios || 0) === 1 ? '' : 's'},{' '}
                <strong>{txnPreview.summary?.holdings || 0}</strong> holdings,{' '}
                <strong>{txnPreview.summary?.transactions || 0}</strong> transactions found.{' '}
                <strong>{txnPreview.summary?.buys || 0}</strong> buys and <strong>{txnPreview.summary?.sells || 0}</strong> sells.
              </div>

              <div style={{ maxHeight: '260px', overflow: 'auto', border: '1px solid var(--p-333)', borderRadius: '6px', marginBottom: '1rem' }}>
                <table className="data-table" style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th>Portfolio Sheet</th>
                      <th style={{ textAlign: 'right' }}>Holdings</th>
                      <th style={{ textAlign: 'right' }}>Current Value</th>
                      <th>Sample Tickers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(txnPreview.portfolios || []).map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{p.sheet_name}</td>
                        <td style={{ textAlign: 'right' }}>{p.rows}</td>
                        <td style={{ textAlign: 'right' }}>
                          {formatMoney(p.total_value || 0)}
                        </td>
                        <td style={{ maxWidth: '420px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(p.tickers || []).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(txnPreview.transactions || []).length > 0 && (
                <div style={{ maxHeight: '360px', overflow: 'auto', border: '1px solid var(--p-333)', borderRadius: '6px' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Profile</th>
                        <th>Type</th>
                        <th>Date</th>
                        <th>Ticker</th>
                        <th style={{ textAlign: 'right' }}>Shares</th>
                        <th style={{ textAlign: 'right' }}>Price</th>
                        <th style={{ textAlign: 'right' }}>Fees</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txnPreview.transactions.slice(0, 100).map((t, i) => (
                        <tr key={i}>
                          <td>{t.profile || txnPreview.target_profile_name || currentProfileName}</td>
                          <td>
                            <span style={{ color: t.type === 'BUY' ? 'var(--p-4caf50)' : 'var(--p-f44336)', fontWeight: 600 }}>
                              {t.type}
                            </span>
                          </td>
                          <td>{t.date}</td>
                          <td style={{ fontWeight: 600 }}>{t.ticker}</td>
                          <td style={{ textAlign: 'right' }}>{formatShares(t.shares)}</td>
                          <td style={{ textAlign: 'right' }}>{formatMoney(t.price_per_share)}</td>
                          <td style={{ textAlign: 'right' }}>{formatMoney(t.fees || 0)}</td>
                          <td style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {(t.notes || '').substring(0, 70)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(txnPreview.transactions || []).length > 100 && (
                <p style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  Showing first 100 of {txnPreview.transactions.length} transactions.
                </p>
              )}
            </div>
          )}

          {txnPreview && txnPreview.format_type === 'categories' && (
            <div style={{ marginTop: '1rem' }}>
              <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
                <strong>{txnPreview.summary.categories}</strong> categor{txnPreview.summary.categories === 1 ? 'y' : 'ies'} found.{' '}
                {txnPreview.summary.filtered > 0 && (
                  <>{txnPreview.summary.filtered} rows filtered out. </>
                )}
                {txnPreview.summary.duplicates_skipped > 0 && (
                  <>{txnPreview.summary.duplicates_skipped} duplicate categor{txnPreview.summary.duplicates_skipped === 1 ? 'y' : 'ies'} in the file skipped. </>
                )}
                Existing categories will be skipped. No holdings or ticker assignments will be changed.
              </div>
              <div style={{ maxHeight: '400px', overflow: 'auto', border: '1px solid var(--p-333)', borderRadius: '6px' }}>
                <table className="data-table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(txnPreview.categories || []).map((category, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{category.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* -- Multi-account positions preview (Schwab All Accounts) -- */}
          {txnIsMultiAccount && (
            <div style={{ marginTop: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={txnNavOnly}
                  onChange={(e) => setTxnNavOnly(e.target.checked)}
                />
                <strong>Record NAV only</strong>
                <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                  (adds a chart snapshot to every mapped portfolio without changing holdings)
                </span>
              </label>

              <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
                <strong>{txnPreview.summary.accounts}</strong> account{txnPreview.summary.accounts === 1 ? '' : 's'} found
                {txnPreview.as_of && <> as of <strong>{txnPreview.as_of}</strong></>}:{' '}
                <strong>{txnPreview.summary.holdings}</strong> holdings,{' '}
                total <strong>{formatMoney(txnPreview.summary.account_value)}</strong>
                {txnPreview.summary.cash > 0 && (
                  <> including <strong>{formatMoney(txnPreview.summary.cash)}</strong> cash</>
                )}.
                {txnPreview.summary.options > 0 && (
                  <> {txnPreview.summary.options} option position{txnPreview.summary.options === 1 ? '' : 's'}{' '}
                    ({formatMoney(txnPreview.summary.options_value)}) are not imported as holdings.</>
                )}
              </div>

              {txnMappedAccounts.length < (txnPreview.accounts || []).length && (
                <div className="alert alert-warning" style={{ marginBottom: '0.75rem' }}>
                  {(txnPreview.accounts || []).length - txnMappedAccounts.length} account
                  {(txnPreview.accounts || []).length - txnMappedAccounts.length === 1 ? ' is' : 's are'}{' '}
                  set to skip and will not be imported.
                </div>
              )}
              {schwabDestinations.some(profile => (
                txnDestSelected[String(profile.id)]
                && !fileAccountForProfile(txnPreview.accounts, txnAccountMap, profile.id)
              )) && (
                <div className="alert alert-warning" style={{ marginBottom: '0.75rem' }}>
                  Some selected Schwab portfolios have no matching account in this file.
                  Pick an account from the list above, or uncheck those portfolios.
                </div>
              )}

              {txnLeftoverAccounts.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Other accounts in this file</h3>
                  <p style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                    These Schwab accounts were not mapped to a selected portfolio. Skip them, create a new
                    portfolio, or point them at one of your accounts above.
                  </p>
                  {txnLeftoverAccounts.map((account) => {
                    const selected = txnAccountMap[account.account_key] ?? ''
                    const summary = account.summary || {}
                    return (
                      <div
                        key={account.account_key}
                        className="card"
                        style={{ marginBottom: '0.75rem', opacity: selected === 'new' ? 1 : 0.75 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>{account.account_label}</div>
                            <div style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
                              {summary.holdings} holdings, {formatMoney(summary.account_value)}
                              {summary.cash > 0 && <> including {formatMoney(summary.cash)} cash</>}
                            </div>
                          </div>
                          <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>Import into</span>
                            <select
                              value={selected}
                              onChange={(e) => handleLeftoverAccountChange(account.account_key, e.target.value)}
                              style={{ width: '230px' }}
                            >
                              <option value="">Skip this account</option>
                              {(txnPreview.profile_choices || schwabDestinations).map(choice => (
                                <option key={choice.id} value={String(choice.id)}>{choice.name}</option>
                              ))}
                              <option value="new">New portfolio: {account.new_profile_name}</option>
                            </select>
                          </div>
                        </div>
                        {account.match_reason === 'unmatched' && (
                          <div style={{ color: 'var(--p-ffb74d)', fontSize: '0.8rem', marginTop: '0.4rem' }}>
                            No portfolio matched this account by name - choose one above, or create a new portfolio for it.
                          </div>
                        )}
                        {account.match_reason === 'no_holdings' && (
                          <div style={{ color: 'var(--p-ffb74d)', fontSize: '0.8rem', marginTop: '0.4rem' }}>
                            This account has no holdings, so it was not mapped automatically.
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {txnPreview && txnPreview.format_type === 'positions' && (
            <div style={{ marginTop: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={txnNavOnly}
                  onChange={(e) => setTxnNavOnly(e.target.checked)}
                />
                <strong>Record NAV only</strong>
                <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                  (adds a chart snapshot for the selected NAV date without changing current holdings)
                </span>
              </label>
              {txnPreview.account_name && (
                <div className={txnAccountMismatch ? 'alert alert-error' : 'alert alert-info'} style={{ marginBottom: '0.75rem' }}>
                  File account: <strong>{txnPreview.account_name}</strong> → importing into <strong>{currentProfileName}</strong>.
                  {txnAccountMismatch && txnPreview.account_match?.message && (
                    <> {txnPreview.account_match.message}</>
                  )}
                </div>
              )}
              <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
                <strong>{txnPreview.summary.holdings}</strong> holdings found.{' '}
                {txnPreview.summary.options > 0 && (
                  <>{txnPreview.summary.options} options skipped. </>
                )}
                {txnPreview.summary.filtered > 0 && (
                  <>{txnPreview.summary.filtered} rows filtered. </>
                )}
                Total value: <strong>{formatMoney(txnPreview.positions.reduce((s, p) => s + (p.current_value || 0), 0))}</strong>
                {txnPreview.summary.cash > 0 && (
                  <> Cash: <strong>{formatMoney(txnPreview.summary.cash)}</strong></>
                )}
                {txnPreview.summary.account_value > 0 && (
                  <> Account value: <strong>{formatMoney(txnPreview.summary.account_value)}</strong></>
                )}
                {txnPreview.summary.cost_basis_missing && (
                  <> Cost basis not provided by file; current value will be used.</>
                )}
              </div>

              <div style={{ maxHeight: '400px', overflow: 'auto', border: '1px solid var(--p-333)', borderRadius: '6px' }}>
                <table className="data-table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'right' }}>Shares</th>
                      <th style={{ textAlign: 'right' }}>Cost/Share</th>
                      <th style={{ textAlign: 'right' }}>Price</th>
                      <th style={{ textAlign: 'right' }}>Mkt Value</th>
                      <th style={{ textAlign: 'right' }}>G/L</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txnPreview.positions.map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{p.ticker}</td>
                        <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</td>
                        <td style={{ textAlign: 'right' }}>{p.quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                        <td style={{ textAlign: 'right' }}>{formatMoney(p.cost_per_share)}</td>
                        <td style={{ textAlign: 'right' }}>{formatMoney(p.current_price, 4)}</td>
                        <td style={{ textAlign: 'right' }}>{formatMoney(p.current_value)}</td>
                        <td style={{ textAlign: 'right', color: (p.gain_or_loss || 0) >= 0 ? 'var(--p-4caf50)' : 'var(--p-f44336)' }}>
                          {formatMoney(p.gain_or_loss || 0)}
                        </td>
                        <td>{p.asset_type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Transactions preview (Snowball) ── */}
          {txnPreview && txnPreview.transactions && txnPreview.format_type !== 'positions' && txnPreview.format_type !== 'positions_multi' && txnPreview.format_type !== 'combined_export' && txnPreview.format_type !== 'categories' && (
            <div style={{ marginTop: '1rem' }}>
              {txnPreview.preserve_positions && txnPreview.preserve_positions_message && (
                <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
                  {txnPreview.preserve_positions_message}
                </div>
              )}
              <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
                <strong>{txnPreview.summary.buys}</strong> buys,{' '}
                <strong>{txnPreview.summary.sells}</strong> sells,{' '}
                <strong>{txnPreview.summary.dividends}</strong> dividends found.{' '}
                {txnPreview.summary.filtered > 0 && (
                  <>{txnPreview.summary.filtered} rows filtered out. </>
                )}
                {txnPreview.summary.drip_detected > 0 && (
                  <>{txnPreview.summary.drip_detected} DRIP reinvestments detected.</>
                )}
              </div>

              <div style={{ maxHeight: '400px', overflow: 'auto', border: '1px solid var(--p-333)', borderRadius: '6px' }}>
                <table className="data-table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Date</th>
                      <th>Ticker</th>
                      <th style={{ textAlign: 'right' }}>Shares</th>
                      <th style={{ textAlign: 'right' }}>Price</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'right' }}>Fees</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txnPreview.transactions.slice(0, 100).map((t, i) => (
                      <tr key={i}>
                        <td>
                          <span style={{
                            color: t.type === 'BUY' ? 'var(--p-4caf50)' : t.type === 'SELL' ? 'var(--p-f44336)' : 'var(--p-ffb74d)',
                            fontWeight: 600,
                          }}>
                            {t.type}
                          </span>
                        </td>
                        <td>{t.date}</td>
                        <td style={{ fontWeight: 600 }}>{t.ticker}</td>
                        <td style={{ textAlign: 'right' }}>{formatShares(t.shares)}</td>
                        <td style={{ textAlign: 'right' }}>{formatMoney(t.price_per_share)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {t.dividend_amount != null
                            ? formatMoney(t.dividend_amount)
                            : t.shares != null && t.price_per_share != null
                              ? formatMoney(t.shares * t.price_per_share)
                              : blankValue}
                        </td>
                        <td style={{ textAlign: 'right' }}>{formatMoney(t.fees || 0)}</td>
                        <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(t.notes || '').substring(0, 60)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {txnPreview.transactions.length > 100 && (
                <p style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  Showing first 100 of {txnPreview.transactions.length} transactions.
                </p>
              )}
            </div>
          )}
          </>
          )}
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────── */}
      {error && (
        <div className="alert alert-error">{error}</div>
      )}
      {result && (
        <div className="alert alert-success">
          {result.map((msg, i) => (
            <div key={i}>{msg}</div>
          ))}
          {activeTab === 'txnHistory' && lastImportKind === 'positions' && (
            <div style={{ marginTop: '0.75rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => selectWorkflowStep('transactions')}>
                Next: import transactions
              </button>
            </div>
          )}
          {activeTab === 'txnHistory' && lastImportKind === 'transactions' && (
            <div style={{ marginTop: '0.75rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => selectWorkflowStep('refresh')}>
                Next: refresh prices
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Cost Basis Repair ─────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3>Realized Gain Repair</h3>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
          A sale whose cost basis could not be established used to be priced at zero, so its
          entire proceeds were booked as capital gain. That happened to shares transferred in
          from another broker, to sales that followed a transfer out, and to cash sweep funds.
          This rebuilds the gain or loss on every past sale from your transaction history.
        </p>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          <strong style={{ color: 'var(--p-ffb86c)' }}>Expect your realized gains to go down.</strong>{' '}
          The inflated gains were wrong. Most sales get a correct basis, but where none can be
          recovered — usually because more shares were sold than the imported purchase history
          covers — the gain is left blank rather than invented, and the Annual Tax Report leaves
          those out of its totals. Only the recorded gain is rewritten: shares, prices, and
          holdings are untouched, and a database backup is taken first.
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            disabled={basisChecking || basisRepairing}
            onClick={checkCostBasis}
          >
            {basisChecking ? 'Checking...' : 'Check for Problems'}
          </button>
          <button
            className="btn btn-primary"
            disabled={basisChecking || basisRepairing}
            onClick={repairCostBasis}
          >
            {basisRepairing ? 'Recalculating...' : 'Recalculate Realized Gains'}
          </button>
        </div>

        {basisError && (
          <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{basisError}</div>
        )}

        {basisReport && (
          <div style={{
            marginTop: '0.75rem', padding: '0.75rem 1rem', borderRadius: 4,
            background: 'var(--surface-2, rgba(255,255,255,0.04))',
            border: '1px solid var(--border)', fontSize: '0.88rem',
          }}>
            {basisReport.counts?.full_proceeds_sells > 0 ? (
              <div style={{ marginBottom: '0.4rem' }}>
                <strong style={{ color: 'var(--p-ffb86c)' }}>
                  {basisReport.counts.full_proceeds_sells} sale
                  {basisReport.counts.full_proceeds_sells === 1 ? '' : 's'} report their entire
                  proceeds as profit
                </strong>{' '}
                ({formatMoney(basisReport.full_proceeds_sells?.proceeds)} across{' '}
                {(basisReport.full_proceeds_sells?.tickers || []).join(', ') || 'no tickers'}).
                That is what a sale costed against a missing basis looks like. If the basis
                really was zero, no repair is needed.
              </div>
            ) : (
              <div style={{ marginBottom: '0.4rem', color: 'var(--p-81c784)' }}>
                No sale is reporting its entire proceeds as profit. Nothing looks outstanding.
              </div>
            )}
            {basisReport.counts?.unresolved > 0 && (
              <div style={{ marginBottom: '0.4rem' }}>
                {basisReport.counts.unresolved} transferred-in lot
                {basisReport.counts.unresolved === 1 ? '' : 's'} on closed positions
                {' '}({[...new Set((basisReport.unresolved || []).map(u => u.ticker))].join(', ')})
                {' '}{basisReport.counts.unresolved === 1 ? 'has' : 'have'} no basis left to read
                and {basisReport.counts.unresolved === 1 ? 'needs' : 'need'} a cost per share
                entered by hand. Recalculating cannot price those.
              </div>
            )}
            {basisReport.counts?.resolved > 0 && (
              <div style={{ marginBottom: '0.4rem', color: 'var(--text-dim-2)' }}>
                {basisReport.counts.resolved} transferred-in lot
                {basisReport.counts.resolved === 1 ? '' : 's'} can be priced automatically from
                the position they are still held in.
              </div>
            )}
            <div style={{ color: 'var(--text-dim-2)' }}>
              Recalculating replays {basisReport.counts?.positions_to_replay || 0} position
              {basisReport.counts?.positions_to_replay === 1 ? '' : 's'} — every position with a
              sell, because only the replay reveals which ones were affected.
            </div>
          </div>
        )}

        {basisResult && (
          <div className="alert alert-success" style={{ marginTop: '0.75rem' }}>
            <div>
              Replayed {basisResult.repaired_positions} position
              {basisResult.repaired_positions === 1 ? '' : 's'}.{' '}
              {basisResult.corrected_sells > 0
                ? `Corrected ${basisResult.corrected_sells} sale${basisResult.corrected_sells === 1 ? '' : 's'} that had been reporting ${formatMoney(basisResult.corrected_proceeds)} of proceeds as profit.`
                : 'No sale needed correcting.'}
            </div>
            {basisResult.sells_still_unpriced > 0 && (
              <div style={{ marginTop: '0.4rem' }}>
                {basisResult.sells_newly_unpriced > 0 && (
                  <>{basisResult.sells_newly_unpriced} sale
                    {basisResult.sells_newly_unpriced === 1 ? '' : 's'} that previously showed a
                    gain now show none, because no cost basis for them exists to compute one
                    from. </>
                )}
                {basisResult.sells_still_unpriced} sale
                {basisResult.sells_still_unpriced === 1 ? '' : 's'} in total report no gain, and
                the Annual Tax Report excludes them from its totals.
                {basisResult.transfer_lots_needing_basis > 0 && (
                  <> {basisResult.transfer_lots_needing_basis} of these
                    {' '}{basisResult.transfer_lots_needing_basis === 1 ? 'is a' : 'are'}
                    {' '}transferred-in lot
                    {basisResult.transfer_lots_needing_basis === 1 ? '' : 's'}
                    {' '}({[...new Set((basisResult.unresolved || []).map(u => u.ticker))].join(', ')})
                    {' '}you can fix by setting the price per share on that buy in Manage
                    Holdings.</>
                )}
                {' '}The rest are positions where more shares were sold than the imported
                purchase history covers — importing the missing buys is what fixes those.
              </div>
            )}
            {basisResult.positions_needing_basis?.length > 0 && (
              <div style={{ marginTop: '0.5rem' }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-dim-2)', marginBottom: '0.3rem' }}>
                  Open a position to see what it needs — most are closed, so they are not on the
                  holdings table:
                </div>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  {basisResult.positions_needing_basis.slice(0, 24).map(p => (
                    <a
                      key={`${p.ticker}-${p.profile_id}`}
                      href={`#/holdings?txn=${encodeURIComponent(p.ticker)}`}
                      className="btn btn-secondary"
                      style={{ padding: '0.15rem 0.45rem', fontSize: '0.76rem', textDecoration: 'none' }}
                      title={`${p.unpriced_sells} sale${p.unpriced_sells === 1 ? '' : 's'} · ${p.profile_name || 'account ' + p.profile_id}`}
                    >
                      {p.ticker}
                    </a>
                  ))}
                  {basisResult.positions_needing_basis.length > 24 && (
                    <span style={{ fontSize: '0.76rem', color: 'var(--text-dim-2)', alignSelf: 'center' }}>
                      +{basisResult.positions_needing_basis.length - 24} more
                    </span>
                  )}
                </div>
              </div>
            )}
            <div style={{ marginTop: '0.4rem' }}>
              {basisResult.backup_failed
                ? <span style={{ color: 'var(--p-ffb86c)' }}>
                    Warning: the database backup could not be written, so this ran without one.
                    The recalculation is rebuilt from your transactions and can be run again,
                    but check your disk space before the next import.
                  </span>
                : <span style={{ color: 'var(--text-dim-2)' }}>
                    Backup saved as {basisResult.backup}.
                  </span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Backup / Restore ──────────────────────────────────────────── */}
      {backups.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3>Database Backups</h3>
          <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            A backup is created automatically before every import and dividend repair, and is kept separately per profile so imports for one account don't evict another account's history. If a change caused problems, restore to a previous state.
          </p>
          <table className="data-table" style={{ fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Profile</th>
                <th>Size</th>
                <th style={{ width: '100px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {backups.map(b => (
                <tr key={b.filename}>
                  <td>{b.label}</td>
                  <td>{b.profile_label || '—'}</td>
                  <td>{b.size_mb} MB</td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
                      disabled={restoring}
                      onClick={async () => {
                        if (!window.confirm(`Restore database from ${b.label}? This will overwrite all current data.`)) return
                        setRestoring(true)
                        setError(null)
                        setResult(null)
                        try {
                          const res = await pf('/api/import/restore', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename: b.filename }),
                          })
                          const data = await res.json()
                          if (!res.ok) throw new Error(data.error || 'Restore failed')
                          setResult([data.message])
                          await loadDataStats()
                        } catch (e) {
                          setError(e.message)
                        } finally {
                          setRestoring(false)
                        }
                      }}
                    >
                      {restoring ? 'Restoring...' : 'Restore'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
