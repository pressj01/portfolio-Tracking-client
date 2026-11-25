// Portfolio Builder import: naming a model read from an Export Excel / Export
// CSV file, and telling the user what the file holds before it is saved.

// The file's own name, or, when this account already has a model by that
// name, "<name> (imported)", "<name> (imported 2)", … Names compare without
// case, as a near-duplicate in the sidebar is hard to tell apart.
export function suggestImportName(name, takenNames = []) {
  const base = String(name || '').trim() || 'Imported portfolio'
  const taken = new Set([...takenNames].map(n => String(n || '').trim().toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 1; i < 1000; i += 1) {
    const candidate = i === 1 ? `${base} (imported)` : `${base} (imported ${i})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base} (imported ${Date.now()})`
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const SKIPPED_SHOWN = 6

// The prompt text for a read file: what comes in, what is left behind, and
// any currency conversion. ``money`` formats a USD amount for display.
export function describeImport(parsed, fileName, money) {
  const holdings = parsed?.holdings || []
  const lines = [`${fileName || 'The file'}: ${plural(holdings.length, 'holding')}, ${money(parsed?.total)} in all.`]

  const settings = []
  if (parsed?.starting_balance != null) settings.push(`starting balance ${money(parsed.starting_balance)}`)
  if (parsed?.target_yield_pct != null) settings.push(`target yield ${parsed.target_yield_pct}%`)
  if (parsed?.target_monthly_income != null) settings.push(`target income ${money(parsed.target_monthly_income)} a month`)
  if (parsed?.max_weight_pct != null) settings.push(`max ${parsed.max_weight_pct}% per holding`)
  if (settings.length) lines.push(`It also brings its ${settings.join(', ')}.`)
  else if (!parsed?.has_settings) lines.push('A CSV carries the holdings only: no starting balance or target comes with it.')

  if (parsed?.currency && parsed.currency !== 'USD' && parsed.rate) {
    lines.push(parsed.rate_source === 'file'
      ? `Its amounts were in ${parsed.currency}, read back to US dollars at the rate it was exported with (${parsed.rate}).`
      : `Its amounts were in ${parsed.currency}, read back to US dollars at today's rate (${parsed.rate}); a CSV does not record the rate it was exported at.`)
  }

  const skipped = parsed?.skipped || []
  if (skipped.length) {
    const shown = skipped.slice(0, SKIPPED_SHOWN).map(s => `${s.ticker} ${s.reason}`).join('; ')
    const more = skipped.length > SKIPPED_SHOWN ? `; and ${skipped.length - SKIPPED_SHOWN} more` : ''
    lines.push(`Left out ${plural(skipped.length, 'row')}: ${shown}${more}.`)
  }
  for (const warning of parsed?.warnings || []) lines.push(warning)

  lines.push('', 'Name for the new model portfolio:')
  return lines.join('\n')
}
