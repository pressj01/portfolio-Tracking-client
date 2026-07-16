import React, { useState } from 'react'
import OptionPayoffDiagram from '../components/OptionPayoffDiagram'

const TABS = [
  { id: 'first', label: 'First-Order Greeks' },
  { id: 'second', label: 'Second-Order Greeks' },
]

/* ── Curve generators ─────────────────────────────────────────────────── */
/* x runs 0–10 with x=5 as at-the-money / current price, mirroring the strategy diagrams. */

const gaussian = (x, center = 5, width = 1.6) => Math.exp(-0.5 * ((x - center) / width) ** 2)
const sigmoid = (x, center = 5, steep = 1.3) => 1 / (1 + Math.exp(-(x - center) / steep))
const oddWiggle = (x, center = 5, width = 1.6) => (-(x - center) / width) * gaussian(x, center, width)
const wShape = (x, center = 5, width = 1.6) => (((x - center) / width) ** 2 - 1) * gaussian(x, center, width)

function curve(fn, { scale = 1.8, shift = 0, steps = 46 } = {}) {
  const points = []
  for (let i = 0; i <= steps; i++) {
    const x = 0.4 + (9.2 * i) / steps
    points.push([Math.round(x * 100) / 100, Math.round((fn(x) * scale + shift) * 1000) / 1000])
  }
  return points
}

const CALL_DELTA_CURVE = curve(x => sigmoid(x, 5, 1.3), { scale: 1.8, shift: -0.9 })
const THETA_CURVE = curve(x => -gaussian(x, 5, 1.4), { scale: 1.8 })
const VEGA_CURVE = curve(x => gaussian(x, 5, 1.6), { scale: 1.8 })
const RHO_CURVE = curve(x => sigmoid(x, 5, 2), { scale: 1.8, shift: -0.05 })
const GAMMA_CURVE = curve(x => gaussian(x, 5, 1.4), { scale: 1.8 })
const VANNA_CURVE = curve(x => oddWiggle(x, 5, 1.6), { scale: 1.8 })
const CHARM_CURVE = curve(x => oddWiggle(x, 5, 1.05), { scale: 1.8 })
const VOMMA_CURVE = curve(x => wShape(x, 5, 1.6), { scale: 1.8 })
const VETA_CURVE = curve(x => -gaussian(x, 5, 1.8), { scale: 1.8 })

/* ── Data ──────────────────────────────────────────────────────────────── */

