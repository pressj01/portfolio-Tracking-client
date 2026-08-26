import { useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const FORMATS = [
  ['generic', 'Generic Options Transactions'],
  ['schwab', 'Charles Schwab Transactions'],
  ['etrade', 'E*TRADE Transactions'],
  ['fidelity', 'Fidelity Transactions'],
  ['robinhood', 'Robinhood Transactions'],
  ['shear_group', 'Shear Group Activity'],
  ['interactive_brokers', 'Interactive Brokers Transactions'],
]

const TEMPLATE = [
  'Date,Action,Underlying,Option Type,Expiration,Strike,Contracts,Price,Fees,OCC Symbol,Trade ID,Strategy,Purpose,Order ID,Notes',
  '2026-08-03,STO,SPY,PUT,2026-09-18,545,1,0.90,0.65,SPY260918P00545000,condor-1,Iron Condor,Income,order-1001,Short put spread leg',
  '2026-08-03,BTO,SPY,PUT,2026-09-18,540,1,0.30,0.65,SPY260918P00540000,condor-1,Iron Condor,Income,order-1001,Long put wing',
].join('\r\n')

const money = (value) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

async function jsonOrError(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Import request failed')
  return data
}

export default function OptionTradeImport() {
  const pf = useProfileFetch()
  const { currentProfileName, isAggregate } = useProfile()
  const inputRef = useRef(null)
  const [format, setFormat] = useState('generic')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const formData = () => {
    const data = new FormData()
    data.append('file', file)
    data.append('format', format)
    return data
  }

  const chooseFile = (event) => {
    setFile(event.target.files?.[0] || null)
    setPreview(null)
    setResult(null)
    setError('')
  }

  const previewFile = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setPreview(await jsonOrError(await pf('/api/option-trades/import/preview', { method: 'POST', body: formData() })))
    } catch (requestError) {
      setError(requestError.message)
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const importFile = async () => {
    setBusy(true)
    setError('')
    try {
      const imported = await jsonOrError(await pf('/api/option-trades/import', { method: 'POST', body: formData() }))
      setResult(imported)
      setPreview(null)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'generic-options-transactions.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const summary = preview?.summary || {}
  const importable = Math.max(0, Number(summary.recognized || 0) - Number(summary.duplicates || 0))

  return (
    <main className="ot-page oti-page">
      <header className="ot-hero">
        <div>
          <span className="ot-eyebrow">Options · {currentProfileName}</span>
          <h1>Import Option Transactions</h1>
          <p>Use broker activity as the source of truth for option executions. This importer is separate from portfolio holdings and stock transactions.</p>
        </div>
        <NavLink className="btn btn-secondary" to="/option-trades">← Option Trades</NavLink>
      </header>

      {isAggregate && <div className="ot-alert ot-alert-error">Select an individual portfolio before importing option transactions.</div>}
      {error && <div className="ot-alert ot-alert-error">{error}</div>}
      {result && (
        <div className="ot-alert ot-alert-success">
          <strong>Import complete.</strong> Added {result.inserted} execution{result.inserted === 1 ? '' : 's'} across {result.trades_touched} trade{result.trades_touched === 1 ? '' : 's'}.
          {result.duplicates > 0 && ` ${result.duplicates} duplicate row${result.duplicates === 1 ? ' was' : 's were'} skipped.`}
          {result.unmatched > 0 && ` ${result.unmatched} unmatched close${result.unmatched === 1 ? ' was' : 's were'} skipped for review.`}
        </div>
      )}

      <section className="oti-workflow">
        <div className="card oti-source-card">
          <span className="oti-step">1</span>
          <div>
            <span className="ot-eyebrow">Choose source</span>
            <h2>Transaction or activity export</h2>
            <p>Complete history is best. If history begins after a position was opened, import the missing opening executions with the generic template first.</p>
          </div>
          <label className="oti-field"><span>File format</span><select value={format} disabled={busy} onChange={event => { setFormat(event.target.value); setPreview(null); setResult(null) }}>{FORMATS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="oti-dropzone">
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xlsm" disabled={busy || isAggregate} onChange={chooseFile} />
            <strong>{file ? file.name : 'Choose a CSV or XLSX file'}</strong>
            <span>{file ? `${(file.size / 1024).toFixed(1)} KB selected` : 'Broker transaction exports and the generic options template are supported.'}</span>
          </label>
          <div className="ot-form-actions">
            {format === 'generic' && <button type="button" className="btn btn-secondary" onClick={downloadTemplate}>Download generic template</button>}
            <button type="button" className="btn btn-primary" disabled={!file || busy || isAggregate} onClick={previewFile}>{busy ? 'Reading file…' : 'Preview executions'}</button>
          </div>
        </div>

        <aside className="card oti-rules-card">
          <span className="ot-eyebrow">How rows are handled</span>
          <h2>One row = one execution</h2>
          <ol>
            <li>BTO, STO, BTC, STC, expiration, assignment, and exercise rows are recognized.</li>
            <li>Trade ID is the strongest multi-leg grouping key; broker Order ID is used next.</li>
            <li>Closing rows match an existing open contract by account, underlying, expiration, strike, type, and side.</li>
            <li>Order/transaction IDs plus contract details prevent the same execution from importing twice.</li>
          </ol>
          <div className="oti-callout"><strong>Positions are reconciliation, not history.</strong><span>A current option-positions export can show what is open, but transaction history is required for accurate premium, fees, and realized P/L.</span></div>
        </aside>
      </section>

      {preview && (
        <section className="card oti-preview">
          <div className="ot-section-heading">
            <div><span className="oti-step">2</span><span className="ot-eyebrow">Review before writing</span><h2>Execution preview</h2><p>{preview.source_label} · {summary.recognized} recognized rows · {summary.groups} opening group{summary.groups === 1 ? '' : 's'}</p></div>
            <div className="oti-preview-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => setPreview(null)}>Choose another file</button><button className="btn btn-primary" disabled={busy || importable === 0} onClick={importFile}>{busy ? 'Importing…' : `Import ${importable} execution${importable === 1 ? '' : 's'}`}</button></div>
          </div>

          <div className="oti-summary-grid">
            <span><small>Recognized</small><strong>{summary.recognized}</strong></span>
            <span><small>Opening fills</small><strong>{summary.opening}</strong></span>
            <span><small>Closing events</small><strong>{summary.closing}</strong></span>
            <span className={summary.needs_review ? 'oti-warning' : ''}><small>Needs review</small><strong>{summary.needs_review}</strong></span>
            <span><small>Duplicates</small><strong>{summary.duplicates}</strong></span>
            <span className={summary.unmatched_closes ? 'oti-warning' : ''}><small>Unmatched closes</small><strong>{summary.unmatched_closes}</strong></span>
            <span><small>Filtered rows</small><strong>{summary.filtered}</strong></span>
          </div>

          {(summary.needs_review > 0 || summary.unmatched_closes > 0) && <div className="ot-alert"><strong>Review the highlighted rows.</strong> Assumed open/close actions should be corrected in the source file. Unmatched closes will be skipped because no opening leg exists in this portfolio or earlier in the file.</div>}

          <div className="table-scroll">
            <table className="oti-preview-table">
              <thead><tr><th>Row</th><th>Date</th><th>Action</th><th>Contract</th><th>Qty</th><th>Price / fees</th><th>Group</th><th>Strategy / purpose</th><th>Match</th><th>Review</th></tr></thead>
              <tbody>{preview.executions.map(row => (
                <tr key={`${row.source_row}-${row.dedupe_hash}`} className={row.warnings.length || row.match_status === 'unmatched' ? 'oti-row-warning' : row.duplicate ? 'oti-row-duplicate' : ''}>
                  <td>{row.source_row}</td>
                  <td>{row.executed_at}</td>
                  <td><strong>{row.action}</strong></td>
                  <td><strong>{row.underlying}</strong> {row.expiration} {Number(row.strike).toLocaleString('en-US', { maximumFractionDigits: 3 })} {row.option_type}</td>
                  <td>{row.contracts}</td>
                  <td>{money(row.price)}<small>Fees {money(row.fees)}</small></td>
                  <td><code>{row.group_key}</code></td>
                  <td>{row.strategy_type || 'Match existing trade'}<small>{row.purpose || '—'}</small></td>
                  <td><span className={`oti-match oti-match-${row.match_status}`}>{row.duplicate ? 'duplicate' : row.match_status}</span></td>
                  <td>{row.warnings.length ? row.warnings.join(' ') : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          {preview.filtered_rows.length > 0 && (
            <details className="oti-filtered"><summary>{preview.filtered_rows.length} filtered row{preview.filtered_rows.length === 1 ? '' : 's'}</summary>{preview.filtered_rows.map(row => <div key={row.row}>Row {row.row}: {row.reason}</div>)}</details>
          )}
        </section>
      )}
    </main>
  )
}
