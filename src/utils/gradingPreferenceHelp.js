const riskMetricDefinitions = {
  ulcerIndex: 'Ulcer Index measures both the depth and the duration of drawdowns; a smaller value means losses have generally been shallower or recovered more quickly.',
  calmar: 'The Calmar ratio divides annualized return by the absolute maximum drawdown, so it asks how much return was earned for the worst peak-to-trough loss.',
  omega: 'The Omega ratio compares the sum of daily gains with the sum of daily losses. Values above 1 mean gains outweighed losses over the selected period.',
  sortino: 'The Sortino ratio measures excess return per unit of downside deviation. Unlike Sharpe, it does not penalize upside volatility.',
  sharpe: 'The Sharpe ratio measures excess return per unit of total volatility, using the application risk-free-rate assumption.',
  maxDrawdown: 'Maximum drawdown is the largest peak-to-trough percentage loss observed during the selected grading period.',
  downCapture: 'Downside capture compares the holding or portfolio with its benchmark on benchmark down days. Below 100 means it lost less than the benchmark; lower is better.',
  diversification: 'Diversification uses effective holdings, calculated from position concentration. A portfolio with equally sized positions scores near its actual holding count, while large concentrations reduce the effective count.',
  navHealth: 'NAV Health measures portfolio-weighted NAV erosion for holdings where that data is available. It is omitted when the portfolio has no usable NAV-erosion evidence.',
}

const relativeWeightHelp = (scope, key) => (
  `${riskMetricDefinitions[key]} This relative weight controls how much it contributes to the ${scope} risk score compared with the other available metrics. `
  + 'Increasing it makes this metric influence the final numeric score more; decreasing it reduces that influence, and 0 excludes it. Available non-zero weights are normalized automatically, so they do not need to total 100.'
)

const higherTierMeaning = {
  excellent: 'Values at or above this boundary receive 100 points.',
  good: 'This is the start of the good band: the boundary receives 80 points, with results interpolated up to 100 at the excellent boundary.',
  fair: 'This is the start of the fair band: the boundary receives 60 points, with results interpolated up to 80 at the good boundary.',
  poor: 'This is the start of the poor band: the boundary receives 40 points, while still-lower results fall below 40 toward zero.',
}

const lowerTierMeaning = {
  excellent: 'Values at or below this boundary receive 100 points.',
  good: 'This is the upper end of the good band: the boundary receives 80 points, with results interpolated up to 100 at the excellent boundary.',
  fair: 'This is the upper end of the fair band: the boundary receives 60 points, with results interpolated up to 80 at the good boundary.',
  poor: 'This is the upper end of the poor band: the boundary receives 40 points, while still-higher results fall below 40 toward zero.',
}

const higherBandHelp = (metric, tier) => (
  `${riskMetricDefinitions[metric]} ${higherTierMeaning[tier]} Raising this cutoff makes that tier harder to reach and normally lowers scores near the boundary; lowering it makes the tier easier to reach. `
  + 'Keep Excellent, Good, Fair, and Poor in descending order.'
)

const lowerBandHelp = (metric, tier) => (
  `${riskMetricDefinitions[metric]} ${lowerTierMeaning[tier]} Lowering this cutoff makes that tier harder to reach and normally lowers scores near the boundary; raising it makes the tier easier to reach. `
  + 'Keep Excellent, Good, Fair, and Poor in ascending order.'
)

const letterLabels = {
  aPlus: 'A+', a: 'A', aMinus: 'A−',
  bPlus: 'B+', b: 'B', bMinus: 'B−',
  cPlus: 'C+', c: 'C', cMinus: 'C−',
  dPlus: 'D+', d: 'D', dMinus: 'D−',
}

const letterCutoffHelp = Object.fromEntries(Object.entries(letterLabels).map(([key, label]) => [
  key,
  `This is the minimum 0–100 risk score required for a ${label}. Raising it makes ${label} harder to earn; lowering it awards ${label} to more results. `
    + 'It changes the displayed letter only—the underlying metric scores and weighted numeric score stay the same. Cutoffs must remain in descending grade order; a score below the D− cutoff receives F.',
]))

