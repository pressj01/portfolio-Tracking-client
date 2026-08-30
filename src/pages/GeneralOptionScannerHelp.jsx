import { Link } from 'react-router-dom'
import { DefinitionList, HelpSection, helpImage } from '../components/GosHelpKit'

const helpTopics = [['quick-start', 'Quick start'], ['universe', 'Underlyings'], ['starting-points', 'Starting points'], ['filters', 'Filters'], ['terms', 'Key terms'], ['condors', 'Condors'], ['results', 'Results'], ['probabilities', 'Probabilities'], ['strategies', 'Every strategy'], ['example', 'Example']]

const universeRows = [
  ['Core index ETFs', 'SPY, QQQ, and IWM only. Choose this when those are the underlyings you expect.'],
  ['All index ETFs', 'The broader index-fund list, including equity, international, and bond index funds such as EMB, JNK, and TLT.'],
  ['Sector ETFs', 'Sector and industry funds such as XLK, XLE, SMH, KRE, and GDX.'],
  ['Commodity ETFs', 'Commodity funds such as GLD, SLV, DBC, USO, and DBA.'],
  ['Stocks', 'The selected large-cap, mid-cap, holdings, or watchlist stock universe.'],
  ['My holdings', 'Names in the currently selected portfolio. The My holdings setup uses this for covered calls, collars, and married puts.'],
  ['Exact symbols', 'A comma-separated list overrides every universe choice until the list is cleared.'],
]

const filterRows = [
  ['Descriptive data', 'Chooses the underlyings: stocks, core or broad index ETFs, sector ETFs, commodity ETFs, or exact symbols.'],
  ['Quality and liquidity', 'Drops names that are too small or too thinly traded, and applies the Earnings in the trade filter to stocks. Results to show chooses Exact matches only or Nearest trades if none qualify. Every starting point and setup defaults to the nearest-trade fallback. Switch Earnings to Allow or Require if you want the event. Funds are not earnings-filtered.'],
  ['Fundamental data', 'Applies the app’s 1–10 Fundamental, Growth, and Technical scores. Fundamental and Growth are not required for ETFs because those company measures do not apply cleanly to funds.'],
  ['Technical market conditions', 'Filters by the SPY trend, the underlying trend, recent price direction, lookback, minimum move, and RSI.'],
  ['Consolidated options data', 'Filters the option chain by total contract volume, locally collected IV Rank (a percentile), IV − RV, IV − RV Rank, RV Rank, Volatility score, Put Skew Rank, Call Skew Rank, and Skew Rank. Risk and Setup presets require a favorable vol skew for the selected strategy.'],
  ['Option data', 'Controls expiration/DTE, the assumed bid/ask fill, and the reference-leg delta when the construction uses one.'],
  ['Strategy specific', 'Changes with the selected trade. It contains payoff, risk, probability, moneyness, and construction rules.'],
]

const condorStructures = [
  ['Balanced', 'A classic four-leg iron condor with equal put- and call-wing widths.'],
  ['Strike tilt', 'Shifts strike placement toward a bullish or bearish market view.'],
  ['Ratio tilt', 'Uses extra contracts on one side to change the payoff shape.'],
  ['Centred ratio', 'A ratio construction centered around the selected placement.'],
  ['Weirdor', 'The scanner’s asymmetric ratio-style condor variation.'],
  ['Weirdor (hedged)', 'Adds the hedge defined by the Weirdor construction rules.'],
  ['Jeep', 'The scanner’s supported six-leg Jeep variation.'],
  ['All variations', 'Builds and compares every supported Iron Condor construction.'],
]