const FIRST_ORDER = [
  {
    id: 'delta',
    symbol: 'Δ',
    name: 'Delta',
    formula: '∂V / ∂S',
    tagline: 'Price sensitivity — how much the option moves per $1 move in the underlying.',
    diagram: { points: CALL_DELTA_CURVE, centerLabel: 'At the money', zeroCrossLabel: '0.50 Δ', showZeroCrossings: true, positiveLabel: '1.00 Δ', negativeLabel: '0.00 Δ' },
    detail: (
      <>
        <h4>What It Measures</h4>
        <p>
          Delta is the first derivative of the option's price with respect to the underlying's price — for every
          $1 the stock moves, the option's value moves by roughly delta dollars. Call delta ranges from 0 (deep
          OTM) to 1.00 (deep ITM); put delta ranges from -1.00 (deep ITM) to 0 (deep OTM), and the two are linked
          by put-call parity: <strong>put delta = call delta − 1</strong>. Traders also read delta as a rough
          probability of finishing in the money, and as the number of shares needed to hedge the position (a 0.40
          delta call behaves like being long 40 shares).
        </p>
        <h4>How to Read the Graph</h4>
        <p>
          The chart above shows a call's delta across underlying price — a classic <strong>S-curve</strong>
          running from 0.00 on the left (deep OTM) to 1.00 on the right (deep ITM), with the inflection point at
          the money. The <em>steepness</em> of the S at any given price is the option's gamma at that price — a
          near-vertical middle section means delta (and therefore directional exposure) changes very fast for a
          small stock move.
        </p>
        <h4>Effect of DTE</h4>
        <p>
          As expiration approaches, the S-curve steepens toward a near-vertical step at the strike — a short-dated
          option's delta is close to a binary 0-or-1 bet. With more time to expiration, the curve flattens and
          stretches out, since there's more time for an OTM option to become ITM (or vice versa), so delta responds
          more gradually to price.
        </p>
        <h4>Effect of Implied Volatility</h4>
        <p>
          Higher IV flattens and widens the S-curve — with more expected movement priced in, moneyness alone
          matters less, so delta drifts toward 0.50 across a wider range of prices around the strike. Lower IV
          steepens the curve toward the same near-binary step that shrinking DTE produces, since both effects
          reduce the "uncertainty" that keeps delta away from 0 or 1.
        </p>
        <h4>Iron Condors &amp; Vertical Spreads</h4>
        <p>
          For an iron condor, delta starts near zero by design (short strikes placed symmetrically around the
          current price) and isn't the main source of edge — theta is. But delta is the position's early-warning
          gauge: as price drifts toward one short strike, the condor's net delta grows in the direction that
          works against you (rallying toward the call side pushes delta negative, selling off toward the put side
          pushes delta positive), signaling unwanted directional risk well before either short strike is actually
          breached. For vertical spreads, delta isn't a side effect — it <em>is</em> the trade. A bull put or bull
          call spread is built to carry positive delta; a bear call or bear put spread, negative delta. Whether
          delta is right or wrong about direction is the single biggest driver of a vertical spread's outcome,
          more so than any other Greek.
        </p>
      </>
    ),
  },
  {
    id: 'theta',
    symbol: 'Θ',
    name: 'Theta',
    formula: '∂V / ∂t',
    tagline: 'Time decay — how much the option loses in value per day, all else equal.',
    diagram: { points: THETA_CURVE, centerLabel: 'At the money', showZeroCrossings: false, positiveLabel: 'Less decay', negativeLabel: 'More decay' },
    detail: (
      <>
        <h4>What It Measures</h4>
        <p>
          Theta is the option's sensitivity to the passage of time. It is quoted as the dollar change in the
          option's value per day (sometimes per year, divided by 365 to get a daily figure), and is almost always
          negative for a long option position — the option is a wasting asset that loses extrinsic value every
          day that passes with no other change. A short option position has the mirror-image, positive theta.
        </p>
        <h4>How to Read the Graph</h4>
        <p>
          This is a negative <strong>bell curve</strong>: theta is most negative (fastest decay) exactly at the
          money, and decays toward zero for deep ITM or deep OTM options. That's because extrinsic value — the
          part of the price that decays — is largest ATM and smallest at the extremes, where the option is mostly
          intrinsic value (deep ITM) or has very little value to lose in the first place (deep OTM).
        </p>
        <h4>Effect of DTE</h4>
        <p>
          Time decay is not linear — the bell narrows and deepens sharply as expiration approaches. A 60-day ATM
          option might lose a small, steady amount per day; a 5-day ATM option can lose a much larger dollar
          amount per day. This acceleration is why premium sellers often prefer 30–45 DTE (still meaningful
          decay ahead) and often close or roll positions before the final 1–2 weeks, when theta (and gamma risk)
          both spike.
        </p>
        <h4>Effect of Implied Volatility</h4>
        <p>
          Higher IV raises the whole bell — there's more extrinsic value built into the option's price, so there's
          more for theta to burn off each day. Lower IV lowers the bell's height without changing its basic
          ATM-centered shape. This is why the richest-looking daily decay usually shows up on high-IV names, even
          for the same DTE and moneyness.
        </p>
        <h4>Iron Condors &amp; Vertical Spreads</h4>
        <p>
          Theta is the reason to run an iron condor in the first place — it's a positive-theta position, and every
          day that passes with price inside the short strikes is a day the trade earns money from decay alone,
          with no need for the stock to move at all. It's the cleanest "always helps, as long as price stays in
          range" Greek in the whole strategy. Vertical spreads split by construction: credit spreads (bull put,
          bear call) are positive theta and benefit the same way a condor does, with directional risk layered on
          top; debit spreads (bull call, bear put) are negative theta and are fighting the clock — theta actively
          works against a debit spread every day, which is why being right on direction still isn't enough if the
          move takes too long to arrive.
        </p>
      </>
    ),
  },
  {
    id: 'vega',
    symbol: 'ν',
    name: 'Vega',
    formula: '∂V / ∂σ',
    tagline: 'Volatility sensitivity — how much the option moves per 1-point change in implied volatility.',
    diagram: { points: VEGA_CURVE, centerLabel: 'At the money', showZeroCrossings: false, positiveLabel: 'Higher vega', negativeLabel: 'Lower vega' },
    detail: (
      <>
        <h4>What It Measures</h4>
        <p>
          Vega is the dollar change in an option's price for a 1-percentage-point change in implied volatility
          (e.g., IV moving from 25% to 26%). Vega is positive for both long calls and long puts — buying any
          option makes you "long vega," and selling any option makes you "short vega," regardless of direction.
        </p>
        <h4>How to Read the Graph</h4>
        <p>
          Another ATM-centered <strong>bell curve</strong>, similar in shape to gamma and theta, but generally a
          little wider — vega stays meaningfully positive over a broader range of strikes than gamma does, because
          even moderately OTM/ITM options still carry real extrinsic value that responds to a change in IV.
        </p>
        <h4>Effect of DTE</h4>
        <p>
          Vega grows and the bell widens with more time to expiration — a longer-dated option has more time for
          volatility to matter, so it's more sensitive to IV changes in dollar terms. As expiration nears, the
          bell shrinks toward zero across the board: there simply isn't enough time left for a change in expected
          volatility to move the price much.
        </p>
        <h4>Effect of Implied Volatility</h4>
        <p>
          Vega itself is not static as IV changes — this second-order effect is <strong>vomma</strong> (covered
          below). In general, vega for a given option is highest when IV is moderate and can compress at very
          high IV levels; for most practical trading ranges, treat the bell shown here as widening and flattening
          slightly as IV rises, and narrowing/sharpening as IV falls.
        </p>
        <h4>Iron Condors &amp; Vertical Spreads</h4>
        <p>
          An iron condor is a net short-vega position — at its core, a bet that implied volatility overstates how
          much the stock will actually move. Falling IV after entry helps the position (both short legs lose
          value faster than price movement alone would explain); rising IV hurts it, even with the stock
          unchanged, because the market is now pricing in more room to reach the short strikes. Vertical spreads
          inherit a scaled-down version: credit spreads are modestly short vega (helped by falling IV, hurt by
          rising IV), since the long leg offsets part of the short leg's vega; debit spreads are modestly long
          vega (helped by rising IV, hurt by falling IV) — a secondary tailwind or headwind layered on top of the
          primary directional bet.
        </p>
      </>
    ),
  },
  {
    id: 'rho',
    symbol: 'ρ',
    name: 'Rho',
    formula: '∂V / ∂r',
    tagline: 'Interest-rate sensitivity — how much the option moves per 1-point change in the risk-free rate.',
    diagram: { points: RHO_CURVE, centerLabel: 'At the money', showZeroCrossings: false, positiveLabel: 'Higher rho', negativeLabel: 'Lower rho' },
    detail: (
      <>
        <h4>What It Measures</h4>
        <p>
          Rho is the option's sensitivity to interest rates. Calls have positive rho (higher rates raise call
          value, since a call effectively defers payment for the shares); puts have negative rho. Rho is
          typically the least-watched Greek for short-dated retail trades because its dollar impact is small
          relative to delta, gamma, theta, and vega — but it becomes meaningful for long-dated options (LEAPS)
          and in higher-rate environments.
        </p>
        <h4>How to Read the Graph</h4>
        <p>
          The chart shows call rho as a monotonic <strong>ramp</strong> — near zero deep OTM, rising steadily
          toward its maximum deep ITM. Unlike delta, this ramp doesn't need to be a symmetric S centered on zero:
          rho for a call never goes negative, it simply grows as the option behaves more like owning the stock
          outright (which is fully rate-sensitive through its financing/carry cost).
        </p>
        <h4>Effect of DTE</h4>
        <p>
          Rho scales up meaningfully with time to expiration — the ramp gets taller (larger magnitude) the longer
          dated the option is, since rates compound over a longer holding period. For short-dated weekly options,
          the ramp is nearly flat and close to zero everywhere; for multi-year LEAPS, rho can rival vega in
          importance.
        </p>
        <h4>Effect of Implied Volatility</h4>
        <p>
          IV has only a secondary effect on rho — mostly through how it shifts the probability-weighting embedded
          in the option's price (higher IV mixes in a bit more "OTM-like" behavior even for ITM strikes, mildly
          softening the ramp). The dominant lever for rho is DTE and the level of rates themselves, not IV.
        </p>
        <h4>Iron Condors &amp; Vertical Spreads</h4>
        <p>
          Rho is close to a non-factor for both structures at typical trade durations. An iron condor's four legs
          are roughly balanced between long and short options at similar strikes, so their individual rho
          exposures largely cancel — a rate move neither meaningfully helps nor hurts the position over the
          timeframes most condors are held. Vertical spreads see the same near-cancellation between their long
          and short legs. Rho only becomes worth tracking for either structure when built with very long-dated
          (LEAPS-style) options, where the small per-contract rho difference between the two strikes compounds
          into something noticeable.
        </p>
      </>
    ),
  },
]

