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

  useEffect(() => {
    pf('/api/data/stats')
      .then(r => r.json())
      .then(d => setHasData(d.holdings > 0))
      .catch(() => {})
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
          Transaction History
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
          <h2>Import Transaction History</h2>
          <p style={{ color: '#90a4ae', marginBottom: '1rem' }}>
            {txnFormat === 'schwab'
              ? <>Import current positions from a Schwab <strong>Positions CSV</strong> export. In Schwab, go to Accounts {'>'} Positions, then export to CSV. This sets holdings, cost basis, and current prices directly.</>
              : txnFormat === 'etrade'
                ? <>Import current positions from an E*TRADE <strong>portfolio download CSV</strong>. The file account must match the portfolio you currently have selected before import is allowed.</>
                : <>Import BUY/SELL transactions and dividend payments from your broker or tracking app.
                Each file should be a <strong>single account</strong> export — combined/merged exports will be rejected.</>
            }
          </p>

          {txnFormat === 'snowball' && (
            <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
              <strong>Warning:</strong> Snowball Analytics exports may not exactly match the broker's live positions or account value.
              For accurate current holdings, balances, and share counts, use a broker Positions CSV.
              Use Snowball mainly for transaction and dividend history.
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

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label>Format</label>
            <select
              value={txnFormat}
              onChange={(e) => { setTxnFormat(e.target.value); setTxnPreview(null); setTxnFile(null); setResult(null); setError(null) }}
              style={{ width: '250px' }}
            >
              <option value="snowball">Snowball Analytics</option>
              <option value="schwab">Charles Schwab (Positions)</option>
              <option value="etrade">E*Trade (Positions)</option>
              <option value="fidelity" disabled>Fidelity (coming soon)</option>
            </select>
          </div>

          <FileUpload
            onFileSelect={(f) => { setTxnFile(f); setTxnPreview(null); setResult(null); setError(null) }}
            accept=".csv"
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
    </div>
  )
}
