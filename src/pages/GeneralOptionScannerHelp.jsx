import { Link } from 'react-router-dom'
import { DefinitionList, HelpSection, helpImage } from '../components/GosHelpKit'

const helpTopics = [['quick-start', 'Quick start'], ['universe', 'Underlyings'], ['filters', 'Filters'], ['terms', 'Key terms'], ['condors', 'Condors'], ['results', 'Results'], ['strategies', 'Every strategy'], ['example', 'Example']]

const universeRows = [
  ['Core index ETFs', 'SPY, QQQ, and IWM only. Choose this when those are the underlyings you expect.'],
  ['All index ETFs', 'The broader index-fund list, including equity, international, and bond index funds such as EMB, JNK, and TLT.'],
  ['Sector ETFs', 'Sector and industry funds such as XLK, XLE, SMH, KRE, and GDX.'],
  ['Commodity ETFs', 'Commodity funds such as GLD, SLV, DBC, USO, and DBA.'],
  ['Stocks', 'The selected large-cap, mid-cap, holdings, or watchlist stock universe.'],
  ['Exact symbols', 'A comma-separated list overrides every universe choice until the list is cleared.'],
]

const filterRows = [
  ['Descriptive data', 'Chooses the underlyings: stocks, core or broad index ETFs, sector ETFs, commodity ETFs, or exact symbols.'],
  ['Fundamental data', 'Applies the app’s 1–10 Fundamental, Growth, and Technical scores. Fundamental and Growth are not required for ETFs because those company measures do not apply cleanly to funds.'],
  ['Technical market conditions', 'Filters by the SPY trend, the underlying trend, recent price direction, lookback, minimum move, and RSI.'],
  ['Consolidated options data', 'Filters the option chain by total contract volume, locally collected IV Rank (a percentile), IV − RV, IV − RV Rank, RV Rank, and Volatility score.'],
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
        <li><b>Choose a starting point.</b><span>Open Filters is broad. Risk Averse, Moderate, and Aggressive replace the filter values with progressively different presets.</span></li>
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

    <HelpSection id="filters" eyebrow="3 · FILTERS" title="What each filter group does">
      <DefinitionList rows={filterRows} />
      <div className="gos-help-preset-grid">
        <article><b>Open Filters</b><p>Broad discovery. It keeps the strategy’s construction defaults while minimizing screening restrictions.</p></article>
        <article><b>Risk Averse</b><p>Favors tighter risk, quality, liquidity, and lower-delta short-premium entries.</p></article>
        <article><b>Moderate</b><p>Uses a middle range for risk and reference delta.</p></article>
        <article><b>Aggressive</b><p>Allows broader or higher-delta constructions and correspondingly more risk.</p></article>
      </div>
      <p className="gos-help-note">A preset is a starting point, not a promise that today’s market has a qualifying trade. Editing one green value changes the profile to Custom.</p>
    </HelpSection>

    <HelpSection id="terms" eyebrow="4 · DEFINITIONS" title="The terms that most affect a scan">
      <div className="gos-help-term-grid">
        <article><h3>Moneyness</h3><p>The strike’s percentage distance from the underlying price:</p><code>(strike − price) ÷ price × 100</code><p>Negative is below the current price; positive is above it. The effect depends on whether the leg is a put or call and whether it is bought or sold.</p></article>
        <article><h3>DTE</h3><p>Days to expiration. A 7–45 DTE rule lets the strategy evaluate listed expirations in that window and prefer its target DTE where supported.</p></article>
        <article><h3>Reference delta</h3><p>The absolute delta of the primary construction leg. For income/credit trades this is usually the short leg; for directional debit trades it is usually the long leg.</p></article>
        <article><h3>IV Rank</h3><p>The column is called IV Rank to match common scanner language, but the value is a percentile: the share of prior daily ATM IV prints in the past year that were below today. Front-month (about 21–60 DTE) observations are preferred so weekly and LEAP scans do not mix, and one-day IV spikes are ignored. It needs about 20 daily observations. High values (for example above 80) have historically been followed by lower IV, and low values by higher IV.</p></article>
        <article><h3>IV − RV</h3><p>Today’s at-the-money implied volatility minus the past month’s realized volatility, in volatility points. Positive means options look expensive versus recent realized movement; negative means they look cheaper than the past month.</p></article>
        <article><h3>IV − RV Rank</h3><p>A 0–100 percentile of today’s IV − RV versus the same spread over the past year. It is mean-reverting. It uses the stored IV snapshots paired with realized vol from price history, so it warms up with IV Rank.</p></article>
        <article><h3>RV Rank</h3><p>A 0–100 percentile of the past month’s realized volatility versus the previous year. It shows whether recent actual movement is high or low for this name and is also mean-reverting.</p></article>
        <article><h3>Volatility score</h3><p>The average of IV Rank and IV − RV Rank. A high score is a smoother signal that options look overpriced; a low score that they look underpriced.</p></article>
        <article><h3>Expected value</h3><p>The probability-weighted expiration payoff from the model. Positive modeled EV does not guarantee a profitable trade.</p></article>
        <article><h3>Profit ratio</h3><p>Maximum profit divided by maximum loss. A 25% ratio means $25 of maximum profit for every $100 of maximum loss.</p></article>
        <article><h3>Stock Scores F / G / T</h3><p>Fundamental, Growth, and Technical scores from 1–10. ETFs normally show no Fundamental or Growth score; Technical can still be calculated.</p></article>
        <article><h3>Bid/Ask level</h3><p>The entry-price assumption. Conservative uses less favorable quotes, Mid uses midpoint pricing, and 25% improvement moves one quarter of the way toward mid.</p></article>
      </div>
    </HelpSection>

    <HelpSection id="condors" eyebrow="5 · IRON CONDOR" title="Balanced, Weirdor, Jeep, and the other constructions">
      <p className="gos-help-lead">Open the green <strong>Structure</strong> value in Strategy specific. Weirdor is a construction choice inside Iron Condor; it is not a separate scanner page.</p>
      <figure className="gos-help-figure"><img src={helpImage('general-scanner-condor-structures.png')} alt="Iron Condor controls showing Structure, Market view, Variant tickers, Variant width, Tilt strength, Ratio contracts, and Core index variants only" /><figcaption>Non-standard variants default to SPY, QQQ, and IWM because ratio and hedged structures need deep, reliable index-option chains.</figcaption></figure>
      <DefinitionList rows={condorStructures} />
      <aside className="gos-help-callout"><b>Shape and Structure are different</b><span><strong>Iron Condor shape</strong> tests the completed payoff geometry (Any, Balanced, Riskless Up, Riskless Down). <strong>Structure</strong> chooses which construction algorithm builds the legs.</span></aside>
    </HelpSection>

    <HelpSection id="results" eyebrow="6 · RESULTS" title="Exact matches versus constructible near matches">
      <figure className="gos-help-figure"><img src={helpImage('general-scanner-results.png')} alt="General Option Scanner results with a near-match warning, rows, missed-rule badges, and the selected trade analysis" /><figcaption>Exact matches pass every active rule. A yellow near-match row is a real, priced structure that missed one or more rules.</figcaption></figure>
      <div className="gos-help-two-column">
        <article><h3>Exact match</h3><p>The row passed every active filter. The table shows the best-ranked structure for each ticker; click the ⊕ ticker control to drill into more candidates for that ticker.</p></article>
        <article><h3>Near match</h3><p>If there are no exact matches and near matches are enabled, the scanner can show the closest constructible trades. The row badge gives the number of missed rules; selecting it lists the exact rules above the analysis.</p></article>
      </div>
      <aside className="gos-help-warning"><b>Example: the IWF Risk Averse result</b><span>IWF showed total option volume of 596 against a required 5,000 and probability of max profit of 62.1% against a required 65%. It was therefore a near match—not a trade that passed the preset.</span></aside>
      <figure className="gos-help-figure"><img src={helpImage('general-scanner-near-match-example.png')} alt="Risk Averse Iron Condor scan showing the no exact preset match banner and the selected IWF near-match structure" /><figcaption>In this Risk Averse scan, the warning banner and yellow row edges indicate fallback near matches. The selected IWF structure is valid and priced, but it did not satisfy every green rule on the left.</figcaption></figure>
      <p className="gos-help-note">Probability of success/failure, expected value, maximum profit/loss, and the P/L graph are modeled estimates based on current chain data, pricing assumptions, implied volatility, and expiration payoff. They are not guarantees.</p>
    </HelpSection>

    <HelpSection id="strategies" eyebrow="7 · EVERY STRATEGY" title="What the Strategy specific inputs do, trade by trade">
      <p className="gos-help-lead">This guide covers the six filter groups that work the same way for every trade. The <strong>Strategy specific</strong> group is the one that changes — it holds that trade's own construction, payoff, and risk rules. The full field-by-field reference for all 30 supported strategies lives on its own page.</p>
      <div className="gos-help-footer-actions"><Link className="btn btn-primary" to="/general-option-scanner/strategies">Open the strategy field reference</Link></div>
    </HelpSection>

    <HelpSection id="example" eyebrow="8 · EXAMPLE" title="Scan only SPY, QQQ, and IWM for an Iron Condor">
      <ol className="gos-help-example">
        <li>Select <strong>Iron Condor</strong>.</li>
        <li>Open <strong>Include symbols</strong>.</li>
        <li>Choose <strong>Core index ETFs — SPY, QQQ, IWM</strong>.</li>
        <li>Choose Open Filters, Risk Averse, Moderate, or Aggressive.</li>
        <li>Under Strategy specific, set <strong>Structure</strong> to Balanced, Weirdor, Jeep, or All variations.</li>
        <li>Click <strong>Run Scan</strong>.</li>
        <li>Confirm the banner says exact matches or near matches, then select a row and read any missed rules before evaluating the payoff.</li>
      </ol>
      <div className="gos-help-footer-actions"><Link className="btn btn-primary" to="/general-option-scanner?strategy=iron-condor">Try the Iron Condor example</Link><Link className="btn btn-outline" to="/help">Open general app help</Link></div>
    </HelpSection>
  </main>
}
