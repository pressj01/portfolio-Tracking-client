// Names and explanations for the "What would it take?" plan options. Each kind
// is one rule the backend search adds (search_grade_options in backend/grading.py).

export function planOptionLabel(option) {
  switch (option?.kind) {
    case 'income': return 'Keeps income'
    case 'keep': return `Keeps ${option.rule_ticker}`
    case 'avoid': return `Without adding to ${option.rule_ticker}`
    case 'fewer': return 'Fewer changes'
    default: return 'Main plan'
  }
}

export function planOptionNote(option) {
  switch (option?.kind) {
    case 'income': return 'Money moves only into holdings that pay at least as much as the ones funding them, so estimated income does not fall.'
    case 'keep': return `Leaves ${option.rule_ticker} as it is, which the main plan trims, and reaches the grade with other changes.`
    case 'avoid': return `Adds nothing to ${option.rule_ticker}, which the main plan increases, so the money goes to other holdings.`
    case 'fewer': return 'Shifts one pair of holdings at a time, so fewer positions change than in the main plan.'
    default: return 'The search’s first answer: money moves from the holdings that weigh on the score most into those that lift it most, stopping once the target is met.'
  }
}

// The figures each option card shows, and which options lead on each one.
export function planOptionFacts(options) {
  const facts = options.map(option => {
    const { before, after } = option.comparison || {}
    return {
      grade: option.target?.grade,
      score: option.target?.score,
      moved: option.target?.moved_value ?? 0,
      income: before && after ? after.annual_income - before.annual_income : null,
      changes: (option.weights || []).filter(w => w.action && w.action !== 'HOLD').length,
    }
  })
  const leaders = [
    ['Least moved', f => -f.moved],
    ['Fewest changes', f => -f.changes],
    ['Most income', f => f.income],
    ['Highest score', f => f.score],
  ]
  return facts.map(f => ({
    ...f,
    // A badge only for a clear leader: a tie for best earns none.
    badges: leaders.filter(([, value]) => {
      const values = facts.map(value).filter(v => v != null)
      const best = Math.max(...values)
      return value(f) === best && values.filter(v => v === best).length === 1
    }).map(([label]) => label),
  }))
}
