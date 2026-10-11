import { useMemo, useState } from 'react'
import { formatMoney } from '../utils/money'
import { nextLotSort, sortLotRows } from '../utils/lotTableSort'
import LotSortHeader from './LotSortHeader'

const typeOf = transaction => String(transaction?.transaction_type || 'BUY').toUpperCase()

const cashAmount = transaction => {
  const type = typeOf(transaction)
  if (type === 'DIVIDEND') return Number(transaction?.dividend_amount) || 0
  const shares = Math.abs(Number(transaction?.shares) || 0)
  const price = Number(transaction?.price_per_share) || 0
  const fees = Number(transaction?.fees) || 0
  return type === 'SELL' ? (shares * price) - fees : (shares * price) + fees
}

// Each column sorts on what its cell shows: a dividend's $0.00 price sorts as
// zero, and a cell that shows a dash (no remaining shares on a SELL, no
// realized result on a BUY) has nothing to compare and stays at the bottom.
const HISTORY_COLUMNS = [
  { key: 'account', label: 'Account', type: 'string' },
  { key: 'transaction_type', label: 'Type', type: 'string', value: typeOf },
  { key: 'transaction_date', label: 'Date', type: 'date' },
  { key: 'shares', label: 'Shares', type: 'number', value: row => (typeOf(row) === 'DIVIDEND' ? 0 : Number(row.shares || 0)) },
  { key: 'price_per_share', label: 'Price', type: 'number', value: row => (typeOf(row) === 'DIVIDEND' ? 0 : Number(row.price_per_share || 0)) },
  { key: 'fees', label: 'Fees', type: 'number', value: row => (typeOf(row) === 'DIVIDEND' ? 0 : Number(row.fees || 0)) },
  { key: 'cash_amount', label: 'Cost / Proceeds / Amount', type: 'number', value: cashAmount },
  { key: 'shares_remaining', label: 'Shares Remaining', type: 'number', value: row => (typeOf(row) === 'BUY' ? Number(row.shares_remaining || 0) : null) },
  { key: 'realized_gain', label: 'Realized G/L', type: 'number', value: row => (typeOf(row) === 'SELL' ? Number(row.realized_gain || 0) : null) },
  { key: 'notes', label: 'Notes', type: 'string', value: row => row.raw_notes || row.notes || '' },
]

export default function LotTransactionHistory({ transactions, profiles }) {
  const accountNames = useMemo(
    () => new Map((profiles || []).map(profile => [Number(profile.id), profile.name])),
    [profiles],
  )
  // No sort is the ledger order the events arrive in.
  const [sort, setSort] = useState(null)
  const rows = useMemo(() => sortLotRows(
    (Array.isArray(transactions) ? transactions : []).map(transaction => ({
      ...transaction,
      account: transaction.source_account_name
        || accountNames.get(Number(transaction.profile_id))
        || `Account ${transaction.profile_id}`,
    })),
    sort,
    HISTORY_COLUMNS,
  ), [transactions, accountNames, sort])

  if (rows.length === 0) {
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
              {HISTORY_COLUMNS.map(column => (
                <LotSortHeader
                  key={column.key}
                  column={column}
                  sort={sort}
                  onSort={key => setSort(current => nextLotSort(current, key))}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(transaction => {
              const type = typeOf(transaction)
              return (
                <tr key={`${transaction.record_type || 'transaction'}-${transaction.id || transaction.dividend_payment_id}`}>
                  <td>{transaction.account}</td>
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
