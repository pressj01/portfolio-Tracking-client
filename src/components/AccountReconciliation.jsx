import { formatMoney, formatMoneyDelta } from '../utils/money'

// What a broker calls the account, next to what a tracking screen measures.
// Each screen measures the positions it charts — the right basis for a return,
// never the whole account — so cash (where a screen leaves it out) and open
// option contracts (which live in their own ledger, with no history to replay)
// are named here rather than folded into a series or a return.
//
// The backend sends null when there is nothing to reconcile, so an account with
// no options whose cash is already counted renders nothing at all.

function parts(data) {
  const out = []
  if (!data.cash_included && data.cash_value > 0) {
    out.push(`+ ${formatMoney(data.cash_value)} cash`)
  }
  const options = data.open_options
  if (options) {
    const count = `open option${options.open_trades === 1 ? '' : 's'} (${options.open_trades})`
    out.push(
      options.liquidating_value != null
        // Signed, so a short spread reads as the subtraction it is.
        ? `${formatMoneyDelta(options.liquidating_value)} ${count}`
        : `± unquoted ${count}`,
    )
  }
  return out
}

// The sub-line form, for a card whose headline is already close to the account
// value and only needs the remainder named.
export default function AccountReconciliation({ data }) {
  if (!data) return null
  const detail = parts(data)
  if (!detail.length) return null
  return (
    <div className="summary-sub">
      {detail.join(' · ')} · account {formatMoney(data.account_value)}
    </div>
  )
}

// The standalone card, for a screen whose headline deliberately excludes cash.
// This is the figure to compare against a broker's net liquidating value.
export function AccountValueCard({ data, label = 'Account Value', basisLabel, holdingsNote }) {
  if (!data) return null
  const detail = parts(data)
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{formatMoney(data.account_value)}</div>
      {basisLabel && <div className="summary-sub">{basisLabel}</div>}
      {/* Led by "Holdings" so the line reads as the whole sum, not as a set of
          adjustments to some figure the reader has to go find. */}
      {detail.length > 0 && <div className="summary-sub">Holdings {detail.join(' ')}</div>}
      {/* This card inherits its screen's holdings clock, and the option mark is
          quoted fresh on every request. Two screens can therefore print two
          account values for the same account, which needs saying on the card
          rather than only in whichever screen the reader happens to open. */}
      {holdingsNote && <div className="summary-sub">{holdingsNote}</div>}
      <div className="summary-sub">Compare with broker net liquidating value</div>
    </div>
  )
}
