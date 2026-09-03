import React from 'react'

const universeItems = [
  ['Include', 'Chooses whether the scan covers stocks, broad index ETFs, and/or sector and commodity ETFs.'],
  ['Stock universe / Tickers', 'Selects a built-in stock list or a comma-separated custom list. It does not change the ETF lists.'],
  ['Preset', 'Loads a coordinated set of filters. Changing any loaded value makes the setup custom.'],
]

const commonMarketItems = [
  ['Min market cap / ETF min AUM', 'Minimum company equity value or fund assets. These are separate because funds do not have a market capitalization.'],
  ['Min $ volume', 'Minimum average daily share-price × share-volume. Higher values usually lead to more liquid option chains.'],
  ['Lookback', 'Historical trading-day window used for the scanner’s move, volatility, momentum, and relative-strength measurements. It is independent of Target DTE.'],
  ['Target DTE', 'Preferred calendar days to expiration. The scanner selects the nearest listed expiration in its allowed window.'],
]

const commonEventItems = [
  ['Skip earnings inside trade', 'Rejects stocks whose next report falls inside the target trade horizon plus its safety buffer.'],
  ['Skip leveraged / inverse ETFs', 'Removes path-dependent funds whose daily reset, decay, and gaps can distort the strategy.'],
]

const GUIDES = {
  'put-selling': [
    { title: 'Universe', items: universeItems },
    {
      title: 'Setup filters',
      items: [
        ['Min drop / ETF min drop', 'Minimum decline from the 52-week high. Funds use a separate, normally lower threshold.'],
        ['Min stretch / ETF min stretch', 'Minimum volatility-normalized decline. Stretch = recent log-return decline ÷ (prior daily volatility × √Lookback). For example, 1% daily volatility implies a normal 21-day move of about 4.6%, so a roughly 6.9% decline is about 1.5σ. Target DTE does not change it.'],
        ['Max RSI', 'Highest allowed 14-day RSI. Lower values require a more oversold candidate.'],
        ...commonMarketItems,
      ],
    },
    {
      title: 'Put selection and gates',
      items: [
        ['Target delta', 'Absolute delta sought for the short put. It is also a rough assignment-probability anchor.'],
        ['Profitable only', 'For stocks, requires positive trailing earnings; it does not apply to funds.'],
        ['Skip fresh 52-week lows', 'Rejects names still making new lows, where the decline may not have stabilized.'],
        ...commonEventItems,
      ],
    },
  ],
  'covered-call': [
    { title: 'Universe', items: universeItems },
    {
      title: 'Setup filters',
      items: [
        ['Min run / ETF min run', 'Minimum advance over the lookback. Funds use a separate, normally lower threshold.'],
        ['Min stretch / ETF min stretch', 'Minimum advance in standard deviations of the underlying’s own normal move.'],
        ['Min RSI', 'Lowest allowed 14-day RSI. Higher values require a more extended candidate.'],
        ['Min % of range', 'Minimum position between the 52-week low (0%) and high (100%).'],
        ['Small-cap min cap', 'Separate size floor used when a small-cap universe is selected.'],
        ...commonMarketItems,
      ],
    },
    {
      title: 'Call selection and ownership gates',
      items: [
        ['Target delta', 'Delta sought for the short call; it is a rough chance that the call finishes in the money.'],
        ['Min OTM', 'Minimum percentage the short-call strike must sit above the current share price.'],
        ['Only where I hold 100+ shares', 'Requires enough owned shares to cover at least one 100-share call contract.'],
        ['Keep strike above my cost basis', 'Avoids a suggested strike below the portfolio’s average cost per share.'],
        ['Skip fresh 52-week highs', 'Rejects names still breaking out, where upside assignment risk is greatest.'],
        ...commonEventItems,
      ],
    },
  ],
  'bull-put-spread': [
    { title: 'Universe', items: universeItems },
    {
      title: 'Bullish setup',
      items: [
        ['Min / max pullback', 'Allowed stock decline from the recent high; ETFs have their own min/max band.'],
        ['Min / max stretch', 'Allowed volatility-normalized pullback. Stretch = recent log-return decline ÷ (prior daily volatility × √Lookback). For example, 1% daily volatility implies a normal 21-day move of about 4.6%, so a roughly 6.9% decline is about 1.5σ. Target DTE does not change it.'],
        ['Min / max RSI', 'Allowed 14-day RSI band: weak enough to offer premium, but not a falling knife.'],
        ['Require price above 200-day', 'Keeps the long-term trend bullish.'],
        ['Require 50-day above 200-day', 'Requires a confirmed moving-average uptrend.'],
        ['Profitable only', 'For stocks, requires positive trailing earnings.'],
        ['Skip fresh 52-week lows', 'Rejects active breakdowns.'],
        ...commonMarketItems,
        ...commonEventItems,
      ],
    },
    {
      title: 'Spread structure',
      items: [
        ['Short delta', 'Places the higher-strike put that is sold. Lower delta is farther OTM and normally safer.'],
        ['Long delta', 'Places the lower-strike protective put. Lower delta normally creates a wider wing.'],
        ['Min / max width', 'Allowed strike distance as a percentage of spot.'],
        ['Min credit', 'Minimum net credit as a percentage of spread width.'],
        ['Min credit $', 'Minimum net credit in dollars per one-lot. The Conservative preset rejects credits below $40.'],
        ['Min cushion', 'Minimum distance from spot down to the expiration breakeven.'],
        ['Min leg OI', 'Minimum open interest on the thinner of the two option legs.'],
        ['Max slippage', 'Maximum combined bid/ask cost as a percentage of the entry credit.'],
      ],
    },
  ],
  'bear-put-spread': [
    { title: 'Universe', items: universeItems },
    {
      title: 'Bearish setup',
      items: [
        ['Min / max stretch', 'Allowed decline in standard deviations: enough to confirm a break, but not a finished crash.'],
        ['Min / max RSI', 'Momentum band that rejects both unbroken strength and deeply washed-out bounce risk.'],
        ['Min vs market / ETF min vs market', 'Minimum beta-adjusted underperformance. Funds have a separate threshold.'],
        ['Max drawdown', 'Rejects names already too far below their 52-week high.'],
        ['Min above low', 'Requires room below the current price before the 52-week low caps the thesis.'],
        ['Small-cap min cap', 'Separate size floor when a small-cap universe is selected.'],
        ['Require price below 50-day', 'Requires the first moving-average trend break.'],
        ['Require 50-day below 200-day', 'Requires a confirmed longer-term downtrend.'],
        ['Skip fresh 52-week lows', 'Avoids paying peak downside volatility after most of the move has happened.'],
        ...commonMarketItems,
        ...commonEventItems,
      ],
    },
    {
      title: 'Spread structure',
      items: [
        ['Long delta', 'Places the higher-strike put that is bought; 0.50 is approximately at the money.'],
        ['Short delta', 'Places the lower-strike put that is sold to finance the trade and cap its payoff.'],
        ['Max debit', 'Maximum entry debit as a percentage of spread width.'],
        ['Min R:R', 'Minimum maximum-profit ÷ maximum-loss ratio.'],
        ['Max move needed', 'Largest allowed move to the short strike in expected-move standard deviations.'],
      ],
    },
  ],
  'bear-call-spread': [
    { title: 'Universe', items: universeItems },
    {
      title: 'Rejected-rally setup',
      items: [
        ['Min / max rally', 'Allowed bounce in standard deviations: large enough to reject, but not a momentum thrust.'],
        ['Max vs market / ETF max vs market', 'Maximum beta-adjusted relative strength; leaders are excluded.'],
        ['Min / max RSI', 'Momentum band for a rally that is rolling over rather than already washed out or still surging.'],
        ['Max acceleration', 'Maximum recent five-day improvement versus the preceding five days.'],
        ['Max run off low', 'Rejects squeeze-like rallies already far above the 20-day low.'],
        ['Max % of range', 'Maximum position in the 52-week range so overhead supply still exists.'],
        ['Require a rolled-over high', 'Requires the recent rally to fail below its 20-day high.'],
        ['Require resistance overhead', 'Requires an identifiable moving average or swing-high ceiling.'],
        ['Place strike above resistance', 'Prefers a short call above the identified ceiling, not only near target delta.'],
        ['Require price below 50-day / 50-day below 200-day', 'Optional moving-average confirmation of a broken or established downtrend.'],
        ['Skip fresh 52-week highs', 'Rejects names with no demonstrated overhead ceiling.'],
        ['Small-cap min cap', 'Separate size floor used for small-cap universes because takeover gaps are short-call risks.'],
        ...commonMarketItems,
        ...commonEventItems,
      ],
    },
    {
      title: 'Spread structure',
      items: [
        ['Short delta', 'Places the lower-strike call that is sold. Lower delta is farther OTM.'],
        ['Long delta', 'Places the higher-strike protective call that caps the loss.'],
        ['Min strike OTM', 'Minimum percentage the short strike must sit above spot.'],
        ['Min credit', 'Minimum net credit as a percentage of spread width.'],
        ['Min cushion', 'Minimum distance from spot up to the expiration breakeven.'],
        ['Min open interest', 'Minimum OI on the thinner option leg.'],
        ['Max slippage', 'Maximum combined bid/ask cost as a percentage of the credit.'],
      ],
    },
  ],
  'iron-condor': [
    { title: 'Universe', items: universeItems },
    {
      title: 'Range and volatility setup',
      items: [
        ['Max efficiency', 'Maximum net distance ÷ total path length. Lower values indicate more back-and-forth movement.'],
        ['Max drift', 'Maximum absolute net move over the lookback in standard deviations.'],
        ['Max variance ratio', 'Below 1 suggests mean reversion; above 1 suggests moves compound into a trend.'],
        ['Max MA slope', 'Maximum absolute slope of the 20- or 50-day average.'],
        ['Min / max RSI', 'Allowed neutral-momentum band.'],
        ['Max relative strength', 'Maximum absolute beta-adjusted leadership; a condor wants neither direction to dominate.'],
        ['Min / max range position', 'Allowed location within the observed range, where 0% is the low and 100% the high.'],
        ['Skip fresh 52-week extremes', 'Rejects new highs and new lows because either tail can break the condor.'],
        ...commonMarketItems,
        ...commonEventItems,
      ],
    },
    {
      title: 'Four-leg structure',
      items: [
        ['Short delta', 'Targets both sold strikes. Lower values place them farther from spot.'],
        ['Long delta', 'Targets both protective wings.'],
        ['Min / max width', 'Allowed width of each vertical as a percentage of spot.'],
        ['Min credit', 'Minimum total credit as a percentage of the wider wing.'],
        ['Min cushion', 'Minimum nearer-breakeven distance in expected-move standard deviations.'],
        ['Min OTM', 'Minimum raw distance from spot to either short strike.'],
        ['Max wing skew', 'Largest allowed percentage difference between put- and call-wing widths.'],
        ['Max delta gap', 'Largest allowed difference between the absolute deltas of the two short strikes.'],
        ['Min leg OI', 'Minimum open interest on the least-liquid of all four legs.'],
        ['Max slippage', 'Maximum sum of all four bid/ask spreads as a percentage of net credit.'],
      ],
    },
  ],
  'put-condor': [
    {
      title: 'Side, underlying, and debit-spread placement',
      items: [
        ['Condor side', 'Runs the Put Condor, the mirrored Call Condor, or both. Both mode keeps the four-leg results separate and also calculates an eight-leg combined expiration payoff for shared expirations.'],
        ['Underlying', 'Chooses Mini-SPX (^XSP on Yahoo) or SPY. The selected symbol is the only chain scanned.'],
        ['Debit-spread placement', 'Places the debit long near spot: below spot for a Put Condor and above spot for a Call Condor.'],
        ['Debit spread OTM', 'When Slightly out of the money is selected, sets the target distance away from spot on the selected side.'],
        ['Fixed 1-point width', 'The debit long and short must be exactly one point apart. The scanner does not relax this construction rule.'],
        ['Target / Minimum / Maximum DTE', 'Selects nearby listed expirations around the preferred calendar days while enforcing the hard date bounds.'],
        ['Results', 'Maximum number of qualifying expirations returned. At most one best construction is shown per expiration.'],
      ],
    },
    {
      title: 'Credit and maximum-risk construction',
      items: [
        ['Maximum risk', 'Hard maximum expiration loss in dollars for each four-leg condor. Candidate credit wings that exceed it are rejected. In Both mode, this budget applies independently to each side.'],
        ['Credit short delta', 'Places the short option in the farther credit spread at the selected 10–20 delta target. The closest valid listed strike is used.'],
        ['Target line credit', 'Preferred positive expiration payoff on the untested side: above all puts or below all calls. Ranking aims for this small credit after first using the risk budget closely.'],
        ['Maximum line credit', 'Largest net credit that still qualifies as a slight untested-side line credit. Zero-credit and net-debit structures are always rejected.'],
        ['Automatic protective long', 'After placing the credit short at the selected delta, the scanner chooses the farther protective long and credit-spread width. Its width, the 1-point debit benefit, and the opening credit determine maximum loss.'],
        ['Risk utilization', 'Calculated maximum loss divided by the selected risk ceiling. It can be below 100% when listed strikes or current premiums do not permit a closer fit.'],
        ['Minimum leg OI', 'Minimum open interest required at each of the four strikes for an actionable result.'],
      ],
    },
    {
      title: 'Reading each trade',
      items: [
        ['Expiration outcomes', 'A Put Condor has downside risk and a positive upper line; a Call Condor mirrors it with upside risk and a positive lower line. The 1-point debit spread creates each side’s maximum-profit shelf.'],
        ['Combined payoff', 'For matching expirations, Both mode calculates profit and loss from all eight legs at the downside tail, middle, upside tail, and each side’s peak. It does not add two peaks that cannot occur at the same underlying price.'],
        ['Natural market', 'Uses sell bids and buy asks across all four legs. A mid-price credit with a non-credit natural market is labeled review-only.'],
        ['Probability cards', 'Show modeled touches and terminal probabilities from current IV, plus profitable-close estimates at halfway and two-thirds of original DTE.'],
        ['Risk graph / Save trade', 'Sends the exact four strikes and current mid prices to Strategy Lab or saves them for tracking.'],
      ],
    },
  ],
  'unbalanced-put-condor': [
    {
      title: 'Universe and expiration',
      items: [
        ['Tickers', 'Comma-separated underlyings to scan.'],
        ['Short-delta pair', 'Chooses the front/back short-put delta targets: 15/5, 20/10, 25/15, or all three.'],
        ['Target DTE', 'Preferred days to expiration. The default is 160 DTE.'],
        ['Minimum / Maximum DTE', 'Hard calendar-day bounds for eligible listed expirations.'],
      ],
    },
    {
      title: 'Widths, quantities, and delta',
      items: [
        ['Bought width', 'Strike width of the upper long-put/short-put debit vertical.'],
        ['Sold width', 'Strike width of the lower short-put/long-put credit vertical.'],
        ['Bought / Sold qty', 'Contract ratio between the upper debit vertical and lower credit vertical.'],
        ['Target net Δ', 'Desired total position delta in one-share equivalents; positive is bullish and negative bearish.'],
        ['Net Δ tolerance', 'Maximum allowed difference between actual and target position delta.'],
        ['Leg Δ tolerance', 'Maximum allowed miss from either selected short-leg delta target.'],
        ['Width tolerance', 'Maximum percentage miss when listed strikes cannot exactly match the requested widths.'],
        ['Minimum leg OI', 'Minimum open interest required on every one of the four legs.'],
        ['Require upper-tail credit', 'Requires the flat payoff above the front long strike to begin with a net credit.'],
        ['Quick delta lean / quantity ratio', 'Buttons that load common target-delta and contract-ratio combinations.'],
      ],
    },
    {
      title: 'Upside-only adjustment mechanics',
      items: [
        ['When it is eligible', 'Only after price has moved up and away from every put strike while the structure remains untested. Do not sell more credit spreads while price is falling toward the trade.'],
        ['How the upper line rises', 'Additional sold put credit spreads add net credit. Above the upper long, every put expires worthless, so that added credit raises the upper expiration-line payoff dollar for dollar before costs.'],
        ['Why it becomes more bullish', 'More short put spreads add positive delta. They can also add positive theta, but increase short-gamma exposure and make a downside reversal more damaging.'],
        ['Quantity-ratio change', 'The adjustment increases the sold-spread quantity without increasing the purchased-spread quantity—for example, a 5:10 package may become 5:11. Recalculate the whole package rather than judging the new spread alone.'],
        ['Risk exchanged for credit', 'Each added credit spread usually worsens the lower flat and maximum loss, consumes buying power, and adds assignment, liquidity, and gap risk. Raising the upper line is not the same as locking in profit.'],
        ['Required recheck', 'Verify the adjusted upper line, center maximum, lower flat, net delta, theta, maximum loss, buying power, bid/ask execution, and every probability card. Use the smallest size that reaches the intended upper-line or delta target.'],
        ['If price reverses', 'A move back down toward the puts invalidates the reason for adding bullish exposure. Reduce or close according to the risk plan instead of selling progressively more spreads.'],
      ],
    },
  ],
  'double-hedge-put-butterfly': [
    {
      title: 'Underlying and documented structure',
      items: [
        ['Tickers', "Comma-separated liquid index ETFs. SPY, QQQ, and IWM are the smaller-scale defaults; they adapt the document's SPX structure without pretending the products have identical notional exposure."],
        ['STFS market bias', 'Applies the documented per-tranche delta band: bearish −3 to −1, neutral −1 to +1, or bullish +1 to +3 share equivalents.'],
        ['Target / Minimum / Maximum DTE', 'Selects the standard monthly nearest 200 DTE inside the document’s 160–230 DTE range. Weekly expirations are excluded.'],
        ['Upper-long qty', 'Scales the full 1/−2/+2 contract ratio. The default 4 produces 4 upper longs, 8 body shorts, and 8 lower longs.'],
        ['Leg Δ tolerance', 'Maximum miss from the 25-delta upper long, 15-delta body, and 2.5-delta lower hedge. The lower strike is also shifted to fit the STFS bias.'],
        ['Min lower-wing ratio', 'Requires the body-to-lower-long strike distance to remain wider than the upper-long-to-body distance.'],
        ['Minimum leg OI', 'Minimum open interest on each of the three unique strikes.'],
      ],
    },
    {
      title: 'Entry trio and upper line',
      items: [
        ['Minimum theta', 'Minimum complete-tranche ATM theta in dollars per day. The document’s default is greater than +$10.'],
        ['Minimum T+0 −20%', 'Lowest acceptable modeled P/L after an immediate 20% underlying decline. The document’s default floor is −$10,000 per base tranche.'],
        ['UEL tolerance', 'Preferred dollar distance of the upper expiration line from $0. This ranks entry quality and warns; it is not a mathematical loss limit.'],
        ['T+0 −15% diagnostic', 'Shows the modeled mark emphasized for option-buying-power monitoring. Broker portfolio-margin scenarios and the full account still govern actual buying power.'],
        ['Expiration geometry', 'Shows the upper flat, body peak, lower-strike loss valley, and the recovering crash tail created by the doubled lower hedge.'],
      ],
    },
    {
      title: 'Entry monitors and campaign state',
      items: [
        ['Structure-price / Concavity / Skew monitor', 'Manual favorable, unfavorable, or unconfirmed states from the document’s historical blue/green and magenta/red monitors. A current chain snapshot cannot reproduce their historical standard-deviation signals.'],
        ['Current-chain context', 'Body richness versus a linear interpolation of the long strikes and the current put-skew slope are displayed as transparent diagnostics, separate from the historical monitor states.'],
        ['Warning signals', 'Count from the document’s OBV, ATR, STFS, Force Index, and term-structure monitor. Four or five active warnings prohibit a new tranche.'],
        ['Awaiting 8/34 all-clear', 'After a four- or five-warning event, keep this checked until a bullish 8/34 EMA crossover occurs on the 30-minute chart.'],
        ['Campaign capital / Capital per tranche / Open tranches', 'Enforces the document’s campaign-capacity ceiling. The default $150,000 ÷ $12,500 permits at most 12 open tranches.'],
        ['LPTA context', 'At four warnings, the document calls for one roughly 30-DTE 2-delta long put per three open tranches; at five warnings, two. Reassess coverage at 7 DTE.'],
        ['Fixed and theta references', 'Shows the $1,000 target, roughly $800 expected profit, $2,500 management loss, 12-week average holding period, $20,000 learning reserve, and appendix 120×/71× theta references. The document favors conservative tiered fixed targets rather than theta alone.'],
      ],
    },
  ],
  'road-trip-butterfly': [
    {
      title: 'Underlying, expiration, and placement',
      items: [
        ['Tickers', 'Comma-separated underlyings. SPY, QQQ, and IWM stand in for the SPX, ES, and RUT the article trades; the shape travels but the notional exposure does not match.'],
        ['Target / Minimum / Maximum DTE', 'The article chooses expirations 70 to 85 days out. Unlike the two STT butterfly screens, weekly expirations are eligible because the model runs on SPX and ES weeklies.'],
        ['Contracts', 'Upper-long count, which sets the whole 1/−2/+1 ratio. Typical sizes are 5x10x5 and 6x12x6; a 2x4x2 works and needs even fewer adjustments.'],
        ['Behind market', 'How far below spot the upper long sits. This is the article’s signature: the highest strike is placed behind the market rather than at it. The SPX example with the index at 2000 uses 1975, or 1.25% back.'],
        ['± tolerance', 'How far the upper long may drift from that placement before the candidate is rejected.'],
        ['Upper wing / Lower wing', 'Wing widths as a percentage of spot. The example’s 45 and 55 points on a 2000 index are 2.25% and 2.75%. The lower wing must be the wider one, which is what makes the wing broken.'],
        ['Wing ± tolerance', 'How far the wings may stray from those targets. Widen it when the debit rule cannot be satisfied at the example widths.'],
        ['Min wing ratio', 'Requires the lower wing to stay wider than the upper wing. Values above 1 preserve the broken wing.'],
        ['Minimum leg OI', 'Minimum open interest on each of the three unique strikes.'],
      ],
    },
    {
      title: 'The price rule and structure gates',
      items: [
        ['Max debit / margin', 'The article’s governing rule: the entry debit must be under 5% of initial margin, its own example being 487 / 12,732 = 3.8%. An expensive entry makes upside profitability too hard to reach later.'],
        ['How margin is computed', 'Initial margin is the broken-wing downside risk — (lower wing − upper wing) × 100 × contracts — plus the debit paid. It is the same number the profit target and stop are percentages of.'],
        ['When placement and price conflict', 'The price rule wins. A narrow broken wing risks little, so its margin base is small and its debit ratio is very sensitive, while a wider lower wing raises margin and cheapens the lower long at once. Expect a wider gap than the illustrative 45/55.'],
        ['Market bias', 'Net delta band in share equivalents per butterfly, scaled by contract count. The trade aims to be roughly delta neutral; unlike the STT ladder its strikes do not cancel to zero by construction.'],
        ['Minimum theta', 'Minimum daily theta for the whole position. This is a decay trade, so positive theta at entry is the point.'],
        ['Selection', 'Candidates are chosen on the article’s geometry, not a delta ladder. The deltas the structure lands on are reported rather than targeted.'],
      ],
    },
    {
      title: 'Management, adjustments, and laddering',
      items: [
        ['Profit target low / high', 'Take-profit band as a percentage of capital at risk. The article aims for 7% to 15% per trade.'],
        ['Stop', 'Exit if the loss passes this share of utilized capital. The article uses 4% to 5% and treats such an exit as a good trade, not a failure.'],
        ['Article exit backstop', 'The article plans to be out 15 to 20 days before expiration. The probability cards lead with the earlier halfway-to-two-thirds close window, when the time-value profit zone is broad; this input remains the latest planned exit.'],
        ['Hands-off window', 'The first 21 to 30 days are left alone so theta can work. That is the stretch the trade is named for.'],
        ['Reverse Harvey roll', 'One priced step of the upside adjustment: sell the upper long and buy the next strike down toward the body for a credit, lifting the upper expiration line. Because entry is a debit, that line starts below zero. The managed probability counts prices above the upper long as success because the strategy continues these rolls until the right side is flat or slightly profitable; the unadjusted expiration odds remain disclosed separately.'],
        ['Downside trigger and hedge width', 'A GTC conditional entered in advance at the body strike, where the risk curve turns back down from its peak. It adds a long put debit spread — buy the higher strike, sell below it — whose width is set here as a percentage of spot. Close it at 50–75% of the debit paid so a whipsaw does not cost the whole hedge.'],
        ['Require preferred entry session', 'The article prefers a down day with volatility up, but says timing is not critical, so this is advisory unless checked. Elevation is graded from 20-day realized volatility and its one-year percentile, not from VIX, VVIX, SKEW, or term structure.'],
        ['Open positions / Max concurrent / Entry interval / Days since last', 'The model adds a position every two weeks and runs four or five at once for time diversification. These inputs flag a ladder that is full or an entry that is too soon.'],
      ],
    },
  ],
  'sixty-forty-twenty-fly': [
    {
      title: 'Universe, expiration, and structure',
      items: [
        ['Tickers', 'SPY, QQQ, IWM, and VOO are the defaults. Every ticker uses its own live chain and the same entry gates; VOO is not assumed to have SPY liquidity.'],
        ['Target / Minimum / Maximum DTE', 'Selects the listed expiration nearest 70 DTE inside the supplied 60-80 DTE entry window. Monthly and weekly expirations are both eligible.'],
        ['Fly quantity', 'Scales the complete 1/-2/+1 put structure. One fly buys one upper put, sells two body puts, and buys one lower put.'],
        ['Leg delta tolerance', 'Maximum miss from the absolute 60-delta upper long, 40-delta body short, and 20-delta lower long targets.'],
        ['Max absolute net delta', 'Maximum share-equivalent delta for the complete position. The target ladder is algebraically neutral: -0.60 + 2(0.40) - 0.20 = 0.'],
      ],
    },
    {
      title: 'Liquidity and entry quality',
      items: [
        ['Minimum leg OI', 'Minimum open interest required at every unique strike. Increase this when you want to exclude thin VOO or other ETF contracts.'],
        ['Max bid/ask width', 'Largest allowed spread as a percentage of the leg mid. Every leg must have a live two-sided quote to be entry-ready; recent-trade estimates are review-only.'],
        ['Delta/theta at entry', 'Absolute complete-position delta divided by positive daily theta. A candidate already at or above the caution threshold is not entry-ready.'],
        ['Ranking', 'Prefers entry-ready structures, then the smallest total delta miss, the smallest net delta, a lower delta/theta ratio, proximity to target DTE, and better liquidity.'],
      ],
    },
    {
      title: 'Monitoring and exit rules',
      items: [
        ['20% delta change', 'Caution band for the original upper-long and body-short contracts. The exact bands are 48-72 delta around the 60-delta leg and 32-48 delta around the 40-delta leg.'],
        ['30% delta change', 'Exit when either original monitored leg reaches its exact 30% boundary: 42/78 delta for the upper long or 28/52 delta for the body. The presentation rounds these to roughly 40-80 and 30-50.'],
        ['Delta/theta caution and exit', 'Defaults to caution above 50% and exit above 60%, matching the supplied 50-60% management range.'],
        ['Mandatory exit', 'Close at 30 DTE regardless of price, P/L, or the other monitors.'],
        ['8- and 14-day reviews', 'Reprices the complete fly at the two illustrated review dates and at 30 DTE with each entry leg IV held constant. These are scenario estimates, not promised returns.'],
        ['Original contracts only', 'Monitor the deltas of the contracts opened at entry. Do not rerun the scanner and substitute newly selected 60- or 40-delta strikes when checking an existing position.'],
      ],
    },
  ],
  'fourteen-day-aic': [
    {
      title: 'Campaign and structure',
      items: [
        ['What this is', 'Amy Meissner’s asymmetrical iron condor (AIC / Weirdor): a put-heavy credit condor with a put debit hedge on from day one, a flatter T+0 line, slightly long delta, and less upside risk than a balanced condor.'],
        ['14-Day vs Monthly', 'The 14-day campaign enters 30–35 DTE and is named for the hold: be out in 14 days or less. The monthly campaign enters 40–50 DTE and plans to exit at 14 DTE remaining.'],
        ['Tickers', 'Index ETFs only. IWM stands in for RUT, the original underlying; SPY, QQQ, and VOO are also eligible.'],
        ['Tranche quantity', 'Scales the whole unit. The 14-day unit is 4 put credits / 1 call credit / 1 put debit; the monthly unit is 10 / 2 / 1.'],
        ['Short put / short call delta', '14-day defaults are 0.25 / 0.12, closer to the money because the hold is short. Monthly defaults are 0.16 / 0.12.'],
        ['Hedge long delta', 'Places the long put of the debit-spread hedge closer to spot than the put credit short. That is the built-in downside hedge from the video.'],
      ],
    },
    {
      title: 'Capital, targets, and exits',
      items: [
        ['Plan capital', 'About $16,000–$18,000 per unit in the source campaign. Profit and stop percentages are measured against this number, not against max loss at expiration.'],
        ['Profit target', '14-day: 2–4% of plan capital. Monthly: 7–8%. Take it when it is there; the video examples were often out in 5–6 days.'],
        ['Management max loss', 'Keep losses smaller than 5% of plan capital.'],
        ['Maximum days in trade', '14-day campaign only. The name is this hold, not 14-DTE options.'],
        ['Exit remaining DTE', 'Monthly campaign only. Default 14 DTE remaining.'],
        ['Net delta', 'The structure is built slightly long. A short net delta is marked review-only.'],
      ],
    },
  ],
  'monthly-aic': [
    {
      title: 'Campaign and structure',
      items: [
        ['What this is', 'The longer AIC campaign from the same video: same pieces as the 14-day trade, entered farther from expiration so there is more time to absorb adjustments.'],
        ['Entry window', '40–50 DTE, typically a monthly cycle. Average time in the trade is about 30 days because the plan is to be out at 14 DTE remaining.'],
        ['Tickers', 'Index ETFs only. IWM / RUT is the original home; SPY, QQQ, and VOO are also eligible.'],
        ['Contract ratio', 'Original unit is 10 put credit spreads, 2 call credit spreads, and 1 put debit hedge. Scale with tranche quantity.'],
        ['Short put / short call delta', 'Defaults 0.16 / 0.12, farther than the 14-day 0.25-delta put short.'],
        ['Hedge long delta', 'Places the debit-spread long put near 0.35 delta as the built-in downside hedge.'],
      ],
    },
    {
      title: 'Capital, targets, and exits',
      items: [
        ['Plan capital', 'Same $16,000–$18,000 per unit as the 14-day campaign, with a $20,000 account cushion in the video.'],
        ['Profit target', '7–8% of plan capital. Take it early when it is available rather than holding to the 14-DTE backstop.'],
        ['Management max loss', 'Keep losses smaller than 5% of plan capital.'],
        ['Exit remaining DTE', 'Planned backstop at 14 DTE remaining. Probability cards also show a halfway review.'],
        ['Net delta', 'Slightly long by construction. A short net delta is marked review-only.'],
      ],
    },
  ],
  'iron-butterfly': [
    {
      title: 'Expiration and strike search',
      items: [
        ['Target / Minimum / Maximum DTE', 'Accepts any target from 1 through 1,095 DTE and compares the nearest listed expirations inside the hard bounds.'],
        ['Expirations', 'Number of nearest listed expirations to compare for each ticker.'],
        ['Body strike', 'Optional exact strike for both the short put and short call. Leave blank to search every strike shared by the put and call chains.'],
        ['Put / Call wing strike', 'Optional exact lower put or upper call strike. Leave blank to search all listed strikes on that side.'],
        ['Min / Max wing width', 'Allowed distance from the shared body strike as a percentage of spot.'],
        ['Wing delta', 'Absolute delta target for both long wings. The delta remains unchanged while farther expirations move the selected strikes farther from the body. Exact wing strikes override it.'],
      ],
    },
    {
      title: 'Entry and risk gates',
      items: [
        ['Min credit', 'Minimum credit as a percentage of the narrower wing. The credit is the maximum profit of the iron butterfly.'],
        ['Max wing skew', 'Largest allowed percentage difference between the put and call wing widths.'],
        ['Target body offset', 'Ranking preference for an off-centre body; it does not reject other body strikes.'],
        ['Max absolute net delta', 'Maximum complete-position delta in share equivalents.'],
        ['Minimum leg OI / Max bid-ask', 'Liquidity gates applied to the least-liquid leg and widest quoted market. Recent-trade estimates remain review-only.'],
      ],
    },
    {
      title: 'Three-strike payoff',
      items: [
        ['Three strikes / four legs', 'Buy the lower put, sell the put and call at the shared body, and buy the upper call.'],
        ['Maximum profit', 'The entry credit, earned when the underlying finishes at the shared body strike.'],
        ['Maximum loss', 'The larger wing width minus the credit, multiplied by contract size and quantity.'],
        ['Breakevens', 'Body strike minus and plus the per-unit credit.'],
        ['Review DTE', 'A DTE-relative management review point. The scanner also models a halfway review and expiration.'],
      ],
    },
  ],
  'unbalanced-butterfly': [
    {
      title: 'Universe and expiration',
      items: [
        ['Tickers', 'Comma-separated underlyings to scan. Use the market-data symbol expected by Yahoo Finance, such as SPY or ^SPX.'],
        ['Upper-long delta', 'Scans a 20-delta upper long, the course-original 25-delta upper long, or both as separate candidates.'],
        ['Market bias', 'Applies the course tranche-delta range: bearish −3 to −1, neutral −1 to +1, or bullish +1 to +3 share equivalents.'],
        ['Target DTE', 'Preferred calendar days to expiration. The default is 160 DTE, matching the Unbalanced Put Condor.'],
        ['Minimum / Maximum DTE', 'Hard bounds for eligible standard monthly expirations. The 120–240 DTE defaults match the Unbalanced Put Condor; weekly expirations are excluded.'],
      ],
    },
    {
      title: 'Structure and course fit',
      items: [
        ['Tranche long qty', 'Quantity of each long-put wing. The body quantity is twice this number, so the course default 4 creates 4/−8/4 contracts.'],
        ['Leg Δ tolerance', 'Maximum miss from the selected upper-long, 15-delta body-short, and balancing lower-long targets.'],
        ['Target theta', 'Preferred complete-tranche daily theta in dollars; the course target is approximately +$20 at entry.'],
        ['Theta tolerance', 'Allowed distance above or below the target theta before the candidate receives a warning.'],
        ['UEL tolerance', 'Maximum preferred dollar distance of the upper expiration line from $0. It is an entry-quality warning, not a risk limit.'],
        ['Min lower-wing ratio', 'Requires the body-to-lower-long wing to be wider than the upper-long-to-body wing. Values above 1 preserve a broken wing.'],
        ['Minimum leg OI', 'Minimum open interest required on each of the three unique strikes.'],
      ],
    },
    {
      title: 'Cards and management',
      items: [
        ['Probability of success / failure', 'Success includes the untested region above the upper long. Inside the structure it follows the time-evolved, $0-or-better modeled profit tent; failure is the exact downside complement at the halfway review, two-thirds review, and expiration.'],
        ['Time-evolution card', 'Reprices the complete butterfly at the halfway review, two-thirds review, and expiration. It shows success/failure plus modeled P/L if price is unchanged, at the upper long, and at the body/tent peak.'],
        ['Reach / never touches', 'First-passage probability that price reaches the upper long, plus its complement, over the same halfway and two-thirds management windows and through expiration.'],
        ['Body and lower-tail risk', 'Shows the chance of touching or finishing below the double-short body and lower long.'],
        ['Course targets', 'Compares the candidate with the $1,000 profit target, $2,000 management loss limit, roughly 16-week course harvest expectation, near-zero UEL, and +$20 theta goal. The probability checkpoints still match the Condor.'],
        ['When narrowing is eligible', 'Only after price has moved up and away from the butterfly, leaving every put farther out of the money. Never narrow the front wing while price is falling toward or into the structure.'],
        ['How narrowing raises the UEL', 'A net-credit roll that reduces the distance between the upper long and double-short body adds cash to the position. Above the upper long, the puts expire worthless, so the added net credit raises the upper expiration line before costs.'],
        ['Why narrowing is bullish', 'Moving the front strikes closer together reduces put protection or adds short-put exposure, shifting the complete position toward positive delta. The exact Greek change depends on which front leg is rolled.'],
        ['Adjustment trade-off', 'The raised upper line is purchased with changed tent geometry and risk: the peak can shrink or move, the downside flat and breakeven can change, and bullish delta, short gamma, slippage, and assignment exposure can rise.'],
        ['Required recheck', 'Reprice the entire adjusted butterfly—not just the rolled leg—and verify the upper line, tent peak, lower flat, breakeven, delta, theta, maximum loss, liquidity, and all success/failure and touch probabilities. Use the smallest qualifying net-credit roll.'],
        ['If price reverses', 'A reversal down toward the puts removes the reason for the adjustment. Reduce or close according to the risk plan rather than repeatedly narrowing and adding bullish exposure.'],
      ],
    },
  ],
}