export default function GeneralOptionScannerHelp() {
  return <main className="page gos-help-page">
    <header className="gos-help-hero">
      <div><span>GENERAL OPTION SCANNER GUIDE</span><h1>From universe to analyzed trade</h1><p>The scanner first builds valid option structures, then applies your filters, keeps the best result for each ticker, and opens the selected trade in the probability and payoff analyzer.</p></div>
      <Link className="btn btn-sm btn-primary" to="/general-option-scanner?strategy=iron-condor">Open the scanner</Link>
    </header>

    <nav className="gos-help-jumps" aria-label="Scanner help topics">
      {helpTopics.map(([id, label]) => <button type="button" key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}>{label}</button>)}
    </nav>

    <HelpSection id="quick-start" eyebrow="1 · WORKFLOW" title="The scanner in six steps">
      <ol className="gos-help-steps">
        <li><b>Choose a strategy.</b><span>The strategy changes the available construction rules and defaults.</span></li>
        <li><b>Choose what to scan.</b><span>Open Include symbols and select a stock/ETF universe or enter exact tickers.</span></li>
        <li><b>Choose a starting point.</b><span>Open Filters is broad. Risk Averse, Moderate, and Aggressive change how strict the scan is. Setup buttons under that row pick a market condition or universe and only appear when they fit the selected strategy.</span></li>
        <li><b>Edit green values.</b><span>Click any value to change that rule. The small ? explains the field; “What does this mean?” opens the longer description.</span></li>
        <li><b>Run Scan.</b><span>The existing strategy module prices current chains and builds real candidate structures.</span></li>
        <li><b>Select a result.</b><span>Review its legs, probabilities, expected value, maximum risk, and interactive P/L graph.</span></li>
      </ol>
      <figure className="gos-help-figure"><img src={helpImage('general-scanner-overview.png')} alt="General Option Scanner with the strategy, presets, filter panel, results table, and analysis area" /><figcaption>The left side defines the scan. The right side shows the best structure for each ticker and analyzes the selected row.</figcaption></figure>
    </HelpSection>

    <HelpSection id="universe" eyebrow="2 · UNDERLYINGS" title="Choose exactly what the system scans">
      <p className="gos-help-lead"><strong>SPY, QQQ, and IWM are Core index ETFs.</strong> “All index ETFs” is intentionally broader and can return funds such as EMB, JNK, IJR, TLT, or VWO. Stocks, sectors, and commodities are independent choices.</p>
      <figure className="gos-help-figure"><img src={helpImage('general-scanner-universe.png')} alt="Include symbols editor showing the Scan universe dropdown and stock, index ETF, sector ETF, and commodity ETF checkboxes" /><figcaption>Use a named combination in the dropdown, then fine-tune it with the checkboxes. Exact symbols override these switches.</figcaption></figure>
      <DefinitionList rows={universeRows} />
      <aside className="gos-help-callout"><b>If you expect only SPY, QQQ, and IWM</b><span>Select <strong>Core index ETFs — SPY, QQQ, IWM</strong>. Do not select All index ETFs.</span></aside>
      <aside className="gos-help-callout"><b>Technical exceptions are shown explicitly</b><span>The specialized Put / Call Condor module supports SPY and Mini-SPX (^XSP) only and prices one underlying per run. Long-dated unbalanced structures are limited to index ETFs. Those scans replace the broad universe selector with their supported choices.</span></aside>
    </HelpSection>

    <HelpSection id="starting-points" eyebrow="3 · STARTING POINTS" title="What each scan is for, and the typical success odds">
      <p className="gos-help-lead">
        <strong>Starting point</strong> buttons change how strict the scan is. <strong>Setup</strong> buttons pick a market condition, expiration window, or universe — and only appear when they fit the selected strategy.
        Setup scans start from Moderate quality (size, volume, open interest), then overlay that setup.
      </p>
      <figure className="gos-help-figure">
        <img src={helpImage('general-scanner-setups-bar.png')} alt="Scanner starting-point buttons Open Filters, Risk Averse, Moderate, Aggressive, and the Setup row with Pullback uptrend, High IV, Weeklies, Monthlies, and Core indexes" />
        <figcaption>Covered Call shows bullish and short-premium setups. A long call replaces High IV with Cheap IV; a bear call spread shows Rally downtrend instead of Pullback uptrend; covered call, collar, and married put also get My holdings.</figcaption>
      </figure>

      <aside className="gos-help-warning">
        <b>These are modeled expiration probabilities, not historical win rates</b>
        <span>
          Credit-trade “typical success” is the usual chance a 15–20 delta short option expires out of the money (~80–85%), which is also why Moderate requires at least 55% probability of max profit on defined-risk structures.
          Debit trades are the opposite: Moderate uses 45–60 delta longs and only requires 25% probability of max profit, so a winning long call is expected less often than a winning short put.
          Changing DTE, IV Rank, or the universe does not by itself raise those odds — it changes which names you scan and how much you are paid for the same probability.
        </span>
      </aside>

      <h3 className="gos-help-subhead">How strict is the scan?</h3>
      <div className="gos-help-setup-grid">
        <article>
          <b>Open Filters</b>
          <p className="gos-help-pop">Typical success: unconstrained</p>
          <p>Discovery only. It keeps the strategy’s strikes and DTE construction but turns off quality, trend, and probability floors. Earnings in the trade is Allow. If nothing passes every rule, nearest constructible trades are shown. Use it to see what exists, then tighten.</p>
        </article>
        <article>
          <b>Risk Averse</b>
          <p className="gos-help-pop">Credit: ~85–95% · floor 65% · 5–15Δ short</p>
          <p>Highest-probability short-premium entries: further OTM, skip earnings, favorable vol skew, conservative fills, larger names. If nothing passes every rule, nearest constructible trades are still shown and labelled as near matches. Debit trades use 60–75 delta longs and a 35% max-profit floor — still a directional bet, not a 90% income trade.</p>
        </article>
        <article>
          <b>Moderate</b>
          <p className="gos-help-pop">Credit: ~80–85% · floor 55% · 15–20Δ short</p>
          <p>The default “tradable” pack. Setup buttons start here. Debit trades use 45–60 delta and a 25% max-profit floor. Stocks with earnings inside the expiration are skipped, and the selected strategy’s favorable vol skew is required. If nothing passes every rule, nearest constructible trades are shown. Change Earnings in the trade if you want the event.</p>
        </article>
        <article>
          <b>Aggressive</b>
          <p className="gos-help-pop">Credit: ~50–70% · floor 40% · 30–50Δ short</p>
          <p>Closer strikes, fatter credit, more assignment/ITM risk. Debit floor drops to 15%. Use when you want premium or leverage, not when you want a high win rate.</p>
        </article>
      </div>

      <h3 className="gos-help-subhead">Setup scans — when to use each one</h3>
      <div className="gos-help-setup-grid">
        <article>
          <b>My holdings</b>
          <p className="gos-help-pop">Typical success: same as Moderate for that strategy (~80–85% on a covered-call short)</p>
          <p><strong>Good for:</strong> writing calls, collars, or married puts on shares you already own. Covered calls also require 100+ shares and keep the strike above cost basis. Hidden on cash-secured puts and condors — those are not “sell premium on what I hold” workflows.</p>
        </article>
        <article>
          <b>Pullback uptrend</b>
          <p className="gos-help-pop">Credit (CSP / bull put / covered call): ~80–85% · Debit (long call): ~25–40% to max profit</p>
          <p><strong>Good for:</strong> selling put premium or calls after a dip that is still in a 50/200 uptrend. The filter is timing, not a higher win rate — the delta band is still Moderate’s 15–20 short / 45–60 long.</p>
        </article>
        <article>
          <b>Rally downtrend</b>
          <p className="gos-help-pop">Credit (bear call / naked call): ~80–85% · Debit (long put / bear put): ~25–40% to max profit</p>
          <p><strong>Good for:</strong> fading a bounce in a confirmed downtrend. Same Moderate probability as Pullback, opposite direction. Hidden on bullish put-selling structures.</p>
        </article>
        <article>
          <b>High IV</b>
          <p className="gos-help-pop">Typical success: ~80–85% (same 15–20Δ as Moderate)</p>
          <p><strong>Good for:</strong> credit trades when you want to be paid more for that probability — IV Rank ≥ 40, Volatility score ≥ 50, skip earnings, tighter bid/ask. It does not push strikes further OTM, so do not expect 90% winners from this button alone.</p>
        </article>
        <article>
          <b>Cheap IV</b>
          <p className="gos-help-pop">Typical success: ~25–40% to max profit (debit / long premium)</p>
          <p><strong>Good for:</strong> long calls, long puts, and debit verticals when you do not want to buy rich options (IV Rank cap 50). Success is lower because you need the underlying to move. Hidden on credit trades.</p>
        </article>
        <article>
          <b>Weeklies</b>
          <p className="gos-help-pop">Typical success: ~80–85% credit / ~25–40% debit — same deltas, 5–14 DTE</p>
          <p><strong>Good for:</strong> harvesting theta on liquid names this week or next. The win-rate math is similar to monthlies at the same delta; gap and gamma risk are higher. Hidden on calendars, the SPY/Mini-SPX condor, and 70–200 DTE index flies.</p>
        </article>
        <article>
          <b>Monthlies</b>
          <p className="gos-help-pop">Typical success: ~80–85% credit / ~25–40% debit · 21–45 DTE</p>
          <p><strong>Good for:</strong> the conventional monthly expiration window. Same Moderate probability as the starting-point default, with DTE tightened so you are not mixing weeklies and 60-day options.</p>
        </article>
        <article>
          <b>Core indexes</b>
          <p className="gos-help-pop">Typical success: ~80–85% credit / ~25–40% debit on SPY, QQQ, IWM</p>
          <p><strong>Good for:</strong> liquid index chains only — no stock-score noise, no EMB/TLT-style “all index ETFs” surprises. Hidden on the specialized SPY/Mini-SPX condor, which already names its underlyings.</p>
        </article>
      </div>
      <p className="gos-help-note">A preset is a starting point, not a promise that today’s market has a qualifying trade. Editing one green value changes the profile to Custom. Read the selected row’s Probability of success card before placing anything — that number is the trade’s own model, not the preset’s typical band.</p>
    </HelpSection>

    <HelpSection id="filters" eyebrow="4 · FILTERS" title="What each filter group does">
      <DefinitionList rows={filterRows} />
      <p className="gos-help-note">The Starting point and Setup buttons load a coordinated set of these fields. The Starting points section above explains when to use each scan and the typical success odds.</p>
    </HelpSection>

    <HelpSection id="terms" eyebrow="5 · DEFINITIONS" title="The terms that most affect a scan">
      <div className="gos-help-term-grid">
        <article><h3>Moneyness</h3><p>The strike’s percentage distance from the underlying price:</p><code>(strike − price) ÷ price × 100</code><p>Negative is below the current price; positive is above it. The effect depends on whether the leg is a put or call and whether it is bought or sold.</p></article>
        <article><h3>DTE</h3><p>Days to expiration. A 7–45 DTE rule lets the strategy evaluate listed expirations in that window and prefer its target DTE where supported.</p></article>
        <article><h3>Reference delta</h3><p>The absolute delta of the primary construction leg. For income/credit trades this is usually the short leg; for directional debit trades it is usually the long leg.</p></article>
        <article><h3>IV Rank</h3><p>The column is called IV Rank to match common scanner language, but the value is a percentile: the share of prior daily ATM IV prints in the past year that were below today. Front-month (about 21–60 DTE) observations are preferred so weekly and LEAP scans do not mix, and one-day IV spikes are ignored. It needs about 20 daily observations. High values (for example above 80) have historically been followed by lower IV, and low values by higher IV.</p></article>
        <article><h3>IV − RV</h3><p>Today’s at-the-money implied volatility minus the past month’s realized volatility, in volatility points. Positive means options look expensive versus recent realized movement; negative means they look cheaper than the past month.</p></article>
        <article><h3>IV − RV Rank</h3><p>A 0–100 percentile of today’s IV − RV versus the same spread over the past year. It is mean-reverting. It uses the stored IV snapshots paired with realized vol from price history, so it warms up with IV Rank.</p></article>
        <article><h3>RV Rank</h3><p>A 0–100 percentile of the past month’s realized volatility versus the previous year. It shows whether recent actual movement is high or low for this name and is also mean-reverting.</p></article>
        <article><h3>Volatility score</h3><p>The average of IV Rank and IV − RV Rank. A high score is a smoother signal that options look overpriced; a low score that they look underpriced. An asterisk marks a provisional reading while fewer than about 20 daily observations are available.</p></article>
        <article><h3>Earnings in the trade</h3><p>Skip hides stocks whose next report falls on or before expiration. Allow includes those names. Require keeps only stocks with earnings inside the selected expiration. Funds are not filtered. Missing report dates are not treated as a hit for Skip, and they fail Require. Put/call spread, put-selling, and call-selling presets start on Skip.</p></article>
        <article><h3>Put / Call Skew Rank</h3><p>Put Skew Rank is 25-delta put IV minus ATM put IV; Call Skew Rank is the same reading on the call side. High values mean that wing is unusually expensive. Put-selling and put-spread presets require expensive puts; call-selling and call-spread presets require expensive calls.</p></article>
        <article><h3>Skew Rank</h3><p>Ranks the roughly 30-DTE 25-delta put-IV minus 25-delta call-IV gap. High values mean puts are unusually expensive versus calls; low values mean calls are unusually expensive. Put-selling presets prefer a high reading; call-selling presets prefer a low reading.</p></article>
        <article><h3>What “Warming up” means</h3><p>The app is collecting at most one usable skew observation per ticker per day. Zero days means that specific metric lacked usable 25-delta or ATM inputs; one or two days means the raw gaps were saved but cannot yet support a percentile. From 3–19 days the app shows a provisional rank marked with an asterisk. At about 20 usable daily observations the asterisk disappears. Re-running a scan on the same day does not increase the count, and the count is unrelated to DTE.</p></article>
        <article><h3>Expected value</h3><p>The probability-weighted expiration payoff from the model. Positive modeled EV does not guarantee a profitable trade.</p></article>
        <article><h3>Profit ratio</h3><p>Maximum profit divided by maximum loss. A 25% ratio means $25 of maximum profit for every $100 of maximum loss.</p></article>
        <article><h3>Stock Scores F / G / T</h3><p>Fundamental, Growth, and Technical scores from 1–10. ETFs normally show no Fundamental or Growth score; Technical can still be calculated.</p></article>
        <article><h3>Bid/Ask level</h3><p>The entry-price assumption. Conservative uses less favorable quotes, Mid uses midpoint pricing, and 25% improvement moves one quarter of the way toward mid.</p></article>
      </div>
    </HelpSection>

    <HelpSection id="condors" eyebrow="6 · IRON CONDOR" title="Balanced, Weirdor, Jeep, and the other constructions">
      <p className="gos-help-lead">Open the green <strong>Structure</strong> value in Strategy specific. Weirdor is a construction choice inside Iron Condor; it is not a separate scanner page.</p>
      <figure className="gos-help-figure"><img src={helpImage('general-scanner-condor-structures.png')} alt="Iron Condor controls showing Structure, Market view, Variant tickers, Variant width, Tilt strength, Ratio contracts, and Core index variants only" /><figcaption>Non-standard variants default to SPY, QQQ, and IWM because ratio and hedged structures need deep, reliable index-option chains.</figcaption></figure>
      <DefinitionList rows={condorStructures} />
      <aside className="gos-help-callout"><b>Shape and Structure are different</b><span><strong>Iron Condor shape</strong> tests the completed payoff geometry (Any, Balanced, Riskless Up, Riskless Down). <strong>Structure</strong> chooses which construction algorithm builds the legs.</span></aside>
    </HelpSection>

    <HelpSection id="results" eyebrow="7 · RESULTS" title="Exact matches versus constructible near matches">
      <figure className="gos-help-figure"><img src={helpImage('general-scanner-results.png')} alt="General Option Scanner results with a near-match warning, rows, missed-rule badges, and the selected trade analysis" /><figcaption>Exact matches pass every active rule. A yellow near-match row is a real, priced structure that missed one or more rules.</figcaption></figure>
      <div className="gos-help-two-column">
        <article><h3>Exact match</h3><p>The row passed every active filter, including max loss, skew, and earnings. The table shows the best-ranked structure for each ticker; click the ⊕ ticker control to drill into more candidates for that ticker. Starting points default to nearest trades if none qualify; switch Results to show to Exact matches only when you want an empty table instead of near matches.</p></article>
        <article><h3>Near match</h3><p>If Results to show is set to Nearest trades if none qualify and nothing passed every rule, the scanner can show the closest constructible trades. Those rows are not approvals of the missed rules — a $2,400 max loss against a $500 cap is still a miss. The row badge gives the number of missed rules; selecting it lists the exact rules above the analysis.</p></article>
      </div>
      <aside className="gos-help-warning"><b>Example: the IWF Risk Averse result</b><span>IWF showed total option volume of 596 against a required 5,000 and probability of max profit of 62.1% against a required 65%. It was therefore a near match—not a trade that passed the preset.</span></aside>
      <figure className="gos-help-figure"><img src={helpImage('general-scanner-near-match-example.png')} alt="Risk Averse Iron Condor scan showing the no exact preset match banner and the selected IWF near-match structure" /><figcaption>In this Risk Averse scan, the warning banner and yellow row edges indicate fallback near matches. The selected IWF structure is valid and priced, but it did not satisfy every green rule on the left.</figcaption></figure>
      <p className="gos-help-note">Probability of success/failure, expected value, maximum profit/loss, and the P/L graph are modeled estimates based on current chain data, pricing assumptions, implied volatility, and expiration payoff. They are not guarantees.</p>
    </HelpSection>


    <HelpSection id="probabilities" eyebrow="8 · PROBABILITIES" title="Reading the success cards and the profit-capture table">
      <p className="gos-help-lead">A selected trade carries two probability blocks, and they answer different questions. Mixing them up is the most common way to misread the analysis, so it is worth being precise about what each one measures.</p>

      <div className="gos-help-two-column">
        <article>
          <h3>Probability of success</h3>
          <p>The chance the complete position can be closed for more than $0 at <strong>one specific moment</strong>. The headline is expiration; each management checkpoint below it is the same calculation run at that earlier date.</p>
        </article>
        <article>
          <h3>Taking profit early</h3>
          <p>The chance a partial-profit target — half or two-thirds of the trade&rsquo;s maximum profit — is worth acting on. Most short-premium plans close there rather than holding to expiration, so these are the odds those plans actually run on.</p>
        </article>
      </div>

      <aside className="gos-help-callout">
        <b>Why the early checkpoints read lower, not higher</b>
        <span>Exiting early feels safer, so the checkpoint figures look wrong at first glance. They are not. Closing early means buying back time value you have not yet earned, so the price you need is closer to today&rsquo;s than the expiration breakeven is. On a credit spread sold $10 out of the money for $0.45, the expiration breakeven sits near the short strike, but halfway through the trade the spread still has to be bought back for less than the credit — which needs the underlying several dollars nearer. The tighter price distribution over a shorter horizon helps, but the shrinking target hurts more. Early exit lowers your <em>risk</em>; it does not raise your odds of being green at that moment.</span>
      </aside>

      <aside className="gos-help-callout">
        <b>The two numbers in each profit-capture cell</b>
        <span><strong>Reached by then</strong> is a path measure: the chance the target is available at least once on or before that date, which is what a resting good-till-cancelled closing order needs in order to fill. <strong>Still there on the day</strong> is a single-moment measure: the chance the position is at or past the target on that date itself. The second is always lower, because a target reached early can be handed back.</span>
      </aside>

      <aside className="gos-help-warning">
        <b>Why &ldquo;by expiration&rdquo; can exceed the probability of success</b>
        <span>A trade can show 88.3% probability of success at expiration while the 50%-of-max-profit target shows 93.9% by expiration. That is not a contradiction. Success is measured only at expiration, so a path that reached the target in week two and then reversed into a loss counts against success but still counts as reached. To compare like with like, use <strong>still there on the day</strong> at expiration — in that example 87.7%, which sits just below 88.3%, as it must: finishing at the target is a subset of finishing profitable at all. On a credit spread those two sit close together because the payoff is nearly a step, and the band between breakeven and half the maximum profit is narrow.</span>
      </aside>

      <p className="gos-help-note">All of these are option-implied, risk-neutral estimates that hold each leg&rsquo;s implied volatility constant and exclude commissions and slippage. They are risk gauges, not forecasts.</p>
    </HelpSection>

    <HelpSection id="strategies" eyebrow="9 · EVERY STRATEGY" title="What the Strategy specific inputs do, trade by trade">
      <p className="gos-help-lead">This guide covers the six filter groups that work the same way for every trade. The <strong>Strategy specific</strong> group is the one that changes — it holds that trade's own construction, payoff, and risk rules. The full field-by-field reference for all 30 supported strategies lives on its own page.</p>
      <div className="gos-help-footer-actions"><Link className="btn btn-primary" to="/general-option-scanner/strategies">Open the strategy field reference</Link></div>
    </HelpSection>

    <HelpSection id="example" eyebrow="10 · EXAMPLE" title="Scan only SPY, QQQ, and IWM for an Iron Condor">
      <ol className="gos-help-example">
        <li>Select <strong>Iron Condor</strong>.</li>
        <li>Click the <strong>Core indexes</strong> setup (or open Include symbols and choose Core index ETFs — SPY, QQQ, IWM).</li>
        <li>Optionally click <strong>High IV</strong> if you want expensive options, or <strong>Monthlies</strong> for the 21–45 DTE window.</li>
        <li>Under Strategy specific, set <strong>Structure</strong> to Balanced, Weirdor, Jeep, or All variations.</li>
        <li>Click <strong>Run Scan</strong>.</li>
        <li>Read the selected row’s Probability of success card — that is this trade’s model, not the preset’s typical band.</li>
      </ol>
      <div className="gos-help-footer-actions"><Link className="btn btn-primary" to="/general-option-scanner?strategy=iron-condor">Try the Iron Condor example</Link><Link className="btn btn-outline" to="/help">Open general app help</Link></div>
    </HelpSection>
  </main>
}
