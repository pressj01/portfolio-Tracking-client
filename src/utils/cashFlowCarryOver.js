// Which of the person's other portfolios a new cash-flow expense also goes to.
// Per-computer, like the app's other remembered choices. Having to remember each
// time is the whole complaint this exists for, so the ticks stick.
const CARRY_KEY = 'cash_flow_carry_to_v1'

function readAll() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CARRY_KEY))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(all) {
  try {
    window.localStorage.setItem(CARRY_KEY, JSON.stringify(all))
  } catch {
    // Blocked storage only means the boxes start unticked next time.
  }
}

// Only a portfolio that can take a copy right now stays ticked, so one since
// marked Test / non-owned or linked to another plan is never sent.
export function readCarrySelection(profileId, targets) {
  const saved = readAll()[profileId]
  if (!Array.isArray(saved)) return []
  const open = new Set(
    targets.filter(target => target.state === 'open').map(target => target.profile_id),
  )
  return saved.filter(id => open.has(id))
}

export function rememberCarrySelection(profileId, selected) {
  writeAll({ ...readAll(), [profileId]: selected })
}

// The first add from one portfolio pre-ticks the same group on each portfolio it
// reached, so four portfolios are set up once rather than four times. A choice
// already made on that portfolio, including "none", is left alone.
export function seedCarrySelections(profileId, selected) {
  const all = readAll()
  for (const id of selected) {
    if (!Array.isArray(all[id])) {
      all[id] = [profileId, ...selected.filter(other => other !== id)]
    }
  }
  writeAll(all)
}

const listNames = names => new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names)

export function carryOverNote(carried = []) {
  const added = carried.filter(row => row.status === 'added').map(row => row.name)
  const duplicate = carried.filter(row => row.status === 'duplicate').map(row => row.name)
  const skipped = carried
    .filter(row => row.status !== 'added' && row.status !== 'duplicate')
    .map(row => row.name)
  const parts = []
  if (added.length) parts.push(`Also added to ${listNames(added)}.`)
  if (duplicate.length) parts.push(`Already in ${listNames(duplicate)}, so it was not added again.`)
  if (skipped.length) {
    parts.push(`Not added to ${listNames(skipped)}: expenses only carry to your own portfolios that keep their own entries.`)
  }
  return parts.join(' ')
}

// `verb` finishes the sentence, as in "updated in" or "deleted from". A copy the
// server would not touch is named, because its portfolio stopped qualifying
// after this page loaded and it now differs from what the person just did.
export function copyChangeNote(verb, requested = [], applied = [], changed = true) {
  if (!changed) return ''
  const appliedIds = new Set(applied.map(copy => copy.id))
  const done = requested.filter(copy => appliedIds.has(copy.id)).map(copy => copy.name)
  const missed = requested.filter(copy => !appliedIds.has(copy.id)).map(copy => copy.name)
  const parts = []
  if (done.length) parts.push(`Also ${verb} ${listNames(done)}.`)
  if (missed.length) {
    parts.push(`Not changed in ${listNames(missed)}: changes only reach your own portfolios that keep their own entries.`)
  }
  return parts.join(' ')
}
