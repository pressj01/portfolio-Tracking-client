// Distributions paid since a broker-synced account's last positions import.
//
// The account is valued as the file's shares at today's price plus the file's
// cash. Prices move on every refresh, but each ex-date's price drop is only
// matched by the payment once the next file arrives, so between imports the
// value reads low by everything paid since. The backend estimates that amount
// (/api/portfolio-value `distributions_since_import`) and already adds it to
// `account_value`; these helpers say so on the card, and that it is an estimate.

// "2026-11-05" -> "11/5", read from the digits so no timezone can move the day.
export const shortImportDate = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!match) return null
  return `${Number(match[2])}/${Number(match[3])}`
}

const amountOf = (summary) => Number((summary && summary.value) || 0)

export const hasDistributionsSinceImport = (summary) => Math.abs(amountOf(summary)) >= 0.005

// The line under the Portfolio Value figure.
export const distributionsSinceImportLine = (summary, formatter) => {
  if (!hasDistributionsSinceImport(summary)) return ''
  const money = formatter || (value => `$${Math.round(value).toLocaleString()}`)
  const date = shortImportDate(summary.since)
  const when = date ? `since the ${date} import` : 'since the last imports'
  return `Includes ~${money(amountOf(summary))} paid ${when} (est.)`
}

// Hover text: what is in the figure, what is not, and what replaces it.
export const distributionsSinceImportTitle = (summary, formatter) => {
  if (!hasDistributionsSinceImport(summary)) return ''
  const money = formatter || (value => `$${Math.round(value).toLocaleString()}`)
  const payments = Number(summary.payments || 0)
  const accounts = Array.isArray(summary.accounts) ? summary.accounts : []
  const parts = [
    `About ${money(amountOf(summary))} from ${payments} distribution${payments === 1 ? '' : 's'} `
      + 'paid since the last positions import, which the imported shares and cash do not include yet.',
    'Each is the fund\'s distribution times the shares held on its ex-date; reinvested ones are '
      + 'valued at today\'s price, and amounts a transactions import already reported are used as-is.',
    'The next positions import replaces this with the broker\'s own figures.',
    'Trades, deposits, withdrawals, option premium and fees since the import are not included.',
  ]
  if (accounts.length > 1) {
    const perAccount = accounts.map((account) => {
      const date = shortImportDate(account.since)
      return `${account.name}: ${money(Number(account.value || 0))}${date ? ` since ${date}` : ''}`
    })
    parts.push(`By account: ${perAccount.join('; ')}.`)
  }
  return parts.join(' ')
}
