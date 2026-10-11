import OpenLotsView from './OpenLotsView'
import LotTransactionHistory from './LotTransactionHistory'

/**
 * Read-only lot detail for one ticker row: the open lots and the complete
 * transaction history behind a two-view switch. `detail` is the ticker's entry
 * from useLotDetails. Editing stays on Holdings, which `onManage` links to.
 */
export default function LotDetailsPanel({ ticker, detail, holding, profiles, onViewChange, onManage }) {
  const view = detail.view === 'history' ? 'history' : 'open'
  return (
    <div className="mh-lot-panel">
      <div className="mh-lot-toolbar">
        <div className="mh-lot-toolbar-main">
          <strong>{ticker} lot details</strong>
          <div className="mh-lot-view-tabs" role="tablist" aria-label={`${ticker} lot detail view`}>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'open'}
              className={view === 'open' ? 'active' : undefined}
              onClick={() => onViewChange('open')}
            >Open lots</button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'history'}
              className={view === 'history' ? 'active' : undefined}
              onClick={() => onViewChange('history')}
            >Transaction history</button>
          </div>
        </div>
        {onManage && (
          <button type="button" className="btn btn-secondary" onClick={onManage}>Manage transactions</button>
        )}
      </div>
      {detail.loading ? (
        <div style={{ padding: '0.75rem', textAlign: 'center' }}><span className="spinner" /></div>
      ) : detail.error ? (
        <div className="alert alert-error" style={{ margin: '0.75rem 1rem' }}>{detail.error}</div>
      ) : view === 'history' ? (
        <LotTransactionHistory transactions={detail.transactions} profiles={profiles} />
      ) : (
        <OpenLotsView transactions={detail.transactions} holding={holding} profiles={profiles} />
      )}
    </div>
  )
}
