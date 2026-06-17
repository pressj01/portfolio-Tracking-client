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
 * Build the 3×3 row-stochastic MLE transition matrix. A null regime resets the
 * running previous-state so no false transition is counted across a gap. Rows
 * with no observations fall back to uniform [1/3, 1/3, 1/3].
 */
export function transitionMatrix(regimes) {
  const counts = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  let prev = null
  for (const r of regimes) {
    if (r === null) { prev = null; continue }
    if (prev !== null) counts[prev][r] += 1
    prev = r
  }
  return counts.map(row => {
    const t = row[0] + row[1] + row[2]
    return t > 0 ? row.map(v => v / t) : [1 / 3, 1 / 3, 1 / 3]
  })
}

/**
 * Stationary distribution π via matrix exponentiation (Chapman–Kolmogorov):
 * raise P to a high power; every row converges to π. Returns [πBear, πSide, πBull].
 */
export function stationary(P, power = 50) {
  const mul = (A, B) => {
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++) C[i][j] += A[i][k] * B[k][j]
    return C
  }
  let M = P.map(row => row.slice())
  for (let n = 0; n < power - 1; n++) M = mul(M, P)
  return M[0]
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
    currentRegime: 1, regimeName: 'Sideways',
  }
  if (!records || records.length < window + 2) return empty

  const closes = records.map(r => r.close)
  const thr = thresholdPct / 100
  const regimes = labelRegimes(closes, window, thr)
  const matrix = transitionMatrix(regimes)
  const stat = stationary(matrix)

  let current = 1
  for (let i = regimes.length - 1; i >= 0; i--) {
    if (regimes[i] !== null) { current = regimes[i]; break }
  }

  return {
    ok: true,
    regimes,
    matrix,                 // matrix[from][to], 0=Bear 1=Sideways 2=Bull
    stationary: stat,       // [πBear, πSideways, πBull]
    currentRegime: current,
    regimeName: REGIME_NAMES[current],
  }
}
