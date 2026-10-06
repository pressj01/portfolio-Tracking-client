import { useMemo } from 'react'
import { formatMoney } from '../utils/money'

const cashAmount = transaction => {
  const type = String(transaction?.transaction_type || 'BUY').toUpperCase()
  if (type === 'DIVIDEND') return Number(transaction?.dividend_amount) || 0
  const shares = Math.abs(Number(transaction?.shares) || 0)
  const price = Number(transaction?.price_per_share) || 0
  const fees = Number(transaction?.fees) || 0
  return type === 'SELL' ? (shares * price) - fees : (shares * price) + fees
}

export default function LotTransactionHistory({ transactions, profiles }) {
  const accountNames = useMemo(
    () => new Map((profiles || []).map(profile => [Number(profile.id), profile.name])),
    [profiles],
  )

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return <div className="mh-open-lot-empty">No transaction history is recorded for this ticker.</div>
  }

  return (
    <div className="mh-open-lots">
      <div className="mh-open-lot-note">
        Complete read-only audit trail. Use Holdings to edit, delete, reorder, or specify sale lots.
      </div>
      <div className="mh-lot-scroll" role="region" aria-label="Transaction history" tabIndex={0}>
        <table className="mh-lot-table mh-open-lot-table mh-transaction-history-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th>Date</th>
              <th>Shares</th>
              <th>Price</th>
              <th>Fees</th>
              <th>Cost / Proceeds / Amount</th>
              <th>Shares Remaining</th>
              <th>Realized G/L</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(transaction => {
              const type = String(transaction.transaction_type || 'BUY').toUpperCase()
              const account = transaction.source_account_name
                || accountNames.get(Number(transaction.profile_id))
                || `Account ${transaction.profile_id}`
              return (
                <tr key={`${transaction.record_type || 'transaction'}-${transaction.id || transaction.dividend_payment_id}`}>
                  <td>{account}</td>
                  <td>{type}</td>
                  <td>{transaction.transaction_date || '-'}</td>
                  <td>{type === 'DIVIDEND' ? '0.000' : Number(transaction.shares || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 6 })}</td>
                  <td>{formatMoney(type === 'DIVIDEND' ? 0 : transaction.price_per_share, { fallback: '$0.00' })}</td>
                  <td>{formatMoney(type === 'DIVIDEND' ? 0 : transaction.fees, { fallback: '$0.00' })}</td>
                  <td>{formatMoney(cashAmount(transaction), { fallback: '$0.00' })}</td>
                  <td>{type === 'BUY' ? Number(transaction.shares_remaining || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 6 }) : '-'}</td>
                  <td className={Number(transaction.realized_gain || 0) >= 0 ? 'mh-open-lot-positive' : 'mh-open-lot-negative'}>
                    {type === 'SELL' ? formatMoney(transaction.realized_gain, { fallback: '$0.00' }) : '-'}
                  </td>
                  <td title={transaction.raw_notes || transaction.notes || undefined}>{transaction.raw_notes || transaction.notes || '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
