import { useState } from 'react'

function FieldLabel({ label, help }) {
  if (!help) return label
  const lastSpace = label.lastIndexOf(' ')
  const leadingText = lastSpace === -1 ? '' : `${label.slice(0, lastSpace)} `
  const finalWord = lastSpace === -1 ? label : label.slice(lastSpace + 1)
  return <>{leadingText}<span className="csf-help-label-tail">{finalWord}<i className="csf-help-marker" tabIndex="0" title={help} aria-label={`${label}: ${help}`}>?</i></span></>
}

export default function CompactScannerFilterPanel({
  title,
  groups,
  children,
  strategyControl,
  toolbar,
  onRun,
  loading = false,
  disabled = false,
}) {
  const [editing, setEditing] = useState(null)
  return (
    <aside className="csf-panel" aria-label={`${title} filters`}>
      <div className="csf-heading">
        <div>
          <span>Strategy</span>
          {strategyControl || <strong>{title}</strong>}
        </div>
        <button className="btn btn-sm btn-scan" onClick={onRun} disabled={loading || disabled}>
          {loading ? 'Scanning…' : 'Run Scan'}
        </button>
      </div>

      {toolbar && <div className="csf-toolbar">{toolbar}</div>}

      <div className="csf-summary">
        {groups.map(group => (
          <section key={group.title}>
            <h2>{group.title}</h2>
            {group.items.map(item => {
              const itemKey = `${group.title}:${item.label}`
              const active = editing === itemKey
              return <div className={`csf-summary-item${active ? ' is-editing' : ''}`} key={item.label}>
                <div className="csf-summary-row">
                  <span><FieldLabel label={item.label} help={item.help} /></span>
                  {item.editor ? <button type="button" title={item.help || `Edit ${item.label}`} className={item.muted ? 'is-muted' : ''} aria-expanded={active} onClick={() => setEditing(active ? null : itemKey)}><span className="csf-summary-value">{item.value}</span><i aria-hidden="true">{active ? 'close' : 'edit'}</i></button>
                    : <strong title={item.help} className={item.muted ? 'is-muted' : ''}>{item.value}</strong>}
                </div>
                {active && <div className="csf-inline-editor" title={item.help}>
                  <button
                    type="button"
                    className="csf-editor-close"
                    aria-label={`Close ${item.label} editor`}
                    title="Close editor"
                    onClick={() => setEditing(null)}
                  >×</button>
                  {item.editor}
                  {item.help && <details className="csf-field-help">
                    <summary>What does this mean?</summary>
                    <p>{item.help}</p>
                  </details>}
                  <button type="button" className="csf-editor-done" onClick={() => setEditing(null)}>Done</button>
                </div>}
              </div>
            })}
          </section>
        ))}
      </div>

      <div className="csf-editors">{children}</div>
    </aside>
  )
}