const SECOND_ORDER = [
  {
    id: 'gamma',
    symbol: 'Γ',
    name: 'Gamma',
    formula: '∂²V / ∂S² = ∂Δ / ∂S',
    tagline: "Delta's delta — how fast delta itself changes as the underlying moves.",
    diagram: { points: GAMMA_CURVE, centerLabel: 'At the money', showZeroCrossings: false, positiveLabel: 'Higher gamma', negativeLabel: 'Lower gamma' },
    detail: (
      <>
        <h4>What It Measures</h4>
        <p>
          Gamma is the rate of change of delta per $1 move in the underlying — it measures the "acceleration" of
          an option's directional exposure. A high-gamma position sees its delta (and therefore its P&amp;L
          sensitivity) shift quickly as the stock moves, which is exactly what makes short-gamma positions (like
          short straddles or short strangles near expiration) dangerous: the faster the underlying moves, the
          faster the position's effective directional bet grows against you. Gamma is identical for a call and
          put at the same strike and expiration.
        </p>
        <h4>How to Read the Graph</h4>
        <p>
          A symmetric <strong>bell curve</strong> peaking exactly at the money — the same shape family as theta
          and vega, and not a coincidence: all three are largest where extrinsic value and price-sensitivity are
          concentrated, right around the strike. Gamma falls off quickly moving away from the money in either
          direction, since deep ITM/OTM options have deltas already near their limits (1 or 0) that don't have
          much room left to change.
        </p>
        <h4>Effect of DTE</h4>
        <p>
          This is the most important dynamic to internalize: gamma's bell <strong>narrows and grows dramatically
          taller as expiration approaches</strong>. An ATM option's gamma on its last day of life can be many
          times larger than the same strike's gamma at 60 DTE. This is why 0DTE and expiration-week ATM options
          carry outsized directional risk for option sellers — a small stock move can flip the position's
          effective delta violently in a short window.
        </p>
        <h4>Effect of Implied Volatility</h4>
        <p>
          Higher IV widens and flattens the gamma bell (spreading price-sensitivity over a broader range, similar
          to its effect on the delta S-curve), which lowers the peak gamma at the money. Lower IV sharpens and
          raises the peak. This means the highest-gamma-risk environment is specifically a low-IV, near-expiration,
          at-the-money option.
        </p>
        <h4>Iron Condors &amp; Vertical Spreads</h4>
        <p>
          Gamma is the other side of theta's coin, and it is the core risk of an iron condor: the position is net
          short gamma, meaning that as the stock accelerates toward either short strike, the position's delta
          deteriorates faster and faster — a slow drift becomes a fast, compounding move against the trade. A
          shrinking gamma exposure (price sitting calmly between the strikes, especially with more DTE remaining)
          is a quiet, helpful state — delta stays stable and theta can do its job undisturbed. A growing gamma
          exposure (price approaching a short strike, especially close to expiration) actively hurts the trade —
          it's the mechanism behind the classic "iron condor blows up fast in the final days" outcome. Vertical
          spreads carry the same short-gamma risk if they're credit spreads (smaller in magnitude than a
          condor's, since it's only one side), and the opposite — a small, generally helpful long-gamma tailwind —
          if they're debit spreads, where an accelerating move in the right direction reaches max profit faster
          than delta alone would suggest.
        </p>
      </>
    ),
  },
  {
    id: 'vanna',
    symbol: 'Vanna',
    name: 'Vanna',
    formula: '∂²V / ∂S∂σ = ∂Δ/∂σ = ∂ν/∂S',
    tagline: "How delta shifts when IV changes — equivalently, how vega shifts when the stock moves.",
    diagram: { points: VANNA_CURVE, centerLabel: 'At the money', zeroCrossLabel: 'Sign flip', showZeroCrossings: true, positiveLabel: 'Positive vanna', negativeLabel: 'Negative vanna' },
    detail: (
      <>
        <h4>What It Measures</h4>
        <p>
          Vanna is a cross-derivative: it captures how an option's delta responds to a change in implied
          volatility (or, equivalently by symmetry, how its vega responds to a change in the underlying price).
          It matters most when both a price move and a volatility move happen together — a common real-world
          combination, since stock moves and IV moves are usually correlated (equities selling off while IV
          spikes, for example).
        </p>
        <h4>How to Read the Graph</h4>
        <p>
          Unlike the bell-shaped Greeks, vanna is an <strong>odd, sign-flipping curve</strong> that crosses zero
          exactly at the money and tapers back to zero in both tails — its lobes peak somewhat away from the
          strike, not at it. This is the key structural difference from gamma/vega: vanna's <em>effect is
          weakest right at the money and strongest at moderate OTM/ITM distances</em>, then fades again deep in
          the wings.
        </p>
        <h4>Effect of DTE</h4>
        <p>
          Vanna's lobes widen and grow with more time to expiration — longer-dated options have more vega to
          begin with, so there's more vega for the stock price to move around, and more delta for IV to move
          around. Near expiration, vanna collapses toward zero everywhere, following vega's own collapse.
        </p>
        <h4>Effect of Implied Volatility</h4>
        <p>
          Vanna is a major driver of dealer hedging flows during volatility spikes: when IV jumps, market makers'
          book-wide delta shifts purely from vanna (even with the stock unmoved), forcing hedging trades that can
          amplify or dampen the move depending on the sign of the market's net positioning. As a rough rule,
          vanna's lobes grow larger in absolute terms when baseline IV is higher, since there is more room for IV
          itself to swing.
        </p>
        <h4>Iron Condors &amp; Vertical Spreads</h4>
        <p>
          This is the Greek most traders overlook in a condor, and it answers directly: vanna's effect is
          smallest exactly at the money (where it crosses zero) and largest out in the flanks, near where the
          short strikes actually sit — so as a move develops and price pushes into the wings, vanna typically
          compounds the position's risk rather than fading. The classic adverse case is a decline paired with
          rising IV (a common real-world pairing in equities): vanna adds an extra, IV-driven push to the delta
          the put side is already losing to gamma, accelerating the drift toward a bad outcome faster than a
          delta/gamma-only view would predict. When the position sits centered near the money, vanna is close to
          zero and essentially irrelevant — the risk only wakes up once price has already moved into fragile
          territory, which is exactly when a trader least wants an extra tailwind against them. Vertical spreads
          feel a smaller version of the same effect: a credit spread being tested by a move paired with rising IV
          gets hurt by vanna the same way a condor's tested side does; a debit spread moving in its intended
          direction with rising IV (e.g., a bear put spread during a volatile selloff) can actually have vanna
          working with the trade, since the IV increase reinforces the long leg's gain on top of the delta-driven
          one.
        </p>
      </>
    ),
  },
  {
    id: 'charm',
    symbol: 'Charm',
    name: 'Charm (Delta Decay)',
    formula: '∂²V / ∂S∂t = ∂Δ/∂t',
    tagline: 'How much delta drifts purely from the passage of time, with the stock price held fixed.',
    diagram: { points: CHARM_CURVE, centerLabel: 'At the money', zeroCrossLabel: 'Sign flip', showZeroCrossings: true, positiveLabel: 'Positive charm', negativeLabel: 'Negative charm' },
    detail: (
      <>
        <h4>What It Measures</h4>
        <p>
          Charm measures how an option's delta changes overnight (or day to day) purely because time has passed —
          not because the stock moved. It matters to anyone delta-hedging a position without rebalancing
          continuously: even a perfectly flat, unmoved stock price can leave a hedged book with meaningful new
          directional exposure by the next morning, purely from charm.
        </p>
        <h4>How to Read the Graph</h4>
        <p>
          Like vanna, charm is an <strong>odd, sign-flipping curve</strong> centered on the money, but its lobes
          sit closer in and are narrower — the effect concentrates more tightly around the strike than vanna's
          does. Deep ITM and deep OTM deltas are already close to their limits (1 or 0) and barely drift with
          time; it's the options straddling the strike whose delta "rounds off" toward 0 or 1 as expiration
          approaches, which is exactly what charm captures.
        </p>
        <h4>Effect of DTE</h4>
        <p>
          Charm's lobes sharpen and intensify dramatically into the final days before expiration — mirroring
          theta and gamma's own acceleration. This is one reason near-the-money positions can see fast, sizable
          delta shifts into expiration week with the stock barely moving, complicating end-of-week hedging and
          pin-risk management.
        </p>
        <h4>Effect of Implied Volatility</h4>
        <p>
          Higher IV widens the near-the-money region where delta is still "uncertain" (per the flatter delta
          S-curve discussed above), which spreads charm's effect over a wider price range at lower amplitude.
          Lower IV concentrates and intensifies charm right around the strike, compounding with the DTE effect as
          both a calm market and an approaching expiration push charm to its most extreme.
        </p>
        <h4>Iron Condors &amp; Vertical Spreads</h4>
        <p>
          Charm's effect on an iron condor is genuinely two-sided depending on where price sits. If the stock is
          calmly centered between the short strikes, charm is a quiet ally — it pulls the near-the-money legs'
          deltas toward their eventual resting values as time passes, gently reducing the position's directional
          exposure with no price movement required, the same self-flattening tendency that makes theta such a
          reliable earner. If price has instead drifted close to one short strike, charm starts working against
          the trade, especially in the final one to two weeks: it accelerates that side's delta drift in the same
          direction gamma is already pushing it, compounding the risk of a fast, late blowout. Vertical spreads
          see the same split — charm reinforces a safely OTM credit spread's decay toward full profit, but
          accelerates the damage if price is sitting on top of the short strike as expiration nears.
        </p>
      </>
    ),
  },
  {
    id: 'vomma',
    symbol: 'Vomma',
    name: 'Vomma (Volga)',
    formula: '∂²V / ∂σ² = ∂ν/∂σ',
    tagline: "Vega's convexity — how much vega itself changes as implied volatility changes.",
    diagram: { points: VOMMA_CURVE, centerLabel: 'At the money', zeroCrossLabel: 'Local min', showZeroCrossings: true, positiveLabel: 'Positive vomma', negativeLabel: 'Negative vomma' },
    detail: (
      <>
        <h4>What It Measures</h4>
        <p>
          Vomma tells you whether an option's vega grows or shrinks as IV itself moves. Positive vomma means the
          option gains vega as IV rises — a convexity benefit for long-volatility traders, since the position
          becomes even more sensitive to further IV increases exactly when IV is already rising. This is a big
          part of why far-OTM strangles are popular as "pure volatility convexity" trades: they carry
          disproportionately high vomma relative to their upfront cost.
        </p>
        <h4>How to Read the Graph</h4>
        <p>
          Vomma traces a <strong>"W" shape</strong>: it dips to its lowest point (often near zero or slightly
          negative) exactly at the money, then rises to positive humps on both wings before decaying back toward
          zero far OTM/ITM. This is the opposite emphasis from gamma/vega/theta — vomma's benefit is concentrated
          away from the money, not at it, which is why option structures built purely to harvest vomma (like
          far-OTM strangles) look nothing like ATM straddles.
        </p>
        <h4>Effect of DTE</h4>
        <p>
          The W deepens and widens with more time to expiration, tracking vega's own growth — there's simply more
          vega available to be convex about. Short-dated, low-vega options have correspondingly small, flat
          vomma; long-dated options can carry substantial vomma on their OTM wings.
        </p>
        <h4>Effect of Implied Volatility</h4>
        <p>
          Vomma is itself sensitive to the starting IV level — in very high-IV regimes the "W" can compress or
          shift, since vega itself behaves differently (see the vega card's IV note). As a practical takeaway:
          vomma is the reason volatility-of-volatility matters — positions with high vomma benefit disproportionately
          from IV spikes and are hurt disproportionately by IV mean-reversion, independent of what the stock does.
        </p>
        <h4>Iron Condors &amp; Vertical Spreads</h4>
        <p>
          Vomma creates an asymmetry that generally works against a short iron condor. Because vomma is close to
          zero (or slightly negative) right at the money and turns positive out in the wings — closer to where
          the short strikes live — a sharp rise in implied volatility doesn't just increase the value of the
          short legs through vega, it also increases how much further they'll keep gaining if IV keeps climbing
          (vega itself growing along with IV). That amplifies losses in a volatility spike beyond what a linear,
          vega-only estimate would suggest. The relationship isn't symmetric: as IV falls back down, vomma
          similarly means the pace of the position's vega-driven gains decelerates, so it doesn't return the
          favor to the same degree. Net effect: vomma tends to hurt a short iron condor more in a spike than it
          helps in a crush. Vertical spreads carry a smaller version of this same asymmetry for credit spreads,
          while debit spreads — being long vega — get a genuine, if modest, tailwind from positive vomma if IV
          rises after entry.
        </p>
      </>
    ),
  },
  {
    id: 'veta',
    symbol: 'Veta',
    name: 'Veta',
    formula: '∂²V / ∂σ∂t = ∂ν/∂t',
    tagline: 'How much vega decays over time, with implied volatility held fixed.',
    diagram: { points: VETA_CURVE, centerLabel: 'At the money', showZeroCrossings: false, positiveLabel: 'Less decay', negativeLabel: 'More decay' },
    detail: (
      <>
        <h4>What It Measures</h4>
        <p>
          Veta captures the erosion of an option's vega purely from the passage of time — separate from theta,
          which measures the option's dollar-value decay. Veta explains why a long-vega position (a calendar
          spread, a LEAPS call, a long strangle held for weeks) becomes gradually less sensitive to IV changes as
          time passes, even before any IV move actually happens. It matters most for structures explicitly built
          around vega, like calendar and diagonal spreads, where the back-month leg's fading vega is part of the
          trade's evolving risk profile.
        </p>
        <h4>How to Read the Graph</h4>
        <p>
          A negative <strong>bell curve</strong>, similar in shape to theta but typically a little wider — vega
          decays fastest for at-the-money options as time passes, and more slowly for deep ITM/OTM options that
          have relatively little vega to lose in the first place. In practice, real-world veta can show more
          complex behavior far from the money depending on rates and dividends; this illustration captures the
          dominant, practically important ATM-decay pattern.
        </p>
        <h4>Effect of DTE</h4>
        <p>
          Veta's magnitude is largest for options with a lot of vega to begin with — generally moderate-to-longer
          DTE names — and shrinks toward expiration as vega itself approaches zero (there's nothing left to decay).
          This is a subtler, second-order companion to theta's own well-known acceleration into expiration.
        </p>
        <h4>Effect of Implied Volatility</h4>
        <p>
          Higher starting IV generally means more vega on the books to begin with, so veta's bell tends to be
          taller (a bigger absolute daily loss of vega) in high-IV names or high-IV regimes than in quiet,
          low-IV ones, even holding DTE and moneyness constant.
        </p>
        <h4>Iron Condors &amp; Vertical Spreads</h4>
        <p>
          Veta works in the iron condor's favor over time, independent of price. Because it measures the erosion
          of vega itself as expiration approaches, a short iron condor's vega exposure — and therefore its
          vulnerability to an adverse IV spike — shrinks as the trade ages, on top of the separate, more visible
          benefit from theta. This is part of why many traders find iron condors easier to manage in their final
          couple of weeks purely from a volatility-risk standpoint, even though gamma and charm risk are rising
          at the very same time — a real trade-off between shrinking vega risk and growing gamma/charm risk into
          expiration. Vertical spreads see the same effect at a smaller scale: a credit spread's already-modest
          vega exposure fades further as it ages, a small ongoing tailwind; a debit spread's long vega fades the
          same way, which quietly works against a trader who was hoping for an IV expansion to help the trade
          beyond the pure directional move.
        </p>
      </>
    ),
  },
]

