import { useState } from 'react'

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
                  <span>{item.label}</span>
                  {item.editor ? <button type="button" className={item.muted ? 'is-muted' : ''} aria-expanded={active} onClick={() => setEditing(active ? null : itemKey)}><span className="csf-summary-value">{item.value}</span><i aria-hidden="true">{active ? 'close' : 'edit'}</i></button>
                    : <strong className={item.muted ? 'is-muted' : ''}>{item.value}</strong>}
                </div>
                {active && <div className="csf-inline-editor">
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