export default function ScannerParameterGuide({ scanner }) {
  const groups = GUIDES[scanner]
  if (!groups) return null
  return (
    <details style={{
      margin: '0 0 0.75rem',
      padding: '0.65rem 0.85rem',
      background: 'var(--surface-sunken)',
      border: '1px solid var(--border)',
      borderRadius: 6,
    }}>
      <summary style={{
        color: 'var(--accent-bright)',
        cursor: 'pointer',
        fontWeight: 700,
        fontSize: '0.82rem',
      }}>
        Parameter guide
      </summary>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0.6rem 0' }}>
        Open this guide whenever you need the meaning of an input. The scanner&rsquo;s presets set these
        controls together; changing a value only changes the filter or structure described below.
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
        gap: '0.75rem',
      }}>
        {groups.map(group => (
          <section
            key={group.title}
            style={{
              padding: '0.65rem 0.75rem',
              background: 'var(--surface-inset)',
              borderRadius: 5,
              border: '1px solid var(--border)',
            }}
          >
            <h3 style={{ color: 'var(--text-strong)', fontSize: '0.78rem', margin: '0 0 0.45rem' }}>
              {group.title}
            </h3>
            <dl style={{ margin: 0, display: 'grid', gap: '0.45rem' }}>
              {group.items.map(([name, description]) => (
                <div key={name}>
                  <dt style={{ color: 'var(--text-strong)', fontSize: '0.72rem', fontWeight: 700 }}>
                    {name}
                  </dt>
                  <dd style={{ color: 'var(--text-muted)', fontSize: '0.7rem', margin: '0.1rem 0 0', lineHeight: 1.4 }}>
                    {description}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </details>
  )
}
