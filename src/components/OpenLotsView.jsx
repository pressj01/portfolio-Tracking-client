import { useMemo } from 'react'
import { formatMoney } from '../utils/money'
import { buildOpenLotMetrics } from '../utils/openLotMetrics'

const formatMDY = value => {
  const raw = String(value || '')
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`
  return value
}

export default function OpenLotsView({ transactions, holding, profiles }) {
  const metrics = useMemo(
    () => buildOpenLotMetrics(transactions, holding),
    [transactions, holding],
  )
  const accountNames = useMemo(
    () => new Map((profiles || []).map(profile => [Number(profile.id), profile.name])),
    [profiles],
  )
  const basisLabel = holding?.basis_mode === 'broker_adjusted' ? 'Broker-adjusted' : 'Original'
  const pct = value => value == null
    ? '-'
    : `${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
  const shares = value => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 6 })

  if (metrics.rows.length === 0) {
    return (
      <div className="mh-open-lot-empty">
        No current lots are available from the recorded transactions. The Transaction history view still shows every imported event.
      </div>
    )
  }

  return (
    <div className="mh-open-lots">
      <div className="mh-open-lot-note">
        Current BUY lots with shares remaining. G/L uses the holding&apos;s current price and the selected <strong>{basisLabel}</strong> basis.
        {metrics.basis_adjusted && (
          <> The broker&apos;s aggregate basis adjustment is allocated proportionally across these lots so the total matches Holdings.</>
        )}
      </div>
      {!metrics.shares_match_holding && (
        <div className="mh-open-lot-warning" role="alert">
          Recorded open lots total {shares(metrics.totals.shares)} shares, but Holdings reports {shares(holding.quantity)}. Lot totals below use the recorded lots and will not be forced to the holding total.
        </div>
      )}
      <div className="mh-lot-scroll" role="region" aria-label={`${holding.ticker} current open lots`} tabIndex={0}>
        <table className="mh-lot-table mh-open-lot-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Acquired</th>
              <th>Shares</th>
              <th>Cost / Share</th>
              <th>Cost Basis</th>
              <th>Current Price</th>
              <th>Market Value</th>
              <th>G/L $</th>
              <th>G/L %</th>
              <th>Lot Notes</th>
            </tr>
          </thead>
          <tbody>
            {metrics.rows.map(row => {
              const account = row.source_account_name
                || accountNames.get(Number(row.profile_id))
                || `Account ${row.profile_id}`
              const positive = row.gain_loss >= 0
              return (
                <tr key={row.id}>
                  <td>{account}</td>
                  <td>{formatMDY(row.transaction_date) || '-'}</td>
                  <td>{shares(row.shares)}</td>
                  <td>{formatMoney(row.cost_per_share, { digits: 4, fallback: '-' })}</td>
                  <td>{formatMoney(row.cost_basis, { fallback: '-' })}</td>
                  <td>{formatMoney(row.current_price, { fallback: '-' })}</td>
                  <td>{formatMoney(row.market_value, { fallback: '-' })}</td>
                  <td className={positive ? 'mh-open-lot-positive' : 'mh-open-lot-negative'}>
                    {formatMoney(row.gain_loss, { fallback: '-' })}
                  </td>
                  <td className={positive ? 'mh-open-lot-positive' : 'mh-open-lot-negative'}>{pct(row.gain_loss_pct)}</td>
                  <td title={row.raw_notes || row.notes || undefined}>{row.raw_notes || row.notes || '-'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Open lot total</td>
              <td>{shares(metrics.totals.shares)}</td>
              <td>{metrics.totals.shares > 0 ? formatMoney(metrics.totals.cost_basis / metrics.totals.shares, { digits: 4 }) : '-'}</td>
              <td>{formatMoney(metrics.totals.cost_basis)}</td>
              <td>{formatMoney(holding.current_price)}</td>
              <td>{formatMoney(metrics.totals.market_value)}</td>
              <td className={metrics.totals.gain_loss >= 0 ? 'mh-open-lot-positive' : 'mh-open-lot-negative'}>
                {formatMoney(metrics.totals.gain_loss)}
              </td>
              <td className={metrics.totals.gain_loss >= 0 ? 'mh-open-lot-positive' : 'mh-open-lot-negative'}>
                {pct(metrics.totals.gain_loss_pct)}
              </td>
              <td>{basisLabel} basis</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
