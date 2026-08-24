import {
  IMPORT_BROKERS,
  IMPORT_STEPS,
  TXN_FORMATS,
  formatLabel,
  needsPositionsSnapshotFirst,
} from '../utils/importWorkflow'

const APP_EXPORT = TXN_FORMATS.find((item) => item.value === 'portfolio_export')

export function TransactionOrderWarning({
  format,
  hasPositions,
  currentProfileName,
  txnOrderAck,
  onTxnOrderAckChange,
}) {
  const needsAck = needsPositionsSnapshotFirst(format) && !hasPositions
  if (!needsAck) return null

  return (
    <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
      <strong>Positions first.</strong> This portfolio has no current holdings snapshot.
      A transaction file — especially a partial history — will rebuild share counts and cost
      basis from those rows alone, which usually does not match the live account.
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginTop: '0.75rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={txnOrderAck}
          onChange={(e) => onTxnOrderAckChange(e.target.checked)}
          style={{ marginTop: '0.2rem' }}
        />
        <span>
          This file is the complete history for {currentProfileName}, and I want to build
          positions from it anyway.
        </span>
      </label>
    </div>
  )
}

export default function ImportWorkflowPicker({
  format,
  step,
  workflow,
  completedSteps,
  hasPositions,
  currentProfileName,
  isRollupTarget,
  txnOrderAck,
  onTxnOrderAckChange,
  onSelectStep,
  onSelectBroker,
  onSelectBrokerScope,
  onSelectOtherFormat,
  onRefresh,
  refreshing,
  refreshMessage,
}) {
  const broker = IMPORT_BROKERS.find((item) => item.id === workflow.brokerId)

  return (
    <div style={{ marginBottom: '1rem' }}>
      <p className="import-workflow-label">Import in this order</p>
      <div className="import-steps" role="tablist" aria-label="Import steps">
        {IMPORT_STEPS.map((item) => {
          const done = Boolean(completedSteps[item.id] || (item.id === 'positions' && hasPositions))
          return (
            <button
              key={item.id}
              type="button"
              className={`import-step${step === item.id ? ' is-active' : ''}${done ? ' is-done' : ''}`}
              onClick={() => onSelectStep(item.id)}
              aria-pressed={step === item.id}
            >
              <b className="import-step-kicker">{done ? 'Done' : item.kicker}</b>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </button>
          )
        })}
      </div>

      {step !== 'refresh' && (
        <>
          <p className="import-workflow-label">Broker</p>
          <div className="import-broker-row">
            {IMPORT_BROKERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`btn ${workflow.brokerId === item.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => onSelectBroker(item.id)}
                disabled={isRollupTarget && !item.positionsMultiFormat}
                aria-pressed={workflow.brokerId === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 'positions' && broker?.positionsMultiFormat && (
        <>
          <p className="import-workflow-label">Positions file</p>
          <div className="import-scope-row">
            <button
              type="button"
              className={`btn ${!workflow.schwabAllAccounts ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onSelectBrokerScope(false)}
              disabled={isRollupTarget}
              aria-pressed={!workflow.schwabAllAccounts}
            >
              This account
            </button>
            <button
              type="button"
              className={`btn ${workflow.schwabAllAccounts ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onSelectBrokerScope(true)}
              aria-pressed={workflow.schwabAllAccounts}
            >
              All Accounts
            </button>
          </div>
          <p style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', margin: '-0.35rem 0 0.85rem' }}>
            {workflow.schwabAllAccounts
              ? `Optional shortcut: one ${broker.label} All Accounts Positions export can update several ${broker.label} portfolios. You map accounts after preview. Transactions still import one account at a time.`
              : `Import the current Positions export for ${currentProfileName}. This sets shares and cost basis. Choose All Accounts when one ${broker.label} file should update several portfolios.`}
          </p>
        </>
      )}

      {step === 'positions' && broker && !broker.positionsMultiFormat && (
        <p style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', margin: '0 0 0.85rem' }}>
          Import the current Positions export for <strong>{currentProfileName}</strong>.
          {broker.label} does not have an All-Accounts importer — each file updates the selected portfolio.
        </p>
      )}

      {step === 'transactions' && (
        <p style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', margin: '0 0 0.85rem' }}>
          Transaction files record dividends, DRIP, buys, and sells for{' '}
          <strong>{currentProfileName}</strong>. They are not a second snapshot of what you own.
          {broker ? ` Use the ${broker.label} history export for this account.` : ' Pick a broker first.'}
        </p>
      )}

      {step === 'refresh' && (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: '0 0 0.75rem' }}>
            After positions (and any transaction history) are in, refresh market prices and dividend fields.
            Do this last so a refresh and an import are not writing the same holdings at once.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? <><span className="spinner" /> Refreshing...</> : 'Refresh Prices & Divs'}
          </button>
          {refreshMessage && (
            <p style={{ margin: '0.75rem 0 0', color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
              {refreshMessage}
            </p>
          )}
        </div>
      )}

      <TransactionOrderWarning
        format={format}
        hasPositions={hasPositions}
        currentProfileName={currentProfileName}
        txnOrderAck={txnOrderAck}
        onTxnOrderAckChange={onTxnOrderAckChange}
      />

      {APP_EXPORT && step !== 'refresh' && (
        <details style={{ marginBottom: '0.5rem' }} open={format === 'portfolio_export'}>
          <summary style={{ cursor: 'pointer', color: 'var(--accent-bright)', fontSize: '0.9rem' }}>
            App export
          </summary>
          <p style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', margin: '0.6rem 0' }}>
            Restore a workbook from this app&apos;s Export page. Generic Positions and Generic
            Transactions have their own tabs. Snowball migration is on the Snowball tab.
          </p>
          <button
            type="button"
            className={`btn ${format === APP_EXPORT.value ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onSelectOtherFormat(APP_EXPORT.value)}
            disabled={isRollupTarget}
          >
            {APP_EXPORT.label}
          </button>
        </details>
      )}

      {format && step !== 'refresh' && (
        <p style={{ color: 'var(--text-dim-2)', fontSize: '0.8rem', margin: '0.35rem 0 0' }}>
          Using {formatLabel(format)}.
        </p>
      )}
    </div>
  )
}
