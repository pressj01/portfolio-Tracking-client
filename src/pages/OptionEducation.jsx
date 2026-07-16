import React, { useState } from 'react'
import OptionPayoffDiagram from '../components/OptionPayoffDiagram'

const TABS = [
  { id: 'basics', label: 'Puts & Calls Basics' },
  { id: 'strategies', label: 'Strategy Guide' },
]

const OUTLOOK_LABEL = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'Neutral / range-bound',
  either: 'Directional either way',
}

function OutlookTag({ outlook }) {
  return (
    <span className={`opt-edu-tag opt-edu-tag--${outlook}`}>
      <small>Best in</small>{OUTLOOK_LABEL[outlook]}
    </span>
  )
}

function VegaTag({ vega }) {
  const isLong = vega === 'long'
  return (
    <span className={`opt-edu-tag opt-edu-tag--${isLong ? 'longvega' : 'shortvega'}`}>
      <small>Vega</small>{isLong ? 'Long volatility (net long vega)' : 'Short volatility (net short vega)'}
    </span>
  )
}

/* ───────────────────────── Basics tab ───────────────────────── */

function BasicsSection() {
  return (
    <div className="cef-edu-section">
      <div className="cef-edu-hero">
        <div className="cef-edu-hero-badge">CALL</div>
        <div>
          <h2>Call Option</h2>
          <p className="cef-edu-hero-sub">The right — but not the obligation — to buy 100 shares of the underlying at a fixed strike price on or before expiration.</p>
        </div>
      </div>
      <div className="cef-edu-cards" style={{ marginBottom: '1.6rem' }}>
        <div className="cef-edu-card">
          <h3>Buyer of a Call</h3>
          <p>
            Pays a premium upfront for the right to buy 100 shares at the strike price. The buyer profits if the
            underlying rises above the strike by more than the premium paid. Risk is limited to the premium;
            reward is theoretically unlimited as the stock rises.
          </p>
          <OptionPayoffDiagram
            title="Long call payoff"
            points={[[0, -1], [5, -1], [9, 2.2]]}
            continuesRight
          />
        </div>
        <div className="cef-edu-card">
          <h3>Seller (Writer) of a Call</h3>
          <p>
            Collects the premium in exchange for the <strong>obligation</strong> to sell 100 shares at the strike
            if assigned. Profit is capped at the premium collected; risk is theoretically unlimited if the stock
            rises far above the strike and the seller does not already own the shares (a "naked" call). Selling a
            call against shares you already own turns this into a covered call.
          </p>
        </div>
      </div>

      <div className="cef-edu-hero">
        <div className="cef-edu-hero-badge cef-edu-hero-badge--etf">PUT</div>
        <div>
          <h2>Put Option</h2>
          <p className="cef-edu-hero-sub">The right — but not the obligation — to sell 100 shares of the underlying at a fixed strike price on or before expiration.</p>
        </div>
      </div>
      <div className="cef-edu-cards" style={{ marginBottom: '1.6rem' }}>
        <div className="cef-edu-card">
          <h3>Buyer of a Put</h3>
          <p>
            Pays a premium for the right to sell 100 shares at the strike price. The buyer profits if the
            underlying falls below the strike by more than the premium paid. Risk is limited to the premium;
            reward is large (bounded only by the stock reaching zero) as the stock falls.
          </p>
          <OptionPayoffDiagram
            title="Long put payoff"
            points={[[1, 2.2], [5, -1], [10, -1]]}
            continuesLeft
          />
        </div>
        <div className="cef-edu-card">
          <h3>Seller (Writer) of a Put</h3>
          <p>
            Collects the premium in exchange for the <strong>obligation</strong> to buy 100 shares at the strike
            if assigned. Profit is capped at the premium collected; risk is large if the stock falls far below the
            strike. Selling a put with cash set aside to cover assignment is a cash-secured put — one of the most
            common income strategies.
          </p>
        </div>
      </div>

      <div className="cef-edu-hero">
        <div className="cef-edu-hero-badge cef-edu-hero-badge--compare">Δ</div>
        <div>
          <h2>Core Concepts Behind Every Risk Graph</h2>
          <p className="cef-edu-hero-sub">Four ideas explain almost everything about how a strategy's odds and P&amp;L shift over time.</p>
        </div>
      </div>
      <div className="cef-edu-cards">
        <div className="cef-edu-card">
          <h3>Premium = Intrinsic + Extrinsic Value</h3>
          <p>
            An option's price has two components. <strong>Intrinsic value</strong> is the amount the option is
            already in the money — a $105 call on a $110 stock has $5 of intrinsic value. <strong>Extrinsic
            (time) value</strong> is everything else: the market's payment for the chance the option moves further
            into the money before expiration. Extrinsic value is highest for at-the-money options and decays to
            zero by expiration — this decay is <strong>theta</strong>.
          </p>
        </div>
        <div className="cef-edu-card">
          <h3>Moneyness: ITM, ATM, OTM</h3>
          <ul>
            <li><strong>In the money (ITM)</strong> — Has intrinsic value. Calls: strike below the stock price. Puts: strike above the stock price.</li>
            <li><strong>At the money (ATM)</strong> — Strike at (or very near) the current stock price. Maximum extrinsic value and maximum theta decay per day live here.</li>
            <li><strong>Out of the money (OTM)</strong> — No intrinsic value, pure extrinsic value. Cheaper, lower probability of finishing profitable, more leveraged in percentage terms.</li>
          </ul>
        </div>
        <div className="cef-edu-card">
          <h3>Delta ≈ Probability</h3>
          <p>
            Delta measures how much an option's price moves per $1 move in the underlying, but traders also use
            it as a rough shortcut for the market-implied probability that the option finishes in the money. A
            0.30 delta call is priced as if it has roughly a 30% chance of expiring ITM; a 0.16 delta option is
            priced near a 1-standard-deviation (≈84%) probability of expiring OTM. This is the "probability of
            success" language used throughout this guide — it is delta/price-implied, not a guarantee.
          </p>
        </div>
        <div className="cef-edu-card">
          <h3>Theta and Days to Expiration (DTE)</h3>
          <p>
            Time decay is not linear — it accelerates as expiration approaches. A 60-day option loses value
            slowly at first and rapidly in its final 1–2 weeks. This is why premium sellers generally prefer
            30–45 DTE (enough premium, faster-accelerating decay ahead) while premium buyers who want a
            directional move to play out prefer more DTE (60–120+ days) so time decay doesn't outrun the thesis.
          </p>
        </div>
        <div className="cef-edu-card">
          <h3>Vega and Implied Volatility (IV)</h3>
          <p>
            Vega measures how much an option's price changes for a 1-point change in implied volatility. Higher
            IV means the market expects bigger price swings, so option premiums — for both calls and puts — are
            more expensive. A position is <strong>net long vega</strong> if it profits when IV rises (net option
            buyers) and <strong>net short vega</strong> if it profits when IV falls (net option sellers), holding
            the underlying price constant.
          </p>
        </div>
        <div className="cef-edu-card">
          <h3>IV Rank / IV Percentile</h3>
          <p>
            Absolute IV means little on its own — a 25% IV can be high for a utility stock and low for a
            biotech. IV Rank and IV Percentile compare current IV to its own trailing range (usually 52 weeks).
            Premium-selling strategies (covered calls, credit spreads, iron condors) generally have better
            risk/reward when IV Rank is high, since you collect richer premium and benefit from IV mean-reverting
            lower. Premium-buying strategies (long calls/puts, straddles) generally have better risk/reward when
            IV Rank is low, since you pay less for the same exposure and benefit if IV expands.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Strategy data ───────────────────────── */

const STRATEGIES = [
  {
    id: 'covered-call',
    name: 'Covered Call',
    outlook: 'neutral',
    vega: 'short',
    diagram: { points: [[0, -2.2], [6, 0.5], [10, 0.5]], continuesLeft: true, strikeMarkers: [{ x: 6, label: 'Short call strike' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Own 100 shares and sell one call, typically 2–8% out of the money, against them. You collect the premium immediately; if the stock finishes above the strike, your shares are called away at that price.</p>
        <h4>Best Markets</h4>
        <p>Flat to modestly bullish markets. It underperforms simply holding the stock in a strong rally (upside is capped at the strike) and only cushions — it does not prevent — losses in a sharp decline, since you still own the shares.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Selling further OTM (e.g. 0.20 delta vs. 0.40 delta) raises the probability the option expires worthless and you keep the full stock gain, but collects less premium. Selling closer to the money raises the odds of being called away and caps upside sooner, but pays more theta per day. Shorter DTE (7–21 days) decays faster relative to time risked, which is why many covered-call traders roll weekly or monthly rather than sell far-dated calls; far-dated calls collect more absolute premium but tie up the position and delta risk for longer.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>This position is net short vega through the short call. Rising IV after you sell increases the mark-to-market cost to buy the call back (a paper loss on the option leg, though it also usually means the stock itself is more volatile). Falling IV (vol crush) is the friend of a covered call — the short call loses value faster, letting you buy it back cheaper or let it expire worthless. Covered calls are most attractive to initiate when IV Rank is elevated, since the premium collected is richer for the same OTM distance.</p>
      </>
    ),
  },
  {
    id: 'cash-secured-put',
    name: 'Cash-Secured Put',
    outlook: 'bullish',
    vega: 'short',
    diagram: { points: [[0, -2.2], [4, 0.5], [10, 0.5]], continuesLeft: true, strikeMarkers: [{ x: 4, label: 'Short put strike' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Sell one put, typically OTM, while setting aside enough cash to buy 100 shares at the strike if assigned. Economically identical in shape to a covered call — you are agreeing to buy the stock at a discount to today's price, paid for by the premium.</p>
        <h4>Best Markets</h4>
        <p>Neutral to bullish markets, or as a disciplined way to buy a stock you already want to own at a lower price. Works poorly in a sharp, sustained downtrend — you can be assigned well above the eventual market price.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>The further OTM the strike, the higher the probability of keeping the full premium without assignment, but the smaller that premium is relative to the capital secured. 30–45 DTE is the traditional sweet spot for theta efficiency; going very short-dated (under 2 weeks) increases gamma risk — a sudden move can flip an OTM put ITM quickly with little time to react. Very long-dated puts collect more premium in dollars but tie up cash for a long time and expose you to more macro risk before expiration.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net short vega. Rising IV inflates the put's value, working against the seller on a mark-to-market basis and often coincides with the exact market stress that leads to assignment. Falling IV benefits the position, letting it decay faster. Selling puts is most efficient when IV Rank is high (e.g., after a selloff spikes volatility) — you get paid more to take on the same obligation to buy the stock.</p>
      </>
    ),
  },
  {
    id: 'protective-put',
    name: 'Protective Put',
    outlook: 'bullish',
    vega: 'long',
    diagram: { points: [[0, -0.8], [4, -0.8], [10, 2.4]], continuesRight: true, strikeMarkers: [{ x: 4, label: 'Put strike (floor)' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Own 100 shares and buy one put, usually OTM, as insurance. This caps your downside at the strike (minus the premium paid) while leaving upside fully open — the shape is equivalent to owning a synthetic long call.</p>
        <h4>Best Markets</h4>
        <p>Bullish or uncertain markets where you want to stay invested through a possible drawdown — earnings, macro events, or simply insuring unrealized gains — without selling the stock and triggering taxes.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>"Success" here means the insurance wasn't needed and expired worthless while the stock rose — a good outcome, not a wasted one. Closer-to-the-money puts cost more but protect more of the position; far OTM puts are cheaper "catastrophe" insurance that only kicks in after a large decline. Longer DTE spreads the cost of insurance over more time and avoids the need to repeatedly repurchase protection (and repay the bid-ask spread) as options expire.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net long vega through the long put. Rising IV — which typically accompanies falling stock prices — increases the put's value, offsetting stock losses more than the delta alone would suggest and making the hedge more effective exactly when it's needed. Falling IV in a calm, rising market erodes the put's value on top of ordinary theta decay, which is the "cost" of carrying insurance you didn't use. Buying protection is cheapest, in relative terms, when IV Rank is low.</p>
      </>
    ),
  },
  {
    id: 'collar',
    name: 'Collar',
    outlook: 'neutral',
    vega: 'neutral',
    diagram: { points: [[0, -0.8], [4, -0.8], [6, 1.2], [10, 1.2]], strikeMarkers: [{ x: 4, label: 'Put strike' }, { x: 6, label: 'Call strike' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Own 100 shares, buy an OTM put for protection, and sell an OTM call to help pay for it (often "zero-cost" if the premiums roughly offset). The result is a bounded range: a defined floor and a defined ceiling.</p>
        <h4>Best Markets</h4>
        <p>Sideways to modestly bullish markets, or when you want to protect a large unrealized gain cheaply and are willing to give up further upside to fund the protection. Common around concentrated single-stock positions or ahead of a known risk event.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Widening the collar (put further OTM, call further OTM) increases the probability the stock finishes inside the band, capturing the full ramp between strikes, but requires either paying more net premium or accepting less offset. A tighter collar guarantees a narrower, more certain outcome. Because both legs share the same expiration in a standard collar, DTE mainly affects how often you need to reset the structure — shorter-dated collars require more frequent management but adapt faster to a changed outlook.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Vega exposure is largely neutral by design — the long put's positive vega is offset by the short call's negative vega, though not perfectly if strikes are asymmetric distances from the money. This makes the collar relatively insensitive to a broad IV shift, which is part of its appeal as a "set it and forget it" hedge. A skew shift (puts getting relatively more expensive than calls, common in equity selloffs) can make collars cheaper to establish, since the put you're buying and the call you're selling both react to the changing skew.</p>
      </>
    ),
  },
  {
    id: 'pmcc',
    name: "Poor Man's Covered Call",
    outlook: 'bullish',
    vega: 'long',
    diagram: { points: [[0, -1.6], [3, -1.6], [6, 0.9], [10, 0.9]], strikeMarkers: [{ x: 3, label: 'Long call (deep ITM, far-dated)' }, { x: 6, label: 'Short call (OTM, near-dated)' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>A diagonal spread: buy a deep in-the-money, long-dated call (60–90 delta, often 6–12+ months out, sometimes called a LEAPS call) as a stock substitute, then sell a near-dated OTM call against it, just like a traditional covered call. Requires far less capital than owning 100 shares outright.</p>
        <h4>Best Markets</h4>
        <p>Modestly bullish, capital-efficient alternative to a covered call. Works best in a slow, grinding uptrend where the long call's delta rises with the stock and the repeatedly-sold short calls generate steady income. It underperforms a real covered call in a sharp rally, since the long call has less than 1.00 delta and time value that erodes if the short calls are consistently rolled up.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>The long call's DTE and delta set the "quality" of the stock substitute — deeper ITM and longer-dated means more stock-like behavior (delta near 0.80–0.90) but higher upfront cost and slower theta decay working in your favor. The short call's OTM distance and DTE behave exactly like a standard covered call: closer to the money and shorter-dated collects more premium per unit of time but raises the odds of the short call needing to be rolled or the position being capped below the long call's eventual value.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net exposure is mixed but typically long vega overall, because the long-dated call has much more vega than the short-dated call sold against it (vega scales with time to expiration). Rising IV benefits the long call more than it hurts the short call — a helpful asymmetry. Falling IV hurts the long call's value more than it helps the short call, which is a risk this strategy carries that a plain covered call (which owns actual shares, with no vega on the stock leg) does not.</p>
      </>
    ),
  },
  {
    id: 'bull-put-credit',
    name: 'Bull Put Spread (Credit)',
    outlook: 'bullish',
    vega: 'short',
    diagram: { points: [[0, -1], [3.5, -1], [4.5, 0.6], [10, 0.6]], strikeMarkers: [{ x: 3.5, label: 'Long put (protection)' }, { x: 4.5, label: 'Short put (sold)' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Sell a put closer to the money and buy a further-OTM put as protection, both expiring together. You collect a net credit and risk is capped at the width between strikes minus that credit.</p>
        <h4>Best Markets</h4>
        <p>Bullish to neutral. A common way to express "I don't think this stock falls below X" without needing it to actually rally — you profit even if the stock is flat or drifts modestly lower, as long as it stays above the short strike.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Selling the short strike further OTM raises the probability of keeping the full credit but shrinks the credit relative to the width (worse reward-to-risk). Tighter, closer-to-the-money spreads collect more credit for the width but succeed less often. 30–45 DTE is the traditional balance of adequate premium and manageable gamma risk; very short-dated credit spreads have high theta efficiency but can be blown through quickly by a single bad day since there's little time for the trade thesis to play out.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net short vega, though smaller in magnitude than a single naked put since the long put offsets part of the vega exposure. Rising IV increases the mark-to-market value of both legs but usually hurts the net position modestly (the short, closer-to-the-money leg has more vega than the long, further-OTM leg). Falling IV helps the position for the same reason. Because the long put caps the downside, this strategy is more tolerant of a volatility spike than a naked cash-secured put — the defined risk is the whole point.</p>
      </>
    ),
  },
  {
    id: 'bear-call-credit',
    name: 'Bear Call Spread (Credit)',
    outlook: 'bearish',
    vega: 'short',
    diagram: { points: [[0, 0.6], [5.5, 0.6], [6.5, -1], [10, -1]], strikeMarkers: [{ x: 5.5, label: 'Short call (sold)' }, { x: 6.5, label: 'Long call (protection)' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Sell a call closer to the money and buy a further-OTM call as protection, both expiring together. The mirror image of a bull put spread — you collect a net credit and risk is capped at the width minus the credit.</p>
        <h4>Best Markets</h4>
        <p>Bearish to neutral. Profits if the stock stays below the short strike, falls, or is flat — it does not require a decline to work, only that the stock fails to rally past the short strike.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Same trade-off as its bullish counterpart in reverse: a short strike further above the current price raises the odds of success but collects a smaller credit relative to the spread width. 30–45 DTE remains the common balance point. Because upside moves in individual stocks can be sharper and faster than downside grinds (squeezes, gap-up news), many traders size bear call spreads more conservatively or choose a wider OTM buffer than they would for an equivalent bull put spread.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net short vega. Rising IV works against the position, and because call-side IV can spike sharply on short squeezes or positive catalysts, a bear call spread can face outsized mark-to-market swings relative to its defined max loss. Falling IV benefits the position. As with any credit spread, initiating when IV Rank is elevated improves the credit received per unit of risk.</p>
      </>
    ),
  },
  {
    id: 'bull-call-debit',
    name: 'Bull Call Spread (Debit)',
    outlook: 'bullish',
    vega: 'long',
    diagram: { points: [[0, -0.6], [4.5, -0.6], [6, 0.9], [10, 0.9]], strikeMarkers: [{ x: 4.5, label: 'Long call (bought)' }, { x: 6, label: 'Short call (sold)' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Buy a call closer to the money and sell a further OTM call against it, both expiring together. You pay a net debit; the short call's premium partially finances the long call and caps the trade's cost relative to buying the call outright.</p>
        <h4>Best Markets</h4>
        <p>Bullish — you need the stock to rise to profit, unlike the equivalent credit spreads which only need the stock to avoid falling. In exchange, this trade defines risk to the debit paid and reduces the cost (and vega/theta exposure) versus a naked long call.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>A narrower spread (strikes close together) costs less, has a smaller max loss, and reaches max profit with a smaller move — but caps the reward tightly. A wider spread costs more but has a bigger payout if the stock rallies hard. Longer DTE gives the thesis more time to play out and reduces daily theta drag versus a short-dated spread, at the cost of tying up capital longer. This spread has the identical payoff shape as the bull put spread — the choice between them often comes down to whether you'd rather pay a debit (bull call) or collect a credit (bull put) and how each is taxed or margined by your broker.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net long vega, though muted since the short call offsets much of the long call's vega. Rising IV modestly helps the position (mostly through the closer-to-the-money long call); falling IV modestly hurts it. Because vega exposure is small relative to a naked long call, this trade is less of a "volatility bet" and more of a directional bet with defined risk — many traders use debit spreads specifically to reduce sensitivity to an unwanted IV crush after an earnings move.</p>
      </>
    ),
  },
  {
    id: 'bear-put-debit',
    name: 'Bear Put Spread (Debit)',
    outlook: 'bearish',
    vega: 'long',
    diagram: { points: [[0, 0.9], [4, 0.9], [5.5, -0.6], [10, -0.6]], strikeMarkers: [{ x: 4, label: 'Short put (sold)' }, { x: 5.5, label: 'Long put (bought)' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Buy a put closer to the money and sell a further OTM put against it, both expiring together, paying a net debit. The mirror image of a bull call spread — defined risk, defined reward, needs the stock to actually fall.</p>
        <h4>Best Markets</h4>
        <p>Bearish. Compared to a naked long put, the short put lowers the cost and vega exposure but also caps how much you can make if the stock falls sharply below the short strike.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Same trade-offs as a bull call spread, mirrored: a narrow spread is cheaper with a smaller capped reward; a wide spread costs more but pays more on a large decline. Longer DTE reduces daily theta drag and gives a bearish thesis more room to develop; shorter DTE is cheaper but more exposed to being wrong on timing even if eventually right on direction. This spread shares its payoff shape with the bear call spread.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net long vega (modest, since the short put offsets part of the long put's vega). Rising IV — which commonly accompanies falling prices — tends to help this position on top of the directional move, a helpful correlation for bearish debit spreads. Falling IV in a quiet market works against the position and adds to theta drag.</p>
      </>
    ),
  },
  {
    id: 'iron-condor',
    name: 'Iron Condor',
    outlook: 'neutral',
    vega: 'short',
    diagram: {
      points: [[0, -1], [3, -1], [4, 0.7], [6, 0.7], [7, -1], [10, -1]],
      strikeMarkers: [{ x: 3, label: 'Long put wing' }, { x: 4, label: 'Short put' }, { x: 6, label: 'Short call' }, { x: 7, label: 'Long call wing' }],
    },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Combine a bull put spread below the market and a bear call spread above it, all four legs on the same expiration. You collect a net credit and profit if the stock stays between the two short strikes through expiration.</p>
        <h4>Best Markets</h4>
        <p>Low-movement, range-bound markets, or elevated-IV environments where you expect volatility (and therefore the stock's actual range) to be smaller than what's priced in. This is the classic "sell the range" income strategy.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Wider short strikes (further from the money on both sides) raise the probability of staying inside the range but shrink the credit collected relative to the width — a common target is a combined ~70–85% probability of profit using roughly 0.10–0.20 delta short strikes. 30–45 DTE is the traditional window: enough premium and a wide enough expected range, while theta decay accelerates meaningfully in the back half of that window. Very short-dated condors (weeklys) decay fast but leave little room for error if the stock moves; very long-dated condors collect more credit but expose the position to a longer list of potential catalysts.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net short vega — this is fundamentally a bet that realized movement will be smaller than implied movement. Rising IV after entry increases the value of both short strikes (a mark-to-market loss even if the stock hasn't moved) and effectively "prices in" a wider expected range than when you sold it, working against the position. Falling IV (vol crush, e.g., after an earnings report or a macro event passes without incident) is the single biggest tailwind for an iron condor, since both short legs lose value quickly. This is why condors are most commonly initiated when IV Rank is high and expected to mean-revert.</p>
      </>
    ),
  },
  {
    id: 'unbalanced-condor',
    name: 'Unbalanced (Skewed) Iron Condor',
    outlook: 'either',
    vega: 'short',
    diagram: {
      points: [[0, -1.3], [3, -1.3], [4, 0.6], [5.7, 0.6], [7.5, -2], [10, -2]],
      strikeMarkers: [{ x: 3, label: 'Long put wing' }, { x: 4, label: 'Short put (narrow side)' }, { x: 5.7, label: 'Short call' }, { x: 7.5, label: 'Long call wing (wide side)' }],
    },
    detail: (
      <>
        <h4>Setup</h4>
        <p>
          A standard iron condor built with <strong>different widths on the put side and the call side</strong>
          (or, less commonly, different short-strike deltas on each side rather than a symmetric ~equidistant
          structure). In the diagram above, the put spread is narrow (smaller max loss, tighter to the money) while
          the call spread is wide (larger max loss, further from the money) — but it can be built the other way
          just as easily. The two short strikes are still usually chosen at different deltas, and the wing widths
          no longer mirror each other the way a textbook, symmetric condor's do.
        </p>
        <h4>Best Markets</h4>
        <p>
          Same range-bound, elevated-IV setup as a standard iron condor, but used when you want the position to
          carry a directional lean or to account for volatility skew. Two common reasons to unbalance it: (1) you
          are mildly bullish or bearish and want more room on one side than the other — widening the call side
          (as above) gives the trade more room to run if the stock grinds higher, at the cost of a larger loss if
          it instead breaks down through the narrower put side; (2) equity and index options usually price OTM
          puts richer than OTM calls (volatility skew), so selling a put at the same delta as a call collects
          more credit — some traders rebalance the width or strike selection to equalize credit or risk between
          the two sides instead of leaving it skewed by the market's own pricing.
        </p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>
          Because the two sides are no longer symmetric, "probability of success" has to be evaluated per side,
          not as one blended number. Moving the untested (wide) side's short strike further out lowers the odds
          it's ever touched, while the narrow side's probability behaves exactly like a normal short vertical —
          closer to the money means a lower probability of staying OTM but a bigger credit. The net effect is that
          an unbalanced condor's overall probability of profit is driven mostly by whichever side is positioned
          more aggressively (closer to the money); the wide side mainly changes how bad the loss is on a breakout,
          not how often that breakout happens. DTE behaves the same as a standard condor — 30–45 DTE balances
          premium collection against gamma risk — but an unbalanced structure is more sensitive to being reviewed
          and re-skewed as the outlook or realized skew changes, since one side was deliberately placed off the
          "neutral" line.
        </p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>
          Net short vega overall, like a standard condor, but the two sides no longer have equal vega. The
          narrower, closer-to-the-money side carries more vega per contract than the wider, further-OTM side, so
          a broad IV move affects the position asymmetrically — a volatility spike tends to hurt the narrow side
          more in dollar terms. If the skew itself changes (puts getting relatively more expensive than calls, or
          vice versa, independent of the overall IV level), an unbalanced condor sized around today's skew can
          become mispriced relative to a fresh one, which is a risk a symmetric condor doesn't carry to the same
          degree.
        </p>
        <h4>Margin Requirements</h4>
        <p>
          This is the detail that catches people off guard with unbalanced condors. Both sides are still
          individually defined-risk vertical spreads, and at expiration the stock can only finish on one side of
          the range — it cannot be simultaneously below the put spread and above the call spread. Because of that,
          a standard "reg-T" broker margins the position at <strong>the larger of the two spreads' max loss, not
          the sum of both</strong>. For the diagram above (put spread max loss ≈ 1.3, call spread max loss ≈ 2.0,
          scaled units), the margin requirement is driven by the ~2.0 call-side max loss alone, less the total net
          credit collected — the put side's risk is already "inside" that number because both sides can't be hit
          at once. In other words, deliberately widening one side to collect a bit more credit or lean directional
          increases your capital requirement dollar-for-dollar with that side's max loss, even though it does
          <em> not</em> add to it on top of the narrow side. A symmetric condor with the same total credit and a
          smaller max width on its largest side will almost always be more capital-efficient (higher return on
          margin) than an unbalanced one with a wide "off" side — the wide side is effectively unpaid-for real
          estate on your buying power until it's tested. Always confirm the actual requirement in your broker's
          platform: portfolio-margin accounts calculate risk very differently (stress-testing the whole position
          across a price/vol grid) and can show a materially different — sometimes lower — number than a reg-T
          account for the exact same trade.
        </p>
      </>
    ),
  },
  {
    id: 'iron-butterfly',
    name: 'Iron Butterfly',
    outlook: 'neutral',
    vega: 'short',
    diagram: {
      points: [[0, -1], [3, -1], [5, 1.4], [7, -1], [10, -1]],
      strikeMarkers: [{ x: 3, label: 'Long put wing' }, { x: 5, label: 'Short straddle (ATM)' }, { x: 7, label: 'Long call wing' }],
    },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Sell an at-the-money call and put (a short straddle) and buy an OTM call and put further out as protection (the "wings"). This collects a larger credit than an iron condor for the same wing width, but has a much narrower profitable range centered on the strike.</p>
        <h4>Best Markets</h4>
        <p>Very range-bound, low-movement markets where you have a specific pinning price in mind — the strategy makes its maximum profit only if the stock finishes essentially exactly at the short strike.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Because the short strikes sit at the money by construction, the probability of landing exactly at max profit is inherently low — the appeal is the size of the credit (and therefore breakeven-to-breakeven range) relative to the wing width, not a high hit rate on max profit. Widening the wings increases max loss and max profit symmetrically and slightly widens the profitable range; narrowing them concentrates risk into a tighter band. Shorter DTE compresses the time available for the stock to drift away from the pin price, which is why iron butterflies are frequently used as short-dated (weekly, even 0DTE) range trades.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Strongly net short vega — more so than an iron condor, because the short legs are at the money where vega is highest. Rising IV is particularly damaging here since it increases the odds (and priced-in magnitude) of the stock moving away from the pin. Falling IV is a strong tailwind. This structure is most attractive right before a known volatility-crushing event (e.g., entering the day of an earnings report to be closed the next morning) rather than as a multi-week hold.</p>
      </>
    ),
  },
  {
    id: 'long-straddle',
    name: 'Long Straddle',
    outlook: 'either',
    vega: 'long',
    diagram: { points: [[1, 1.8], [5, -1.2], [9, 1.8]], continuesLeft: true, continuesRight: true, strikeMarkers: [{ x: 5, label: 'Same ATM strike, call + put' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Buy an at-the-money call and put with the same strike and expiration. You profit from a large move in either direction; the position loses (up to the total premium paid) if the stock sits still.</p>
        <h4>Best Markets</h4>
        <p>Ahead of a binary, high-uncertainty catalyst (earnings, an FDA decision, a court ruling) where you have a strong view that the stock will move a lot but no strong view on direction. Performs poorly in quiet, range-bound markets.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Being ATM by definition, "OTM distance" isn't the lever here — the key variable is how far the stock must move (in either direction) to clear the combined premium of both legs, i.e., the width of the breakeven range. That range widens with more DTE (more time value in both legs) and narrows as expiration nears. Because you need to overcome two premiums instead of one, the standalone probability of profit is often below 50% even though the potential reward is large in either direction — this is a reward-skewed, not probability-skewed, trade.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Maximally net long vega among common single-expiration strategies, since both legs are ATM (where vega is highest) and both are long. Rising IV increases the value of the position even before the stock moves — this is why straddles are often bought when IV Rank is low, ahead of a catalyst expected to expand volatility. The single biggest risk is "volatility crush": if the catalyst passes and IV collapses, both legs lose value from the vega side even if the stock does move, which can offset or overwhelm the delta-driven gains. This is the most common way long straddles disappoint traders who correctly predicted the move's size but not the IV dynamics around it.</p>
      </>
    ),
  },
  {
    id: 'long-strangle',
    name: 'Long Strangle',
    outlook: 'either',
    vega: 'long',
    diagram: { points: [[1, 1.6], [4, -1], [6, -1], [9, 1.6]], continuesLeft: true, continuesRight: true, strikeMarkers: [{ x: 4, label: 'Long put' }, { x: 6, label: 'Long call' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Buy an OTM call and an OTM put with the same expiration but different strikes. Cheaper than a straddle (both legs are OTM, so less extrinsic value to pay for) but requires a bigger move to reach either breakeven.</p>
        <h4>Best Markets</h4>
        <p>Same use case as a long straddle — a big expected move with unclear direction — but for traders who want lower upfront cost and are willing to accept a wider "dead zone" where the position loses money if the stock stays inside the strikes.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Placing the strikes further apart lowers the upfront cost and maximum loss but widens the flat-bottom "dead zone," lowering the probability that either leg profits. Tighter strikes (closer to a straddle) cost more but need a smaller move to succeed. As with a straddle, more DTE widens the effective breakeven range (more time value to overcome) while also giving the anticipated move more time to happen — the net effect on probability of profit depends on which grows faster, the required move or the available time.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net long vega, though somewhat less per dollar of premium than an ATM straddle since OTM options carry less vega than ATM ones. The same volatility-crush risk applies: buying when IV Rank is low and the catalyst hasn't yet been priced in is far more favorable than buying rich, elevated IV that is likely to collapse regardless of how the stock moves.</p>
      </>
    ),
  },
  {
    id: 'short-straddle',
    name: 'Short Straddle',
    outlook: 'neutral',
    vega: 'short',
    diagram: { points: [[1, -1.8], [5, 1.2], [9, -1.8]], continuesLeft: true, continuesRight: true, strikeMarkers: [{ x: 5, label: 'Same ATM strike, call + put' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Sell an at-the-money call and put with the same strike and expiration. You collect the combined premium of both legs; this is the largest credit obtainable from a single-strike strategy, but carries undefined (in practice very large) risk in either direction.</p>
        <h4>Best Markets</h4>
        <p>Very quiet, tightly range-bound markets where you have high conviction that realized movement will be small — and ideally a willingness or plan to manage a large adverse move, since risk is not capped.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Because both legs are sold ATM, this has a relatively high probability of some profit (the stock just needs to stay inside a fairly wide breakeven band built from two premiums) but an unfavorable, asymmetric reward-to-risk: frequent modest wins against the possibility of a rare, very large loss. Shorter DTE increases theta collection per day and shrinks the window for an adverse move, which is why short straddles are more commonly run short-dated with active management (or in "0DTE"-style strategies) than held for months.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Maximally net short vega among common strategies — both legs are ATM and both are short. This is the purest available bet that implied volatility overstates realized volatility. Rising IV after entry causes rapid, large mark-to-market losses even without the stock moving; falling IV (vol crush) causes rapid gains. Because of the undefined risk and high vega, position sizing and having a predefined exit or hedge plan matter far more here than in defined-risk strategies.</p>
      </>
    ),
  },
  {
    id: 'short-strangle',
    name: 'Short Strangle',
    outlook: 'neutral',
    vega: 'short',
    diagram: { points: [[1, -1.6], [4, 1], [6, 1], [9, -1.6]], continuesLeft: true, continuesRight: true, strikeMarkers: [{ x: 4, label: 'Short put' }, { x: 6, label: 'Short call' }] },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Sell an OTM call and an OTM put with the same expiration. Collects less premium than a short straddle but widens the profitable range — the stock can move somewhat and still finish between the two strikes for max profit.</p>
        <h4>Best Markets</h4>
        <p>Range-bound to moderately volatile markets — the wider strikes make this more forgiving than a short straddle if the stock does drift, while still carrying undefined risk if it breaks out sharply in either direction.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Wider strikes (further OTM) raise the probability of the stock finishing inside the range and reduce max loss risk in relative terms, but shrink the premium collected — this is the same dial used in the "sell the wings at a target delta" approach common to iron condors, just without the protective long legs. 30–45 DTE is a common balance; many traders also manage or close short strangles well before expiration (e.g., at 21 DTE or after capturing 50% of max profit) specifically because gamma and vega risk both accelerate as expiration nears.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net short vega, smaller in magnitude than a short straddle since OTM strikes carry less vega than ATM ones, but still meaningfully exposed to an IV spike. A sudden rise in IV — from a surprise macro shock or company news — increases the value of both short legs and can produce a large mark-to-market loss even if the stock hasn't yet reached either strike. Falling IV benefits the position. Selling strangles when IV Rank is high improves the premium collected per unit of risk taken.</p>
      </>
    ),
  },
  {
    id: 'calendar-spread',
    name: 'Calendar Spread (Time Spread)',
    outlook: 'neutral',
    vega: 'long',
    diagram: {
      points: [[0, -0.5], [2, -0.5], [3.5, 0.2], [5, 1.1], [6.5, 0.2], [8, -0.5], [10, -0.5]],
      strikeMarkers: [{ x: 5, label: 'Same strike, two expirations' }],
    },
    detail: (
      <>
        <h4>Setup</h4>
        <p>Sell a near-term option and buy a longer-dated option at the same strike (usually at or near the money). You pay a net debit. The near-term option decays faster than the far-dated option, so if the stock sits near the strike, the position gains value as the front-month leg loses time value faster than the back-month leg does. This shape is a snapshot at the near-term expiration, not the true expiration of the position — the long-dated leg is still alive afterward.</p>
        <h4>Best Markets</h4>
        <p>Low-movement, range-bound markets where you expect the stock to sit near the strike through the near-term expiration. A neutral cousin of the covered call, but built entirely from options and structured around uneven time decay rather than a directional short strike.</p>
        <h4>Probability of Success vs. DTE &amp; OTM Distance</h4>
        <p>Placing the strike ATM maximizes theta differential and the size of the "hump" of the payoff curve, but also maximizes sensitivity to the stock drifting away from that strike. The further apart the two expirations are, the more the position resembles a long-dated option overall (more vega, slower theta benefit from the front month relative to the position's total cost); a very short gap between expirations concentrates the trade tightly around the near-term date. Because the maximum loss is limited to the net debit paid regardless of how far the stock moves, this is a defined-risk way to make a range-bound, "pin near the strike" bet.</p>
        <h4>Reaction to Rising / Falling Volatility</h4>
        <p>Net long vega overall — the longer-dated long option has more vega than the shorter-dated short option, since vega generally scales with the square root of time to expiration. Rising IV, especially a uniform rise across the term structure, benefits the far-dated leg more than it hurts the near-dated leg, helping the position. This makes calendar spreads a relatively unusual combination: a neutral, range-bound bet that is also a long-volatility bet, often used specifically when a trader expects a stock to pin near a strike now but for volatility to pick up further out (e.g., an event scheduled after the near-term expiration).</p>
      </>
    ),
  },
]

function StrategyCard({ strategy, isOpen, onToggle }) {
  return (
    <div className={`cef-guide-card${isOpen ? ' cef-guide-card--open' : ''}`}>
      <button className="cef-guide-header" onClick={onToggle} aria-expanded={isOpen}>
        <span className="cef-guide-number">{strategy.icon || strategy.name.charAt(0)}</span>
        <span className="cef-guide-question">{strategy.name}</span>
        <span className="cef-guide-chevron">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="opt-edu-guide-card">
          <div className="opt-edu-payoff-wrap">
            <div className="opt-edu-tag-row">
              <OutlookTag outlook={strategy.outlook} />
              <VegaTag vega={strategy.vega} />
            </div>
            <OptionPayoffDiagram title={`${strategy.name} payoff at expiration`} {...strategy.diagram} />
            <div className="opt-edu-legs-note">
              Illustrative P&amp;L at expiration only — strike spacing and premiums are stylized to show the
              <strong> shape</strong> of the risk graph, not real market pricing.
            </div>
          </div>
          <div className="opt-edu-guide-copy">{strategy.detail}</div>
        </div>
      )}
    </div>
  )
}

function StrategySection() {
  const [open, setOpen] = useState('covered-call')
  return (
    <div className="cef-edu-section" style={{ maxWidth: 1100 }}>
      <div className="cef-edu-compare-intro">
        <p>
          Every strategy below is built from the same two building blocks — long/short calls and long/short puts —
          combined to shape a specific risk profile. Each card shows a stylized payoff-at-expiration diagram, the
          market environment it fits best, how its probability of success responds to time (DTE) and strike
          distance (OTM%), and how it reacts when implied volatility rises or falls.
        </p>
      </div>
      <div className="cef-guide-list" style={{ maxWidth: 'none' }}>
        {STRATEGIES.map(strategy => (
          <StrategyCard
            key={strategy.id}
            strategy={strategy}
            isOpen={open === strategy.id}
            onToggle={() => setOpen(open === strategy.id ? null : strategy.id)}
          />
        ))}
      </div>
    </div>
  )
}

export default function OptionEducation() {
  const [activeTab, setActiveTab] = useState('basics')

  return (
    <div className="page cef-page">
      <div className="cef-title-row">
        <div>
          <h1>Option Strategy Education</h1>
          <p>What puts and calls are, and how the most common option strategies behave across markets, time, and volatility.</p>
        </div>
      </div>

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

      {activeTab === 'basics' ? <BasicsSection /> : <StrategySection />}

      <div className="cef-disclosure" style={{ marginTop: 32 }}>
        <strong>Disclaimer</strong>
        <p>
          This guide is for educational purposes only and does not constitute investment or trading advice.
          Options involve significant risk and are not suitable for all investors. Payoff diagrams are
          illustrative and simplified — they do not reflect commissions, assignment risk, early exercise, dividends,
          or real market pricing. Probability-of-success language reflects delta/price-implied odds, not
          guarantees. Consult a qualified financial advisor before trading options.
        </p>
      </div>
    </div>
  )
}