const groupWeightHelp = {
  valuation: 'Controls the influence of the Valuation group in the stock Fundamental composite. That group averages sector-relative P/E, forward P/E, PEG, price/book, price/sales, and EV/EBITDA scores that are available. Increase it to make valuation matter more; set it to 0 to exclude valuation.',
  profitability: 'Controls the influence of the Profitability group in the stock Fundamental composite. The group averages available net, operating, and gross margins plus return on equity and assets. Increase it to favor profitable businesses more strongly; set it to 0 to exclude the group.',
  growth: 'Controls the influence of the Growth group in the stock Fundamental composite. It uses available revenue growth, earnings growth, and an EPS-quality score. Increase it to make growth matter more; set it to 0 to exclude the group.',
  health: 'Controls the influence of the Balance-sheet group in the stock Fundamental composite. It uses debt/equity, current ratio, and payout ratio when available. Increase it to emphasize financial resilience; set it to 0 to exclude the group.',
  trend: 'Controls the influence of the moving-average Trend card in the stock Technical composite. Increase it to make the price-versus-SMA state matter more; set it to 0 to exclude that card.',
  momentum: 'Controls the influence of the Momentum card in the stock Technical composite. That card averages MACD and RSI signal points. Increase it to make those two momentum readings matter more; set it to 0 to exclude the card.',
  oscillators: 'Controls the influence of the Oscillators card in the stock Technical composite. That card averages slow-stochastic and Awesome Oscillator signal points. Increase it to make those readings matter more; set it to 0 to exclude the card.',
  volume: 'Controls the influence of the Volume/range card in the stock Technical composite. That card averages the OBV signal with the 52-week-range score when both exist. Increase it to emphasize accumulation and price location; set it to 0 to exclude the card.',
}

const fundamentalBandHelp = {
  lowerExcellent: 'For lower-is-better fundamentals—valuation multiples, debt/equity, and payout ratio—this is the largest result that earns the Excellent point value, expressed as a multiple of the sector benchmark. Raising it makes Excellent easier to earn; lowering it makes Excellent stricter.',
  lowerGood: 'For lower-is-better fundamentals, this is the largest benchmark multiple that earns the Good point value. Results above the Excellent boundary and at or below this value are Good. Raising it widens the Good-or-better area; lowering it makes the comparison stricter.',
  lowerFair: 'For lower-is-better fundamentals, this is the largest benchmark multiple that earns the Lower/fair point value. Raising it lets more expensive or more leveraged results remain Fair; lowering it moves more results into Weak or Poor.',
  lowerWeak: 'For lower-is-better fundamentals, this is the largest benchmark multiple that earns the Lower/weak point value. A result above it receives the Poor point value. Raising it makes Poor less common; lowering it makes the final failure boundary stricter.',
  higherExcellent: 'For higher-is-better fundamentals—margins, returns, growth, and current ratio—this is the smallest result that earns the Excellent point value, expressed as a multiple of the sector benchmark. Raising it makes Excellent harder to earn; lowering it makes Excellent easier.',
  higherGood: 'For higher-is-better fundamentals, this is the smallest benchmark multiple that earns the Good point value. Results below Excellent but at or above this value are Good. Raising it makes Good harder to reach; lowering it widens the Good-or-better area.',
  higherFair: 'For higher-is-better fundamentals, this is the smallest benchmark multiple that earns the Higher/fair point value. Raising it moves more results into Weak or Poor; lowering it allows more below-benchmark results to remain Fair.',
  higherWeak: 'For higher-is-better fundamentals, this is the smallest benchmark multiple that earns the Higher/weak point value. A result below it receives the Poor point value. Raising it makes the failure boundary stricter; lowering it makes Poor less common.',
}

const metricScoreHelp = {
  excellent: 'Points assigned to any sector-relative fundamental metric that lands in its Excellent band, whether lower or higher is better. Increasing this lifts the affected criterion group and Fundamental composite; decreasing it reduces the reward for Excellent results.',
  good: 'Points assigned to any sector-relative fundamental metric that lands in its Good band. Increasing it lifts groups containing Good results; decreasing it creates a larger score gap between Good and Excellent.',
  lowerFair: 'Points assigned to a lower-is-better metric in its Fair band, such as a valuation multiple modestly above its sector benchmark. Increasing it is more forgiving of these results; decreasing it penalizes them more heavily.',
  lowerWeak: 'Points assigned to a lower-is-better metric in its Weak band. Increasing it softens the penalty for relatively high valuation, leverage, or payout results; decreasing it makes those results pull the Fundamental score down more.',
  higherFair: 'Points assigned to a higher-is-better metric in its Fair band, such as a margin or growth rate modestly below its sector benchmark. Increasing it is more forgiving; decreasing it applies a larger penalty.',
  higherWeak: 'Points assigned to a higher-is-better metric in its Weak band. Increasing it softens the penalty for weak margins, returns, growth, or liquidity; decreasing it makes those readings pull the Fundamental score down more.',
  poor: 'Points assigned when a sector-relative fundamental metric misses its Weak boundary. Increasing it raises the score floor for poor comparisons; decreasing it makes poor metrics more damaging. Certain invalid or negative earnings ratios use a separate fixed red-flag score.',
}