function GreekCard({ greek, isOpen, onToggle }) {
  return (
    <div className={`cef-guide-card${isOpen ? ' cef-guide-card--open' : ''}`}>
      <button className="cef-guide-header" onClick={onToggle} aria-expanded={isOpen}>
        <span className="cef-guide-number">{greek.symbol.length <= 2 ? greek.symbol : greek.symbol.charAt(0)}</span>
        <span className="cef-guide-question">{greek.name} <small className="opt-edu-formula">{greek.formula}</small></span>
        <span className="cef-guide-chevron">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="opt-edu-guide-card">
          <div className="opt-edu-payoff-wrap">
            <p className="opt-edu-tagline">{greek.tagline}</p>
            <OptionPayoffDiagram title={`${greek.name} vs. underlying price`} {...greek.diagram} />
            <div className="opt-edu-legs-note">
              Illustrative <strong>shape</strong> only — a stylized, mathematically-motivated curve to teach the
              pattern, not a live calculation for any specific option.
            </div>
          </div>
          <div className="opt-edu-guide-copy">{greek.detail}</div>
        </div>
      )}
    </div>
  )
}

function GreekGroup({ greeks, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="cef-guide-list" style={{ maxWidth: 'none' }}>
      {greeks.map(greek => (
        <GreekCard
          key={greek.id}
          greek={greek}
          isOpen={open === greek.id}
          onToggle={() => setOpen(open === greek.id ? null : greek.id)}
        />
      ))}
    </div>
  )
}

