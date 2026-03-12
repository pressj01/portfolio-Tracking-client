import React, { useState, useRef, useEffect } from 'react'

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
  const [activeTab, setActiveTab] = useState('owner')
  const [file, setFile] = useState(null)
  const [sheetName, setSheetName] = useState('All Accounts')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const [hasData, setHasData] = useState(false)

  // Owner-format additional imports
  const [importWeekly, setImportWeekly] = useState(true)
  const [importMonthly, setImportMonthly] = useState(true)
  const [importMonthlyTickers, setImportMonthlyTickers] = useState(true)

  useEffect(() => {
    fetch('/api/data/stats')
      .then(r => r.json())
      .then(d => setHasData(d.holdings > 0))
      .catch(() => {})
  }, [])

  const resetState = () => {
    setFile(null)
    setResult(null)
    setError(null)
  }

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    resetState()
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
      const res = await fetch(endpoint, { method: 'POST', body: formData })
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
      const main = await uploadFile('/api/import/excel', { sheet_name: sheetName })
      results.push(main.message)

      // Additional imports from the same file
      if (importWeekly) {
        try {
          const w = await uploadFile('/api/import/weekly-payouts')
          results.push(w.message)
        } catch (e) {
          results.push(`Weekly payouts: ${e.message}`)
        }
      }
      if (importMonthly) {
        try {
          const m = await uploadFile('/api/import/monthly-payouts')
          results.push(m.message)
        } catch (e) {
          results.push(`Monthly payouts: ${e.message}`)
        }
      }
      if (importMonthlyTickers) {
        try {
          const mt = await uploadFile('/api/import/monthly-payout-tickers')
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
      const data = await uploadFile('/api/import/generic')
      setResult([data.message])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadTemplate = () => {
    window.open('/api/template/download', '_blank')
  }

  return (
    <div className="page">
      <h1>Import Portfolio Data</h1>

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
            <div className="form-group">
              <label>Sheet Name</label>
              <input
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                style={{ width: '250px' }}
              />
            </div>

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
            {hasData && (
              <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
                Merge mode: existing holdings will be updated with spreadsheet values. New tickers will be added. App-only fields are preserved unless the spreadsheet provides them.
              </div>
            )}

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