const stockSignalScoreHelp = {
  buy: 'Points given to a Bullish state inside the stock checklist technical cards. Trend, MACD/RSI, stochastic/AO, and OBV states use this value before their card averages are calculated. Raising it boosts the Technical composite when bullish or oversold Bullish readings occur; it does not change how the separate Technical Readings page counts votes.',
  neutral: 'Points given to a Neutral state inside the stock checklist technical cards. Raising it makes inconclusive readings less costly and usually lifts the Technical composite; lowering it demands clearer Bullish signals for a high score. It does not change the separate Technical Readings vote rules.',
  sell: 'Points given to a Bearish state inside the stock checklist technical cards. Raising it makes bearish or overbought readings less damaging; lowering it increases their penalty. It does not change the separate Technical Readings vote rules.',
}

const technicalThresholdHelp = {
  trendBufferPct: 'Defines a neutral zone around the 200-day SMA, or the 50-day SMA when the 200-day value is unavailable. Price above +this percentage is Bullish, below −this percentage is Bearish, and inside the band is Neutral. Increasing it creates more Neutral readings; decreasing it makes small moves trigger Bullish or Bearish sooner.',
  rsiBuyBelow: 'A 14-day RSI strictly below this value is classified Bullish (oversold) in the stock checklist. Raising it makes Bullish easier to trigger; lowering it requires a more deeply oversold reading. It must stay below the RSI Bearish boundary.',
  rsiSellAbove: 'A 14-day RSI strictly above this value is classified Bearish (overbought) in the stock checklist. Lowering it makes Bearish easier to trigger; raising it requires a more extreme overbought reading. It must stay above the RSI Bullish boundary.',
  stochasticBuyBelow: 'Both slow-stochastic %K and %D must be strictly below this value for a Bullish state in the stock checklist. Raising it creates more Bullish readings; lowering it requires a more deeply oversold setup.',
  stochasticSellAbove: 'Both slow-stochastic %K and %D must be strictly above this value for a Bearish state in the stock checklist. Lowering it creates more Bearish readings; raising it requires a more extremely overbought setup.',
  obvNeutralBandPct: 'Defines the neutral band for the 20-day On-Balance Volume trend. OBV growth above +this percentage is Bullish, below −this percentage is Bearish, and inside the band is Neutral. Increasing it filters out small volume trends; decreasing it makes the signal more sensitive.',
}

const rangeBandMeaning = {
  best: 'the Best range-score tier',
  good: 'the Good range-score tier',
  fair: 'the Fair range-score tier',
  weak: 'the Weak range-score tier',
}

const rangeBandHelp = Object.fromEntries(Object.entries(rangeBandMeaning).map(([key, tier]) => [
  key,
  `This is the highest allowed position within the 52-week low-to-high range for ${tier}; 0% is the low and 100% is the high. Raising this boundary lets prices farther from the low qualify for this tier, while lowering it makes the tier stricter. `
    + 'The four boundaries must remain in ascending order, and a price above the Weak boundary receives the Poor range score.',
]))

const rangeScoreHelp = {
  best: 'Points assigned when the stock is at or below the Best 52-week-range boundary. Raising the points rewards entries near the yearly low more strongly; lowering them reduces that advantage.',
  good: 'Points assigned when the stock is above the Best boundary but at or below the Good boundary. Raising the points improves the Volume/range card for stocks in this portion of the range; lowering them penalizes those entries more.',
  fair: 'Points assigned when the stock is above the Good boundary but at or below the Fair boundary. Raising the points is more tolerant of mid-range prices; lowering them favors entries closer to the yearly low.',
  weak: 'Points assigned when the stock is above the Fair boundary but at or below the Weak boundary. Raising the points softens the penalty for prices nearer the yearly high; lowering them makes those entries less attractive.',
  poor: 'Points assigned when the stock is above the Weak boundary, nearest the upper end of its 52-week range. Raising the points makes high-range entries less damaging; lowering them applies a stronger timing penalty.',
}