const NOTATION_VARS = [
  { symbol: 'V', name: 'Option value', detail: 'The option\'s theoretical price — the single quantity every Greek describes the behavior of. Every Greek is a derivative of V.' },
  { symbol: 'S', name: 'Underlying price', detail: 'The current price of the stock, ETF, or index the option is written on. A derivative "with respect to S" asks how V responds to a $1 change in the underlying.' },
  { symbol: 't', name: 'Time', detail: 'Time remaining until expiration. A derivative "with respect to t" asks how V responds purely to a day passing, with nothing else changing.' },
  { symbol: 'σ', name: 'Implied volatility (sigma)', detail: 'The market\'s priced-in expectation of how much the underlying will move. A derivative "with respect to σ" asks how V responds to a 1-point change in that expectation.' },
  { symbol: 'r', name: 'Risk-free interest rate', detail: 'The rate used to discount the option\'s future payoff back to today. A derivative "with respect to r" asks how V responds to a 1-point change in rates.' },
]

function NotationKey() {
  const [open, setOpen] = useState(true)
  return (
    <div className={`cef-guide-card opt-edu-notation${open ? ' cef-guide-card--open' : ''}`} style={{ marginBottom: '1.5rem' }}>
      <button className="cef-guide-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="cef-guide-number">∂</span>
        <span className="cef-guide-question">What the Formulas Mean — Reading ∂V/∂S and Friends</span>
        <span className="cef-guide-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="opt-edu-guide-copy" style={{ padding: '0 1.4rem 1.2rem 3.6rem', borderTop: '1px solid var(--p-243356)' }}>
          <h4>The Variables</h4>
          <p>
            Every Greek formula is a derivative of the option's value, <strong>V</strong>, which depends on several
            inputs at once: the underlying price, time, volatility, and interest rates. Each Greek isolates{' '}
            <strong>one</strong> of those inputs at a time.
          </p>
          <div className="cef-edu-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', marginBottom: '1rem' }}>
            {NOTATION_VARS.map(v => (
              <div className="cef-edu-card" key={v.symbol} style={{ padding: '0.85rem 1rem' }}>
                <h3 style={{ marginBottom: '0.35rem' }}>{v.symbol} — {v.name}</h3>
                <p style={{ margin: 0 }}>{v.detail}</p>
              </div>
            ))}
          </div>

          <h4>The ∂ Symbol — "Partial" Derivative</h4>
          <p>
            An ordinary derivative (written dV/dS) applies when V depends on only one variable. Option value depends
            on several variables simultaneously (S, t, σ, r), so Greeks use the <strong>partial</strong> derivative
            symbol, ∂, instead of d. <em>∂V/∂S</em> means: nudge S by a tiny amount, hold every other variable (t,
            σ, r) perfectly still, and measure how much V moves. That "holding everything else constant" clause is
            the whole point of a partial derivative — and the whole reason cross-Greeks like vanna, charm, and
            vomma exist: in the real world S, t, and σ often move together, and those Greeks describe exactly what
            happens when two of them move at once.
          </p>

          <h4>Reading a First-Order Formula: Delta = ∂V/∂S</h4>
          <p>
            "The partial derivative of V with respect to S." Take the option-value function V and differentiate it
            with respect to S, treating t, σ, and r as fixed constants during that step. The result, Delta, is
            itself a new function — one that still depends on S, t, σ, and r, which is exactly why Delta has its
            own graph and its own sensitivity to DTE and IV.
          </p>

          <h4>Reading a Second-Order "Own" Formula: Gamma = ∂²V/∂S²</h4>
          <p>
            The ² means "differentiate with respect to S, then differentiate the result with respect to S again."
            First pass: ∂V/∂S gives Delta. Second pass: differentiate Delta with respect to S again, giving Gamma —
            the rate of change of the rate of change, i.e. how fast Delta itself moves as the stock moves.
          </p>

          <h4>Reading a Second-Order "Cross" Formula: Vanna = ∂²V/∂S∂σ</h4>
          <p>
            A mixed partial derivative — two different variables, one derivative each. Read it as "differentiate V
            with respect to S first (giving Delta), then differentiate that result with respect to σ." A well-known
            calculus result (Clairaut's/Young's theorem, which holds for any smooth, well-behaved function —
            option-pricing formulas qualify) says the order doesn't matter: differentiating with respect to σ first
            (giving Vega) and then with respect to S gives the exact same answer, ∂²V/∂S∂σ = ∂²V/∂σ∂S. That's why
            vanna is described two equivalent ways — "how delta shifts when IV changes" and "how vega shifts when
            the stock moves" — they're the same number, just reached via two different first steps. Charm
            (∂²V/∂S∂t) and veta (∂²V/∂σ∂t) are read the same way, just swapping in t or σ for the second variable.
          </p>
        </div>
      )}
    </div>
  )
}

