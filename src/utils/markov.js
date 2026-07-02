// Observable Markov-chain regime detector — JS port of the Python reference
// (stock_chart/web/markov.py, framework by Roan / @RohOnChain).
//
// Each price bar is labelled Bull / Bear / Sideways by comparing the rolling
// log-return ln(close[i] / close[i-window]) to a ±threshold. From the labelled
// sequence we estimate the 3×3 maximum-likelihood transition matrix P and solve
// for its stationary distribution π.
//
// Index map is identical to the reference: 0 = Bear, 1 = Sideways, 2 = Bull.

export const REGIME_NAMES = { 0: 'Bear', 1: 'Sideways', 2: 'Bull' }
export const TRANSITION_PRIOR = 0.5

// Soft, semi-transparent regime fills for the chart background ribbon.
// Matches the reference _COLORS (Bull green / Bear rose / Sideways grey).
export const REGIME_COLORS = {
  2: 'rgba(132,187,161,0.16)', // Bull     — soft green
  0: 'rgba(197,127,134,0.16)', // Bear     — muted rose
  1: 'rgba(164,171,183,0.08)', // Sideways — cool grey
}

/**
 * Label each close as Bear(0), Sideways(1), Bull(2), or null (insufficient
 * history / bad price). thr is the log-return threshold in decimal form.
 */
export function labelRegimes(closes, window, thr) {
  const result = new Array(closes.length).fill(null)
  if (!Number.isInteger(window) || window < 1 || !Number.isFinite(thr) || thr <= 0) return result

  for (let i = window; i < closes.length; i++) {
    const c0 = closes[i - window]
    const c1 = closes[i]
    if (c0 <= 0 || c1 <= 0) continue
    const lr = Math.log(c1 / c0)
    result[i] = lr > thr ? 2 : lr < -thr ? 0 : 1
  }
  return result
}

/**
 * Count observed transitions. A null regime resets the running previous-state
 * so no false transition is counted across a gap.
 */
export function transitionCounts(regimes) {
  const counts = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  let prev = null
  for (const r of regimes) {
    if (r === null) { prev = null; continue }
    if (prev !== null) counts[prev][r] += 1
    prev = r
  }
  return counts
}

/**
 * Build a row-stochastic transition matrix using a Jeffreys prior. Adding a
 * small 0.5 pseudo-count to each outcome prevents sparse rows from snapping to
 * misleading 0% / 100% estimates while remaining negligible for large samples.
 */
function transitionMatrixFromCounts(counts, prior = TRANSITION_PRIOR) {
  const alpha = Number.isFinite(prior) && prior >= 0 ? prior : TRANSITION_PRIOR
  return counts.map(row => {
    const total = row[0] + row[1] + row[2]
    const denominator = total + 3 * alpha
    if (denominator <= 0) return [1 / 3, 1 / 3, 1 / 3]
    return row.map(value => (value + alpha) / denominator)
  })
}

export function transitionMatrix(regimes, prior = TRANSITION_PRIOR) {
  return transitionMatrixFromCounts(transitionCounts(regimes), prior)
}

/**
 * Solve πP = π with sum(π) = 1. Directly solving the linear system avoids the
 * P^50 convergence error that appears in very sticky chains.
 */
export function stationary(P) {
  const isValid = Array.isArray(P) && P.length === 3 &&
    P.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))
  if (!isValid) return [1 / 3, 1 / 3, 1 / 3]

  const augmented = [
    [P[0][0] - 1, P[1][0], P[2][0], 0],
    [P[0][1], P[1][1] - 1, P[2][1], 0],
    [1, 1, 1, 1],
  ]

  // Gauss-Jordan elimination with partial pivoting.
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) {
      // A reducible/periodic unsmoothed matrix may not have a unique solution.
      // The Cesàro average still yields a valid long-run distribution.
      let distribution = [1 / 3, 1 / 3, 1 / 3]
      const average = [0, 0, 0]
      const iterations = 10000
      for (let n = 1; n <= iterations; n++) {
        distribution = P[0].map((_, j) =>
          distribution.reduce((sum, value, i) => sum + value * P[i][j], 0))
        for (let i = 0; i < 3; i++) average[i] += distribution[i]
      }
      const total = average[0] + average[1] + average[2]
      return total > 0 ? average.map(value => value / total) : [1 / 3, 1 / 3, 1 / 3]
    }
    if (pivot !== col) [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]]

    const divisor = augmented[col][col]
    for (let j = col; j < 4; j++) augmented[col][j] /= divisor
    for (let row = 0; row < 3; row++) {
      if (row === col) continue
      const factor = augmented[row][col]
      for (let j = col; j < 4; j++) augmented[row][j] -= factor * augmented[col][j]
    }
  }

  const solved = augmented.map(row => row[3])
  if (solved.some(value => value < -1e-9 || !Number.isFinite(value))) return [1 / 3, 1 / 3, 1 / 3]
  const nonNegative = solved.map(value => Math.max(0, value))
  const total = nonNegative[0] + nonNegative[1] + nonNegative[2]
  return total > 0 ? nonNegative.map(value => value / total) : [1 / 3, 1 / 3, 1 / 3]
}

/**
 * Full pipeline for a list of OHLCV records ({ close, ... } in chronological
 * order). Mirrors compute_markov_overlay() in the Python reference.
 *
 * @returns {{ ok, regimes, matrix, stationary, currentRegime, regimeName }}
 *   regimes is aligned 1:1 with the input records (entries are 0/1/2 or null).
 */
export function computeMarkov(records, window = 20, thresholdPct = 5) {
  const empty = {
    ok: false, regimes: [], matrix: [], stationary: [],
    transitionCounts: [], transitionSamples: [], transitionPrior: TRANSITION_PRIOR,
    currentRegime: 1, regimeName: 'Sideways', currentLogReturnPct: null,
  }
  const safeWindow = Number(window)
  const safeThreshold = Number(thresholdPct)
  if (!Number.isInteger(safeWindow) || safeWindow < 1 ||
      !Number.isFinite(safeThreshold) || safeThreshold <= 0 ||
      !records || records.length < safeWindow + 2) return empty

  const closes = records.map(r => Number(r.close))
  const thr = safeThreshold / 100
  const regimes = labelRegimes(closes, safeWindow, thr)
  const counts = transitionCounts(regimes)
  const samples = counts.map(row => row[0] + row[1] + row[2])
  const matrix = transitionMatrixFromCounts(counts)
  const stat = stationary(matrix)

  let current = 1
  let currentIndex = -1
  for (let i = regimes.length - 1; i >= 0; i--) {
    if (regimes[i] !== null) { current = regimes[i]; currentIndex = i; break }
  }
  const currentLogReturnPct = currentIndex >= safeWindow
    ? Math.log(closes[currentIndex] / closes[currentIndex - safeWindow]) * 100
    : null

  return {
    ok: true,
    regimes,
    matrix,                 // matrix[from][to], 0=Bear 1=Sideways 2=Bull
    stationary: stat,       // [πBear, πSideways, πBull]
    transitionCounts: counts,
    transitionSamples: samples,
    transitionPrior: TRANSITION_PRIOR,
    currentRegime: current,
    regimeName: REGIME_NAMES[current],
    currentLogReturnPct,
  }
}