const dashboardWeightDefinitions = {
  ao: 'the Awesome Oscillator vote, which considers its zero-line position and direction',
  rsi: 'the 14-day RSI overbought/oversold vote',
  macd: 'the MACD-line versus signal-line vote',
  sma50: 'the price-versus-50-day-SMA vote',
  sma200: 'the price-versus-200-day-SMA vote',
  nav: 'the NAV-erosion vote, which is active only for eligible income-fund structures',
}

const dashboardWeightHelp = Object.fromEntries(Object.entries(dashboardWeightDefinitions).map(([key, description]) => [
  key,
  `This is the relative weight of ${description} in the Technical Readings page Overall result. Increasing it gives that vote more power to produce Bullish or Bearish; decreasing it reduces its influence, and 0 disables it. `
    + 'Only active, available votes are included in the denominator, and weights are normalized automatically rather than needing to total 100.',
]))

export const GRADING_PREFERENCE_HELP = {
  portfolioRisk: {
    letterCutoffs: letterCutoffHelp,
    holdingWeights: Object.fromEntries(
      Object.keys(riskMetricDefinitions).filter(key => !['diversification', 'navHealth'].includes(key)).map(key => [key, relativeWeightHelp('individual holding', key)]),
    ),
    portfolioWeights: Object.fromEntries(
      Object.keys(riskMetricDefinitions).map(key => [key, relativeWeightHelp('whole-portfolio', key)]),
    ),
    higherBands: Object.fromEntries(
      ['calmar', 'omega', 'sortino', 'sharpe', 'diversification'].map(metric => [
        metric,
        Object.fromEntries(Object.keys(higherTierMeaning).map(tier => [tier, higherBandHelp(metric, tier)])),
      ]),
    ),
    lowerBands: Object.fromEntries(
      ['ulcerIndex', 'maxDrawdown', 'downCapture'].map(metric => [
        metric,
        Object.fromEntries(Object.keys(lowerTierMeaning).map(tier => [tier, lowerBandHelp(metric, tier)])),
      ]),
    ),
    navHealth: {
      fullScore: 'This is the NAV Health score assigned when portfolio-weighted NAV erosion is flat or positive, before any decline penalty. Raising it increases NAV Health’s contribution to the portfolio grade; lowering it caps that component below the usual 100-point ceiling. The final NAV Health score cannot fall below 0.',
      penaltyPerDeclinePct: 'For each percentage point of portfolio-weighted NAV decline, this many points are subtracted from the NAV Health full score. Increasing it makes NAV erosion damage the portfolio grade faster; decreasing it makes the grade more tolerant. For example, a value of 2 subtracts 20 points for a 10% decline.',
    },
  },
  fundVerdicts: {
    strongScore: 'Minimum checklist composite required for the final Strong reading label on ETF, CEF, and option-income evaluators. Raising it makes Strong reading harder to earn; lowering it makes the label easier. The weak-criteria limit must also be satisfied, and this setting does not change any individual criterion score.',
    moderateScore: 'Minimum checklist composite required for the final Partial reading label when Strong reading is not earned. Raising it sends more funds to Low reading; lowering it lets more funds qualify as Partial reading. The moderate weak-criteria limit must also be satisfied.',
    strongMaxFails: 'Maximum number of scored criteria carrying a fail badge that a fund may have and still receive Strong reading. Raising it is more permissive of serious weak spots; lowering it is stricter. The composite must still meet the Strong score threshold.',
    moderateMaxFails: 'Maximum number of scored criteria carrying a fail badge that a fund may have and still receive Partial reading. Raising it is more permissive; lowering it sends more otherwise adequate composites to Low reading. This value cannot be stricter than the Strong reading failure limit.',
  },
  stock: {
    blendWeights: {
      fundamental: 'Relative influence of the Fundamental composite in the stock’s final 0–100 score. Increase it to make valuation, profitability, growth, and balance-sheet quality matter more than chart signals; decrease it to emphasize technical timing. The two blend weights are normalized, and a missing side leaves the available side to determine the score.',
      technical: 'Relative influence of the Technical composite in the stock’s final 0–100 score. Increase it to make trend, momentum, oscillators, volume, and range position matter more; decrease it to emphasize company fundamentals. The two blend weights are normalized, and a missing side leaves the available side to determine the score.',
    },
    groupWeights: groupWeightHelp,
    badgeBands: {
      pass: 'Minimum numeric score for a green Pass badge on stock checklist criterion cards. Raising it makes green badges harder to earn; lowering it makes them more common. It changes badge color and explanatory wording, not the criterion’s numeric score or the final verdict thresholds.',
      warn: 'Minimum numeric score for an amber Warn badge on stock checklist criterion cards; lower scores receive a red Fail badge. Raising it makes Fail badges more common, while lowering it makes the display more forgiving. It must stay below the Pass cutoff and does not change numeric scores.',
    },
    fundamentalBands: fundamentalBandHelp,
    metricScores: metricScoreHelp,
    signalScores: stockSignalScoreHelp,
    technicalThresholds: technicalThresholdHelp,
    rangeBands: rangeBandHelp,
    rangeScores: rangeScoreHelp,
    verdictBands: {
      strongBuy: 'Minimum blended stock score required for Strong reading. Raising it makes Strong reading harder to earn; lowering it makes it easier. The Fundamental composite must also meet its separate minimum when fundamental data is available.',
      strongFundamental: 'Minimum Fundamental composite required for Strong reading when fundamental data is available. Raising it prevents technically strong but fundamentally weaker stocks from receiving Strong reading; lowering it makes that safeguard more permissive. It does not affect Favorable reading, Mixed reading, or a technical-only result.',
      buy: 'Minimum blended stock score required for Favorable reading when Strong reading is not earned. Raising it moves more stocks to Mixed reading or Low reading; lowering it awards Favorable reading more readily. Keep it below the Strong reading threshold and above the Mixed reading threshold.',
      hold: 'Minimum blended stock score required for Mixed reading when Favorable reading is not earned. Raising it makes Low reading more common; lowering it allows weaker scores to remain Mixed reading. Any score below this boundary receives Low reading.',
    },
  },
  signals: {
    thresholds: {
      aoZeroBuffer: 'Minimum Awesome Oscillator distance from zero used by Technical Readings. AO must be above the positive buffer and rising for Bullish, or below the negative buffer and falling for Bearish; otherwise it is Neutral. Increasing the buffer filters out weak momentum and creates more Neutral votes; decreasing it makes AO more sensitive.',
      rsiBuyBelow: 'A 14-day RSI strictly below this value casts a Bullish vote on Technical Readings. Raising it makes Bullish votes more frequent; lowering it requires a more deeply oversold reading. It must remain below the dashboard RSI Bearish boundary.',
      rsiSellAbove: 'A 14-day RSI strictly above this value casts a Bearish vote on Technical Readings. Lowering it makes Bearish votes more frequent; raising it requires a more extremely overbought reading. It must remain above the dashboard RSI Bullish boundary.',
      smaBufferPct: 'Defines the same neutral percentage band around both the 50-day and 200-day simple moving averages. Price above +this band votes Bullish, below −this band votes Bearish, and inside it votes Neutral. Increasing it filters small deviations and creates more Neutral votes; decreasing it makes both SMA votes more responsive.',
      majorityPct: 'Percentage of all active vote weight that Bullish or Bearish must exceed to become the Overall Technical Readings result. Raising it demands stronger agreement and creates more Neutral results; lowering it allows a smaller coalition to decide the reading. At 50, one side must hold a true weighted majority, not merely tie.',
      navBuyMaxRatio: 'Highest NAV-erosion ratio that casts a Bullish vote for an eligible income fund. The ratio compares qualifying price/NAV decline with trailing distribution yield, so lower means less erosion relative to income paid. Raising it labels more erosion cases Bullish; lowering it reserves Bullish for healthier cases. It must stay below the NAV Bearish boundary.',
      navSellAboveRatio: 'An eligible income fund with a NAV-erosion ratio above this value casts a Bearish vote; ratios between the Bullish and Bearish boundaries are Neutral. Lowering it makes the NAV test more sensitive and produces more Bearish votes; raising it tolerates more erosion. A hard price decline can still force Bearish.',
      navHardDeclinePct: 'Absolute qualifying price-decline percentage that forces the eligible NAV signal to Bearish even when the yield-based erosion ratio would not. Lowering it triggers the safety override sooner; raising it tolerates a deeper decline before the override. It affects only holdings eligible for NAV-erosion analysis.',
      navHardDeficitPct: 'Ending share-deficit percentage that forces NAV erosion severity to High on a backtest, even when the coverage ratio is still in a milder band. The deficit compares shares still held with the share count needed to recover the starting value. Lowering it flags a smaller shortfall; raising it waits for a deeper share gap. Watchlist rows that have no share-deficit figure are not affected by this override.',
    },
    weights: dashboardWeightHelp,
  },
}

export function gradingPreferenceHelp(...path) {
  return path.reduce((current, key) => current?.[key], GRADING_PREFERENCE_HELP) || ''
}