function FirstOrderSection() {
  return (
    <div className="cef-edu-section" style={{ maxWidth: 1100 }}>
      <div className="cef-edu-compare-intro">
        <p>
          First-order Greeks are single derivatives of the option's price with respect to one variable — how much
          the price moves per unit change in the underlying, time, volatility, or interest rates. These are the
          numbers quoted directly on every broker's option chain.
        </p>
      </div>
      <GreekGroup greeks={FIRST_ORDER} defaultOpen="delta" />
    </div>
  )
}

function SecondOrderSection() {
  return (
    <div className="cef-edu-section" style={{ maxWidth: 1100 }}>
      <div className="cef-edu-compare-intro">
        <p>
          Second-order Greeks are derivatives <em>of the first-order Greeks</em> — they describe how delta, vega,
          and the other first-order sensitivities themselves change as price, time, or volatility move. They are
          rarely shown on a standard option chain, but they explain why simple first-order intuition breaks down
          around expiration, during volatility spikes, and in dealer hedging flows.
        </p>
      </div>
      <GreekGroup greeks={SECOND_ORDER} defaultOpen="gamma" />
    </div>
  )
}

export default function GreeksGuide() {
  const [activeTab, setActiveTab] = useState('first')

  return (
    <div className="page cef-page">
      <div className="cef-title-row">
        <div>
          <h1>Understanding the Option Greeks</h1>
          <p>What each Greek measures, and how to read its value-vs-price graph — for first- and second-order Greeks.</p>
        </div>
      </div>

      <NotationKey />

      <div className="cef-tabs" style={{ marginBottom: '1.5rem' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`cef-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'first' ? <FirstOrderSection /> : <SecondOrderSection />}

      <div className="cef-disclosure" style={{ marginTop: 32 }}>
        <strong>Disclaimer</strong>
        <p>
          This guide is for educational purposes only. Every graph is a stylized, illustrative curve chosen to
          teach the characteristic shape of each Greek — it is not a live pricing model and does not reflect any
          specific option, strike, or market. Real Greek curves vary with the underlying's actual volatility
          surface, skew, dividends, and interest-rate environment. Consult a qualified financial advisor before
          trading options.
        </p>
      </div>
    </div>
  )
}
