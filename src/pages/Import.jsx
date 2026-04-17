import React, { useState, useRef, useEffect } from 'react'
import { API_BASE } from '../config'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

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

export default function Import() {
  const pf = useProfileFetch()
  const { selection, profiles, isAggregate, refreshProfiles, currentProfileName } = useProfile()
  const [activeTab, setActiveTab] = useState('owner')
  const [file, setFile] = useState(null)
  const [sheetName, setSheetName] = useState('All Accounts')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [multiSheet, setMultiSheet] = useState(false)

  const [hasData, setHasData] = useState(false)

  // Owner-format additional imports
  const [importWeekly, setImportWeekly] = useState(true)
  const [importMonthly, setImportMonthly] = useState(true)
  const [importMonthlyTickers, setImportMonthlyTickers] = useState(true)
  const [asTransactions, setAsTransactions] = useState(false)

  // Transaction History tab state
  const [txnFormat, setTxnFormat] = useState('snowball')
  const [txnFile, setTxnFile] = useState(null)
  const [txnPreview, setTxnPreview] = useState(null)
  const [txnPreviewLoading, setTxnPreviewLoading] = useState(false)
  const [txnImporting, setTxnImporting] = useState(false)

  // Backup / restore state
  const [backups, setBackups] = useState([])
  const [restoring, setRestoring] = useState(false)

  const loadBackups = () => {
    pf('/api/import/backups').then(r => r.json()).then(d => setBackups(d.backups || [])).catch(() => {})
  }

  useEffect(() => {
    pf('/api/data/stats')
      .then(r => r.json())
      .then(d => setHasData(d.holdings > 0))
      .catch(() => {})
    loadBackups()
  }, [pf, selection])

  const txnHasRows = txnPreview
    ? (txnPreview.format_type === 'positions'
        ? txnPreview.positions.length > 0
        : txnPreview.transactions.length > 0)
    : false
  const txnAccountMismatch = Boolean(txnPreview?.account_match && txnPreview.account_match.matched === false)

  const resetState = () => {
    setFile(null)
    setResult(null)
    setError(null)
  }

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    resetState()
    setTxnFile(null)
    setTxnPreview(null)
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

    try {
      const res = await pf(endpoint, { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      return data
    } catch (e) {
      throw e
    }
  }

  const handleOwnerImport = async () => {
    setLoading(true)
    setResult(null)
    setError(null)

    const results = []

    try {
      // Main import
      const extraFields = multiSheet ? { multi_sheet: 'true' } : { sheet_name: sheetName }
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
      const extraFields = multiSheet ? { multi_sheet: 'true' } : {}
      if (asTransactions) extraFields.as_transactions = 'true'
      const data = await uploadFile(`/api/import/generic`, extraFields)
      setResult([data.message])
      if (data.details) {
        setResult([data.message, ...data.details.map(d => `  ${d.profile_name}: ${d.message}`)])
        refreshProfiles()
      }
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

  const handleDownloadEtradeBuysSellsTemplate = () => {
    window.open(`${API_BASE}/api/template/etrade-buys-sells-download`, '_blank')
  }

  const handleDownloadEtradeDividendsTemplate = () => {
    window.open(`${API_BASE}/api/template/etrade-dividends-download`, '_blank')
  }

  const handleDownloadFidelityTemplate = () => {
    window.open(`${API_BASE}/api/template/fidelity-download`, '_blank')
  }

  const handleDownloadFidelityTransactionsTemplate = () => {
    window.open(`${API_BASE}/api/template/fidelity-transactions-download`, '_blank')
  }

  if (isAggregate) {
    return (
      <div className="page">
        <h1>Import Portfolio Data</h1>
        <div className="alert alert-info">
          Cannot import while viewing the Aggregate portfolio. Please select a specific portfolio from the navbar dropdown.
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>Import Portfolio Data</h1>
      <p style={{ color: '#7ecfff', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Importing into: <strong>{currentProfileName}</strong>
      </p>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'owner' ? 'active' : ''}`}
          onClick={() => handleTabChange('owner')}
        >
          My Spreadsheet
        </button>
        <button
          className={`tab ${activeTab === 'generic' ? 'active' : ''}`}
          onClick={() => handleTabChange('generic')}
        >
          Generic Upload
        </button>
        <button
          className={`tab ${activeTab === 'txnHistory' ? 'active' : ''}`}
          onClick={() => handleTabChange('txnHistory')}
        >
          Import Brokerage Positions and Snowball Data
        </button>
      </div>

      {/* ── Owner Excel Import ─────────────────────────────────────────── */}
      {activeTab === 'owner' && (
        <div className="card">
          <h2>Import Your Dividend Tracking Spreadsheet</h2>
          <p style={{ color: '#90a4ae', marginBottom: '1rem' }}>
            Upload your Excel file (.xlsm or .xlsx) with the "All Accounts" sheet format.
            This will import your holdings, dividend data, and payout history.
          </p>

          <FileUpload
            onFileSelect={setFile}
            accept=".xlsx,.xlsm,.xls"
            file={file}
          />

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '1rem' }}>
              <input
                type="checkbox"
                checked={multiSheet}
                onChange={(e) => setMultiSheet(e.target.checked)}
              />
              <strong>Import all sheets as separate portfolios</strong>
              <span style={{ color: '#90a4ae', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
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
            <span style={{ color: '#90a4ae', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
              (compares imported shares to current position — creates a BUY or SELL transaction for the difference)
            </span>
          </label>

          <button
            className="btn btn-primary"
            onClick={handleOwnerImport}
            disabled={!file || loading}
          >
            {loading ? <><span className="spinner" /> Importing...</> : hasData ? 'Merge Spreadsheet' : 'Import Spreadsheet'}
          </button>
        </div>
      )}

      {/* ── Generic Upload ─────────────────────────────────────────────── */}
      {activeTab === 'generic' && (
        <div className="card">
          <h2>Upload Your Portfolio</h2>
          <p style={{ color: '#90a4ae', marginBottom: '1rem' }}>
            Upload an Excel file with at minimum <strong>Ticker</strong> and <strong>Shares</strong> columns.
            Optional columns: Price Paid, Dividend, Frequency, Ex-Div Date, DRIP.
            Market data will be enriched automatically via Yahoo Finance.
            The template includes up to 12 portfolio tabs.
          </p>

          <div style={{ marginBottom: '1rem' }}>
            <button className="btn btn-secondary" onClick={handleDownloadTemplate}>
              Download Template
            </button>
          </div>

          <FileUpload
            onFileSelect={setFile}
            accept=".xlsx,.xlsm,.xls,.csv"
            file={file}
          />

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '1rem' }}>
              <input
                type="checkbox"
                checked={multiSheet}
                onChange={(e) => setMultiSheet(e.target.checked)}
              />
              <strong>Import all tabs as separate portfolios</strong>
              <span style={{ color: '#90a4ae', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
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
              <span style={{ color: '#90a4ae', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                (compares imported shares to current position — creates a BUY or SELL transaction for the difference)
              </span>
            </label>

            <button
              className="btn btn-primary"
              onClick={handleGenericImport}
              disabled={!file || loading}
            >
              {loading ? <><span className="spinner" /> Importing...</> : hasData ? 'Merge Portfolio' : 'Import Portfolio'}
            </button>
          </div>
        </div>
      )}

      {/* ── Transaction History Import ─────────────────────────────────── */}
      {activeTab === 'txnHistory' && (
        <div className="card">
          <h2>Import Brokerage Positions and Snowball Data</h2>
          <p style={{ color: '#90a4ae', marginBottom: '1rem' }}>
            {txnFormat === 'schwab'
              ? <>Import current positions from a Schwab <strong>Positions CSV</strong> export. In Schwab, go to Accounts {'>'} Positions, then export to CSV. This sets holdings, cost basis, and current prices directly.</>
              : txnFormat === 'snowball_holdings'
                ? <>Import a Snowball <strong>Holdings CSV</strong> as a migration snapshot. This keeps only the holdings, dividend, and category fields the app can actually use, and ignores Snowball-only analytics columns.</>
              : txnFormat === 'schwab_transactions'
                ? <>Import transaction history from a Schwab <strong>Transactions CSV</strong> export. In Schwab, go to Accounts {'>'} History, set the date range, then export to CSV. Imports buys, sells, DRIP reinvestments, and dividend payments.</>
              : txnFormat === 'etrade'
                ? <>Import current positions from an E*TRADE <strong>portfolio download CSV</strong>. The file account must match the portfolio you currently have selected before import is allowed.</>
              : txnFormat === 'etrade_buys_sells'
                ? <>Import buy and sell transactions from an E*TRADE <strong>Transaction History XLSX</strong> export. In E*TRADE, go to Accounts {'>'} Transaction History, filter to "Buys &amp; Sells", then download.</>
              : txnFormat === 'etrade_dividends'
                ? <>Import dividend payments and DRIP reinvestments from an E*TRADE <strong>Transaction History XLSX</strong> export. In E*TRADE, go to Accounts {'>'} Transaction History, filter to "Dividends", then download.</>
                : txnFormat === 'fidelity'
                  ? <>Import current positions from a Fidelity <strong>Positions XLSX</strong> export. This uses only the holdings and dividend fields the app already supports, and treats money market rows as cash.</>
                  : txnFormat === 'fidelity_transactions'
                    ? <>Import transaction history from a Fidelity <strong>Transactions XLSX</strong> export. This imports buys, sells, dividend cash receipts, and DRIP reinvestments for recordkeeping.</>
                 : <>Import BUY/SELL transactions and dividend payments from your broker or tracking app.
                 Each file should be a <strong>single account</strong> export — combined/merged exports will be rejected.</>
            }
          </p>

          {['snowball', 'schwab_transactions', 'etrade_buys_sells', 'etrade_dividends', 'fidelity_transactions'].includes(txnFormat) && (
            <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
              <strong>Partial history warning:</strong> If this file does not cover the full account history
              (e.g. only the last 1–2 years), imported buy/sell transactions will recalculate your share
              counts and cost basis from the transactions alone — which may not match your actual holdings.
              {txnFormat === 'snowball' && (<>
                {' '}Snowball Analytics exports may also not exactly match the broker's live positions or account value.
              </>)}
              <br /><br />
              <strong>Recommended approach:</strong> Import a <em>Positions</em> file first (Schwab, E*TRADE, or Fidelity)
              to set accurate current holdings, then import transaction history for dividend tracking and
              realized gain records. When a Positions import has been done first, transaction imports store
              history without overwriting your holdings data.
              <br /><br />
              A database backup is created automatically before every import — you can restore from the
              bottom of this page if needed.
            </div>
          )}

          {txnFormat === 'etrade' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>E*TRADE template available:</strong> the downloadable template contains the exact account summary and holdings field names this importer reads.
              If you build or edit an E*TRADE CSV manually, keep those headers unchanged.
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
              If you build or edit a Schwab CSV manually, keep those headers unchanged and leave the first "Positions for account ..." line in place.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadSchwabTemplate}>
                  Download Schwab Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'snowball_holdings' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Snowball holdings template available:</strong> the downloadable CSV contains the exact migration fields this importer reads. It is meant for moving holdings, dividend metadata, and categories from Snowball into the app.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadSnowballHoldingsTemplate}>
                  Download Snowball Holdings Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'schwab_transactions' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Schwab transactions template available:</strong> the downloadable template contains the exact transaction columns this importer reads for buys, sells, cash dividends, DRIP share purchases, and reinvestment adjustments.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadSchwabTransactionsTemplate}>
                  Download Schwab Transactions Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'etrade_buys_sells' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>E*TRADE buys/sells template available:</strong> the downloadable XLSX keeps the account row, total row, and row-7 headers exactly where this parser expects them.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadEtradeBuysSellsTemplate}>
                  Download E*TRADE Buys &amp; Sells Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'etrade_dividends' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>E*TRADE dividends template available:</strong> the downloadable XLSX matches the dividend-history import, including cash dividend rows and DRIP reinvestment rows.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadEtradeDividendsTemplate}>
                  Download E*TRADE Dividends Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'fidelity' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Fidelity positions template available:</strong> the downloadable XLSX contains the exact positions columns this importer reads. It only includes the fields the app already stores.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadFidelityTemplate}>
                  Download Fidelity Positions Template
                </button>
              </div>
            </div>
          )}

          {txnFormat === 'fidelity_transactions' && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              <strong>Fidelity transactions template available:</strong> the downloadable XLSX keeps the transaction header row where this parser expects it and only includes the fields this importer reads.
              <div style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={handleDownloadFidelityTransactionsTemplate}>
                  Download Fidelity Transactions Template
                </button>
              </div>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label>Format</label>
            <select
              value={txnFormat}
              onChange={(e) => { setTxnFormat(e.target.value); setTxnPreview(null); setTxnFile(null); setResult(null); setError(null) }}
              style={{ width: '250px' }}
            >
              <option value="snowball_holdings">Snowball Holdings (Migration)</option>
              <option value="snowball">Snowball Transactions</option>
              <option value="schwab">Charles Schwab (Positions)</option>
              <option value="schwab_transactions">Charles Schwab (Transactions)</option>
              <option value="etrade">E*Trade (Positions)</option>
              <option value="etrade_buys_sells">E*Trade (Buys &amp; Sells)</option>
              <option value="etrade_dividends">E*Trade (Dividends)</option>
              <option value="fidelity">Fidelity (Positions)</option>
              <option value="fidelity_transactions">Fidelity (Transactions)</option>
            </select>
          </div>

          <FileUpload
            onFileSelect={(f) => { setTxnFile(f); setTxnPreview(null); setResult(null); setError(null) }}
            accept={txnFormat.startsWith('etrade_') || txnFormat === 'fidelity' || txnFormat === 'fidelity_transactions' ? '.xlsx,.xls' : '.csv'}
            file={txnFile}
          />

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
            <button
              className="btn btn-secondary"
              disabled={!txnFile || txnPreviewLoading}
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
                disabled={txnImporting || !txnHasRows || txnAccountMismatch}
                onClick={async () => {
                  setTxnImporting(true)
                  setError(null)
                  setResult(null)
                  const formData = new FormData()
                  formData.append('file', txnFile)
                  formData.append('format', txnFormat)
                  try {
                    const res = await pf(`/api/import/transactions`, { method: 'POST', body: formData })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Import failed')
                    setResult([data.message])
                    setTxnPreview(null)
                    setTxnFile(null)
                    loadBackups()
                  } catch (e) {
                    setError(e.message)
                  } finally {
                    setTxnImporting(false)
                  }
                }}
              >
                {txnImporting ? <><span className="spinner" /> Importing...</> : `Import into ${currentProfileName}`}
              </button>
            )}
          </div>

          {/* ── Positions preview (Schwab) ── */}
          {txnPreview && txnPreview.format_type === 'positions' && (
            <div style={{ marginTop: '1rem' }}>
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
                Total value: <strong>${txnPreview.positions.reduce((s, p) => s + (p.current_value || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                {txnPreview.summary.cash > 0 && (
                  <> Cash: <strong>${txnPreview.summary.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></>
                )}
                {txnPreview.summary.account_value > 0 && (
                  <> Account value: <strong>${txnPreview.summary.account_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></>
                )}
              </div>

              <div style={{ maxHeight: '400px', overflow: 'auto', border: '1px solid #333', borderRadius: '6px' }}>
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
                        <td style={{ textAlign: 'right' }}>${p.cost_per_share.toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }}>${p.current_price.toFixed(4)}</td>
                        <td style={{ textAlign: 'right' }}>${p.current_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td style={{ textAlign: 'right', color: (p.gain_or_loss || 0) >= 0 ? '#4caf50' : '#f44336' }}>
                          ${(p.gain_or_loss || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
          {txnPreview && txnPreview.format_type !== 'positions' && (
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

              <div style={{ maxHeight: '400px', overflow: 'auto', border: '1px solid #333', borderRadius: '6px' }}>
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
                            color: t.type === 'BUY' ? '#4caf50' : t.type === 'SELL' ? '#f44336' : '#ffb74d',
                            fontWeight: 600,
                          }}>
                            {t.type}
                          </span>
                        </td>
                        <td>{t.date}</td>
                        <td style={{ fontWeight: 600 }}>{t.ticker}</td>
                        <td style={{ textAlign: 'right' }}>{t.shares != null ? t.shares.toFixed(4) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{t.price_per_share != null ? `$${t.price_per_share.toFixed(2)}` : '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {t.dividend_amount != null
                            ? `$${t.dividend_amount.toFixed(2)}`
                            : t.shares != null && t.price_per_share != null
                              ? `$${(t.shares * t.price_per_share).toFixed(2)}`
                              : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>{t.fees > 0 ? `$${t.fees.toFixed(2)}` : '—'}</td>
                        <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(t.notes || '').substring(0, 60)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {txnPreview.transactions.length > 100 && (
                <p style={{ color: '#90a4ae', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  Showing first 100 of {txnPreview.transactions.length} transactions.
                </p>
              )}
            </div>
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
        </div>
      )}

      {/* ── Backup / Restore ──────────────────────────────────────────── */}
      {backups.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3>Import Backups</h3>
          <p style={{ color: '#90a4ae', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            A backup is created automatically before every import. If an import caused problems, restore to a previous state.
          </p>
          <table className="data-table" style={{ fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Size</th>
                <th style={{ width: '100px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {backups.map(b => (
                <tr key={b.filename}>
                  <td>{b.label}</td>
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
