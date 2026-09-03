import React, { useState } from 'react'
import GradePeriodHelp from '../components/GradePeriodHelp'

const APP_VERSION = '1.35.3'

const GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    sections: [
      { id: 'overview', label: 'Overview' },
    ],
  },
  {
    id: 'action-center-group',
    label: 'Action Center',
    sections: [
      { id: 'action-center', label: 'Action Center' },
    ],
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    sections: [
      { id: 'dashboard', label: 'Dashboard' },
    ],
  },
  {
    id: 'options-group',
    label: 'Options',
    sections: [
      { id: 'option-dashboard', label: 'Options Dashboard' },
      { id: 'options', label: 'Options' },
      { id: 'option-trades', label: 'Option Trades' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    sections: [
      { id: 'import', label: 'Import' },
      { id: 'realized-gain-repair', label: 'Realized Gain Repair' },
      { id: 'export', label: 'Export' },
      { id: 'etf-provider-update', label: 'ETF Provider Update' },
      { id: 'portfolios', label: 'Portfolios' },
      { id: 'menu-control', label: 'Menu Control' },
      { id: 'command-palette', label: 'Command Palette' },
      { id: 'settings', label: 'Settings' },
      { id: 'general-option-scanner', label: 'Option Scanner Help' },
    ],
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    sections: [
      { id: 'holdings', label: 'Holdings' },
      { id: 'reinvestment-impact', label: 'Reinvestment Impact' },
      { id: 'categories', label: 'Categories' },
      { id: 'holding-targets', label: 'Holding Targets' },
      { id: 'growth', label: 'Growth' },
      { id: 'retirement-readiness', label: 'Retirement Readiness' },
      { id: 'dividends', label: 'Dividends' },
      { id: 'div-calendar', label: 'Div Calendar' },
      { id: 'earnings-calendar', label: 'Earnings Calendar' },
      { id: 'div-compare', label: 'Div Compare' },
      { id: 'dividend-history', label: 'Dividend History' },
      { id: 'dividend-ledger', label: 'Daily, Weekly & Monthly Payments' },
      { id: 'total-return', label: 'Total Return' },
      { id: 'gains-losses', label: 'Gains & Losses' },
      { id: 'safe-withdrawal', label: 'Safe Withdrawal' },
      { id: 'dividend-calculator', label: 'Dividend Calculator' },
      { id: 'watchlist', label: 'Watchlist' },
    ],
  },
  {
    id: 'etfs',
    label: 'Checklists',
    sections: [
      { id: 'stock-buying-checklist', label: 'Stock Buying Checklist' },
      { id: 'etf-buying-checklist-evaluator', label: 'Non Income ETF Checklist Evaluator' },
      { id: 'option-income-etf-evaluator', label: 'Option-Income ETF Evaluator' },
    ],
  },
  {
    id: 'cefs',
    label: "CEF's",
    sections: [
      { id: 'cef-buying-checklist-evaluator', label: 'CEF Checklist Evaluator' },
    ],
  },
  {
    id: 'analysis',
    label: 'Analysis',
    sections: [
      { type: 'heading', label: 'Research & Compare' },
      { id: 'security-research', label: 'Security Research' },
      { id: 'etf-screen', label: 'Stock & ETF Analysis' },
      { id: 'etf-comparer', label: 'ETF Comparer' },
      { id: 'stock-comparer', label: 'Stock Comparer' },
      { id: 'stock-valuation', label: 'Stock Valuation (DCF)' },
      { id: 'dist-compare', label: 'Distribution Compare' },
      { type: 'heading', label: 'Screeners & Signals' },
      { id: 'general-scanner', label: 'General Scanner' },
      { id: 'single-strategy', label: 'Single Strategy Scanner' },
      { id: 'buy-sell', label: 'Buy/Sell Signals' },
      { type: 'heading', label: 'Income & NAV Risk' },
      { id: 'nav-erosion', label: 'NAV Erosion' },
      { id: 'nav-screener', label: 'NAV Erosion Screener' },
      { id: 'drip-score', label: 'DRIP vs. Cash Analyzer' },
      { id: 'income-sim', label: 'Income Simulator' },
      { id: 'income-growth', label: 'Income Growth' },
      { type: 'heading', label: 'Portfolio Diagnostics' },
      { id: 'analytics', label: 'Portfolio Analytics' },
      { id: 'diversification', label: 'Diversification' },
      { id: 'fund-definitions', label: 'Fund Definitions' },
      { id: 'correlation', label: 'Correlation Matrix' },
      { id: 'consolidation', label: 'Consolidation Analysis' },
      { id: 'macro-dashboard', label: 'Macro Regime Dashboard' },
      { type: 'heading', label: 'Planning & Optimization' },
      { id: 'growth-income-freedom', label: 'Growth & Income Freedom' },
      { id: 'portfolio-builder', label: 'Portfolio Builder' },
      { id: 'portfolio-tester', label: 'Portfolio Tester' },
      { id: 'cash-flow', label: 'Cash Flow & Sustainability' },
      { id: 'rebalance-wizard', label: 'Rebalance Wizard' },
    ],
  },
  {
    id: 'taxes',
    label: 'Taxes',
    sections: [
      { id: 'tax-report', label: 'Annual Tax Report' },
      { id: 'tax-loss', label: 'Tax-Loss Harvest' },
      { id: 'blended-yield', label: 'Blended Yield Calculator' },
    ],
  },
]

// Help screenshots are captured separately from the code, so a section can be
// written and shipped before its images exist. Rather than render a broken
// image icon and a caption describing something the reader cannot see, hide
// the whole figure when the file is missing. Dropping the PNG into
// public/help-screenshots/ is all that is needed to make it appear.
function HelpScreenshot({ src, alt, caption }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <img
        src={src}
        alt={alt}
        onError={() => setFailed(true)}
        style={{
          maxWidth: '100%',
          height: 'auto',
          borderRadius: '4px',
          border: '1px solid var(--p-333)',
        }}
      />
      {caption && (
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          {caption}
        </p>
      )}
    </div>
  )
}

function Overview() {
  return (
    <div>
      <h2>Overview</h2>
      <p style={{ marginBottom: '1rem' }}>
        Portfolio Tracking Client is a desktop application for managing dividend-focused investment portfolios.
        It lets you import holdings from spreadsheets, track positions and transactions, monitor dividend income,
        analyze portfolio performance, and run screening tools — all from a single interface.
        Robinhood is also supported for both positions (PDF) and transaction history (CSV) imports.
      </p>
      <h3 style={{ marginBottom: '0.5rem' }}>Key Capabilities</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Import</strong> — Starts on Broker Import: positions first, then transactions, followed by an optional market-data refresh. Supports Schwab (Positions, optional All Accounts Positions, and Transactions), E*TRADE, Fidelity, Robinhood, Interactive Brokers (Activity Statement positions and Transaction History), and Shear Group (including All Accounts Positions and Activity). Generic Positions/Transactions and Snowball (migration only) have their own tabs. Automatic database backups before every import and dividend repair with one-click restore.</li>
        <li><strong>Holdings</strong> — Add, edit, and delete positions manually or through transaction lots (BUY/SELL). Tracks cost basis, gain/loss, dividend yields, DRIP reinvestment, and more.</li>
        <li><strong>Dashboard</strong> — At-a-glance summary of portfolio value, income, and allocation. Includes an Action Center preview panel showing the top follow-up items.</li>
        <li><strong>Action Center</strong> — Daily inbox of follow-up items drawn from your portfolio data, categorized by priority (Needs Review, Watch, Clear) and kind (Allocation, Data, Dividend, Options, NAV / CEF, Risk, Rebalance, Tax, etc.). Refresh Data runs a market refresh in place.</li>
        <li><strong>Options</strong> — Build simulated multi-leg trades, graph risk and moneyness, explore first- and higher-order Greeks, and run modeled historical strategy backtests.</li>
        <li><strong>Dividends</strong> — Dividend analysis, calendar view, dividend history, dividend compare, and dividend calculator.</li>
        <li><strong>Growth</strong> — Portfolio growth charts, total return tracking, gains &amp; losses breakdown, and safe withdrawal rate analysis.</li>
        <li><strong>Watchlist</strong> — Track tickers outside your portfolio with live price and dividend data. Lock leading columns (Ticker by default in Split View) while scrolling sideways.</li>
        <li><strong>Split View</strong> — Two pages side by side. Each pane has its own account picker, so you can compare two portfolios; the date range and basis mode stay shared.</li>
        <li><strong>Checklists</strong> — Stock, ETF, and option-income ETF evaluators for structured pre-buy reviews.</li>
        <li><strong>Analysis</strong> — Organized into Research &amp; Compare, Screeners &amp; Signals, Income &amp; NAV Risk, Portfolio Diagnostics, and Planning &amp; Optimization. These groups cover security research, comparison tools, scanners, NAV erosion checks, income simulations, portfolio analytics, consolidation, macro regime context, portfolio testing, and rebalancing.</li>
        <li><strong>Taxes</strong> — Annual Tax Report with realized gains/losses and dividend income summaries.</li>
        <li><strong>Command palette</strong> — Press Ctrl+K (⌘K on a Mac) or use Search in the top bar to jump to a page, ticker, or action, including pages you hid from the menu.</li>
        <li><strong>Multi-Portfolio</strong> — Create multiple portfolios and view them individually or as an aggregate.</li>
        <li><strong>Market Data</strong> — Prices, dividends, and ex-div dates refresh automatically from Yahoo Finance.</li>
      </ul>
    </div>
  )
}

function ImportHelp() {
  return (
    <div>
      <h2>Import</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Import page opens on the <strong>Broker Import</strong> tab. The tabs, left to right, are
        <strong> Broker Import</strong>, <strong>Generic Positions</strong>, <strong>Generic Transactions</strong>,
        <strong> Positions + Transactions</strong>, and <strong>Snowball</strong>.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        On Broker Import, pick a broker and follow the checklist: <strong>Positions</strong> first, then
        <strong> Transactions</strong>. The final <strong>Refresh</strong> step is optional but recommended when
        you want the latest market prices and forward-looking dividend fields. Positions set current shares and cost basis.
        Transactions add dividends, DRIP, and lots after that snapshot exists. If this portfolio has no
        positions yet, a transaction import is blocked until you confirm that the file is complete history —
        a partial history file will otherwise rebuild share counts from those rows alone.
        <strong>Generic Positions</strong> and <strong>Generic Transactions</strong> are for spreadsheet uploads
        that are not a broker export. <strong>Positions + Transactions</strong> takes one workbook holding both —
        the <code>portfolio_with_transactions_*.xlsx</code> file the Export page produces — and restores holdings
        first, then transaction history. Its scope buttons (<strong>Both</strong>, <strong>Positions only</strong>,
        <strong> Transactions only</strong>) let you run the two halves as separate steps from the same file, which
        is the way to move a portfolio onto another computer. The <strong>Snowball</strong> tab is only for
        migrating an old Snowball export — skip it if you import from Schwab or another broker.
        Position imports support merge mode — if the portfolio already has data, existing tickers are updated and new tickers are added,
        while app-only fields (like DRIP toggles or pay dates you edited manually) are preserved unless the spreadsheet provides them.
      </p>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>Brokerage templates:</strong> Broker Import and Generic Positions include downloadable brokerage-position templates.
        Use the matching template if you want to paste or export positions from a broker first, then import them into the app.
        The app currently provides templates for <strong>E*TRADE</strong>, <strong>Charles Schwab</strong>, <strong>Fidelity</strong>, <strong>Robinhood</strong>, and <strong>Interactive Brokers</strong>, plus generic holdings and generic transaction templates and a Snowball holdings migration template.
      </div>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>App export import:</strong> Broker Import also includes
        <strong> Portfolio Export (Holdings + Transactions)</strong> under App export. Use it to round-trip a workbook exported from the app's Export page;
        the preview shows both the holdings sheets and the Transactions sheet before import.
      </div>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>Refresh coordination:</strong> If a market-data refresh is already running from the Dashboard or Holdings page,
        Import waits for it to finish before enabling position or transaction imports. This prevents a refresh and an import
        from writing overlapping price, dividend, DRIP, or NAV data at the same time. Successful imports also clear cached
        Dashboard data so the next Dashboard load reflects the newly imported holdings and payments.
      </div>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>Remembering your format:</strong> Broker Import opens on the broker tagged on the selected portfolio,
        or on the last format you pinned with <strong>Set as default</strong>. Preview stays disabled until a format
        is chosen. <strong>Generic Transactions</strong> and <strong>Positions + Transactions</strong> have their own
        tabs and cannot be pinned as the brokerage default.
        The saved default lives in this browser's local storage, not the database, so it does not follow you to another
        device or installation.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Brokerage Position Templates</h3>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/import/brokerage-import-tab-overview.jpg" alt="Broker Import tab first, with Positions, Transactions, and Refresh steps, broker buttons, and Schwab This account versus All Accounts" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>E*TRADE template</strong> — use this when you want a worksheet laid out for E*TRADE position data before importing.</li>
        <li><strong>Charles Schwab (Positions) template</strong> — use this when preparing Schwab position exports or copy/paste data for import.</li>
        <li><strong>Fidelity (Positions) template</strong> — use this when preparing a Fidelity positions workbook with the exact columns the importer reads.</li>
        <li><strong>Robinhood Holdings reference</strong> — a CSV showing the fields read from the Robinhood Holdings PDF. The actual import still expects the PDF export.</li>
        <li><strong>Robinhood Transactions template</strong> — a CSV with the exact activity columns this importer reads for buys, sells, dividends, capital gains, and ACAT share transfers.</li>
        <li><strong>Interactive Brokers (Positions) template</strong> — a sectioned Activity Statement CSV with Open Positions, cash, and instrument names in the layout IBKR actually exports.</li>
        <li><strong>Interactive Brokers (Transactions) template</strong> — a Transaction History CSV with Date, Transaction Type, Symbol, Quantity, Price, Gross Amount, and Commission.</li>
        <li><strong>Snowball Holdings template</strong> — on the Snowball tab, for a migration-style holdings snapshot when moving from Snowball into the app.</li>
        <li><strong>Generic template</strong> — use this when your source does not match a brokerage template and you want the broadest flexible import format.</li>
        <li><strong>Generic Transactions template</strong> — use this broker-neutral XLSX for one-row-per-event BUY, SELL, DIVIDEND, and DRIP history.</li>
      </ul>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem', marginTop: '0.5rem' }}>
        <div style={{ flex: '1 1 30%', minWidth: '200px' }}>
          <img src="./help-screenshots/import/schwab-positions-import.jpg" alt="Charles Schwab Positions import" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        </div>
        <div style={{ flex: '1 1 30%', minWidth: '200px' }}>
          <img src="./help-screenshots/import/etrade-positions-import.jpg" alt="E*TRADE Positions import" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        </div>
        <div style={{ flex: '1 1 30%', minWidth: '200px' }}>
          <img src="./help-screenshots/import/fidelity-positions-import.jpg" alt="Fidelity Positions import" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        </div>
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>What Broker Position Imports Populate</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Included:</strong> ticker, shares, cost basis / price paid, current price, current value, gain/loss, and dividend yield when the broker file provides it.</li>
        <li><strong>Schwab and Fidelity also include:</strong> description from the broker positions export.</li>
        <li><strong>Fidelity may also include:</strong> ex-dividend date, pay date, dividend-per-share, and estimated annual income when those columns are present in the workbook.</li>
        <li><strong>After import:</strong> the app recalculates derived income fields from the imported holdings data.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>What Position Imports Do Not Fully Populate</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>transaction history and tax lots</li>
        <li>dividend payment history</li>
        <li>DRIP history</li>
        <li>broker-supplied ex-dividend and pay-date history</li>
        <li>all custom categories, notes, and app-only fields</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Charles Schwab (All Accounts Positions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Schwab, go to <strong>Accounts &gt; Positions</strong>, switch the account selector to <strong>All Accounts</strong>, then export to CSV or Excel.</li>
        <li>On Broker Import, choose <strong>Charles Schwab</strong>, stay on the <strong>Positions</strong> step, and click <strong>All Accounts</strong>. Dropping a file whose name contains <em>All-Accounts</em> selects this automatically unless you already chose <strong>This account</strong>. Schwab may use the All-Accounts filename even when the export contains only one account. Transactions still import one account at a time.</li>
        <li>The import lists every portfolio whose Broker Source is <strong>Charles Schwab</strong> (set on the Manage Portfolios page). Check the accounts you want this file to update. Unchecked portfolios are left alone. Use <strong>Select all</strong> or <strong>Select none</strong> to change the whole list at once.</li>
        <li>Preview splits the file into one block per Schwab account and matches each selected portfolio by name or masked account number. You can re-point a selected portfolio to a different account in the file before importing.</li>
        <li>Accounts in the file that are not mapped to a selected portfolio appear under <strong>Other accounts in this file</strong>. Skip them, point them at a portfolio, or create a new portfolio for them.</li>
        <li>Confirmed routing is remembered, so the next All-Accounts export maps itself. Option positions are shown for reconciliation but are not imported as holdings.</li>
        <li>This import can run from an aggregate view because the selected portfolio is not the import target.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Fidelity (All Accounts Positions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Export the combined Fidelity <strong>Positions CSV or XLSX</strong> containing the Account number and Account name columns on each holding row.</li>
        <li>On Broker Import, choose <strong>Fidelity</strong>, stay on the <strong>Positions</strong> step, and click <strong>All Accounts</strong>.</li>
        <li>The import follows the same workflow as Schwab All Accounts: select Fidelity portfolios, preview account matching, re-point accounts when needed, skip accounts, or create a new Fidelity portfolio.</li>
        <li>Holdings, cost basis, current value, cash or core money-market balances, and available dividend fields remain separated by Fidelity account.</li>
        <li>Confirmed routing is remembered for the next combined Positions export. This can also run from an aggregate view because the selected portfolio is not the import target.</li>
        <li>Fidelity transaction history remains a single-account import and should be loaded after the Positions snapshot.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Shear Group (All Accounts Positions and Activity)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Open Broker Import from <strong>Shear Portfolios</strong> (or another rollup/aggregate), choose <strong>Shear Group</strong>, and click <strong>All Accounts</strong>.</li>
        <li>On Step 1, preview and import the combined <strong>Positions.xlsx</strong>. The account-number suffix maps the file rows to Cindy_2472_Shear, Cindy_4734_Shear, Cindy_7326_Shear, and Shear_Jpresser.</li>
        <li>On Step 2, keep <strong>All Accounts</strong> selected and import the combined <strong>Activity.xlsx</strong>. It reuses the same mapping and keeps dividends, DRIP, buys, and sells separated by account.</li>
        <li>Preview lets you re-point, skip, or create a destination before anything is written. Confirmed routing is remembered for later Positions and Activity files.</li>
        <li>Refresh is not required to finish either import. Run it afterward only when you want updated quotes and dividend metadata.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Snowball tab (migration only)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Snowball is the last tab on the Import page, not a step on Broker Import. Open it only when moving an old Snowball export into this app.</li>
        <li>On that tab, choose <strong>Holdings</strong>, <strong>Categories</strong>, or <strong>Transactions</strong>.</li>
        <li>Skip the tab if you import from Schwab or another broker — those files already set holdings and history.</li>
        <li>Holdings keeps only the fields the app already supports and discards Snowball-only analytics columns.</li>
        <li>For the most accurate broker-current holdings, use Broker Import positions instead of treating Snowball as the final source of truth.</li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>Recommended workflow:</strong>
        <ol style={{ paddingLeft: '1.5rem', marginTop: '0.5rem', marginBottom: 0 }}>
          <li>On <strong>Broker Import</strong>, pick your broker and import a current <strong>Positions</strong> file for this account (Schwab, E*TRADE, Fidelity, Robinhood, Interactive Brokers, or Shear Group). This sets shares and cost basis. Schwab and Fidelity All Accounts are optional positions shortcuts; Shear Group All Accounts supports both its combined Positions and Activity files. Interactive Brokers uses an Activity Statement CSV rather than a flat positions table.</li>
          <li>Then import that same account&apos;s <strong>Transaction History</strong> for dividends, DRIP, lots, and realized gains. Do this after the positions snapshot so a partial history file cannot rebuild share counts.</li>
          <li>Optionally run <strong>Refresh Prices &amp; Divs</strong> last to update market data, dividend fields, and pay-date estimates. It is not required for a successful import.</li>
        </ol>
        When a Positions import has been done first, transaction imports store history without overwriting your holdings data. Snowball is on its own tab and is not a step on this path.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Reimporting Old or Partial Files</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Transaction-history files are incremental.</strong> Reimporting an older transaction file skips duplicate BUY/SELL rows that already exist for the same ticker, date, shares, and price. New rows in a later export are added.</li>
        <li><strong>Dividend payments are deduped by ticker, account, and payment date.</strong> If the app previously created a refresh estimate for that date, an imported broker dividend replaces the estimate; otherwise the duplicate payment is skipped.</li>
        <li><strong>Broker Positions and Snowball Holdings imports are current snapshots.</strong> Existing tickers are updated, new tickers are inserted, and holdings missing from the imported snapshot can be removed as stale.</li>
        <li><strong>Do not use a partial Positions file to add only new holdings.</strong> Because positions imports represent the full current account, a partial file can remove holdings that are not listed in the file. Use a complete current positions export, or use Generic Positions when you want an additive/update-style holdings merge.</li>
        <li><strong>Reimporting an old Positions file can roll holdings back.</strong> It will update share counts, cost basis, values, and stale holdings to match that older file. Restore from the automatic backup if the snapshot was not the one you meant to apply.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Transaction History Imports</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The import page includes several transaction-history importers. These are different from position imports:
        they record individual BUY, SELL, and DIVIDEND events rather than setting current holdings directly.
      </p>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        <strong>Partial history warning:</strong> If a transaction export does not cover the full account history
        (e.g. only the last 1–2 years), imported buy/sell transactions may recalculate your share counts and cost
        basis from the transactions alone — which may not match your actual holdings. To avoid this, import a
        Positions file first (see recommended workflow above). A database backup is created automatically before
        every import and dividend repair so you can restore if needed.
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Generic Transactions</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Open the <strong>Generic Transactions</strong> tab, then download the XLSX template and replace its sample rows.</li>
        <li>Required on every row: <strong>Date</strong>, <strong>Type</strong>, and <strong>Ticker</strong>.</li>
        <li>BUY, SELL, and DRIP rows also require <strong>Shares</strong> and <strong>Price Per Share</strong>. DIVIDEND rows require <strong>Dividend Amount</strong>.</li>
        <li>Supported types are BUY, SELL, DIVIDEND, and DRIP. Fees and Notes are optional.</li>
        <li>The importer previews the normalized events, skips transactions already imported, rolls BUY/SELL/DRIP activity into positions when appropriate, and records dividend payments and realized gains.</li>
        <li>Import one selected portfolio at a time. The same headers are also accepted in a CSV file.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Charles Schwab (Transactions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Schwab, go to <strong>Accounts &gt; History</strong>, set the date range, then export to CSV.</li>
        <li>On Broker Import, choose <strong>Charles Schwab</strong> and the <strong>Transactions</strong> step.</li>
        <li>Imports: BUY, SELL, DRIP reinvestment shares, cash dividends, reinvested dividends, capital gain distributions, return of capital, and dividend adjustments.</li>
        <li>If a refresh-estimated dividend already exists for the same ticker, account, and date, the imported broker dividend replaces that estimate so Dividend History keeps the actual payment amount.</li>
        <li>DRIP reinvestments are tagged as <code>[DRIP]</code> buys.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/import/schwab-transactions-import.jpg" alt="Charles Schwab Transactions import and partial history warning" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>E*TRADE (Transactions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In E*TRADE, go to <strong>Accounts &gt; Transaction History</strong>, choose all transaction activity types, then download the XLSX or CSV.</li>
        <li>On Broker Import, choose <strong>E*TRADE</strong> and the <strong>Transactions</strong> step.</li>
        <li>Imports: BUY and SELL transactions, cash dividend payments, capital gain distributions, and DRIP reinvestment buys.</li>
        <li>Transfers, interest, and cash-only rows are ignored.</li>
        <li>If a refresh-estimated dividend already exists for the same ticker, account, and date, the imported broker dividend replaces that estimate so Dividend History keeps the actual payment amount.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/import/etrade-transactions-import.jpg" alt="E*TRADE Transactions import" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Fidelity (Transactions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Fidelity, export the <strong>Transactions XLSX</strong> workbook for a single account.</li>
        <li>On Broker Import, choose <strong>Fidelity</strong> and the <strong>Transactions</strong> step.</li>
        <li>Imports: BUY, SELL, cash dividend receipts, and DRIP reinvestment rows.</li>
        <li>If a refresh-estimated dividend already exists for the same ticker, account, and date, the imported broker dividend replaces that estimate so Dividend History keeps the actual payment amount.</li>
        <li>If the portfolio already has holdings from a positions import, the transaction import preserves those holdings and stores the Fidelity history for recordkeeping.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/import/fidelity-transactions-import.jpg" alt="Fidelity Transactions import drop zone" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Robinhood (Positions PDF)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Robinhood, download your <strong>Holdings PDF</strong> from the app or website.</li>
        <li>On Broker Import, choose <strong>Robinhood</strong> and the <strong>Positions</strong> step.</li>
        <li>Imports: current positions with ticker, shares, and current value.</li>
        <li><strong>Note:</strong> Robinhood does not include cost basis in the Holdings PDF, so the current value is used as the initial cost basis. Update cost basis manually on the Holdings page or import Robinhood Transactions to build lot-level cost basis.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/import/robinhood-positions-import.jpg" alt="Robinhood Positions PDF import drop zone" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Robinhood (Transactions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Robinhood, export your <strong>Activity CSV</strong>.</li>
        <li>On Broker Import, choose <strong>Robinhood</strong> and the <strong>Transactions</strong> step.</li>
        <li>Imports: BUY, SELL, cash dividends, manufactured dividends, capital gain distributions, and ACAT share transfers.</li>
        <li>If a refresh-estimated dividend already exists for the same ticker, account, and date, the imported broker dividend replaces that estimate so Dividend History keeps the actual payment amount.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Interactive Brokers (Positions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Interactive Brokers, go to <strong>Performance &amp; Reports &gt; Statements</strong>, generate an <strong>Activity Statement</strong>, and download <strong>CSV</strong>.</li>
        <li>On Broker Import, choose <strong>Interactive Brokers</strong> and the <strong>Positions</strong> step. IBKR does not have an All-Accounts importer — each file updates the selected portfolio.</li>
        <li>The file is a multi-section statement, not a flat table. The importer reads <strong>Open Positions</strong> for shares and cost basis, <strong>Cash Report</strong> for ending cash, and <strong>Financial Instrument Information</strong> for names.</li>
        <li>Preferred shares such as <em>CIM PRB</em> import as <em>CIM-PRB</em>; class shares such as <em>PBR A</em> import as <em>PBR-A</em>. CAD positions are converted to USD using the statement FX rate.</li>
        <li>Option contracts are counted for reconciliation but are not imported as holdings.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Interactive Brokers (Transactions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Interactive Brokers, go to <strong>Performance &amp; Reports &gt; Transaction History</strong> and download <strong>CSV</strong>. An Activity Statement CSV is also accepted for trades and dividends.</li>
        <li>On Broker Import, choose <strong>Interactive Brokers</strong> and the <strong>Transactions</strong> step.</li>
        <li>Imports: BUY, SELL, option assignments as stock purchases, cash dividends, payment in lieu of dividends, and same-day DRIP reinvestment buys.</li>
        <li>Interest, withholding tax, fees, withdrawals, FX adjustments, and option contract rows are skipped.</li>
        <li>If a refresh-estimated dividend already exists for the same ticker, account, and date, the imported broker dividend replaces that estimate so Dividend History keeps the actual payment amount.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/import/robinhood-transactions-import.jpg" alt="Robinhood Transactions import drop zone" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Snowball Transactions</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Open the <strong>Snowball</strong> tab and choose <strong>Transactions</strong>. Do not use this if you already import from Schwab or another broker.</li>
        <li>Upload a <strong>single-account CSV export</strong>. Combined or merged exports are rejected.</li>
        <li>Imports: BUY, SELL, and DIVIDEND transactions. Stock splits are applied to pre-split lots automatically.</li>
        <li>Snowball exports may not exactly match the broker's live positions — use Broker Import positions for accurate current holdings.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Portfolio Export (Holdings + Transactions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Use the workbook exported from the <strong>Export</strong> page's <strong>Export Holdings with Transactions</strong> option.</li>
        <li>On Broker Import, open <strong>App export</strong> and choose <strong>Portfolio Export (Holdings + Transactions)</strong>.</li>
        <li>The preview shows the portfolio sheet(s) and the Transactions sheet together so you can confirm both before importing.</li>
        <li>Import restores the holdings sheets and transaction history from the same workbook in one pass.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/import/snowball-transactions-import.jpg" alt="Snowball Transactions import with automatic backup notice" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Common Steps (All Transaction Formats)</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2', marginBottom: '1rem' }}>
        <li>Select the correct portfolio from the navbar dropdown.</li>
        <li>Open <strong>Broker Import</strong> (or <strong>Generic Transactions</strong> / <strong>Snowball</strong> if that is the source).</li>
        <li>Pick the broker and the Transactions step (or the matching tab), then upload the file.</li>
        <li>Click <strong>Preview</strong> to parse and review the data before committing.</li>
        <li>Click <strong>Import into &lt;Portfolio&gt;</strong> to load the data.</li>
        <li>Duplicate transactions (same ticker, date, shares, price) are automatically skipped on re-import.</li>
      </ol>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Database Backups &amp; Restore</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A database backup is created automatically before every import (positions, transactions, and spreadsheet imports) and before applying dividend repair.
        The last 5 backups are kept; older ones are pruned automatically.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Backups appear in the <strong>Database Backups</strong> section at the bottom of the Import page.</li>
        <li>Each backup shows the date/time and file size.</li>
        <li>Click <strong>Restore</strong> on any backup to replace the current database with that snapshot. A confirmation dialog appears first.</li>
        <li>After restoring, refresh your browser to see the restored data.</li>
        <li>You can navigate away and come back — backups persist across sessions.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/import/automatic-backup-notice.jpg" alt="Automatic database backup notice shown before each import" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      {/* ── Generic Upload ──────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Generic Positions</h3>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/import/generic-upload-tab.jpg" alt="Generic Positions tab showing portfolio upload and watchlist import sections" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <p style={{ marginBottom: '0.75rem' }}>
        This mode accepts any Excel file with at minimum a <strong>Ticker</strong> and <strong>Shares</strong> column.
        Missing data (prices, dividends, descriptions) is automatically enriched from Yahoo Finance.
        A downloadable generic template is available, along with brokerage templates for accounts such as E*TRADE, Schwab, and Fidelity.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Step-by-Step</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Select the correct portfolio</strong> from the navbar dropdown.
        </li>
        <li>
          <strong>Click the Generic Positions tab.</strong>
        </li>
        <li>
          <strong>(Optional) Download a template</strong> — click the download button that matches your import type.
          The generic template gives you a pre-formatted .xlsx with all supported column headers, and the brokerage templates
          give you matching columns for supported broker export/paste workflows. Fill in at least the Ticker and Shares columns. Optional columns include:
          Price Paid, Current Price, Dividend, Frequency, Ex-Div Date, Pay Date, DRIP, Category, Purchase Date,
          Dividends Paid, YTD Divs, Total Divs Received, and more.
          Use the separate <strong>Generic Transactions</strong> tab to download the transaction template, preview every event, and import it into the selected portfolio.
          <div style={{ marginBottom: '0.75rem', marginTop: '0.75rem' }}>
            <img src="./help-screenshots/import/generic-portfolio-template-download.jpg" alt="Upload Your Portfolio section with Download Template button" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
          </div>
        </li>
        <li>
          <strong>Drag & drop your file</strong> (.xlsx, .xlsm, .xls, or .csv) onto the drop zone, or click to browse.
        </li>
        <li>
          <strong>Choose single or multi-tab mode:</strong>
          <ul style={{ paddingLeft: '1.5rem', marginTop: '0.25rem' }}>
            <li><strong>Single tab (default)</strong> — the first sheet is imported into the currently selected portfolio.</li>
            <li><strong>Multi-tab</strong> — check "Import all tabs as separate portfolios". Each filled tab creates a portfolio named after the tab.</li>
          </ul>
        </li>
        <li>
          <strong>Import as Transactions (optional)</strong> — same behavior as the owner format. Creates BUY/SELL
          transactions based on the difference between imported shares and the current position.
        </li>
        <li>
          <strong>Click "Import Portfolio"</strong> (or "Merge Portfolio" if data exists). Results appear at the bottom.
        </li>
      </ol>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.4rem' }}>Supported Columns (Generic Template)</h4>
      <p style={{ marginBottom: '0.5rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        Only <strong>Ticker</strong> and <strong>Shares</strong> are required. All others are optional — Yahoo Finance fills in what it can.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: '0.85rem', minWidth: '500px' }}>
          <thead>
            <tr>
              <th style={{ padding: '0.4rem 0.75rem' }}>Column</th>
              <th style={{ padding: '0.4rem 0.75rem' }}>Required</th>
              <th style={{ padding: '0.4rem 0.75rem' }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Ticker', 'Yes', 'Stock or ETF symbol (e.g., SCHD, JEPI)'],
              ['Shares', 'Yes', 'Number of shares held'],
              ['Price Paid', 'No', 'Average cost per share — used for cost basis and yield on cost'],
              ['Current Price', 'No', 'Fetched from Yahoo Finance if blank'],
              ['Dividend', 'No', 'Dividend per share per period'],
              ['Frequency', 'No', 'W (weekly), M (monthly), Q (quarterly), SA (semi-annual), A (annual)'],
              ['Ex-Div Date', 'No', 'Next ex-dividend date'],
              ['Pay Date', 'No', 'Next dividend payment date'],
              ['DRIP', 'No', 'Y or N — whether dividends are reinvested'],
              ['Category', 'No', 'Portfolio category (e.g., "High Yield", "Growth")'],
              ['Purchase Date', 'No', 'Date the position was opened — used for DRIP simulation start'],
              ['Dividends Paid', 'No', 'Total dividends received to date'],
              ['YTD Divs', 'No', 'Year-to-date dividends received'],
              ['Total Divs Received', 'No', 'Lifetime dividends received'],
            ].map(([col, req, desc]) => (
              <tr key={col}>
                <td style={{ padding: '0.4rem 0.75rem', fontWeight: req === 'Yes' ? 600 : 400 }}>{col}</td>
                <td style={{ padding: '0.4rem 0.75rem', color: req === 'Yes' ? 'var(--p-81c784)' : 'var(--text-dim-2)' }}>{req}</td>
                <td style={{ padding: '0.4rem 0.75rem' }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ marginTop: '1.25rem', marginBottom: '0.4rem' }}>Tips</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li>You can re-import the same file repeatedly — merge mode updates existing tickers and adds new ones without duplicating.</li>
        <li>If Yahoo Finance can't find a ticker, the row is still imported with whatever data you provided — you can fill in the rest manually on the Holdings page.</li>
        <li>CSV files are imported as a single portfolio (multi-tab is only for .xlsx files).</li>
        <li>The "Import as Transactions" option is ideal when you want to track individual purchase lots and calculate realized gains on sells.</li>
        <li>Refresh Prices & Divs after a large import if you want the latest prices, dividend fields, and estimated pay dates recalculated immediately.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/import/generic-upload-merge-mode-notice.jpg" alt="Generic Positions merge mode notice and Merge Portfolio button" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>
    </div>
  )
}

function ActionCenterHelp() {
  return (
    <div>
      <h2>Action Center</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Action Center aggregates follow-up items generated automatically from your portfolio data —
        things that may need attention, things to keep an eye on, and confirmations that something looks healthy.
        It is accessible from the top navigation bar and also shows a preview panel on the Dashboard.
      </p>

      <HelpScreenshot
        src="./help-screenshots/action-center/action-center-top.jpg"
        alt="Action Center page showing the Items, Needs Review, Watch, Portfolio Value, and Monthly Income summary cards, the priority filter row, and a list of action item cards covering NAV/CEF, dividend, tax, allocation, risk, and options follow-ups"
        caption="The default All view: summary cards up top, priority filters below them, then every open item as its own card with a Kind tag, priority badge, and an Open / Refresh / Mark complete action."
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Cards</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        At the top of the page, five cards give a quick status snapshot:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Items</strong> — total number of action items as of the last calculation.</li>
        <li><strong>Needs Review</strong> — items flagged as requiring attention (shown in amber when non-zero).</li>
        <li><strong>Watch</strong> — items worth monitoring but not immediately urgent.</li>
        <li><strong>Portfolio Value</strong> — current total value across the active portfolio's holdings.</li>
        <li><strong>Monthly Income</strong> — estimated monthly dividend income for the portfolio.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Priority Filters</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Use the filter buttons to focus the list:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>All</strong> — shows every item regardless of priority.</li>
        <li><strong>Needs Review</strong> — shows only warning-priority items that need action.</li>
        <li><strong>Watch</strong> — shows info-priority items to monitor.</li>
        <li><strong>Clear</strong> — shows success-priority items that are in good shape.</li>
        <li><strong>Completed</strong> — shows reviewable items you marked complete; use Restore to return one to the active list.</li>
      </ul>

      <HelpScreenshot
        src="./help-screenshots/action-center/action-center-completed.jpg"
        alt="Action Center Completed filter showing one completed item with a green Completed label and a Restore button next to its Review holdings button"
        caption="The Completed filter. A completed item keeps its original Kind and priority tags but adds a green Completed label and swaps in a Restore button."
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Action Items</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each item card shows:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Kind</strong> — the category of the item: Allocation, Data, Dividend, Income, NAV / CEF, Options, Portfolio, Rebalance, Risk, or Tax.</li>
        <li><strong>Priority badge</strong> — Needs Review (warning), Watch (info), or Clear (success).</li>
        <li><strong>Title &amp; Detail</strong> — a plain-English description of the issue or observation.</li>
        <li><strong>Open / Refresh button</strong> — most items navigate to the relevant page. Stale market-data items run a price and dividend refresh from Action Center instead of sending you to Holdings.</li>
        <li><strong>Mark complete</strong> — available only for items that can be manually reviewed or finished. It removes the item from the active list while keeping it available in Completed. Data holes such as unallocated holdings, stale broker imports, and unconfirmed dividend estimates stay until the underlying data changes.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Dashboard Preview</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Dashboard shows a compact preview of up to four Action Center items at the top of the page.
        Each preview card links directly to the relevant page. Click <strong>Open Action Center</strong> to
        see the full list with filters and details.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>When Action Items Are Generated</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Items are computed from the data already in the app — holdings, dividend history, category weights,
        option trades, broker imports, and income estimates. They are recalculated each time you open the
        Action Center or Dashboard; completed reviewable items stay hidden until you restore them.
        Click <strong>Refresh Data</strong> to run a market-data refresh in place (prices and dividends),
        then the inbox reloads. Follow-ups also include option expirations and rolls, NAV erosion / CEF
        discounts, estimated dividend deposits that still lack a broker actual, stale broker re-imports,
        and ETF closure risk.
      </p>
    </div>
  )
}

function DashboardHelp() {
  return (
    <div>
      <h2>Dashboard</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Dashboard is the main landing page showing a summary of your portfolio at a glance —
        value, income, returns, risk grades, and upcoming dividends.
      </p>

      <div style={{ marginBottom: '1rem' }}>
        <img src="./help-screenshots/dashboard/Dashboard_top.jpg" alt="Top of the updated Dashboard showing the Basis and portfolio selectors, headline return cards, flagged-items bar, shared performance date range, NAV erosion score, risk grades, and income summary cards" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>
      <p style={{ marginBottom: '1.25rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        <strong>Top of the page</strong> (above): the <strong>Basis</strong> and <strong>portfolio</strong> selectors in the
        header; headline cards for portfolio value, account change, and selected-period returns; the flagged-items bar;
        the <strong>Shared Performance Date Range</strong>; and the NAV erosion, portfolio grade, risk-ratio, income,
        reinvestment, yield, IRR, and S&amp;P 500 cards.
      </p>
      <div style={{ marginBottom: '1rem' }}>
        <img src="./help-screenshots/dashboard/dashboard_middle.jpg" alt="Middle of the updated Dashboard showing the Portfolio Value Over Time chart, Grade and Exposure Guide, and Upcoming Dividends This Week calendar" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>
      <p style={{ marginBottom: '1.25rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        <strong>Performance and income schedule</strong> (above): the <strong>Portfolio Value Over Time</strong> chart with
        Daily / Weekly / Monthly and Price Return / Total Return controls, followed by the collapsible
        <strong> Grade &amp; Exposure Guide</strong> and the current week&apos;s dividend-payment calendar.
      </p>
      <div style={{ marginBottom: '1rem' }}>
        <img src="./help-screenshots/dashboard/dashboard_bottom.jpg" alt="Updated Dashboard Holdings overview showing summary cards, filters, view tabs, ticker grade badges in the Common table, and per-holding data" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>
      <p style={{ marginBottom: '0.75rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        <strong>Holdings overview</strong> (above): summary cards, category filters, Common / General / Dividends / Returns
        tabs, and the searchable holdings table. The Common view keeps each ticker&apos;s selected-period
        <strong> Grade</strong> beside its name; scroll horizontally for the remaining income, return, allocation, and NAV
        fields. The category allocation chart sits immediately above this section on the Dashboard.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Cards</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The top section displays key metrics as cards:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>
          <strong>Grade &amp; Risk Period</strong> — the Shared Performance Date Range. Grade, beta,
          Sharpe, Sortino, Calmar, Omega, and Ulcer follow market windows such as
          <strong> YTD, 1M, 1Y, 5Y, All, and Custom</strong>. See
          <strong> Portfolio Grade and the date range</strong> below for which filters produce a grade.
          All begins with the portfolio&apos;s earliest recorded trade
          (or saved purchase/import date when trade history is incomplete). The exact market-data
          start and end dates are printed below the selector; a requested date can move to the next
          trading day for weekends or market holidays.
        </li>
        <li>
          <strong>Portfolio Grade</strong> — a composite risk-adjusted performance grade for the
          selected market window. Dashboard and Growth use the same calculation, holdings,
          and current-value weights, so their grades match when the same period and holdings are selected.
          Blank on <strong>Life</strong> — that filter is cost-basis G/L, not a daily price series.
        </li>
        <li><strong>Ulcer / Calmar / Omega / Sortino / Sharpe</strong> — risk-adjusted performance ratios for the selected market window. Blank on Life, same as Portfolio Grade.</li>
        <li><strong>Lifetime Income</strong> — total dividend income received by the selected account across all years.</li>
        <li><strong>YTD Dividends</strong> — total dividends received year-to-date.</li>
        <li><strong>[Month] Income</strong> (e.g. "May Income") — dividends actually received this calendar month from recorded payments, with a subtitle showing the number of recorded payments through today. Estimated only when no payment history exists.</li>
        <li><strong>Est. Monthly Income</strong> — estimated monthly dividend income across all holdings (annual estimate ÷ 12).</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Grade and the date range</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Shared Performance Date Range controls Price Return and Tracker Total Return on the Dashboard,
        and it also controls whether a Portfolio Grade and the risk indexes are computed.
        <strong> Life</strong> is Holdings cost-basis G/L; <strong>All</strong> is the time-weighted
        replay from the first recorded trade — they are not the same history. The same
        explanation is in the Dashboard&apos;s collapsible <strong>Grade &amp; Exposure Guide</strong>.
      </p>
      <GradePeriodHelp />

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.4rem' }}>Reinvestment cards: Estimated vs. Actual</h4>
      <p style={{ marginBottom: '0.6rem' }}>
        The reinvestment split is shown two ways. The <strong>Estimated</strong> cards are a steady forward run-rate — your
        reinvest settings applied to estimated income — so they read the same on the 1st of the month as on the 30th, which
        makes them right for planning. The <strong>Actual</strong> cards are sourced from recorded dividend payments and
        grow through the month as distributions land, showing what you are <em>really</em> reinvesting vs. taking as cash.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Est. Mo$ Reinvested</strong> (blue) — estimated monthly income being reinvested via DRIP, forward run-rate.</li>
        <li><strong>Est. Mo$ Not Reinvested</strong> (amber) — estimated monthly income taken as cash, forward run-rate.</li>
        <li><strong>Est. % Reinvested</strong> (green) — Est. Mo$ Reinvested ÷ Est. Monthly Income.</li>
        <li><strong>[Month] Reinvested</strong> (blue, e.g. "May Reinvested") — of the income <em>actually</em> received this month, the portion in DRIP-enabled accounts. Starts low early in the month and grows as payments arrive.</li>
        <li><strong>[Month] Not Reinvested</strong> (amber) — actual income this month taken as cash.</li>
        <li><strong>[Month] % Reinvested</strong> (green) — actual reinvested ÷ actual month income.</li>
      </ul>
      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Why the two percentages can differ:</strong> the estimate weights each holding by its <em>projected</em>
        income; the actual weights each holding by what it <em>actually paid this month</em>. A month where DRIP-enabled
        funds happen to pay more will read higher than the estimate, and vice-versa. Both are correct — the gap is the
        signal. The actual split is attributed <strong>per account</strong>, so a fund reinvested only in your Roth IRA but
        taken as cash elsewhere is bucketed correctly.
      </div>

      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Shared refresh behavior:</strong> Dashboard, Holdings, and NAV Snapshot now use the same in-app refresh
        coordinator. If a price/dividend refresh is already running, a second refresh request waits for the first one
        instead of starting a competing update. When the refresh finishes, cached Dashboard snapshots are cleared so
        stale summary cards and charts are not reused after prices, dividends, or imports change.
      </div>

      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Est. Annual Income</strong> — estimated annual dividend income.</li>
        <li><strong>Portfolio Value</strong> — full account value: open holdings plus idle cash. The subtitle shows how much of that total is cash. This is larger than Holdings overview <strong>Value</strong>, which is holdings only.</li>
        <li><strong>Portfolio IRR / Filtered IRR</strong> — annualized money-weighted return from dated buys, sells, fees, recorded dividends, and current holdings value; idle account cash is excluded. The card shows <strong>Unavailable</strong> instead of estimating when transaction shares, transfers, or dividend payment history do not fully reconcile. <strong>Manage exclusions</strong> lists the blocking tickers and lets you omit selected ones. Any resulting number is labeled <strong>Filtered IRR</strong> and discloses the percentage of current portfolio value excluded, because it measures only the documented subset—not the whole account.</li>
        <li><strong>Avg Yield on Cost / Current Yield</strong> — dividend yield based on cost basis vs current price.</li>
        <li><strong>Price Return / Tracker Total Return</strong> — transaction-aware selected-period returns excluding and including dividends. The Shared Performance Date Range above the cards controls both; 1D measures from the previous trading close.</li>
        <li><strong>Raw NAV Erosion (e) and Yield-Funding Coverage</strong> — e is the unadjusted trailing-year principal change on starting NAV. Distribution rate d and accounting total return r use the same basis, so e = d − r. Coverage remains the separate benchmark-gated income-sustainability ratio; its severity is low at 0.25 or below, moderate from 0.25-0.75, and high above 0.75.</li>
        <li><strong>S&amp;P 500</strong> — the current S&amp;P 500 index level with its day's change, as a market reference alongside your portfolio's returns.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>DRIP$ and Cash$ Columns</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The holdings table includes two columns that split estimated monthly income by reinvestment status:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>DRIP$</strong> (blue) — the portion of monthly income being reinvested. This reflects shares held in accounts where DRIP is enabled for that ticker.</li>
        <li><strong>Cash$</strong> (amber) — the portion of monthly income <em>not</em> being reinvested. This reflects shares held in accounts where DRIP is off.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        The split is calculated per-account, so if you hold a ticker in multiple accounts with different DRIP settings,
        only the shares in DRIP-enabled accounts contribute to the DRIP$ column. The amounts are proportional
        to the actual share count in each account.
      </p>
      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>How it works by view:</strong>
        <ul style={{ paddingLeft: '1.5rem', marginTop: '0.5rem', lineHeight: '1.8' }}>
          <li><strong>Individual accounts</strong> (e.g. IRA, Roth IRA) — uses that account's own DRIP flag. If DRIP is on, all income goes to DRIP$; if off, all goes to Cash$.</li>
          <li><strong>Owner</strong> — uses the DRIP flags from sub-accounts marked under the "Owner" column in Manage Portfolios. The income is split proportionally based on sub-account ratios.</li>
          <li><strong>Combined Portfolios</strong> — aggregates per-account income directly, splitting by each account's DRIP flag.</li>
        </ul>
      </div>
      <p style={{ marginBottom: '0.75rem' }}>
        To change a ticker's DRIP setting, go to the Holdings page and toggle the DRIP checkbox, or use
        the DRIP Matrix to manage DRIP across all accounts at once.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Automatic DRIP Share Growth on Refresh</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When prices &amp; dividends are refreshed, a holding with DRIP enabled can have its <strong>share count grow
        automatically</strong> — but whether that happens depends on the account type. This refresh runs <strong>every time
        you open the Dashboard</strong> (whenever you hold at least one position), so the update can happen on its own without
        pressing the Refresh button.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Self-tracked accounts</strong> — the refresh simulates reinvestment of every dividend paid since the
          holding's import/purchase date, buying fractional shares at each dividend's price, and <em>writes the grown share
          count back</em>. The total is always recomputed from the original base share count forward, so refreshing
          repeatedly never double-counts. Turning DRIP off rolls the quantity back down to the base share count.</li>
        <li><strong>Broker-managed accounts</strong> (portfolios flagged as broker / position-managed) — the refresh{' '}
          <em>deliberately does not grow the share count</em>. Your broker's imported position feed owns the share count, and
          reinvested shares/cash are rebuilt from the imported <code>[DRIP]</code> buy transactions instead. Prices,
          dividend-per-share, ex-div/pay dates, and income estimates still update from the market; only the share count is
          left to the broker feed (so it is never double-counted against your import).</li>
      </ul>
      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>How an account becomes broker-managed:</strong> importing a broker <em>positions / holdings</em> file — a
        current share-count snapshot such as a Schwab, Fidelity, or E*Trade positions export (or a Snowball holdings export)
        — flags the account as broker-managed automatically. Importing a <em>transactions</em> file (a buy/sell/dividend
        history) or the Owner Excel does <strong>not</strong>. Once set, the flag stays on — there is intentionally no toggle
        to switch an account back to self-tracked, because the broker's imported share count already includes every
        reinvested share, so re-simulating DRIP on top of it would double-count.
      </div>
      <div className="alert alert-warning" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Keep broker-managed accounts imported.</strong> Because refresh will not grow shares for a broker-managed
        account, if you stop importing from your broker for a while the share count <strong>freezes</strong> at the last
        import. Real DRIP purchases happening at your broker won't appear until you import again, so those holdings will
        progressively <em>understate</em> your true shares and value. Import on a regular cadence (e.g. weekly or monthly) to
        stay accurate. On these accounts the reinvested shares / cash figures are only a breakdown of the already-known
        share count — they never add to it.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Holdings overview</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Dashboard no longer duplicates the Holdings editor. After the equity curve, donut, and this week&apos;s
        pay, it shows the Snowball-style <strong>Holdings overview</strong> that used to live on CommonInfo.
        Edit lots, DRIP, and purchase details on <strong>Holdings</strong>. The overview is for reading the
        book and assigning a NAV benchmark per ticker.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Value</strong> — current market value of the open holdings in the table after filters. Cash is excluded; that lives on the Dashboard <strong>Portfolio Value</strong> card. The lower line is cost basis.</li>
        <li><strong>Total profit</strong> — remaining-lot price G/L plus guarded lifetime dividends plus realized G/L on trimmed shares of still-open tickers. The percent is versus invested/profit basis, not current value. Cash and fully sold tickers are excluded. Same number as Gains &amp; Losses <strong>Total Profit</strong>.</li>
        <li><strong>Passive income</strong> — estimated next-12-month dividends as a yield on open holdings value. It is a forward estimate, not income already received, and cash is not in the denominator. The lower line is the dollar estimate.</li>
        <li><strong>Common</strong> — ticker grade for the Shared Performance Date Range, shares, cost, value, forward dividends, yields, paid for itself, total profit, and NAV. A dash or N/A appears when the selected period cannot produce a grade.</li>
        <li><strong>General</strong> — open/sold status, category, prices, and NAV.</li>
        <li><strong>Dividends</strong> — next pay date, ex-div, frequency, estimated income, and paid for itself.</li>
        <li><strong>Returns</strong> — dividends received, paid for itself, capital gain, realized P&amp;L, and total profit.</li>
        <li><strong>Paid for itself</strong> — lifetime distributions as a percent of original cost. 100% means dividends have paid back what you invested.</li>
        <li><strong>NAV</strong> — on every view. Auto / Test / Skip plus an optional benchmark box (QQQ, SPY, GLD, BTC-USD, or a composite). This is the Dashboard control that decides whether a ticker is NAV-tested and against what.</li>
        <li><strong>Ticker</strong> — click to open the holding modal. Edit the position on Holdings.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Old bookmarks to CommonInfo now open the Dashboard holdings overview.
      </p>

      <p style={{ marginBottom: '0.75rem' }}>
        Per-holding grades, beta, Return vs Yield, DRIP dollars, and the rest of the old 40-column Dashboard
        spreadsheet now live on <strong>Holdings</strong>, which remains the editor.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Return vs. Yield (RvY)</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>RvY</strong> column answers a single question: is the total return on this holding exceeding what the yield alone would suggest, or is price erosion eating into the dividend income?
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Good</strong> (green) — all-time total return % is greater than the yield. Price appreciation is adding value on top of the dividend income.</li>
        <li><strong>Poor</strong> (red) — yield is greater than total return. The position is paying income, but price decline is reducing the net result below what the yield implies.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        The column header has a small toggle that switches the yield reference:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>CYld (default)</strong> — uses the current annual yield based on today's market price. This is the stricter measure. When a stock's price drops, current yield rises (same dollar dividend, lower price denominator), making Good harder to achieve. It reflects what a buyer today would receive and does not allow an old cost basis to inflate the result.</li>
        <li><strong>YOC</strong> — uses yield on cost, based on your original purchase price. YOC is often higher than current yield for long-held positions and can show Good even when the current yield exceeds total return. This is useful for seeing whether dividends collected over the life of the position justify the original investment, but it can mask current-price erosion in high-income holdings.</li>
      </ul>
      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Why CYld is the default:</strong> For income-focused funds (covered call ETFs, high-yield payers), YOC can appear very high when the price has drifted lower, producing a Good reading even as NAV erodes. Current yield keeps the comparison anchored to today's reality and is consistent with what a new investor would experience.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>NAV Testing Controls</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The NAV column is designed for income funds where the distribution may be funded partly by option premium,
        leverage, return of capital, or other strategies that can pressure share price over time. It is not meant
        to penalize every normal stock or growth ETF for ordinary price movement.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '1rem' }}>
        <li><strong>Auto</strong> — the default. The app decides whether to test the holding using ticker lists and description/category keywords such as covered call, option income, enhanced income, YieldMax, leveraged, commodities, crypto, and similar income wrappers.</li>
        <li><strong>Test</strong> — forces the holding into the NAV erosion calculation even if Auto would skip it. Use this for newer or unusual income funds the app may not recognize yet.</li>
        <li><strong>Skip</strong> — excludes the holding from NAV erosion testing. Use this for ordinary stocks, growth ETFs, broad-market ETFs, or funds where NAV erosion is not the right lens.</li>
        <li><strong>Benchmark field</strong> — optional. Leave blank to use the app's automatic benchmark, or type a priceable ticker such as <code>SPY</code>, <code>QQQ</code>, <code>IWM</code>, <code>ITA</code>, <code>GLD</code>, <code>BTC-USD</code>, or a composite such as <code>BTC-USD+GLD</code>.</li>
      </ul>
      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Benchmark rule of thumb:</strong> compare the income wrapper to the asset or sector it is trying to harvest.
        For example, a Nasdaq option-income fund often belongs against <code>QQQ</code>, an S&amp;P 500 option-income fund against
        <code>SPY</code>, a Russell 2000 fund against <code>IWM</code>, a defense income fund against <code>ITA</code>, a gold income fund
        against <code>GLD</code>, and a bitcoin income fund against <code>BTC-USD</code>. If the benchmark text is not a priceable
        ticker, the app marks it invalid instead of treating the NAV result as reliable.
      </div>
      <p style={{ marginBottom: '0.75rem' }}>
        When the NAV value is blank, the holding was either skipped by Auto/Skip, lacked enough market or distribution
        data, or has an invalid benchmark override. Hover the NAV cell for more context.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        These controls live on the Dashboard holdings overview NAV column and update benchmark-gated Yield-Funding Coverage. They do not change raw e, d, or r.
        The standalone NAV Erosion backtest and NAV Erosion Screener still use their own ticker inputs and
        automatic benchmark rules.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Value Over Time</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the summary cards, an equity curve chart tracks your portfolio's total market value over time.
        Each data point is a NAV (Net Asset Value) snapshot — the sum of <code>shares × current price</code>
        across all holdings on that date. Once you have two or more snapshots, the chart draws a line; a single
        snapshot appears as a dot.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '1rem' }}>
        <li><strong>Record NAV button</strong> — click at any time to save today's portfolio value using the prices already refreshed on page load. No import required. The button records a snapshot for the active portfolio and, if it is a sub-portfolio, also records one for Owner automatically.</li>
        <li><strong>Import trigger</strong> — any holdings import (generic upload, broker positions, or broker transactions) automatically records a snapshot for the imported portfolio and Owner.</li>
        <li><strong>One snapshot per day</strong> — clicking the button or importing multiple times on the same day simply updates that day's value rather than creating duplicates.</li>
        <li><strong>Accuracy</strong> — snapshots from the button and from imports use identical logic. Both reflect the prices currently stored in the database, which are refreshed from yfinance on each page load or import.</li>
      </ul>
      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>How often should I snapshot?</strong> Monthly snapshots give a smooth long-term trend.
        Weekly or daily snapshots reveal drawdowns and recovery patterns. The <strong>Record NAV</strong> button
        makes it easy to capture a value on any day without running a full import.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Action Center Preview</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Near the top of the Dashboard, an <strong>Action Center</strong> card shows up to four follow-up items
        generated automatically from your portfolio data. Items are grouped by priority: amber for "Needs Review",
        blue for "Watch", and green for "Clear". Each card links directly to the relevant page. Click
        <strong> Open Action Center</strong> to see the full list with priority filters and details.
        The preview is hidden when the portfolio has no action items.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Upcoming Dividends</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the summary cards, a one-week slice of the Dividend Calendar <strong>Month</strong> view
        shows expected pay dates for the current Monday–Sunday. Each day uses the same ticker chips
        as the full month calendar: estimated payment, yield, and a confirmed or estimated pay-date
        marker. The week total is the sum of those expected payments. Open the Month calendar from
        the link in the header to see the rest of the month.
      </p>
    </div>
  )
}

function HoldingsHelp() {
  return (
    <div>
      <h2>Holdings</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Holdings page is the central place to view, add, edit, and delete positions in your portfolio.
        It displays a sortable table with frozen columns (Ticker, Description, Category, Shares) and scrollable
        data columns for prices, gains, dividends, and reinvestment info. You can manage positions in two ways:
        <strong> directly</strong> (setting shares and price manually) or <strong>via transactions</strong>
        (recording BUY/SELL lots that automatically calculate the position).
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/holdings/holdings-page.jpg" alt="Holdings page full view showing table and controls" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Detailed Views and Features</h3>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/holdings/complete-holdings-table.jpg" alt="Holdings table overview" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      {/* ── Table Overview ──────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Table Overview</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Sorting</strong> — Click any column header to sort ascending/descending. An arrow indicates the active sort.</li>
        <li><strong>Frozen columns</strong> — Ticker, Description, Category, and Shares stay visible as you scroll horizontally.</li>
        <li><strong>Totals row</strong> — The footer sums share and dollar columns (Shares, Cost Basis, Value, Gain/Loss, income, dividends, realized G/L). Percentage columns are recomputed from those totals rather than adding the percents: G/L % is total gain ÷ total cost, YOC is estimated annual income ÷ cost, Yield is estimated annual income ÷ current value, and % Acct should total about 100%. Per-share prices (Price Paid, Current, Div/Share) are left blank because summing them is not meaningful.</li>
        <li><strong>Shared Performance Date Range</strong> — The same 1D / 7D / YTD / 1Y / <em>Life</em> / Custom control used on Total Return, Gains &amp; Losses, Growth, and the Dashboard. Changing it on any of those screens updates the others. <strong>Life</strong> is cost-basis G/L (current value − what you paid) and those screens show a <em>Matches Holdings</em> note with the same totals as this table. The other buttons are the tracker replay and match Total Return Period Price Return.</li>
        <li><strong>Gain/Loss and G/L %</strong> — Follow the shared range. Three different measurements exist, and screens that share a measurement use the same number:
          <ul>
            <li><strong>Portfolio Price Return</strong> (YTD / 1Y / All Totals, Growth Price Return, Total Return cards, Dashboard PrRtn footer, Gains &amp; Losses period cards) — every lot held during the range, including lots already sold.</li>
            <li><strong>Open lots only</strong> (each Holdings row, Total Return table rows and Open lots only footer) — current holdings. Sold lots are left out, so this total can differ from Portfolio Price Return.</li>
            <li><strong>Lifetime cost basis</strong> (Life, Life G/L) — current value minus what you paid for shares you still hold. Not a selected-period return.</li>
          </ul>
        </li>
        <li><strong>DRIP checkbox</strong> — Toggle dividend reinvestment directly in the table without opening the edit form. When enabled, all future dividends are automatically reinvested as new shares at the ex-dividend date using historical prices. The Holdings page and Historical Dividend History page will automatically calculate the reinvested shares and show the DRIP status.</li>
        <li><strong>Expand transactions</strong> — Click the small arrow (&#9654;) next to a ticker to expand and see its transaction lots inline. This section reflects transactions recorded for that ticker only.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/holdings/drip-setting.jpg" alt="DRIP setting in Holdings table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>The DRIP checkbox appears in the Holdings table and can be toggled directly without opening the edit form. When enabled, dividends are automatically reinvested into additional shares using historical prices from the payment date.</p>
      </div>

      {/* ── % Reinvested Card ─────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>% Reinvested Card (Income Summary)</h3>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/holdings/Updated-holdings.jpg" alt="Holdings income summary cards including % Reinvested" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>
          The income summary above the table now includes a <strong>% Reinvested</strong> card alongside
          Est. Monthly Income, Mo$ Reinvested, and Mo$ Not Reinvested.
        </p>
      </div>

      <p style={{ marginBottom: '0.75rem' }}>
        The Holdings page now shows four income summary cards above the table:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Est. Monthly Income</strong> — total estimated monthly income across all displayed holdings.</li>
        <li><strong>Mo$ Reinvested</strong> — the dollar portion of monthly income being reinvested (DRIP on).</li>
        <li><strong>Mo$ Not Reinvested</strong> — the portion being taken as cash (DRIP off).</li>
        <li><strong style={{ color: 'var(--pos-muted)' }}>% Reinvested</strong> — the income-weighted fraction being reinvested: Mo$ Reinvested ÷ Est. Monthly Income × 100. This updates <strong>live</strong> as you toggle DRIP checkboxes in the table, so you can immediately see the portfolio-level impact of any change.</li>
      </ul>

      <p style={{ marginBottom: '0.75rem' }}>
        <strong>How % Reinvested is calculated.</strong> The percentage is <em>income-weighted</em>, not a
        simple count of how many holdings have DRIP on. A holding with $500/mo income counts far more than
        one with $10/mo. For the Owner portfolio, where a single ticker may be held across multiple
        sub-accounts (some reinvesting, some not), the per-ticker reinvested amount is derived from the
        sub-account DRIP ratios rather than a binary 100%/0% — so the number accurately reflects a partial
        reinvestment mix across accounts. The same metric appears on the Dashboard and seeds the default
        Reinvest % on the Reinvestment Impact page.
      </p>

      <p style={{ marginBottom: '0.75rem' }}>
        <strong>DRIP toggle accuracy.</strong> Toggling the DRIP checkbox on a holding that is only
        partially reinvested (e.g. a ticker held in three accounts where only one reinvests) no longer
        snaps the displayed split to 100%/0%. The toggle flips the flag immediately for responsiveness,
        then silently re-fetches the authoritative split from the backend so the income cards and % Reinvested
        always reflect the true per-account ratio rather than a fabricated all-or-nothing value.
      </p>

      {/* ── Toolbar Buttons ─────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Toolbar Buttons</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Refresh Prices &amp; Divs</strong> - Fetches the latest prices, dividend amounts, ex-div dates, pay dates, and dividend frequency from Yahoo Finance for the currently selected Holdings scope. Individual accounts refresh only themselves; Owner refreshes its included source accounts; Aggregate refreshes its configured member accounts. Refresh requests are coordinated across Dashboard and Holdings, so if one refresh is already running, the next request waits for it instead of starting a second overlapping refresh.</li>
        <li><strong>Latest Refresh Result</strong> - After Refresh Prices &amp; Divs finishes, a temporary result section appears near the top of the Holdings screen. Each account card shows:
          <ul style={{ paddingLeft: '1.25rem', lineHeight: '1.7', marginTop: '0.25rem' }}>
            <li><strong>Month-to-date payable distributions</strong> — total estimated cash from holdings with expected pay dates from the first day of the refresh month through the refresh date.</li>
            <li><strong>Post-refresh accrual estimate</strong> — estimated dividends earned between the previous refresh timestamp and this refresh.</li>
            <li><strong>Holding dividend fields changed</strong> — how many holdings had metadata (dividend/share, ex-date, pay date, frequency, YTD, current-month income) updated.</li>
            <li><strong>Payment history</strong> — how many payment rows were recorded (new), updated (amount changed), or already existed (skipped).</li>
            <li><strong>Distribution ticker chips</strong> — the tickers included in the month-to-date payable total, with their estimated dollar amounts.</li>
          </ul>
        </li>
        <li><strong>DRIP during refresh</strong> - If a holding has DRIP turned on, Refresh Prices &amp; Divs can simulate reinvested dividends from the holding's import/purchase date using Yahoo dividend history and closing prices. When that succeeds, the holding's share count, shares from dividends, cash reinvested, estimated annual income, approximate monthly income, and estimated payment amount can all increase. The simulation starts after the import/purchase date, so newly bought shares are not credited with dividends from before you owned them. This updates the Holdings row only; it does not create BUY transactions or rewrite transaction-lot history.</li>
        <li><strong>Post-Refresh Accrual Estimate</strong> - The accrual cards summarize estimated dividends earned since the previous refresh for each account. If the app can identify pay-date events in that window, the count is labeled as payments since refresh. These cards also appear on page load before you run a new refresh, so you can always see the running accrual.</li>
        <li><strong>Dividend history tracking</strong> - When the refresh finds an expected payment for the current month through the refresh date, it can write an estimated payment row into Dividend History using source <code>refresh_estimate</code>. If a broker dividend import later brings in the actual payment for the same ticker, account, and date, the actual broker row replaces the refresh estimate instead of creating a duplicate. Dividend repair ignores <code>refresh_estimate</code> rows when rebuilding actual payment totals, so estimates do not get counted as imported broker actuals.</li>
        <li><strong>Div Src filter</strong> (dropdown, left of Refresh) — Filters the holdings table by the source of each row's dividend actuals. Options: <em>All</em>, <em>Imported actuals</em> (any broker-sourced payment data — Schwab, Fidelity, E*Trade, Robinhood, Snowball, or generic imports), individual brokers, <em>Snapshot</em> (lifetime totals preserved from a Snowball migration), <em>Yahoo</em> (fallback filled from Yahoo history), <em>Mixed</em> (aggregate rows whose members have different sources), and <em>No source</em> (holdings with no dividend data yet). The selected source is also shown in the new <strong>Div Src</strong> column in the table.</li>
        <li><strong>Dividend repair mode</strong> (dropdown, right of Refresh) — Chooses which data sources the next repair run is allowed to use:
          <ul style={{ paddingLeft: '1.25rem', lineHeight: '1.7', marginTop: '0.25rem' }}>
            <li><em>Imported actuals + Yahoo</em> (default) — Use imported broker dividend payments where available; fall back to Yahoo history for tickers with no imported payments. Dividend dates, pay dates, current amount, and frequency are also refreshed from Yahoo metadata and supported official issuer sites when available. Snowball snapshots are preserved.</li>
            <li><em>Imported actuals only</em> — Use only imported broker payments. Tickers with no imported payments get their dividend fields cleared to "No source". Snowball snapshots are preserved. Refresh-estimated rows are ignored.</li>
            <li><em>Yahoo only</em> — Ignore imported broker payments and rebuild every row from Yahoo history. Dividend metadata can still be improved by supported official issuer sites. Snowball snapshots are <strong>not</strong> preserved in this mode.</li>
          </ul>
        </li>
        <li><strong>Preview Div Repair</strong> — Runs the selected repair mode in dry-run form and opens a preview modal showing, per sub-account, how many holdings would be updated from each source (Schwab / Fidelity / Snowball / E*Trade / Robinhood / Other / Snapshot / Yahoo / No source) plus totals. The Dates/Amounts count shows holdings whose current dividend metadata would be refreshed; Official shows how many of those came from supported issuer sites. Nothing is written until you confirm with <strong>Apply Repair</strong>; a database backup is taken automatically before writes. Closing the modal (Escape, clicking outside, the × button, or Cancel) discards the preview. Switching the active portfolio also clears any in-flight preview so you can't apply it against a different scope by accident.</li>
        <li><strong>DRIP Matrix</strong> — (Owner only) Opens a matrix view showing DRIP on/off status for every ticker across all sub-accounts.
          You can toggle DRIP per ticker per account directly from this modal. Each cell shows a checkbox and the share count
          held in that account. The Owner column shows the aggregate DRIP status and DRIP-eligible share count.
          A stats bar at the top displays <strong>Total Annual Income</strong>, <strong>DRIP Income</strong> (the portion
          being reinvested), and <strong>% Reinvested</strong> — these update live as you toggle checkboxes.
          Use the filter box to search for specific tickers. Click "Sync to Owner" to push changes to the Owner portfolio.
          When only some accounts have DRIP on for a ticker, the Owner uses only those accounts' shares for DRIP reinvestment
          calculations — not the full aggregate share count.</li>
        <li><strong>Sync DRIP from Accounts</strong> — (Owner only) Syncs DRIP flags from sub-accounts to the Owner portfolio.
          DRIP is turned on if <em>any</em> sub-account has it on, and off only if <em>all</em> sub-accounts have it off.
          Also calculates the DRIP-eligible share count for each ticker — if a ticker is held in multiple accounts
          but only some have DRIP enabled, only those accounts' shares count toward DRIP reinvestment in simulations.</li>
        <li><strong>+ Add Holding</strong> — Opens the Add/Edit form to create a new position directly (no transaction). Use this when you want to manually enter shares, price, and dividend information without recording individual BUY/SELL lots.</li>
        <li><strong>+ Add/Edit via Transaction</strong> — Opens the Transaction modal to add a brand-new ticker by recording a BUY transaction. Use this when you want the system to track your cost basis and transaction history for future capital gains calculations and lot tracking.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/holdings/add-holding.jpg" alt="Add Holding form" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>The Add Holding form allows you to quickly create a new position by entering the ticker, company name, category, number of shares, current price, and dividend information directly. This creates a "direct" position without transaction-lot tracking.</p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/holdings/add-transaction.jpg" alt="Add Transaction form" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>The Add Transaction form records a BUY transaction, establishing cost basis and creating a transaction lot that can later be sold (SELL) for capital gains tracking. This method provides full transaction history and lot-level cost tracking.</p>
      </div>

      {/* ── Record the opening lot ──────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
        &quot;Record the opening lot&quot; — shares your history does not account for
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Open a ticker&apos;s <strong>Transactions</strong> and you may see an amber panel saying a
        number of shares here are not accounted for by any transaction, with a
        <strong> Record the opening lot</strong> button. This is what it means and what the button
        does.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Why the gap exists</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Two records describe the same position and they can disagree. A <strong>Positions</strong>
        import sets the share count your broker reports. A <strong>Transactions</strong> import
        supplies the buys and sells. Broker exports are usually bounded — two years, or since you
        opened online access — so the purchase that started a long-held position often is not in
        the file. Replay those transactions from zero and you end up owning fewer shares than the
        broker says, sometimes a negative number.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The performance screens already cope with this. They work backward from the saved share
        count and assume an opening lot big enough to make the arithmetic land on it, dated the day
        before the first transaction on record. That assumption is invisible, carries no purchase
        price, and is why Total Return places an orange warning on Start Value: part of the value
        depends on shares inferred from the saved holding rather than a visible transaction. The
        warning means the ledger is incomplete; it does <strong>not</strong> by itself mean the displayed
        Start Value is too high or otherwise wrong.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>What the button does</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        It writes that assumption into your ledger as an ordinary <strong>BUY</strong>, so the thing
        the app was quietly assuming becomes a row you can see, sort, edit, and delete. Specifically:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Shares</strong> — exactly the shortfall: your saved quantity minus what the buys
          and sells net to. Afterwards the ledger arrives at the share count your broker reports.
        </li>
        <li>
          <strong>Date</strong> — the day before the earliest transaction on record, the same date
          the performance replay was already assuming. It does not claim to be the real purchase
          date; it is the latest date the shares must already have existed.
        </li>
        <li>
          <strong>Price</strong> — that day&apos;s closing price, looked up from market history.
          <strong> This is an estimate, not a broker figure.</strong> The panel says so before you
          click, and the note on the created row repeats it.
        </li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>What changes, and what does not</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Your share count does not move.</strong> The lot is sized to match the quantity
          already on record, so the position is unchanged after the rollup.</li>
        <li><strong>Your broker cost basis is left alone.</strong> The basis the Positions import
          supplied is preserved rather than replaced by one derived from the estimated price.</li>
        <li><strong>Realized gains can change, and that is the point.</strong> Sales that had no
          purchase to draw from were reporting no gain, or their whole proceeds as profit. Once the
          opening lot exists they have lots to consume and recalculate correctly.</li>
        <li><strong>The warning clears.</strong> Nothing is being inferred any more, so the amber ⚠
          on Total Return&apos;s Start Value disappears for that ticker. The Start Value can remain the
          same because the replay was already pricing those inferred shares.</li>
      </ul>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        <strong>What the repair guarantees — and what it cannot:</strong> it guarantees only that the
        completed BUY/SELL ledger nets to the saved share count. It cannot prove that the saved count,
        every transaction, the estimated opening date or purchase price, the range&apos;s Start Price, or
        the resulting Start Value is correct. <strong>Start Price</strong> is the market observation at
        the range boundary; the estimated price written on the opening BUY is a separate cost-basis
        input and does not replace Start Price. A recent Start Value can nevertheless be reconstructed
        without the entire lifetime history when the current share count and every buy, sell, transfer,
        and split from the selected start through today are complete. If the gap came from a duplicate
        sale or another missing transaction, correct that row instead of recording an opening lot.
      </div>

      <p style={{ marginBottom: '0.75rem' }}>
        From Owner or an Aggregate, the button identifies the underlying account but will not write.
        Select that account first. After a successful repair, the confirmation shows the estimated
        opening-lot price and transaction-derived average cost before and after. A repair opened from
        Total Return then returns to Total Return.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Correcting it later</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The created row is a normal transaction with <strong>Edit</strong> and <strong>Del</strong>
        beside it. If you find the real confirmation — an old statement, a different export — edit
        the date, share count, and price to match and everything downstream recalculates. If you
        decide you did not want it, delete it and you are back where you started. The row&apos;s note
        begins <em>[Estimated opening lot]</em> so it is always identifiable as the app&apos;s figure
        rather than your broker&apos;s.
      </p>

      <div className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
        <strong>When the button does not appear:</strong> if the buys and sells already account for
        every share, there is nothing to record. There is also a case where the open-lot cut-off
        hides purchases from a prior cycle, so the performance replay invents shares even though
        the full ledger already balances. Recording a lot there would add shares that already
        exist, so the panel stays hidden and Total Return does not flag Start Value — the warning
        is only shown when recording the lot would actually close the gap.
      </div>

      {/* ── Maintenance Actions in Detail ───────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Maintenance Actions in Detail</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The four maintenance buttons in the toolbar (<strong>Refresh Prices &amp; Divs</strong>,
        <strong> Preview Div Repair</strong>, <strong>DRIP Matrix</strong>, and
        <strong> Sync DRIP from Accounts</strong>) handle different jobs. Use the right one for the right
        problem — they overlap in places but are <em>not</em> interchangeable.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Refresh Prices &amp; Divs</h4>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>What it does.</strong> Calls Yahoo Finance for every ticker currently held in the active
        portfolio scope and updates the holdings table with the latest:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.7', marginBottom: '0.5rem' }}>
        <li><em>Current price</em> — used to recompute Current Value, Gain/Loss, and any yield/coverage metric.</li>
        <li><em>Dividend per share, frequency, ex-div date, pay date</em> — refreshes the forward-looking distribution metadata used by Estimated Annual Income, Approx Monthly Income, and the Dividend Calendar.</li>
        <li><em>DRIP share growth</em> — for holdings with DRIP turned on, refresh uses dividend history and close prices to estimate reinvested shares since the import/purchase date. If new DRIP shares are found, the holding's share count and income estimates are recalculated from the larger share balance. The replay starts after the import/purchase date, so a holding bought after an ex-dividend date is not credited with that already-missed distribution. This affects the Holdings row and payment estimates, but does not add transaction-lot records.</li>
        <li><em>Accrued income since last refresh</em> — the gap between the previous refresh timestamp and now is used to estimate dividends earned per holding, surfaced in the Latest Refresh Result and Post-Refresh Accrual Estimate cards.</li>
        <li><em>Estimated payment rows on payable distributions</em> — if a holding's expected pay date falls from the start of the current month through the refresh date, an estimate row is written into Dividend History with source <code>refresh_estimate</code>. The holding must also have been owned before the ex-dividend date; if the purchase date is on or after the ex-date, no payment row is created and any stale refresh estimate for that missed payment is removed. A later broker import for the same ticker/account/date overwrites an eligible estimate with the actual payment, so estimates never double-count.</li>
      </ul>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>Scope.</strong> A single profile refreshes only itself. Owner refreshes its included source
        accounts. Aggregate refreshes its configured member accounts. Owner-level fields are then
        recomputed from those sources.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>When to use.</strong>
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.7', marginBottom: '0.75rem' }}>
        <li>Routinely — at least once a day or whenever you want current prices, gains, and yields.</li>
        <li>After market close, to capture payable distributions through the refresh date as estimated payment rows.</li>
        <li>Before running Buy/Sell Signals, NAV Erosion screens, or rebalancing — these depend on fresh prices and yields.</li>
        <li>Before exporting reports or showing portfolio numbers to someone else.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        <strong>What it does <em>not</em> do.</strong> It does not rewrite historical broker dividend payments,
        and it does not change DRIP flags or share counts. For those, use Preview Div Repair or
        Sync DRIP / DRIP Matrix.
      </p>

      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Ex-date eligibility:</strong> For current dividend fields and refresh-created payment estimates,
        the app checks purchase date against ex-dividend date. If you bought a fund after the ex-date but before
        the pay date, the row can still show forward monthly/annual income for future payments, but the missed
        payment is not counted as received, reinvested, YTD income, or DRIP shares.
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/holdings/refresh-data.jpg" alt="Refresh Prices and Dividends" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>The "Refresh Prices & Divs" button fetches the latest market data from Yahoo Finance for all holdings. The Latest Refresh Result section shows a summary of what was updated: current prices, dividend amounts, DRIP shares, accrued income since the last refresh, and estimated upcoming payment rows added to your dividend history.</p>
      </div>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Preview Div Repair</h4>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>What it does.</strong> Runs the dividend-repair engine in <em>dry-run</em> mode using the
        repair mode you've selected in the dropdown next to it. It rebuilds each holding's dividend
        snapshot fields (current div/share, frequency, ex/pay dates, YTD distributions, total dividends
        received, source label) from the chosen authoritative sources, then opens a modal showing exactly
        what would change before anything is written.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>Repair modes</strong> determine which sources are allowed:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.7', marginBottom: '0.5rem' }}>
        <li><em>Imported actuals + Yahoo</em> (default) — Use broker-imported payments where available; fall back to Yahoo history for tickers with no imported payments. Snowball snapshots are preserved. Refresh estimates are ignored.</li>
        <li><em>Imported actuals only</em> — Strictly use broker payments. Tickers with no imported payments are cleared to "No source". Snowball snapshots preserved.</li>
        <li><em>Yahoo only</em> — Ignore all broker payments and rebuild every row from Yahoo. Snowball snapshots are <strong>not</strong> preserved in this mode.</li>
      </ul>
      <p style={{ marginBottom: '0.5rem' }}>
        The preview modal shows, per sub-account, how many holdings would be updated from each source
        (Schwab / Fidelity / Snowball / E*Trade / Robinhood / Other / Snapshot / Yahoo / No source), plus
        how many would have their dates/amounts metadata refreshed and how many came from supported
        official issuer sites. Nothing is written until you click <strong>Apply Repair</strong>; an
        automatic database backup is taken before the write. Closing the modal (Escape, ×, Cancel, or
        clicking outside) discards the preview, and switching the active portfolio also clears it so you
        can't apply a preview against the wrong scope.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>When to use.</strong>
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.7', marginBottom: '0.5rem' }}>
        <li>Right after a broker dividend-history import (Schwab, Fidelity, E*Trade, Robinhood) so historical totals reflect the imported payments instead of stale estimates or Yahoo guesses.</li>
        <li>When YTD Divs, Total Divs Received, or "Paid For Itself" look wrong on one or more tickers.</li>
        <li>When the <strong>Div Src</strong> column shows "No source", "Mixed", or "Yahoo" for a ticker you know you have broker actuals for.</li>
        <li>After migrating from Snowball, to merge Snowball lifetime snapshots with subsequent broker imports without losing the historical baseline.</li>
        <li>Periodically (monthly is reasonable) to keep dividend frequency, ex/pay dates, and current div/share aligned with each issuer's latest declarations.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Always preview first.</strong> Apply Repair rewrites dividend snapshot fields and Dividend
        History — review the per-account counts in the preview to confirm the source mix matches your
        expectations, then apply. The pre-repair backup lets you restore from the Import page if the
        result is not what you wanted.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>DRIP Matrix (Owner only)</h4>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>What it does.</strong> Opens a per-ticker × per-account grid of DRIP checkboxes covering
        every holding across every sub-account that's included in Owner. Each cell shows the share count
        held in that account next to its DRIP toggle, so you can see <em>which</em> shares are reinvesting
        and which are not. The Owner column on the right shows the aggregate DRIP status and the
        DRIP-eligible share count derived from the sub-accounts.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>
        A live stats bar at the top shows <strong>Total Annual Income</strong>,
        <strong> DRIP Income</strong> (the dollar portion of distributions being reinvested), and
        <strong> % Reinvested</strong>. These update as you toggle checkboxes so you can see the
        income-reinvestment impact of any change before committing.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>
        Each toggle writes immediately to the underlying sub-account's <code>reinvest</code> flag.
        Click <strong>Sync to Owner</strong> inside the modal (or use the toolbar's
        <strong> Sync DRIP from Accounts</strong> button afterwards) to propagate those changes into
        Owner's <code>reinvest</code> flags and partial DRIP-eligible share counts.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>When to use.</strong>
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.7', marginBottom: '0.5rem' }}>
        <li>When you want to see, in one view, exactly which accounts are reinvesting which tickers — useful before running Income Simulation, Income Growth, or Buy/Sell Signals.</li>
        <li>When changing DRIP at your broker — mirror the change here account-by-account so simulations match real-world cash flow.</li>
        <li>When a ticker is held in several accounts and only some have DRIP on, and you want simulations to reinvest only the DRIP-eligible share count instead of the full aggregate.</li>
        <li>To audit DRIP coverage — the % Reinvested stat tells you what fraction of total annual income is actually being compounded.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Filter box</strong> narrows the grid to a single ticker or partial symbol — useful in
        portfolios with many holdings.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Sync DRIP from Accounts (Owner only)</h4>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>What it does.</strong> Recomputes Owner's per-ticker DRIP flags and DRIP-eligible share
        counts from the current state of the included sub-accounts, using these rules:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.7', marginBottom: '0.5rem' }}>
        <li>Owner's <code>reinvest</code> is set to <strong>Y</strong> if <em>any</em> sub-account has DRIP on for that ticker, and <strong>N</strong> only if <em>all</em> sub-accounts have it off.</li>
        <li>If <em>all</em> accounts holding the ticker have DRIP on, Owner's DRIP-eligible share count is left blank and simulations use the full aggregate share count.</li>
        <li>If <em>only some</em> accounts have DRIP on, Owner stores the partial DRIP-eligible share count (sum of shares from the DRIP-on accounts only), and simulations reinvest only that subset.</li>
      </ul>
      <p style={{ marginBottom: '0.5rem' }}>
        After the sync, Owner's holdings and dividend tables are repopulated so downstream calculations
        pick up the new flags immediately.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>When to use.</strong>
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.7', marginBottom: '0.5rem' }}>
        <li>After importing a broker positions file that came in with its own DRIP flags — push those into Owner so aggregate views and simulations reflect them.</li>
        <li>After toggling DRIP on individual sub-accounts (via the row checkbox or the DRIP Matrix) when you didn't already click "Sync to Owner" inside the matrix modal.</li>
        <li>When Owner's DRIP column or income simulations look out of step with what your broker statements show — this is the cheapest way to reconcile.</li>
        <li>Before running Owner-level Income Sim or Income Growth scenarios where DRIP behavior materially affects the projection.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Difference vs. DRIP Matrix.</strong> The DRIP Matrix is the editor — it lets you change
        DRIP per ticker per account. Sync DRIP from Accounts is the propagator — it doesn't change any
        sub-account, it only rolls the current sub-account state up into Owner. Use the matrix to make
        changes; use Sync (or the matrix's "Sync to Owner" button) to publish them to Owner.
      </p>

      {/* ── Row Actions ─────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Row Action Buttons</h3>
      <p style={{ marginBottom: '0.5rem' }}>Each row in the table has three action buttons:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Edit</strong> — Opens the Add/Edit form pre-filled with the holding's current data.</li>
        <li><strong>Txn</strong> — Opens the Transaction modal for that ticker, showing existing lots and a form to add more.</li>
        <li><strong>Del</strong> — Deletes the holding (with confirmation dialog). This removes the holding and all its transactions.</li>
      </ul>

      {/* ── Adding a Holding (Direct) ──────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Adding a Holding (Direct — No Transaction)</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Use this method when you just want to record a position without tracking individual purchase lots.
      </p>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Click "+ Add Holding"</strong> in the toolbar.</li>
        <li>
          <strong>Enter the Ticker</strong> symbol and either press Tab or click "Lookup".
          The app calls Yahoo Finance to auto-fill Description, Current Price, Dividend/Share, Frequency, and Ex-Div Date.
        </li>
        <li>
          <strong>Fill in the Position section:</strong>
          <ul style={{ paddingLeft: '1.5rem', marginTop: '0.25rem' }}>
            <li><em>Shares</em> (required) — total number of shares.</li>
            <li><em>Price Paid</em> — your average cost per share.</li>
            <li><em>Current Price</em> — auto-filled from lookup, or override manually.</li>
            <li><em>Purchase Date</em> — when the position was opened (used as the DRIP simulation start date).</li>
          </ul>
        </li>
        <li>
          <strong>Review Dividend Info:</strong> Div/Share, Frequency, DRIP toggle, Ex-Div Date, and Pay Date
          are pre-filled from the lookup. Adjust as needed.
        </li>
        <li>
          <strong>Optionally fill Dividend Tracking fields:</strong> Dividends Paid, YTD Divs, Total Divs Received.
          "Paid For Itself" is auto-calculated (Total Divs Received / Purchase Value).
        </li>
        <li>
          <strong>Select a Category</strong> from the dropdown (categories are managed on the Categories page).
        </li>
        <li><strong>Click "Add"</strong> to save. The holding appears in the table immediately.</li>
      </ol>

      {/* ── Adding via Transaction ─────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Adding a Holding via Transaction</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Use this method when you want to track individual purchase lots. The position (shares, price paid, cost basis)
        is calculated automatically from the sum of your transaction lots.
      </p>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Click "+ Add/Edit via Transaction"</strong> in the toolbar.</li>
        <li>
          <strong>Enter the Ticker</strong> and click "Lookup" (or tab out). The app fetches market data and pre-fills
          Description, Price Per Share, Dividend info, etc.
        </li>
        <li>
          <strong>Select a Category</strong> from the dropdown.
        </li>
        <li>
          <strong>Fill in the transaction details:</strong>
          <ul style={{ paddingLeft: '1.5rem', marginTop: '0.25rem' }}>
            <li><em>Date</em> — the transaction date.</li>
            <li><em>Shares</em> (required) — number of shares bought.</li>
            <li><em>Price Per Share</em> — price paid per share for this lot.</li>
            <li><em>Fees</em> — any transaction fees (defaults to 0).</li>
            <li><em>Notes</em> — optional notes for this lot.</li>
          </ul>
        </li>
        <li>
          <strong>Click "Add via Transaction"</strong>. The ticker is created with the position calculated from this lot.
          A success message confirms the action.
        </li>
        <li>
          You can <strong>add more lots</strong> immediately by filling in the form again and clicking "Add via Transaction" —
          the position updates cumulatively.
        </li>
        <li><strong>Click "Close"</strong> when done.</li>
      </ol>

      <div className="alert alert-info" style={{ marginTop: '1rem', marginBottom: '1.5rem' }}>
        <strong>Transaction-managed positions:</strong> Once a ticker has transactions, the Shares, Price Paid, and Purchase Date
        fields in the Edit form become read-only (grayed out). You must use the Txn modal to change the position. This prevents
        the manual values from going out of sync with the transaction history.
      </div>

      {/* ── Editing a Holding ──────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Editing a Holding</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Click the "Edit" button in the row's Actions column to open the edit form.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The form opens pre-filled with all current values. The Ticker field is locked (you cannot rename a ticker — delete and re-add instead).
      </p>
      <div className="alert alert-info" style={{ marginTop: '1rem', marginBottom: '1.5rem' }}>
        Clicking the ticker name (blue link) in the table instead opens the Security Research sheet for that
        ticker — a quick lookup of NAV trend, distribution coverage, checklist score, and closure risk. It doesn't
        edit the holding.
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Without Transactions</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        All fields are editable. Change shares, price paid, dividends, category, or any other field and click "Update".
        Calculated fields (Cost Basis, Gain/Loss, Est. Annual Dividend, Paid For Itself) update automatically.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/holdings/edit-holding-simple.jpg" alt="Edit holding without transactions" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>When editing a "direct" holding (one without transaction lots), all fields are editable. You can update shares, price paid, dividend information, category, and DRIP status directly. Calculated fields like Cost Basis and Gain/Loss update automatically.</p>
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>With Transactions</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        If the ticker has transaction lots, the Position fields (Shares, Price Paid, Purchase Date) are grayed out
        and show a blue info banner: <em>"Shares, Price Paid, and Purchase Date are managed by transactions.
        Use the Txn button to add or edit lots."</em> All other fields (Dividend info, Category, DRIP, tracking fields) remain editable.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/holdings/edit-holding-with-lots.jpg" alt="Edit holding with transactions" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>When editing a holding with transaction lots, the Position fields (Shares, Price Paid, Purchase Date) are locked and grayed out because they are calculated from your transaction history. You can still edit dividend information, category, and DRIP status. Use the "Txn" button to modify the transaction lots themselves.</p>
      </div>

      {/* ── Managing Transactions ──────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Managing Transactions on an Existing Holding</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Click the "Txn" button on any row to open the Transaction modal for that ticker.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Viewing Existing Lots</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The top of the modal shows a table of all recorded transactions: Type (BUY/SELL), Date, Shares, Price,
        Fees, Cost/Proceeds, Realized G/L, and Notes.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Adding a BUY Transaction</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Ensure "BUY" is selected (green button at the top of the form).</li>
        <li>Enter Date, Shares (required), Price Per Share, Fees, and Notes.</li>
        <li>Click "Add via Transaction". The position recalculates (total shares increase, weighted average price updates).</li>
      </ol>

      <h4 style={{ marginTop: '0.75rem', marginBottom: '0.4rem' }}>Adding a SELL Transaction</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Click "SELL" (red button) to switch the form to sell mode.</li>
        <li>Enter Shares Sold (required), Price Per Share, Fees, and Notes.</li>
        <li>Leave the lot mode on <strong>FIFO</strong> to let the app consume your oldest open buy lots automatically, or switch to <strong>Specific Lots</strong> to choose exactly which buy lots are being sold.</li>
        <li>Click "Add via Transaction". The position recalculates (shares decrease). A realized gain/loss is calculated using the selected lot allocation, or FIFO if no specific lots are chosen.</li>
      </ol>

      <h4 style={{ marginTop: '0.75rem', marginBottom: '0.4rem' }}>Editing a Transaction</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Click "Edit" on any transaction row in the table.</li>
        <li>The form populates with that transaction's data. The heading changes to "EDIT TRANSACTION".</li>
        <li>Make your changes and click "Edit via Transaction".</li>
        <li>Click "Cancel Edit" if you want to discard changes and return to add mode.</li>
      </ol>

      <h4 style={{ marginTop: '0.75rem', marginBottom: '0.4rem' }}>Deleting a Transaction</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Click "Del" on the transaction row.</li>
        <li>The transaction is removed and the position recalculates immediately.</li>
      </ol>

      {/* ── Deleting a Holding ─────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Deleting a Holding</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Click the "Del" button on the holding's row.</li>
        <li>A confirmation dialog appears: "Delete TICKER?"</li>
        <li>Click OK to confirm. The holding and all its transactions are permanently removed.</li>
      </ol>

      <div className="alert alert-info" style={{ marginTop: '1rem', marginBottom: '1.5rem' }}>
        <strong>Aggregate view:</strong> When viewing the aggregate portfolio, edits apply to the portfolio that holds
        the largest position for each ticker. The page displays a banner reminding you of this behavior.
      </div>

      {/* ── Inline Expand ──────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Viewing Transaction Lots Inline</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        You don't need to open the Txn modal just to <em>view</em> lots. Click the small triangle (&#9654;) to the left
        of any ticker to expand an inline sub-table showing all transaction lots for that holding — including Type,
        Date, Shares, Price, Fees, Cost/Proceeds, Unrealized G/L, Realized G/L, and Notes.
        Click the triangle again (&#9660;) to collapse.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        If a ticker was loaded by a positions import but does not yet have matching transaction lots recorded,
        the inline area shows a message that no transaction lots are recorded yet. History-only imports for other
        tickers do not appear under unrelated holdings.
      </p>

      {/* ── DRIP Simulation ────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>How the DRIP Flag Works</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Setting DRIP to <strong>Y</strong> on a holding does <em>not</em> automatically add shares in real
        time. Instead, every time you run <strong>Refresh Prices &amp; Divs</strong>, the app runs a
        simulation that estimates how many shares your dividends would have purchased since your last broker
        import. This keeps the share count and income projections accurate between imports without requiring
        you to log every DRIP lot manually.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>What the simulation does</h4>
      <p style={{ marginBottom: '0.5rem' }}>
        Starting from your <strong>base quantity</strong> (the share count as of your last broker import)
        and <strong>import date</strong>, the simulation walks forward through every dividend-per-share
        event in Yahoo Finance history up to today:
      </p>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2', marginBottom: '0.75rem' }}>
        <li>Calculates the gross dividend for the current running share count at that date.</li>
        <li>Divides by the closing price on that date to compute new shares purchased.</li>
        <li>Adds those shares to the running count — so later dividends are paid on the larger balance (compounding).</li>
      </ol>
      <p style={{ marginBottom: '0.75rem' }}>
        After the simulation, the app updates these fields on the holding:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Shares</strong> — base quantity plus all simulated DRIP shares earned since import.</li>
        <li><strong>Shares Bought From Dividend</strong> — total DRIP shares earned in the simulation window.</li>
        <li><strong>Total Cash Reinvested</strong> — dollar value of dividends converted into shares.</li>
        <li><strong>YTD Divs / Current Month Income</strong> — computed from actual per-share dividend events × running share count, so they compound correctly with DRIP shares.</li>
        <li><strong>Estimated Annual Income</strong> — recalculated from the DRIP-adjusted share count, so income projections grow as shares accumulate.</li>
      </ul>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Why the simulated count will drift from your broker</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The simulation uses Yahoo Finance dividend history and closing prices — not your broker's actual
        reinvestment records. Brokers sometimes use NAV or a slightly different price for DRIP purchases,
        apply fractional-share rounding differently, or execute reinvestment on a different date.
        Over time these small differences accumulate, and the simulated share count will diverge from what
        your brokerage statement shows.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Keeping it accurate</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Re-import broker positions periodically.</strong> A positions import sets <code>base_quantity</code>
            to your real broker share count and resets <code>import_date</code> to today. The simulation
            then restarts clean from your actual balance, eliminating accumulated drift.</li>
        <li><strong>Monthly is usually enough.</strong> For most dividend frequencies the simulation
            stays close between imports; weekly payers or high-compounding portfolios may drift a little
            more quickly and benefit from more frequent position imports.</li>
        <li><strong>Turning DRIP off</strong> immediately clears the simulated DRIP shares and reverts
            the share count back to <code>base_quantity</code> on the next refresh.</li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.5rem' }}>
        <strong>Tax lots:</strong> The DRIP simulation does not create BUY transaction records. If you
        need individual DRIP lots for cost-basis tracking or the Annual Tax Report, import your broker's
        transaction history — each DRIP reinvestment will appear as a BUY lot with the correct date and price.
      </div>
    </div>
  )
}

function ReinvestmentImpactHelp() {
  return (
    <div>
      <h2>Reinvestment Impact</h2>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Reinvestment Impact</strong> page shows how dividend reinvestment (DRIP) is reshaping your
        portfolio over time — decomposing payout growth into share accumulation, distribution-rate changes,
        and price effects — and projects how reinvestment compounds income forward under different market
        scenarios. It has three modes: <strong>Historical</strong>, <strong>Projection</strong>, and <strong>Price Impact</strong>.
      </p>

      <p style={{ marginBottom: '1rem' }}>
        The page always shows the portfolio's current DRIP rate in the subtitle:
        <em> "Currently reinvesting 33.8% of this portfolio's monthly income."</em> This is the
        income-weighted fraction — the dollar amount reinvested divided by total estimated monthly income —
        and is kept in sync with the DRIP toggles on the Holdings page and the DRIP Matrix.
      </p>

      {/* ── Historical ─────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Historical Tab</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Replays your portfolio's dividend-reinvestment history using recorded payments and Yahoo Finance
        price history, then charts that history at Annual, Monthly, or Weekly granularity. Use the filters
        to focus on any time window, category slice, or individual holding.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Filters</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Granularity</strong> — Annual, Monthly, or Weekly grouping of the data.</li>
        <li><strong>Time Range</strong> — adjusts to the granularity (e.g. 3 Mo – 24 Mo for Weekly; 2 – 10 Yr for Annual).</li>
        <li><strong>Categories</strong> — multi-select dropdown to restrict the view to one or more portfolio categories (Anchors, Boosters, etc.). All Holdings is the default.</li>
        <li><strong>Scope</strong> — zoom in to a single ticker. Selecting a fund narrows all charts to that holding and reveals the Break-Even panel and the per-share rate trend chart.</li>
      </ul>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Summary Tiles</h4>
      <p style={{ marginBottom: '0.5rem' }}>Six tiles summarise the selected window at a glance:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Total Distributions</strong> — the total cash paid out to you across all holdings in the window.</li>
        <li><strong>DRIP Shares Added</strong> — cumulative new shares purchased by reinvesting those distributions. Shows in purple.</li>
        <li><strong>Growth From DRIP</strong> — what fraction of your total payout change came from owning more shares (via DRIP), as opposed to the funds raising or cutting their rates. A high number means compounding is doing real work; a low number means rate changes are the dominant driver.</li>
        <li><strong>Annual Run-Rate</strong> — the most recent period's payout annualised (e.g. last month × 12). This is your current income pace, not a year-to-date total.</li>
        <li><strong>Extra from Reinvesting</strong> — the additional income you collected over the window because you reinvested, compared to what you'd have received had you taken all distributions as cash instead. The percentage shows how much bigger your income stream became through compounding alone.</li>
        <li><strong>% Reinvested</strong> — the share of total distributions that went back into buying shares (DRIP on) versus being taken as cash (DRIP off). The sub-label shows the raw dollar amount taken as cash, flagging how much is not compounding.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/reinvestment-impact/historical-overview.jpg" alt="Reinvestment Impact historical overview" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>Historical tab: all six summary tiles, Distributions Over Time (with the "if not reinvested" dotted line and cumulative amber line), and DRIP Share Growth chart.</p>
      </div>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Charts</h4>

      <p style={{ marginBottom: '0.5rem' }}><strong>Distributions Over Time</strong></p>
      <p style={{ marginBottom: '0.75rem' }}>
        The main bar chart shows total payouts per period. <span style={{ color: 'var(--pos)' }}>Green bars</span> are actual recorded payments from your dividend history; <span style={{ color: 'var(--p-38bdf8)' }}>blue bars</span> are reconstructed from Yahoo Finance price and dividend-per-share data (used where individual lot history isn't imported). The chart hybridises the two: actual payments take priority where available.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Dotted line — "Income if not reinvested"</strong>: what each period's income would have been had you taken distributions as cash instead of reinvesting. Because DRIP adds shares over time, this line sits below the bars — the gap between the bar and the dotted line in any period is the extra income that compounding created.</li>
        <li><strong>Amber line (right axis) — "Cumulative received"</strong>: the running total of all distributions collected since the start of the window. A steadily rising slope confirms consistent income; a flattening slope signals slower recent growth.</li>
      </ul>

      <p style={{ marginBottom: '0.5rem' }}><strong>DRIP Share Growth</strong></p>
      <p style={{ marginBottom: '0.75rem' }}>
        <span style={{ color: 'var(--p-a855f7)' }}>Purple bars</span> show the incremental new shares bought each period by reinvesting that period's cash. The <span style={{ color: 'var(--p-f59e0b)' }}>amber line</span> (right axis) is the running cumulative total of all DRIP shares purchased since the window start. The cumulative line growing smoothly upward means compounding is working as intended; a plateau means reinvestment slowed (rate cut, DRIP turned off, etc.).
      </p>

      <p style={{ marginBottom: '0.5rem' }}><strong>Distribution per Share</strong> <span style={{ color: 'var(--p-6a7892)', fontSize: '0.85em' }}>(single-ticker scope only)</span></p>
      <p style={{ marginBottom: '0.75rem' }}>
        When you scope to a single fund, this chart appears showing the fund's actual distribution paid per share each period. This is the most direct measure of whether a fund is sustaining, growing, or eroding its payout. A falling line means the fund is paying less per share — regardless of how many shares you hold. Combine this with the Distributions Over Time chart: if your total bars are still rising while this line is falling, it means DRIP is masking underlying rate erosion by adding more shares.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/reinvestment-impact/historical-attribution.jpg" alt="Why Payouts Changed attribution chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>Why Payouts Changed chart in per-period mode, with the Per period / Cumulative toggle top-right.</p>
      </div>

      <p style={{ marginBottom: '0.5rem' }}><strong>Why Payouts Changed</strong></p>
      <p style={{ marginBottom: '0.75rem' }}>
        This attribution chart answers the question: <em>why did my income go up or down?</em> Every period's payout change is split into three forces:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><span style={{ color: 'var(--pos)' }}>■ <strong>Share growth (DRIP)</strong></span> — the portion of the change explained purely by owning more shares from reinvesting. This is always a small, steady positive contribution — it compounds quietly every period.</li>
        <li><span style={{ color: 'var(--p-38bdf8)' }}>■ <strong>Distribution rate</strong></span> — the portion caused by the fund itself raising or cutting its per-share payment. This is usually the dominant driver of big swings: a large blue bar above zero means a rate raise lifted income; a large blue bar below zero means a rate cut hit it.</li>
        <li><span style={{ color: 'var(--p-f59e0b)' }}>■ <strong>Interaction</strong></span> — a small mathematical cross-term that appears when both share count and rate change in the same period. It's usually tiny and can be ignored; it just ensures the three pieces add up exactly to the total change.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Bars above zero mean income rose that period; bars below zero mean it fell. Toggle <strong>Per period</strong> to see each period's change in isolation, or <strong>Cumulative</strong> to see the running total of each effect since the window start — the cumulative view directly answers "over the whole window, how much of my income growth came from DRIP versus rate changes?"
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/reinvestment-impact/historical-rate-changes.jpg" alt="Notable rate changes and DRIP off panels" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>Notable rate changes (left) and DRIP off — cash not compounding (right), followed by the Top Contributors table.</p>
      </div>

      <p style={{ marginBottom: '0.5rem' }}><strong>Notable Rate Changes</strong></p>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows the top three rate raises (<span style={{ color: 'var(--pos)' }}>▲ green</span>) and top three rate cuts (<span style={{ color: 'var(--neg-3)' }}>▼ red</span>) by dollar impact across the window. The dollar figure next to each ticker is how much that fund's distribution-rate change added or subtracted from your total income — these are the funds driving the blue bars in the attribution chart. Click any ticker to scope all charts to that holding.
      </p>

      <p style={{ marginBottom: '0.5rem' }}><strong>DRIP Off — Cash Not Compounding</strong></p>
      <p style={{ marginBottom: '0.75rem' }}>
        Lists holdings that have DRIP turned off, along with the total cash each paid out this window. These distributions were collected as cash rather than reinvested, so they did not compound. The panel header shows the total cash amount taken across all DRIP-off holdings. Use this to identify where enabling DRIP would immediately begin adding to your share count and future income.
      </p>

      <p style={{ marginBottom: '0.5rem' }}><strong>Top Contributors Table</strong></p>
      <p style={{ marginBottom: '1rem' }}>
        A table of up to 15 holdings ranked by total distributions paid in the window. Shows the ticker, fund name, total distributions received, DRIP shares added (purple), and whether reinvestment is on (✓) or off (—). Click any row to scope all charts to that ticker.
      </p>

      {/* ── Break-Even Panel ──────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Break-Even Panel (Single Ticker)</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When you scope to a single holding (via Scope in Historical mode, or Fund in Projection mode),
        a <strong>Break-Even</strong> panel appears showing how far the position is from recovering
        its cost basis — and how reinvestment alone can close that gap over time.
      </p>

      <p style={{ marginBottom: '0.5rem' }}>The panel shows two legs side by side:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Cost Basis</strong> — compares position value (shares × current price) to what you paid.
          <ul style={{ paddingLeft: '1.25rem', marginTop: '0.25rem', lineHeight: '1.7' }}>
            <li>If <em>underwater</em>: shows <span style={{ color: 'var(--p-f59e0b)' }}>% still needed to break even</span>, how many more shares at today's price would close the gap, and approximately how long reinvestment alone takes to get there at a flat price.</li>
            <li>If <em>recovered</em>: shows <span style={{ color: 'var(--pos)' }}>% above break-even ✓</span>.</li>
          </ul>
        </li>
        <li>
          <strong>Total Return</strong> — the same calculation but counts dividends already collected (value + dividends received vs. cost). For income-focused funds this leg often crosses break-even even while the price is still below cost.
        </li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        The time-to-break-even estimate assumes the price stays flat and distributions continue at the current annual rate — it is a rough guide, not a guarantee.
        For positions that are deeply underwater (&gt;90% down) the panel shows the drawdown percentage and a note about recovery practicality instead of an impractically large share count.
      </p>

      {/* ── Projection ──────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Projection Tab</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Projects how portfolio income and share count evolve over 1–20 years under three market scenarios
        simultaneously, using the current distribution rate and your chosen reinvestment percentage.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/reinvestment-impact/projections_new.jpg" alt="Projection tab for the whole portfolio showing the Fund, Categories, Horizon, Market, Reinvest %, and Monthly Add controls with the Est and Actual 3-month reinvestment seeds beneath Reinvest %, the Current Annual Income / Projected / Growth tiles, and the Projected Income and Share Count Growth charts" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>Projection tab for the whole portfolio in the neutral scenario over 10 years. Note the header line "Currently reinvesting X%" and the two clickable seeds — <strong>Est</strong> and <strong>Actual 3mo</strong> — directly under the Reinvest % input.</p>
      </div>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Controls</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Fund</strong> — project a single holding instead of the whole portfolio. Selecting a fund reveals the Break-Even panel and clears any active category filter.</li>
        <li><strong>Categories</strong> — multi-select to restrict the projection to one or more portfolio categories (e.g. project only your Boosters). Hidden when a specific Fund is selected.</li>
        <li><strong>Horizon</strong> — 1, 3, 5, 10, or 20 years. Horizons ≤ 5 yr show a monthly income series; longer horizons use an annual series.</li>
        <li><strong>Market</strong> — Neutral (modest +1%/yr distribution growth), Bullish (+4%/yr), or Bearish (first-year shock then gradual recovery). All three scenarios are computed simultaneously; the income chart switches instantly when you change Market without re-fetching.</li>
        <li><strong>Reinvest %</strong> — the fraction of each distribution that is reinvested as new shares. It auto-seeds from your estimated DRIP mix so you start from a real-world baseline, and you can freely override it to model what-if scenarios. Two clickable seeds sit beneath the input:
          <ul style={{ paddingLeft: '1.25rem', lineHeight: '1.7', marginTop: '0.3rem' }}>
            <li><strong style={{ color: 'var(--pos-muted)' }}>Est: X%</strong> — your estimated DRIP mix from the reinvest settings (the default seed). Click to apply.</li>
            <li><strong style={{ color: 'var(--p-38bdf8)' }}>Actual 3mo: Y%</strong> — the share of distributions you <em>actually</em> reinvested over the trailing <strong>3 completed months</strong>, from recorded payments split per account. Click to apply.</li>
          </ul>
          The actual figure deliberately uses completed months and excludes the in-progress month, so it is stable and available from the first of any month — no start-of-month ramp-up. The two often agree closely; when they diverge it reflects recent payment timing.</li>
        <li><strong>Monthly Add $</strong> — a fixed dollar contribution added each month, allocated across holdings by market value weight.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/reinvestment-impact/projections-categories.jpg" alt="Projection with categories filter" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>Projection scoped to a single category (e.g. Boosters), showing only that slice of the portfolio's projected income.</p>
      </div>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Summary Tiles</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Current Annual Income</strong> — computed as Σ(latest declared distribution × frequency × shares) for the selected scope. This can differ slightly from the dashboard's "Est. Annual Income," which uses a smoothed per-holding estimate; the gap is largest for variable-payout option-income funds whose most recent declared distribution differs from their trailing average.</li>
        <li><strong>Projected in N yr</strong> — the annualised income in the final year of the simulation for the selected market scenario.</li>
        <li><strong>Growth</strong> — percentage change from current to projected.</li>
      </ul>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Charts</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Projected Income</strong> — line chart for the selected market scenario. Shows monthly income for horizons ≤ 5 yr, annual totals for longer horizons.</li>
        <li><strong>Share Count Growth by Scenario</strong> — all three scenarios (Bullish, Neutral, Bearish) plotted together so you can see how differently compounding plays out under each market path. For single-fund views this shows clean per-fund share growth; the whole-portfolio view sums shares across all funds (different prices, so the absolute number is less meaningful).</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/reinvestment-impact/projection-all-holdings.jpg" alt="Projection all holdings scenario comparison" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>Share Count Growth chart showing all three scenarios side by side for easy comparison.</p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/reinvestment-impact/projection-individualtop.jpg" alt="Projection individual fund top" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <img src="./help-screenshots/reinvestment-impact/projection-indiv-bottom.jpg" alt="Projection individual fund bottom" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)', marginTop: '0.75rem' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>Projecting a single fund shows the Break-Even panel, the income chart, and the per-fund share-count growth across all three scenarios.</p>
      </div>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>How the Projection Model Works</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Each holding's latest declared distribution per share grows at the scenario's annual rate (Neutral +1%, Bullish +4%, Bearish shock then recovery).</li>
        <li>Distributions flagged for reinvestment buy new shares at the drifted price; those shares earn dividends in every subsequent period — compounding.</li>
        <li>The Bearish scenario models a first-year distribution shock (~35% down in month 12) followed by gradual recovery; this is a market scenario, not a sustainability haircut — high-yielding option-income funds are not capped.</li>
        <li>Monthly contributions are allocated across holdings by market-value weight and also earn dividends once invested.</li>
        <li>Holdings with no declared dividend per share are excluded from income calculations but still receive contribution-based share purchases.</li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.5rem' }}>
        <strong>Note on high-yield funds:</strong> The projection does not impose a yield ceiling or sustainability
        haircut. Option-income ETFs and CEFs with yields above 12% are modelled at face value because their
        distributions are largely sustainable (funded by options premiums, not return-of-capital erosion).
        The scenario growth rates (±1–4% / yr) still apply, so projections reflect modestly growing or
        declining distributions rather than holding them flat forever.
      </div>

      {/* ── Price Impact ───────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Price Impact Tab</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>Price Impact</strong> tab answers a different question than Projection:
        <em> if portfolio prices fell or rose today, how would current income and reinvested future income change?</em>
        It is a price-shock model, not a market-scenario model. Projection asks how income grows under Bullish,
        Neutral, or Bearish paths over time; Price Impact holds the selected price change constant and shows how
        cheaper or more expensive shares affect income, reinvestment, and monthly additions.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/reinvestment-impact/price-impact-top.png" alt="Reinvestment Impact Price Impact tab top section showing controls, summary tiles, math help, break-even panel, and current income by price change chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>Price Impact tab top section: Fund, Horizon, Price Change slider, Reinvest %, Monthly Add, summary tiles, Math help, Break-Even panel, and the Current Income by Portfolio Price Change chart.</p>
      </div>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Controls</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Fund</strong> — choose a single ticker or leave it on Whole Portfolio. Selecting one fund clears category filters and reveals the Break-Even panel for that holding.</li>
        <li><strong>Categories</strong> — when viewing the whole portfolio, restrict the model to one or more categories or sub-categories. This lets you test how a price shock affects only one sleeve of the portfolio.</li>
        <li><strong>Horizon</strong> — 1, 3, 5, 10, or 20 years. This controls the forward reinvestment projection, not the current-income snapshot.</li>
        <li><strong>Price Change</strong> — the main what-if input. The slider and quick buttons model a portfolio price drop as low as <strong>-60%</strong> or a price rise as high as <strong>+100%</strong>. The number box lets you type an exact percentage.</li>
        <li><strong>Reinvest %</strong> — how much of each modeled distribution is reinvested in the forward projection. The <strong>Est</strong> and <strong>Actual 3mo</strong> shortcuts work the same way they do on Projection.</li>
        <li><strong>Monthly Add</strong> — a fixed monthly contribution included in the forward projection. It buys shares at the adjusted price, so lower modeled prices buy more shares and higher modeled prices buy fewer.</li>
      </ul>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Summary Tiles</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Price Change</strong> — the selected shock and the portfolio value before and after the shock. Example: $552,182 to $607,400 at +10%.</li>
        <li><strong>Current Monthly</strong> — the modeled current monthly income after applying the price shock and payout-sensitivity model. The small "base" value underneath is today's unshocked monthly income.</li>
        <li><strong>Current Annual</strong> — the modeled current annual income after the same price shock. The small "base" value underneath is today's unshocked annual income.</li>
        <li><strong>Monthly in N yr</strong> — the final projected monthly income at the selected horizon after reinvestment and monthly additions are compounded at the adjusted price.</li>
        <li><strong>Annual in N yr</strong> — the final projected annual income at the selected horizon after reinvestment and monthly additions.</li>
        <li><strong>Projected Change</strong> — the difference between projected annual income at the selected horizon and the price-adjusted current annual income. This is intentionally compared to the adjusted current income, not the original baseline, so the percentage reflects compounding after the shock.</li>
      </ul>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Math Help Panel</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>Math help</strong> disclosure explains the assumptions used by this tab. The most important point is that
        income does <strong>not</strong> move one-for-one with price. Each holding gets an <strong>income beta</strong> based on its
        income strategy, and the model applies only that fraction of the price move to the payout.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>The payout formula is:</p>
      <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--p-0f141c)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem' }}>
{`adjusted distribution per share =
latest distribution per share × (1 + price change × income beta)`}
      </pre>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Covered-call / option-income funds</strong> — use a lower payout beta because their income comes from option premium, volatility, strategy rules, and distribution policy as much as NAV. A price drop does not automatically mean the payout drops by the same percentage.</li>
        <li><strong>BDCs, CEFs, preferreds, bonds, loans, and fixed-income style holdings</strong> — also use dampened payout betas because income is tied more to portfolio holdings, credit, and distribution policy than to market price alone.</li>
        <li><strong>Declared-dividend holdings</strong> — use the default lower sensitivity because a stock price move does not automatically change the declared dividend immediately.</li>
      </ul>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Break-Even Panel in Price Impact</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        When a single fund is selected, the Break-Even panel appears above the charts. It uses the same single-ticker logic as the other tabs:
        Cost Basis compares current position value to what you paid, while Total Return includes dividends already collected. This helps you
        interpret the Price Impact model alongside your actual recovery position. For example, a BDC may still be below cost basis on price,
        but above break-even on total return after years of distributions.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Current Income by Portfolio Price Change</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        This chart is the cleanest view of the immediate payout model. It shows how current monthly and current annual income change across
        the full -60% to +100% price range. The orange dotted vertical line marks the selected price change. The chart is read-only, so dragging
        on it cannot change the model or reshape the axes.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Current monthly</strong> — modeled monthly income after the price shock and payout beta.</li>
        <li><strong>Current annual</strong> — modeled annual income after the price shock and payout beta.</li>
        <li><strong>Selected price</strong> — the vertical reference line showing the price-change setting currently selected in the controls.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        If this line slopes gently instead of sharply, that is expected: the model is intentionally not assuming payout moves one-for-one with price.
        Covered-call funds, BDCs, CEFs, and similar income funds should generally show dampened current-income movement.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/reinvestment-impact/price-impact-bottom.png" alt="Price Impact bottom section showing projected income after reinvestment chart, chart-specific help, projected monthly income chart, and top contributors table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>Price Impact bottom section: Projected Income After Reinvestment chart, chart-specific help, Projected Monthly Income chart, and Top Income Contributors table.</p>
      </div>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Projected Income After Reinvestment by Price Change</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        This chart is easy to misunderstand because it is <strong>not</strong> only showing the immediate payout change. It shows the projected result
        after the selected horizon, reinvestment rate, and monthly additions have compounded. That means lower prices can sometimes produce higher
        projected income even though current payout is modeled lower.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Projected annual after reinvestment</strong> — the final annual income at the selected horizon after reinvested distributions and monthly additions buy shares at each price-change level.</li>
        <li><strong>Projected monthly after reinvestment</strong> — the same final-period income expressed monthly.</li>
        <li><strong>Current annual payout</strong> — dashed reference line showing the modeled current annual payout after the price shock, before compounding. Compare this to the projected line to separate payout pressure from future share accumulation.</li>
        <li><strong>Selected price</strong> — orange dotted vertical line marking the current price-change setting.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        The chart-specific help below the graph explains the key interpretation: if the dashed payout line falls while the projected line rises,
        the model is saying income is lower today, but reinvestment at cheaper prices may buy enough extra shares to produce more future income
        by the selected horizon.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Projected Monthly Income at Selected Price Change</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        This chart switches from the full price range to the single selected price change. It shows the month-by-month income path through the selected horizon.
        It is useful for seeing whether the projected income improvement is immediate, gradual, or mostly back-loaded from compounding. A flatter line means
        the payout and share count are changing slowly; a steeper line means reinvestment and additions are meaningfully increasing shares.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1rem', marginBottom: '0.4rem' }}>Top Income Contributors at Adjusted Price</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The table explains which holdings drive the projected income number. It ranks holdings by projected annual income at the adjusted price and shows:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker / Description</strong> — the holding being modeled.</li>
        <li><strong>Price</strong> — today's price.</li>
        <li><strong>Adjusted</strong> — the price after applying the selected price change.</li>
        <li><strong>Income Model</strong> — the strategy bucket and beta used for the holding, such as Income fund (10%) or Option income (20%). This makes the math auditable.</li>
        <li><strong>End Shares</strong> — simulated shares after reinvestment and monthly additions.</li>
        <li><strong>Projected Annual</strong> — final annual income for the holding at the selected horizon.</li>
        <li><strong>Growth</strong> — percentage growth from adjusted current annual income to projected annual income for that holding.</li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.5rem' }}>
        <strong>How to read this tab:</strong> Use <strong>Current Income by Portfolio Price Change</strong> to understand
        immediate payout sensitivity. Use <strong>Projected Income After Reinvestment</strong> to understand what compounding
        might do after reinvestment and monthly additions. If those two charts point in different directions, the model is
        separating today's payout pressure from future share accumulation at cheaper or more expensive prices.
      </div>
    </div>
  )
}

function CategoriesHelp() {
  return (
    <div>
      <h2>Categories</h2>
      <p style={{ marginBottom: '1rem' }}>
        Categories let you group your holdings into meaningful buckets — such as "High Yield", "Growth",
        "Covered Call ETFs", or "REITs" — so you can see how your portfolio is allocated at a glance.
        Each category tracks its actual allocation percentage and dollar value, and you can optionally set
        a <strong>target allocation</strong> to see how close your real allocation is to your plan.
        This helps you make informed rebalancing decisions and ensures your portfolio stays aligned with your investment strategy.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Categories can also contain <strong>sub-categories</strong>. Use them when a category is still the right
        top-level bucket, but you want a finer breakdown inside it — for example splitting an income category into
        option-income ETFs, BDCs, REITs, or preferreds. Those sub-categories are not just labels on this page:
        the portfolio analysis pages that expose a Categories filter can now filter by individual sub-categories too.
      </p>

      {/* ── Page Layout ──────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Page Layout</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Categories page is split into three main areas:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Summary Strip (top)</strong> — Shows how many holdings are allocated vs. total,
          total allocated dollar value and percentage, total portfolio value, estimated monthly income
          with portfolio yield, weekly dividend exposure (percentage of portfolio value in weekly-payer funds),
          and the running total of target allocations set across all categories.
          Below the numbers is a colored <strong>allocation bar</strong> that visualizes each category's
          share of the portfolio. Hovering over a segment shows the category name and percentage.
          Any unallocated value appears as a gray segment labeled "Unallocated".
        </li>
        <li>
          <strong>Target Assistant (optional panel)</strong> — Appears when any category has a target
          allocation set. Suggests optimized target percentages based on current allocation, income yield,
          risk flags, and your constraints. See <em>Target Assistant</em> section below.
        </li>
        <li>
          <strong>Category Cards (left panel)</strong> — One card per category showing the category name,
          number of tickers, actual allocation percentage, dollar value, a small progress bar,
          and a Quality score (when the Target Assistant is active).
          Cards are expandable to show the individual tickers inside. If a category has sub-categories, the
          card also shows a sub-category count badge and expands into nested sub-category rows.
        </li>
        <li>
          <strong>Unallocated Assets (right panel, sticky)</strong> — Lists all tickers that haven't been
          assigned to any category. These are shown as clickable pill-shaped buttons. This panel stays
          visible as you scroll through categories.
        </li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Read the page from top to bottom: confirm everything is allocated, review the colored allocation mix,
        choose an assistant mode, tune the limits, then inspect the suggested target table before saving targets
        or building trades.
      </p>

      {/* ── Color Coding ──────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Allocation Color Coding</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When a category has a target allocation set, the percentage and progress bar are color-coded:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><span style={{ color: 'var(--pos-bright)', fontWeight: 600 }}>Green</span> — Within 3% of target (on track).</li>
        <li><span style={{ color: 'var(--amber)', fontWeight: 600 }}>Yellow</span> — 3–8% away from target (slightly off).</li>
        <li><span style={{ color: 'var(--neg)', fontWeight: 600 }}>Red</span> — More than 8% away from target (needs attention).</li>
        <li><span style={{ color: 'var(--accent-bright)', fontWeight: 600 }}>Blue</span> — No target set (informational only).</li>
      </ul>

      {/* ── Creating a Category ───────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Creating a Category</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Click "+ New Category"</strong> in the top-right corner.</li>
        <li>
          <strong>Enter a Name</strong> (required, up to 100 characters) — e.g., "High Yield", "Growth", "Bonds".
        </li>
        <li>
          <strong>Set a Target Allocation %</strong> (optional) — enter the percentage of your portfolio
          you want this category to represent (e.g., 25.0). This enables the color-coded tracking
          described above. Leave blank if you just want to group tickers without a specific target.
        </li>
        <li><strong>Click "Create"</strong>. The category card appears in the left panel, initially empty.</li>
      </ol>

      {/* ── Creating Sub-categories ───────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Creating Sub-categories</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Sub-categories live inside a parent category. They let you keep the same top-level allocation target while
        organizing the holdings inside that bucket more precisely.
      </p>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Expand a category</strong> by clicking its card header.</li>
        <li>Click <strong>"+ Sub-category"</strong> in the expanded category controls.</li>
        <li>Enter a name such as "Preferreds", "REITs", "Gold", "Covered Calls", or any label that fits your portfolio.</li>
        <li>Click <strong>"Create"</strong>. The new sub-category appears under the parent category.</li>
      </ol>
      <p style={{ marginBottom: '1rem' }}>
        Sub-categories do not have separate target allocation percentages. The parent category owns the portfolio
        target, while each sub-category shows its own dollar value, portfolio percentage, and share of the parent category.
      </p>

      {/* ── Assigning Tickers ─────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Assigning Tickers to a Category or Sub-category</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        There are two ways to assign unallocated tickers to a category. When a sub-category is expanded, the same
        click-to-assign workflow targets that sub-category instead of the parent category.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/categories/category-cards-unallocated-assets.jpg" alt="Category cards and Unallocated Assets panel" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>
          Category cards are the working area for organizing holdings. The number badge beside each category name shows how many tickers are assigned, the blue bar shows its current portfolio weight, and the right side shows Quality, allocation percentage, and dollar value. The Unallocated Assets panel on the right is the source list for tickers that still need a category.
        </p>
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Method 1: Quick Assign (One at a Time)</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Expand a category</strong> by clicking its card header (the row with the name and percentage).</li>
        <li>
          The card highlights with a blue border, and the Unallocated Assets panel shows a green message:
          <em> "Click a ticker to assign to the selected category"</em>.
        </li>
        <li>
          <strong>Click any ticker pill</strong> in the Unallocated panel. It is immediately assigned to the
          expanded category or sub-category — no confirmation needed. The category's count, value, and allocation
          update instantly.
        </li>
      </ol>

      <h4 style={{ marginTop: '0.75rem', marginBottom: '0.4rem' }}>Method 2: Bulk Assign (Multiple Tickers)</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Make sure no category is expanded</strong> (collapse any open card by clicking its header again).
        </li>
        <li>
          <strong>Select tickers</strong> in the Unallocated panel by clicking their pills. Selected pills
          highlight with a blue border. Use "Select all" or "Deselect" links at the top of the panel for convenience.
        </li>
        <li>
          A row of <strong>category buttons</strong> appears below the selection:
          <em> "Assign X selected to:"</em> followed by a button for each category.
        </li>
        <li>
          <strong>Click the target category button</strong>. All selected tickers are assigned at once,
          and the selection clears.
        </li>
      </ol>

      <h4 style={{ marginTop: '0.75rem', marginBottom: '0.4rem' }}>Moving Tickers Between Sub-categories</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        After a category has sub-categories, the expanded ticker table includes a <strong>Sub-category</strong>
        dropdown for each holding. Use it to move a ticker into another sub-category or back to
        <em> no sub-category</em> while keeping it inside the same parent category.
      </p>

      {/* ── Unassigning Tickers ────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Unassigning Tickers</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        To remove a ticker from a category (returning it to the Unallocated panel):
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Single Ticker</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Expand the category</strong> by clicking its card header.</li>
        <li>
          In the expanded ticker table, click the <strong>&times; button</strong> on the right side of the
          ticker's row. The ticker moves back to Unallocated immediately.
        </li>
      </ol>

      <h4 style={{ marginTop: '0.75rem', marginBottom: '0.4rem' }}>All Tickers in a Category</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Expand the category.</strong></li>
        <li>
          Click <strong>"Unassign All"</strong> in the button row at the top-right of the expanded area.
          All tickers in that category are moved back to Unallocated at once.
        </li>
      </ol>

      {/* ── Managing Sub-categories ───────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Managing Sub-categories</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Rename</strong> — expand the parent category, then click <strong>Rename</strong> on the sub-category row.</li>
        <li><strong>Delete</strong> — click the <strong>&times;</strong> button on the sub-category row. Its tickers stay assigned to the parent category but move to the <em>no sub-category</em> group.</li>
        <li><strong>Unclassified holdings</strong> — if a category has sub-categories, any ticker that belongs to the parent but not to a sub-category appears under <strong>Not in a sub-category</strong>. Use the dropdown beside the ticker to place it.</li>
      </ul>

      {/* ── Editing a Category ────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Editing a Category</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Expand the category</strong> by clicking its card header.</li>
        <li>Click the <strong>"Edit"</strong> button in the top-right of the expanded area.</li>
        <li>The modal opens pre-filled with the current name and target allocation.</li>
        <li>Make your changes and click <strong>"Update"</strong>.</li>
      </ol>

      {/* ── Deleting a Category ───────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Deleting a Category</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Expand the category</strong> by clicking its card header.</li>
        <li>Click the <strong>"Delete"</strong> button in the top-right of the expanded area.</li>
        <li>
          A confirmation dialog appears: <em>"Delete category 'Name'? Tickers will become unallocated."</em>
        </li>
        <li>
          Click OK to confirm. The category is removed and all its tickers move back to the Unallocated panel.
          No holdings are deleted — only the category grouping is removed.
        </li>
      </ol>

      {/* ── Target Assistant ──────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Target Assistant</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Target Assistant appears automatically when at least one category has a target allocation set.
        It analyzes the current allocation, income yield, weekly-payer exposure, and NAV risk flags for
        each category and proposes optimized target percentages with plain-language rationale.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Mode Buttons</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Three preset modes are shown as cards at the top of the assistant panel. Click any card to switch the active mode:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Balanced</strong> — blends allocation quality with income preservation and drift reduction.</li>
        <li><strong>Preserve income</strong> — prioritizes keeping projected monthly income at or above the income floor.</li>
        <li><strong>Reduce target drift</strong> — prioritizes minimizing the total dollar distance from category targets, even if that means accepting slightly lower income.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Each card previews the projected monthly income, income floor status (Met or Short by $X), a combined quality score, and total dollar moves required.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Suggestion Table</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The main table shows one row per category with:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Current</strong> — actual allocation percentage today.</li>
        <li><strong>Target</strong> — your manually set target (if any).</li>
        <li><strong>Suggested</strong> — the assistant's recommended target for the active mode (green).</li>
        <li><strong>Yield</strong> — category's current income yield.</li>
        <li><strong>Weekly</strong> — percentage of the category's value in weekly-paying funds.</li>
        <li><strong>Quality</strong> — a composite score (0–100) based on the suggested allocation's portfolio-level impact from NAV risk, single-holding exposure, income concentration, weekly-payer exposure, yield sustainability, and recent return. Green ≥ 78, yellow ≥ 60, red below 60. The main drivers appear below the score.</li>
        <li><strong>$ To Suggested</strong> — dollar amount that would need to move to reach the suggested target (green = buy more, red = trim).</li>
        <li><strong>Reason</strong> — plain-language explanation of why the suggestion moved up or down.</li>
      </ul>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/categories/target-assistant-suggestion-table.jpg" alt="Target Assistant suggested target table with Quality scores and dollar moves" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
        <p style={{ fontSize: '0.9rem', color: 'var(--p-aaa)', marginTop: '0.5rem' }}>
          Use the suggestion table as the final review before saving target changes. The Suggested column shows the assistant's proposed target weight, $ To Suggested estimates how much would need to move, and Reason explains why the category is being increased or trimmed. Click a Quality score to see which tickers are contributing to the score, including income concentration, weekly-payer exposure, high-yield reliance, NAV monitors, or confirmed high NAV ratio.
        </p>
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Quality Scores</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The Quality score is a 0-100 portfolio-impact score for the category at its suggested allocation.
        It does not judge a category in isolation; it asks how much that category would affect the whole portfolio
        if you used the suggested target.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Strong, 78-100</strong> — the category has a clean or manageable portfolio impact under the suggested target.</li>
        <li><strong>Watch, 60-77</strong> — the category is acceptable, but one or more exposures deserve attention before saving the targets.</li>
        <li><strong>Risky, below 60</strong> — the category has enough concentration, income, weekly-payer, yield, NAV, or return risk to review carefully.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        The small text under the score names the main category-level drivers. Click the score to open the ticker
        drilldown. In that detail view, <strong>NAV monitor</strong> means the ticker is watched for NAV erosion;
        it is not a warning by itself, especially when the NAV ratio is low such as 0.00. <strong>High NAV ratio</strong>
        means the benchmark-adjusted NAV erosion ratio is above the high-risk threshold and is being treated as a
        confirmed quality concern.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Constraint Sliders</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Six sliders let you tune the assistant's suggestions without leaving the page:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Minimum acceptable monthly income</strong> — the income floor the assistant must not drop below. Defaults to the portfolio's current monthly income on first load.</li>
        <li><strong>Max category %</strong> — caps any single category's suggested allocation.</li>
        <li><strong>Max high-yield category %</strong> — a tighter cap applied to categories the assistant classifies as income-heavy or yield-chasing buckets.</li>
        <li><strong>Max allowed drift</strong> — limits how far the suggested target can move from the current allocation in percentage points.</li>
        <li><strong>Minimum anchor allocation</strong> — raises the floor for any category named "Anchor" (useful for core holdings you always want to be the largest bucket).</li>
        <li><strong>Income growth priority</strong> — 0–100 slider; higher values tilt suggestions toward higher-yielding categories.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Projected Income Summary</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the sliders, the assistant shows projected monthly income after applying the suggested targets,
        the income floor, current vs. projected portfolio yield, and current vs. projected weekly exposure percentage.
        An income floor warning appears in red if the active mode's suggestions would breach the floor,
        along with the shortfall and the extra yield the Rebalance Wizard would need to find on replacements.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Applying Suggestions</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Apply Suggested Targets</strong> — saves the suggested percentages as the target allocation for each category (overwrites any existing targets). No navigation occurs.</li>
        <li><strong>Apply &amp; Open Rebalance</strong> — saves the suggested targets and immediately opens the Rebalance Wizard, passing the current income mode and income floor as defaults so the wizard is pre-configured to match the assistant's intent.</li>
      </ul>

      {/* ── Expanded Category View ────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Expanded Category Details</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When you expand a category card, you see a table listing each ticker in that category. If the category has
        sub-categories, the expanded view first shows each sub-category with its own ticker count, portfolio
        percentage, percentage of the parent category, and dollar value.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Expanding a sub-category shows the tickers inside it with:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The stock/ETF symbol.</li>
        <li><strong>Description</strong> — The holding's name.</li>
        <li><strong>Value</strong> — Current market value of that position.</li>
        <li><strong>Freq</strong> — Dividend payment frequency. Weekly payers are highlighted in green.</li>
        <li><strong>% of Category</strong> — What percentage of the category's total value this ticker represents.</li>
        <li><strong>Sub-category</strong> — When sub-categories exist, a dropdown for moving the ticker within the parent category.</li>
        <li><strong>&times;</strong> — Unassign button to remove the ticker from this category.</li>
      </ul>
      <p>
        If the category is empty, a hint message appears: <em>"Click a ticker on the right to assign it here"</em>,
        directing you to the Unallocated Assets panel.
      </p>
      <div className="alert alert-info" style={{ marginTop: '1rem' }}>
        <strong>Active holdings only:</strong> the Unallocated Assets panel shows only current holdings with active shares.
        Old zero-share tickers are cleaned out automatically instead of lingering in the picker.
      </div>

      {/* ── Category and Sub-category Filters ─────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filtering by Category or Sub-category</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The same hierarchy you build here is available in portfolio analysis filters. Pages such as
        <strong> Growth</strong>, <strong>Total Return</strong>, <strong>Dividend Analysis</strong>,
        <strong> Dividend History</strong>, <strong>Reinvestment Impact</strong>, <strong>Income Sim</strong>,
        and <strong>Safe Withdrawal</strong> show a Categories dropdown when categories exist.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Select a <strong>parent category</strong> to include every holding in that category.</li>
        <li>Select one or more <strong>sub-categories</strong> to focus on only those narrower groups.</li>
        <li>Selecting a whole parent category supersedes any sub-category selections inside it, so the dropdown clears those child selections automatically.</li>
        <li>Use <strong>All Holdings</strong> to clear both category and sub-category filters.</li>
      </ul>

      {/* ── Dashboard Overview ────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Dashboard Overview</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Once you define categories, a <strong>Portfolio Overview</strong> section appears on the Dashboard
        above the holdings table. It displays a <strong>donut chart</strong> on the left showing your
        category allocation visually, alongside a <strong>summary table</strong> on the right with:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Name</strong> — Category name and number of holdings.</li>
        <li><strong>Value / Invested</strong> — Current market value and original cost basis for the category.</li>
        <li><strong>Gain</strong> — Dollar gain or loss with a percentage, color-coded green (gain) or red (loss).</li>
        <li><strong>Target</strong> — If any category has a target allocation set, a Target column appears showing the target percentage.</li>
        <li><strong>Allocation</strong> — The category's actual percentage of total portfolio value.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        If no categories have been defined yet, the overview falls back to grouping holdings by
        asset class (ETF, Equity, CEF, REIT, etc.) so you always have a high-level breakdown
        of your portfolio on the Dashboard.
      </p>

      {/* ── Tips ──────────────────────────────────────────────── */}
      <h4 style={{ marginTop: '1.25rem', marginBottom: '0.4rem' }}>Tips</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li>Categories can also be assigned when adding or editing a holding on the Holdings page — the Category dropdown there lists all categories you've created.</li>
        <li>Importing holdings that already have a Category column will auto-create categories and assign tickers during import.</li>
        <li>Use sub-categories when you want narrower filters without creating more top-level target buckets.</li>
        <li>Target allocations don't need to add up to 100% — you might intentionally leave some portfolio value uncategorized.</li>
        <li>The allocation bar at the top gives you a quick visual sense of balance without needing to read individual numbers.</li>
      </ul>
    </div>
  )
}

function GrowthHelp() {
  return (
    <div>
      <h2>Growth</h2>
      <p style={{ marginBottom: '1rem' }}>
        Growth is one page with three tabs. They share the account selector, the Shared
        Performance Date Range, and the same transaction-aware return calculation — what
        changes between them is the question being asked, and therefore the units the answer
        comes back in. Switching tabs never re-asks for a date range or a portfolio.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Dollars</strong> — What is the account worth, and does it match the broker?
          Portfolio value, cost basis, cash, open option marks, and the return expressed in
          dollars. This is the tab to reconcile against a broker statement.
        </li>
        <li>
          <strong>Vs market</strong> — Did these holdings beat the benchmark? Both return
          indexes start at 100, so the ending value is a percentage rather than a balance,
          and everything is measured against a benchmark ticker you choose.
        </li>
        <li>
          <strong>Lots</strong> — Where did the dollars come from after buys, sells, and a
          full sale plus rebuy? This tab is the Gains &amp; Losses page; it is documented in
          its own <strong>Gains &amp; Losses</strong> section.
        </li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Tracker Total Return %</strong> is the figure that crosses tab boundaries. It is
        the same transaction-aware, dividend-reinvested percentage on every tab and on Total
        Return, Dashboard, and Gains &amp; Losses, so with the same account, holdings scope, and
        date range the four should agree after the close. Separately read live quotes can differ
        intraday. Purchases and sales change what is being measured; they are never counted as
        gain or loss.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/growth/growth-tabs-current.png" alt="The Growth page showing its Dollars, Vs market, and Lots tabs" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <GrowthDollarsHelp />
      <GrowthVsMarketHelp />

      <h2 style={{ color: 'var(--accent)', marginTop: '2.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>Lots tab</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Lots tab is the Gains &amp; Losses page rendered inside Growth, so the two always show
        the same numbers. Open it from the <strong>Gains &amp; Losses</strong> section of this help
        for the full walkthrough of realized and unrealized lots, wash sales, and the cost-basis
        reconciliation. Note that Broker Positions Gain/Loss (Schwab and Fidelity) is a
        cost-to-current figure that lives on this tab — it is not Tracker Total Return %.
      </p>
    </div>
  )
}

function GrowthVsMarketHelp() {
  return (
    <div>
      <h2 style={{ color: 'var(--accent)', marginTop: '2.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>Vs market tab</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Growth page's Vs market tab shows how your portfolio has performed over time compared to a benchmark.
        It tracks both <strong>price-only returns</strong> (capital gains) and <strong>total returns</strong>
        (capital gains + dividends), so you can see the full picture of your investment performance.
        The page also grades your portfolio's risk-adjusted returns using industry-standard metrics
        and provides per-ticker breakdowns via bar charts and heatmaps.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>How this ties to the other tracking pages:</strong> the <strong>Tracker Total Return %</strong>
        here uses the same transaction-aware return calculation as Total Return and the Tracker Total Return %
        card on the Dollars tab. With the same portfolio, holdings filter, and effective date range, the
        percentage should match after the close; separately read live quotes can differ intraday. Purchases
        and sales change the amount invested; they are not counted as gain
        or loss. The Dashboard holding chart uses this same calculation for that individual holding. The
        Shared Performance Date Range is remembered across every tracking screen; only a later purchase date or
        unavailable market day can make a holding&apos;s effective start later than the requested start. Every
        summary card shows the effective date range used for its metric.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/growth/vs-market-tab-current.png" alt="The Vs market tab of the Growth page" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      {/* ── Filters ────────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filters</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Three filters at the top of the page control what data is displayed. Changing any filter
        triggers a fresh data fetch — all charts and metrics update together.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Categories</strong> — A multi-select dropdown that lets you filter holdings by category.
          By default "All Holdings" is selected, showing the entire portfolio. Check one or more top-level
          categories or sub-categories to see performance for just those groups. Selections are combined with
          OR; selecting a whole category supersedes its sub-category choices. The dropdown shows "X selected"
          when categories are active. Click outside the dropdown to close it.
        </li>
        <li>
          <strong>Benchmark</strong> — A text input defaulting to <strong>SPY</strong> (S&P 500 ETF).
          Type any ticker symbol and press Enter or click "Go" to compare your portfolio against that benchmark.
          The benchmark appears as a dotted orange line on the charts and gets its own Sharpe/Sortino scores
          in the metrics strip.
        </li>
        <li>
          <strong>Period</strong> — The shared choices are <strong>1D, 7D, 1M, 3M, 6M, YTD, 1Y, 5Y,
          All, Life, and Custom</strong>. All begins with the portfolio&apos;s first recorded trade rather than
          the benchmark&apos;s older history. Custom start and end dates are inclusive. The selected
          range controls every metric and chart on the page. <strong>Life</strong> is cost-basis G/L
          and does not produce a Portfolio Grade — see <strong>Portfolio Grade and the date range</strong> below.
        </li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Grade and the date range</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Growth uses the same grade rules as the Dashboard. The same table is in this page&apos;s
        collapsible help under <strong>How to read the charts, metric bubbles, and filters</strong>.
      </p>
      <GradePeriodHelp />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Metrics Strip</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A row of summary cards appears below the filters:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Portfolio Grade</strong> — A letter grade (A+ through F) with a numeric score, summarizing
          overall risk-adjusted performance for the selected dates. It uses the same adjusted-price,
          current-value-weighted calculation as the Dashboard, so the two pages match when the same
          holdings and period are selected. The exact effective dates appear on the grade card.
          Blank on <strong>Life</strong>, because Life is cost-basis G/L, not a daily price series.
        </li>
        <li>
          <strong>Tracker Total Return %</strong> — The portfolio&apos;s transaction-aware, dividend-reinvested
          return over the selected period. The exact effective start and end dates appear on the card and
          directly in every chart title. This is the percentage to compare with Total Return and the Dollars tab.
        </li>
        <li>
          <strong>Portfolio Sharpe</strong> — The Sharpe ratio measures excess return per unit of total risk
          (volatility). Higher is better. Above 1.0 is generally considered good; above 2.0 is excellent.
        </li>
        <li>
          <strong>Portfolio Sortino</strong> — Similar to Sharpe but only penalizes downside volatility
          (drops), not upside. A higher Sortino means you're getting returns without excessive drawdowns.
        </li>
        <li>
          <strong>Benchmark Sharpe / Sortino</strong> — The same metrics calculated for the benchmark ticker,
          so you can directly compare your portfolio's risk-adjusted returns against the market.
        </li>
      </ul>

      {/* ── Charts ─────────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Charts</h3>

      <h4 style={{ marginBottom: '0.4rem' }}>Price-Only Chart</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A line chart showing your portfolio's value growth based on price changes alone (no dividends).
        Values are indexed to a base of 100 at the start of the period, so you can see percentage growth
        directly. Your portfolio is the solid cyan line; the benchmark (if set) is a dotted orange line.
        If your line is above the benchmark, you're outperforming on capital gains.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Total Return Chart</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The same format but includes dividends reinvested. This is the true measure of investment
        performance. The portfolio line is green (solid) and the benchmark is orange (dotted).
        For dividend-heavy portfolios, the gap between this chart and the price-only chart shows
        how much dividends contribute to your overall returns.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Performance by Ticker (Bar Chart)</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A horizontal bar chart showing each ticker&apos;s total return over the period selected at the top
        of the page. This lets you quickly spot which holdings are driving that period&apos;s performance
        and which are dragging it down. The chart height scales with the number of tickers.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Performance Heatmap</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A color-coded grid with tickers on the Y-axis and the selected period on the X-axis. Each cell
        shows the percentage return for that ticker over the exact same effective range used above.
        Colors range from <span style={{ color: 'var(--neg)' }}>red</span> (negative)
        through dark (near zero) to <span style={{ color: 'var(--p-81c784)' }}>green</span> (positive).
        This gives you an at-a-glance view of which holdings have been strong or weak in the chosen
        range. Hover over any cell to see the exact value.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Start with the default view</strong> — 1Y period, SPY benchmark, all holdings.
          This gives you a baseline understanding of your portfolio's recent performance.
        </li>
        <li>
          <strong>Compare against different benchmarks</strong> — try QQQ (Nasdaq), VTI (total market),
          or a sector ETF relevant to your holdings. This shows whether your stock-picking adds value.
        </li>
        <li>
          <strong>Use category filters</strong> to isolate performance by strategy — e.g., see how your
          "High Yield" holdings perform vs. your "Growth" holdings.
        </li>
        <li>
          <strong>Switch to 5Y or All</strong> to see long-term trends. All starts at the first recorded
          portfolio activity, so benchmark history before ownership is excluded. Short-term noise smooths out
          over longer periods.
        </li>
        <li>
          <strong>Check the heatmap</strong> to identify consistently underperforming tickers that
          might be candidates for trimming or replacement.
        </li>
      </ol>
    </div>
  )
}

function GrowthDollarsHelp() {
  return (
    <div>
      <h2 style={{ color: 'var(--accent)', marginTop: '2.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>Dollars tab</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Dollars tab gives you a dollar-value view of your portfolio over time: how much it is worth,
        how much you have invested, and how its transaction-aware return is composed. Unlike the Growth page,
        which indexes everything to 100 for comparison, this page shows actual dollar amounts in the value
        chart and lets you switch the return chart between a percentage index and return dollars.
        It separates price return, distributions, and the combined tracker return; realized P/L and fees are
        not separate profit-source lines on this page.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Both charts and the headline cards share the same period selector and ticker filter. Each chart title
        prints its From and To dates, the return cards show their effective date range, and Start and End
        Value show the single market observation each one is taken from: a live quote when available today,
        otherwise a close. This makes intraday timing visible as you explore a range.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Comparing against your broker:</strong> End Value is your shares at the latest market observation
        (a live quote when available today, otherwise the latest close), plus your recorded cash. A broker's
        net liquidating value already includes that cash, so adding the two together
        double counts it. If the account is carrying open option contracts, they appear beneath End Value marked
        at the current bid/ask mid, along with a combined <strong>with options</strong> figure — that is the one
        to compare against net liquidating value. Short spreads mark negative because closing them costs money.
        Options live in the separate option trade ledger, have no history in this replay, and never affect the
        charts or either return card. The line is hidden entirely for an account with nothing open.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>How this ties to the other tracking pages:</strong> <strong>Tracker Total Return %</strong>
        is the common transaction-aware, dividend-reinvested percentage used by the Vs market tab and
        Total Return. It should match after the close when the portfolio, ticker scope, and effective date
        range match; separately read live quotes can differ intraday.
        The dollar charts below intentionally answer a different question: how portfolio value and dollar
        profit/loss changed, including the effect of cash invested or withdrawn. The Shared Performance Date
        Range is remembered across Dashboard, Growth, Total Return, Gains &amp; Losses, and Holdings.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/growth/dollars-tab-current.png" alt="The Dollars tab of the Growth page" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Shared Controls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Shared Performance Date Range</strong> - Preset buttons cover 1D, 7D, 1M, 3M, 6M,
          YTD, 1Y, 5Y, and All. Choose
          <strong> Custom</strong> to enter your own inclusive start and end dates. The selected range
          controls both charts and the summary cards. <strong>All</strong> begins with the first recorded
          trade, purchase, or import for the portfolio. The 1D window uses the previous trading session;
          the other presets use calendar dates and the close on or before the requested start.
        </li>
        <li>
          <strong>Tickers</strong> - A multi-select dropdown listing every ticker in the active portfolio.
          By default all tickers are included. Uncheck tickers to exclude them from both charts, or check
          specific ones to focus on a subset. <strong>All Tickers</strong> at the top selects or clears the
          whole list in one click, so isolating a single holding is clear-all then check that one. Nothing
          reloads while you are ticking boxes — click <strong>Apply</strong> to run the charts on the new
          selection, or <strong>Cancel</strong> (or click away) to discard the edit. Apply stays disabled
          until at least one ticker is checked. The button shows "All (N)" when nothing is excluded, or
          "X of N" when a subset is applied.
        </li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Chart 1 - Portfolio Value</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows the total dollar value of your portfolio over the selected period by replaying the share
        quantities actually held after each dated buy and sell, then pricing those shares at each day&apos;s
        close. The series also includes the recorded cash balance. A holding contributes only from its
        first known purchase or transaction date; the chart does not backfill recently acquired holdings
        into years before you owned them. This is not a simulated backtest.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Portfolio line (cyan)</strong> - Total market value of all held shares each day.
          A light fill beneath the line helps visualize the shape of the curve.
        </li>
        <li>
          <strong>Show cost basis</strong> - Toggle the orange dashed line showing your total invested
          amount (sum of purchase values across active tickers). Cost basis enters the timeline on each
          holding's first known ownership date. When the portfolio line is above this line you are in
          unrealized profit; below it you are at a loss.
        </li>
        <li>
          <strong>Show trades</strong> - Overlay buy and sell markers on the portfolio value line.
          Green upward triangles mark buy transactions; red downward triangles mark sells. Hover over a
          marker to see the ticker, share count, and price. Trade data comes from your imported transaction
          history. For holdings without individual transaction records, the original purchase date from
          the holdings table is used as a single buy marker.
        </li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Chart 2 - Transaction-Aware Return</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows the same transaction-aware return used by Total Return. Purchases and sales change the
        shares being measured after the trade date; they do not create profit or loss. The chart can be
        read in percentage units or dollars, and can optionally separate price return from distributions.
        All return series start at the selected range&apos;s opening baseline.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Profit Sources</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Price return (cyan)</strong> - Cumulative market-price gain or loss while the replayed
          holdings were owned. It excludes dividends and other distributions.</li>
        <li><strong>Distributions (orange)</strong> - Distributions actually paid during the selected range,
          using broker payment history when available and Yahoo market history as a ticker-level fallback.</li>
        <li><strong>Tracker total return (gray dotted)</strong> - The combined transaction-aware result. In
          amount mode it is price return plus distributions; in percent mode it is the shared
          dividend-reinvested Tracker Total Return %.</li>
        <li><strong>Group by the profit source</strong> - When enabled, the chart shows the three lines above.
          When disabled, it shows only the combined tracker-total-return line.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Performance Controls</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Tracker return, %</strong> - Shows the return as a percentage, matching the
          Tracker Total Return % cards on Growth and Total Return.</li>
        <li><strong>Tracker return, amount</strong> - Shows the cash-flow-adjusted dollar result and
          separates price return from distributions when source grouping is enabled.</li>
        <li><strong>Show cost basis</strong> - This is a control for Chart 1, not a second return
          calculation. It overlays the invested-cost line so you can compare portfolio value with
          the amount paid for the active holdings.</li>
        <li><strong>Show trades</strong> - This is a control for Chart 1. Green upward triangles are
          buys and red downward triangles are sells from the imported transaction history.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tips</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Use <strong>Show cost basis</strong> to see at a glance how far portfolio value is above or
          below the recorded investment line.</li>
        <li>Switch to <strong>Tracker return, %</strong> when comparing performance with the other
          tracking pages or with portfolios of different sizes.</li>
        <li>Turn off <strong>"Group by the profit source"</strong> for a clean single-line total view,
          then turn it back on to see how much of your profit comes from dividends versus price appreciation.</li>
        <li>Use the <strong>Tickers</strong> filter to isolate a specific holding or category of holdings
          and see how their value and P&amp;L have tracked over time.</li>
        <li>Use the amount view when you want the dollar impact of price movement and distributions;
          use the percentage view when you want a timing-neutral comparison. Realized P/L and fees are
          accounted for elsewhere in the tracker and are not separate lines in this chart.</li>
      </ul>
    </div>
  )
}

function DividendsHelp() {
  return (
    <div>
      <h2>Dividend Analysis</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Dividend Analysis page gives you a comprehensive view of your portfolio's income generation.
        It shows how much dividend income you're earning, projects future income, tracks which holdings
        have "paid for themselves" through dividends, and breaks down your portfolio by investment type.
        Use this page to understand your income stream and identify your strongest dividend performers.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/dividends/Screenshot 2026-05-09 095253.jpg" alt="Dividend Analysis page" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      {/* ── Filters ────────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Category Filter</h3>
      <p style={{ marginBottom: '1rem' }}>
        A category dropdown at the top lets you filter the analysis to specific categories (same behavior
        as the Growth page). Select one or more categories to see dividend metrics for just those groups,
        or leave it on "All Holdings" for the full portfolio view. Changing the filter refreshes all
        charts, metrics, and the data table.
      </p>

      {/* ── Metrics Strip ──────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Metrics Strip</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A row of summary cards across the top provides key income metrics at a glance:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Portfolio Grade</strong> — A letter grade (A+ through F) with a numeric score,
          assessing overall dividend quality. Factors in yield, consistency, and risk-adjusted returns.
        </li>
        <li>
          <strong>Sharpe Ratio</strong> — Risk-adjusted return metric (same as on the Growth page).
        </li>
        <li>
          <strong>Sortino Ratio</strong> — Downside-risk-adjusted return metric.
        </li>
        <li>
          <strong>Total Divs YTD</strong> — Total dividend income received so far this year.
        </li>
        <li>
          <strong>Total Divs Received</strong> — Lifetime total of all dividends received across all holdings.
        </li>
        <li>
          <strong>Est. Monthly Income</strong> — Projected monthly dividend income based on current holdings
          and their dividend rates.
        </li>
        <li>
          <strong>Actual Income</strong> — The actual dividend income received in the current month,
          labeled with the month name (e.g., "Actual Income (Mar)").
        </li>
        <li>
          <strong>Est. Annual Income</strong> — Projected yearly dividend income.
        </li>
      </ul>

      {/* ── Charts ─────────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Charts</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Six interactive Plotly charts are displayed in a responsive grid:
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Annual Income</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A bar chart showing total dividend income received per year. Use this to see whether your
        income is growing year-over-year as you add positions and benefit from dividend increases.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Projected Monthly Income</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows expected dividend income for each month going forward, based on each holding's dividend
        amount, frequency, and pay schedule. Helps you anticipate cash flow and plan reinvestments.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Monthly Received</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A bar chart of actual dividends received by month (historical). Compare this against the
        projected chart to see if your actual income matches expectations.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Total Dividends by Ticker</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A bar chart ranking each holding by total lifetime dividends received. Your biggest income
        generators appear at the top. Useful for understanding which positions contribute most to
        your income stream.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Paid For Itself (%)</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows what percentage of each holding's original cost has been recovered through dividends.
        A holding at 100% has returned its entire purchase price in dividends alone — anything above
        that is pure profit from income. This is a powerful metric for long-term dividend investors.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>By Type</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A distribution chart breaking down your portfolio by investment type (e.g., ETF, stock, REIT, CEF).
        Helps you understand the composition of your income sources.
      </p>

      {/* ── Data Table ─────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Data Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the charts is a sortable data table with one row per holding and a totals row at the bottom.
        Click any column header to sort — click again to reverse the direction. Sort arrows indicate
        the active column and direction. Drag a header to move that column anywhere in the table,
        or use the Columns picker to hide columns and change their order. The layout is saved on
        this computer. Ticker always stays visible. Footer totals stay under the columns they belong to.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Columns</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The stock/ETF symbol.</li>
        <li><strong>Description</strong> — The holding's name.</li>
        <li><strong>Category</strong> — The assigned category.</li>
        <li><strong>YTD Divs</strong> — Year-to-date dividends received for this holding.</li>
        <li><strong>Total Divs</strong> — Lifetime total dividends received (shown in bold).</li>
        <li><strong>Paid For Itself</strong> — Percentage of cost recovered through dividends.
          Colored <span style={{ color: 'var(--pos)' }}>green</span> at 100%+ and <span style={{ color: 'var(--p-ffd700)' }}>gold</span> at 50%+.</li>
        <li><strong>Div Paid</strong> — Estimated cash amount of one dividend payment for your current share count.</li>
        <li><strong>Est. Annual</strong> — Estimated annual dividend income from this holding.</li>
        <li><strong>Est. Monthly</strong> — Estimated monthly dividend income.</li>
        <li><strong>Yield on Cost</strong> — Annual dividend yield based on your purchase price (what you're earning on your original investment).</li>
        <li><strong>Current Yield</strong> — Annual dividend yield based on today's market price.</li>
        <li><strong>Gain / Loss</strong> — Unrealized capital gain or loss. Colored
          <span style={{ color: 'var(--pos)' }}> green</span> if positive,
          <span style={{ color: 'var(--neg)' }}> red</span> if negative.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Row Highlighting</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Holdings that have reached 100% "Paid For Itself" are highlighted with a subtle green background
        tint, making them easy to spot in the table.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Footer Totals</h4>
      <p style={{ marginBottom: '1rem' }}>
        The last row shows portfolio-wide totals for all numeric columns — total YTD dividends,
        total lifetime dividends, total estimated annual and monthly income, and total gain/loss.
      </p>

      {/* ── How to Use ─────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Check the metrics strip</strong> for a quick snapshot — your estimated monthly and
          annual income, plus how much you've earned year-to-date.
        </li>
        <li>
          <strong>Review the Annual Income chart</strong> to confirm your dividend income is growing
          over time.
        </li>
        <li>
          <strong>Use the Projected Monthly chart</strong> to plan — some months may have higher
          payouts than others depending on your holdings' pay schedules.
        </li>
        <li>
          <strong>Sort the table by "Paid For Itself"</strong> to find your most successful long-term
          holdings — those that have returned their cost in dividends.
        </li>
        <li>
          <strong>Sort by "Yield on Cost"</strong> to find your best income-per-dollar investments.
          A high YOC means the holding is generating strong income relative to what you paid.
        </li>
        <li>
          <strong>Use category filters</strong> to compare income generation across different parts
          of your portfolio.
        </li>
      </ol>
    </div>
  )
}

function DivCalendarHelp() {
  return (
    <div>
      <h2>Dividend Calendar</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Dividend Calendar has three views. <strong>Month</strong>, the default view, places expected
        pay dates on a Monday–Sunday calendar. <strong>Agenda</strong> groups the same payments by the
        date cash is expected to arrive and shows ex-dividend dates as supporting information.
        The Dashboard reuses the Month layout for the current week.
        <strong>Optimization</strong> projects those payments across the next 12 months so you can
        see whether income is evenly distributed or concentrated in certain months. Use this page
        for dividend timing and income-smoothing research; it is not a buy/sell signal.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/div-calendar/Screenshot 2026-05-09 100041.jpg" alt="Dividend Calendar" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      {/* ── What the Page Shows ─────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Agenda View</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Agenda tab shows a chronological payment schedule, including money-market
        funds such as FZDXX that have no issuer ex-dividend date, and holdings whose frequency you
        set by hand (for example a semi-annual fund pinned to March and September) when Yahoo has
        no dates yet. Money-market funds use the last business day of the month; a pinned
        semi-annual schedule uses the last business day of March and September. Payments are grouped
        by expected pay date so the primary date always means when cash is scheduled to arrive. Each row contains:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Pay-date group</strong> — The full expected payment date, number of payments, and
          combined portfolio income scheduled for that date.
        </li>
        <li>
          <strong>Ticker &amp; Description</strong> — The symbol and name of the paying holding.
        </li>
        <li>
          <strong>Ex-dividend date</strong> — The eligibility date shown as secondary information.
          To receive the dividend, you must own shares before this date.
        </li>
        <li>
          <strong>Portfolio income</strong> — The estimated cash payment based on the selected account's
          share quantity, followed by the amount per share and payment frequency when available.
        </li>
        <li>
          <strong>Date status</strong> — A Confirmed or Estimated badge for future payments; recent
          dates can show paid-this-week or paid-this-month status.
        </li>
      </ul>

      {/* ── Paid Status ─────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Paid Status Indicators</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Agenda rows identify recent payment dates:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Paid this week</strong> — The pay date fell within the current calendar week
          (Monday through today). A green <span style={{ color: 'var(--pos-bright)' }}>✓ paid this week</span> badge appears.
        </li>
        <li>
          <strong>Paid this month</strong> — The pay date was earlier in the current month but
          before this week. The badge shows "paid this month".
        </li>
        <li>
          <strong>Confirmed / Estimated</strong> — Future dates show whether the source has confirmed
          the date or the app inferred it from the current schedule.
        </li>
      </ul>

      {/* ── Filters ─────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filters</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Three filter buttons appear above the agenda. Click one to narrow the payment dates:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>All Dates</strong> — Shows every scheduled payment, including past and future dates.
        </li>
        <li>
          <strong>Upcoming</strong> — Shows only payments dated today or later. This is the default
          Agenda filter and gives you a clean forward-looking view.
        </li>
        <li>
          <strong>Next 30 Days</strong> — Shows only holdings with a pay date within the next
          30 days. Useful for short-term income planning.
        </li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        A count next to the filter buttons shows how many payments match the current filter
        (e.g., "12 payments"). If no events match the active filter, a "No payments match this date filter"
        message is shown.
      </p>

      {/* ── Estimated vs Confirmed ──────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Estimated vs. Confirmed Pay Dates</h3>
      <p style={{ marginBottom: '1rem' }}>
        A note in the filter bar explains the status convention:
        <em> "~ estimated date | ✓ confirmed date"</em>.
        Estimated pay dates are calculated by the app based on the holding's typical payment schedule.
        Confirmed dates come directly from the data source (Yahoo Finance or your import).
        Always check your broker for the official payment date on high-value holdings.
      </p>

      {/* ── How to Use ──────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Open Agenda</strong> to see the forward dividend schedule grouped by the date cash
          should arrive. Upcoming is selected automatically.
        </li>
        <li>
          <strong>Use "Next 30 Days"</strong> when you want to plan short-term cash flow or know
          exactly what income to expect this month.
        </li>
        <li>
          <strong>Check the date status</strong> for each payment. Treat dates marked with ~ Estimated
          as approximate until the source confirms them.
        </li>
        <li>
          <strong>Watch for the ex-dividend date</strong> if you're considering adding to a position —
          buying before the ex-div date captures the upcoming dividend; buying on or after it means
          waiting until the next cycle.
        </li>
        <li>
          <strong>Switch to "All Dates"</strong> to review past payments and confirm which holdings paid
          this week or this month using the green badge indicators.
        </li>
        <li>
          <strong>Open "Optimization"</strong> to see whether the next 12 months are smooth or uneven.
          Start with the Shortfall Months table, then use Schedule-Fit Candidates only as a research
          list for pay-date timing.
        </li>
        <li>
          <strong>If no events appear</strong>, ensure your holdings have ex-dividend dates populated.
          Run "Refresh Prices &amp; Divs" on the Holdings page or re-import your data to pull the
          latest dates from Yahoo Finance.
        </li>
      </ol>
    </div>
  )
}

function EarningsCalendarHelp() {
  return (
    <div>
      <h2>Earnings Calendar</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Earnings Calendar surfaces upcoming and recent quarterly earnings dates for the
        individual stocks you hold. Earnings surprises &mdash; especially misses on EPS &mdash; are one
        of the strongest near-term threats to dividend safety, so keeping an eye on this schedule
        complements the Dividend Calendar.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/earnings-calendar/Screenshot 2026-05-09 100408.jpg" alt="Earnings Calendar" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>What the Page Shows</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each holding with an earnings date appears as a card. Cards are sorted chronologically from
        earlier to later dates, left to right. Each card contains:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Date column</strong> &mdash; The day, month, and weekday of the next (or most recent)
          earnings announcement.
        </li>
        <li>
          <strong>Days-until label</strong> &mdash; Upcoming cards show "today", "tomorrow", or
          "in N days" so you can spot what's imminent at a glance.
        </li>
        <li>
          <strong>EPS Est</strong> &mdash; Wall Street's consensus EPS estimate for the upcoming report.
        </li>
        <li>
          <strong>Last Actual / Last Est</strong> &mdash; The reported EPS from the most recent quarter
          and the consensus estimate it was measured against.
        </li>
        <li>
          <strong>Surprise %</strong> &mdash; How far the reported EPS came in above (▲ green) or below
          (▼ red) the prior estimate. A pattern of misses is a yellow flag for dividend coverage.
        </li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filters</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Upcoming</strong> (default) &mdash; Future earnings only.</li>
        <li><strong>Next 30 Days</strong> &mdash; Reports landing in the next month.</li>
        <li><strong>Past 30 Days</strong> &mdash; Recent reports, useful for reviewing surprises.</li>
        <li><strong>All</strong> &mdash; Everything on file for your holdings.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Sources</h3>
      <p style={{ marginBottom: '1rem' }}>
        The app layers several sources to maximize coverage. For each ticker it starts with Yahoo
        Finance (via yfinance), then fills any missing fields from three Nasdaq endpoints in turn:
        the quote/info feed for the next announcement date, the quote/eps feed for the upcoming
        consensus estimate, and the company earnings-surprise feed for the last quarter's actual,
        estimate, and surprise %. Each source is cached per-ticker for several hours, so first
        load may be slow but repeat visits are fast. ETFs and funds typically don't report
        earnings, so they are silently omitted from the calendar &mdash; an empty page usually
        means the active portfolio holds no individual stocks.
      </p>
      <p style={{ marginBottom: '1rem', color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
        Note: Zacks's per-symbol earnings pages are gated by Imperva bot detection, so they can't
        be scraped from the backend. If Zacks ever publishes an open feed, it would be a natural
        addition here.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Start in <strong>Upcoming</strong> to see what earnings dates are on the horizon.</li>
        <li>Switch to <strong>Past 30 Days</strong> after a busy week to scan for misses on income holdings.</li>
        <li>If a holding shows a string of misses, cross-check the Dividend Calendar and Buy / Sell Signals before adding to the position.</li>
      </ol>
    </div>
  )
}

function DivCompareHelp() {
  return (
    <div>
      <h2>Dividend Compare — Forward vs TTM</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Dividend Compare page lets you analyze and compare dividend metrics across your portfolio
        holdings and any external tickers you want to research. It shows two key dividend figures
        side by side: <strong>Forward</strong> (projected future dividends) and <strong>TTM</strong>
        (Trailing 12-Month — what was actually paid over the past year). This distinction is important
        because a company may have recently changed its dividend rate, making the forward figure more
        relevant for income planning while the TTM reflects historical reality.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/div-compare/Screenshot 2026-05-09 100606.jpg" alt="Dividend Compare" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      {/* ── Forward vs TTM ─────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Forward vs. TTM — What's the Difference?</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Forward Annual Dividend (Fwd Ann. Div/Sh)</strong> — The projected annual dividend
          per share based on the most recent declared dividend, annualized. This is what you expect
          to receive going forward if the current rate holds. Shown in <span style={{ color: 'var(--pos)' }}>green</span>.
        </li>
        <li>
          <strong>Forward Annual Yield (Fwd Ann. Yield)</strong> — Forward dividend divided by the
          current price. This is the yield you're buying at today's price.
        </li>
        <li>
          <strong>Forward Annual Income (Fwd Ann. Income)</strong> — For your holdings only: Forward
          dividend × shares held. Your projected annual income from this position.
        </li>
        <li>
          <strong>TTM Dividend/Share (TTM Div/Sh)</strong> — The sum of all dividends actually paid
          per share over the trailing 12 months. This is historical fact, not projection.
          Shown in <span style={{ color: 'var(--accent-bright)' }}>blue</span>.
        </li>
        <li>
          <strong>TTM Annual Yield (TTM Ann. Yield)</strong> — TTM dividend divided by current price.
        </li>
        <li>
          <strong>TTM Annual Income (TTM Ann. Income)</strong> — For your holdings only: TTM dividend
          × shares held. What you actually received over the past year.
        </li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        If Forward yield is significantly higher than TTM, the company recently raised its dividend.
        If Forward is lower, it may have cut. A large gap between the two is worth investigating.
      </p>

      {/* ── Portfolio Holdings Table ────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Holdings Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The top table shows all holdings in your currently selected portfolio. It includes a
        <strong> Qty</strong> column (shares held) and the income columns (Fwd Ann. Income, TTM Ann. Income)
        since those are position-specific. A <strong>Totals row</strong> at the bottom sums the
        forward and TTM income across all holdings.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Sorting:</strong> Click any column header to sort ascending or descending.
        An arrow indicator shows the active sort column and direction. Clicking the same column again
        reverses the direction.
      </p>

      {/* ── Ticker Lookup ───────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Look Up Tickers</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the holdings table is a lookup tool that lets you research any ticker — whether you own
        it or not. This is useful for comparing your holdings against similar ETFs or stocks you're
        considering buying.
      </p>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Type one or more ticker symbols</strong> in the text box, separated by commas or
          spaces (e.g., <em>SCHD, VIG, JEPI</em>).
        </li>
        <li>
          <strong>Press Enter or click "Look Up"</strong>. The app fetches live dividend data from
          Yahoo Finance for each ticker.
        </li>
        <li>
          The <strong>Lookup Results table</strong> appears below showing the same columns as the
          holdings table, but without Qty or income columns (since you don't hold these positions).
        </li>
        <li>
          You can <strong>add more tickers</strong> to the results without clearing existing ones —
          results accumulate until you click "Clear".
        </li>
        <li>
          Click <strong>"Clear"</strong> to wipe the lookup results and start fresh.
        </li>
      </ol>

      {/* ── How to Use ──────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Sort by Fwd Ann. Yield</strong> to rank your holdings by their projected income
          yield — quickly see which positions are your highest income generators.
        </li>
        <li>
          <strong>Compare Fwd vs TTM columns</strong> to spot dividend changes. A holding where
          Forward is much higher than TTM recently raised its dividend — a positive sign.
          One where Forward is lower may have cut.
        </li>
        <li>
          <strong>Look up comparison tickers</strong> before adding a new position. Type in
          alternative ETFs (e.g., SCHD vs DGRO vs VIG) to compare their dividend yields and
          decide which offers better income at today's price.
        </li>
        <li>
          <strong>Check TTM Income totals</strong> to verify your actual received income matches
          your records.
        </li>
      </ol>
    </div>
  )
}

function DividendHistoryHelp() {
  return (
    <div>
      <h2>Dividend History</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Dividend History page plots dividends received over time from recorded broker payments and refresh-tracked
        same-day estimates. It is designed for looking backward at what you were paid or what the app detected as
        payable on a refresh date, not projecting future income.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/dividend-history/Screenshot 2026-05-09 100726.jpg" alt="Dividend History" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Views and Ranges</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Yearly</strong> — shows annual totals as a bar chart.</li>
        <li><strong>Monthly</strong> — shows monthly dividends as an area chart with an optional 3-month moving average.</li>
        <li><strong>Weekly</strong> — shows weekly dividend history for shorter lookbacks.</li>
        <li><strong>Range buttons</strong> — Monthly and Weekly views include preset lookback ranges so you can quickly zoom in or out.</li>
        <li><strong>Partial current period</strong> - The current month is labeled like <em>Apr '26 partial</em>, the current year is labeled like <em>2026 YTD</em>, and today's weekly entry is labeled <em>today</em>. These labels mean the period is still incomplete.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Sources</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Broker payments</strong> - Imported dividend transactions from Schwab, E*TRADE, Fidelity, Snowball, or generic sources are treated as actual payment history.</li>
        <li><strong>Refresh estimates</strong> - Refresh Prices &amp; Divs can add source <code>refresh_estimate</code> rows when a holding's expected pay date matches the refresh date. These rows let the history chart begin tracking same-day distributions even before a broker transaction file is imported. Dividend repair excludes them from actual payment totals so they do not replace or inflate imported broker actuals.</li>
        <li><strong>Actuals replace estimates</strong> - If a later broker import brings in the actual payment for the same ticker, account, and date, the actual amount replaces the refresh estimate.</li>
        <li><strong>Legacy payout tables</strong> - If older monthly or weekly payout tables exist for an account, Dividend History keeps using that history and only fills missing periods with refresh-estimated rows. A new refresh estimate will not hide the older history.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filters and Overlay</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Category filter</strong> — limit the history to selected portfolio categories.</li>
        <li><strong>Show Cumulative</strong> — overlays a cumulative dividends line on a second axis.</li>
        <li><strong>Weekly category note</strong> — when filtering weekly history by category, values are estimated proportionally for the selected slice.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Strip</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The cards above the chart show total dividends, average period amount, min, max, and the change from
        the first period in the selected range.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>CHANGE VS FIRST MONTH</strong> - Monthly view compares the last completed month to the first month in the selected range.</li>
        <li><strong>CHANGE VS FIRST YEAR</strong> - Yearly view compares the latest completed year to the first year when enough completed yearly data exists.</li>
        <li><strong>CHANGE VS FIRST PERIOD</strong> - Weekly view compares the latest completed period to the first period in the selected range.</li>
        <li><strong>Partial periods are excluded when possible</strong> - The current incomplete month, year, or day is not used as the ending point for the change calculation when there are at least two completed periods. This prevents a partial current period from looking like a dividend-income collapse.</li>
      </ul>
    </div>
  )
}

function DividendLedgerHelp() {
  return (
    <div>
      <h2>Daily, Weekly &amp; Monthly Payments</h2>
      <p style={{ marginBottom: '1rem' }}>
        This page answers three questions off the same payment records: what was I paid today, what
        has this week paid out so far, and what has this month paid out so far. Every dividend lands
        on exactly one day, so the weekly and monthly figures are running totals over the daily ones
        — a day with payments pushes both totals up by that day&apos;s amount, and a day with nothing
        paid leaves both where they were. Where <strong>Dividend History</strong> looks at long-run
        trends, this page is the day-by-day record.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>The four cards</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The cards at the top are always <em>as of today</em>, no matter which month you are browsing
        below. Each one compares itself to the same point in the period before it, so a period still
        in progress is never judged against a finished one.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Paid today</strong> — today&apos;s total and how many holdings paid. When nothing has been paid yet, it shows what the same weekday paid last week, and the Today panel names the last day money actually arrived.</li>
        <li><strong>Week to date</strong> — the running total for the current week, with the day number out of 7 and the change against the same point last week.</li>
        <li><strong>Month to date</strong> — the running total for the current month, compared with the prior month over the same number of days.</li>
        <li><strong>Year to date</strong> — the calendar-year total, compared with the same date last year.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>The ledger</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Paid that day</strong> — the day&apos;s own total. Click any day with payments to expand the per-holding breakdown; when the view covers more than one account, each holding also shows the split across them.</li>
        <li><strong>Week to date / Month to date</strong> — the running balances. A day that added money shows its new total in full colour; a quiet day shows the carried-forward value dimmed, so you can see at a glance that nothing changed.</li>
        <li><strong>Week subtotal rows</strong> — after each week&apos;s last day, with the number of paying days in that week.</li>
        <li><strong>Month total</strong> — the footer row, split into confirmed and projected amounts.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Owner and aggregate selections</h3>
      <p style={{ marginBottom: '1rem' }}>
        A dividend is recorded against the account that received it, so a selection covering several
        accounts — <strong>Owner</strong>, which reads the accounts linked to it, or any aggregate —
        reports the sum of its members. The intro line names the accounts being added together, and
        a <strong>by account</strong> strip under the month summary breaks the month&apos;s total
        back out per account with each one&apos;s share, so you can see which account the money came
        from. An account that paid nothing that month is left out of the strip.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Weeks that cross a month boundary</h3>
      <p style={{ marginBottom: '1rem' }}>
        A week total always covers a full seven days, so the ledger includes the few adjacent-month
        days a straddling week needs to add up. Those rows are marked <em>other month</em> and their
        Month to date cell is blank — they count toward the week but not the month. The week chips
        above the table spell out how much of a straddling week actually fell inside the month you
        are viewing.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Confirmed vs projected</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Confirmed</strong> — payments imported from a broker (Schwab, E*TRADE, Fidelity, Robinhood, Snowball, generic files). These are money that actually landed.</li>
        <li><strong>Projected</strong> — rows Refresh Prices &amp; Divs wrote with source <code>refresh_estimate</code> because a holding&apos;s expected pay date had arrived but no broker file has confirmed it yet. They are marked <code>est</code> and reported separately in every total, so a projected week is never mistaken for a paid one.</li>
        <li><strong>Include projected payments</strong> — turn this off for a confirmed-only view. Recent days will read low until the next broker import lands.</li>
        <li>When a broker import later brings in the actual payment for the same ticker, account, and date, it replaces the estimate rather than adding to it.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Controls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Month navigation</strong> — step back and forward, or jump straight to any month that has payments. <em>This month</em> returns to the current one.</li>
        <li><strong>Week starts</strong> — Monday or Sunday. This changes where every week boundary falls, and therefore the weekly totals. The choice is remembered.</li>
        <li><strong>Show every payment</strong> — expands the per-holding detail for every paying day at once.</li>
        <li><strong>Chart</strong> — daily bars stacked as confirmed plus projected, with the month-to-date running line on the right axis.</li>
      </ul>
    </div>
  )
}

function TotalReturnHelp() {
  return (
    <div>
      <h2>Total Return Dashboard</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Total Return page gives you the complete picture of your investment performance —
        combining both capital gains (price appreciation) and dividend income into a single
        return figure. This is the most accurate measure of how your portfolio is actually doing,
        since dividends can represent a significant portion of total returns for income-focused investors.
        A page-wide broker-style date selector keeps the summary cards, holding-return chart,
        side-by-side comparison, scatter plot, and detailed holdings table on the same window.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>This is the tracker-return reference:</strong> its transaction-aware Total Return % is the
        same percentage used by Dashboard, Growth, and Gains &amp; Losses.
        Match the portfolio, holdings filter, and effective dates to reconcile the figure. Every performance
        chart title prints its From and To dates. Dollar P&amp;L views
        elsewhere can differ because
        deposits, withdrawals, and position size are meaningful in dollars but are excluded from return. The
        Shared Performance Date Range is remembered across Dashboard, Growth, Total Return, Gains &amp; Losses, and Holdings.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/total-return/total-return-current.png" alt="Current Total Return page" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      {/* ── Category Filter ─────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Category Filter</h3>
      <p style={{ marginBottom: '1rem' }}>
        If you have categories defined, a filter dropdown appears at the top. Select one or more
        top-level categories or sub-categories to narrow the summary, charts, and table to just those
        holdings. Choices are combined with <strong>OR</strong>; selecting a whole category supersedes
        its sub-category choices. "All Holdings" is the default. Changes trigger an immediate refresh
        of all data on the page.
      </p>

      {/* ── Summary Strip ───────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Strip</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A row of metric cards shows transaction-aware figures for the selected Shared Performance Date Range.
        Every card prints the effective portfolio start and end dates:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Start Value / End Value</strong> — Holdings-only market value at the effective period boundaries; cash is not included in these two cards.</li>
        <li><strong>Account Value</strong> — End Value plus recorded cash and any open option contracts, shown when reconciliation data is available. Compare this figure with a broker&apos;s net liquidating value.</li>
        <li><strong>Price Return</strong> — Dollar price movement while holdings were owned.</li>
        <li><strong>Distributions</strong> — Broker-imported cash payments by payment date when available, with Yahoo market history used only as a ticker-level fallback.</li>
        <li><strong>Total Return</strong> — Price movement plus distributions, excluding purchase and sale cash flows.</li>
        <li><strong>Tracker Total Return %</strong> — Daily time-weighted return, so deposits, purchases, and sales do not appear as performance. This is the shared percentage used by the other tracking pages.</li>
        <li><strong>SPY - period</strong> — SPY total return for its exact displayed market-observation range, shown as the benchmark card when benchmark data is available.</li>
      </ul>
      <p style={{ marginBottom: '1rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        All begins at the first defensible portfolio ownership date. Rolling periods use exact
        calendar date-to-date boundaries with the close on or before the requested start as the
        baseline, and Custom uses the inclusive dates entered by the user.
      </p>

      {/* ── Total Return Bar Chart ──────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Total Return % by Ticker Chart</h3>
      <p style={{ marginBottom: '1rem' }}>
        A horizontal bar chart showing each holding's total return percentage over the selected
        period (live from Yahoo Finance, including dividends). Bars are color-coded per ticker —
        green bars are positive, red are negative. A gold dashed vertical line marks SPY's selected-period
        return as a benchmark reference. Each ticker label is colored to match its bar.
        Hover over any bar for the exact value and effective held-period range.
      </p>

      {/* ── Performance Comparison ──────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Performance Comparison Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A fully customizable line chart that lets you plot any combination of your holdings and
        external tickers side by side on a normalized scale (all lines start at 100). This is ideal
        for seeing which of your positions has outperformed, or comparing your holdings to benchmarks
        like SPY, QQQ, or sector ETFs.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Controls</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Shared Performance Date Range</strong> — The page-wide 1D, 7D, 1M, 3M, 6M, YTD, 1Y,
          5Y, All, and Custom choices update the summary cards, holding-return chart,
          comparison chart, scatter chart, and holdings summary together. All starts with
          the portfolio&apos;s first recorded trade; Custom accepts inclusive start and end dates.
          Every card displays its effective dates, every chart title shows From and To dates, and each holding also lists its held-period range.
          See <strong>What the range buttons measure</strong> below for the exact start each one resolves to.
        </li>
        <li>
          <strong>Portfolio &amp; Tickers dropdown</strong> — Select <strong>Entire Portfolio</strong>,
          individual holdings, or both. Use "All" to add the portfolio and every holding at once,
          or "Clear" to deselect everything. The portfolio line is a daily time-weighted return
          reconstructed from dated BUY/SELL quantities, so purchases and sales change its weights
          without being counted as investment performance. A current position without transaction
          history begins on its saved purchase date, or its import/snapshot date when no purchase
          date is available; it is never treated as owned since the ticker's first-ever quote.
          If a broker export begins with a DRIP or sale for a position that was already open, the
          missing opening quantity is reconciled backward from the current saved share count.
        </li>
        <li>
          <strong>External Tickers</strong> — Type any ticker symbols (e.g., <em>SPY QQQ VOO</em>)
          and click "Add" to include tickers you don't own. These are fetched live from Yahoo Finance.
          Added tickers are shown as a list; click "Clear" to remove them.
        </li>
        <li>
          <strong>Return Type</strong> — Choose <strong>Total Return</strong> (full dividend
          reinvestment), <strong>Price Only</strong>, <strong>Price + Divs</strong> (distributions
          held as cash), or <strong>Both</strong> to overlay Total Return and Price Only using
          matching colors and different line styles.
        </li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        All lines are normalized to 100 so that securities with different share prices can be
        directly compared. A dashed gray baseline at 100 marks the starting value. Hover over the
        chart for a unified tooltip showing all values at a given date.
      </p>

      {/* ── What the range buttons measure ──────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>What the Range Buttons Measure</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each button sets only the <strong>start</strong> of the window. Every range ends at the latest
        <strong> market observation</strong> — a live quote when available today, otherwise the most recent
        close — so the end date never changes between buttons; only the start moves. Return is measured
        from the close on the start date, which makes that day the
        baseline rather than the first day of gain. Hovering any button shows the same detail in a tooltip.
      </p>
      <p style={{ marginBottom: '0.5rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        Worked example for a run on <strong>Monday, August 10, 2026</strong>:
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: '0.85rem', minWidth: '620px' }}>
          <thead>
            <tr>
              <th style={{ padding: '0.4rem 0.75rem' }}>Button</th>
              <th style={{ padding: '0.4rem 0.75rem' }}>Start</th>
              <th style={{ padding: '0.4rem 0.75rem' }}>End</th>
              <th style={{ padding: '0.4rem 0.75rem' }}>How the start is derived</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['1D', '8/7/2026', '8/10/2026', 'The previous trading session, not the previous calendar day. Resolved as the last two sessions, so a Monday correctly measures back to Friday instead of to a closed Sunday market.'],
              ['7D', '8/3/2026', '8/10/2026', 'Exactly 7 calendar days back, so always the same weekday as today. Calendar days, not trading days — the window spans 5–6 closes.'],
              ['1M', '7/10/2026', '8/10/2026', 'One calendar month back on the same day of the month, clamped to the last day in shorter months (3/31 → 2/28).'],
              ['3M', '5/10/2026', '8/10/2026', 'Three calendar months back on the same day of the month, clamped the same way.'],
              ['6M', '2/10/2026', '8/10/2026', 'Six calendar months back on the same day of the month, clamped the same way.'],
              ['YTD', '1/1/2026', '8/10/2026', 'January 1 of the current year. The baseline uses the final close on or before January 1, so the first trading session of the year is included in the YTD move.'],
              ['1Y', '8/10/2025', '8/10/2026', 'One calendar year back on the same month and day. February 29 falls back to February 28.'],
              ['5Y', '8/10/2021', '8/10/2026', 'Five calendar years back on the same month and day, with the same leap-day fallback.'],
              ['All', 'First recorded trade', '8/10/2026', "The portfolio's own earliest trade, purchase, or import date — never a benchmark's older quote history."],
              ['Custom', 'Whatever you enter', 'Whatever you enter', 'Both dates are inclusive. Dates before 1/1/1970 are treated as still being typed and are not sent.'],
            ].map(([button, start, end, derivation]) => (
              <tr key={button}>
                <td style={{ padding: '0.4rem 0.75rem', fontWeight: 600 }}>{button}</td>
                <td style={{ padding: '0.4rem 0.75rem', whiteSpace: 'nowrap' }}>{start}</td>
                <td style={{ padding: '0.4rem 0.75rem', whiteSpace: 'nowrap' }}>{end}</td>
                <td style={{ padding: '0.4rem 0.75rem' }}>{derivation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: '0.75rem', marginBottom: '1rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        Every preset is recalculated from the current date on each request, so the windows roll forward
        on their own — a year later, 1Y on 8/10/2027 resolves to 8/10/2026. Apart from 1D, the presets
        use the close on or before the computed start, even when that start lands on a weekend or
        holiday. The longer windows absorb that baseline adjustment; 1D is resolved by trading session
        so it measures the immediately preceding session instead.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Where the Measurement Starts and What the Scale Means</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Each external ticker is measured from its <strong>first available Yahoo Finance trading value within
        the selected period</strong>. Portfolio and holding lines cannot begin before the position was
        actually owned. Each line is reset to 100. The chart is therefore a relative
        performance index—not dollars, a score, your purchase price or cost basis, or an annualized return.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>100</strong> — unchanged from the ticker's starting value.</li>
        <li><strong>120</strong> — a cumulative gain of 20% over the displayed period.</li>
        <li><strong>140</strong> — a cumulative gain of 40% over the displayed period.</li>
        <li><strong>80</strong> — a cumulative loss of 20% over the displayed period.</li>
        <li><strong>50</strong> — a cumulative loss of 50% over the displayed period.</li>
        <li><strong>0</strong> — an effective loss of 100%.</li>
      </ul>
      <p style={{ marginBottom: '1rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        The requested window limits the measurement, but a holding cannot begin before it was
        actually owned. A newer holding may therefore begin at 100 later than the portfolio or
        benchmark, and its effective dates are shown in the holdings summary. In
        <strong>Total Return</strong> mode, Yahoo's adjusted-close history accounts for
        distributions as though reinvested; <strong>Price</strong> mode shows price movement without
        distributions. Extreme drops or jumps can sometimes reflect Yahoo data or corporate actions.
      </p>

      {/* ── Scatter Chart ───────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Total Return % vs. Yield on Cost Scatter</h3>
      <p style={{ marginBottom: '1rem' }}>
        A bubble scatter chart plotting each holding&apos;s selected-period return (Y-axis) against its
        current annual yield on cost (X-axis). Use the <strong>%</strong> / currency buttons to switch
        the Y-axis between percentage return and return dollars. Bubble size represents ending position
        value and color identifies the holding&apos;s category. This chart reveals
        the relationship between income generation and capital appreciation — holdings in the
        upper-right have both strong dividends and strong price growth. Hover over any bubble to
        see the ticker and exact values.
      </p>

      {/* ── Holdings Table ──────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Holdings Table — Period Total Return Summary</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A sortable table with a selectable <strong>Positions</strong> view for the selected Shared
        Performance Date Range. <strong>Holdings</strong> shows open positions, <strong>Closed
        Positions</strong> shows sales settled in the range, and <strong>Open + Closed Positions</strong>
        combines both legs by ticker. Click any column header to sort; click again to reverse. The
        footer totals use the corresponding view&apos;s period calculation.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The symbol. Stays visible when you scroll the table sideways, including in Split View.</li>
        <li><strong>Category</strong> — Assigned category.</li>
        <li><strong>Cost/Share</strong> — Average purchase price of the shares still held. This is the figure Schwab labels Cost/Share, not the market price at the start of the range.</li>
        <li><strong>Price at Start / Current Price</strong> — The ticker&apos;s market close on the first and last day of that holding&apos;s effective range. For YTD the start is the last session on or before Jan 1. A range that ends today uses a live quote when available. These are market prices, not cost basis.</li>
        <li><strong>Start Value / End Value</strong> — The position&apos;s market value at its effective period boundaries.</li>
        <li><strong>Price Return / Price Ret %</strong> — Price movement while the position was held; trade cash flows are excluded.</li>
        <li><strong>Distributions</strong> — Broker-imported cash payments during the held period when available, with Yahoo market history as a fallback.</li>
        <li><strong>Total Return / Total Ret %</strong> — Price movement plus distributions, with percentage return calculated as a daily time-weighted return.</li>
        <li><strong>Effective Range</strong> — The exact first and last dates used for that holding.</li>
        <li><strong>RvY</strong> — Return vs. Yield. Compares selected-period Total Ret % to the holding&apos;s current yield or yield on cost. A toggle in the column header switches between <strong>CYld</strong> and <strong>YOC</strong>; the label is <strong>Good</strong> when return exceeds the yield scaled to the same window and <strong>Poor</strong> when it does not.</li>
        <li><strong>Closed / Open + Closed views</strong> — The realized view groups sales by ticker; click the expand arrow to inspect the individual sell lots. The combined view shows open, realized, distribution, and net return columns side by side.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
        Orange Start Value Warning and Repair
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        An orange Start Value means the saved holding contains more shares than the complete recorded
        BUY/SELL ledger accounts for. Total Return reconciles the difference backward as an inferred
        opening lot so it can still replay performance. The flag therefore means <strong>the displayed
        value depends on incomplete transaction history</strong>; it does not automatically mean Start
        Value is overstated. For example, a broker export that begins with DRIPs and sales may simply
        omit the original purchase.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Click the warned value to open the ticker&apos;s transactions. Use <strong>Record the opening
        lot</strong> only after confirming that an original purchase or transfer-in is missing. Owner and
        Aggregate views identify the account that owns the ledger but require you to select that account
        before writing. The created BUY uses the day before the first saved transaction and that day&apos;s
        market close as estimates; it remains editable and deletable.
      </p>
      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        <strong>The repair guarantees share reconciliation, not a correct Start Price or Start Value.</strong>
        It makes recorded buys minus sells equal the saved share count. It cannot validate the saved count,
        detect every duplicate or missing transaction, or prove the estimated opening date and purchase
        price. Start Price is independent market data at the selected range boundary. Start Value may remain
        unchanged because the replay was already pricing the same inferred shares; the warning clears because
        the assumption became a transaction, not because the repair independently verified the value. You do
        not need the entire lifetime history for a recent Start Value if the current share count and every
        trade, transfer, and split from that recent start through today are complete.
      </div>

      {/* ── How to Use ──────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Check the summary strip first</strong> — Total Return % gives you performance for
          the selected range in a single number. Compare it with SPY over its displayed effective dates.
        </li>
        <li>
          <strong>Use the bar chart</strong> to quickly see which holdings are dragging returns over
          the selected period. Negative red bars are candidates for review.
        </li>
        <li>
          <strong>Build a comparison chart</strong> by selecting a few key holdings plus SPY and QQQ
          as external tickers. Set the period to 1Y or 5Y and switch to "Total Return" mode to see
          the true long-term performance including dividends.
        </li>
        <li>
          <strong>Use the scatter chart</strong> to find your best all-round performers — tickers
          with both high yield on cost and strong total return sit in the upper-right quadrant.
        </li>
        <li>
          <strong>Sort the table by Total Ret %</strong> to rank holdings from best to worst over
          the selected period. This helps identify underperformers worth reviewing.
        </li>
        <li>
          <strong>Compare Price Ret % vs Total Ret %</strong> in the table — a big gap between the
          two means dividends are doing a lot of the heavy lifting for that position.
        </li>
      </ol>
    </div>
  )
}

function GainsLossesHelp() {
  return (
    <div>
      <h2>Gains & Losses</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Gains & Losses page provides a complete picture of your investment profit and loss
        across both open (unrealized) and closed (realized) positions. It separates price-only
        gain/loss from figures that include dividends, and it now separates two measurements that
        must not be confused: selected-period Tracker Total Return and lifetime cost-basis G/L.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/gains-losses/gains-losses-current.png" alt="Current Gains and Losses page" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      {/* ── Category Filter ─────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Category Filter</h3>
      <p style={{ marginBottom: '1rem' }}>
        If you have categories defined, a dropdown appears at the top. Select one or more top-level
        categories or sub-categories to filter all summary cards, tables, and charts to just those
        holdings. Choices are combined with <strong>OR</strong>; selecting a whole category supersedes
        its sub-category choices. "All Holdings" is the default.
      </p>

      <p style={{ marginBottom: '1rem' }}>
        The top navigation&apos;s <strong>Basis</strong> selector changes the lifetime cost-basis cards and
        lifetime table columns between <strong>Original cost</strong> and <strong>Broker adjusted cost</strong>
        when an adjusted figure is available. It does not change the selected-period Tracker Total Return
        calculation, which is based on the transaction-aware performance ledger.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Shared Performance Date Range</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The 1D, 7D, 1M, 3M, 6M, YTD, 1Y, 5Y, All, and Custom buttons use the same saved range as
        Dashboard, Growth, and Total Return. The selected-period
        cards, the <strong>Tracker TR %</strong> holding column, and the performance charts all come from
        the exact same transaction-aware endpoint as Total Return. With the same account, holdings
        filter, and effective dates, <strong>Tracker Total Return %</strong> should match after the close.
        Separately read live quotes can differ intraday.
      </p>
      <p style={{ marginBottom: '1rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        1D means the move since the previous trading close, so Monday measures from Friday and market
        holidays are skipped. YTD uses the final close on or before January 1, so the first market session&apos;s
        move is included. Custom dates are inclusive. Hover any range button for its precise rule.
      </p>

      {/* ── Summary Cards ───────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Cards</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The first strip is labeled with the active date filter (<strong>YTD</strong>, <strong>1Y</strong>,
        <strong>1M</strong>, and so on). Those cards are selected-period tracker performance: Start Value,
        End Value, Account Value when reconciliation data is available, Price Return, Distributions,
        Total Return dollars, and Tracker Total Return %. Start Value and End Value are holdings-only
        figures; Account Value adds cash and open option marks for comparison with broker net liquidating
        value. They use the same calculation as Total Return; separately read live quotes can differ
        intraday. Changing the Shared Performance Date Range retitles this strip and recomputes the cards.
        The next two rows sit under a fixed <strong>Lifetime</strong> heading and do not follow that filter:
      </p>
      <h4 style={{ marginBottom: '0.4rem' }}>Top Row — Unrealized (Open Positions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Total Invested</strong> — Sum of all purchase values for positions you still hold.</li>
        <li><strong>Current Value</strong> — Today's market value of those positions.</li>
        <li><strong>Unrealized Price G/L</strong> — Capital gain or loss only (Current Value minus Total Invested). Does not include dividends. Red if negative, green if positive.</li>
        <li><strong>Unrealized Total G/L</strong> — Price G/L plus all dividends received on open positions. A position can be red on price but green on total if dividends more than offset the price decline.</li>
        <li><strong>Total Profit</strong> — next step on those same open holdings: remaining-lot price G/L + guarded lifetime dividends + realized G/L on shares trimmed from those tickers. Cash and fully sold names are excluded. The percent is versus invested/profit basis. Same number as Dashboard Holdings overview <strong>Total profit</strong>. It differs from Combined Total G/L, which includes fully sold tickers.</li>
      </ul>
      <h4 style={{ marginBottom: '0.4rem' }}>Bottom Row — Realized & Combined</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Realized Price G/L</strong> — Capital gain or loss from positions you have sold (sell proceeds minus cost basis). Sourced from SELL transactions recorded via the Holdings transaction system.</li>
        <li><strong>Realized Total G/L</strong> — Realized Price G/L plus all dividends collected on those tickers while you held them. Even a position sold at a price loss can show a positive Total G/L if enough dividends were collected.</li>
        <li><strong>Combined Price G/L</strong> — Unrealized Price G/L + Realized Price G/L. Your overall capital-only profit/loss across all positions, open and closed.</li>
        <li><strong>Combined Total G/L</strong> — Unrealized Total G/L + Realized Total G/L. This is a lifetime accounting total including all recorded dividends, not a selected-period time-weighted return.</li>
      </ul>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Tabs</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Three tabs let you drill into the detail behind the summary numbers. All tables are sortable
        by clicking any column header.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Unrealized Tab</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        One row per holding you currently own. Shows each position's cost basis, current value,
        and gain/loss broken into price-only and total (with dividends).
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker / Description</strong> — The holding and its name.</li>
        <li><strong>Shares</strong> — Number of shares held.</li>
        <li><strong>Price Paid</strong> — Average cost per share.</li>
        <li><strong>Curr Price</strong> — Current market price per share.</li>
        <li><strong>Invested</strong> — Total cost basis (Shares x Price Paid).</li>
        <li><strong>Curr Value</strong> — Current market value (Shares x Curr Price).</li>
        <li><strong>Price G/L</strong> — Unrealized capital gain/loss in dollars.</li>
        <li><strong>Price G/L %</strong> — Price G/L as a percentage of Invested.</li>
        <li><strong>Divs Rcvd</strong> — Total dividends received while holding this position.</li>
        <li><strong>Lifetime Total G/L / Lifetime G/L %</strong> — Cost-basis price G/L plus all recorded dividends, in dollars and as a percentage of Invested.</li>
        <li><strong>Tracker TR % / Effective Range</strong> — Transaction-aware selected-period return and the actual market dates used. Tracker TR % is the directly comparable figure.</li>
        <li><strong>RvY</strong> — Return vs. Yield. Compares Tracker TR % to the holding's dividend yield. <strong>Good</strong> (green) when total return exceeds yield; <strong>Poor</strong> (red) when yield exceeds total return. A toggle in the column header switches between <strong>CYld</strong> (current yield, default) and <strong>YOC</strong> (yield on cost). See the Dashboard help section for a full explanation.</li>
      </ul>
      <p style={{ marginBottom: '1rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        A Portfolio Total footer row sums key columns across all holdings.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Realized Tab</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Sales settled inside the selected range, sourced from SELL transactions recorded in the Holdings
        page. Rows are grouped by ticker; click the expand arrow to inspect the individual sell lots when
        a ticker has more than one sale. The group row shows the combined cost basis, proceeds, distributions,
        and gain/loss for that ticker.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The symbol sold.</li>
        <li><strong>Sell Date</strong> — Date the sale was executed; individual dates appear in the expanded lot details.</li>
        <li><strong>Buy Price</strong> — Average cost per share at time of purchase.</li>
        <li><strong>Sell Price</strong> — Price per share received on sale.</li>
        <li><strong>Shares</strong> — Number of shares sold.</li>
        <li><strong>Cost Basis</strong> — Total cost (Buy Price x Shares).</li>
        <li><strong>Proceeds</strong> — Total received (Sell Price x Shares).</li>
        <li><strong>Price G/L</strong> — Capital gain or loss (Proceeds minus Cost Basis).</li>
        <li><strong>Price G/L %</strong> — Price G/L as a percentage of Cost Basis.</li>
        <li><strong>Divs Rcvd</strong> — Total dividends collected on this ticker while you held it.</li>
        <li><strong>Total G/L</strong> — Price G/L + Dividends Received. Shows your true profit including income.</li>
        <li><strong>Total G/L %</strong> — Total G/L as a percentage of Cost Basis.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Combined Tab</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        One row per ticker across both open and closed positions. Shows unrealized, realized, and
        net figures side by side so you can see the full history of each ticker.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker / Description</strong> — The symbol and name.</li>
        <li><strong>Status</strong> — "Open" (still held), "Closed" (fully sold), or "Open + Closed" (partially sold).</li>
        <li><strong>Unreal. Price G/L</strong> — Unrealized capital gain/loss on remaining shares.</li>
        <li><strong>Unreal. Divs</strong> — Dividends received on remaining shares.</li>
        <li><strong>Unreal. Total G/L</strong> — Unrealized price G/L + unrealized dividends.</li>
        <li><strong>Real. Price G/L</strong> — Realized capital gain/loss from sold shares.</li>
        <li><strong>Real. Divs</strong> — Dividends collected while holding the sold shares.</li>
        <li><strong>Real. Total G/L</strong> — Realized price G/L + realized dividends.</li>
        <li><strong>Net Price G/L</strong> — Unrealized + Realized price G/L combined.</li>
        <li><strong>Net Divs</strong> — Total dividends across open and closed positions.</li>
        <li><strong>Net Total G/L</strong> — The bottom line: total profit/loss from this ticker including all capital gains and dividends, open and closed.</li>
      </ul>

      {/* ── Charts ───────────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Charts</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the lifetime table, the charts use the Shared Performance Date Range at the top and print
        the selected From and To dates directly in every chart title.
        Market data is fetched live, while dated buys and sells keep external cash flows from being
        counted as investment performance.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Cumulative G/L Over Time</strong> — Two area lines showing your portfolio's running
          Price Return (blue) and Tracker Total Return (green) over the selected period. The green line
          is the same index used on Total Return, shifted from a 100 baseline to a 0% baseline.</li>
        <li><strong>Price G/L vs Total G/L by Ticker</strong> — Horizontal grouped bar chart comparing
          each ticker's price-only and Tracker Total Return side by side over the shared period.</li>
        <li><strong>Winners vs Losers</strong> — Vertical bar chart ranking every ticker by Total G/L.
          Green bars are winners, red bars are losers. Sorted from highest to lowest so your best
          and worst performers are immediately visible.</li>
        <li><strong>Realized Gains Timeline</strong> — Appears only if you have sold positions. Shows
          only sales whose sell date is inside the selected performance range.</li>
      </ul>
      <p style={{ marginBottom: '1rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        Chart returns and labels are rounded to two decimals. A 500% or larger move also produces a
        percentage-outlier warning with the period dollars and lifetime G/L. This is especially important
        for failed or sub-cent securities: a quote moving from $0.00001 to $0.00010 is +900% for that
        short window even though the investment may still be down about 99% from its cost basis.
      </p>

      {/* ── How to Use ──────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Check the summary cards first</strong> — Compare Price G/L to Total G/L in each
          the selected-period Tracker Total Return cards with the separately labeled lifetime G/L cards.
        </li>
        <li>
          <strong>Use the Combined tab</strong> to see each ticker's full history across both open
          and closed positions. Net Total G/L is a lifetime accounting figure, not a period return.
        </li>
        <li>
          <strong>Sort the Unrealized table by Total G/L %</strong> to find your best and worst
          lifetime cost-basis positions, or by Tracker TR % for the selected-period comparison.
        </li>
        <li>
          <strong>Compare the two bar chart series</strong> — the gap between a ticker&apos;s Price Return
          and Tracker Total Return bars is the selected-period contribution from distributions.
        </li>
        <li>
          <strong>Record sales via transactions</strong> in the Holdings page to populate the
          Realized tab. Without SELL transactions recorded, the Realized section will show $0.
        </li>
        <li>
          <strong>Use category filters</strong> to compare gains/losses across different segments
          of your portfolio (e.g., equity ETFs vs. income ETFs).
        </li>
      </ol>

      {/* ── Key Concepts ────────────────────────────────────────── */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Key Concepts</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Price G/L vs Total G/L</strong> — Price G/L is capital appreciation only. Total G/L
          adds dividends received. For income-focused portfolios, the difference can be dramatic — a
          position down 10% on price might be up 15% on total return after years of dividends.</li>
        <li><strong>Unrealized vs Realized</strong> — Unrealized is paper profit/loss on positions
          you still hold. Realized is locked-in profit/loss from positions you have sold. Combined
          gives you the full picture.</li>
        <li><strong>Owner profile</strong> — When viewing the Owner profile, realized gains include
          SELL transactions from all sub-profiles (individual accounts), giving you the consolidated view.</li>
      </ul>
    </div>
  )
}

function SafeWithdrawalHelp() {
  return (
    <div>
      <h2>Safe Withdrawal Amount</h2>
      <p style={{ marginBottom: '1rem' }}>
        This page compares your current estimated monthly dividend income to a configurable percent-of-cost withdrawal rule
        (default 8%). It is a quick planning view, not a Monte Carlo retirement model.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/safe-withdrawal/Screenshot 2026-05-09 101918.jpg" alt="Safe Withdrawal Rate calculator" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>What It Shows</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>N% of Cost / Week, Month, Year</strong> — withdrawal amounts at the selected percent of original cost basis.</li>
        <li><strong>Est Monthly Dividends</strong> — current estimated monthly income from the selected holdings.</li>
        <li><strong>Break-even % (Portfolio YoC)</strong> — aggregate yield on cost for the selected holdings. Any withdrawal rate above this eats into principal. The card turns <span style={{ color: 'var(--p-4ade80)' }}>green</span> when your selected percent is below break-even and <span style={{ color: 'var(--neg)' }}>red</span> when it exceeds it.</li>
        <li><strong>Yield on Cost / Current Yield</strong> — side-by-side context for each holding.</li>
        <li><strong>Sustainable flag</strong> — highlights holdings where current income meets or exceeds the selected percent-of-cost target.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filters and Table</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Percent of Cost dropdown</strong> — pick any rate from 1% to 30% (default 8%). All column labels, row amounts, totals, and the break-even comparison recalculate live.</li>
        <li><strong>Category filter</strong> — focus the view on one or more categories. Break-even % reflects only the filtered holdings.</li>
        <li><strong>Holdings table</strong> — shows each ticker's cost basis, estimated monthly dividends, yield on cost, current yield, sustainability status, and the percent-of-cost comparison.</li>
        <li><strong>Totals row</strong> — rolls up the selected holdings so you can compare your portfolio-level income vs. the chosen benchmark.</li>
      </ul>
    </div>
  )
}

function GeneralScannerHelp() {
  return (
    <div>
      <h2>General Scanner</h2>
      <p style={{ marginBottom: '1rem' }}>
        The General Scanner is a Finviz-style screener for stocks and ETFs. It lets you work from a saved universe,
        pull in one-off tickers without saving them, switch between descriptive, fundamental, technical, and ETF views,
        and then filter or sort the cached data server-side.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/general-scanner/Screenshot 2026-05-09 125140.jpg" alt="General Scanner interface" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Saved Universe vs Ad Hoc Pulls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Saved Universe</strong> — this is your persistent scanner list. Refresh Data and Force Refresh work against this saved universe.</li>
        <li><strong>Pull Stocks or ETFs Without Saving Them</strong> — use this box to type tickers such as <code>AAPL MSFT QQQ SPYI</code> and screen them temporarily without adding them to the saved universe.</li>
        <li><strong>Pull Now</strong> fetches scanner data for just the tickers you entered and shows that temporary subset.</li>
        <li><strong>Back to Saved Universe</strong> returns the page to your normal saved scanner universe.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Views</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Descriptive</strong> — basic company or ETF identity fields such as ticker, company, sector, industry, country, market cap, price, and volume.</li>
        <li><strong>Fundamental</strong> — valuation and quality fields such as P/E, forward P/E, PEG, dividend yield, margin, ROE, debt/equity, and beta.</li>
        <li><strong>Technical</strong> — price, change, moving averages, RSI, MACD, stochastic, 52-week levels, and volume.</li>
        <li><strong>ETF</strong> — ETF-specific fields such as strategy, cap size, category, expense ratio, AUM, and dividend yield.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Refresh Buttons</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Refresh Data</strong> updates scanner prices and cached fields for the saved universe using the existing cache where possible.</li>
        <li><strong>Force Refresh</strong> re-fetches ticker info from Yahoo Finance and is the best choice after adding a lot of new tickers or when classifications look stale.</li>
        <li>If you were on a temporary ad hoc pull, refresh switches you back to the saved universe so you do not stay stuck on a tiny temporary subset.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Filters and Signals</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Signal</strong> presets include Top Gainers, Top Losers, New High, New Low, Most Active, Unusual Volume, Overbought, Oversold, and several SMA-based setups.</li>
        <li><strong>Active filter chips</strong> appear above the results table and can be removed one at a time.</li>
        <li><strong>Market Cap</strong> is mainly meaningful for stocks. In ETF context, the scanner ignores the stock market-cap range filter so ETF screens are not accidentally narrowed by stock-only sizing rules.</li>
        <li><strong>ETF Strategy</strong> lets you screen option-income, bonds, preferred, BDC, CEF, and other ETF groups from the ETF classification data in cache.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Universe Management</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Universe</strong> opens the saved ticker list so you can add or remove names manually.</li>
        <li><strong>Reset to Defaults</strong> replaces your current saved scanner universe with the built-in default stock and ETF list and clears cached scanner data. The app now requires typed confirmation before it runs.</li>
        <li><strong>Save as Defaults</strong> writes the current universe to the local defaults file so that universe can be reused later.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Tips</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li>If a screen looks unexpectedly small, check the active filter chips first. A leftover Type, ETF Strategy, Signal, or Market Cap filter is usually the reason.</li>
        <li>For large updates to the universe, use <strong>Force Refresh</strong> after adding the new names.</li>
        <li>The results table header is fixed while you scroll so you can keep column labels visible on long result sets.</li>
      </ul>
    </div>
  )
}

function SecurityResearchHelp() {
  return (
    <div>
      <h2>Security Research</h2>
      <p style={{ marginBottom: '1rem' }}>
        Security Research is a quick lookup screen for checking an ETF or stock before adding it to a portfolio.
        It combines identity, dividend, holdings, allocation, valuation, and one-year return context in one place.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/security-research/Screenshot 2026-05-09 103658.jpg" alt="Security Research page" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Lookup Modes</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>ETF</strong> - enter an ETF ticker to review the fund name, objective, issuer, category, legal type, expense ratio, assets, NAV, inception date, yield data, top holdings, and allocation breakdown.</li>
        <li><strong>Stock</strong> - enter a stock ticker to review business description, sector and industry, valuation metrics, fundamentals, dividend data, and payout context.</li>
        <li><strong>Lookup</strong> - fetches the selected ticker using the current ETF or Stock mode. Pressing Enter in the ticker box also runs the lookup.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>ETF Research Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Name &amp; Description</strong> summarizes the fund objective or description.</li>
        <li><strong>Metric grid</strong> shows issuer, category, legal type, expense ratio, total assets, NAV, inception date, <strong>Distribution Frequency</strong> (Daily, Weekly, Monthly, Quarterly, Semiannual, or Annual), estimated yield, SEC yield, <strong>1Y Ret vs Yield</strong>, TTM dividend per share, and source link when available.</li>
        <li><strong>Top Holdings</strong> lists the largest reported positions with weights.</li>
        <li><strong>Allocation</strong> displays sector or asset-class weights as horizontal bars.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Stock Research Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Business Description</strong> gives a plain-language company summary.</li>
        <li><strong>Valuation</strong> includes price, market cap, enterprise value, beta, trailing and forward P/E, price/book, and price/sales.</li>
        <li><strong>Fundamentals</strong> includes revenue, revenue growth, margins, net income, free cash flow, and debt/equity.</li>
        <li><strong>Dividends</strong> includes distribution frequency (Daily, Weekly, Monthly, Quarterly, Semiannual, or Annual), rate, yield, <strong>1Y Ret vs Yield</strong>, payout ratio, TTM dividend per share, and last dividend when available.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>1Y Return vs. Yield</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>1Y Ret vs Yield</strong> field appears in the ETF metric grid (next to the yield fields) and in the Stock dividends section.
        It compares the ticker's trailing one-year total return to its current dividend yield to give a quick signal on whether the return justifies the income:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Good</strong> (green) — the 1-year total return exceeds the current yield. Price appreciation is adding return on top of the income the fund pays.</li>
        <li><strong>Poor</strong> (red) — the current yield is higher than the 1-year total return. The position is paying income, but price decline over the past year has offset more than the dividend provided.</li>
        <li><strong>—</strong> — shown when 1-year return data has not yet loaded or the ticker pays no dividend.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem', color: 'var(--text-dim-2)', fontSize: '0.9rem' }}>
        The 1-year return data is fetched from the same source as the Annual Chart (Yahoo Finance total return). The value populates a few seconds after the research result loads. No toggle is available here because there is no portfolio cost basis — only current market yield is used.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Annual Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Click <strong>Open Annual Chart</strong> from any research result to show a one-year chart comparing price return and total return.
        The chart scrolls into view below the research cards and helps you see whether dividends materially changed the one-year outcome.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Average Return Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the annual chart, an <strong>Average Return</strong> bar chart shows average annualized returns over standard multi-year windows
        (1Y, 3Y, 5Y, 10Y, and since inception where available), comparing the ticker against its selected benchmark.
        The benchmark defaults to SPY and can be changed in the benchmark field above the research result.
        This helps you quickly assess whether the ticker has outperformed its reference index over multiple time horizons.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Distribution History Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the average return chart, a <strong>Distribution History</strong> bar chart shows recent dividend
        or distribution payments for the looked-up ticker. The chart toolbar repeats the
        <strong>Distribution Frequency</strong> (Daily, Weekly, Monthly, Quarterly, and so on) next to estimated yield.
        When the chart is in <strong>Yield %</strong> mode,
        an <strong>Annual / Monthly</strong> toggle appears. <em>Monthly</em> shows the per-period yield
        (distribution ÷ price × 100). <em>Annual</em> uses the latest completed distribution cycle—such as
        four payments for a quarterly fund or twelve months for a monthly fund—so one unusually high or low
        payment does not distort the annual yield. Switching back to <strong>$ Amount</strong> resets to Monthly.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>When to Use It</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li>Use Security Research for a fast first pass on a single ticker.</li>
        <li>Use ETF Comparer or Stock Comparer when you need to compare multiple tickers side-by-side with a full return history chart and comparison table.</li>
        <li>Use Stock and ETF Analysis when you need a deeper technical chart with indicators, drawing tools, or return simulations.</li>
        <li>Use General Scanner when you want to compare many tickers at once with filters and sortable columns.</li>
      </ul>
    </div>
  )
}

function ETFScreenHelp() {
  return (
    <div>
      <h2>Stock and ETF Analysis</h2>
      <p style={{ marginBottom: '1rem' }}>
        The ETF/Stock Analysis page is an advanced technical analysis and returns-simulation tool.
        You can chart any ticker with professional indicators, draw trendlines, and overlay comparison
        tickers — then switch to a Returns tab to simulate the impact of dividend reinvestment (DRIP)
        at any percentage over any time period. A third <strong>Markov</strong> tab adds a regime model
        that labels each bar Bull / Bear / Sideways and estimates what tends to happen next.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/etf-screen/etf-analysis-overview.png" alt="Stock and ETF Analysis showing the Technical, Returns, and Markov tabs with a candlestick chart and StochasticMACD study" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Loading a Ticker</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Type a ticker symbol in the input field and click <strong>Load</strong> (or press Enter).</li>
        <li>Select a <strong>time period</strong>: 1D, 5D, 1W, 1M, 3M, 6M, YTD, 1Y, or 5Y.</li>
        <li>The main chart loads with price data, the 50- and 200-period simple moving averages, and volume bars below it.</li>
      </ol>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Chart Controls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Chart Type</strong> — Toggle between Line and Candlestick.</li>
        <li><strong>Scale</strong> — Linear, Logarithmic, or Percentage. Use Log for long-term charts; Percentage to normalize from a 100-base.</li>
        <li><strong>Y-Axis Expansion</strong> — Top/bottom margin inputs to add breathing room around price action.</li>
        <li><strong>X-Axis Expansion</strong> — Horizontal padding to see more whitespace on either side.</li>
        <li><strong>Volume</strong> — Toggle volume bars on or off.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Technical Indicators</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Click any indicator name in the sidebar to add it to the chart. Most indicators appear as
        a subplot panel below the price chart. Click an indicator's header to expand its parameter settings.
        Available indicators include:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Overlays</strong> — SMA 50 and SMA 200 are drawn on the price pane by default. Add more Simple Moving Averages or Bollinger Bands from the studies list; they also plot on the price chart itself.</li>
        <li><strong>Momentum</strong> — RSI (Relative Strength Index), MACD (Moving Average Convergence Divergence), Stochastic, CCI (Commodity Channel Index), Momentum.</li>
        <li><strong>Volatility</strong> — ATR (Average True Range), Awesome Oscillator.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>Remove any indicator by clicking its × or toggling it off in the sidebar.</p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Drawing Tools</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Select a drawing mode from the toolbar to annotate the chart:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Trendline</strong> — Click two points to draw a diagonal line.</li>
        <li><strong>Horizontal Line</strong> — Click once to draw a full-width horizontal level.</li>
        <li><strong>Rectangle</strong> — Click and drag to highlight a price/time zone.</li>
        <li><strong>Path</strong> — Free-draw multiple connected segments.</li>
        <li><strong>Fibonacci Retracement</strong> — Click two points to auto-draw Fib levels.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Customize each drawing's color and line style (solid, dash, dot) before drawing.
        Click an existing drawing to select and delete it.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Comparison Tickers</h3>
      <p style={{ marginBottom: '1rem' }}>
        Add comparison tickers to overlay multiple securities on the same chart. Each additional
        ticker gets a unique colored line and appears as a chip below the input. Remove a comparison
        ticker by clicking the × on its chip.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Returns Tab</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Switch to the <strong>Returns</strong> tab to analyze historical performance including dividends.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Return Mode</strong> — Toggle between Total Return (price + DRIP), Price Only (relative, indexed to the period start), Actual Price (the real dollar share price), Price + Divs, Both, All Three, or All Four.</li>
        <li><strong>Reinvestment Slider</strong> — Set 0–100% of dividends to reinvest. 0% = take all distributions as cash; 100% = reinvest everything. The slider updates results instantly.</li>
        <li><strong>Return Summary Strip</strong> — Shows the period, total return %, price return %, dividend contribution %, annualized return, and max drawdown for the loaded ticker.</li>
        <li><strong>Comparison Statistics</strong> — If comparison tickers are added, a sidebar shows the same metrics for each one side-by-side.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Markov Tab</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>Markov</strong> tab uses the same chart as Technical — candlesticks, volume, studies,
        and drawing tools all work identically — and shades it by <strong>market regime</strong>. Each bar
        is labeled <span style={{ color: 'var(--pos)' }}>Bull</span>, <span style={{ color: 'var(--neg)' }}>Bear</span>,
        or Sideways, then a Markov chain estimates how regimes tend to follow one another. Enter a ticker
        and click <strong>Load</strong> (there is no portfolio dropdown on this tab — it is ticker-driven).
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/etf-screen/markov-tab.png" alt="Markov tab showing the regime badge, next-bar forecast, trend stickiness, threshold controls, and regime-shaded candlestick chart for MSFT" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Reading the Panel</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Regime badge</strong> — The current regime (Bull / Bear / Sideways) as of the most recent bar.</li>
        <li><strong>Smoothed next-bar estimate</strong> — Given today's regime, the estimated probability that the next bar is Bull, Sideways, or Bear. The displayed <strong>n</strong> is the number of observed transitions behind that row; small n means low confidence. This is a base-rate tendency, <em>not</em> a price prediction.</li>
        <li><strong>Estimated stickiness</strong> — How likely the current regime label is to persist (High ≥ 80%, Moderate ≥ 60%, otherwise Low/choppy). Because consecutive lookback windows overlap, high persistence is partly mechanical and does not mean the next price will be flat.</li>
        <li><strong>Current log move</strong> — Shows the exact lookback return being compared with the threshold. If it is near the boundary, small lookback or threshold changes can legitimately flip the current classification and switch which matrix row is displayed.</li>
        <li><strong>Regime shading</strong> — The chart background behind the candles is tinted by regime (green Bull, rose Bear, faint grey Sideways) so you can see how regimes line up with price.</li>
      </ul>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>How the Labeling Works</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Before the model can estimate probabilities it must first label every bar. For each bar on the chart the
        model asks one question: <em>"What is the log-return over the past N bars?"</em> The
        answer to that one question determines the regime label for that bar. The two controls — Lookback and
        Move Threshold — together define what N is and what "enough of a move" means.
      </p>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Move Threshold (%)</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The move threshold is the <strong>minimum log-return percentage that counts as a real directional move</strong>.
        Think of it as the signal filter sitting between raw price data and the model. Here is the exact rule applied
        to every bar:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Price rose more than <em>+threshold%</em> over the lookback window → bar is labeled <span style={{ color: 'var(--pos)' }}><strong>Bull</strong></span></li>
        <li>Price fell more than <em>−threshold%</em> over the lookback window → bar is labeled <span style={{ color: 'var(--neg)' }}><strong>Bear</strong></span></li>
        <li>Price moved <em>less than ±threshold%</em> in either direction → bar is labeled <strong>Sideways</strong></li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        The threshold does not affect the chart directly — it affects how the data going <em>into</em> the model is
        classified, which in turn changes every probability the model produces.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The classification is intentionally a hard boundary. For example, +4.9% is Sideways at a 5% threshold,
        while +5.1% is Bull. Changing the lookback also changes the historical comparison price, so the current
        move does not have to rise smoothly as the lookback increases. Use the current log-move readout to see
        when the model is close to this boundary.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Raise the threshold</strong> → the bar for "meaningful move" is set higher. More bars land inside
          the ±threshold band and are called Sideways. Fewer bars qualify as Bull or Bear. The model becomes more
          conservative — it takes a larger, clearer trend to call a regime directional. The transition probabilities
          become smoother and less reactive because the model has seen fewer regime changes to learn from.
        </li>
        <li>
          <strong>Lower the threshold</strong> → the bar is set lower. Smaller moves count as Bull or Bear. Almost
          every bar has <em>some</em> directional tilt, so Sideways becomes rare and the regime flips more often.
          The model becomes more sensitive to short-term price wiggles and the forecast can appear choppy or
          unreliable if the threshold is too small.
        </li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Practical test:</strong> after loading a ticker, open the <strong>Advanced</strong> panel and check
        how often each regime appears (the long-run base rate). A well-calibrated threshold produces a <em>mix</em>
        of all three regimes. If the base rate shows 80%+ Sideways, the threshold is too high — lower it. If
        Sideways is near zero and the regime badge flips every few bars, the threshold is too low — raise it.
      </p>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Lookback (bars)</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The lookback sets <strong>how far back the model measures the price move</strong> for each bar. A lookback
        of 20 means: "Compare today's close to the close 20 bars ago." On a daily chart, 20 bars is approximately
        one calendar month; 50 bars is approximately one quarter.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Short lookback (e.g., 10 bars)</strong> → the model measures short-term momentum. It reacts
          quickly — a single strong week can flip the regime. Labels are noisier and regime changes are more
          frequent. Useful for more active, shorter-horizon analysis.
        </li>
        <li>
          <strong>Long lookback (e.g., 50 bars)</strong> → the model measures medium-term trend. It reacts
          slowly — a small dip inside a broader uptrend does not flip the regime. Labels are smoother and
          stickier. Useful for understanding the macro trend behind day-to-day noise.
        </li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        On weekly charts the same numbers apply, but each "bar" is a week, so a 20-bar lookback covers about
        five months rather than one month. When you switch between daily and weekly, consider rescaling the
        lookback accordingly.
      </p>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>How Lookback and Threshold Work Together</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        This is the most important thing to understand: <strong>lookback and threshold are not independent
        knobs — they must be matched to each other</strong>. The reason is straightforward: a longer lookback
        naturally accumulates a larger price move. Over 50 days SPY might move 10–12%; over 10 days it might
        only move 2–3%. If you use a long lookback with a small threshold, nearly every 50-day window will
        exceed the threshold and the model sees almost no Sideways. If you use a short lookback with a large
        threshold, almost every 10-day window is too small to exceed it and everything becomes Sideways.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        A simple way to think about it: <em>the threshold should be set to roughly the "normal" expected move
        for that asset over that lookback period</em>. Moves larger than normal are directional (Bull/Bear);
        moves smaller than normal are noise (Sideways). Because "normal expected move" grows with the lookback,
        the threshold should grow with it too.
      </p>

      <p style={{ marginBottom: '0.5rem' }}><strong>Example — SPY on a daily chart:</strong></p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Lookback 20 / Threshold 5%</strong> — over one month, SPY moving more than ±5% is a meaningful
          directional month. Months that drift sideways stay inside the band. This produces a healthy mix of Bull,
          Bear, and Sideways labels. <em>(Default — good starting point for SPY/QQQ.)</em>
        </li>
        <li>
          <strong>Lookback 20 / Threshold 2%</strong> (threshold too low) — almost every month moves more than
          ±2% in some direction, so nearly every bar becomes Bull or Bear. Sideways nearly disappears. The regime
          flips constantly and the forecast is noisy.
        </li>
        <li>
          <strong>Lookback 50 / Threshold 5%</strong> (threshold too low for the longer window) — over a full
          quarter, SPY almost always moves more than ±5% in one direction. Again, Sideways nearly disappears.
          Raise the threshold to 8% and the distribution becomes balanced again.
        </li>
        <li>
          <strong>Lookback 10 / Threshold 8%</strong> (threshold too high for the shorter window) — SPY rarely
          moves 8% in just 10 days, so nearly every bar is Sideways. The model has nothing to distinguish.
          Drop the threshold to 3% and it works well again.
        </li>
      </ul>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Recommended Starting Points</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The three built-in presets (10 / 3%, 20 / 5%, 50 / 8%) are designed so the threshold scales with the
        lookback. They are good starting points for most broad market ETFs and large-cap stocks. For more
        volatile assets, shift both numbers up together:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Broad ETFs / indices</strong> (SPY, QQQ, DIA) — use presets as-is (20 / 5% is the default)</li>
        <li><strong>Large-cap individual stocks</strong> — 20 / 6–8% or 50 / 10%</li>
        <li><strong>Sector ETFs / mid-cap stocks</strong> — 20 / 8% or 50 / 12%</li>
        <li><strong>High-volatility stocks / small-cap / commodities</strong> — 20 / 10–15% or 50 / 15–20%</li>
        <li><strong>Low-volatility income funds</strong> (CEFs, covered-call ETFs) — 20 / 3% or 10 / 2%</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Always verify against the output: after loading, open <strong>Advanced</strong> and check that the
        long-run base rate shows a reasonable split across all three regimes. If one regime dominates above
        ~70%, adjust the threshold (down if too much Sideways, up if too little) until the distribution looks
        balanced for that asset.
      </p>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Advanced Details</h4>
      <p style={{ marginBottom: '1rem' }}>
        Click <strong>Advanced</strong> to reveal the full 3×3 <strong>smoothed transition matrix</strong>
        (rows = today's regime, columns = next bar; each row sums to 100% and the diagonal is persistence) and the
        <strong> long-run base rate</strong> — the share of time price spends in each regime over the long run if
        these odds hold. Each row shows its observed transition count (n). A small Jeffreys prior adds 0.5 to
        each possible outcome so rows with little history do not jump to misleading 0% or 100% estimates; n=0
        is prior-only. The base rate is solved from the smoothed matrix and is a backdrop for comparison, not a forecast.
      </p>
    </div>
  )
}

function WatchlistHelp() {
  return (
    <div>
      <h2>Watchlist</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Watchlist is a curated monitor of tickers you're researching or considering buying.
        For each ticker it runs a full suite of technical and risk signals automatically —
        so you can see at a glance whether conditions favor buying, selling, or waiting.
        It also shows benchmark-adjusted NAV erosion context for eligible income funds,
        making it especially useful for evaluating high-yield strategies before adding them to your portfolio.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/watchlist/Screenshot 2026-05-09 102831.jpg" alt="Watchlist with price and dividend data" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Adding Tickers</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Type a ticker symbol in the input field (auto-converts to uppercase).</li>
        <li>Optionally type a note explaining why you're watching it (e.g., "considering for income sleeve").</li>
        <li>Press <strong>Enter</strong> or click <strong>+Add</strong>. The app fetches market data and signals.</li>
        <li>To remove a ticker, click the <strong>Remove</strong> button on its row.</li>
      </ol>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Signal Count Badges</h3>
      <p style={{ marginBottom: '1rem' }}>
        At the top of the table, summary badges show how many tickers have a BUY, SELL, or NEUTRAL
        overall signal — a quick pulse check on your watchlist as a whole.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Locked columns</h3>
      <p style={{ marginBottom: '1rem' }}>
        Use <strong>Lock columns</strong> above the table to keep leading columns on screen while you
        scroll sideways. Full-page Watchlist defaults to Ticker through AUM. In Split View it defaults
        to <strong>Ticker</strong> only, so the frozen block fits the narrower pane. You can lock
        through Signal, or turn locking off.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Table Columns</h3>
      <p style={{ marginBottom: '0.5rem' }}>Click any column header to sort. All 18 columns:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — Symbol.</li>
        <li><strong>Price</strong> — Current market price.</li>
        <li><strong>1D Chg</strong> — Today's price change percentage. Green if up, red if down.</li>
        <li><strong>Div Yield</strong> — Annual dividend yield.</li>
        <li><strong>Signal</strong> — Overall verdict (BUY/SELL/NEUTRAL) — majority vote across all indicators below.</li>
        <li><strong>AO</strong> — Awesome Oscillator signal (BUY/SELL/NEUTRAL). Measures momentum using the difference of 5-period and 34-period midpoint averages.</li>
        <li><strong>RSI</strong> — Relative Strength Index signal with the raw value. Above 70 = overbought (SELL); below 30 = oversold (BUY).</li>
        <li><strong>MACD</strong> — Moving Average Convergence Divergence signal. Bullish when the MACD line crosses above its signal line.</li>
        <li><strong>SMA 50</strong> — Signal based on whether price is above (BUY) or below (SELL) the 50-day moving average, plus the % distance from price.</li>
        <li><strong>SMA 200</strong> — Same for the 200-day moving average. Being above is the classic "golden cross" bullish condition.</li>
        <li><strong>Sharpe</strong> — Risk-adjusted return. Above 1.5 = great, above 1.0 = good, below 0.5 = poor.</li>
        <li><strong>Sortino</strong> — Like Sharpe but only penalizes downside volatility. Above 2.0 = great, above 1.5 = good.</li>
        <li><strong>1Y Return</strong> — Total 12-month return percentage.</li>
        <li><strong>NAV Ratio</strong> — fund price decline divided by TTM distribution yield, only when the benchmark is flat or up. Lagging a rising benchmark is not treated as structural NAV erosion.</li>
        <li><strong>NAV Signal</strong> — BUY/NEUTRAL/SELL from the ratio, with SELL/High forced when price declines 50%+ or the ending share deficit is 5%+.</li>
        <li><strong>NAV Erosion</strong> — Probability label: <span style={{ color: 'var(--p-81c784)' }}>Low</span>, <span style={{ color: 'var(--amber)' }}>Medium</span>, or <span style={{ color: 'var(--p-ef9a9a)' }}>High</span>. Indicates whether the income wrapper appears to be losing price/NAV faster than its distribution stream justifies.</li>
        <li><strong>Notes</strong> — Your custom notes for this ticker.</li>
        <li><strong>Actions</strong> — Remove button.</li>
      </ul>
    </div>
  )
}

function BuySellHelp() {
  return (
    <div>
      <h2>Buy / Sell Signals</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Buy/Sell Signals page is a dashboard that aggregates technical and risk signals for
        all your portfolio holdings and watchlist tickers in one place. It shows an overall
        signal verdict for each position and breaks it down by individual indicator, so you can
        quickly spot which holdings are flashing warning signs and which ones look strong.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/buy-sell-signals/Screenshot 2026-05-09 103926.jpg" alt="Buy/Sell Signals dashboard" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Signal Summary Badges</h3>
      <p style={{ marginBottom: '1rem' }}>
        At the top, four badges show total counts: BUY, SELL, NEUTRAL, and TOTAL tickers analyzed.
        A timestamp shows when the data was last refreshed. Click <strong>Refresh</strong> to re-fetch
        the latest prices and recalculate all signals.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Treemap</h3>
      <p style={{ marginBottom: '1rem' }}>
        A color-coded treemap visualizes all holdings simultaneously. Each rectangle's size represents
        the position's dollar value in your portfolio — larger rectangles are bigger positions.
        Color indicates the overall signal: green for BUY, red for SELL, orange for NEUTRAL.
        This gives an instant visual sense of whether most of your portfolio value is in bullish or
        bearish territory. Hover over any rectangle to see the ticker and signal details.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Signal Detail Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A scrollable table below the treemap lists every ticker with all 18 signal columns.
        Click any column header to sort. All columns:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — Symbol.</li>
        <li><strong>Name</strong> — Fund or company name (truncated).</li>
        <li><strong>Type</strong> — Asset type (ETF, Stock, etc.).</li>
        <li><strong>Source</strong> — Colored badge: Portfolio, Sectors, or Watchlist.</li>
        <li><strong>Overall</strong> — Majority-vote signal across all indicators.</li>
        <li><strong>AO</strong> — Awesome Oscillator signal.</li>
        <li><strong>AO Value</strong> — Raw numeric AO value.</li>
        <li><strong>AO Dir</strong> — Direction: Rising ↑, Falling ↓, or Flat →.</li>
        <li><strong>RSI</strong> — RSI signal with numeric value.</li>
        <li><strong>MACD</strong> — MACD signal.</li>
        <li><strong>SMA 50</strong> — 50-day SMA signal with % distance from price.</li>
        <li><strong>SMA 200</strong> — 200-day SMA signal with % distance from price.</li>
        <li><strong>Sharpe</strong> — Risk-adjusted return ratio.</li>
        <li><strong>Sortino</strong> — Downside-risk-adjusted return.</li>
        <li><strong>NAV Ratio</strong> — Benchmark-adjusted NAV erosion ratio. Lower is better; blank means the holding was not an eligible NAV test candidate or lacked enough data.</li>
        <li><strong>NAV Signal</strong> — BUY/NEUTRAL/SELL from NAV severity. High severity is forced by ratio above 0.75, price decline of 50%+, or ending share deficit of 5%+.</li>
        <li><strong>NAV Erosion</strong> — Low/Medium/High probability using the same expanded severity rule.</li>
        <li><strong>Portfolio $</strong> — Market value of this position (blank for watchlist tickers).</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Scan the treemap</strong> for a quick visual — are most large positions green or red?</li>
        <li><strong>Check summary badges</strong> to see the overall signal balance across your portfolio.</li>
        <li><strong>Sort the table by "Overall"</strong> to group all SELL signals together and review them.</li>
        <li><strong>Sort by "NAV Erosion"</strong> to surface high-risk income funds that may be eroding your capital.</li>
        <li><strong>Sort by "NAV Ratio"</strong> to see which funds are underperforming their benchmark after accounting for distributions.</li>
        <li><strong>Cross-reference with Portfolio $</strong> — a SELL signal on a large position is more urgent than on a small one.</li>
        <li>Click <strong>Refresh</strong> regularly (or after market close) to update signals with the latest data.</li>
      </ol>
    </div>
  )
}

function NavErosionHelp() {
  return (
    <div>
      <h2>NAV Erosion (Single Ticker)</h2>
      <p style={{ marginBottom: '1rem' }}>
        The NAV Erosion page is a price-erosion backtester for a single high-yield ETF or fund. It simulates
        month-by-month what would have happened to your investment over a historical period,
        accounting for share price changes, distributions, and your chosen reinvestment level.
        It uses market closing prices as a NAV proxy rather than issuer-published NAV and asks:
        <em> Does the fund lose price when its underlying benchmark is flat or rising?</em>
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/nav-erosion/Screenshot 2026-05-09 110511.jpg" alt="NAV Erosion analysis" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>What is NAV Erosion?</h3>
      <p style={{ marginBottom: '1rem' }}>
        Confirmed erosion is a month in which the fund price declines while its underlying benchmark
        is flat or positive. A fund is therefore not penalized merely because its whole market fell.
        The page separately reports investor total return, relative benchmark drag, and the number of
        shares needed to restore the initial capital value. It also measures whether the ETF regains share price
        on benchmark up days; distributions are excluded from that recovery test.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Formula</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The confirmed price-erosion ratio is computed as:
      </p>
      <pre style={{
        background: 'var(--p-1a1a1a)',
        border: '1px solid var(--p-333)',
        borderRadius: '4px',
        padding: '0.75rem 1rem',
        marginBottom: '0.75rem',
        color: 'var(--text)',
        fontSize: '0.95rem',
        whiteSpace: 'pre-wrap',
      }}>{`Monthly confirmed loss/share = Prior Fund Price − Current Fund Price
                               (only when Fund Return < 0 and Benchmark Return ≥ 0)
Monthly ratio = Confirmed loss/share ÷ Distribution/share
Period ratio  = Σ confirmed monthly loss/share ÷ Σ period distributions/share

Where:
  Fund Return      = (Current Fund Price − Prior Fund Price) ÷ Prior Fund Price
  Benchmark Return = (Current Bench Price − Prior Bench Price) ÷ Prior Bench Price
                     (sum of component returns for composite benchmarks)`}</pre>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Benchmark gate.</strong> The benchmark acts as a context filter. Erosion is counted only when:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Fund Return is negative (the fund's price actually fell), <em>and</em></li>
        <li>Benchmark Return is flat or positive (the underlying market was not down).</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        If the fund is up, or if the benchmark itself is down, confirmed erosion for that month is <code>0</code>.
        Relative Drag remains available separately to show how far the fund lagged the benchmark over the full window.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Why divide by distributions.</strong> A ratio of <code>0.50</code> means confirmed price loss
        equaled roughly half the distributions paid during the same selected window; <code>1.00</code> means
        it equaled all period distributions. Thresholds are <strong>≤ 0.25 Low</strong>,
        <strong>0.25–0.75 Moderate</strong>, and <strong>&gt; 0.75 High</strong>.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Inputs</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The ETF or fund to analyze (e.g., JEPI, XYLD, QYLD).</li>
        <li><strong>Initial Investment</strong> — Dollar amount to start with (default $10,000).</li>
        <li><strong>Benchmark</strong> — Leave blank for automatic selection, or enter a priceable override such as <code>HODL</code>.</li>
        <li><strong>Start / End Date</strong> — The historical backtest window.</li>
        <li><strong>Reinvestment %</strong> — Drag the slider or type a number (0–100%). At 0%, all distributions are taken as cash. At 100%, all distributions buy more shares (full DRIP). Use values between to simulate partial reinvestment.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Automatic Benchmark Context</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The price-erosion test is benchmark-adjusted so a fund is not punished just because its whole underlying market is weak.
        The app chooses a best-effort benchmark from known ticker mappings and fund description keywords. Examples:
        Nasdaq income funds generally compare to <code>QQQ</code>, S&amp;P 500 income funds to <code>SPY</code>,
        Russell 2000 funds to <code>IWM</code>, defense funds to <code>ITA</code>, gold funds to <code>GLD</code>,
        silver funds to <code>SLV</code>, and bitcoin funds to <code>BTC-USD</code>.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The selected benchmark and its return are shown in the result cards and as an orange normalized line.
        The calculation stops with an error if benchmark history is unavailable rather than substituting the fund itself.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Statistics</h3>
      <p style={{ marginBottom: '0.75rem' }}>After running the backtest, a strip of metric tiles shows:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Benchmark / Benchmark Return</strong> — The actual comparison series and its full-window price return.</li>
        <li><strong>Raw NAV Erosion (e), Distribution Rate (d), Accounting Total Return (r)</strong> — Same-window, starting-NAV measures satisfying e = d − r. These do not use the benchmark gate. Positive e means the fund is a NAV eroder over the selected window regardless of which benchmark is selected.</li>
        <li><strong>Benchmark-Confirmed Erosion</strong> — Yes only when at least one month meets the fund-down, benchmark-flat/up rule.</li>
        <li><strong>Confirmed Erosion Ratio</strong> — Benchmark-gated monthly losses divided by distributions over the same window. Its Low/Moderate/High grade describes only benchmark-gated coverage and never overrides positive raw e.</li>
        <li><strong>Overall Verdict</strong> — Primary Low/Moderate/High NAV erosion conclusion. Up-market share-price recovery can reduce the raw-loss warning by at most 75%, but cannot reduce benchmark-confirmed coverage or relative drag. It is not a forecast probability. Scores above 75 are High.</li>
        <li><strong>Up-Market Price Recovery</strong> — Fund average share-price return divided by benchmark average price return on benchmark up days. Distributions and total return are excluded. At least 5 up days are required; confidence reaches full weight at 20.</li>
        <li><strong>Relative Drag</strong> — How many percentage points the fund price lagged its benchmark.</li>
        <li><strong>Total Distributions</strong> — All distributions generated over the period.</li>
        <li><strong>Shares Purchased</strong> — Shares bought via DRIP reinvestment.</li>
        <li><strong>Total Reinvested</strong> — Dollar amount reinvested.</li>
        <li><strong>Cash Taken</strong> — Distributions not reinvested.</li>
        <li><strong>Ending Shares Value</strong> — Ending market value of shares only.</li>
        <li><strong>Ending Wealth / Investor Total Return</strong> — Shares value plus cash taken, compared with the initial investment.</li>
        <li><strong>Final Shares Needed / Extra</strong> — Capital-only share gap; it intentionally excludes cash taken and does not override confirmed erosion.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Charts</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Main Line Chart</strong> — Shows fund price (blue), the benchmark normalized to the same starting level (orange dotted), shares value (green), and the initial investment (gray dashed).</li>
        <li><strong>Confirmed Erosion Ratio Chart</strong> — Monthly ratios with green, orange, and red severity markers.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Monthly Detail Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>A sortable month-by-month table includes:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Date</strong> — Month/year.</li>
        <li><strong>Price</strong> — Share price that month.</li>
        <li><strong>Price Δ%</strong> — Monthly price change.</li>
        <li><strong>Benchmark / Bench Δ%</strong> — Underlying benchmark level and monthly return.</li>
        <li><strong>Div/Share</strong> — Distribution paid per share.</li>
        <li><strong>Total Dist</strong> — Total distribution for your holding.</li>
        <li><strong>Reinvested</strong> — Amount reinvested based on slider.</li>
        <li><strong>Shares Bought</strong> — New shares purchased via DRIP.</li>
        <li><strong>Total Shares</strong> — Cumulative shares held.</li>
        <li><strong>Portfolio Value</strong> — Current total value.</li>
        <li><strong>Break-Even Shares</strong> — Shares needed to recover original investment at current price.</li>
        <li><strong>Shares Needed / Extra To Breakeven</strong> — The share gap versus break-even, shown as shares plus percent. <span style={{ color: 'var(--p-ef9a9a)' }}>Red needed = you need that many more shares</span>; <span style={{ color: 'var(--p-81c784)' }}>green extra = you have that many shares above break-even</span>.</li>
        <li><strong>Raw e / Dist d / Total Return r</strong> — Monthly values on the same starting-price basis; e = d − r.</li>
        <li><strong>Confirmed Coverage</strong> — That month&apos;s benchmark-confirmed erosion loss divided by its distribution per share.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Enter a high-yield ticker (QYLD, XYLD, JEPI, SVOL, etc.) and set your investment amount.</li>
        <li>Start with a wide date range (e.g., 2018–present) to capture a full market cycle.</li>
        <li>Run at <strong>0% reinvestment</strong> first to compare ending shares value with ending wealth including cash taken.</li>
        <li>Then run at <strong>100%</strong> — this shows whether full DRIP can overcome price decay.</li>
        <li>Find the reinvestment percentage where Shares Needed falls to zero or becomes Extra — that's the break-even DRIP rate for this fund.</li>
        <li>Check the confirmed ratio chart: red months mean the fund fell while its benchmark was flat or rising.</li>
      </ol>
    </div>
  )
}

function NavScreenerHelp() {
  return (
    <div>
      <h2>NAV Erosion Screener (Portfolio)</h2>
      <p style={{ marginBottom: '1rem' }}>
        The NAV Erosion Screener extends the benchmark-adjusted single-ticker backtester to a full portfolio
        of up to 80 ETFs simultaneously. You set individual investment amounts and reinvestment percentages
        per ticker, run them all over the same date range, and get a side-by-side comparison of benchmark-confirmed
        price erosion, ending wealth, and investor total return. You can save and reload named backtest scenarios
        to compare strategies over time.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/nav-erosion-portfolio/Screenshot 2026-05-09 112656.jpg" alt="NAV Erosion Screener portfolio backtest grid" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Building Your Backtest Grid</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Each row in the grid represents one ETF. Enter the <strong>Ticker</strong>, <strong>Initial Investment $</strong>, and <strong>% of Divs to Reinvest</strong> (0–100).</li>
        <li>Click <strong>+Add ETF</strong> to add more rows (up to 80).</li>
        <li>Click <strong>×</strong> on any row to remove it, or <strong>Clear</strong> to wipe all rows.</li>
        <li>Set the global <strong>Start Date</strong> and <strong>End Date</strong> — all tickers use the same date range.</li>
        <li>Click <strong>Run Backtest</strong> to analyze all rows.</li>
      </ol>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Saving and Loading Backtests</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Save List</strong> — Saves the current ticker grid (tickers, amounts, reinvest %) without the date range. Useful for persisting your standard watchlist.</li>
        <li><strong>Save Backtest…</strong> — Saves the full scenario including date range and grid under a custom name. The save form lets you overwrite an existing backtest or create a new one.</li>
        <li><strong>Saved Backtests dropdown</strong> — Load a previously saved scenario. Click <strong>Load</strong> to restore it, or <strong>Delete</strong> to remove it permanently.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Strip</h3>
      <p style={{ marginBottom: '0.75rem' }}>After running, the summary strip shows portfolio-wide results:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Total Invested, Ending Shares Value, Ending Wealth, Total Gain/Loss, and Portfolio Return %</li>
        <li>Total Distributions, Total Reinvested, and Cash Taken (the portion not reinvested)</li>
        <li>Confirmed Erosion count (e.g., "3 of 8 funds" with at least one qualifying month)</li>
        <li>Ending Price Deficit count — an informational break-even share check, separate from confirmed erosion.</li>
        <li>Portfolio Raw e, Distribution Rate d, and Accounting Return r — amount-weighted same-window values satisfying e = d − r.</li>
        <li>Overall Verdict — recovery-adjusted primary conclusion. Price-only up-market recovery can reduce the raw-loss warning by at most 75%, while confirmed coverage and relative drag remain hard floors; 0–25 Low, above 25–75 Moderate, above 75 High.</li>
        <li>Up-Market Price Recovery — amount-weighted recovery score and capture rate based only on share-price moves during mapped-benchmark up days.</li>
        <li>Portfolio Confirmed Erosion Ratio — total benchmark-confirmed price-loss dollars divided by total distributions over the same window.</li>
        <li>Weighted benchmark return and relative price drag, plus best/worst performer and data errors.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>A sortable results table with a TOTAL footer row:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker, Benchmark, Amount, Reinvest %</strong> — Inputs plus the mapped underlying used for the gate (for example, BTCI → BTC-USD).</li>
        <li><strong>Start Price / End Price</strong> — Share price at beginning and end of period. Reverse splits are normalized into the same share units and are not treated as investment gains.</li>
        <li><strong>Price Δ% / Benchmark Return %</strong> — Fund price change and mapped benchmark return over the selected window.</li>
        <li><strong>Total Distributions / Total Reinvested / Cash Taken</strong> — Distribution cash flow split by reinvestment choice.</li>
        <li><strong>Ending Shares Value / Ending Wealth</strong> — Shares at the end, then shares value plus cash taken.</li>
        <li><strong>Gain/Loss $</strong> and <strong>Gain/Loss %</strong> — Capital-only gain/loss. Green/red colored.</li>
        <li><strong>Total Return $</strong> and <strong>Total Return %</strong> — Including distributions.</li>
        <li><strong>Confirmed Erosion / Months</strong> — Yes only when at least one month has fund price down while the benchmark is flat or up.</li>
        <li><strong>Shares Needed / Extra To Breakeven</strong> — End-of-period capital-only share gap; informational and separate from the benchmark gate.</li>
        <li><strong>Raw e / Dist d / Total Return r</strong> — Same-window accounting identity on the starting share-price basis. Positive e identifies a NAV eroder independently of the benchmark gate.</li>
        <li><strong>Up-Market Price Recovery</strong> — Price capture and recovery score on benchmark up days; distributions and total return are excluded.</li>
        <li><strong>Confirmed Erosion Ratio</strong> — Confirmed price loss per share divided by all distributions per share in the selected window.</li>
        <li><strong>Note</strong> — Any data warnings for that ticker.</li>
      </ul>
    </div>
  )
}

function DripScoreHelp() {
  const screenshotStyle = {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
    border: '1px solid var(--p-333)',
  }

  return (
    <div>
      <h2>DRIP vs. Cash Analyzer</h2>
      <p style={{ marginBottom: '1rem' }}>
        The DRIP vs. Cash Analyzer replays each fund&apos;s actual prices and distributions
        over one common date window. It compares full reinvestment, 50% reinvestment, and
        taking every distribution as cash, then shows which choice produced the better result.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/drip-score/saved-set.png"
          alt="DRIP vs. Cash Analyzer saved set with ticker chips and Edit Tickers button"
          style={screenshotStyle}
        />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
        Saved Sets
      </h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2', marginBottom: '1rem' }}>
        <li>Select a named set from <strong>Saved set</strong>. Its ticker chips, test settings, and latest cached results load together.</li>
        <li>Click <strong>Edit Tickers</strong> to change the set name or ticker membership. The date range and other run settings remain directly editable for quick reruns.</li>
        <li>Click <strong>Save</strong> to update the set, <strong>Save As</strong> to create a copy, or <strong>Cancel</strong> to discard changes made in edit mode.</li>
        <li>Use <strong>Delete</strong> only when you want to remove the entire saved set.</li>
      </ol>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/drip-score/edit-tickers.png"
          alt="DRIP vs. Cash Analyzer edit mode with individual ticker remove buttons"
          style={screenshotStyle}
        />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
        Editing Tickers
      </h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Each ticker appears as a chip. Click its <strong>×</strong> to remove only that ticker.</li>
        <li>You can also type or paste symbols in the ticker editor. Commas, spaces, semicolons, and new lines are accepted; duplicates are removed automatically.</li>
        <li>The counter shows the current number of unique tickers, up to 75.</li>
        <li>The <strong>Run</strong> button stays disabled while a saved set has unsaved edits. Save or cancel first so cached results cannot be confused with a changed list.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
        Running the Comparison
      </h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Start / End</strong> — the common historical window used for every fund.</li>
        <li><strong>Cash rate %</strong> — annual return assumed on distributions that are not reinvested.</li>
        <li><strong>Initial</strong> — the same starting investment applied to each ticker.</li>
        <li><strong>Short history</strong> — include newer funds in a separate table or exclude them entirely.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
        Reading the Results
      </h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Large result tables get their own vertical scrollbar. The column headers stay pinned at the top, and the ticker column stays pinned while scrolling horizontally.</li>
        <li><strong>Full / 50% / No DRIP TR</strong> — total return under each distribution choice.</li>
        <li><strong>Initial Shares</strong> — the initial investment divided by the starting price.</li>
        <li><strong>100% Final Shares</strong> — Initial Shares plus every share purchased by reinvesting distributions.</li>
        <li><strong>50% Final Shares</strong> — Initial Shares plus the shares purchased by reinvesting half of each distribution.</li>
        <li><strong>100% Ending Value</strong> — 100% Final Shares multiplied by the final price. Full DRIP has no separate cash balance.</li>
        <li><strong>50% Ending Value</strong> — 50% Final Shares multiplied by the final price, plus the cash retained from the other half of distributions.</li>
        <li><strong>Initial Share Worth + Cash</strong> — Initial Shares multiplied by the final price, plus all No DRIP cash distributions and modeled cash interest.</li>
        <li><strong>DRIP Score</strong> — Full DRIP total return minus No DRIP total return. Positive means full reinvestment won for the final date.</li>
        <li><strong>Covered Yield</strong> and <strong>Coverage</strong> — compare historical distributions with total return using the same period and annualisation basis. Coverage of 1.00 or more means period total return fully supported the distribution rate. This is a performance proxy, not a tax classification of return of capital.</li>
        <li><strong>Price CAGR</strong> — annualized change in the split-adjusted market price. It is not the fund&apos;s official published NAV.</li>
        <li><strong>RE</strong> — Reinvestment Efficiency: what one dollar of distributions became under DRIP versus holding cash.</li>
        <li><strong>Win Rate</strong> — share of eligible daily closing dates where DRIP beat cash. A conflicted or unstable badge warns that the call depends heavily on timing.</li>
        <li><strong>Opportunity</strong> — ranking score combining price CAGR and covered yield.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
        Result Colors
      </h3>
      <div style={{ marginBottom: '1rem' }}>
        <img
          src="./help-screenshots/drip-score/color-coding.png"
          alt="DRIP vs. Cash Analyzer table with green, yellow, amber, and red result cells"
          style={screenshotStyle}
        />
      </div>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Green</strong> — favorable result.</li>
        <li><strong>Yellow</strong> — borderline result near a decision threshold.</li>
        <li><strong>Amber</strong> — caution; the metric is positive or usable but incomplete or weak.</li>
        <li><strong>Red</strong> — unfavorable result.</li>
        <li>Color grading is applied to <strong>DRIP Score, Coverage, RE, Opportunity, Verdict, and Call</strong>. Exact values and labels remain authoritative.</li>
        <li><strong>Ending-value comparison:</strong> the highest of 100% Ending Value, 50% Ending Value, and Initial Share Worth + Cash is green; the lowest is red; the middle is neutral. Equal values remain neutral.</li>
        <li><strong>DRIP Score:</strong> red at −2% or worse, yellow from above −2% through +2%, and green above +2%.</li>
        <li><strong>Coverage:</strong> red below 0.50, amber from 0.50 to below 1.00, and green at 1.00 or higher.</li>
        <li><strong>RE:</strong> red at 0.98 or lower, yellow between 0.98 and 1.02, and green at 1.02 or higher.</li>
        <li><strong>Opportunity:</strong> red below 50, amber from 50 to below 65, yellow from 65 to below 80, and green at 80 or higher.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
        Verdict Definitions
      </h3>
      <div style={{ marginBottom: '1rem' }}>
        <img
          src="./help-screenshots/drip-score/definitions.png"
          alt="Expanded DRIP vs. Cash Analyzer help showing all verdict definitions"
          style={screenshotStyle}
        />
      </div>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Compounder</strong> — yield is at least 8% and Coverage is at least 1.00. Total return fully supported the distributions.</li>
        <li><strong>Harvester</strong> — yield is at least 8% and Coverage is from 0 to below 1.00. Total return was positive, but price loss consumed part of the distributions. The name describes historical performance; it is not a tax or return-of-capital classification.</li>
        <li><strong>Liquidator</strong> — yield is at least 8% and Coverage is below 0. Total return was negative despite the distributions, indicating capital erosion over the test window.</li>
        <li><strong>Grower</strong> — yield is below 8% and Coverage is at least 1.00. Healthy return coverage, but not a high-income holding.</li>
        <li><strong>Fading</strong> — yield is below 8% and Coverage is from 0 to below 1.00. Low income with only partial return coverage.</li>
        <li><strong>Broken</strong> — yield is below 8% and Coverage is below 0. Negative total return with little income.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
        Call and Badge Definitions
      </h3>
      <div style={{ marginBottom: '1rem' }}>
        <img
          src="./help-screenshots/drip-score/call-definitions.png"
          alt="Expanded DRIP vs. Cash Analyzer help showing DRIP, Take cash, Toss-up, and badge definitions"
          style={screenshotStyle}
        />
      </div>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>DRIP</strong> — RE is 1.02 or higher, so reinvested distributions finished at least 2% ahead of keeping them as cash.</li>
        <li><strong>Take cash</strong> — RE is 0.98 or lower, so keeping distributions as cash finished at least 2% ahead of reinvesting them.</li>
        <li><strong>Toss-up</strong> — RE is between 0.98 and 1.02. The difference is inside the 2% deadband and is too small for a directional call.</li>
        <li><strong>N/A</strong> — there was not enough meaningful distribution data to compare reinvestment with cash.</li>
        <li><strong>Conflicted</strong> — the final-date call disagrees with the majority of eligible exit dates.</li>
        <li><strong>Unstable</strong> — the win rate is near 50%, so the result depends heavily on exit timing.</li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
        Funds with incomplete histories are ranked separately because a partial market window is not
        comparable with funds tested over the full period.
      </div>
    </div>
  )
}

function SingleStrategyHelp() {
  return (
    <div>
      <h2>Single Strategy Scanner</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Single Strategy Scanner runs a focused technical setup across a saved list of tickers.
        It is built for quick repeat scans using the same rules over and over.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/scanner/Screenshot 2026-05-09 125056.jpg" alt="Single Strategy Scanner results" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Ticker List and Saved Settings</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker chips</strong> — add tickers one at a time, then remove them with the × button.</li>
        <li><strong>Saved list</strong> — the page loads and saves your scanner ticker list to the backend, so it is ready next time you open it.</li>
        <li><strong>Saved thresholds</strong> — SMA proximity and stochastic settings are remembered locally.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Scan Rules</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Trend filter</strong> — 50 SMA must be at or above the 175 SMA.</li>
        <li><strong>SMA proximity</strong> — price must be within the selected percentage band around the 175 SMA.</li>
        <li><strong>Stochastic band</strong> — Slow Stochastic %K must fall within your selected range.</li>
        <li><strong>Daily or Weekly</strong> — switching timeframe changes the available lookback periods and reruns the scan after your first manual run.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Sortable table</strong> — shows ticker, signal, close, SMAs, stochastic reading, and distance from the 175 SMA.</li>
        <li><strong>Chart modal</strong> — click a ticker in the results to open a chart with the scanner indicators for the selected timeframe and period.</li>
      </ul>
    </div>
  )
}

function IncomeSimHelp() {
  return (
    <div>
      <h2>Income Simulator</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Income Simulator projects how your portfolio's dividend income will grow over time
        based on DRIP reinvestment, monthly contributions, and market scenarios. It has three modes:
        <strong> Historical</strong> (projects from actual past data), <strong>Simulate</strong>
        (forward-looking with market bias), and a <strong>Comparison</strong> mode that lets you
        put multiple tickers or strategies side by side.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/income-sim/Screenshot 2026-05-09 113052.jpg" alt="Income Simulator projections" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>DRIP Projections Panel</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The left panel controls which holdings are included and how dividends are handled:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Categories Filter</strong> — Multi-select dropdown to include only specific categories.</li>
        <li><strong>Tickers Filter</strong> — Multi-select from your portfolio holdings. Add custom tickers not in your portfolio too.</li>
        <li><strong>Horizon</strong> — Projection length: 1, 2, 3, 5, or 10 years.</li>
        <li><strong>Set All</strong> — Quickly set a single reinvestment % for every holding at once.</li>
        <li><strong>Monthly Contribution</strong> — Add a recurring dollar amount you'll invest each month. Optionally target specific tickers for contribution allocation.</li>
        <li><strong>Distribution Redirects</strong> — Route distributions from one ticker to buy another (e.g., redirect QYLD income into SCHD purchases).</li>
        <li><strong>Save Settings</strong> — Persist your current panel configuration for future sessions.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/income-sim/Screenshot 2026-05-09 113238.jpg" alt="Income Simulator settings and filters panel" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Simulation Modes</h3>

      <h4 style={{ marginBottom: '0.4rem' }}>Historical Mode</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Uses actual historical dividend and price data to project how your holdings would have
        grown over the selected horizon. Set start and end dates, then run. Results show year-by-year
        income growth including the compounding effect of DRIP and monthly contributions.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/income-sim/Screenshot 2026-05-09 113309.jpg" alt="Income Simulator historical projection results" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Simulate Mode</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Projects forward using three market bias scenarios:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Neutral</strong> — Assumes dividends and price stay roughly flat.</li>
        <li><strong>Bullish</strong> — Assumes modest price appreciation and dividend growth.</li>
        <li><strong>Bearish</strong> — Assumes price and income headwinds.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Set the duration using preset buttons (3M, 6M, 1Y, 2Y, 3Y, 5Y) or a custom month count.
        Adjust the reinvestment slider. Click <strong>Run Analysis</strong>.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/income-sim/Screenshot 2026-05-09 113942.jpg" alt="Income Simulator forward projection with market bias" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Comparison Mode</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Toggle <strong>Compare Tickers</strong> to enable side-by-side analysis. Add tickers
        with individual investment amounts and reinvestment percentages. Run to see a multi-line
        chart comparing projected income growth and cumulative value across all tickers.
        Use this to decide between alternative income ETFs or strategies.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/income-sim/Screenshot 2026-05-09 114242.jpg" alt="Income Simulator comparison mode with multiple tickers" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>
      <p style={{ marginBottom: '0.75rem' }}>
        You can also turn on <strong>Compare Reinvestment Impact</strong> to show baseline vs. reinvested
        results for the same holdings. In that mode, the charts and results table split each holding into
        paired rows so you can see exactly what reinvestment changes.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Saved Scenarios</h3>
      <p style={{ marginBottom: '1rem' }}>
        Click <strong>Save Scenario…</strong> to name and store your current simulation setup.
        Load saved scenarios from the dropdown to quickly compare different strategies without
        re-entering all parameters. Rename or delete saved scenarios as needed.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Charts and Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Income Chart</strong> — Bars showing projected income per period, with a cumulative growth line overlay.</li>
        <li><strong>Comparison Charts</strong> — In comparison mode, separate lines per ticker show projected income and cumulative portfolio value.</li>
        <li><strong>Results Table</strong> — Year-by-year or ticker-by-ticker breakdown with columns for Amount, Reinvest %, Price, Distributions, Reinvested, Final Value, Gain/Loss, Annualized Return, and Yield. Hover over any column header for a tooltip explaining what that column measures (e.g., Hist &mu;% = historical mean monthly return, Hist &sigma;% = volatility, Skew = downside tail risk).</li>
        <li><strong>Dividend Chart</strong> — Shows monthly dividend distributions with a trailing-3-month smoothing to eliminate pay-month spikes from quarterly or semi-annual payers.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/income-sim/Screenshot 2026-05-09 114346.jpg" alt="Income Simulator results table and charts" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/income-sim/Screenshot 2026-05-09 115416.jpg" alt="Income projection chart with dividend distributions" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/income-sim/Screenshot 2026-05-09 115453.jpg" alt="Monthly dividend chart with smoothing" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>
    </div>
  )
}

function DiversificationHelp() {
  return (
    <div>
      <h2>Diversification</h2>
      <p style={{ marginBottom: '1rem' }}>
        Funds hide what you actually own. If you hold three S&amp;P 500 funds, the holdings
        screen shows three positions — but economically you own one basket of the same
        500 companies, and your real NVDA exposure is the sum across all three. This page
        opens each fund up and re-adds everything at the constituent level, so concentration
        that is invisible position-by-position becomes obvious.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How the page opens</h3>
      <HelpScreenshot
        src="./help-screenshots/diversification/as-held.png"
        alt="The Diversification page with X-Ray Funds off, showing the donut and ranked bar list of all 51 positions exactly as they are held"
        caption="X-Ray off: one slice per position, the portfolio as your broker shows it."
      />
      <p style={{ marginBottom: '1rem' }}>
        The page opens with <strong>X-Ray Funds</strong> off — your positions as you actually
        hold them, largest first, with the donut and the ranked list always agreeing on a
        slice's colour. Nothing here is looked through yet, so CHPY is simply CHPY.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>The control bar</h3>
      <HelpScreenshot
        src="./help-screenshots/diversification/controls.png"
        alt="The control bar with X-Ray Funds checked, the Economic exposure and Literal holdings buttons, and the Define funds, Resolve gaps, and Refresh all buttons"
        caption="Turning X-Ray on reveals the Synthetic funds switch. The count on Define funds is how many of your funds still have no holdings data."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>X-Ray Funds</strong> — replaces every fund with what is inside it.</li>
        <li><strong>Synthetic funds</strong> — how option-income funds report themselves; see below.</li>
        <li><strong>Define funds (n)</strong> — jumps to Fund Definitions, already filtered to the
          funds nothing could be found for. The number is that count.</li>
        <li><strong>Resolve gaps</strong> — looks up new funds and retries incomplete ones against
          their issuer's latest holdings download.</li>
        <li><strong>Refresh all</strong> — re-fetches everything. Both run in the background and
          report progress on a bar; hand-entered definitions are never overwritten.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>X-Ray Funds</h3>
      <HelpScreenshot
        src="./help-screenshots/diversification/xray-lookthrough.png"
        alt="X-Ray on: the collateral and undisclosed banners above the Look-through holdings card, where 51 positions have become 2,735 constituents led by cash collateral, Gold, and NVDA"
        caption="Same portfolio, looked through: 51 positions become 2,735 constituents, and NVDA arrives as one 3.30% slice instead of hiding inside a dozen funds."
      />
      <p style={{ marginBottom: '1rem' }}>
        Every fund is replaced by what is inside it, with identical constituents merging into a
        single slice no matter how many funds they arrived through. The two banners above the
        chart are the honesty notes — how much is fund collateral rather than exposure, and how
        much no issuer discloses. Both are explained below.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Look-through is recursive. Several income funds are really a wrapper around one
        ETF — TSPY is ~100% VOO, TDAQ ~100% QQQM — so those are expanded again into the
        companies underneath rather than being left as a fund sitting in your chart. A
        nested fund is only expanded when it is itself well covered; a thinly-covered one
        stays put, because expanding it would convert known exposure into Undisclosed.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Economic exposure vs. Literal holdings</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Option-income funds do not hold what they track. KGLD's filed holdings are three
        Treasury bills — it reaches gold through options written against that collateral.
        Read literally, a portfolio full of these funds looks like a giant cash position.
        The top of the same portfolio, in each mode, shows what that costs you:
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ flex: '1 1 340px', minWidth: 300 }}>
          <HelpScreenshot
            src="./help-screenshots/diversification/mode-economic.png"
            alt="Top constituents in Economic exposure mode: cash collateral 9.40%, Gold 3.95%, NVDA 3.30%, Bitcoin 2.41%"
            caption="Economic exposure — Gold and Bitcoin appear as themselves, collateral is 9.40%."
          />
        </div>
        <div style={{ flex: '1 1 340px', minWidth: 300 }}>
          <HelpScreenshot
            src="./help-screenshots/diversification/mode-literal.png"
            alt="The same constituents in Literal holdings mode: cash collateral 16.34%, no Gold or Bitcoin rows, and an Options and derivatives row at 2.36%"
            caption="Literal holdings — the same money reads as 16.34% collateral plus option legs."
          />
        </div>
      </div>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Economic exposure</strong> (default) — KGLD reports as Gold, BTCI as
          Bitcoin when the underlying exposure can be stated accurately.</li>
        <li><strong>Literal holdings</strong> — every fund reports exactly what it files,
          Treasury collateral and option legs included. Useful for seeing how much of the
          portfolio is really sitting in short-term paper.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Funds that genuinely hold their underlying equities (QQQI, SPYI, CHPY) are
        unaffected by this switch — their filed holdings are already correct, which is why
        NVDA, IEFA, AAPL, and MSFT hold the same weight in both pictures.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Cash, equivalents, and fund collateral</h3>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Cash &amp; equivalents</strong> is actual cash-like exposure, including
        money-market funds. <strong>Cash &amp; T-bill collateral</strong> is shown separately:
        it is held inside option or leveraged funds to back derivatives and financing, so it
        is not spendable account cash. Whenever it reaches 0.25% of the portfolio the banner
        appears and names its largest source funds. Economic mode replaces collateral only
        when the underlying exposure can be stated accurately; otherwise it remains visible
        rather than being guessed.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>The Undisclosed slice</h3>
      <p style={{ marginBottom: '1rem' }}>
        Free holdings sources often publish only a fund's largest positions. For a broad
        fund that can be a small fraction of the whole — a top-25 list covers roughly 6% of
        RSP and 18% of AVUV. Rather than rescaling the known names to 100% and overstating
        them, the unknown remainder is charted as its own grey slice, and rows such as
        <em> UTG — rest not disclosed by issuer</em> name the fund it came from.
        <strong> Every weight on this page is therefore a floor, not an estimate.</strong>{' '}
        Where a fund's issuer publishes a complete holdings file, the full list is used and
        the Undisclosed slice for that fund disappears.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        The banner separates the two cases by colour, because they call for different
        responses. <strong>Grey</strong> is what the issuer will not publish — a ceiling you
        cannot do anything about. <strong>Amber</strong> is a fund with no holdings data at
        all, which is fixable: point it at a holdings source or define it by hand.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Per-fund coverage</h3>
      <HelpScreenshot
        src="./help-screenshots/diversification/fund-coverage.png"
        alt="The expanded per-fund coverage table listing fund, value, source, as-of date, basis, and coverage percentage for each of 45 funds"
        caption="Which source answered for each fund, and how much of that fund it actually covered."
      />
      <p style={{ marginBottom: '1rem' }}>
        <strong>Source</strong> is who supplied the holdings — an issuer (<code>neos</code>,
        <code> yieldmax</code>, <code>firsttrust</code>), a general source, <code>manual</code> for
        anything you entered on Fund Definitions, or <code>exposure</code> when an economic mapping
        was used instead. <strong>Basis</strong> says whether that data is the fund's literal
        filing or a mapped economic exposure. <strong>Coverage</strong> is the share of the fund
        those holdings account for: green at 95% and above, red below 50%, and a
        <em> no data — define</em> link when nothing was found at all.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Read it top-down. The table is ordered by dollar value, so a poor coverage figure in the
        first few rows distorts the chart far more than a missing small position, and those are
        the funds worth defining by hand first.
      </p>
    </div>
  )
}

function FundDefinitionsHelp() {
  return (
    <div>
      <h2>Fund Definitions</h2>
      <p style={{ marginBottom: '1rem' }}>
        Some funds cannot be opened up automatically — mutual funds in particular have no
        free constituent source, and newer ETFs often have no published page yet. This page
        lists them, largest position first, so you can fill in what they hold by hand.
        Anything you define here immediately joins the{' '}
        <strong>Diversification</strong> look-through.
      </p>

      <h3>The two tabs</h3>
      <ul style={{ marginBottom: '1rem' }}>
        <li><strong>Constituents</strong> — what the fund holds, as percentages of the fund.
          You do not have to account for all 100%: whatever you leave out simply stays in the
          Undisclosed slice, so entering a fund's top ten is a real improvement over nothing.</li>
        <li><strong>Economic exposure</strong> — for funds whose filed holdings misrepresent
          them. Use this when a fund holds Treasuries and options but is economically tracking
          gold, bitcoin, or a single stock. This is what the Diversification page uses in
          Economic exposure mode.</li>
      </ul>

      <h3>Hand-entered data always wins</h3>
      <p style={{ marginBottom: '1rem' }}>
        Definitions you enter are stored separately from fetched data and are
        <strong> never overwritten by a refresh</strong>, including <em>Refresh all</em>. If
        you later want a fund resolved automatically again, clear its rows and save.
      </p>

      <h3>Filters</h3>
      <ul style={{ marginBottom: '1rem' }}>
        <li><strong>Needs definition</strong> — no constituent data at all. Start here; the
          list is ordered by dollar value, so the top rows move the chart most.</li>
        <li><strong>Partial coverage</strong> — resolved, but under 90% of the fund is known.
          Worth topping up by hand for large positions.</li>
        <li><strong>Hand-defined</strong> — everything you have already entered.</li>
      </ul>

      <h3>Holdings sources (the lookup table)</h3>
      <p style={{ marginBottom: '1rem' }}>
        The second tab lists fund families and where each one publishes its holdings.
        None of it is hardcoded — adding a family, fixing a URL, or pointing a ticker at a
        different issuer all happen here, and the next refresh picks them up. Put{' '}
        <code>{'{ticker}'}</code> or <code>{'{ticker_lower}'}</code> in the URL where the
        symbol belongs.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Format</strong> tells the app how to read what comes back:
      </p>
      <ul style={{ marginBottom: '1rem' }}>
        <li><code>neos_csv</code>, <code>ssga_xlsx</code>, <code>vanguard_json</code> — those
          issuers' specific file formats.</li>
        <li><code>generic_csv</code> — any plain CSV; columns are detected by name.</li>
        <li><code>html_table</code> — scrapes a holdings table straight off an issuer page.
          Works for Reaves (UTG) and Adams (ADX).</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Test</strong> fetches a fund you actually own through that issuer and reports
        how many holdings came back and what percentage they cover, so a URL can be validated
        without running a full refresh.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Some issuers build their holdings table in JavaScript (TappAlpha, Nicholas/XFUNDS,
        Cohen &amp; Steers, Aberdeen). There is no HTML table to read on those pages, so they
        need either a published CSV/XLSX file — set its URL here — or hand entry on the Funds
        tab.
      </p>
    </div>
  )
}

function CorrelationHelp() {
  return (
    <div>
      <h2>Correlation Matrix</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Correlation Matrix measures how closely any set of tickers move together over a selected
        period. A correlation of <strong>+1.0</strong> means two assets move in perfect lockstep;
        <strong> −1.0</strong> means they move perfectly opposite; <strong>0</strong> means no
        relationship. Use this page to check whether your holdings are truly diversified or whether
        they'll all fall together in a downturn — a common issue in income portfolios heavily weighted
        toward similar ETF strategies.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/correlation/Screenshot 2026-05-09 120623.jpg" alt="Correlation Matrix heatmap" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Adding Tickers</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Type a ticker and click <strong>Add</strong> (or press Enter). It appears as a chip below the input.</li>
        <li>Add at least <strong>2 tickers</strong> — the Run button is disabled until you have 2 or more.</li>
        <li>Remove a ticker by clicking the <strong>×</strong> on its chip.</li>
        <li>Click <strong>Clear</strong> to reset everything.</li>
      </ol>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Period Selection</h3>
      <p style={{ marginBottom: '1rem' }}>
        Choose from 3 months, 6 months, 1 year, 2 years, 5 years, or Max. Longer periods smooth out
        short-term noise and show structural relationships. Shorter periods reveal how assets behaved
        during recent market conditions.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Correlation Heatmap</strong> — A color-coded grid. <span style={{ color: 'var(--p-81c784)' }}>Green</span> cells
          (near +1.0) mean tickers move together. <span style={{ color: 'var(--p-ef9a9a)' }}>Red</span> cells (near −1.0) mean they
          move opposite. Yellow/orange near 0 means uncorrelated. Hover over any cell for the exact value to 3 decimal places.
        </li>
        <li>
          <strong>Correlation Table</strong> — The same data as a numeric matrix. Diagonal cells show 1.00 (each ticker vs itself) and are grayed out.
        </li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Add your main income ETFs (JEPI, SCHD, QYLD, etc.) and run to see how correlated they are. High correlation between income funds means your income sources could all be hit at once in a downturn.</li>
        <li>Add SPY or TLT (bonds) to see how your portfolio correlates to broad market moves. A negative correlation with TLT suggests bond exposure would help in a market selloff.</li>
        <li>Use 1Y for recent behavior and 5Y for long-term structural relationships — compare the two to spot regime changes.</li>
        <li>Target correlations below 0.7 between holdings for meaningful diversification. Anything above 0.9 means you essentially have the same asset twice.</li>
      </ol>
    </div>
  )
}

function AnalyticsHelp() {
  return (
    <div>
      <h2>Portfolio Analytics</h2>
      <p style={{ marginBottom: '1rem' }}>
        Portfolio Analytics is the most comprehensive analysis tool in the app. It grades and scores
        any set of tickers using a full suite of risk-adjusted metrics, identifies weaknesses, suggests
        replacement ETFs, and can optimize your allocation to maximize returns, income, or a balance of both.
        You can analyze your live portfolio with one click or build any custom set of tickers.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/analytics/Screenshot 2026-05-09 121143.jpg" alt="Portfolio Analytics dashboard" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Loading Tickers</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Manual entry</strong> — Type a ticker and click Add (or Enter). Repeat for each ticker. Remove with the × chip button.</li>
        <li><strong>Load Portfolio</strong> — Instantly loads all your current portfolio holdings. The button shows the count.</li>
        <li><strong>Clear</strong> — Resets the ticker list.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Settings</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Benchmark</strong> — Defaults to SPY. Change to any ticker for comparison.</li>
        <li><strong>Period</strong> — 1M, 3M, 6M, YTD, 1Y, 2Y, 5Y, or Max.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Analysis Mode</h3>
      <p style={{ marginBottom: '0.75rem' }}>Click <strong>Analyze</strong> to run the base analysis. Results include:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Portfolio Grade Card</strong> — Letter grade (A+ through F) and numeric score with a breakdown bar showing individual grades and weights for Risk, Income, Diversification, and other dimensions.</li>
        <li><strong>Raw NAV Erosion and Yield-Funding Coverage</strong> — Raw e, distribution rate d, and accounting return r share one trailing-year starting-NAV basis. Coverage is benchmark-gated and lower-is-better. The overall score also credits price-only recovery on benchmark up days, without letting that credit reduce confirmed coverage or relative drag.</li>
        <li><strong>Yield-Funding Coverage Chart</strong> — Per-ticker benchmark-gated coverage ratios with low/moderate/high thresholds. Tickers above 0.75, down 50%+, or carrying a 5%+ share deficit deserve a closer look.</li>
        <li><strong>Per-Ticker Metrics Table</strong> — One row per ticker with all risk metrics (see columns below). Sortable by any column.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Per-Ticker Table Columns</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker, Grade, Score, Weight %</strong></li>
        <li><strong>Ulcer Index</strong> — Measures depth and duration of drawdowns. Lower is better.</li>
        <li><strong>Sharpe Ratio</strong> — Return per unit of total volatility.</li>
        <li><strong>Sortino Ratio</strong> — Return per unit of downside volatility.</li>
        <li><strong>Calmar Ratio</strong> — Annual return divided by maximum drawdown.</li>
        <li><strong>Omega Ratio</strong> — Probability-weighted gain vs loss ratio.</li>
        <li><strong>Max Drawdown</strong> — Largest peak-to-trough decline.</li>
        <li><strong>Up Capture %</strong> — How much of benchmark upside the ticker captures.</li>
        <li><strong>Down Capture %</strong> — How much of benchmark downside the ticker absorbs. Lower is better.</li>
        <li><strong>Annual Return %</strong> — Annualized price return.</li>
        <li><strong>Total Return %</strong> — Including dividends.</li>
        <li><strong>Annual Volatility %</strong> — Annualized standard deviation of returns.</li>
        <li><strong>Coverage / e</strong> — Benchmark-gated yield-funding coverage above raw trailing-year NAV erosion e. Hover to see e, d, r and the identity e = d − r.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Optimization Modes</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        After running Analyze, three optimization buttons appear:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Optimize Returns</strong> — Finds the allocation that maximizes risk-adjusted total return.</li>
        <li><strong>Optimize Income</strong> — Maximizes dividend yield while maintaining quality thresholds.</li>
        <li><strong>Balanced</strong> — Blends return and income optimization. An <strong>income/safety slider</strong> appears to tune the balance between income generation and capital preservation.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Optimization results show a table with <strong>Action</strong> (BUY/SELL/HOLD badges),
        ticker, dollar change, approximate shares to trade, current price, NAV change %, current allocation %,
        and target allocation %. Save snapshots to compare multiple optimization scenarios side by side.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Chart Tabs</h3>
      <p style={{ marginBottom: '1rem' }}>After analysis, tabs appear with additional visuals:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Risk & Returns</strong> — Scatter and return charts.</li>
        <li><strong>Income & Allocation</strong> — Income breakdown and allocation visuals.</li>
        <li><strong>Backtesting</strong> — Historical performance of the current allocation.</li>
        <li><strong>Tools</strong> — Additional utility charts.</li>
      </ul>
    </div>
  )
}

function PortfolioBuilderHelp() {
  return (
    <div>
      <h2>Portfolio Builder</h2>
      <p style={{ marginBottom: '1rem' }}>
        Portfolio Builder lets you create, name, and analyze hypothetical portfolios without
        touching your real holdings. You can build from scratch, load your live portfolio as a
        starting point, test different allocations side by side, and even generate pre-built
        strategy portfolios (like All Weather). It uses the same analytics engine as the Analytics
        page, so you get full grades, risk metrics, and optimization for any combination of tickers.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/portfolio-builder/Screenshot 2026-05-09 122850.jpg" alt="Portfolio Builder optimizer" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Managing Portfolios</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Saved portfolios appear in a <strong>left sidebar list</strong>. Click one to load it.</li>
        <li>Click the portfolio title to <strong>rename</strong> it inline.</li>
        <li>Use <strong>Save As</strong> to duplicate the current portfolio under a new name.</li>
        <li>Delete portfolios with the trash icon in the sidebar.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Adding Holdings</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Type a ticker symbol in the input field.</li>
        <li>Enter a <strong>dollar amount</strong> for that position.</li>
        <li>Click <strong>Add</strong>. The holding appears in the holdings table.</li>
        <li>Click any dollar amount in the table to <strong>edit it inline</strong> — press Enter to save.</li>
        <li>Remove a holding with the <strong>×</strong> button on its row.</li>
      </ol>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Running Analysis</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Set the <strong>Period</strong> and <strong>Benchmark</strong> (default SPY), then click
        <strong> Analyze</strong>. Results are identical in format to the Portfolio Analytics page:
        grade card, NAV erosion ratio, per-ticker metrics table, and chart tabs (Risk & Returns,
        Income & Allocation, Backtesting, Tools).
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Holdings Table Columns</h3>
      <p style={{ marginBottom: '0.75rem' }}>After analysis runs, the holdings table expands with metrics:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker, Grade, Score, Weight %, Current Price, Shares, Dollar Amount</strong></li>
        <li><strong>Ulcer Index, Sharpe, Sortino, Calmar, Omega</strong> — Risk metrics</li>
        <li><strong>Max Drawdown, Annual Return, Total Return, Annual Volatility, Yield-Funding Coverage / Raw e</strong></li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Comparing Portfolios</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Check the checkbox next to <strong>2 or more portfolios</strong> in the left sidebar.</li>
        <li>Click <strong>Compare</strong>. A radar chart and metrics comparison table appear.</li>
        <li>The comparison table highlights the <strong>winner</strong> (▲) and <strong>loser</strong> (▼) for each metric between portfolios.</li>
      </ol>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Strategies</h3>
      <p style={{ marginBottom: '1rem' }}>
        Click <strong>Strategies</strong> to access pre-built allocation templates. The All Weather
        strategy builder lets you choose fund classes (stocks, bonds, gold, etc.), select mode
        (income-focused or growth-focused), enter a total budget, and toggle between auto or manual
        fund selection. The app generates a full allocation you can load into a portfolio and analyze.
      </p>
    </div>
  )
}

function PortfolioTesterHelp() {
  return (
    <div>
      <h2>Portfolio Tester</h2>
      <p style={{ marginBottom: '1rem' }}>
        Portfolio Tester runs a head-to-head historical backtest between <strong>two portfolios</strong>
        (A and B) — up to <strong>75 tickers each</strong> — with an optional benchmark, over any
        Yahoo Finance date range from <strong>6 months to 25 years</strong>. <strong>Growth</strong> mode
        compares total return, while <strong>Income</strong> mode models distribution taxes, spending,
        reinvestment, inflation, and an optional benchmark that sells shares to match the same income.
        Results include financial metrics, a head-to-head score card, and interactive growth, drawdown,
        annual-return, rolling-CAGR, residual-principal, and monthly-income charts.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/portfolio-tester/portfolio-tester-income-summary.png" alt="Portfolio Tester Income mode settings, score card, income summary, total return, and performance summary" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
        <strong>How it differs from Portfolio Builder:</strong> Portfolio Builder is for designing and
        grading a single hypothetical allocation against a benchmark. Portfolio Tester is purely for
        <em> head-to-head backtesting</em>: two fully-defined portfolios run side-by-side on the same
        dates with the same settings so you can see which one would have done better.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Building Portfolio A and B</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each side has a source toggle. <strong>Hypothetical weights</strong> keeps the original editable
        ticker-and-target-weight backtest. <strong>Actual account history</strong> uses the selected account&apos;s
        dated buys and sells and the same transaction-aware Tracker Total Return as Growth and Total Return.
        Actual mode shows the current holdings, values, and weights; its checkboxes can narrow the replay to
        selected current holdings. Use <strong>Edit holdings &amp; weights as hypothetical</strong> to copy that
        selection into the editable model when you want to assign weights that did not actually occur.
        Only one side can use actual history, and actual history is available in Growth mode.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>Each portfolio card lets you build the allocation four different ways:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Type a ticker + optional weight %</strong> and click <strong>Add</strong> (or press Enter). If no weight is given, it's added at 0% and you can click Equal or Normalize to distribute.</li>
        <li><strong>Load Portfolio</strong> — replaces the hypothetical side with every current holding, weighted by current dollar value. This is an editable target-weight simulation; use <strong>Actual account history</strong> when you want dated transaction-aware performance instead.</li>
        <li><strong>Pick Tickers…</strong> — opens an inline picker showing every current holding sorted alphabetically with checkboxes. Search by ticker, use <strong>Select All</strong> / <strong>Select None</strong>, then apply:
          <ul style={{ paddingLeft: '1.25rem', marginTop: '0.25rem' }}>
            <li><strong>Replace Portfolio</strong> — overwrites this portfolio with exactly the selected tickers, weighted by current value.</li>
            <li><strong>Add to Portfolio</strong> — keeps existing holdings at their weights and merges in only the newly-picked tickers, then renormalizes to 100%.</li>
          </ul>
        </li>
        <li><strong>Load Filtered</strong> — pick a category from the dropdown (disabled if no categories are defined) to load only the subset of current holdings in that category.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Weights must sum to <strong>100%</strong> before you can run. The <strong>Equal</strong> button splits
        weight evenly across all tickers in the portfolio; <strong>Normalize</strong> rescales whatever
        weights you already entered so they sum to 100%. <strong>Clear</strong> empties the portfolio.
        You can edit each row's weight directly with whole numbers or decimals. The row footer shows the
        running total in green (at 100%) or amber (off).
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Shared Run Settings</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Start / End</strong> date inputs, plus <strong>preset buttons</strong>: 6M, 1Y, 2Y, 3Y, 4Y, 5Y, 10Y, 15Y, 20Y, 25Y. Presets set end to today and start to N years before.</li>
        <li><strong>Initial</strong> — starting investment for the backtest (default $10,000). Applied equally to both portfolios and the benchmark.</li>
        <li><strong>Benchmark checkbox + ticker</strong> — uncheck the <strong>Benchmark</strong> box to run <em>Portfolio A vs Portfolio B only</em> with no benchmark line. Check it to include a reference ticker (default <code>SPY</code>; change to <code>QQQ</code>, <code>VTI</code>, etc. as needed).</li>
        <li><strong>Rebalance</strong> — None, Monthly, Quarterly, or Annually. If set, each portfolio is rebalanced back to its target weights at that frequency.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Growth and Income Modes</h3>
      <p style={{ marginBottom: '0.5rem' }}>
        The mode buttons change how distributions are handled and which income controls appear:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Growth</strong> — use <strong>Include dividends</strong> to choose total-return or price-only history. When <strong>Reinvest dividends</strong> is on, each distribution buys more shares on its pay date; when off, it remains cash and is reported as distributions paid.</li>
        <li><strong>Income → Spend all distributions</strong> — takes every after-tax distribution as spendable income instead of reinvesting it.</li>
        <li><strong>Income → Spend target, reinvest surplus</strong> — targets the annual <strong>Withdraw %/yr</strong> of the initial investment. The target grows by the selected inflation rate; distributions above it are reinvested and any shortfall is funded by selling shares.</li>
        <li><strong>Income → Reinvest (DRIP)</strong> — reinvests after-tax distributions into the paying holding.</li>
        <li><strong>Income → Exclude</strong> — runs a price-only comparison without distributions.</li>
        <li><strong>Dist. tax %</strong> — a blended tax rate applied to every distribution before it is spent or reinvested.</li>
        <li><strong>Inflation %</strong> — grows a target withdrawal and converts ending principal into start-date purchasing power for the <strong>Real Principal</strong> result.</li>
        <li><strong>Benchmark = sell to match income</strong> — when income is spent, makes the benchmark deliver the same net cash by selling shares. This turns the ending-principal comparison into an apples-to-apples answer to “would I have been better off just selling the index?”</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Coverage Validation (Hard Stop)</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Before simulating, the app verifies that <strong>every ticker in both portfolios has price history
        on or before the requested start date</strong>. If any are missing, the run is rejected with a red
        error banner listing each invalid ticker and the earliest date its data actually begins.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>You get two one-click fixes in the error banner:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Remove N from Portfolio A</strong> — strips the flagged tickers from A only and renormalizes A's weights.</li>
        <li><strong>Remove N from Portfolio B</strong> — same, but for B.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Each button is disabled when the corresponding portfolio has no flagged tickers. The banner
        auto-clears when neither portfolio contains any invalid ticker. You can also simply shorten
        the backtest start date so every ticker has coverage.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Head-to-Head Score Card</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        At the top of the results, eight core metrics are shown as side-by-side score cards with the
        winning value <strong>bolded in green with a ✓</strong>:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>CAGR</strong>, <strong>Total Return</strong>, <strong>Final Value</strong> — higher wins.</li>
        <li><strong>Std Dev</strong> — lower (less volatile) wins.</li>
        <li><strong>Max Drawdown</strong> — higher (less negative) wins.</li>
        <li><strong>Sharpe</strong>, <strong>Sortino</strong>, <strong>MAR / Calmar</strong> — higher wins.</li>
        <li><strong>Total Dividends</strong> — also appears when distributions are included.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        A header badge calls out the <strong>overall winner</strong> — the portfolio that won the most
        metrics — or "Tied" if they match. The score card is only meaningful when two portfolios are
        present; with one portfolio, it shows its values without a winner concept.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Income Summary</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Income mode adds a table for each portfolio and, when enabled, the sell-to-match benchmark.
        <strong> Income Taken</strong> is spendable after-tax cash; <strong>Reinvested Surplus</strong> is
        cash above a spending target that bought more shares; and <strong>Tax Paid</strong> is the modeled
        distribution tax. <strong>Residual Principal</strong> is the nominal ending balance, while
        <strong> Real Principal</strong> restates it in start-date dollars. <strong>Total Outcome</strong>
        combines residual principal and income taken. Yield on Cost and Worst 12-mo Income provide
        additional income context.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Total Return</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the score cards, a <strong>Portfolio Total Return</strong> section shows a summary card for each portfolio
        with the total return percentage, dollar gain/loss, initial investment amount, and final value.
        Values are color-coded green (positive) or red (negative). This provides a quick at-a-glance view
        of how much each portfolio gained or lost over the backtest period.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Performance Summary Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Full metrics table with one row per portfolio plus (optionally) the benchmark:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>CAGR, Total Return, Std Dev, Peak Monthly DD, Max DD, Recovery Months</strong> — core return & risk.</li>
        <li><strong>Sharpe, Sortino, MAR/Calmar, Ulcer Index</strong> — risk-adjusted return ratios.</li>
        <li><strong>Beta, Alpha, Up Capture, Down Capture, Correlation</strong> — measured vs. the benchmark (shown as "—" if no benchmark is included).</li>
        <li><strong>Best Year / Worst Year</strong> — computed from complete calendar years only (partial stub years are excluded).</li>
        <li><strong>+ Months %</strong> — share of monthly returns that were positive.</li>
        <li><strong>Final $</strong> — ending portfolio value.</li>
        <li><strong>Divs Paid $</strong> — total distributions received across the run.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Charts</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Growth & Drawdown</strong> — Dual-panel chart. The top panel shows portfolio value over time starting at your Initial amount. The bottom panel shows <strong>drawdown from peak</strong> (% below the running all-time high; 0% = at peak, −20% = 20% below prior peak and not yet recovered). A gray zero-reference line anchors the drawdown panel.</li>
        <li><strong>Annual Returns</strong> — Grouped bar chart by calendar year. <strong>Only complete Jan–Dec years</strong> are shown — partial-year stubs are excluded so short runs don't get misleading bars. If your range doesn't cover a full year, the panel shows a note telling you to extend the range.</li>
        <li><strong>Rolling 1-Year CAGR</strong> — Rolling trailing-12-month return for each portfolio, useful for spotting which regime periods each strategy excelled in.</li>
        <li><strong>Residual Principal</strong> — shown when Income mode spends distributions. Every line delivered the same net income; the remaining balance shows which approach preserved more principal.</li>
        <li><strong>Monthly Dividend / Net Income</strong> — grouped monthly bars. Growth mode shows distributions received; spend-oriented Income mode shows the cash actually taken. A caption totals the distributions or net income for each portfolio.</li>
      </ul>
      <div style={{ marginBottom: '1rem' }}>
        <img src="./help-screenshots/portfolio-tester/portfolio-tester-growth-drawdown.png" alt="Portfolio Tester growth, drawdown, and annual returns charts" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <img src="./help-screenshots/portfolio-tester/portfolio-tester-income-charts.png" alt="Portfolio Tester rolling CAGR, residual principal, and monthly net income charts" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>
      <p style={{ marginBottom: '1rem', color: 'var(--text-dim)', fontSize: '0.88rem' }}>
        All chart values are formatted to two decimal places on both hover tooltips and axis ticks.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Coverage Footer</h3>
      <p style={{ marginBottom: '1rem' }}>
        Below the charts, a small gray footer lists every ticker used in the run and the earliest
        Yahoo Finance date available for it. This helps you spot tickers that silently shortened the
        effective window (e.g., an ETF that launched partway through a 10-year range).
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tips</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>To compare today&apos;s <strong>portfolio allocation</strong> against a single-fund alternative, click <strong>Load Portfolio</strong> on A and add a single ticker at 100% weight on B. To compare the account&apos;s real dated performance, choose <strong>Actual account history</strong> instead.</li>
        <li>To compare <strong>two subsets</strong> of your portfolio (e.g., income sleeve vs. growth sleeve), use <strong>Pick Tickers…</strong> on each side to cherry-pick what goes where.</li>
        <li>Use <strong>Load Filtered</strong> if you've tagged your holdings on the Categories page — e.g., compare all "Covered Call" holdings against all "Core Equity" holdings with two clicks.</li>
        <li>If a run fails validation, don't panic — use the one-click remove button or shorten the start date to get inside every ticker's coverage window.</li>
        <li>Toggle the <strong>Benchmark</strong> checkbox off when you only want a clean A-vs-B comparison without a third line cluttering the chart.</li>
      </ul>
    </div>
  )
}

function DistCompareHelp() {
  return (
    <div>
      <h2>Distribution Compare</h2>
      <p style={{ marginBottom: '1rem' }}>
        Distribution Compare simulates two or three funds head-to-head over the same time horizon,
        with optional withdrawal strategies and DRIP settings. It's designed to answer questions like:
        <em> "If I put $50,000 into JEPI vs SCHD and withdraw $300/month, which fund lasts longer and
        generates more total income?"</em> It compares sustainability, income adequacy, and total return
        between income and/or growth strategies.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/dist-compare/Screenshot 2026-05-09 123641.jpg" alt="Distribution Compare analysis" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Mode & Comparison Type</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Historical</strong> — Uses actual dividend and price history for the simulation.</li>
        <li><strong>Simulation</strong> — Projects forward using a selected market condition.</li>
        <li><strong>Comparison Type</strong> — Choose Income vs Growth, Growth vs Growth, or Income vs Income to set the framing of the analysis.</li>
        <li><strong>Market Condition</strong> — Neutral, Bull, or Bear (for Simulation mode).</li>
        <li><strong>Duration</strong> — 1–20 years for simulation mode.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Configuring Funds</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Set <strong>Fund A</strong> and <strong>Fund B</strong> tickers — type the symbol and click Lookup to fetch live data.</li>
        <li>Optionally add <strong>Fund C</strong> as a third comparison or benchmark.</li>
        <li>Enter an <strong>investment amount</strong> per fund.</li>
        <li>Override the <strong>yield</strong> if you want to test a different dividend rate than the current one.</li>
        <li>Toggle <strong>DRIP on/off</strong> per fund — when on, distributions buy more shares; when off, income is taken as cash.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Withdrawal Settings</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Monthly Withdrawal</strong> — Dollar amount withdrawn each month from distributions.</li>
        <li><strong>Strategy</strong> — Fixed amount, dynamic (adjusts with income), or percentage of portfolio value.</li>
        <li><strong>Inflation Adjustment</strong> — Check to increase withdrawal by an inflation rate each year, simulating real-world spending increases.</li>
        <li><strong>Dynamic Reduction</strong> — Automatically reduce the withdrawal by a set % when the portfolio falls below a threshold, extending longevity.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Monthly Tables</strong> — Month-by-month breakdown per fund showing: Month, Price, Shares, Portfolio Value, Distribution/Share, Income, Withdrawal, Excess/Shortfall (green = income covers withdrawal; red = shortfall), Cumulative Income, and ROI.</li>
        <li><strong>Summary Cards</strong> — Side-by-side final values: Final Portfolio Value, Total Withdrawn, Total Distributions, Initial vs Remaining Shares, Total Value.</li>
        <li><strong>Grade Panel</strong> — Winner verdict with individual letter grades and a comparison metrics table covering ROI, Income Adequacy, Max Drawdown, Recovery Time, Ulcer Index, and whether the fund was depleted.</li>
        <li><strong>Charts</strong> — Portfolio Value Over Time, Total Value with crossover annotations, Cumulative Distributions, Share Count, and Price Trend for all funds on the same axes.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Saving and Exporting</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Save Setup</strong> — Persists your fund configuration and settings as a named chip. Click any saved chip to reload it instantly.</li>
        <li><strong>Export Excel</strong> — Exports the full monthly detail tables for all funds to a spreadsheet.</li>
      </ul>
    </div>
  )
}

function ConsolidationHelp() {
  return (
    <div>
      <h2>Consolidation Analysis</h2>
      <p style={{ marginBottom: '1rem' }}>
        Consolidation Analysis helps you identify redundant holdings, simulate what would happen if
        you sold one position and bought another, and understand how your holdings have performed
        across different market regimes (bull, bear, sideways, high volatility). It's a powerful
        tool for cleaning up an over-diversified portfolio where multiple holdings are doing the same thing.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        The page has three tabs: <strong>Overlap</strong>, <strong>Consolidation Simulator</strong>,
        and <strong>Market Regime</strong>.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/consolidation/Screenshot 2026-05-09 124407.jpg" alt="Consolidation Analysis" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      {/* Overlap Tab */}
      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tab 1: Overlap Analysis</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Scans your portfolio for clusters of tickers that move together (high correlation), indicating
        redundancy. If QYLD and XYLD have a 0.95 correlation, they're essentially the same bet.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Correlation Threshold slider</strong> — Range 0.50–0.95 (default 0.80). Lower threshold = catches weaker overlaps and produces more clusters. Higher = only flags very strong duplicates.</li>
        <li>Click <strong>Analyze Overlap</strong> to run.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>Results show:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Summary bar</strong> — Clusters found, tickers in clusters, unique tickers.</li>
        <li><strong>Cluster cards</strong> — One card per cluster. Each lists the member tickers with their correlation to the group, current value, monthly income, and yield. A totals row sums value and income for the cluster.</li>
        <li><strong>Unclustered Tickers table</strong> — Tickers that don't fit in any cluster, with their nearest cluster and distance score.</li>
        <li><strong>Quick simulate</strong> — Click any ticker name in a cluster card to jump to the Consolidation Simulator with that ticker pre-selected as the "Sell" candidate.</li>
      </ul>

      {/* Simulator Tab */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 2: Consolidation Simulator</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Simulates what would happen if you sold one position and moved the proceeds into another.
        Shows the before/after impact on your portfolio income and value, and compares the two
        tickers' historical performance metrics.
      </p>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Select the <strong>Sell</strong> ticker from your holdings dropdown.</li>
        <li>Select the <strong>Buy Into</strong> ticker (can be any symbol, not just your holdings).</li>
        <li>Select a <strong>period</strong> (6M, 1Y, 2Y) for the comparison chart.</li>
        <li>Click <strong>Simulate</strong>.</li>
      </ol>
      <p style={{ marginBottom: '0.75rem' }}>Results include:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Before/After cards</strong> — Portfolio value, monthly income, and yield before and after the trade, with delta indicators.</li>
        <li><strong>Income Change highlight</strong> — Large colored display showing the income dollar and percentage change from the trade.</li>
        <li><strong>Performance Comparison table</strong> — Sell vs Buy metrics: Total Return, Price Return, Volatility, Max Drawdown, and Sharpe for the selected period.</li>
        <li><strong>Total Return Comparison chart</strong> — Line chart comparing both tickers' total return over the selected period, normalized to 100.</li>
      </ul>

      {/* Market Regime Tab */}
      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 3: Market Regime Analysis</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows how each of your holdings has performed during different market conditions — bull runs,
        bear markets, sideways chop, and high volatility periods. This reveals which holdings are
        defensive (hold up in bear markets) and which are momentum-driven (only shine in bull markets).
      </p>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Use the <strong>ticker picker</strong> to select which holdings to include (Select All / Clear All available).</li>
        <li>Choose a <strong>period</strong> (1Y, 2Y, 3Y).</li>
        <li>Click <strong>Analyze</strong>.</li>
      </ol>
      <p style={{ marginBottom: '0.75rem' }}>Results include:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Market Regime Timeline</strong> — A shaded chart showing which periods were classified as Bull (green), Bear (red), Sideways (gray), and High Volatility. Helps you understand what conditions your data covers.</li>
        <li><strong>Performance by Regime table</strong> — Each row is a ticker; columns are grouped by regime (Bull / Bear / Sideways / High Vol). Within each regime: Price Return %, Income Return %, Total Return %, and Max Drawdown %. Tickers with limited history show a warning badge (!).</li>
        <li><strong>Total Return by Regime bar chart</strong> — Grouped bars comparing all tickers across each market regime visually.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Use regime analysis to ensure you have some holdings that hold up in bear markets (low bear
        drawdown, positive bear income return) and aren't entirely dependent on bull-market conditions.
      </p>
    </div>
  )
}

function ExportHelp() {
  return (
    <div>
      <h2>Export</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Export page lets you download your current portfolio data as an Excel or CSV file.
        The exported format matches the Generic Positions template, and the combined workbook also includes
        a Transactions sheet so you can round-trip holdings and lot history from one file.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Export</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Select the portfolio</strong> you want to export using the navbar dropdown.
          The page confirms which portfolio is being exported ("Exporting from: <em>Name</em>").
        </li>
        <li>
          <strong>Click "Export to Excel"</strong> to download an <code>.xlsx</code> file, or
          <strong> "Export to CSV"</strong> for a plain comma-separated file.
          A spinner shows while the file is being generated.
        </li>
        <li>
          <strong>Export Holdings with Transactions</strong> downloads one Excel workbook with holdings sheets plus a Transactions sheet.
          Use the <strong>Portfolio Export (Holdings + Transactions)</strong> import format to restore it later.
        </li>
        <li>
          The file downloads automatically. A green success message confirms the filename.
        </li>
      </ol>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Export Currency</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Source USD</strong> preserves the database values and is the mode to use for backups and reimport.</li>
        <li><strong>Display CAD</strong> converts monetary columns using the active USD/CAD rate. Excel files include an Export Info sheet; CSV files include currency, rate source, and update-time columns.</li>
        <li>CAD exports are presentation reports and should not be reimported because their money values have already been converted.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Aggregate Mode</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When the <strong>Aggregate</strong> portfolio is selected, the Excel export creates one sheet per
        sub-portfolio. The combined holdings + transactions export also keeps one sheet per portfolio and adds a Transactions sheet.
        To reimport it later, use the <em>Generic Positions</em> tab with
        <strong> "Import all tabs as separate portfolios"</strong> checked for the holdings-only workbook, or the
        <strong> Portfolio Export (Holdings + Transactions)</strong> format on the Import page for the combined workbook.
        The CSV export combines all portfolios into a single flat file.
      </p>

      <div className="alert alert-info" style={{ marginTop: '1rem' }}>
        <strong>Tip:</strong> Export is a great way to back up your data before a major reimport or
        before clearing a portfolio. The holdings-only Excel file is fully compatible with the Generic Positions importer,
        and the combined workbook is compatible with the Portfolio Export importer.
      </div>
    </div>
  )
}

function PortfoliosHelp() {
  return (
    <div>
      <h2>Portfolios</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Portfolios page lets you create and manage multiple independent portfolios, control which
        ones are user-owned versus test/non-owned, choose which appear (and in what order) in the navbar selector, configure one or more Aggregate views
        that combine selected portfolios, and optionally create an Owner rollup for the brokerage
        accounts that belong to the user.
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/portfolios/manage-portfolios-overview-blurred.jpg" alt="Manage Portfolios page showing the Show/Owner columns, reorder arrows, and Aggregates section with total values blurred" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each row shows a portfolio's name, broker source, account type, holdings count, total value, and creation date.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Rename</strong> — click a portfolio name (underlined in blue) to edit it inline. Press Enter or click away to save.</li>
        <li><strong>Broker Source</strong> — which broker's imports are authorized to write into this portfolio, independent of its name. Matching broker imports check this field, not the portfolio name.</li>
        <li><strong>Account Type</strong> — mark the portfolio as User-owned or Test / non-owned. Test/non-owned portfolios remain selectable and keep their data, but are clearly labeled and cannot be included in Owner.</li>
        <li><strong>Show</strong> — controls whether the portfolio appears in the navbar portfolio selector. Clear it to keep a test, retired portfolio, or Owner rollup around without deleting it or cluttering the dropdown.</li>
        <li><strong>Owner checkbox</strong> — after Owner has been created, marks a regular user-owned portfolio for inclusion in that rollup. Portfolios checked here are used for Sync Owner and for calculating the DRIP/Cash income split on the Dashboard.</li>
        <li><strong>Cash</strong> — the account&apos;s cash balance, with the date it was written underneath. Click the amount to type a new one. See <em>Cash balances</em> below.</li>
        <li><strong>↑ / ↓ arrows</strong> (Actions column) — move a portfolio up or down. This sets the order portfolios appear in the navbar selector.</li>
        <li><strong>Select</strong> — switches the active portfolio in the navbar without leaving the page.</li>
        <li><strong>Clear</strong>, <strong>Reset</strong>, and <strong>Delete</strong> — the three actions that remove data. See the comparison below.</li>
        <li><strong>+ New Portfolio</strong> — creates a new, regular empty portfolio. It is shown in the selector and is not added to Owner unless you check it.</li>
        <li><strong>+ Create Owner</strong> — appears when Owner does not exist. It creates the optional rollup without creating or changing any brokerage accounts.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Cash balances</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Cash is a <strong>dated snapshot, not a live balance</strong>. A broker import writes it, and it
        then stands untouched until something writes it again. That matters more than it sounds: on a
        portfolio of weekly payers settling on different days, something lands nearly every business
        day, so a balance imported on Tuesday can be hundreds of dollars light by Friday without
        anything being broken. Every screen that shows cash therefore also shows the day it was written.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Cash is not part of any return. Price Return and End Value measure the positions being charted,
        so cash sits outside them and is added back on the <strong>Account Value</strong> card — that is
        the figure to compare against a broker&apos;s net liquidating value, not End Value.
      </p>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.4rem' }}>Setting it by hand</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>Click the amount in the <strong>Cash</strong> column, type the balance, and press Enter. Escape cancels.</li>
        <li>Negative values are allowed. A margin debit is real cash owed, and broker imports already store it that way.</li>
        <li>Set cash on the <strong>individual account</strong>. Owner and aggregates total their members rather than holding cash of their own, so they refuse the edit rather than stranding a figure nothing reads.</li>
      </ul>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.4rem' }}>What overwrites what</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Last write wins, whoever wrote it.</strong> A figure you type replaces the last import,
        and the next import replaces what you typed. There is deliberately no lock on cash, unlike the
        dividend cadence and per-share pins on the Holdings screen.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The reason is that cash is the one field where the broker outranks you. A number you type is
        right for the moment you type it and starts decaying as soon as the next distribution settles;
        the import is right for its own day. A lock would make the app prefer your older figure over the
        broker&apos;s newer one, which is backwards. An account that an import file does not mention is
        left alone, so a partial import never wipes cash entered on another account.
      </p>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.4rem' }}>Reading the date line</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>as imported 8/26 &middot; 3 days ago</strong> — a broker import wrote it, and that is how far back.</li>
        <li><strong>entered by hand today</strong> — you typed it.</li>
        <li><strong>date unknown</strong> — the account holds cash but has no record of when the figure was written.</li>
        <li><strong>oldest of 4 accounts</strong> — on the Account Value card, a total spanning several accounts reports the oldest of their dates, because a sum is only as current as its stalest part.</li>
      </ul>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.4rem' }}>The &quot;paid since&quot; estimate</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A stale balance also shows a line such as
        {' '}<strong>+$125.60 paid since &middot; at least $13,039.93</strong>. That is the distributions
        the payment ledger knows settled <em>after</em> the balance was written, added on.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>It says <strong>at least</strong> because it is a floor, never the balance. Trades, option premium, fees and interest also move cash and leave no trace in the payment ledger, so the real figure is usually higher.</li>
        <li><strong>Reinvested (DRIP) holdings are excluded.</strong> That money bought shares rather than settling as cash, so counting it would invent money that never arrived.</li>
        <li>A payment settling on the same day the balance was written is already inside that balance and is not counted a second time.</li>
        <li>An account with no recorded date shows no estimate — there is no &quot;since&quot; to measure from.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Treat it as a nudge toward the right number rather than a replacement for importing. The
        reliable fix for a stale balance is a fresh broker import, or typing today&apos;s figure.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Clear vs Reset vs Delete</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Three buttons in the Actions column remove data, and they differ in how much they take.
        The short version: <strong>Clear</strong> empties the holdings and the transaction ledger
        behind them, <strong>Reset</strong> also empties option trades and the DRIP contribution
        schedule, and <strong>Delete</strong> removes the portfolio itself.
      </p>
      <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
        <table className="holdings-table" style={{ minWidth: '640px' }}>
          <thead>
            <tr>
              <th>What it removes</th>
              <th style={{ textAlign: 'center' }}>Clear</th>
              <th style={{ textAlign: 'center' }}>Reset</th>
              <th style={{ textAlign: 'center' }}>Delete</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Holdings, dividends, income tracking, DRIP config</td>
              <td style={{ textAlign: 'center', color: 'var(--p-ef9a9a)' }}>Removed</td>
              <td style={{ textAlign: 'center', color: 'var(--p-ef9a9a)' }}>Removed</td>
              <td style={{ textAlign: 'center', color: 'var(--p-ef9a9a)' }}>Removed</td>
            </tr>
            <tr>
              <td>Transactions and dividend payments</td>
              <td style={{ textAlign: 'center', color: 'var(--p-ef9a9a)' }}>Removed</td>
              <td style={{ textAlign: 'center', color: 'var(--p-ef9a9a)' }}>Removed</td>
              <td style={{ textAlign: 'center', color: 'var(--p-ef9a9a)' }}>Removed</td>
            </tr>
            <tr>
              <td>Option trades, DRIP contribution schedule</td>
              <td style={{ textAlign: 'center', color: 'var(--pos-strong)' }}>Kept</td>
              <td style={{ textAlign: 'center', color: 'var(--p-ef9a9a)' }}>Removed</td>
              <td style={{ textAlign: 'center', color: 'var(--p-ef9a9a)' }}>Removed</td>
            </tr>
            <tr>
              <td>NAV history, category definitions, manual overrides, saved plans</td>
              <td style={{ textAlign: 'center', color: 'var(--pos-strong)' }}>Kept</td>
              <td style={{ textAlign: 'center', color: 'var(--pos-strong)' }}>Kept</td>
              <td style={{ textAlign: 'center', color: 'var(--p-ef9a9a)' }}>Removed</td>
            </tr>
            <tr>
              <td>The portfolio itself (name, broker source, aggregate membership)</td>
              <td style={{ textAlign: 'center', color: 'var(--pos-strong)' }}>Kept</td>
              <td style={{ textAlign: 'center', color: 'var(--pos-strong)' }}>Kept</td>
              <td style={{ textAlign: 'center', color: 'var(--p-ef9a9a)' }}>Removed</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Clear</strong> — use when you want to reload a portfolio from a fresh export. The transaction ledger goes with the holdings, so whatever you import next is exactly what the portfolio ends up with. That matters because a transaction import skips rows it already has on file: a ledger left in place would treat your corrected rows as duplicates, discard them, and hand back the same bad history you just fixed.</li>
        <li><strong>Reset</strong> — use when an import went wrong and you want to start that portfolio's import over from scratch. This is the one that also wipes option trades and the DRIP contribution schedule, which Clear leaves behind because no positions or transactions file rebuilds them.</li>
        <li><strong>Delete</strong> — use when you no longer want the portfolio at all. It disappears from the navbar selector and from any aggregates it belonged to. Owner can be deleted after every member has been unchecked; deleting it leaves those brokerage accounts untouched.</li>
      </ul>

      <div className="alert alert-warning" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Nothing is removed without warning.</strong> All three buttons first read the
        portfolio and show you the exact record counts they are about to remove, list what they
        will keep, and then require you to type the portfolio name before anything happens. A
        database backup is saved first in every case — restore it from the Import page if you
        change your mind. Other portfolios are never affected.
      </div>

      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Owner and broker imports:</strong> Owner is optional and is never a broker import destination.
        Create a regular portfolio for each brokerage account, import that account&apos;s files there, then check the
        portfolios that should feed Owner. This rule also applies to the first account in a new database, preventing
        a Schwab, Fidelity, or other broker account from silently becoming Owner.
      </div>

      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Owner vs Aggregates:</strong> These are independent configurations. Owner typically represents your primary
        brokerage accounts, while an aggregate such as Combined Portfolios can include everything across all brokerages.
        For example, you might have four accounts in Owner but five in an aggregate (adding an account at a different
        brokerage). The Dashboard's DRIP$/Cash$ columns use the Owner configuration to determine which accounts' DRIP
        flags to consider.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Aggregates</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        An aggregate is a read-only virtual portfolio that combines selected real portfolios — for example
        "Combined Portfolios" for everything, or a household group like "Shear Portfolios". You can define
        more than one. Each aggregate appears in the navbar selector alongside your real portfolios once configured.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>+ Add Aggregate</strong> — creates a new empty aggregate. Click its name (underlined in blue) to rename it inline.</li>
        <li><strong>Members</strong> — check the portfolios, listed below the aggregate's name, that should be combined into it. Owner itself is never a selectable member.</li>
        <li><strong>Show</strong> — controls whether the aggregate appears in the navbar selector, the same idea as the Show column in the portfolio table above.</li>
        <li><strong>↑ / ↓ arrows</strong> — move an aggregate up or down in the navbar selector order.</li>
        <li><strong>Select</strong> — switches to viewing this aggregate.</li>
        <li><strong>Delete</strong> — removes the aggregate definition. Member portfolios and their data are not affected.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Sync Owner</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        This compatibility section appears for existing setups that previously used an Owner-format
        import. New Owner rollups update automatically from the portfolios checked <strong>Owner</strong>
        in the table above.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>Tickers present in the source but missing from Owner are <strong>added</strong>.</li>
        <li>Tickers in Owner that no longer exist in the source are <strong>removed</strong>.</li>
        <li>Share counts are updated to match the combined totals.</li>
        <li>Pick a <strong>Source</strong>, click <strong>"Sync Owner"</strong>, and confirm the prompt to proceed.</li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '1rem' }}>
        <strong>Note:</strong> Sync Owner is a destructive update to the Owner portfolio.
        Consider exporting the Owner portfolio first if you want a backup.
      </div>
    </div>
  )
}

function MenuControlHelp() {
  return (
    <div>
      <h2>Menu Control</h2>
      <p style={{ marginBottom: '1rem' }}>
        Menu Control lets you change the <strong>order</strong> of items in the top navigation bar —
        the top-level menus (Dashboard, Portfolio, Options, Admin, and so on), the pages listed inside
        each dropdown, and the section headings inside dropdowns that have grouped sections (currently
        just Analysis). You can also <strong>hide</strong> pages you do not use, or apply a role preset
        (Income tracker, CEF analyst, Options overlay). Hidden pages are removed from the menu and from
        Split View&apos;s page picker; they are not deleted. Open them from the command palette
        (Ctrl+K / ⌘K) or unhide them here. Dashboard, Admin, Menu Control, Settings, and Help always stay visible.
      </p>

      <HelpScreenshot
        src="./help-screenshots/menu-control/overview.png"
        alt="Menu Control page with the Menus panel on the left and the Top navigation order on the right, showing Restore Defaults, Discard Changes, and Save Changes buttons"
        caption="Pick a menu from the Menus panel on the left, then reorder its items on the right. Top navigation controls the order of the top-level menu bar itself."
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Choosing a Menu</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>Menus</strong> panel on the left lists every part of the navigation bar that can be reordered:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '1rem' }}>
        <li><strong>Top navigation</strong> — the order of Dashboard, Action Center, and each dropdown menu along the top bar.</li>
        <li><strong>One entry per simple dropdown</strong> (Options menu, Portfolio menu, Checklists menu, CEF's menu, Taxes menu, Admin menu) — the order of the pages listed inside that dropdown.</li>
        <li><strong>Analysis groups</strong> — Analysis is the one dropdown with section headings, so it gets its own scope for the headings themselves (Research &amp; Compare, Screeners &amp; Signals, Income &amp; NAV Risk, Portfolio Diagnostics, Planning &amp; Optimization).</li>
        <li><strong>Analysis — &lt;section name&gt;</strong> — one entry per Analysis section, for reordering just the pages inside that section.</li>
      </ul>

      <HelpScreenshot
        src="./help-screenshots/menu-control/admin-menu-scope.png"
        alt="Menu Control with Admin menu selected, showing Import, Export, ETF Provider Update, Portfolios, Menu Control, Settings, and Help in a reorderable list"
        caption="Selecting “Admin menu” shows the same pages you see in the Admin dropdown itself, including Menu Control and Help — reordering here changes the order they appear in the dropdown."
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Reordering Items</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '1rem' }}>
        <li><strong>Drag</strong> a row by its <strong>⋮⋮</strong> handle (or anywhere on the row) and drop it where you want it to land.</li>
        <li><strong>Or use the ↑ / ↓ buttons</strong> on the right of each row. They're grayed out once a row is already at the top or bottom of the list.</li>
        <li>The numbered circle on the left of each row shows its current position and updates live as you move things.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Groups vs. Items Inside a Group</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Analysis is the only dropdown with sub-sections, so it needs the extra scope described above.
        Selecting <strong>"Analysis groups"</strong> reorders the section headings themselves — moving
        "Screeners &amp; Signals" above "Research &amp; Compare", for example, changes the order those
        whole sections appear in the dropdown. To reorder the pages inside one section instead, select
        that section by name (e.g. "Analysis — Screeners &amp; Signals").
      </p>

      <HelpScreenshot
        src="./help-screenshots/menu-control/analysis-groups-scope.png"
        alt="Menu Control with Analysis groups selected, showing Research & Compare, Screeners & Signals, Income & NAV Risk, Portfolio Diagnostics, and Planning & Optimization in a reorderable list"
        caption="Analysis groups reorders the five section headings inside the Analysis dropdown. Each section also has its own entry in the Menus panel for reordering the pages inside it."
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Saving, Discarding, and Restoring Defaults</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '1rem' }}>
        <li><strong>Save Changes</strong> writes the current draft and immediately updates the navigation bar — no restart needed. It stays disabled until you've actually changed something.</li>
        <li><strong>Discard Changes</strong> throws away every unsaved edit — across all menus, not just the one you're viewing — and reloads the last saved order.</li>
        <li><strong>Restore Defaults</strong> resets the draft for every menu back to the app's built-in order and shows every page again, not just the one currently selected. It only changes the draft — click Save Changes afterward to actually apply it, or Discard Changes to back out.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Hiding Pages and Role Presets</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each row has a <strong>Hide</strong> / <strong>Show</strong> button. Hide removes that page (or a whole
        dropdown, if you hide it from Top navigation) from the menu after you save. A role preset writes a
        starting hide list for Income tracker, CEF analyst, or Options overlay. You can still show individual
        pages afterward. If you open a hidden page, a banner at the top lets you put it back in the menu immediately.
      </p>

      <div className="alert alert-info" style={{ marginTop: '1rem' }}>
        <strong>Note:</strong> Menu Control is a single, app-wide setting — it isn't tied to a portfolio
        or profile. Saving here changes the navigation bar for the whole app immediately.
      </div>
    </div>
  )
}

function CommandPaletteHelp() {
  return (
    <div>
      <h2>Command Palette</h2>
      <p style={{ marginBottom: '1rem' }}>
        The command palette jumps to a page, ticker, or action without walking the menus.
        Press <strong>Ctrl+K</strong> (⌘K on a Mac) from anywhere, or click <strong>Search</strong> in the top bar.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '1rem' }}>
        <li><strong>Pages</strong> — every screen in the app, including ones you hid from the menu. Hidden pages are labeled Hidden.</li>
        <li><strong>Tickers</strong> — holdings and watchlist symbols. Choosing one opens Security Research for that ticker.</li>
        <li><strong>Actions</strong> — refresh prices, open Import or Help, switch portfolio, or switch cost basis.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Type any part of the name. Arrow keys move the highlight; Enter opens it; Esc closes the palette.
        Hiding a page in Menu Control only removes it from the navigation bar and Split View picker —
        the palette is how you get back to it without unhiding.
      </p>
    </div>
  )
}

function SettingsHelp() {
  return (
    <div>
      <h2>Settings</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Settings page provides a data overview for the active portfolio, lets you manage the
        Single-Stock ETF list used by the Portfolio Builder optimizer, and offers a nuclear
        "Clear All Data" option.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Display Currency &amp; Exchange Rate</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        USD is the source currency stored in the database. Selecting CAD converts money displays using the cached USD/CAD rate.
        The rate panel shows its source, market date, last update time, and whether the value came from the persistent cache.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Refresh Live Rate</strong> bypasses the six-hour cache and requests the latest Yahoo Finance close.</li>
        <li><strong>Manual override</strong> replaces the effective display/export rate while retaining the latest live rate for comparison.</li>
        <li><strong>Use Live Rate</strong> clears the override and immediately returns to the cached live rate.</li>
        <li>If the live request fails, the app continues with the last saved rate and marks it stale.</li>
      </ul>
      <div style={{ marginTop: '1rem', marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/settings/display-currency-exchange-rate.png"
          alt="Display Currency settings showing USD and CAD selection, the live exchange rate, refresh control, rate dates, and manual override"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
        <p style={{ fontSize: '0.9rem', color: 'var(--text-dim-2)', marginTop: '0.5rem' }}>
          The Display Currency panel shows the active USD/CAD rate and its source, lets you refresh the live rate, and supports a manual rate override when needed.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Overview</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows three counts for the currently selected portfolio: number of <strong>Holdings</strong>,
        <strong> Dividend Records</strong>, and <strong>Income Tracking</strong> rows.
        Use this to confirm a successful import or to check whether a portfolio has data before clearing it.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Single-Stock ETFs</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Single-stock ETFs are leveraged or inverse products tied to a single underlying stock
        (e.g. NVDL, TSLL, MSFO). The Portfolio Builder optimizer suppresses BUY recommendations for
        these tickers in <em>Optimize Returns</em> and <em>Balanced</em> modes unless the income
        slider is at 100%. They are still allowed when optimizing for income.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Built-in list</strong> — a pre-loaded set of known single-stock ETFs. These are read-only.</li>
        <li><strong>Your additions</strong> — tickers you've added yourself. Click the <strong>&times;</strong> next to any ticker to remove it.</li>
        <li><strong>Add tickers</strong> — type one or more ticker symbols (comma- or space-separated) into the input box and click <strong>Add</strong> or press Enter.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Clear All Data</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Permanently deletes holdings, the transaction ledger, dividends, income tracking, and payout
        data for the currently selected portfolio — the same scope as <strong>Clear</strong> on the
        Portfolios page. Option trades, the DRIP contribution schedule, NAV history, and saved plans
        are kept. Use this to start fresh before a clean reimport.
      </p>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Click <strong>"Clear All Data"</strong>.</li>
        <li>A confirmation prompt appears. Click <strong>"Yes, Delete Everything"</strong> to proceed or <strong>Cancel</strong> to abort.</li>
      </ol>
      <div className="alert alert-info" style={{ marginTop: '1rem' }}>
        <strong>Tip:</strong> Export your portfolio first (Admin → Export) before clearing, so you have a backup
        you can reimport if needed.
      </div>
    </div>
  )
}

function MacroDashboardHelp() {
  return (
    <div>
      <h2>Macro Regime Dashboard</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Macro Regime Dashboard shows current macroeconomic conditions, analyzes your portfolio's
        sensitivity to macro factors, suggests rebalancing tilts, and benchmarks your income allocation.
        It has six tabs.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/macro-dashboard/Screenshot 2026-05-09 124729.jpg" alt="Macro Regime Dashboard" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tab 1: Macro Conditions</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Displays the current macro regime (e.g., Stable Inflation + Stable Rates) along with alert
        badges for notable conditions like Oil Rising or Rising Volatility. Shows sparkline charts
        for key indicators: Inflation Expectations, Oil (WTI), 10-Year Yield, Short-Term Rate, VIX,
        Dollar Index, and Credit Spreads, each with 3-month trend direction and change.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/macro-dashboard/Screenshot 2026-05-09 124802.jpg" alt="Macro Conditions tab showing economic indicators" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 2: Portfolio Exposure</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Analyzes how each holding is classified by macro sensitivity (e.g., Rate Sensitive, Inflation Hedge,
        Oil Linked, Volatility Linked). Shows a breakdown of your portfolio value across sensitivity
        categories with an alignment score indicating how well-positioned your portfolio is for current
        macro conditions.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Holdings are classified using a 4-tier fallback system: user overrides → classification type → description keywords → ticker-specific rules.</li>
        <li>Click any sensitivity category to expand and see which holdings fall into it.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/macro-dashboard/Screenshot 2026-05-09 124826.jpg" alt="Portfolio Exposure breakdown by macro sensitivity" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 3: Rebalancing Tilts</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Based on current macro conditions, suggests which sensitivity categories to overweight or
        underweight. Provides per-holding action recommendations (increase, hold, reduce, sell)
        to better align your portfolio with the macro environment.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/macro-dashboard/Screenshot 2026-05-09 124844.jpg" alt="Rebalancing Tilts recommendations" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 4: Income Benchmark</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Compares your portfolio's income allocation against a target benchmark split across 8 income
        categories: Covered Call, BDCs, CEFs, REITs, Preferred Stock, Dividend Growth, Commodities/Gold,
        and Bonds/Fixed Income.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Summary cards</strong> — Portfolio value, annual/monthly income, blended yield, and diversification score.</li>
        <li><strong>Bar chart</strong> — Visual comparison of actual vs. target allocation for each bucket.</li>
        <li><strong>Comparison table</strong> — Sortable columns for target %, actual %, over/under, shares, value, monthly income, yield, and $ to target. Click a bucket row to expand and see individual holdings.</li>
        <li><strong>Edit Targets</strong> — Click to customize the target allocation percentages. Targets must sum to 100%. Custom targets are saved per-profile. Use "Reset to Defaults" to revert.</li>
        <li><strong>Bucket reassignment</strong> — In an expanded bucket, use the dropdown on any holding to move it to a different bucket or exclude it from the benchmark.</li>
        <li><strong>Excluded Holdings</strong> — Holdings excluded from the benchmark appear at the bottom with a dropdown to reassign them.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/macro-dashboard/Screenshot 2026-05-09 124904.jpg" alt="Income Benchmark allocation comparison" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 5: Classifications</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Lets you override the system's automatic macro sensitivity classification for any holding.
        The system classifies holdings using description keywords and classification types, but you
        can manually set sensitivity tags or exclude a holding from macro analysis entirely.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Filter buttons</strong> — View All, Overridden only, Auto-classified only, or Excluded only.</li>
        <li><strong>Edit</strong> — Opens a multi-select dropdown to choose sensitivity tags for a holding.</li>
        <li><strong>Exclude</strong> — Removes a holding from macro exposure calculations.</li>
        <li><strong>Revert</strong> — Removes the override and returns to auto-classification.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/macro-dashboard/Screenshot 2026-05-09 124932.jpg" alt="Classifications tab for macro sensitivity overrides" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 6: Regime Quadrants</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Uses a Markov Chain transition model to classify the current macroeconomic regime into one of
        four quadrants based on the direction of growth and inflation, then projects forward probabilities
        of transitioning to other regimes. Data is sourced from FRED economic indicators and market proxies.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>The Four Quadrants</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Q1 Goldilocks</strong> — Growth UP + Inflation DOWN. Favors equities, tech, and growth stocks.</li>
        <li><strong>Q2 Reflation</strong> — Growth UP + Inflation UP. Favors commodities, energy, and equities.</li>
        <li><strong>Q3 Stagflation</strong> — Growth DOWN + Inflation UP. Favors gold, TIPS, and utilities.</li>
        <li><strong>Q4 Deflation</strong> — Growth DOWN + Inflation DOWN. Favors long-term bonds, cash, and defensives.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/macro-dashboard/Screenshot 2026-05-09 124944.jpg" alt="Regime Quadrants showing macro classification" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How Classification Works</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The current quadrant is determined using real economic data from FRED (Federal Reserve Economic Data):
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Growth</strong> — Composite Z-score of Industrial Production (INDPRO) and Housing Starts (HOUST), using their 3-month rate of change.</li>
        <li><strong>Inflation</strong> — Z-score of CPI (CPIAUCSL) 3-month rate of change.</li>
        <li><strong>Z-score</strong> — Measures how far current values are from their historical average in standard deviations. Positive = above average (rising), negative = below average (falling).</li>
        <li>If Growth Z {'>'} 0 and Inflation Z {'<'} 0 → Q1 Goldilocks. Growth Z {'>'} 0 and Inflation Z {'>'} 0 → Q2 Reflation. And so on.</li>
      </ul>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>FRED Economic Indicators Card</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows the raw Z-scores for each FRED series along with their direction (Rising/Falling) and
        extremity level (Normal, Elevated, or Extreme). "Elevated" means the Z-score is above 1.0,
        "Extreme" means above 2.0. These labels help gauge how far conditions have moved from normal
        and whether mean-reversion is likely.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Regime Quadrant Map (Scatter Plot)</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A 2D scatter plot showing 5 years of weekly observations. The X-axis is the growth score
        and the Y-axis is the inflation score. Each dot is color-coded by quadrant. The orange
        diamond marked "Now" shows where current conditions sit. The quadrant lines cross at
        the origin (0,0) — points in the upper-right are Q2 Reflation, upper-left are Q3 Stagflation, etc.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>This Week's Outlook — Next Week Probabilities</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Four cards showing <strong>this week's specific</strong> probability of transitioning to each quadrant
        next week. Unlike the historical transition matrix (which shows long-run averages), these probabilities
        are adjusted for current conditions using three techniques:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Conditional matching</strong> — Filters historical transitions to only weeks with similar growth/inflation momentum direction, so the probabilities reflect periods that "looked like now."</li>
        <li><strong>FRED Z-score mean reversion</strong> — When economic indicators (Industrial Production, Housing Starts, CPI) are at extreme Z-scores, the model increases the probability of reverting toward the opposite quadrant.</li>
        <li><strong>Historical baseline</strong> — Shown below each probability for comparison. This is the long-run average from the full transition matrix.</li>
        <li><strong>Delta arrows (▲/▼ Xpp)</strong> — The difference in percentage points between this week's adjusted probability and the historical baseline. For example, "▲ 4.0pp" means this week's probability is 4 percentage points higher than usual. On the "Stay" card, a green ▲ means conditions favor persistence; an orange ▲ on a transition card means elevated risk of moving to that quadrant.</li>
        <li><strong>Similar historical weeks</strong> — The subtitle shows how many past weeks matched current momentum conditions. More matches mean higher confidence in the adjusted probabilities.</li>
      </ul>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Historical Transition Matrix (Heatmap)</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A 4×4 grid showing the <strong>long-run historical</strong> probability of moving from one quadrant (row) to another
        (column) in a single week. These are unadjusted averages across all observations — they do not factor
        in current conditions. Read it as: "Historically, from this row, there was an X% chance of being in
        this column next week."
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>▶ arrow</strong> — Marks the row for the current quadrant. This is the row that matters most — it shows where we might go next.</li>
        <li><strong>Numbers in parentheses</strong> — The count of times that specific transition actually occurred in the historical data. Higher counts mean more confidence in that probability.</li>
        <li><strong>Diagonal values</strong> — The "self-transition" or stickiness of each regime. High diagonal values (e.g., 85%) mean regimes tend to persist week-to-week.</li>
        <li>Compare this matrix to the "This Week's Outlook" cards above to see how current conditions shift the probabilities versus the long-run baseline.</li>
      </ul>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>4-Week Outlook Cards</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Four cards above the forward projections chart showing the probability of being in each
        quadrant at the 4-week horizon. The highest-probability quadrant is highlighted with
        a colored border. This is the quick-read summary of where things are heading.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Forward Projections (Stacked Bar Chart)</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows the probability distribution across all four quadrants at 1, 2, 4, 8, and 13 week
        horizons. Calculated using matrix exponentiation (raising the transition matrix to the
        power of N weeks). Over longer horizons, probabilities tend to converge toward the
        long-run equilibrium distribution as mean-reversion takes effect.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Markov Chain Transition Bars</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Horizontal bar chart showing 1-week transition probabilities from the current quadrant.
        The "Stay in Q{'{n}'}'" bar shows persistence probability. Other bars show the chance of
        transitioning to each alternative regime. The highest non-self transition is flagged as
        "Primary Risk" if above 25%.
      </p>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Interpretation Card</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A narrative summary that puts the numbers in context:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Regime Change indicator</strong> — GREEN (stable, high self-transition), YELLOW (moderate risk), or RED (regime shift likely).</li>
        <li><strong>Growth/Inflation trends</strong> — Direction and 4-week rate of change for each factor.</li>
        <li><strong>Primary Risk</strong> — The most likely alternative quadrant and its weekly probability.</li>
        <li><strong>Likely Direction of Change</strong> — A paragraph explaining what FRED data suggests about where conditions are heading, including specific Z-scores and their implications.</li>
      </ul>

      <h4 style={{ color: 'var(--accent-2)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Asset Class Performance Table</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows how five asset classes (Tech/Growth, Commodities, Gold, Long-Treasuries, Healthcare/Staples)
        historically perform in each quadrant, rated as Best, Good, Neutral, Underperform, or Avoid.
        The current quadrant column is highlighted with a star (★). Use this to guide sector and asset
        class tilts based on the current regime.
      </p>
    </div>
  )
}

function IncomeGrowthHelp() {
  return (
    <div>
      <h2>Income Growth Simulator</h2>
      <p style={{ marginBottom: '1rem' }}>
        Projects how your portfolio income changes over time using your actual holdings and their real
        distribution yields. Unlike the Portfolio Income Simulator (which uses Monte Carlo on manually-entered
        tickers), this page starts from your current portfolio and applies scenario-based growth rates.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Portfolio source.</strong> Income Growth uses whichever portfolio is currently selected in the app.
        If you are viewing the aggregate/Owner portfolio, it uses that aggregate view. The holdings editor on the
        page is a working copy: if you edit shares, toggle DRIP, disable holdings, or add a custom ticker, the next
        run uses those on-screen assumptions until you reset them.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Controls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Scenario</strong> — Bullish models a normal expansion (+4% annual distribution growth, +8% price drift), Neutral uses modest nominal growth (+1% distributions, +3% price), and Bearish applies a first-year shock (-35% distributions, -25% price) followed by gradual recovery. The model also caps forward yields by scenario, with tighter caps on unusually high current payouts so they mean-revert instead of compounding forever as if fully sustainable.</li>
        <li><strong>Timeframe</strong> — 1 to 20 years. Preset buttons or custom input.</li>
        <li><strong>Monthly Investment</strong> — Additional dollars invested each month, allocated proportionally across holdings. Increases share count and future income.</li>
        <li><strong>Reinvest All / DRIP toggle</strong> — Toggle DRIP on or off for all holdings at once, or use the per-holding checkboxes in the holdings table below. When DRIP is on, dividends are reinvested to buy more shares, compounding income over time.</li>
        <li><strong>Deterministic / Monte Carlo toggle</strong> — Choose a single fixed base case or a 300-path range of possible outcomes.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Projection Methods</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Deterministic</strong> — Runs one fixed projection using the selected scenario's dividend growth and price drift. The same inputs produce the same result, so it is best for a clean base case.</li>
        <li><strong>Monte Carlo (300 paths)</strong> — Runs 300 randomized paths around the selected scenario. Dividend changes and price changes vary month to month, then the chart displays the median path with a 10th-to-90th percentile band.</li>
        <li><strong>P10 / P90</strong> — These columns appear in Monte Carlo mode. P10 is the lower 10th-percentile outcome and P90 is the upper 90th-percentile outcome for that month or year.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>DRIP and Partial Shares</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When viewing the Owner (aggregate) portfolio, DRIP reinvestment calculations use only the shares from
        sub-accounts that have DRIP enabled for each ticker — not the full aggregate share count. For example,
        if you hold 500 shares of QQQI across four accounts but only one account (86 shares) has DRIP on,
        the simulation reinvests dividends on those 86 shares only. This matches the real-world behavior where
        DRIP is configured per brokerage account. Use the <strong>DRIP Matrix</strong> on the Holdings page
        to see and control which accounts have DRIP enabled for each ticker.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Display</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Timeframe &le; 5 years</strong> — Monthly view: line chart and table showing month-by-month income with year subtotals. Income is smoothed evenly across months rather than spiking in pay months.</li>
        <li><strong>Timeframe &gt; 5 years</strong> — Annual view: bar chart and table showing year-over-year income changes.</li>
        <li><strong>Change columns</strong> — Green for income increases, red for decreases. Shows both dollar and percentage change.</li>
        <li><strong>Monte Carlo columns</strong> — P10 (pessimistic 10th percentile) and P90 (optimistic 90th percentile) appear when Monte Carlo is enabled.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Holdings Breakdown</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the timeline, a sortable table shows each holding's starting shares, ending shares (after
        DRIP and monthly contributions), frequency, current annual income, projected annual income, growth
        percentage, and DRIP status. You can toggle DRIP per holding using the checkboxes in the DRIP column,
        then re-run the simulation to see the impact.
      </p>
    </div>
  )
}

function RetirementReadinessHelp() {
  return (
    <div>
      <h2>Retirement Readiness</h2>
      <p style={{ marginBottom: '1rem' }}>
        <strong>What this screen shows:</strong> after employment, pensions, Social Security, annuities, and
        other recurring income pay their share of your monthly bills, would the selected portfolio&apos;s
        <em> after-tax distributions</em> cover the remaining gap—and cover it with your selected safety
        buffer? Current Monthly Income is the imported holdings estimate. Good Market and Bear Market
        income are separate projected values under your stated assumptions. This is a monthly planning
        model, not a prediction or a withdrawal recommendation. <strong>MEPB</strong> stands for
        <strong> Monthly Expense Protection Buffer</strong>: the multiple of portfolio-paid monthly expenses
        you want income to cover as a safety margin.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Core Inputs</h3>
      <HelpScreenshot
        src="./help-screenshots/retirement-readiness/01-inputs-panel.png"
        alt="Critical Monthly Inputs, Non-Investment Monthly Inflows, and Passive Income Assumptions input panels"
        caption="All three input groups, top to bottom: Core Inputs, Non-Investment Inflows, Passive-Income Assumptions."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Monthly Expenses</strong> - how much cash you need every month to live on. This is the baseline income target.</li>
        <li><strong>MEPB Ratio</strong> - your Monthly Expense Protection Buffer safety multiplier. It is applied to the expenses the <em>portfolio</em> must pay after non-investment inflows, not to total expenses. If that remainder is $4,500 and MEPB is 3, the stressed-income target is $13,500 per month.</li>
        <li><strong>Excess Withdrawn %</strong> - the share of good-market income above portfolio-paid expenses that goes into the cash reserve instead of being reinvested.</li>
        <li><strong>Excess Reinvested %</strong> - the share of that same surplus eligible for reinvestment. The two percentage controls are independent; the model removes the withdrawal share first, so entering totals above 100% does not spend more than the available surplus.</li>
        <li><strong>Cash Reserve</strong> - cash you already have set aside outside the portfolio for shortfalls or emergencies.</li>
        <li><strong>Cash Target Months</strong> - how many months of expenses you want in reserve. If expenses are $4,500 and this is 6, the target reserve is $27,000.</li>
        <li><strong>Years</strong> - how far forward the model projects income, expenses, surplus reinvestment, NAV, and cash reserve. Each year contains twelve compounding monthly steps.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Non-Investment Inflows</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Employment Income, Company Pension, Gov. Pension / Social Security, Annuities, and Other Recurring</strong> - monthly gross inflows outside the portfolio. When a Cash Flow &amp; Sustainability plan exists for the selected portfolio, the screen averages its twelve-month schedule into these boxes so quarterly and annual items are normalized.</li>
        <li><strong>Indexing Factor %</strong> - annual growth applied to those after-tax inflows as the model moves forward.</li>
        <li><strong>Inflows Tax Rate %</strong> - tax applied to the combined non-investment inflows. A connected cash-flow plan supplies its blended rate.</li>
        <li><strong>Portfolio Must Pay</strong> = max(0, monthly expenses - after-tax non-investment inflows). This is the denominator for the coverage ratios and MEPB target.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Passive-Income Assumptions</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Portfolio Book NAV</strong> - starting capital used by the projection. Zero means use the current value of the selected holdings.</li>
        <li><strong>Target Yield Good %</strong> - annual good-market distribution yield. Good-market income before tax = book NAV × target yield ÷ 12; after-tax income then applies Investment Tax %.</li>
        <li><strong>NAV Erosion %</strong> - annual amount treated as capital erosion that must be replenished. The model reserves book NAV × NAV erosion % ÷ 12 each month.</li>
        <li><strong>Bear Decline %</strong> - the one-time stress reduction to NAV for the bear snapshot. Bear NAV = book NAV × (1 - bear decline %).</li>
        <li><strong>Bear Yield %</strong> - annual yield used with the stressed NAV. In the monthly projection, bear distributions use the current projected NAV after that decline.</li>
        <li><strong>Investment Tax %</strong> - tax applied to good and bear portfolio distributions before the model calculates excess, reinvestment, or withdrawals.</li>
        <li><strong>Income Haircut %</strong> - an additional conservative reduction to bear after-tax income for distribution volatility. Bear protected income = bear income before tax × (1 - investment tax %) × (1 - income haircut %).</li>
        <li><strong>Direct Contribution</strong> - new outside money added to the portfolio every month, separate from reinvested distributions.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Projection Mechanics and Stress Case</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Expense Inflation %</strong> - annual rate at which monthly expenses increase. The model converts it to a monthly compound rate: (1 + annual inflation)<sup>1/12</sup> - 1.</li>
        <li><strong>Minimum reinvestment</strong> - not a separate input: every month it is book NAV × (NAV erosion % + positive expense inflation %) ÷ 12. It combines the reinvestment reserve for erosion with the reserve intended to preserve purchasing power against inflation.</li>
        <li><strong>Cash reserve</strong> - bear shortfalls draw down cash; good-market excess sent to cash builds it. The model does not sell portfolio shares to refill it.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How the Monthly Projection Works</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Expenses and inflows</strong> - each month, expenses grow at the monthly inflation rate and after-tax non-investment inflows grow at the monthly indexing rate. Net expenses are never below zero.</li>
        <li><strong>Good-market surplus</strong> = max(0, good after-tax income - net expenses). The withdrawal portion first goes to cash. The remaining surplus can be reinvested, alongside the minimum reinvestment reserve, but actual reinvestment never exceeds that month&apos;s good-market income.</li>
        <li><strong>Bear shortfall</strong> = max(0, net expenses - bear after-tax income). It reduces the cash reserve up to the cash available. A bear scenario does not add cash withdrawals to NAV.</li>
        <li><strong>Book NAV</strong> increases by direct contributions and actual reinvestment. <strong>Current NAV</strong> also subtracts the monthly NAV-erosion reserve and never falls below zero. These projected values drive later months&apos; distributions.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results, Status, and Displays</h3>
      <HelpScreenshot
        src="./help-screenshots/retirement-readiness/02-status-and-coverage.png"
        alt="Retirement Readiness header with the readiness badge and the row of coverage stat tiles including Current Monthly Income, Good and Bear Market After Tax, Cash Target, and Cash Runway"
        caption="The readiness badge (top right) and every coverage stat tile, including the redesigned Cash Runway tile."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Current Monthly Income</strong> - annual estimated distributions from the selected holdings ÷ 12. It is an imported snapshot, distinct from the target-yield projection.</li>
        <li><strong>Good / Bear Market After Tax</strong> - projected monthly income under the target-yield and bear assumptions. Bear income includes the NAV decline, tax, and income haircut.</li>
        <li><strong>Good / Bear Buffer Ratio</strong> - corresponding after-tax portfolio income ÷ portfolio-paid expenses. A value of 1.00× covers that expense remainder; a value at or above the MEPB ratio reaches the safety target.</li>
        <li><strong>Buffer Gap</strong> - max(0, MEPB target - bear protected income): the additional stressed monthly income required for the selected buffer.</li>
        <li><strong>Cash Target</strong> - monthly expenses × Cash Reserve Months. <strong>Cash Runway</strong> = current cash reserve ÷ current bear shortfall (bear-market income after tax minus portfolio-paid expenses): how long the reserve would last if that shortfall continued every month. It displays <strong>No Shortfall</strong>, with the bear-market cushion in dollars, when bear-market income already covers portfolio-paid expenses on its own — the reserve isn&apos;t being drawn down. Either way it is one input into readiness, not a standalone verdict that savings are sufficient for retirement; that judgment is the readiness badge below.</li>
        <li><strong>Readiness badge</strong> - <strong>Covered</strong> means after-tax non-investment inflows (pensions, Social Security, etc.) pay all expenses on their own, so the portfolio isn&apos;t required at all — a different condition from Cash Runway&apos;s No-Shortfall state, which is about the bear-market shortfall specifically. <strong>Ready</strong> means bear income reaches MEPB and the cash target is met (or no current bear shortfall exists). <strong>Close</strong> means the bear case or good-market case reaches MEPB. <strong>Building</strong> means bear income covers portfolio-paid expenses but not MEPB. <strong>Risky</strong> means bear income is short and current cash runway is under twelve months.</li>
      </ul>

      <HelpScreenshot
        src="./help-screenshots/retirement-readiness/03-passive-income-and-metrics.png"
        alt="Passive Income Calculations and Important Monthly Metrics panels showing the monthly formula outputs and 3-year averages"
        caption="Passive Income Calculations (left) and Important Monthly Metrics (right)."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Passive Income Calculations</strong> - shows the starting values and monthly formula outputs before the projection begins. “After Tax and Minimum Reinvestment” is the good-market income left after its planning reinvestment reserve.</li>
        <li><strong>Important Monthly Metrics</strong> - shows the present buffer math plus averages over the first 36 modeled months. “Excess After Expenses &amp; Reinvest” is income left after net expenses and minimum reinvestment; “3Y Avg Annual Withdrawals” combines projected cash transfers and portfolio-paid expenses.</li>
      </ul>

      <HelpScreenshot
        src="./help-screenshots/retirement-readiness/04-trend-and-milestones.png"
        alt="Passive Income - MEPB Trend Lines chart plotting expenses and income scenarios over the projection, next to the Milestones panel"
        caption="The trend chart (left) and Milestones (right)."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Trend lines</strong> - plots total expenses, net expenses after inflows, good after-tax income, bear after-tax income, and the MEPB target for every modeled month.</li>
        <li><strong>Milestones</strong> - the first month bear income covers net expenses, the first month it reaches MEPB, the first month cash is exhausted by a bear shortfall, and ending monthly values. “Not in horizon” means the event does not occur during the selected years.</li>
      </ul>

      <HelpScreenshot
        src="./help-screenshots/retirement-readiness/05-yearly-projection.png"
        alt="Yearly Projection table with one row per modeled year showing Book NAV, Current NAV, income, expenses, coverage ratios, and cash reserve"
        caption="Yearly Projection, the audit trail's summary view. The Monthly MEPB Projection Table beneath it isn't pictured — it runs 25 columns wide and scrolls horizontally the same way in the app."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Yearly and Monthly Projection tables</strong> - the audit trail. Yearly rows use ending monthly values for NAV, income, expenses, ratios, and cash, while annual surplus/reinvestment/cash-transfer columns are totals. The detailed table shows every monthly formula output and inserts a total row after each year.</li>
      </ul>

      <HelpScreenshot
        src="./help-screenshots/retirement-readiness/06-top-income-sources.png"
        alt="Top Income Sources table listing the largest holdings by current monthly income, with value, stress income, yield, and income share"
        caption="Top Income Sources, ranked by current monthly income."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Top Income Sources</strong> - the 15 holdings with the largest current monthly estimated distributions. Stress Income applies the overall bear-to-current-income factor, so it is an allocation aid rather than an independent ticker forecast.</li>
      </ul>
    </div>
  )
}

function GrowthIncomeFreedomHelp() {
  return (
    <div>
      <h2>Growth &amp; Income Freedom Simulator</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Growth &amp; Income Freedom Simulator compares two accumulation strategies while both receive
        the same starting capital, monthly contributions, simulation length, and market shocks. It can
        compare Income vs Income, Growth vs Growth, Income vs Growth, Custom vs Custom, or any mixture
        of those styles. Its purpose is to show which approach may build the most wealth, produce the
        most distribution income, withstand poor markets, or reach a financial-freedom target.
      </p>

      <div className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
        <strong>Accumulation-phase rule:</strong> the core simulation makes no withdrawals. Each holding
        can reinvest 0–100% of its distributions into the security that paid them. Any portion not
        reinvested remains in the strategy as non-interest-bearing cash and is included in ending wealth.
        The optional Sustainability tests (below) run separate side-calculations on top of this result.
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/growth-income-freedom/01-strategy-setup.jpg"
          alt="Growth and Income Freedom Simulator showing the simulation length and two strategy builders with portfolio holdings"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>1. Choose the Simulation Length</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>Simulation length</strong> selector is in the blue simulation-method bar above the
        strategy cards. Choose any whole year from 1 through 25. The text beneath the selector confirms
        the equivalent number of modeled months. Changing the length makes existing results stale; run
        the comparison again to calculate the new horizon.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>2. Build Strategy A and Strategy B</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Strategy name</strong> — Defaults to the imported portfolio name, but it can be edited so the result cards are easy to identify.</li>
        <li><strong>Strategy style</strong> — Labels the strategy as Income, Growth, or Custom / mixed. It never suppresses dividends or forces one portfolio-level return. When holding behavior remains on Auto, Growth style also prevents a low-yield broad equity from being treated as an income security merely because it pays a small dividend.</li>
        <li><strong>Saved portfolio</strong> — The dropdown is divided into <strong>Individual accounts</strong> and <strong>Aggregate accounts</strong>. It imports the selected account's tickers and current proportional weights.</li>
        <li><strong>Aggregate account</strong> — Combines the holdings of every member portfolio configured for that aggregate on the budgeting/Cash Flow page. Duplicate tickers are merged, and their values and annual income are summed before portfolio weights and yields are calculated.</li>
        <li><strong>Imported current value</strong> — The value displayed beside the dropdown is a reference only. The simulation starts each side with the shared <strong>Starting capital per strategy</strong>, not the imported individual or aggregate account value.</li>
        <li><strong>Entire portfolio</strong> — Includes every imported holding. The active weights are normalized to 100% for the simulation.</li>
        <li><strong>Choose individual holdings</strong> — Opens a searchable checklist. Search by ticker or security name, clear the selection, and check only the stocks or ETFs to test. The selected subset is automatically normalized to 100% while preserving its relative portfolio weights.</li>
        <li><strong>Build from tickers</strong> — Lets you assemble a strategy manually. Enter a supported ticker and select <strong>Add ticker</strong>. The lookup imports the security description, current price, current distribution yield, classification, and simulation behavior.</li>
        <li><strong>Check all / Uncheck all</strong> — Enables or disables every ticker in the strategy at once. Disabled rows remain available to recheck and are excluded from the run.</li>
        <li><strong>Equal weight</strong> — Assigns the same percentage to every enabled holding.</li>
        <li><strong>Normalize to 100%</strong> — Scales enabled weights proportionally until their total is exactly 100%.</li>
        <li><strong>Apply the same DRIP rate</strong> — Enter 0–100% and select <strong>Apply equally</strong> to assign that reinvestment percentage to every enabled holding in the strategy.</li>
        <li><strong>Clear</strong> — Removes every holding from that side and returns it to manual ticker-building mode.</li>
        <li><strong>Row checkbox</strong> — Includes or excludes one holding without deleting it. The × button permanently removes that ticker from the strategy list.</li>
        <li><strong>Weight</strong> — Controls how much of the strategy is assigned to that holding. Only enabled holdings with positive weights enter the simulation.</li>
        <li><strong>Current yield</strong> — Shows the security's current annualized distribution yield. Forward payout stress and yield ceilings may prevent an unusually high current yield from compounding indefinitely.</li>
        <li><strong>DRIP</strong> — Controls the percentage of that holding&apos;s distributions that buys additional shares of the same holding. The remainder stays as cash at a modeled 0% return, so it remains part of wealth without receiving an unrequested growth assumption.</li>
        <li><strong>Fund type</strong> — Replaces automatic classification for a holding when you know its role more accurately, such as Growth / non-income equity, diversified option income, bonds, or commodities.</li>
        <li><strong>Option structure</strong> — Identifies covered calls, short puts, short put spreads, protective put spreads, collars/buffers, or mixed options. Auto uses available fund metadata and name clues; an unspecified put spread deliberately receives no directional tail adjustment.</li>
        <li><strong>Correlation group</strong> — Identifies the shared underlying exposure used when market history is short, such as S&amp;P 500, Nasdaq, semiconductors, bonds, gold, or crypto. Auto uses the holding's metadata and description.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>3. Enter the Shared Comparison Assumptions</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        These settings are deliberately shared so neither strategy receives a capital or contribution
        advantage.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Starting capital per strategy</strong> — The amount invested in each strategy at month zero. If it is $100,000, both Strategy A and Strategy B start with $100,000.</li>
        <li><strong>Monthly contribution per strategy</strong> — New money added separately to each strategy every month. Contributions follow the strategy's target weights and include growth holdings that pay no distributions.</li>
        <li><strong>Inflation</strong> — The assumed annual inflation rate. It converts nominal future dollars into real, today's-dollar results.</li>
        <li><strong>Freedom target</strong> — The desired monthly income or spending capacity in today's dollars. A $5,000 target means $60,000 per year of real purchasing power.</li>
        <li><strong>Estimated annual spending rate</strong> — Converts the real ending balance into an estimated annual spending capacity. For example, a 4% rate on a $1,000,000 real balance equals $40,000 per year, or about $3,333 per month. This is a reporting metric; no shares are sold and no money is withdrawn during the run.</li>
        <li><strong>Monte Carlo paths</strong> — The number of simulated market paths per scenario. 300 is faster, 500 is the standard setting, and 1,000 gives steadier percentile and probability estimates at the cost of additional run time.</li>
        <li><strong>Add a combined strategy</strong> — Adds a third result made by blending Strategies A and B. The slider controls the percentage assigned to each side, and the combined holdings are normalized before simulation.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Optional: Sustainability Tests</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A spectacular headline yield can beat a growth portfolio on a simple &quot;does income reach my
        target&quot; check even when that yield isn&apos;t realistic. Sustainability tests gate the
        <strong> Sustainable Freedom</strong> winner (see below) on whether the projected income would
        actually hold up. Toggle any combination — each one narrows the probability independently, and a
        strategy only counts as achieving Sustainable Freedom in a given simulated path if every enabled
        test passes.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Income after estimated taxes</strong> — Off by default. When enabled, projected income is haircut by a single blended tax rate (suggested 15%, editable 0–100%) before checking it against the Freedom target.</li>
        <li><strong>Payout limited by sustainable total return</strong> — Caps the income counted toward the target at the strategy's blended expected total return. Distribution yield above that implies the fund is returning capital (eroding NAV) rather than paying real income.</li>
        <li><strong>Capital stays stable after stopping DRIP</strong> — Runs a side simulation where distributions are taken as cash instead of reinvested (new contributions still buy shares). Reports the probability that ending principal still covers everything invested.</li>
        <li><strong>Dedicated withdrawal-phase simulation</strong> — Appends the chosen number of extra years (1–40, default 20) after the accumulation horizon and actually withdraws the Freedom target each month — funded by distributions first, then share sales — to see whether principal survives or depletes.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>4. Run the Comparison</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The line above <strong>Run comparison</strong> confirms the selected years, number of competing
        strategies, and three market scenarios. The button remains unavailable until both main
        strategies contain at least one enabled ticker with a positive weight. Selecting it calibrates
        the holdings and runs Bull, Neutral, and Bear simulations.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker capacity</strong> — Each strategy supports up to 250 unique tickers, allowing large aggregate accounts and blended portfolios.</li>
        <li><strong>Large-run handling</strong> — Memory use grows with unique tickers × simulation months × Monte Carlo paths. Normal runs stay in memory; larger runs automatically use a temporary disk-backed return matrix and clean it up after each market scenario. Large portfolios can therefore run without an arbitrary ticker-path ceiling, although they may take longer.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How the Simulation Works</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Every run generates correlated monthly return paths. Pairwise correlations are estimated from
        overlapping total-return history, then blended with conservative underlying-group fallbacks when
        history is short. Bear scenarios raise correlations among risk assets to reflect the way
        diversification often weakens during stress. Each holding retains its own expected return,
        volatility, payout behavior, classification, option structure, and underlying group. Available
        history is blended with longer-term assumptions so a short or unusually strong record does not
        dominate a long projection.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Neutral</strong> — Blends historical market behavior with forward strategy assumptions and represents the central long-run case.</li>
        <li><strong>Bull</strong> — Applies expansionary early conditions and then gradually fades toward the neutral assumptions.</li>
        <li><strong>Bear</strong> — Applies an early negative shock and elevated volatility, followed by recovery and a gradual return toward neutral conditions.</li>
        <li><strong>Configurable DRIP</strong> — Each holding can reinvest 0–100% of its distribution. A bulk control applies one rate equally to all active holdings; individual rows can then be adjusted. Blended strategies use an exposure-weighted DRIP rate when the same ticker appears on both sides.</li>
        <li><strong>Growth holdings can produce income</strong> — Strategy style never discards a dividend. If a growth ETF or stock pays a distribution, the model records it as income and applies that holding&apos;s selected DRIP rate.</li>
        <li><strong>No double counting</strong> — Total return already contains the economic value of distributions. The engine separates price movement from the cash payout, reinvests only the selected portion, retains the remainder as cash, and never adds the same return twice.</li>
        <li><strong>Contributions</strong> — Monthly deposits are invested after that month's return and distribution processing, following the target weights.</li>
        <li><strong>Payout realism</strong> — Option-income funds use a NAV-linked distribution-rate model, so a stable 10% target remains approximately 10% of NAV instead of becoming an independently compounding per-share payout. Dividend-growth holdings use per-share distribution growth, while pure-growth holdings remain return-driven. Strategy-specific payout stress and yield ceilings keep extreme rates from creating an unrealistic share-count spiral.</li>
        <li><strong>Fund type detection</strong> — Known option-income, dividend-growth, and growth tickers are classified automatically. Use the per-holding Fund type menu only when the detected type needs correction.</li>
        <li><strong>Common random conditions</strong> — Both sides experience the same simulated market environment, so differences come from their holdings and weights rather than one side receiving luckier random paths.</li>
        <li><strong>No volatility return bonus</strong> — Expected total return is treated as an arithmetic expectation. The lognormal path drift includes the variance correction, so higher volatility widens the result range instead of manufacturing additional average return.</li>
        <li><strong>Limited-history uncertainty</strong> — Holdings with less than five years of history receive progressively wider forecast volatility. The Data quality panel flags short records, and the assumptions table shows both base and forecast volatility plus history confidence.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/growth-income-freedom/02-sustainability-tests-and-winners.jpg"
          alt="Growth and Income Freedom Simulator showing the shared assumptions with all four Sustainability tests enabled, the Bull Neutral and Bear winner overview cards, and the Wealth, Income, and Sustainable Freedom winner cards for the selected scenario"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>5. Read the Bull, Neutral, and Bear Winner Cards</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Each scenario card uses plain-language sentences to explain retirement readiness, the highest ending portfolio value, the highest monthly income, and sustainable-retirement success. When no strategy qualifies, the card says so directly instead of displaying a misleading tie. The rows below still show each strategy's median real ending value and real monthly distribution income.</li>
        <li>Values are in today's dollars after inflation. They are medians across the simulated paths, not guaranteed outcomes.</li>
        <li>Select a Bull, Neutral, or Bear card to open that scenario in the detailed results below.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How the Three Winners Work</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The selected scenario always shows three winner cards side by side instead of one goal you have
        to pick from a dropdown:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Wealth</strong> — Selects the strategy with the highest median inflation-adjusted ending portfolio value.</li>
        <li><strong>Income</strong> — Selects the strategy with the highest median inflation-adjusted monthly distribution run rate at the final year.</li>
        <li><strong>Sustainable Freedom</strong> — Uses the percentage of paths whose ending organic income or estimated spending capacity reaches the monthly Freedom target, <em>and</em> passes every Sustainability test currently enabled (see above). With no sustainability tests enabled, this is identical to a simple income-or-spending target check.</li>
        <li><strong>Ties</strong> — Probabilities within 0.5 percentage point, or dollar results within approximately 0.5%, are declared an effective tie instead of forcing a false winner.</li>
        <li><strong>Overall scenario lead</strong> — Each card reports how many of the three market scenarios that strategy wins under its own metric.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/growth-income-freedom/03-strategy-metrics-and-charts.jpg"
          alt="Growth and Income Freedom strategy result cards showing real ending value, income, drawdown, target probabilities, and Sustainability detail, followed by the real portfolio value and real monthly distribution income charts"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>6. Read the Projected Income and Strategy Cards</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Projected monthly and annual income</strong> — Median distribution run rates at the selected final year, shown in today's purchasing power.</li>
        <li><strong>P10–P90 monthly income range</strong> — The middle 80% planning range: 10% of paths finish below P10 and 10% finish above P90.</li>
        <li><strong>Nominal income</strong> — The future-dollar amount before removing inflation. Real income is lower because it reflects future purchasing power in today's dollars.</li>
        <li><strong>Real ending value · P10–P90</strong> — Shows the median real ending balance prominently, with the downside P10 and upside P90 values beneath it.</li>
        <li><strong>Real monthly income</strong> — The distribution income the ending shares could be producing each month. It is measured while DRIP remains on; it is not withdrawn.</li>
        <li><strong>Real spending capacity</strong> — Real ending value × annual spending rate ÷ 12. It is a comparison estimate only and does not reduce the simulated portfolio.</li>
        <li><strong>Median max drawdown</strong> — The median of each path's worst flow-adjusted peak-to-trough decline. Contributions are removed from the drawdown calculation so deposits cannot hide market losses.</li>
        <li><strong>Distributions reinvested</strong> — Cumulative cash distributions generated and reinvested during the run. It can be large because it totals every payout over time; it is not added on top of total return a second time.</li>
        <li><strong>Organic income target</strong> — The percentage of paths whose final real annual distribution income is at least 12 times the monthly Freedom target. It requires no spending-rate calculation or share sales.</li>
        <li><strong>Spending target</strong> — The percentage of paths whose final real balance, multiplied by the selected spending rate, can support the annual Freedom target.</li>
        <li><strong>Sustainable freedom</strong> — Same as the Organic income / Spending target check, but also requires every enabled Sustainability test to pass. Equals the higher of the other two when no tests are enabled.</li>
        <li><strong>Not reached by the median path</strong> — The P50 income or spending-capacity path does not reach the target within the selected years. A probability can still be above zero because some stronger paths succeeded.</li>
        <li><strong>Sustainability detail</strong> — Appears on a strategy card only when at least one Sustainability test is enabled. <strong>Sustainability-adjusted income</strong> shows income after the enabled tax/payout-cap tests; <strong>Payout vs. total return</strong> flags when distribution yield exceeds the strategy's blended expected total return (implying NAV erosion); <strong>Capital stability without DRIP</strong> is the probability principal still covers everything invested after taking all distributions as cash instead of reinvesting; <strong>Withdrawal-phase survival</strong> is the probability principal doesn't run out during the extra withdrawal years while actually funding the Freedom target.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>7. Read the Charts and Finish-Line Table</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Real portfolio value chart</strong> — Plots each strategy's median inflation-adjusted value from Year 0 through the selected final year. The shaded band is the 10th-to-90th percentile range.</li>
        <li><strong>Real monthly distribution income chart</strong> — Plots the median monthly income run rate in today's dollars at each year-end while all distributions continue to be reinvested.</li>
        <li><strong>All scenarios at the finish line</strong> — Places Bull, Neutral, and Bear medians in one table for direct comparison of ending value, monthly income, monthly spending capacity, drawdown, and organic-income target probability.</li>
        <li><strong>Scenario colors</strong> — Green identifies Bull, amber identifies Neutral, and red identifies Bear. Strategy name colors match the strategy cards and chart lines.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/growth-income-freedom/04-scenario-finish-line-table.jpg"
          alt="Growth and Income Freedom all-scenarios finish-line table comparing Bull, Neutral, and Bear real ending value, income, spending, drawdown, and income target chance for each strategy"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Quality and Holding Assumptions</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Data quality and fallback notes</strong> — Appears when a ticker has limited history or requires a classification-based fallback. Incomplete launch years and the current partial year are excluded from per-share distribution-growth calibration. Review these warnings before relying heavily on a comparison.</li>
        <li><strong>Correlation model</strong> — Reports average normal and bear-stressed correlation, how many ticker pairs use overlapping history versus conservative fallbacks, and the strongest modeled relationships.</li>
        <li><strong>Holding assumptions used in this run</strong> — Expands into an audit table containing modeled behavior, option structure, correlation group, current yield, expected total return, forecast volatility, average correlation, beta, sustainable yield ceiling, and history confidence for every ticker.</li>
        <li>A ticker with little or no history can still run using its security classification, but its estimate contains more model uncertainty than a holding with a long history.</li>
        <li>Current yields and prices are starting inputs, not promises that distributions or market values will remain unchanged.</li>
      </ul>

      <div className="alert alert-info">
        <strong>Important:</strong> these are hypothetical planning ranges, not forecasts, tax advice,
        or guarantees. Monte Carlo probabilities describe the model under its assumptions. A strategy
        can lead on income while another leads on median wealth or downside resilience, and changing
        the horizon, contribution, inflation, target, spending rate, holdings, or weights can change
        the result materially.
      </div>
    </div>
  )
}

function CashFlowHelp() {
  return (
    <div>
      <h2>Cash Flow &amp; Sustainability</h2>
      <p style={{ marginBottom: '1rem' }}>
        Cash Flow &amp; Sustainability is the monthly planning page for matching your bills against portfolio
        distributions and any additional income you save in the app. It lets you track when bills are due,
        when you want to pay them, what has already been paid, and whether the selected portfolio can keep
        covering those bills over time.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/cash-flow/cash-flow-overview.png"
          alt="Cash Flow and Sustainability page showing monthly summary cards, expenses table with due date and pay by columns, and additional income section"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>What the top section shows</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>View month</strong> - choose the month you want to review. Totals, due dates, pay-by dates, and paid status all reflect that month.</li>
        <li><strong>Expenses This Month</strong> - total of active bills scheduled for the selected month.</li>
        <li><strong>Portfolio Income (Gross / After Tax)</strong> - the selected account or aggregate portfolio's current monthly distributions before and after the portfolio-income tax assumption.</li>
        <li><strong>Additional Income</strong> - non-portfolio income you entered here, such as Social Security, pension, or rental income.</li>
        <li><strong>Leftover cards</strong> - how much remains after bills, first before tax and then after the portfolio tax setting.</li>
        <li><strong>Status banner</strong> - quickly tells you whether the selected month's bills are covered and how much portfolio-only funding is needed.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Managing expenses</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Add expense</strong> - enter the bill name, amount, frequency, and optional category, then open the dates and notes area for the schedule details.</li>
        <li><strong>Active from</strong> - the first month the bill should begin appearing.</li>
        <li><strong>Due date</strong> - the date the bill is due. This is fully editable.</li>
        <li><strong>Pay by</strong> - defaults to 2 days before the due date, but you can edit it to whatever reminder date you prefer.</li>
        <li><strong>Stop after</strong> - optional end date if the bill should stop automatically after a specific month.</li>
        <li><strong>Paid checkbox</strong> - tracks whether that bill occurrence has been paid. It follows the bill's due occurrence instead of blindly clearing at every month change.</li>
      </ul>

      <p style={{ marginBottom: '0.75rem' }}>
        Each expense row also includes actions for <strong>Edit</strong>, <strong>Move</strong>, <strong>Save off</strong>, and
        <strong> Delete</strong>. <strong>Move</strong> transfers the saved item to another individual account or an aggregate account.
        <strong> Save off</strong> keeps the bill in history but removes it from active monthly totals until you restore it.
      </p>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>Why pay dates matter:</strong> some bills are due at the beginning of a month but get paid near the end of the prior month.
        The separate <strong>Due date</strong> and <strong>Pay by</strong> fields are there so you can track both the real bill deadline and
        your own payment timing.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Managing additional income</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Add income</strong> - save outside income sources like Social Security, pension, salary, or rent.</li>
        <li><strong>Tax %</strong> - each income item can carry its own tax treatment, separate from the portfolio-income tax assumption.</li>
        <li><strong>Move</strong> - transfers the saved income source to another account or aggregate when you want that income tied somewhere else.</li>
        <li><strong>Save off</strong> - archives the income source without deleting it so it can be restored later.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Backing up and restoring your plan</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Everything you type on this page is stored only in this app&apos;s database, so the
        <strong> Save or restore this plan</strong> section lets you keep your own copy of it.
        Exports and imports always apply to the plan for the currently selected account or aggregate.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Download backup (.json)</strong> - the complete plan: every expense and additional-income entry, saved-off entries, paid checkmarks, per-month amount edits, and the saved assumptions. Use this file to restore the plan exactly.</li>
        <li><strong>Download spreadsheet (.csv)</strong> - the same entries in a spreadsheet you can open in Excel to review or bulk edit. It holds entries only; paid history and assumptions are not included.</li>
        <li><strong>Due date (recurring) vs Next due</strong> - the spreadsheet has both. <strong>Due date (recurring)</strong> and <strong>Pay by (recurring)</strong> are the dates the bill&apos;s schedule is anchored to, which is what gets saved and restored. <strong>Next due</strong> is the upcoming occurrence as of the moment you exported the file - the same date the expenses table shows - and it is there for reading only. Editing it has no effect on import.</li>
        <li><strong>Add to this plan</strong> - loads the file alongside what is already saved. An entry that matches one already in the plan (same type, name, frequency, amount, and start date) is skipped instead of duplicated.</li>
        <li><strong>Replace everything</strong> - deletes the plan&apos;s current entries, paid history, and per-month edits, then loads the file. A .json backup also restores the saved assumptions. You are asked to confirm first.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        A hand-edited CSV works too, as long as it has <strong>Type</strong>, <strong>Name</strong>, and <strong>Amount</strong> columns.
        Extra columns are matched by their headings, dollar signs and commas in amounts are fine, and dates can be written either
        as 2026-08-15 or 8/15/2026. Any row the importer cannot read is listed by line number and <strong>nothing at all is imported</strong>,
        so a restore never leaves a half-loaded plan behind.
      </p>
      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>Borrowed plans:</strong> if this account borrows its bills and income from another selection, those entries are read-only here.
        You can still download a backup of what is being modelled, but importing has to be done from the selection that owns the entries.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Running the sustainability test</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Forward Stress Test section projects whether the selected portfolio can continue paying your bills for the chosen horizon.
        You can save assumptions and run scenarios both <strong>with</strong> and <strong>without</strong> your additional income.
      </p>

      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Horizon</strong> - number of years to project.</li>
        <li><strong>Expense inflation</strong> - how quickly bills grow over time.</li>
        <li><strong>Portfolio income tax</strong> - tax rate applied to portfolio distributions in the cash-flow model.</li>
        <li><strong>Starting cash reserve</strong> - extra cash available before the model would ever need to sell shares.</li>
        <li><strong>Unused income after bills</strong> - controls what the model does with surplus cash, such as reinvesting it into more shares.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/cash-flow/cash-flow-sustainability-results.png"
          alt="Cash Flow and Sustainability forward stress test showing the assumptions area, explanation panel, and bull neutral bear scenario results"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How to read the scenario table</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Bull / Neutral / Bear</strong> - the model tests positive, moderate, and negative market paths.</li>
        <li><strong>Portfolio + Additional Income</strong> - includes the saved outside-income entries.</li>
        <li><strong>Portfolio Distributions Only</strong> - excludes all additional-income entries so you can see what the portfolio alone can support.</li>
        <li><strong>All bills covered by income</strong> - distributions and allowed income covered every projected bill without selling shares.</li>
        <li><strong>Some shares must be sold</strong> - bills were larger than available income and reserve cash in that scenario, so the model had to draw on principal.</li>
        <li><strong>Portfolio value after X years</strong> - projected ending account value.</li>
        <li><strong>Portfolio growth</strong> - dollar change between the starting and ending portfolio value.</li>
        <li><strong>Final distributions</strong> - projected monthly and yearly gross income being generated at the end of the test.</li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>How this model works:</strong> it uses the selected portfolio's current distribution yield as the income starting point, changes
        distributions separately from market value, and reinvests surplus cash when you choose a reinvestment option. That is why the final
        income can rise even when the market path is uneven.
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/cash-flow/cash-flow-projected-balance-chart.png"
          alt="Projected Portfolio Balance chart comparing bull neutral and bear scenarios with and without additional income"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Projected balance chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The line chart shows the portfolio path over time for all six scenario combinations: bull, neutral, and bear, each with and without
        additional income. Solid lines include additional income. Dotted lines show portfolio-only results. Hover any year to compare the
        projected balances side by side.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Saved-off items and transfers</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Saved expenses</strong> and <strong>Saved additional income</strong> sections keep archived items out of the active monthly plan.</li>
        <li><strong>Restore</strong> brings a saved-off item back into the current plan.</li>
        <li><strong>Delete</strong> permanently removes it.</li>
        <li><strong>Move</strong> preserves the same saved item while changing which account or aggregate owns it.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Suggested workflow</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Pick the month you want to plan.</li>
        <li>Add or update all recurring bills, including due date and pay-by date.</li>
        <li>Mark bills paid as you work through the month.</li>
        <li>Add outside income sources that should count toward bill coverage.</li>
        <li>Set your stress assumptions and choose what to do with leftover income.</li>
        <li>Run the sustainability test and compare the with-income and portfolio-only columns.</li>
      </ol>
    </div>
  )
}

function DividendCalculatorHelp() {
  return (
    <div>
      <h2>Dividend Calculator</h2>
      <p style={{ marginBottom: '1rem' }}>
        Project income and portfolio growth over time across one or more ETFs and stocks, with or without
        dividend reinvestment (DRIP). Unlike the Income Growth Simulator (which uses your actual portfolio),
        the Dividend Calculator works from any tickers you enter — useful for evaluating new positions, comparing
        funds side-by-side, or modeling what-if scenarios before you buy.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        After at least one ticker loads, the <strong>Current payout</strong> bubble at the top of the page shows
        the selected tickers' present gross monthly and annual distribution run-rate. It updates with current
        value, shares, price, and yield edits, and does not include taxes, DRIP, growth, or future contributions.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        After you click <strong>Calculate</strong> or <strong>Recalculate</strong>, four result bubbles appear at
        the top: <strong>Total Income</strong> is cumulative gross dividend income over the full projection,
        while <strong>Monthly Income</strong> and <strong>Annual Income</strong> are the combined income run-rates
        at the final projection year. <strong>Portfolio Value</strong> is the combined value of invested holdings
        at the final year and excludes cash dividends that are included separately in Ending Wealth. If inputs
        change, the bubbles are marked as last-calculated values until the next recalculation.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/dividend-calculator/dividend-calculator-overview.png" alt="Dividend Calculator current payout, final-year income bubbles, monthly contribution schedule, limited contribution window, and custom allocation settings" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Calculation Settings</h3>
      <p style={{ marginBottom: '0.5rem' }}>
        Set your global assumptions once at the top of the page. These apply to every ticker you add and can be
        adjusted at any time — the projection updates when you click <strong>Recalculate</strong>.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Years to Invest</strong> — Length of the projection (1–50 years).</li>
        <li><strong>Initial Investment Per Ticker</strong> — Starting dollar amount applied to each ticker. Updating this value re-derives the share count for any already-loaded tickers.</li>
        <li><strong>Contribution Schedule</strong> — Choose Annual or Monthly. The choices are mutually exclusive, so the calculator never applies both contribution schedules at once. Annual totals are divided across each ticker's payout periods, while monthly contributions are deposited at each month-end. Switching schedules converts the current total to its equivalent annual or monthly amount.</li>
        <li><strong>Contribution Total</strong> — Total new dollars added per selected period. This is also the dollar base used for every ticker's allocation percentage.</li>
        <li><strong>Contribution Window</strong> — Choose Full period to contribute throughout the projection, or Limited to stop new contributions after the first X years or months. For example, $300 monthly for 2 years in a 10-year projection contributes $7,200 during the first 24 months, then projects the remaining 8 years using DRIP and growth without additional cash deposits.</li>
        <li><strong>Contribution Allocation</strong> — Allocates the selected contribution total by an even percentage split, by each ticker's current or starting value, or by custom per-ticker percentages. It does not change the initial investment.</li>
        <li><strong>Dividend Tax Rate</strong> — Applied to taxable dividends each period. The Return of Capital % on each ticker reduces the taxable portion.</li>
        <li><strong>Stock Price Growth (All Tickers)</strong> — Default annual price appreciation applied to every ticker. You can override this per ticker after it loads.</li>
        <li><strong>Dividends Reinvested (DRIP)</strong> — Percentage of net dividends reinvested each period (0–100%). Anything not reinvested is tracked as cash dividends.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        In custom allocation mode, every ticker can have a different percentage. The percentages refer to the
        selected annual or monthly contribution total, not to the starting portfolio value. The dollar contribution
        and percentage fields stay synchronized, and an even split assigns <strong>100% ÷ ticker count</strong> to
        each ticker automatically. In <strong>Custom percentages</strong> mode, use <strong>Split percentages
        evenly</strong> to create an editable equal-percentage starting point. When the contribution total is $0,
        every Contribution Allocation % displays 0% and percentage editing is disabled. This does not change the
        separate DRIP percentage, which controls dividend reinvestment. Changing one ticker's custom percentage
        automatically redistributes the remaining percentage proportionally across the other tickers so the total
        allocation remains 100%. Removing a ticker also renormalizes the remaining allocations to 100%. After an
        edit, the Allocation Adjustment Summary shows the edited ticker, confirms Total allocation: 100.00%, and
        provides an expandable list of every ticker's before-and-after percentage.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/dividend-calculator/dividend-calculator-contributions.png" alt="Dividend Calculator ticker cards showing a custom 60 percent and 40 percent monthly contribution allocation" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Adding Tickers</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Type a symbol (e.g. <code>SCHD</code>, <code>JEPI</code>, <code>AAPL</code>) into the ticker bar and click
        <strong> Add Ticker</strong>. The app fetches current price, dividend yield, dividend growth rate, and
        payout frequency from Yahoo Finance, then auto-fills the row. Add as many tickers as you like — the
        selected contribution allocation is applied across them and final results are aggregated.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Each ticker becomes its own card with editable fields. Click the <strong>x</strong> on a chip or the
        <strong> Remove</strong> button on the card to drop a ticker. <strong>Reset</strong> clears everything
        back to defaults.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Per-Ticker Inputs</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Initial Investment / Stock Price / Number of Shares</strong> — These three fields stay in sync. Editing any one of them recomputes the others. Override the share count or price if you want to model a position different from the live market.</li>
        <li><strong>Initial Dividend Yield</strong> — Annual yield based on the trailing distribution. Drives the first-year income.</li>
        <li><strong>Dividend Growth</strong> — Annual percentage increase applied to the dividend per share each year. Auto-filled from Yahoo's historical growth rate; override based on your own expectations.</li>
        <li><strong>Return of Capital</strong> — Percentage of distributions that aren't taxable income (common for covered-call ETFs and some MLPs). Reduces the dividend tax drag without affecting cash flow.</li>
        <li><strong>Stock Price Growth</strong> — Per-ticker price appreciation. Defaults to the global setting but can be tuned individually.</li>
        <li><strong>Payout Frequency</strong> — 0, Weekly, Monthly, Quarterly, Semi-Annually, or Annually. AOTS defaults to 0 payouts because it currently has no dividend, but its frequency remains editable. Other tickers retain their detected/default frequency. Selecting another AOTS frequency does not create dividend income while its yield is still 0%. Annual or monthly cash contributions continue buying shares independently of dividend payouts.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Running the Calculation</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Click <strong>Calculate</strong> to project results. Whenever inputs change after a calculation, a
        <strong> Needs recalculation</strong> badge appears next to the settings card and a banner above the
        results — click <strong>Recalculate</strong> to refresh. Inputs are stored locally in the page; nothing
        is saved to the database.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Summary Stats</strong> — Ending Wealth (final portfolio value plus uncollected cash dividends), Annual / Monthly Dividend Income at the final year, Yield on Cost, and total Estimated Dividend Taxes after Return of Capital adjustments.</li>
        <li><strong>Portfolio &amp; Income Chart</strong> — Combined view of portfolio value (filled area), cumulative dividends, and annual income on a secondary axis.</li>
        <li><strong>Shares Over Time</strong> — One line per ticker when multiple are loaded, or a single line for one ticker. Shows how DRIP grows your share count year by year.</li>
        <li><strong>Year-by-Year Breakdown</strong> — Detailed table with shares, portfolio value, gross/net dividends, taxes, reinvested vs. cash dividends, and cumulative contributions per year. With a limited contribution window, cumulative contributions stop increasing after the selected final contribution month.</li>
        <li><strong>Per-Ticker Final Values</strong> — When two or more tickers are loaded, an additional table places Initial Shares immediately before Final Shares and shows Share Delta as Final Shares minus Initial Shares. It then compares portfolio value, income, taxes, and dividends. Useful for seeing share growth and picking between candidates.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/dividend-calculator/dividend-calculator-results.png" alt="Dividend Calculator results summary with ending wealth, final income, yield on cost, portfolio and income chart, and shares over time" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How DRIP Compounds</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each period the model: (1) pays the gross dividend on current shares, (2) subtracts taxes on the taxable
        portion (gross x (1 - ROC%) x tax rate), (3) splits the net dividend between reinvested and cash based
        on the DRIP %, (4) adds that period's annual-contribution slice, (5) buys new shares with the combined
        cash at the current price, and (6) grows the price and dividend per share to the next period. Higher
        payout frequencies, higher dividend growth, and lower taxes all amplify long-run compounding.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tips</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Use the per-ticker comparison table to evaluate two or more funds with similar yields but different growth or ROC profiles.</li>
        <li>Set DRIP to 0% to model income-now scenarios (retirement) and 100% to model accumulation phases.</li>
        <li>Bump the Dividend Tax Rate to 0% to preview tax-advantaged accounts (IRA, Roth, HSA) and back to your marginal rate for taxable accounts.</li>
        <li>For high-yield covered-call ETFs (JEPI, JEPQ, QQQI, SPYI, etc.), check the fund's distribution classification — many report a meaningful ROC %, which substantially lowers the projected tax drag.</li>
      </ul>
    </div>
  )
}

function OptionsHelp() {
  const imageStyle = {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
    border: '1px solid var(--p-333)',
  }

  return (
    <div>
      <h2>Options Strategy Laboratory</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Options page is an educational modeling workspace for building simulated positions and studying how
        price, time, volatility, and strike selection affect an options strategy. It uses live or delayed market
        data for the underlying and available option chains, but it does not place or route orders.
      </p>
      <div className="alert alert-warning" style={{ marginBottom: '1.25rem' }}>
        <strong>Modeled results only:</strong> quotes can be delayed or incomplete, and theoretical values exclude
        some real-world effects such as commissions unless entered, early assignment behavior, taxes, and execution
        differences. Treat every result as an educational estimate rather than investment advice.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Simulated Trade</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Enter an underlying symbol and load its option chain. Expand an expiration, then click an ask to model a buy
        or a bid to model a sale. The column picker can show basic pricing, Greeks, liquidity, or all available
        columns. Each selection immediately appears in the Selected strikes box and in the position table below.
        With broker text entered, <strong>Build risk graph</strong> imports those lines; with selected chain legs and
        no broker text, <strong>Open risk graph</strong> uses the current position directly. You can also use quick
        learning templates, add stock coverage, edit quantities and strikes, and save a scenario for later analysis.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/options/options-simulated-trade.png" alt="Options Simulated Trade workspace with SPY quote, broker trade import, expiration browser, and option-chain controls" style={imageStyle} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Risk Profile</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Risk Profile combines every active stock, call, and put leg into one profit-and-loss graph. Move the analysis
        date forward, move the <strong>Vol surface</strong> bar, widen the displayed price range, and compare the
        open-position curve with expiration payoff. Summary cards show entry debit or credit, theoretical maximum profit and loss,
        breakevens, and portfolio Greeks. Probability shading and draggable strike handles make it easier to test
        how the structure changes.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Choose <strong>Add from option chain</strong> without leaving Risk Profile to build on a scanner trade or any
        simulated position. Every listed expiration is available with its DTE; select <strong>All strikes</strong> for
        far-out-of-the-money contracts. The Expiration / DTE selector includes every listed weekly, monthly, and LEAP;
        choose any one, then click an ask to add a bought leg or a bid to add a sold leg. You can open
        another expiration and keep adding legs, so the same graph can model calendars, diagonals, near-term trades
        with longer-dated protection, and other mixed-expiration positions. The scanner return controls stay visible
        while you edit the trade or replace a leg from its Chain button.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The volatility bar applies a proportional scenario to each leg&rsquo;s own modeled IV instead of forcing every
        strike to the same volatility. For example, a <strong>+10%</strong> surface move changes 20%, 25%, and 32% IV
        legs to 22%, 27.5%, and 35.2%. That preserves the position&rsquo;s current strike skew and expiration differences
        while every leg, Greek, probability, and pre-expiration P/L curve is repriced. It is a risk scenario, not a
        forecast of how the live volatility surface will move.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>
        The <strong>Volatility scenario</strong> panel below the main controls extends that parallel move without
        changing any selected strike or quantity:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Downside skew change</strong> is entered in volatility points per 10% move below spot. A positive value steepens downside skew by adding more IV to lower strikes and less—or negative—IV to higher strikes. A negative value flattens or reverses that incremental skew.</li>
        <li><strong>Apply crash-vol spike</strong> combines a +50% parallel surface shock with a modest +2 volatility-point steepening per 10% lower strike. This makes the far-downside hedge puts respond more strongly than a parallel-only scenario while keeping both assumptions visible and editable.</li>
        <li><strong>Expiration-specific IV change</strong> adds or subtracts volatility points only from the named expiration after the parallel and skew changes. Mixed-expiration trades therefore can model a near-term event crush without forcing the back month to fall by the same amount.</li>
        <li><strong>Sticky strike</strong> keeps each contract&rsquo;s final modeled IV fixed as the risk chart sweeps underlying prices. This is the conservative, transparent default and matches the earlier risk-profile behavior.</li>
        <li><strong>Sticky delta</strong> moves the modeled surface with the underlying. A fixed strike samples a different point on the position&rsquo;s modeled skew as its moneyness changes. The slope is estimated separately from the modeled legs in each expiration; an expiration with fewer than two distinct strikes safely falls back to sticky strike.</li>
        <li><strong>Per-leg reconciliation</strong> shows market IV, the result after any manual leg adjustment, and the separate parallel, skew, and term contributions before the final modeled IV. The bubble cards repeat the active assumptions, and <strong>Reset to current surface</strong> clears every scenario change.</li>
      </ul>
      <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
        The current chain supplies the ticker-specific starting surface. The scenario controls are explicit manual
        assumptions, not a calibration from historical option surfaces. Historical stock prices alone cannot
        reconstruct past implied-volatility skew or term structure.
      </div>
      <p style={{ marginBottom: '0.75rem' }}>
        Scanner handoffs prefer live two-sided quotes. When the data feed clears bid/ask outside market hours, every
        option scanner may keep the risk graph available from a recent traded price with a prominent estimate warning.
        Bid/ask-dependent values such as natural credit and slippage are then left blank, and multi-leg structures stay
        in the research/watchlist group rather than being labeled actionable. Always refresh and verify every live leg
        before placing an order.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Use <strong>Zoom</strong> and drag over the graph to inspect a narrower underlying-price region, or choose
        <strong> Pan</strong> and drag the plot left or right through the visible prices. The mouse wheel and the
        <strong> +</strong>/<strong>−</strong> buttons change only the price axis; the profit/loss height stays locked so
        the upper and lower curves remain visible. <strong>Fit</strong> or a double-click restores the full price range.
        <strong> Expand</strong> opens a larger
        window-level graph; choose <strong>Contract</strong> or press Escape to return it to the page. These view
        controls do not change the position or its calculations. Moving the analysis-date slider keeps the current
        graph visible while every leg is repriced, then updates the curves in place without blanking the chart. The
        full profit/loss range stays fixed while time moves so the plot does not jump vertically; <strong>Fit</strong>
        restores that complete fixed range after manual zooming or panning. Opening the expanded view also restores
        safe padding above the highest payoff and below the lowest loss so neither edge is clipped by an earlier zoom.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/options/options-risk-profile.png" alt="Options Risk Profile controls showing the analysis-date and proportional Vol surface bars, probability settings, and modeled scenario inputs" style={imageStyle} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Price &amp; Moneyness</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        This view places every active option strike over the underlying's recent price history. The cards identify
        each leg as in, at, or out of the money and show its distance from the current price. Switch between line
        and candlestick charts or change the lookback period to see how close the position has been to its strikes.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/options/options-price-moneyness-staggered.png" alt="SPY candlestick chart with staggered option strike labels, moneyness lines, and the simulated position table" style={imageStyle} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Greek Surfaces</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Greek Surfaces graphs a single contract or the signed exposure of an entire multi-leg position. Choose a
        first- or higher-order Greek, then compare its 2D price or time profile with the 3D price-and-time surface.
        The relationship view shows how second-order Greeks such as Gamma, Vanna, Charm, Vomma, Speed, Color, and
        Zomma change a linked first-order Greek. The linked risk graph uses the same traced price and elapsed-time
        scenario.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/options/options-greek-surfaces.png" alt="Options Greek Surfaces showing the signed Gamma profile, 3D price-and-time surface, and linked risk graph for an iron condor" style={imageStyle} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Backtest</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Backtest runs a modeled historical replay of continuously rolled same-expiration strategies. Choose a
        built-in or saved strategy, date range, capital allocation, target DTE, strike rules, pricing model,
        volatility index, commissions, and slippage. Results compare the strategy with dividend-reinvested buy and
        hold, provide lower- and higher-volatility sensitivity cases, and retain a cycle-level audit trail.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Historical option quotes are not used. The model reconstructs contracts from underlying history,
        volatility assumptions, a listed-style strike grid, and the configured fills, so the comparison is useful
        for learning and sensitivity testing rather than proof of executable historical performance.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/options/options-backtest.png" alt="Options Backtest results comparing an SPY iron condor with buy and hold, including metrics, equity curve, sensitivity tabs, and cycle audit trail" style={imageStyle} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Reading the probability blocks</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A trade opened from a scanner carries two probability blocks. They answer different questions, and reading one
        as though it were the other is the most common way to misjudge the analysis.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Probability of success</strong> is the chance the complete position can be closed for more than $0 at one
        specific moment. The headline figure is expiration; each management checkpoint beneath it is the same calculation
        run at that earlier date.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Those checkpoints read lower than the expiration figure, and that is correct.</strong> Exiting early feels
        safer, so the numbers look backwards at first. Closing early means buying back time value you have not yet earned,
        so the price you need is closer to today's than the expiration breakeven is. A shorter horizon narrows the price
        distribution in your favour, but the target shrinks faster than the distribution tightens. Early exit lowers your
        risk; it does not raise your odds of being green at that moment.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Taking profit early</strong> prices the plan most short-premium trades are actually managed on: buying the
        position back for half or two-thirds of its maximum profit instead of holding to expiration. Each cell carries two
        readings. <em>Reached by then</em> is a path measure — the chance the target is available at least once on or before
        that date, which is what a resting good-till-cancelled closing order needs in order to fill. <em>Still there on the
        day</em> is a single-moment measure, and is always lower, because a target reached early can be handed back.
      </p>
      <div className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
        <strong>Why &ldquo;by expiration&rdquo; can exceed the probability of success:</strong> a trade can show 88.3%
        probability of success at expiration while its 50%-of-maximum-profit target shows 93.9% by expiration. Success is
        measured only at expiration, so a path that reached the target in week two and then reversed into a loss counts
        against success yet still counts as reached. Compare like with like using <em>still there on the day</em> at
        expiration &mdash; 87.7% in that example, just below 88.3%, as it must be: finishing at the target is a subset of
        finishing profitable at all.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Suggested Workflow</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Load the underlying and build a simulated position from the chain, broker text, or a template.</li>
        <li>Confirm every leg's side, quantity, expiration, strike, entry price, IV, and active checkbox.</li>
        <li>Use Risk Profile to inspect payoff, breakevens, probabilities, and changes through time.</li>
        <li>Use Price &amp; Moneyness and Greek Surfaces to understand where the position is sensitive.</li>
        <li>Use Backtest for a modeled historical comparison, then review the assumptions and cycle audit trail.</li>
      </ol>
    </div>
  )
}

function GeneralOptionScannerHelpEntry() {
  return (
    <div>
      <h2>Option Scanner Help</h2>
      <p style={{ marginBottom: '1rem' }}>
        Every supported option strategy now uses the General Option Scanner. Choose a strategy, select the stock or ETF
        universe, apply a starting preset, and edit the green values to control that strategy&apos;s construction and filters.
        Open Filters is a wide discovery scan. Risk Averse and Moderate add earnings, size, liquidity, and IV Rank gates.
        Setup buttons such as My holdings, Pullback uptrend, High IV, Weeklies, and Core indexes appear only when they fit the selected strategy.
      </p>
      <div className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
        <strong>One scanner, strategy-specific rules:</strong> changing the strategy loads its own trade construction,
        probability, payoff, and risk controls. The shared fields filter the market before a live option chain is priced.
      </div>
      <p style={{ marginBottom: '0.75rem' }}>
        Hover a white section heading or its <strong>?</strong> marker for a concise explanation. Each field also has a
        matching marker, and its editor includes a longer <strong>What does this mean?</strong> explanation.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <a className="btn btn-sm btn-primary" href="#/general-option-scanner/help">Open the complete Option Scanner guide</a>
        <a className="btn btn-sm btn-outline" href="#/general-option-scanner/strategies">Every strategy&apos;s inputs, explained</a>
      </div>
    </div>
  )
}

function OptionDashboardHelp() {
  return (
    <div>
      <h2>Options Dashboard</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Options Dashboard answers the question that comes <em>before</em> picking a contract:
        given what SPY, QQQ, and IWM are doing and what the economy looks like right now, which
        scanner is worth opening first? It scores each of the three markets across three timeframes,
        scores the macro backdrop from market-based proxies, then ranks all twelve option strategies
        the app can scan for. It never selects a strike, an expiration, or a price &mdash; the linked
        scanner still does that.
      </p>

      <div className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
        <strong>Ranks scanners, not trades.</strong> A high fit score means &ldquo;this structure suits
        the current regime,&rdquo; not &ldquo;there is a good trade available today.&rdquo; The scanner you open
        still has to find liquid contracts at acceptable prices, and it can legitimately return nothing.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Header and the four summary cards</h3>
      <HelpScreenshot
        src="./help-screenshots/option-dashboard/dashboard-overview.png"
        alt="Options Dashboard header with the live/cached badge, Refresh market data button, and the Weekly market posture, Economic prediction, Volatility regime, and Best scanner fit cards"
        caption="The top strip: data freshness on the right, then the four regime summaries."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Freshness badge</strong> &mdash; <em>live</em> means the numbers were just built from a fresh download, <em>cached</em> means a snapshot less than 15 minutes old is being reused, and <em>stale</em> means the refresh failed and the last good snapshot is shown along with the error. <strong>Refresh market data</strong> forces a new download and rebuild.</li>
        <li><strong>Market posture</strong> &mdash; the average technical score of the three markets for the selected timeframe, plus how many are bullish, how many are bearish, and an agreement percentage. High agreement with a strong score is a much cleaner signal than one market carrying the average.</li>
        <li><strong>Economic prediction</strong> &mdash; the outlook and recession-risk read from the Economic Nowcast section below.</li>
        <li><strong>Volatility regime</strong> &mdash; the average realized-volatility percentile of the three markets. Low percentiles favor buying premium; high percentiles favor selling it.</li>
        <li><strong>Best scanner fit</strong> &mdash; the top-ranked row of the Action Ranking table <em>as currently filtered</em>, so it changes when you click a market card or change the Fit filter.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Timeframe and the trend map</h3>
      <HelpScreenshot
        src="./help-screenshots/option-dashboard/timeframe-trend-map.png"
        alt="Daily, Weekly, and Monthly timeframe tabs above the SPY, QQQ, and IWM trend cards with technical score, price, trailing return, trend meter, and quick indicator values"
        caption="Every number on the page &mdash; scores, indicators, and the strategy ranking &mdash; follows the selected timeframe."
      />
      <p style={{ marginBottom: '0.75rem' }}>
        Daily bars are the raw session data, weekly bars are resampled to Friday closes, and monthly bars
        to month ends. The trailing-return rule changes with the timeframe as well: 20 days on daily,
        13 weeks on weekly, and 6 months on monthly. Use <strong>Monthly</strong> for the primary regime,
        <strong> Weekly</strong> for the trade thesis, and <strong>Daily</strong> for entry timing;
        agreement across all three is stronger evidence than any single tab.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Each market card shows the technical score, the adjusted close, the trailing return, a
        &minus;100&hellip;+100 meter, and the four values that most often decide a trade: RSI 14, MACD
        histogram, ADX 14, and the realized-volatility percentile. <strong>Click a card</strong> to filter
        the Action Ranking to that market; click it again to go back to all three. Scores of +50 or
        better read as strong bullish, +20 to +50 bullish, &minus;20 to +20 neutral or mixed, and the
        mirror images on the downside.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Show score calculation</h3>
      <HelpScreenshot
        src="./help-screenshots/option-dashboard/score-calculation.png"
        alt="Expanded score calculation for SPY listing all eight technical rules with their +1, 0, or -1 contributions"
        caption="Every score is auditable: eight rules, each worth +1, 0, or &minus;1."
      />
      <p style={{ marginBottom: '0.5rem' }}>
        The score is simply the sum of the eight rules divided by eight and scaled to 100, so +62 means
        five net positive rules. The rules are:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Trend structure</strong> &mdash; price vs EMA 20, EMA 20 vs EMA 50, and EMA 50 vs EMA 200.</li>
        <li><strong>Momentum</strong> &mdash; MACD histogram above or below zero, RSI 14 (+1 at 55 or higher, &minus;1 at 45 or lower, otherwise 0), and the Awesome Oscillator.</li>
        <li><strong>Confirmation</strong> &mdash; the trailing return for the timeframe, and ADX direction, which only scores when ADX 14 is 20 or higher; below that the trend is treated as non-directional and contributes 0.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Indicator evidence</h3>
      <HelpScreenshot
        src="./help-screenshots/option-dashboard/indicator-evidence.png"
        alt="Indicator evidence table listing price, EMA 20/50/200, MACD, signal, histogram, RSI, Awesome Oscillator, ADX, +DI/-DI, ATR, realized volatility, and RV percentile for each market"
        caption="The raw values behind the scores, including ATR and realized volatility."
      />
      <p style={{ marginBottom: '0.75rem' }}>
        Nothing here is scored separately &mdash; this table exists so you can check a value yourself
        rather than take the score on faith. Two columns matter beyond the rules: <strong>ATR 14</strong>
        tells you how far the market typically travels in one bar, which is a sanity check on strike
        distance, and <strong>RV percentile</strong> compares current realized volatility with its own
        recent history, which is what drives the volatility part of every fit score.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Economic nowcast</h3>
      <HelpScreenshot
        src="./help-screenshots/option-dashboard/economic-nowcast.png"
        alt="Economic nowcast showing the macro score and the six evidence cards for yield curve, credit, discretionary vs staples, industrials, inflation proxy, and VIX"
        caption="Six market-implied proxies, each contributing a fixed number of macro points."
      />
      <p style={{ marginBottom: '0.5rem' }}>
        The macro score is the sum of six weighted signals, each of which can be positive, neutral (zero
        points), or negative:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>10Y &minus; 3M yield curve</strong> (25 pts) &mdash; positive above +0.25, warning below &minus;0.25.</li>
        <li><strong>High-yield / quality credit</strong>, HYG vs LQD (20 pts) &mdash; the 3-month change in risk appetite.</li>
        <li><strong>Discretionary / staples</strong>, XLY vs XLP (15 pts) &mdash; cyclical versus defensive consumer leadership.</li>
        <li><strong>Industrials trend</strong>, XLI versus its 200-day EMA (15 pts).</li>
        <li><strong>VIX stress gauge</strong> (15 pts) &mdash; supportive below 18, stressed above 25.</li>
        <li><strong>Inflation pressure proxy</strong>, TIP vs IEF (10 pts) &mdash; rising pressure counts against the score because it restricts policy.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Totals of +40 or better read as &ldquo;Expansion likely,&rdquo; +15 to +40 as a soft landing,
        &minus;15 to +15 as mixed or slowing, &minus;40 to &minus;15 as slowdown risk, and below
        &minus;40 as contraction risk. This is a market-implied proxy model, not an official GDP forecast.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Action ranking</h3>
      <HelpScreenshot
        src="./help-screenshots/option-dashboard/action-ranking.png"
        alt="Action ranking table with rank, market, trade to research, fit badge and score, technical, economy, and volatility components, the reasoning column, and Open scanner buttons"
        caption="Twelve strategies scored against every market, filtered by the Market and Fit dropdowns."
      />
      <p style={{ marginBottom: '0.75rem' }}>
        Each strategy carries its own preferred trend window, macro window, and volatility preference
        (high for premium selling, low for debit structures, medium for the balanced flies). The fit
        score is <strong>55% technical + 25% economic + 20% volatility</strong>, and the badge follows
        from it: <strong>Ideal</strong> at 78 and above, <strong>Favorable</strong> at 65,
        <strong> Selective</strong> at 50, and <strong>Avoid</strong> below that. Iron condors and iron
        butterflies additionally lose points when ADX 14 reaches 25, because a strong directional trend
        is the main way a neutral trade fails.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>Why it ranks here</strong> column shows the strategy&rsquo;s thesis, the three facts
        that produced the score, and any cautions in amber &mdash; for example premium being too cheap
        for a short-volatility structure, or macro risk arguing for a defined-risk alternative to an
        undefined-risk trade. <strong>Open scanner</strong> jumps to that scanner. Use the
        <strong> Market</strong> dropdown (or a click on a trend card) and the <strong>Fit</strong>
        dropdown to narrow the list; choose <strong>All fits</strong> if you want to see what the model
        currently rates as poor.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How to use the page</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Start on <strong>Monthly</strong> to establish the regime, then switch to <strong>Weekly</strong> for the trade thesis. If the two disagree, prefer smaller size or defined risk.</li>
        <li>Read the posture and agreement card. Three markets agreeing is a much better backdrop than one strong index pulling the average.</li>
        <li>Check the volatility regime. It decides whether you should be selling premium or buying it, regardless of direction.</li>
        <li>Click the market you actually trade to filter the ranking, then read the reasoning and cautions on the top two or three rows rather than only the score.</li>
        <li>Press <strong>Open scanner</strong> and let the scanner validate liquidity, expiration, strikes, and price. If it finds nothing acceptable, that is a valid answer &mdash; a good regime is not a trade.</li>
      </ol>

      <div className="alert alert-warning" style={{ marginTop: '0.75rem' }}>
        <strong>Educational analysis only.</strong> Market data can be delayed or incomplete, and a
        technical score plus an economic nowcast are decision aids, not guarantees or personalized
        investment advice.
      </div>
    </div>
  )
}

function OptionTradesHelp() {
  return (
    <div>
      <h2>Option Trades</h2>
      <p style={{ marginBottom: '1rem' }}>
        Option Trades is the ledger for positions you actually opened, as opposed to the modeling done
        on the Options page. It stores each leg and each broker execution, works out realized P/L,
        maximum risk, win rate, and profit factor, and lets you decide which trades count as income.
        It is a <strong>separate ledger from your holdings</strong> &mdash; adding, closing, or deleting
        an option trade never changes share counts, cost basis, or dividends.
      </p>

      <HelpScreenshot
        src="./help-screenshots/option-trades/trades-overview.png"
        alt="Option Trades header with Import option transactions and Add trade buttons, the Owner scope notice, and the six summary cards"
        caption="The header, the account-scope notice, and the six summary cards."
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Which account you are looking at</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>The eyebrow above the title names the selected portfolio, and every number on the page follows the portfolio selector.</li>
        <li>An <strong>owner rollup</strong> shows trades from its member accounts as well. Those rows are read-only here &mdash; the Actions column says <em>Manage in &lt;account&gt;</em>. Select the source account to close, classify, or delete them.</li>
        <li>An <strong>aggregate</strong> view is fully read-only: adding, importing, closing, and deleting are disabled until you select a single portfolio.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>The six summary cards</h3>
      <p style={{ marginBottom: '0.5rem' }}>
        These always cover every trade in the selected account, not just the rows left after the table
        filters. Each card has a <strong>?</strong> tooltip with the same definition.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Open trades</strong> &mdash; count of trades still open, and how many of those have a known maximum risk.</li>
        <li><strong>Known open risk</strong> &mdash; the sum of maximum risk across open trades where risk is known. Trades with undefined risk are left out, so this is not your total account risk.</li>
        <li><strong>Realized MTD / YTD</strong> &mdash; net realized option P/L for the current month and calendar year, across every purpose.</li>
        <li><strong>Win rate</strong> &mdash; winning trades divided by fully closed trades. Open trades are excluded and breakeven trades stay in the denominator.</li>
        <li><strong>Profit factor</strong> &mdash; gross wins divided by gross losses on fully closed trades. A dash means there are no closed losses yet.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Income view</h3>
      <HelpScreenshot
        src="./help-screenshots/option-trades/income-view.png"
        alt="Income view panel with the Include realized options toggle and the Fund YTD, Income options YTD, and Selected YTD total values"
        caption="Option premium only joins your income total when the trade is classified as Income and the P/L is realized."
      />
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Include realized options</strong> adds <em>Income options YTD</em> to <em>Fund YTD</em>
        to produce the selected total. Two rules keep this honest: only trades whose purpose is
        <strong> Income</strong> qualify (Directional, Hedge, Adjustment, and Other never count), and only
        <strong> realized</strong> P/L counts &mdash; premium collected on a position that is still open is
        not income yet. The toggle is remembered between sessions and changes nothing in the ledger itself.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How these numbers are calculated</h3>
      <HelpScreenshot
        src="./help-screenshots/option-trades/calculation-audit.png"
        alt="Expanded How these numbers are calculated panel showing when P/L becomes realized, the month-to-date audit table, and the scope and income rules"
        caption="Expand this panel to see every realization event that produced the current MTD figure."
      />
      <p style={{ marginBottom: '0.75rem' }}>
        A leg becomes realized once <em>all</em> of its contracts are closed, expired, assigned, or
        exercised; its realized amount is the opening cash flow plus the closing cash flow, less fees.
        A finished leg counts even if the rest of the trade is still open, which is why MTD can move on a
        trade whose status is still Open. The date of the final closing execution decides the month and
        year. The middle column lists every event behind the current MTD total, so a surprising figure
        can be traced to a specific fill.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>The execution ledger</h3>
      <HelpScreenshot
        src="./help-screenshots/option-trades/execution-ledger.png"
        alt="Trades table with ticker, status, and purpose filters and columns for underlying, strategy, opened, expiration and DTE, entry, max risk, realized P/L, return on risk, status, and actions"
        caption="Filter by ticker, status, and purpose; each row is one trade, however many legs it has."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Underlying</strong> &mdash; ticker, leg count, and (in rollups) the account that owns the trade.</li>
        <li><strong>Strategy / purpose</strong> &mdash; the structure plus the income classification. A <em>Needs classification</em> flag appears when the strategy is still &ldquo;Custom&rdquo; or the purpose is still &ldquo;Other,&rdquo; which is common right after an import.</li>
        <li><strong>Expiration / DTE</strong> &mdash; the nearest expiration with open contracts and days to it; closed trades show the close date instead. A negative DTE means the trade holds legs that already expired and still need to be recorded.</li>
        <li><strong>Entry</strong> &mdash; the net opening cash: green <strong>CREDIT</strong> for premium received, red <strong>DEBIT</strong> for premium paid.</li>
        <li><strong>Max risk</strong> &mdash; what you entered, or a derived value with its method shown underneath: <em>net debit</em> for all-long positions, <em>derived spread width</em> for a two-leg vertical, and <em>derived condor width</em> for a four-leg condor (the wider wing minus the credit). Undefined-risk trades such as a naked short put show a dash.</li>
        <li><strong>Realized P/L</strong> &mdash; realized cash with a WIN, LOSS, or BREAKEVEN tag once the trade is closed.</li>
        <li><strong>Return on risk</strong> &mdash; realized P/L divided by maximum risk, only for closed trades that have a risk figure.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Row actions: <strong>Risk graph</strong> stages the trade on the Options page and draws its payoff
        with live chain data; <strong>Classify</strong> / <strong>Edit class</strong> sets strategy, purpose,
        max risk, and notes; <strong>Mark expired</strong> appears once open legs are past expiration and
        records a zero-value expiration in one click; <strong>Close</strong> opens the execution form; and
        <strong> Delete</strong> asks for a second click to confirm.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Expanding a trade</h3>
      <HelpScreenshot
        src="./help-screenshots/option-trades/trade-detail-expanded.png"
        alt="Expanded TSLA bull put spread showing source, total fees, net cash flow, risk method, notes, and a per-leg table with every execution"
        caption="The + button opens a full audit: per-leg contracts, net cash, and every recorded fill."
      />
      <p style={{ marginBottom: '0.75rem' }}>
        The summary line shows where the trade came from (manual entry or a broker format), total fees,
        net cash flow so far, and how maximum risk was determined. The table below lists each leg with its
        original and still-open contract counts, its net cash, and each execution with action, price, date,
        and cash effect. Stock-backed trades such as covered calls also show a <strong>LONG STOCK</strong>
        row that reads share coverage from the account&rsquo;s holdings &mdash; a read-only link that flags a
        shortfall without altering the holding.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Adding a trade by hand</h3>
      <HelpScreenshot
        src="./help-screenshots/option-trades/add-trade-form.png"
        alt="Add option trade form with underlying, strategy, purpose, open date, maximum risk, notes, and one leg row"
        caption="One row per contract leg; use + Add leg for spreads, condors, and butterflies."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Premiums are entered <strong>per share</strong> &mdash; the 100&times; multiplier is applied for you, so a $2.99 credit on one contract becomes $299.</li>
        <li>Side and type describe the leg (SHORT PUT, LONG CALL, and so on); the strategy dropdown only labels the trade, and <strong>Custom name&hellip;</strong> is there for structures not in the list.</li>
        <li><strong>Maximum risk</strong> can be left blank for defined-risk verticals and condors, which are derived. Enter it manually when you want to record the cash actually set aside &mdash; for example the full assignment cost of a cash-secured put.</li>
        <li><strong>Purpose</strong> is the field that decides whether this trade can ever reach your income total, so set it deliberately.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Closing works the same way in reverse: press <strong>Close</strong>, set the date, and give each
        open leg an action &mdash; buy/sell to close with a price, or <strong>Expired</strong>,
        <strong> Assigned</strong>, or <strong>Exercised</strong>, which are priced at zero automatically.
        You can close part of a position by lowering the contract count, and fees can be entered per leg.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Importing broker executions</h3>
      <HelpScreenshot
        src="./help-screenshots/option-trades/import-transactions.png"
        alt="Import Option Transactions page with the file-format selector, drop zone, generic template download, and the rules explaining how rows are handled"
        caption="Import option transactions accepts Schwab, E*TRADE, Fidelity, Robinhood, Shear Group, Interactive Brokers, and a generic CSV/XLSX template."
      />
      <p style={{ marginBottom: '0.75rem' }}>
        Pick the format, choose the file, and use <strong>Preview executions</strong> before importing;
        the preview reports how many rows were recognized, how many are duplicates of executions already
        stored, and how many closing rows could not be matched to an open contract. Legs are grouped into
        one trade by broker trade ID first and order ID second, so multi-leg orders arrive intact.
        Transaction history &mdash; not a positions export &mdash; is what produces accurate premium,
        fees, and realized P/L; if your history starts after a position was opened, add the missing
        opening executions with the generic template first. Imported trades usually arrive needing
        classification, so set strategy and purpose afterwards.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Suggested workflow</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Select the individual account that actually holds the trades before adding or importing.</li>
        <li>Import broker activity where you can, and add anything the broker export missed by hand.</li>
        <li>Clear every <em>Needs classification</em> flag &mdash; the income total and the Income options figure depend on it.</li>
        <li>Record closes, expirations, and assignments as they happen so MTD, win rate, and profit factor stay honest.</li>
        <li>Use <strong>Risk graph</strong> on open positions to check where a live trade stands, and the expanded row to reconcile fees and fills against the broker statement.</li>
      </ol>
    </div>
  )
}

function PutSellingScannerHelp() {
  const screenshotStyle = {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
    border: '1px solid var(--p-333)',
  }

  const captionStyle = {
    margin: '0.45rem 0 0',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  }

  const figureStyle = {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1.5rem',
  }

  return (
    <div>
      <h2>Put Selling Scanner</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Put Selling Scanner looks for large and mid-cap stocks that have sold off further than their own
        volatility justifies, then rates each one as a candidate for selling cash-secured puts. It suggests a
        specific strike and expiration for every candidate and shows what you would actually be paid.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 1: the only screen where losing is the plan
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A real scanned result on a true scale: Corning at $138.25, sell the $120 put 34 days out for a $5.57 credit.
        The shape is simple, and the number that matters is not the credit.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 300" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Cash-secured put payoff showing a 557 dollar credit kept above the 120 strike, a breakeven at 114.43 which is also the assignment basis, and a loss that continues all the way down">
          <line x1="50" y1="120" x2="700" y2="120" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="292" textAnchor="end" fill="var(--text-dim)" fontSize="11">GLW price at expiration →</text>

          <line x1="326" y1="55" x2="326" y2="262" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
          <text x="326" y="274" textAnchor="middle" fill="var(--text-dim)" fontSize="10">$120 strike</text>
          <line x1="487" y1="70" x2="487" y2="262" stroke="var(--accent)" strokeDasharray="2 4" strokeWidth="1" />
          <text x="487" y="64" textAnchor="middle" fill="var(--accent)" fontSize="10.5">today $138.25</text>

          <polyline points="60,230 276,120 326,95 680,95"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M60 230 L 40 240" stroke="var(--neg)" strokeWidth="2.5" strokeDasharray="4 3" />
          <text x="62" y="256" fill="var(--neg)" fontSize="10">…continues to −$11,443 at zero</text>

          <circle cx="276" cy="120" r="4.5" fill="var(--amber)" />

          <text x="510" y="86" textAnchor="middle" fill="var(--pos)" fontSize="11.5" fontWeight="700">Max profit +$557 — the credit</text>
          <text x="510" y="112" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">50% annualized if it just stays up</text>

          <rect x="120" y="140" width="300" height="62" rx="4" fill="var(--surface-inset)" stroke="var(--amber)" strokeWidth="1.5" />
          <text x="270" y="159" textAnchor="middle" fill="var(--amber)" fontSize="11.5" fontWeight="700">Breakeven $114.43 = your basis</text>
          <text x="270" y="176" textAnchor="middle" fill="var(--text-muted)" fontSize="10.5">below here you own 100 shares</text>
          <text x="270" y="192" textAnchor="middle" fill="var(--text-muted)" fontSize="10.5">at $114.42 — 17% under today</text>
        </svg>
        <p style={captionStyle}>
          Every other screen in this family treats a breach as failure. Here the amber line is the
          <strong> outcome you agreed to</strong>: assignment at an effective $114.42, a 17% discount to today&rsquo;s
          price. That is why this screen carries a Quality axis that the Covered Call Scanner does not &mdash; you are
          not renting the shares out, you are agreeing to buy the business. If you would not want it at $114.42, the
          50% annualized return is irrelevant.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 2: why the biggest drop is not the biggest dislocation
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Two rows from the same scan. Ranked on the raw decline they are not close; ranked on
        <strong> Stretch</strong> the order reverses. This is the single measurement the whole screen is built on.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 260" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Comparison of XSD down 25 percent at 1.6 sigma against LIN down 12.5 percent at 2.1 sigma, showing that the smaller percentage decline is the larger dislocation once normalized by each name's own volatility">
          <text x="60" y="30" fill="var(--text-dim)" fontSize="11.5" fontWeight="700">Ranked on % off the high</text>
          <text x="410" y="30" fill="var(--accent-bright)" fontSize="11.5" fontWeight="700">Ranked on Stretch (σ)</text>

          <rect x="60" y="48" width="222" height="34" rx="3" fill="var(--neg)" opacity="0.30" stroke="var(--neg)" strokeWidth="1" />
          <text x="72" y="70" fill="var(--text-strong)" fontSize="12" fontWeight="700">XSD −25.0%</text>
          <rect x="60" y="98" width="111" height="34" rx="3" fill="var(--neg)" opacity="0.30" stroke="var(--neg)" strokeWidth="1" />
          <text x="72" y="120" fill="var(--text-strong)" fontSize="12" fontWeight="700">LIN −12.5%</text>
          <text x="60" y="154" fill="var(--text-dim)" fontSize="10.5">&ldquo;XSD fell twice as far&rdquo;</text>

          <line x1="330" y1="45" x2="330" y2="165" stroke="var(--border)" strokeWidth="1" />

          <rect x="410" y="48" width="230" height="34" rx="3" fill="var(--accent-bright)" opacity="0.30" stroke="var(--accent-bright)" strokeWidth="1" />
          <text x="422" y="70" fill="var(--text-strong)" fontSize="12" fontWeight="700">LIN 2.1σ</text>
          <rect x="410" y="98" width="175" height="34" rx="3" fill="var(--accent-bright)" opacity="0.30" stroke="var(--accent-bright)" strokeWidth="1" />
          <text x="422" y="120" fill="var(--text-strong)" fontSize="12" fontWeight="700">XSD 1.6σ</text>
          <text x="410" y="154" fill="var(--accent-bright)" fontSize="10.5">&ldquo;LIN moved further than it ever does&rdquo;</text>

          <rect x="60" y="180" width="600" height="62" rx="5" fill="var(--surface-inset)" stroke="var(--border)" strokeWidth="1" />
          <text x="360" y="202" textAnchor="middle" fill="var(--text-muted)" fontSize="11.5">
            A 12.5% fall in an industrial-gas company is a bigger event than a 25% fall in a semiconductor ETF,
          </text>
          <text x="360" y="220" textAnchor="middle" fill="var(--text-muted)" fontSize="11.5">
            because one of them does that all the time and the other does not.
          </text>
          <text x="360" y="236" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">
            Stretch divides the actual move by how far that name would ordinarily travel over the window.
          </text>
        </svg>
        <p style={captionStyle}>
          The same σ measure is shared with the Covered Call, Bull Put, and Bear Put screens, so the four cannot drift
          apart in how they judge &ldquo;that has moved a lot.&rdquo; <strong>vs Market</strong> then strips out the
          part of the move that was simply beta times the index &mdash; on the pictured Corning row, −45.9% off the
          high was still −37.8% after that subtraction, so the dislocation was genuinely company-specific.
        </p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/put-selling-scanner/01-scanner-overview.png"
          alt="Put Selling Scanner showing the ETF and stock include controls, presets, scan filters, and ranked put candidates"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          The scanner keeps the universe, risk filters, suggested contract, return, assignment basis, and warnings
          together so a high premium is never read without its tradeoffs.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        What &ldquo;fallen more than reasonable&rdquo; means here
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A 20% drop means very different things for a utility and a semiconductor stock, so the scanner does not rank
        on the raw decline. For each stock it measures the daily volatility of the period <em>before</em> the selloff,
        works out how far that stock would ordinarily travel over the lookback window, and expresses the actual drop
        as a multiple of that figure. This is the <strong>Sigma Stretch</strong> column, calculated as
        <strong> recent log-return decline &divide; (prior daily volatility &times; &radic;Lookback)</strong>. A positive
        result means the price fell; 2.5&sigma; is a decline equal to two and a half of its own normal lookback moves.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Example: if daily volatility is 1% and Lookback is 21 trading days, one normal move is approximately
        1% &times; &radic;21 = 4.6%. A roughly 6.9% decline is therefore about 1.5&sigma;. Increasing
        <strong> Lookback</strong> changes both the historical return being measured and the square-root scaling.
        Increasing <strong>Target DTE</strong> does not change Stretch; it only changes the option expiration the
        scanner seeks. This is also different from <strong>% Off High</strong>, which is simply the distance from the
        52-week high and is not volatility-adjusted.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        The scanner also subtracts the market&rsquo;s move times the stock&rsquo;s beta, reported as
        <strong> vs Market</strong>. A stock that merely fell along with everything else is not dislocated; this column
        isolates the part of the decline that is specific to the company.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How candidates are scored</h3>
      <p style={{ marginBottom: '0.5rem' }}>
        Each name receives a 0&ndash;100 composite and a letter grade built from four independent axes. Inputs between
        the thresholds below earn points on a straight-line ramp; values beyond them receive the minimum or maximum
        for that item.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Dislocation (30 points)</strong> — stretch from 1&sigma; to 3&sigma; earns 0&ndash;15 points; a 10&ndash;35% drawdown earns 0&ndash;8; and a 3&ndash;20% beta-unexplained decline earns 0&ndash;7.</li>
        <li><strong>Premium (25 points)</strong> — IV/RV from 1.0 to 1.6 earns 0&ndash;14 points; the IV-rank proxy from 30 to 80 earns 0&ndash;6; and an 8&ndash;30% annualized return earns 0&ndash;5. Earnings before expiry subtract 6 premium points.</li>
        <li><strong>Quality (25 points)</strong> — stocks use size (7), profitability (7), balance sheet (6), and share liquidity (5). Funds use AUM (8), diversification (9), and liquidity (8).</li>
        <li><strong>Stabilization (20 points)</strong> — not making a fresh 52-week low earns 7 points; a 0&ndash;6% bounce earns 0&ndash;5; 0&ndash;8 percentage points of deceleration earns 0&ndash;4; and sitting 2&ndash;15% above the 52-week low earns 0&ndash;4.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Grades are <strong>A &ge; 80, B &ge; 70, C &ge; 60, D &ge; 50</strong>, otherwise F. If no option chain is
        available, the other three axes are rescaled from 75 points to 100 and the grade gets an asterisk. That
        provisional score always sorts below fully priced candidates because the premium edge is still unknown.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/put-selling-scanner/03-score-derived.png"
          alt="Put Selling Scanner hidden help with the complete score derivation expanded"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          Select <strong>How this works</strong>, then expand <strong>How the score is built</strong> to see the same
          weights and thresholds without leaving the scan.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>The suggested put</h3>
      <p style={{ marginBottom: '1rem' }}>
        For the highest-rated candidates the scanner pulls the live option chain, picks the expiration closest to your
        target days-to-expiration, and selects the put nearest your target delta. It then reports the bid/ask, the
        premium per contract, the cash required to secure it, the return on that cash in both raw and annualized terms,
        the probability of expiring out of the money, and the <strong>basis if assigned</strong> — the strike minus the
        premium, which is your effective cost per share if the stock is put to you.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Stocks and ETFs together</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>Include</strong> checkboxes at the top choose what gets scanned: <strong>Stocks</strong> (using the
        stock universe dropdown), <strong>Index ETFs</strong> (SPY, QQQ, IWM, DIA, style and rates funds), and
        <strong> Sector &amp; commodity ETFs</strong> (XLK, XLE, GLD, SLV, SMH, GDX and the rest). The groups are
        independent, so unchecking Stocks genuinely skips the stock universe rather than filtering it out afterwards —
        an ETF-only scan finishes in a few seconds. Everything selected is scored on the same scale and ranked in one
        table, with a <strong>Type</strong> badge marking each row as Stock, Index, or Sector.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Funds are judged differently where it matters. They report <strong>assets under management</strong> rather than
        a market cap, and they have no earnings, margins, or balance sheet — so the profitability and earnings filters
        never apply to them, and the Quality axis substitutes <strong>breadth of holdings</strong> for profitability: a
        broad index scores highest because no single company can sink it, a sector or commodity fund a little lower,
        and a leveraged or inverse fund scores zero there (those are excluded by default). Funds also get their own
        drop and stretch floors, because SPY almost never falls 12% from its high and would otherwise never appear.
        The stretch measure still does the real work &mdash; a 6% decline in a low-volatility index can be just as many
        standard deviations as a 25% decline in a semiconductor name.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Staying clear of earnings</h3>
      <p style={{ marginBottom: '1rem' }}>
        A single earnings report can gap a stock straight through your strike, so the scanner treats it as an event to
        avoid rather than merely warn about. With <strong>Skip earnings inside trade</strong> on, a stock is removed
        when its next report falls within Target DTE plus the safety buffer. The scanner will not replace the requested
        trade with a near-expiration contract just to get out before the announcement. The
        <strong> Earnings</strong> column shows the next known report for candidates that remain.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Price chart popup</h3>
      <p style={{ marginBottom: '1rem' }}>
        Click any ticker (or the <strong>Price chart</strong> button in the expanded row) to open the Stock and ETF
        Analysis price chart for that name without leaving the scanner. It shows candles or a line with the
        <strong> 50 and 200-day moving averages</strong>, volume, <strong>MACD</strong>, and <strong>RSI</strong>, and
        the period can be switched from 3 months to 5 years. The indicator math is shared with the Analysis screen, so
        both places show the same values for a given ticker.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Choose what to scan with the independent <strong>Stocks</strong>, <strong>Index ETFs</strong>, and <strong>Sector &amp; commodity ETFs</strong> checkboxes.</li>
        <li>Pick a <strong>preset</strong> (Conservative, Balanced, Aggressive) or set the filters yourself.</li>
        <li>Choose a <strong>universe</strong>: the built-in large-cap or mid-cap lists, your own holdings, your watchlist, or a custom ticker list.</li>
        <li>Click <strong>Run Scan</strong>. The first run pulls a year of history for the whole universe and takes roughly 20&ndash;40 seconds; re-running with different filters is much faster while that price data stays cached.</li>
        <li>Click any row to expand the score breakdown, the full trade detail, the dislocation metrics, and the underlying business fundamentals.</li>
        <li>Click the ticker to pull up its price chart with moving averages, MACD, and RSI.</li>
      </ol>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/put-selling-scanner/02-how-to-use.png"
          alt="Put Selling Scanner hidden help with the quick-start workflow expanded"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          The hidden quick-start guide stays on the scanner, above the filters, and can be closed as soon as the
          workflow is familiar.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Warnings</h3>
      <p style={{ marginBottom: '1rem' }}>
        The Warnings column flags conditions worth checking before writing a contract: earnings landing inside the
        trade, wide bid/ask spreads, thin open interest, heavy debt, unprofitable companies, fresh 52-week lows, and
        prices far below the 200-day average.
      </p>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
        <strong>No trades execute here.</strong> The scanner rates setups from public market data. Scores are not
        advice, and assignment risk is real — a cash-secured put obliges you to buy 100 shares per contract at the
        strike no matter how far the stock has fallen.
      </div>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        If a scan returns nothing, that is usually correct rather than broken. In a market near its highs very few
        quality names are meaningfully dislocated. Lower the minimum drop or stretch, or widen the universe.
      </div>
    </div>
  )
}

function CoveredCallScannerHelp() {
  const captionStyle = {
    margin: '0.45rem 0 0',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  }

  const figureStyle = {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1.5rem',
  }

  return (
    <div>
      <h2>Covered Call Scanner</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Covered Call Scanner is the mirror of the Put Selling Scanner, but the trade is not symmetric, so the entry
        test is not simply the same screen flipped over. It looks for stocks and ETFs that have already made their move
        <em> and are starting to stall</em>, then rates each one as a candidate for selling a covered call, suggests a
        specific strike and expiration, and shows both what you are paid and what you give up.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 1: what you keep and what you sell
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A real scanned result, drawn to a true scale. You own Travelers at $374.36 and sell the $390 call 48 days out
        for a $6.35 credit. The dashed line is the shares on their own; the solid line is the shares plus the written
        call.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 300" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Covered call payoff showing profit capped at the 390 strike, a breakeven at 368.01, unprotected downside below it, and the forgone upside above the strike compared with holding the shares alone">
          <line x1="50" y1="170" x2="700" y2="170" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="292" textAnchor="end" fill="var(--text-dim)" fontSize="11">Stock price at expiration →</text>

          <line x1="503" y1="60" x2="503" y2="265" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
          <line x1="364" y1="120" x2="364" y2="265" stroke="var(--accent)" strokeDasharray="2 4" strokeWidth="1" />

          <path d="M503 90 L 680 90 L 680 40 Z" fill="var(--neg)" opacity="0.15" />
          <text x="612" y="80" textAnchor="middle" fill="var(--neg)" fontSize="10.5">upside you sold</text>

          <polyline points="364,170 680,40" fill="none" stroke="var(--text-dim)"
            strokeWidth="1.5" strokeDasharray="5 4" />
          <polyline points="60,272 308,170 503,90 680,90"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />

          <circle cx="308" cy="170" r="4" fill="var(--amber)" />
          <circle cx="503" cy="90" r="4" fill="var(--pos)" />

          <text x="150" y="255" textAnchor="middle" fill="var(--neg)" fontSize="11.5" fontWeight="700">Every dollar of the decline</text>
          <text x="150" y="270" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">the credit is the only cushion</text>

          <text x="308" y="188" textAnchor="middle" fill="var(--amber)" fontSize="10.5">breakeven $368.01</text>
          <text x="364" y="114" textAnchor="middle" fill="var(--accent)" fontSize="10.5">today $374.36</text>
          <text x="503" y="53" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">$390 strike</text>

          <text x="590" y="110" textAnchor="middle" fill="var(--pos)" fontSize="11.5" fontWeight="700">Capped at +$2,199</text>
          <text x="590" y="124" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">5.9% if called · 45% ann.</text>
        </svg>
        <p style={captionStyle}>
          The two things this picture is for. <strong>Left:</strong> the solid line falls with the shares almost all the
          way down &mdash; the $6.35 credit moves breakeven from $374.36 to $368.01 and that is the entire protection.
          <strong> Right:</strong> above $390 the line goes flat while the dashed shares keep climbing, and the shaded
          wedge is the move you sold. A covered call is an income trade, not a hedge.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Why &ldquo;overbought&rdquo; on its own is the wrong screen
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Selling a covered call trades the upside above the strike for a premium collected today. It wins when the
        underlying goes sideways or drifts down, and it loses its whole point when the underlying keeps running: the
        shares are called away and you watch the rest of the move without owning it.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        That is why screening purely for overbought names backfires. The strongest momentum names carry the fattest
        premium <em>because</em> they keep going up. This scanner therefore requires three conditions at once &mdash; the
        move has already happened, the options are genuinely overpriced rather than merely expensive-looking, and the
        advance is cooling rather than accelerating. A name printing fresh 52-week highs scores zero on the Stall axis
        and is excluded by default, exactly as a name printing fresh lows is excluded from the put screen.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        What &ldquo;already made its move&rdquo; means here
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        A 15% rally means very different things for a utility and a semiconductor stock, so nothing is ranked on the raw
        advance. For each name the scanner measures the daily volatility of the period <em>before</em> the run, works out
        how far that name would ordinarily travel over the lookback window, and expresses the actual advance as a
        multiple of it. That is the <strong>Stretch</strong> column, in standard deviations (&sigma;). The measure is
        shared with the Put Selling Scanner so the two screens cannot drift apart. <strong>vs Market</strong> subtracts
        the market&rsquo;s move times beta, and <strong>% of Range</strong> shows where the price sits between its
        52-week low and high.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How candidates are scored</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Overextension (30 points)</strong> — stretch from 1&sigma; to 3&sigma; earns 0&ndash;12 points; sitting 60&ndash;100% of the way up the 52-week range earns 0&ndash;6; standing 0.5&ndash;3.0 ATRs above the 50-day average earns 0&ndash;6; and a 2&ndash;15% beta-unexplained advance earns 0&ndash;6.</li>
        <li><strong>Premium (25 points)</strong> — IV/RV from 1.0 to 1.6 earns 0&ndash;14 points; the IV-rank proxy from 30 to 80 earns 0&ndash;6; and an 8&ndash;30% annualized static return earns 0&ndash;5. Earnings before expiry subtract 6 premium points.</li>
        <li><strong>Stall (20 points)</strong> — not making a fresh 52-week high earns 7 points; a 0&ndash;4% pullback off the 10-day high earns 0&ndash;5; 0&ndash;8 percentage points of deceleration earns 0&ndash;4; and sitting 1&ndash;10% below the 52-week high earns 0&ndash;4.</li>
        <li><strong>Trade terms (25 points)</strong> — underlying size (4) and share liquidity (4) need no option chain. The rest does: a 10&ndash;40% annualized if-called return earns 0&ndash;6, 2&ndash;12% of upside room earns 0&ndash;5, the chain&rsquo;s spread and open interest earn 0&ndash;4, and freedom from dividend-driven early assignment earns 0&ndash;2.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Grades are <strong>A &ge; 80, B &ge; 70, C &ge; 60, D &ge; 50</strong>, otherwise F, and the bands are calibrated
        against the Put Selling Scanner so a C means the same thing on both screens. There is no Quality axis here: a
        covered call is written on shares you already hold, so the question is whether the option market is real rather
        than whether the business is one to be assigned into. If no option chain is available, the 58 points that did
        not need one are rescaled and the grade gets an asterisk; those provisional scores always sort below fully
        priced candidates.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 2: where the 100 points live
      </h3>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 190" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Bar showing the covered call score split into Overextension 30 points, Premium 25 points, Stall 20 points, and Trade terms 25 points, with grade thresholds at 50 60 70 and 80">
          {[
            ['Overextension', '30', 60, 180, 'var(--accent-bright)'],
            ['Premium', '25', 240, 150, 'var(--pos)'],
            ['Stall', '20', 390, 120, 'var(--amber)'],
            ['Trade terms', '25', 510, 150, 'var(--teal)'],
          ].map(([label, points, x, width, color]) => (
            <g key={label}>
              <rect x={x} y="45" width={width} height="46" fill={color} opacity="0.22" stroke={color} strokeWidth="1.5" />
              <text x={Number(x) + Number(width) / 2} y="68" textAnchor="middle" fill={color} fontSize="12.5" fontWeight="700">{label}</text>
              <text x={Number(x) + Number(width) / 2} y="84" textAnchor="middle" fill="var(--text-muted)" fontSize="11">{points} pts</text>
            </g>
          ))}
          <text x="60" y="35" fill="var(--text-dim)" fontSize="11">0</text>
          <text x="660" y="35" textAnchor="end" fill="var(--text-dim)" fontSize="11">100</text>

          {[['D', 50], ['C', 60], ['B', 70], ['A', 80]].map(([grade, value]) => (
            <g key={grade}>
              <line x1={60 + Number(value) * 6} y1="91" x2={60 + Number(value) * 6} y2="112" stroke="var(--text-dim)" strokeWidth="1" />
              <text x={60 + Number(value) * 6} y="126" textAnchor="middle" fill="var(--text-muted)" fontSize="11.5" fontWeight="700">{grade}</text>
              <text x={60 + Number(value) * 6} y="140" textAnchor="middle" fill="var(--text-dim)" fontSize="10">{value}</text>
            </g>
          ))}

          <rect x="60" y="155" width="348" height="26" rx="4" fill="var(--surface-inset)" stroke="var(--border)" strokeWidth="1" />
          <text x="234" y="172" textAnchor="middle" fill="var(--text-muted)" fontSize="11.5">
            58 pts need no option chain
          </text>
          <rect x="418" y="155" width="242" height="26" rx="4" fill="var(--surface-inset)" stroke="var(--amber)" strokeWidth="1" />
          <text x="539" y="172" textAnchor="middle" fill="var(--amber)" fontSize="11.5">42 pts require a live chain</text>
        </svg>
        <p style={captionStyle}>
          Note how little of the score the premium actually drives. A name can carry a fat credit and still grade badly
          because it has not stalled &mdash; and in the pictured scan the top-ranked result had an
          <strong> IV/RV of 0.70</strong>, meaning its options were <em>cheap</em> against realized movement, yet it led
          the table on extension and stall. If no chain is available the 58 chain-free points are rescaled and the grade
          gets an asterisk.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Small caps</h3>
      <p style={{ marginBottom: '1rem' }}>
        The universe dropdown offers <strong>Small caps only</strong>, <strong>Mid + small caps</strong>, and
        <strong> Large + mid + small caps</strong> &mdash; lists the Put Selling Scanner deliberately does not carry.
        Selling a put means agreeing to be assigned into the business, so a small cap has to clear a quality bar first;
        writing a call means selling upside on shares you already hold, where a small cap&rsquo;s much richer implied
        volatility is the whole attraction. The real risk is <em>option</em> liquidity rather than company size, since
        plenty of small caps list a chain that cannot actually be traded &mdash; so <strong>Min $ volume</strong> does
        the important filtering, the chain&rsquo;s spread and open interest are scored directly, and thin names collect
        the <em>Illiquid</em> and <em>Small</em> warnings. Because the large-cap floor would drop every small cap
        outright, they are measured against a separate <strong>Small-cap min cap</strong> figure, the same way funds are
        measured on AUM. The <strong>Small caps</strong> preset also asks for more room above the strike and a lower
        delta, since these names gap harder than a mega cap.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Your shares and your cost basis</h3>
      <p style={{ marginBottom: '1rem' }}>
        Your holdings are the default universe, because only a position you actually hold has a share count and a cost
        basis to check the strike against. The <strong>Shares</strong> column shows the shares held and how many
        contracts that supports &mdash; one per 100 shares, so a 60-share position supports none, and
        <strong> Only where I hold 100+ shares</strong> filters the scan down to positions you can write against today.
        With <strong>Keep strike above my cost basis</strong> on (the default) the scanner only considers strikes at or
        above your average cost, since being called away below what you paid turns a premium into a realized loss. If no
        strike above your basis has a live bid it falls back to the best available contract and flags
        <strong> Below basis</strong> rather than hiding the candidate. Basis follows the cost-basis mode selected in the
        header and is derived from shares times price per share.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>The two ways you lose the shares</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Earnings.</strong> A single report can gap the underlying straight through your strike, handing away the
        exact move you hold it for. With <strong>Skip earnings inside trade</strong> on, a stock is removed when its
        next report falls within Target DTE plus the safety buffer. The scanner will not substitute a near-expiration
        call to get out before the report. ETFs read &ldquo;no earnings&rdquo;.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Ex-dividend early assignment.</strong> This risk has no equivalent when selling puts. A call holder
        exercises early only to capture a dividend, and only once the option&rsquo;s remaining <em>extrinsic</em> value is
        worth less than that dividend. So when an ex-dividend date falls inside the trade, the scanner compares the
        dividend against the credit collected: under a quarter of it is noted, half or more is flagged as a real risk,
        and a dividend larger than the whole premium is flagged as likely assignment. In that case the management plan
        tells you to close or roll <em>before</em> the ex-date rather than at expiry. Ex-dates that have not yet been
        declared are projected from the payment frequency and labelled <em>estimated</em>.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>The suggested call and the management plan</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        For the highest-rated candidates the scanner pulls the live chain, takes the expiration closest to your target
        DTE, and picks the call nearest your target delta that is at least your minimum distance out of the money. A
        0.30 delta is the conventional covered-call target: enough premium to be worth writing, roughly a 70% chance of
        keeping the shares. <strong>Ann. Return</strong> is the credit against the value of the shares committed if the
        underlying goes nowhere; <strong>If Called</strong> adds the capital gain up to the strike, which is the capped
        best case. The expanded row also gives the effective sale price, the downside breakeven, and the gain against
        your own basis if the shares are called.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Buy Back At</strong> is a success-oriented exit: a limit to close early, keeping most of the credit while
        removing the assignment risk that the last of the premium pays for &mdash; 70% of the credit for strong liquid
        setups, 65% for balanced ones, 60% for anything carrying a warning. <strong>Defend At</strong> is the strike:
        reach it with time left and the shares are genuinely in play, so the choice is to roll up and out for a net
        credit or to let them go and bank the capped gain.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        The controls, one by one
      </h3>
      <p style={{ marginBottom: '0.5rem' }}>
        Four presets sit above the filters. <strong>Conservative</strong> is holdings-only, must have stalled, strike
        above your basis and 5% out of the money at 0.20 delta. <strong>Balanced</strong> adds index ETFs and uses the
        conventional 0.30-delta write. <strong>Small caps</strong> asks for more room (6% OTM) at a lower delta.
        <strong> Aggressive</strong> widens the universe, allows names still breaking out, and drops the cost-basis
        rule &mdash; more premium, and far more chance of losing the shares.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Min run / Min stretch (σ):</strong> the two halves of &ldquo;has already moved.&rdquo; Run is the raw advance over the lookback; stretch normalizes it by the name&rsquo;s own prior volatility. Stretch is the one that travels across sectors.</li>
        <li><strong>Min mkt cap</strong> and <strong>Small-cap min cap:</strong> two separate floors, because the large-cap gate would drop every small cap outright. Funds are sized by <strong>ETF min AUM</strong> instead.</li>
        <li><strong>ETF min run / ETF min stretch:</strong> lower thresholds for funds, since a basket does not move like a single stock.</li>
        <li><strong>Min RSI</strong> and <strong>Min % of range:</strong> how overbought, and how far up the 52-week range. These are necessary but never sufficient &mdash; see the Stall axis.</li>
        <li><strong>Min $ volume:</strong> the single most useful liquidity control on this screen. Option quality tracks share dollar volume far better than it tracks market cap, which is what makes small caps workable here at all.</li>
        <li><strong>Lookback:</strong> trading days in the advance window, 21 by default.</li>
        <li><strong>Target DTE:</strong> 35 by default. The suggested expiration is the listed one nearest this.</li>
        <li><strong>Target delta:</strong> roughly the assignment probability you are accepting. 0.30 is conventional: enough premium to be worth writing, about a 70% chance of keeping the shares.</li>
        <li><strong>Min OTM:</strong> the floor on how far above spot the strike must sit, applied <em>after</em> the delta search. This is what stops a high-volatility name from handing you a 0.30-delta strike that is barely above the money.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        The five checkboxes are where most of the discipline lives: <strong>Skip fresh 52-wk highs</strong> (the names
        most likely to run through your strike), <strong>Skip earnings inside trade</strong>,
        <strong> Only where I hold 100+ shares</strong>, <strong>Keep strike above my cost basis</strong>, and
        <strong> Skip leveraged / inverse ETFs</strong>.
      </p>

      <HelpScreenshot
        src="./help-screenshots/covered-call-scanner/01-scanner-overview.png"
        alt="Covered Call Scanner showing the include row, the four presets, the filter panel, the scan stats line, and the ranked results table with score, shares held, percent of range, run, stretch, versus market, RSI, IV over RV, the suggested call, annualized return, if called, and buy-back price"
        caption={<>
          Each row names a specific contract &mdash; strike, expiration, how far above the price it sits, and the
          credit &mdash; alongside the extension metrics that justified it and any warnings.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Reading the columns and the warnings
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Shares</strong> shows what you hold and how many contracts it supports; a dash means you hold none, so
        the row is research rather than a trade you can place today. <strong>Ann. Return</strong> assumes the stock goes
        nowhere. <strong>If Called</strong> is the capped best case, premium plus the gain up to the strike &mdash; and
        it is usually the more honest number, since a name that just ran 30% is not obviously going to stand still.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        The Warnings column is not decoration. <em>Wide spread</em> and <em>Thin OI</em> say the credit shown may not be
        obtainable. <em>Recent trade estimate &mdash; no live bid/ask</em> means the quote came from the last trade,
        not a live two-sided market. <em>Still climbing</em> means the name failed the stall test and got in anyway on
        a loosened preset. <em>Div assign likely</em> means the dividend inside the trade exceeds the whole premium, so
        expect early assignment. Any of these can invalidate an otherwise attractive row.
      </p>
      <HelpScreenshot
        src="./help-screenshots/covered-call-scanner/02-expanded-row.png"
        alt="Expanded Covered Call row showing the score breakdown by axis, the full suggested trade with effective sale price and downside breakeven, the management plan with buy back and defend levels, and the dividend and earnings detail"
        caption={<>
          The expansion gives the score breakdown, the effective sale price, the downside breakeven, the gain against
          your own basis if called, and the ex-dividend and earnings dates that could take the shares early.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Start with <strong>My holdings</strong> (the default), and tick <strong>Only where I hold 100+ shares</strong> to see nothing but writable positions.</li>
        <li>Add <strong>Index ETFs</strong> or <strong>Sector &amp; commodity ETFs</strong> with the independent Include checkboxes; an ETF-only scan skips the stock universe and finishes in a few seconds.</li>
        <li>Pick a <strong>preset</strong> (Conservative, Balanced, Small caps, Aggressive) or set the filters yourself.</li>
        <li>Click <strong>Run Scan</strong>. The first run pulls a year of history and takes roughly 20&ndash;40 seconds; the price cache is shared with the Put Selling Scanner, so running one after the other is much faster.</li>
        <li>Read the stats line: tickers scanned, how many were <em>extended</em>, how many passed size and liquidity, how many were rated, and how many option chains were priced.</li>
        <li>Click any row for the score breakdown, the full trade, the management plan, the extension metrics, and the dividend and earnings detail.</li>
        <li>Click the ticker to pull up its price chart with moving averages, MACD, and RSI &mdash; the fastest way to confirm by eye that the advance really is cooling.</li>
        <li>Before writing, ask the one question the scanner cannot: <em>am I willing to sell these shares at this strike?</em> If the answer is no, do not write the call.</li>
      </ol>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        When the scan returns nothing
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        This is common and usually correct. A Balanced holdings-only run during a market pullback returned
        <em> 133 scanned &rarr; 0 extended</em> &mdash; not a single position had run far enough to be worth capping.
        Switching to the Aggressive preset over the full large+mid+small universe turned the same moment into
        <em> 729 scanned &rarr; 95 extended &rarr; 40 rated</em>. Both answers were right; they asked different
        questions. Loosening filters until something appears is how you end up writing calls on a name that is still
        climbing.
      </p>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
        <strong>No trades execute here.</strong> The scanner rates setups from public market data. Scores are not
        advice. A covered call caps your upside at the strike and does almost nothing to protect the downside &mdash; you
        keep the credit, but you still own every dollar of a decline below it. Writing calls on shares you are not
        willing to sell is the most common way this trade goes wrong.
      </div>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        If a scan returns nothing, that is usually correct rather than broken. In a flat or falling market very few
        names are meaningfully extended. Lower the minimum run, stretch, or RSI, widen the universe, or untick
        <strong> Only where I hold 100+ shares</strong>.
      </div>
    </div>
  )
}

function BullPutSpreadScannerHelp() {
  const captionStyle = {
    margin: '0.45rem 0 0',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  }

  const figureStyle = {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1.5rem',
  }

  return (
    <div>
      <h2>Bull Put Spread Scanner</h2>
      <p style={{ marginBottom: '1rem' }}>
        This scanner adapts the Put Selling Scanner to a defined-risk credit spread. It looks for liquid, financially
        sound stocks and ETFs in a healthy longer-term trend that have pulled back without breaking down. For each
        candidate it sells a higher-strike put and buys a lower-strike put in the same expiration.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 1: what you are actually being paid
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        This is a real scanned result drawn on a <strong>true</strong> P/L scale &mdash; nothing is compressed. Amphenol
        at $160.70, sell the $145 put and buy the $130 put, 48 days out, for a $3.20 credit.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 300" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Expiration payoff of a bull put spread showing a thin 320 dollar maximum profit above the short strike and a 1180 dollar maximum loss below the long strike, drawn to a true scale">
          <line x1="50" y1="170" x2="700" y2="170" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="290" textAnchor="end" fill="var(--text-dim)" fontSize="11">Stock price at expiration →</text>

          <line x1="184" y1="60" x2="184" y2="265" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
          <line x1="370" y1="60" x2="370" y2="265" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
          <line x1="565" y1="100" x2="565" y2="265" stroke="var(--accent)" strokeDasharray="2 4" strokeWidth="1" />

          <rect x="330" y="148" width="235" height="22" fill="var(--pos)" opacity="0.12" />
          <text x="447" y="163" textAnchor="middle" fill="var(--pos)" fontSize="10.5">11.8% cushion</text>

          <polyline points="60,250 184,250 330,170 370,148 680,148"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />

          <circle cx="330" cy="170" r="4" fill="var(--amber)" />
          <circle cx="565" cy="148" r="4" fill="var(--accent)" />

          <text x="122" y="243" textAnchor="middle" fill="var(--neg)" fontSize="11.5" fontWeight="700">Max loss −$1,180</text>
          <text x="122" y="266" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">below $130 long put</text>

          <text x="184" y="53" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">$130 long</text>
          <text x="370" y="53" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">$145 short</text>

          <text x="330" y="188" textAnchor="middle" fill="var(--amber)" fontSize="10.5">breakeven $141.80</text>
          <text x="565" y="94" textAnchor="middle" fill="var(--accent)" fontSize="10.5">today $160.70</text>

          <text x="600" y="140" textAnchor="middle" fill="var(--pos)" fontSize="11.5" fontWeight="700">Max profit +$320</text>
          <text x="600" y="126" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">the credit, and nothing more</text>
        </svg>
        <p style={captionStyle}>
          Drawn honestly, the reward is a thin sliver and the risk is a deep step. You are risking
          <strong> $1,180 to make $320</strong> &mdash; a 27% return on risk &mdash; and the trade pays that maximum
          anywhere above $145. This is why the scanner spends most of its filters on the <em>probability</em> of staying
          up there rather than on the size of the credit.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Why the entry screen is different from cash-secured puts
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        A cash-secured put can justify targeting a severe dislocation because assignment is an intended outcome. A
        bull put spread has a fixed loss below the long strike and works best when support holds, so its default screen
        is narrower: an orderly pullback, price above the 200-day average, RSI that is soft but not exhausted, and no
        fresh 52-week low. The scanner keeps the Put Selling Scanner&rsquo;s business-quality checks, then adds
        spread-specific safety and execution tests.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Trade math and hard gates
      </h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Maximum profit</strong> is the credit received.</li>
        <li><strong>Maximum loss</strong> is the strike width minus the credit.</li>
        <li><strong>Breakeven</strong> at expiration is the short strike minus the credit.</li>
        <li><strong>Return on risk</strong> is credit divided by maximum loss; the annualized figure is included only for comparison, not as a forecast.</li>
        <li>The default scan requires live, uncrossed quotes on both legs, a positive natural credit, enough credit and downside cushion, minimum open interest on the thinner leg, and tolerable two-leg execution cost.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 2: the funnel, and why so few survive it
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The stats line under the filter panel is the whole scan in one sentence. These are the real counts from a
        Balanced large-cap run:
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 250" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Funnel diagram: 348 tickers priced, 53 controlled pullbacks, 50 passed quality, 3 actionable spreads and 37 watchlist candidates">
          {[
            ['348', 'priced', 30, 640, 'var(--text-muted)'],
            ['53', 'controlled pullbacks', 75, 420, 'var(--accent)'],
            ['50', 'passed quality', 120, 390, 'var(--accent)'],
            ['13', 'live spreads priced', 165, 250, 'var(--amber)'],
          ].map(([count, label, y, width, color]) => (
            <g key={label}>
              <rect x={(720 - width) / 2} y={y} width={width} height="34" rx="4"
                fill="var(--surface-inset)" stroke={color} strokeWidth="1.5" />
              <text x="360" y={Number(y) + 22} textAnchor="middle" fill={color} fontSize="13" fontWeight="700">
                {count} — {label}
              </text>
            </g>
          ))}
          <rect x="120" y="210" width="230" height="34" rx="4" fill="var(--surface-inset)" stroke="var(--pos)" strokeWidth="1.5" />
          <text x="235" y="232" textAnchor="middle" fill="var(--pos)" fontSize="13" fontWeight="700">3 actionable</text>
          <rect x="370" y="210" width="230" height="34" rx="4" fill="var(--surface-inset)" stroke="var(--amber)" strokeWidth="1.5" />
          <text x="485" y="232" textAnchor="middle" fill="var(--amber)" fontSize="13" fontWeight="700">37 watchlist</text>
          <path d="M235 199 L 235 210 M485 199 L 485 210 M235 199 L 485 199 M360 187 L 360 199" fill="none" stroke="var(--border)" strokeWidth="1.5" />
        </svg>
        <p style={captionStyle}>
          348 tickers priced, 53 in a controlled pullback, 50 of those with acceptable business quality, 13 with a
          live two-leg market &mdash; and <strong>3</strong> that cleared every structure gate. A further 10 were
          dropped outright for earnings. Three actionable results from 348 is a normal outcome, not a broken scan.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Running the scan, control by control
      </h3>
      <p style={{ marginBottom: '0.5rem' }}>
        Start with the <strong>Include</strong> row (Stocks, Index ETFs, Sector &amp; commodity ETFs) and a
        <strong> preset</strong>. Conservative wants confirmed uptrends, 20-delta shorts, 5% cushion and 100 open
        interest; Balanced is the conventional 25-delta write; Aggressive adds mid caps, drops the 200-day requirement,
        and tolerates 40% slippage. The preset button highlights only while the filters still match it exactly, so any
        hand edit deselects it.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Stock universe:</strong> large caps, large+mid, mid only, your holdings, your watchlist, or a custom ticker list. ETF inclusion is separate, via the Include checkboxes.</li>
        <li><strong>Min / Max pullback:</strong> the size of the dip, in percent, with separate lower ETF bounds since indexes move less than single names.</li>
        <li><strong>Min / Max stretch (σ):</strong> recent log-return decline &divide; (prior daily volatility &times; &radic;Lookback). With 1% daily volatility, a normal 21-day move is about 4.6%, so a roughly 6.9% dip is about 1.5&sigma;. The minimum requires a meaningful dip; the maximum rejects a dislocation too severe for a defined-risk trade.</li>
        <li><strong>Min / Max RSI:</strong> soft but not exhausted. Balanced uses 35&ndash;58.</li>
        <li><strong>Min mkt cap / ETF min AUM / Min $ volume:</strong> size and tradability floors. Dollar volume is the best single proxy for how tight the option market will be.</li>
        <li><strong>Lookback:</strong> historical trading days in the pullback window, 21 by default. Raising it changes both the return being measured and the &radic;Lookback term in Sigma Stretch.</li>
        <li><strong>Target DTE:</strong> 35 by default. It is independent of Lookback and Sigma Stretch; it only guides the listed expiration selected, and the scanner never substitutes a very short one to dodge an earnings report.</li>
        <li><strong>Short delta / Long delta:</strong> where the two legs sit. 0.25 short and 0.10 long is the Balanced pair. Raising short delta raises the credit and lowers the probability of keeping it &mdash; that trade is the whole strategy.</li>
        <li><strong>Min / Max width:</strong> strike width as a percentage of spot, which bounds the maximum loss.</li>
        <li><strong>Min credit (% width):</strong> the anti-token-premium gate. Below about 20% of width you are taking real defined risk for very little.</li>
        <li><strong>Min cushion:</strong> how far the stock can fall before the trade loses at expiration.</li>
        <li><strong>Min leg OI:</strong> applied to the <em>thinner</em> of the two legs.</li>
        <li><strong>Max slippage (% credit):</strong> both bid/ask spreads measured against the credit. A spread that looks good at the mid and is unfillable at the natural fails here.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        The six checkboxes are the structural safety rails: price above the 200-day, 50-day above the 200-day,
        profitable companies only, skip fresh 52-week lows, skip earnings inside the trade, and skip leveraged or
        inverse ETFs. The earnings skip removes the ticker entirely rather than working around the report.
      </p>

      <HelpScreenshot
        src="./help-screenshots/bull-put-spread-scanner/01-scanner-overview.png"
        alt="Bull Put Spread Scanner showing the include row, presets, the full filter panel, the scan funnel stats line, and the actionable spreads table with suggested strikes, credit, risk, cushion, probability out of the money, and buy-back price"
        caption={<>
          The live screen. Each actionable row names the exact spread to sell, the credit, maximum profit against
          maximum loss, the breakeven cushion, modeled probability out of the money, and the buy-back limit.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Reading a row and its expansion
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>Trend</strong> column is two independent lights: <em>200</em> is green when price is above the
        200-day, <em>50/200</em> when the 50-day is above the 200-day. <strong>Pullback</strong> shows the dip and the
        σ underneath. <strong>IV/RV</strong> above 1.0 means the option market is charging more than recent realized
        movement &mdash; you want that as a seller, and one of the pictured results sat at 0.88, which is a genuine
        mark against it even though everything else passed.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Click the row to expand. You get a plain-language verdict, the probability cards, the four score bars, and the
        full quote detail. The score is out of 100: <strong>Setup 30</strong> (pullback, RSI, 200-day, 50/200 structure),
        <strong> Quality 20</strong> (the same profitability, balance-sheet, size and liquidity model as Put Selling),
        <strong> Premium 25</strong> (IV over realized vol, credit against realized-vol fair value, annualized return on
        risk), and <strong>Safety 25</strong> (modeled probability out of the money, cushion, two-leg execution cost,
        open interest, and whether the natural fill is still a credit). A dashed grade badge with an asterisk means no
        live spread could be priced, and those partial scores always sort below fully priced ones.
      </p>
      <HelpScreenshot
        src="./help-screenshots/bull-put-spread-scanner/02-expanded-row.png"
        alt="Expanded Bull Put Spread row showing the verdict, probability cards, Setup Quality Premium and Safety score bars, both leg quotes, mid versus natural credit, breakeven and cushion, and the management plan"
        caption={<>
          Check <strong>Mid / natural credit</strong> before anything else. The scanner ranks on the mid; the natural is
          what you would actually get by hitting the market, and the gap between them is your real execution cost.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Actionable versus watchlist
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Actionable Spreads</strong> meet every price, quality, event, liquidity, and structure gate.
        With the earnings skip enabled, a stock whose report falls within Target DTE plus the safety buffer is removed
        entirely. <strong>Watchlist Candidates</strong> remain visible when the chain is unavailable or no spread clears
        every hard gate. A relaxed fallback is never promoted to the actionable table.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        The watchlist Status column tells you which one it was: <em>Earnings inside trade</em>,
        <em> Structure limits missed</em>, <em>No quotable spread</em>, or <em>Awaiting live pricing</em>. That
        distinction matters &mdash; &ldquo;structure limits missed&rdquo; is a filter you could reasonably loosen,
        while &ldquo;no quotable spread&rdquo; means the market is not there to trade.
      </p>
      <HelpScreenshot
        src="./help-screenshots/bull-put-spread-scanner/03-watchlist.png"
        alt="Bull Put Spread Scanner watchlist candidates table showing per-ticker status reasons such as earnings inside trade, structure limits missed, and no quotable spread"
        caption={<>
          The watchlist is usually far longer than the actionable table, and it is where you learn which gate is
          binding on your current settings.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Management</h3>
      <p style={{ marginBottom: '1rem' }}>
        The result includes a buy-back target that captures roughly 50&ndash;65% of the original credit, a defensive
        debit near twice the credit, a DTE checkpoint, and a default instruction to close before the final three days.
        Short puts can be assigned before expiration, and pin risk rises near expiration, so the page treats monitoring
        and an early closing plan as part of the setup rather than an afterthought. The last of the credit is
        precisely the part you are paid least for and carry the most assignment risk to collect.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Suggested workflow</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Pick the Include boxes and a preset. Balanced on large caps plus index ETFs is the sane starting point.</li>
        <li>Run the scan and read the funnel line before the table. If <em>controlled pullbacks</em> is near zero, the market is not offering this setup today and no filter tweak will conjure one.</li>
        <li>Work the Actionable table first. Sort by <strong>Cushion</strong> or <strong>Prob. OTM</strong> rather than by score when you want safety, and by <strong>Credit / Risk</strong> when you want return.</li>
        <li>Expand the best candidate. Read the verdict, then mid versus natural credit, then the two leg quotes and thinner-leg OI.</li>
        <li>Open the risk graph to confirm the strikes, width, breakeven, maximum profit, and maximum loss.</li>
        <li>Enter as one vertical limit order at or near the mid. Never leg into it.</li>
        <li>Set the buy-back limit at the same time you open the trade, and diary the reassessment DTE.</li>
      </ol>

      <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
        The scanner is a research and ranking tool, not an order ticket. Verify the quotes as one vertical limit order,
        check earnings and other events again before entry, and size from maximum loss rather than the credit received.
        On the pictured trade that means budgeting $1,180 per contract, not $320.
      </div>
    </div>
  )
}

function BearPutSpreadScannerHelp() {
  const captionStyle = {
    margin: '0.45rem 0 0',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  }

  const figureStyle = {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1.5rem',
  }

  return (
    <div>
      <h2>Bear Put Spread Scanner</h2>
      <p style={{ marginBottom: '1rem' }}>
        The third screen in the options family, and the only one where you <em>pay</em> rather than collect. A bear put
        spread buys a higher-strike put and sells a lower-strike put in the same expiration: the debit is the entire
        risk, the width minus the debit is the entire reward, and the trade only pays if the underlying actually falls
        to the short strike. The scanner finds names whose breakdown has <em>started but not finished</em>, then prices
        a specific vertical on each one.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 1: the shape inverts
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A real scanned result on a true scale: SMH at $540.53, buy the $520 put and sell the $430 put 48 days out for a
        $21.85 debit. Compare this against the bull put spread picture and the difference is the whole point of a debit
        trade.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 300" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Bear put spread payoff showing a 6815 dollar maximum profit below the 430 short strike and a 2185 dollar maximum loss above the 520 long strike, with breakeven at 498.15">
          <line x1="50" y1="190" x2="700" y2="190" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="290" textAnchor="end" fill="var(--text-dim)" fontSize="11">Stock price at expiration →</text>

          <line x1="176" y1="50" x2="176" y2="262" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
          <line x1="525" y1="50" x2="525" y2="262" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
          <line x1="605" y1="120" x2="605" y2="262" stroke="var(--accent)" strokeDasharray="2 4" strokeWidth="1" />

          <path d="M440 190 L 605 190" stroke="var(--amber)" strokeWidth="6" opacity="0.25" />
          <text x="522" y="182" textAnchor="middle" fill="var(--amber)" fontSize="10.5">must fall 7.9% just to break even</text>

          <polyline points="60,60 176,60 440,190 525,232 680,232"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />

          <circle cx="440" cy="190" r="4" fill="var(--amber)" />
          <circle cx="605" cy="232" r="4" fill="var(--accent)" />

          <text x="118" y="52" textAnchor="middle" fill="var(--pos)" fontSize="11.5" fontWeight="700">Max profit +$6,815</text>
          <text x="118" y="80" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">below the $430 short</text>

          <text x="176" y="278" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">$430 short</text>
          <text x="525" y="278" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">$520 long</text>
          <text x="440" y="208" textAnchor="middle" fill="var(--amber)" fontSize="10.5">breakeven $498.15</text>
          <text x="605" y="114" textAnchor="middle" fill="var(--accent)" fontSize="10.5">today $540.53</text>

          <text x="640" y="252" textAnchor="end" fill="var(--neg)" fontSize="11.5" fontWeight="700">Max loss −$2,185</text>
          <text x="640" y="266" textAnchor="end" fill="var(--text-dim)" fontSize="10.5">the debit, lost in full if nothing happens</text>
        </svg>
        <p style={captionStyle}>
          Risk $2,185 to make $6,815 &mdash; a <strong>3.12:1</strong> reward-to-risk, the mirror image of the bull put
          spread&rsquo;s thin sliver. But look at the amber bar: the stock has to fall <strong>7.9% just to reach
          breakeven</strong> and 20.4% to collect the maximum. On the selling screens you win by default; here nothing
          happening loses the entire debit.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Why this is not the Put Selling Scanner run backwards
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Both obvious screens are wrong, and each one is wrong by being another scanner&rsquo;s screen. &ldquo;Find
        whatever just crashed and buy puts&rdquo; is precisely the Put Selling Scanner&rsquo;s setup &mdash; a name
        down three standard deviations, deeply oversold, printing fresh 52-week lows, is where put <em>sellers</em> get
        paid for taking the bounce. Buying downside there means paying peak implied volatility for the last leg of a
        move already made. &ldquo;Buy puts on whatever looks overbought&rdquo; is the Covered Call Scanner&rsquo;s
        setup, and it fails the same way that screen fails: the strongest names keep going up.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        So this screen asks for the awkward middle. Trend structure has genuinely turned and the name is
        underperforming the market with momentum still rolling over, but it is not yet spent. Names at fresh lows are
        excluded by default, and the size of the decline is scored as a <strong>band</strong> rather than a ramp:
        roughly 1&ndash;2&sigma; earns full credit and credit falls away above 2.5&sigma;, because past that you are
        paying for a move that is behind you. That single inversion is the difference between this screen and the put
        screen read upside-down.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 2: the band, not a ramp
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        This is the single most important idea on the screen. Every other scanner scores &ldquo;more is better&rdquo;
        on its headline measure. Here, more stops being better and starts being worse.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 265" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Trapezoid showing decline-size credit peaking between 1 and 2 sigma and falling away above 2.5 sigma, with the washed-out crash zone marked as the put seller's setup">
          <line x1="60" y1="200" x2="680" y2="200" stroke="var(--border)" strokeWidth="1" />
          {[0, 1, 2, 3, 4].map(tick => (
            <g key={tick}>
              <line x1={60 + tick * 150} y1="200" x2={60 + tick * 150} y2="206" stroke="var(--border)" strokeWidth="1" />
              <text x={60 + tick * 150} y="220" textAnchor="middle" fill="var(--text-dim)" fontSize="11">{tick}σ</text>
            </g>
          ))}
          <text x="680" y="240" textAnchor="end" fill="var(--text-dim)" fontSize="11">size of the decline, in this name&rsquo;s own standard deviations →</text>

          <path d="M135 200 L 210 90 L 360 90 L 510 200 Z" fill="var(--accent-bright)" opacity="0.18" />
          <polyline points="135,200 210,90 360,90 510,200" fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />

          <text x="285" y="80" textAnchor="middle" fill="var(--accent-bright)" fontSize="12.5" fontWeight="700">full credit</text>
          <text x="285" y="120" textAnchor="middle" fill="var(--text-muted)" fontSize="11">breakdown started,</text>
          <text x="285" y="135" textAnchor="middle" fill="var(--text-muted)" fontSize="11">not finished</text>

          <text x="95" y="178" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">nothing</text>
          <text x="95" y="192" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">broken yet</text>

          <text x="600" y="150" textAnchor="middle" fill="var(--neg)" fontSize="11.5" fontWeight="700">crash-chasing</text>
          <text x="600" y="166" textAnchor="middle" fill="var(--text-muted)" fontSize="10.5">the put SELLER&rsquo;s setup —</text>
          <text x="600" y="180" textAnchor="middle" fill="var(--text-muted)" fontSize="10.5">peak IV, move already made</text>
          <text x="600" y="194" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">fresh lows excluded outright</text>

          <circle cx="255" cy="90" r="5" fill="var(--pos)" />
          <text x="255" y="60" textAnchor="middle" fill="var(--pos)" fontSize="11" fontWeight="700">SMH at 1.3σ</text>

          <line x1="135" y1="45" x2="135" y2="200" stroke="var(--amber)" strokeDasharray="4 3" strokeWidth="1" />
          <line x1="435" y1="45" x2="435" y2="200" stroke="var(--amber)" strokeDasharray="4 3" strokeWidth="1" />
          <text x="135" y="38" textAnchor="middle" fill="var(--amber)" fontSize="10">Min stretch 0.5σ</text>
          <text x="435" y="38" textAnchor="middle" fill="var(--amber)" fontSize="10">Max stretch 2.5σ</text>
        </svg>
        <p style={captionStyle}>
          The two amber lines are the Balanced preset&rsquo;s <strong>Min stretch</strong> and
          <strong> Max stretch</strong>. Max stretch is the gate that stops this becoming a crash-chaser, and it is the
          one most likely to be loosened for the wrong reason: widening it to 4σ will absolutely produce more
          candidates, and they will be exactly the names the Put Selling Scanner wants to sell puts on.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How candidates are scored</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Breakdown (30 points)</strong> — trend structure is worth 12: below the 50-day (4), the 20-day under the 50-day (3), the 50-day under the 200-day (3), and a break less than 15 sessions old (2). Relative weakness of 1&ndash;12pp earns 0&ndash;8. Momentum rolling over earns up to 6 &mdash; 3&ndash;20 points of RSI decline earns 0&ndash;4, plus 2 for a lower high. The last 4 come from the decline-size band.</li>
        <li><strong>Room to fall (20 points)</strong> — the payoff is capped at the short strike, so distance has to be left. Sitting 5&ndash;40% above the 52-week low earns 0&ndash;8; 25&ndash;80% of the way up the 52-week range earns 0&ndash;6; and a band on the drawdown gives the last 6, peaking between 6% and 25% off the high.</li>
        <li><strong>Structure (30 points)</strong> — needs a live chain. Reward-to-risk from 1:1 to 3:1 earns 0&ndash;9. A band on the required move earns 0&ndash;8, peaking where the short strike sits about 0.65&ndash;1.10 expected moves away. Edge from &minus;15% to +40% earns 0&ndash;8. A put-skew ratio from 1.00 to 1.25 earns 0&ndash;5. Earnings before expiry subtract 6.</li>
        <li><strong>Executability (20 points)</strong> — underlying size (4) and share liquidity (4) need no chain. The rest does: combined two-leg slippage from 40% down to 8% of the debit earns 0&ndash;7, and open interest on the thinner leg earns 0&ndash;5.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Grades are <strong>A &ge; 80, B &ge; 70, C &ge; 60, D &ge; 50</strong>, otherwise F, calibrated against the
        other two option screens so a C means the same thing on all three. A grade with an asterisk and a dashed
        outline had no option chain, so it is rescaled from the 58 points that could still be scored &mdash; the same
        partial budget the Covered Call Scanner uses &mdash; and partial scores always sort below fully priced ones.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Edge: what the spread is worth versus what it costs
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Edge</strong> compares the debit against what the vertical would be worth if the stock simply kept
        moving the way it has actually been moving &mdash; priced off its own <em>realized</em> volatility, with no
        assumed direction at all. Positive means the market is charging less than the name&rsquo;s own movement
        justifies; negative means you are overpaying, which is the usual state of affairs after a scare. The comparison
        is deliberately direction-neutral so it cannot double-count the bearish thesis that Breakdown already scores,
        and it is why there is no separate implied-versus-realized term: a spread priced off inflated implied
        volatility simply fails to beat the realized-volatility value. Note that <strong>IV/RV</strong> reads the
        opposite way here than on the two selling screens &mdash; on this screen you are the buyer, so above 1.0 is a
        cost and it is coloured red.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Strike selection and the two-leg fill
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Rather than mechanically taking &ldquo;the 50-delta and the 25-delta&rdquo;, the scanner enumerates every
        plausible strike pair inside your delta bands and width window, then picks the best. A vertical has two free
        parameters that trade directly against each other &mdash; pay more for a nearer target, or less for one
        further away &mdash; and which end wins depends on the chain&rsquo;s skew and liquidity, not on a rule of
        thumb. <strong>Needs</strong> reports the distance to the short strike both as a percentage and as a multiple
        of the move this name would ordinarily make over the life of the trade; above about 2&sigma; the target is a
        lottery ticket however good the reward-to-risk looks.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        A covered call or cash-secured put crosses one bid/ask spread. A vertical crosses two, and both come out of
        the debit. <strong>Slippage</strong> adds the width of both quotes as a share of what you are paying: at 8% it
        is noise, at 30% it has quietly turned a 2:1 reward-to-risk into something nearer 1.4:1. Only strikes where
        <em> both</em> sides of the market are live and uncrossed are considered, because a one-sided quote makes the
        whole debit fictional.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Managing the trade</h3>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Take profit at</strong> is set as a share of <em>max profit</em> rather than of a credit, because
        there is no credit &mdash; 75% for strong setups, 65% for balanced, 50% for anything carrying a warning.
        Holding for the last slice requires the stock to sit still through the most gamma-sensitive stretch of the
        trade. <strong>Stop at</strong> is a discipline stop even though the risk is already capped: recovering half
        the debit funds the next attempt. <strong>Reassess by</strong> is a time stop &mdash; a directional debit
        spread that has not worked by the time decay bites is a wrong thesis, not an early one. And
        <strong> Invalidate above</strong> names the level that kills the reason for the trade: a close back above the
        nearest moving average the stock just lost.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Hedging what you own</h3>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Shares</strong> column shows any position you hold and how many contracts would cover it, one per
        100 shares. That is the screen&rsquo;s second use: when a holding breaks down, a bear put spread defines the
        downside for a known, capped cost instead of selling the position and triggering a taxable gain. It is a
        partial hedge only &mdash; protection stops at the short strike, and the debit is spent whether or not the
        stock falls. The <strong>Hedge my holdings</strong> preset scans your own positions and loosens the
        relative-weakness and fresh-low gates, since for a hedge what matters is that <em>this</em> position is
        falling, not that it is falling faster than the market.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        The controls, one by one
      </h3>
      <p style={{ marginBottom: '0.5rem' }}>
        Four presets. <strong>Conservative</strong> demands a confirmed downtrend, 2pp of relative weakness, a debit
        under 45% of width and a target within 1.5σ. <strong>Balanced</strong> needs only a broken 50-day and the
        conventional 50/25-delta vertical. <strong>Hedge my holdings</strong> scans your own positions and drops the
        relative-weakness and fresh-low gates. <strong>Aggressive</strong> widens the universe and accepts wider,
        cheaper spreads that need a bigger move.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Min / Max stretch (σ):</strong> the band from the picture above. Max stretch is the load-bearing one.</li>
        <li><strong>Min / Max RSI:</strong> a floor <em>and</em> a ceiling. Below the floor the name is washed out and the next move is as likely to be the bounce; above the ceiling it has not rolled over yet.</li>
        <li><strong>Min vs market (pp):</strong> how far the name must lag the beta-adjusted market. ETFs get their own floor, usually 0, because a fund tracks its benchmark by construction &mdash; SPY has no weakness against itself.</li>
        <li><strong>Max drawdown:</strong> skip names already this far off the 52-week high. The payoff is capped at the short strike, so most of the move has to still be available.</li>
        <li><strong>Min above low:</strong> minimum room left above the 52-week low. Same logic from the other end.</li>
        <li><strong>Min mkt cap / Small-cap min cap / ETF min AUM / Min $ volume:</strong> size and liquidity floors, all set higher than on the single-leg screens because a vertical has to fill on two legs.</li>
        <li><strong>Target DTE:</strong> 45 by default, deliberately longer than a credit trade wants. A debit spread needs time for the move to happen, and buying too little of it is the most common way a correct call still loses money.</li>
        <li><strong>Long delta / Short delta:</strong> 0.50 and 0.25 by default. Lowering the short delta widens the spread &mdash; cheaper as a share of width, but a bigger move required.</li>
        <li><strong>Max debit (% of width):</strong> above 50% you are risking more than you can make. 33% is a clean 2:1.</li>
        <li><strong>Min R:R</strong> and <strong>Max move needed (σ):</strong> the two halves of the same judgement. A 4:1 spread that needs a 3σ move is a lottery ticket, and Max move needed is what rejects it.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        The checkboxes: <strong>Require price below the 50-day</strong> (the minimum definition of a broken trend),
        <strong> Require 50-day below 200-day</strong> (a confirmed downtrend, far fewer candidates),
        <strong> Skip fresh 52-wk lows</strong>, <strong>Skip earnings inside trade</strong>, and
        <strong> Skip leveraged / inverse ETFs</strong>.
      </p>

      <HelpScreenshot
        src="./help-screenshots/bear-put-spread-scanner/01-scanner-overview.png"
        alt="Bear Put Spread Scanner showing the four presets, the filter panel, the scan funnel stats line, and the actionable spreads table with trend lights, move in sigma, versus market, RSI, IV over RV, the suggested spread, risk and reward, the move needed, edge, and exit plan"
        caption={<>
          The live screen. The <strong>Trend</strong> cell is three lights (20-day, 50-day, downtrend), <strong>Move</strong>
          carries the σ underneath the percentage, and <strong>Needs</strong> gives the distance to the short strike both
          as a percentage and in expected moves.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Reading a row
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Read <strong>Needs</strong> before you read <strong>Risk / Reward</strong>. A 3.5:1 spread that needs 1.03σ and
        a 2.6:1 spread that needs 1.13σ are much closer trades than the ratios suggest, and the σ figure is what tells
        you so. Then read <strong>Edge</strong>: positive means the market is charging less than the name&rsquo;s own
        realized movement justifies. In the pictured scan the leaders ran +26% to +40%, while some rows were negative
        &mdash; paying up for a move after the scare, which is the usual state of affairs.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Warnings</strong> column earns its place here. <em>Slippage</em> appeared on most of the pictured
        results, and on a debit trade slippage comes straight out of the reward-to-risk you were sold on.
        <em> Bounced</em> means the name has already started recovering off its low.
      </p>
      <HelpScreenshot
        src="./help-screenshots/bear-put-spread-scanner/02-expanded-row.png"
        alt="Expanded Bear Put Spread row showing the four score bars, both leg quotes with deltas, the debit against realized-volatility fair value, and the exit plan with take profit, stop, reassess by, and invalidate above levels"
        caption={<>
          The expansion carries the score breakdown, both leg quotes, and the four-part exit plan &mdash; take profit,
          stop, reassess by, and the price that invalidates the thesis outright.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Pick a <strong>preset</strong>. Conservative wants a confirmed downtrend and a cheap, reachable spread; <strong>Hedge my holdings</strong> scans what you already own.</li>
        <li>Add <strong>Index ETFs</strong> or <strong>Sector &amp; commodity ETFs</strong> with the independent Include checkboxes; an ETF-only scan finishes in seconds.</li>
        <li>Set <strong>Target DTE</strong> to anything from a few days to a LEAP &mdash; the scanner takes the listed expiration nearest to it and nothing clips your choice.</li>
        <li>Click <strong>Run Scan</strong>. The first run pulls a year of history and takes roughly 20&ndash;40 seconds; the price <em>and</em> option-chain caches are shared with the Put Selling Scanner, so running one after the other is much faster.</li>
        <li>Click any row for the score breakdown, both legs with their quotes, the exit plan, and the breakdown metrics.</li>
        <li>Click the ticker to pull up its price chart with moving averages, MACD, and RSI.</li>
      </ol>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
        <strong>No trades execute here.</strong> The scanner rates setups from public market data. Scores are not
        advice. A bear put spread is a directional bet that expires: unlike selling premium, time works against you
        every day, and the entire debit is lost if the stock simply goes nowhere. Both selling screens can be wrong
        and still profit; this one cannot.
      </div>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        If a scan returns nothing, that is usually correct rather than broken &mdash; the gates here are deliberately
        narrow, and in a rising market very few names qualify. Lower <strong>Min vs market</strong>, widen the RSI
        band, untick <strong>Require 50-day below 200-day</strong>, or widen the universe. If candidates appear but
        none get a spread, loosen <strong>Max debit</strong> or <strong>Min R:R</strong>.
      </div>
    </div>
  )
}

function BearCallSpreadScannerHelp() {
  const captionStyle = {
    margin: '0.45rem 0 0',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  }

  const figureStyle = {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1.5rem',
  }

  return (
    <div>
      <h2>Bear Call Spread Scanner</h2>
      <p style={{ marginBottom: '1rem' }}>
        The fifth screen in the options family, and the bearish way to <em>collect</em> premium rather than pay it. A
        bear call spread sells a lower-strike call and buys a higher-strike call in the same expiration: the credit is
        the entire reward, the width minus the credit is the entire risk, and down, sideways, or up a little all win.
        Only a rally loses. The scanner finds rallies that have been <em>refused</em> under overhead supply, then prices
        a specific vertical on each one.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 1: the payoff, and where the strike goes
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A real scanned result on a true scale: Costco at $951.89, sell the $975 call and buy the $1010 call 27 days out
        for a $9.75 credit. The grey band is the overhead level the scanner found &mdash; a 200-day average sitting just
        0.6% above the price &mdash; and note where the short strike was placed relative to it.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 360" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Bear call spread payoff showing 975 dollars maximum profit below the 975 strike, a 2525 dollar maximum loss above 1010, breakeven at 984.75, and the 200-day resistance level sitting below the short strike">
          <line x1="50" y1="170" x2="700" y2="170" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="352" textAnchor="end" fill="var(--text-dim)" fontSize="11">Stock price at expiration →</text>

          <rect x="222" y="60" width="18" height="270" fill="var(--text-dim)" opacity="0.22" />
          <text x="231" y="52" textAnchor="middle" fill="var(--text-muted)" fontSize="10.5">200-day wall</text>

          <line x1="339" y1="70" x2="339" y2="330" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
          <line x1="556" y1="70" x2="556" y2="330" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
          <line x1="196" y1="120" x2="196" y2="330" stroke="var(--accent)" strokeDasharray="2 4" strokeWidth="1" />

          <polyline points="60,105 339,105 400,170 556,338 680,338"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />

          <circle cx="400" cy="170" r="4" fill="var(--amber)" />
          <circle cx="196" cy="105" r="4" fill="var(--accent)" />

          <text x="150" y="95" textAnchor="middle" fill="var(--pos)" fontSize="11.5" fontWeight="700">Max profit +$975</text>
          <text x="150" y="140" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">down, flat, or up a little</text>
          <text x="196" y="114" textAnchor="middle" fill="var(--accent)" fontSize="10.5">today $951.89</text>

          <text x="339" y="348" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">$975 short</text>
          <text x="556" y="348" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">$1010 long</text>
          <text x="400" y="190" textAnchor="middle" fill="var(--amber)" fontSize="10.5">breakeven $984.75 · only 3.5% up</text>

          <text x="670" y="320" textAnchor="end" fill="var(--neg)" fontSize="11.5" fontWeight="700">Max loss −$2,525</text>
          <text x="670" y="334" textAnchor="end" fill="var(--text-dim)" fontSize="10.5">2.6× the credit you collected</text>
        </svg>
        <p style={captionStyle}>
          Three things at once. The <strong>reward is the thin plateau</strong> and the risk is 2.6× larger &mdash; size
          from $2,525, never from $975. The <strong>cushion is only 3.5%</strong>, or 0.54 expected moves, which is
          uncomfortably little. And the short strike sits <em>above</em> the 200-day wall, so price has to break
          something structural before the trade starts losing. That last part is what this screen does that no other one does.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Why this is not the Covered Call Scanner without the shares
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The obvious screen &mdash; &ldquo;find the most overbought names, their call premium is fattest&rdquo; &mdash;
        is the Covered Call Scanner&rsquo;s setup, and that screen already warns overbought alone is a trap. Here the
        failure is <em>categorically</em> worse. A covered call writer who gets run over delivers shares they already
        own: a capped gain, an opportunity cost, an annoyance. This trade owns nothing, so a rally through the short
        strike is a realized cash loss up to the full width. The identical setup that merely disappoints a call writer
        genuinely loses money here &mdash; which is why accelerating momentum, fresh 52-week highs, market leadership,
        and a hard run off the recent low are all <strong>excluded by default</strong> rather than merely flagged.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The second temptation, &ldquo;sell calls on whatever just crashed, the implied vol is huge&rdquo;, fails twice
        over. The sharpest rallies in the market happen inside downtrends, and a short squeeze runs to the full width
        while the credit caps the gain at a nickel. And after a capitulation the <em>call</em> skew flattens or inverts
        &mdash; puts are bid, calls are cheap &mdash; so you are paid least exactly where the realized upside risk is
        highest. When a name is genuinely breaking down, the Bear Put Spread Scanner pays you for the move instead of
        capping you at a credit.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        So this screen asks for the awkward middle: a bounce that has <strong>stopped</strong>. Rally size is scored as
        a <strong>band</strong> rather than a ramp &mdash; roughly 0.75&ndash;2&sigma; earns full credit and credit
        falls away above 3&sigma; &mdash; and relative performance is gated as a <em>maximum</em>, the only screen in
        the family where outperformance disqualifies a candidate.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 2: three charts, only one of them yours
      </h3>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 220" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Three price path sketches: an accelerating breakout to fresh highs which is excluded, a collapsed name which belongs to the bear put screen, and a rally that stalled under a declining average which is this screen's setup">
          {[
            {
              x: 10, title: 'Still climbing', color: 'var(--neg)', verdict: 'EXCLUDED',
              path: 'M30 150 L 70 135 L 110 115 L 150 80 L 190 40',
              note: 'accelerating into fresh highs',
              note2: 'the Covered Call screen — and here it',
              note3: 'costs the full width, not a capped gain',
            },
            {
              x: 245, title: 'Already collapsed', color: 'var(--neg)', verdict: 'WRONG SCREEN',
              path: 'M30 45 L 70 70 L 110 115 L 150 145 L 190 155',
              note: 'call skew flat, credit tiny,',
              note2: 'sharpest rallies live in downtrends —',
              note3: 'Bear Put Spread pays you for this instead',
            },
            {
              x: 480, title: 'Rally refused', color: 'var(--pos)', verdict: 'THIS SCREEN',
              path: 'M30 140 L 70 105 L 110 78 L 150 88 L 190 96',
              note: 'bounce into a declining average,',
              note2: 'lower high, momentum rolling over,',
              note3: 'a wall to place the strike behind',
            },
          ].map(panel => (
            <g key={panel.title} transform={`translate(${panel.x}, 0)`}>
              <rect x="10" y="18" width="215" height="185" rx="5"
                fill="var(--surface-inset)" stroke={panel.color} strokeWidth="1.5" />
              <text x="117" y="38" textAnchor="middle" fill={panel.color} fontSize="12.5" fontWeight="700">{panel.title}</text>
              {panel.title === 'Rally refused' && (
                <line x1="28" y1="68" x2="200" y2="86" stroke="var(--text-dim)" strokeDasharray="4 3" strokeWidth="1.5" />
              )}
              <path d={panel.path} fill="none" stroke={panel.color} strokeWidth="2.5"
                strokeLinejoin="round" strokeLinecap="round" transform="translate(0, 22)" />
              <text x="117" y="182" textAnchor="middle" fill="var(--text-muted)" fontSize="9.5">{panel.note}</text>
              <text x="117" y="193" textAnchor="middle" fill="var(--text-muted)" fontSize="9.5">{panel.note2}</text>
              <text x="117" y="204" textAnchor="middle" fill="var(--text-dim)" fontSize="9.5">{panel.note3}</text>
              <text x="117" y="12" textAnchor="middle" fill={panel.color} fontSize="10" fontWeight="700">{panel.verdict}</text>
            </g>
          ))}
        </svg>
        <p style={captionStyle}>
          The dashed line in the third panel is a flat-or-declining moving average. That detail is load-bearing: a
          <em> rising</em> average that price has just slipped under is support about to be reclaimed, and treating it
          as a ceiling would put your short strike directly in the path of the next leg up &mdash; which is the Bull Put
          Spread Scanner&rsquo;s setup, not this one.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How candidates are scored</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Rejection (30 points)</strong> — a band on the rally size earns 0&ndash;8. Structure is worth 7: the last week failing to take out the fortnight&rsquo;s high (4) and this rally topping below the previous one (3). Momentum rolling over earns 7, cooling momentum 0&ndash;4, and lagging the market 0&ndash;4. Then the penalties, which are heavy on purpose: fresh highs cost 10, acceleration up to 6, leadership up to 6, a squeeze off the low up to 8, and overbought-and-still-rising 5. The axis floors at zero.</li>
        <li><strong>Ceiling (20 points)</strong> — a band on the distance to the nearest overhead level earns 0&ndash;8, peaking when the wall is 0.5&ndash;6% above. A confirmed downtrend earns 4, sitting under a flat-or-falling 50-day earns 4, and a band on position in the 52-week range gives the last 4, peaking mid-range.</li>
        <li><strong>Credit (25 points)</strong> — needs a live chain. IV/RV from 0.95 to 1.45 earns 0&ndash;8, edge over realized-vol fair value from 0% to +35% earns 0&ndash;7, annualized return on risk from 15% to 55% earns 0&ndash;6, and credit as a share of width from 15% to 35% earns 0&ndash;4.</li>
        <li><strong>Safety (25 points)</strong> — size (3) and share liquidity (3) need no chain. The rest does: P(OTM) 0&ndash;5, breakeven cushion 0&ndash;4, two-leg slippage 0&ndash;3, open interest on the thinner leg 0&ndash;2, a credit that survives crossing both markets 2, and a short strike above the wall 3. Deductions: earnings before expiry 8, a dividend inviting early assignment 6 (3 if merely elevated), and an upside wing above 1.05 up to 4.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Grades are <strong>A &ge; 80, B &ge; 70, C &ge; 60, D &ge; 50</strong>, otherwise F, calibrated against the
        other four option screens so a C means the same thing on all five. A grade with an asterisk and a dashed outline
        had no option chain, so it is rescaled from the 56 points that could still be scored, and partial scores always
        sort below fully priced ones.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        The ceiling: where the short strike goes
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        Unique to this screen. Rather than taking whatever strike the target delta lands on, the scanner identifies every
        overhead level above the current price &mdash; a flat or declining 20-, 50-, or 200-day average, the 20-day or
        3-month swing high, the 52-week high &mdash; and prefers pairs whose short strike sits <em>above</em> the nearest
        one, so price has to break something structural before the trade starts losing. It is the Covered Call
        Scanner&rsquo;s cost-basis strike floor applied to a technical level, and it relaxes the same way when no listed
        strike clears it. Crucially a moving average only counts as resistance when it is flat or <em>falling</em>: a
        rising average price has just slipped under is support about to be reclaimed, and treating it as a ceiling would
        put the short strike directly in the path of the next leg up &mdash; which is the Bull Put Spread
        Scanner&rsquo;s setup, not this one.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Why IV/RV and the volatility wing both flip sign here
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        <strong>IV/RV</strong> reads the opposite way to the Bear Put Spread Scanner. There you are the buyer, so
        implied vol above realized is a cost, coloured red. Here you are the seller, so rich implied vol is the point,
        coloured green. The volatility <strong>wing</strong> inverts too. The bear put screen treats a steep put skew as
        its one structural gift, because you sell the fatter vol. Here a steep upside wing is a <em>warning</em>, because
        it prices the exact move that costs you the width. <strong>Upside tail</strong> is the median implied vol of the far
        out-of-the-money calls against at-the-money; above about 1.05 the market is paying for a jump, which is the
        closest thing to a squeeze or takeover warning available from chain data alone. It needs at least five genuinely
        quoted far strikes to be reported at all — below that it reads as a dash and is charged nothing, because far
        strikes on thin chains carry stale marks rather than prices.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        That comparison is made against at-the-money rather than between the two legs for a measured reason. Sampling
        live chains at the 25- and 10-delta calls, the leg-to-leg ratio straddles 1.0 with a median near 0.97 for single
        names: the equity call wing turns back <em>up</em> at far strikes rather than sloping down, so only broad index
        funds show the clean downward call skew the textbooks describe (SPY around 1.12, most single names below parity).
        A &ldquo;the nearer leg should carry more vol&rdquo; test would fire on most of the market and mean nothing. The
        leg-to-leg ratio is still shown as <strong>Call skew (legs)</strong> for context, but it is not scored.
        <strong> Edge</strong> compares the credit to a realized-volatility fair value; because pricing a call spread
        with no drift flatters the seller slightly, the scoring ramp for edge starts at zero rather than below it.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        The two risks only a short call faces
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Early assignment for a dividend.</strong> A call holder exercises early only to capture a dividend, and
        only once the remaining extrinsic value is worth less than that dividend &mdash; which happens the day before
        the ex-date. In a covered call that means delivering shares you already own. In a spread it leaves you
        <em> short 100 shares you never owned</em>, holding a long call, and owing the dividend. The exposure is
        therefore measured as the dividend against the credit collected rather than against today&rsquo;s moneyness, and
        when it is material the exit plan sets a hard <strong>Close before</strong> date. That is the one risk on this
        screen with an exact calendar answer.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Earnings inside the trade.</strong> A report can gap the stock through the short strike overnight, and
        the pre-announcement implied vol is precisely what made the credit look generous. The scanner prefers an
        expiration closing before the report; with the earnings skip enabled a stock whose report falls inside Target
        DTE plus the buffer is removed entirely rather than given a very short expiration instead. A third gap risk has
        no technical signal at all &mdash; a takeover bid &mdash; which is why the small-cap floor here is higher than on
        the Bear Put Spread Scanner and why the warning is named <em>Gap risk</em>.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Trade math and management</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Maximum profit</strong> is the credit received.</li>
        <li><strong>Maximum loss</strong> is the strike width minus the credit &mdash; size the position from this, never from the premium.</li>
        <li><strong>Breakeven</strong> at expiration is the short strike plus the credit; everything below it wins.</li>
        <li><strong>Cushion</strong> is the distance up to that breakeven, shown as a percentage and as a multiple of the expected move over the life of the trade.</li>
        <li><strong>Two probabilities</strong> are shown and they deliberately disagree: P(OTM) comes off the short leg&rsquo;s delta, the conventional and slightly conservative reading, while Chance of max profit is the exact terminal probability. Delta always understates how often price finishes past a strike.</li>
        <li><strong>Buy back at</strong> captures 50&ndash;65% of the credit depending on setup quality; <strong>Stop at</strong> is roughly twice the credit, capped just inside the width so the spread can still trade; <strong>Invalidate above</strong> is the overhead level the strike was placed behind, reached long before the defined loss is.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>If you already own the shares</h3>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Shares</strong> column shows any position you hold and how many contracts it would cover. That
        changes what the trade <em>is</em>: with 100 shares behind it the short leg is covered, so assignment delivers
        stock you already hold rather than opening a short position, and the long call simply caps the tail. It becomes a
        covered call with the upside disaster hedged &mdash; materially safer than the same two legs with nothing behind
        them.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        The controls, one by one
      </h3>
      <p style={{ marginBottom: '0.5rem' }}>
        Four presets: <strong>Conservative</strong>, <strong>Balanced</strong>, <strong>Downtrend rips</strong> (the
        highest-probability version &mdash; confirmed downtrends that have just bounced into a declining average), and
        <strong> Aggressive</strong>. This screen has more controls than any other in the family, because it has more
        ways to lose.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Min / Max rally (σ):</strong> the band. Below the minimum nothing has been rejected; above the maximum it is a momentum thrust, not a refused rally.</li>
        <li><strong>Max vs market (pp):</strong> a <em>maximum</em>, and the only one of its kind in the family. You never sell calls against the market&rsquo;s leader. ETFs get their own, tighter ceiling.</li>
        <li><strong>Min / Max RSI:</strong> below the floor the name is already broken and you are selling calls on something the Bear Put screen would buy puts on; above the ceiling it is trending, not rolling over.</li>
        <li><strong>Max acceleration (pp):</strong> rejects names whose last 5 sessions gained this much more than the prior 5. Accelerating momentum is the single condition that loses the whole width.</li>
        <li><strong>Max run off low (%):</strong> rejects names already up this much from the 20-day low &mdash; the shape of a short squeeze, and a squeeze runs to the full width while your gain is capped at the credit.</li>
        <li><strong>Max % of range:</strong> near the highs there is no overhead supply left to reject anything.</li>
        <li><strong>Small-cap min cap:</strong> set higher here than on the Bear Put screen, and not for liquidity reasons &mdash; a takeover bid gaps a short call straight through any strike, and those land on small companies.</li>
        <li><strong>Target DTE:</strong> 30&ndash;45, deliberately shorter than the debit screens. A seller is paid by time; buying more of it just means more chances to be wrong.</li>
        <li><strong>Short delta / Long delta / Min strike OTM:</strong> where the two legs sit, plus a hard floor on how far above spot the short strike must be so a normal week does not put it in play immediately.</li>
        <li><strong>Min credit (% of width) / Min cushion / Min open interest / Max slippage:</strong> the four execution gates. Below about 20% of width you are not being paid enough for defined risk.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Three checkboxes are unique to this screen: <strong>Require a rolled-over high</strong> (the minimum definition
        of a refused rally), <strong>Require resistance overhead</strong> (skip names where nothing has to break for
        price to reach your strike), and <strong>Place the strike above resistance</strong> (prefer pairs clearing the
        nearest wall rather than taking whatever the target delta lands on). The rest match the other screens.
      </p>

      <HelpScreenshot
        src="./help-screenshots/bear-call-spread-scanner/01-scanner-overview.png"
        alt="Bear Call Spread Scanner showing the four presets, the full filter panel, the scan stats line including how many strikes were placed above resistance, and the results table with setup lights, rally size, versus market, RSI, the ceiling level, IV over RV, the suggested spread, credit and risk, cushion, edge, and exit"
        caption={<>
          The <strong>Ceiling</strong> column names the actual overhead level and how far above price it sits &mdash;
          &ldquo;0.6% &middot; 200-day average&rdquo; &mdash; and the stats line reports how many strikes the scanner
          managed to place above one.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Reading a row, and taking the warnings seriously
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Read <strong>Cushion</strong> first &mdash; both the percentage and the σ figure next to it. A 3.5% cushion that
        is only 0.54 expected moves is a very different trade from a 3.5% cushion worth 1.5σ. Then read
        <strong> Edge</strong>: negative means the credit is below what the name&rsquo;s own realized movement justifies,
        so you are being underpaid for the risk.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        The warnings matter more here than anywhere else in the family, because each one names a specific way the full
        width gets lost. <em>Leader</em> means the name is outperforming. <em>Below the wall</em> means the strike could
        not be placed above resistance. <em>Strike close</em> means the short strike sits near the money.
        <em> Upside bid</em> means the far calls are pricing a jump. <em>Underpaid</em> and <em>IV cheap</em> mean the
        credit does not compensate. A row carrying four or five of these is telling you something even when the grade
        looks acceptable.
      </p>
      <HelpScreenshot
        src="./help-screenshots/bear-call-spread-scanner/02-expanded-row.png"
        alt="Expanded Bear Call Spread row showing the four score axes, both call leg quotes, the upside tail and call skew diagnostics, the dividend close-before date, and the exit plan"
        caption={<>
          The expansion carries both leg quotes, the upside-tail and call-skew diagnostics, any dividend
          <strong> Close before</strong> date, and the exit plan.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        What a real scan looks like, and the trap in loosening it
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        This screen returns nothing more often than any other, and the reason is structural rather than a bug. A
        Balanced large-cap run during a market pullback gave <em>443 scanned &rarr; <strong>2</strong> rallies rejected
        &rarr; 0 actionable</em>. There were no refused rallies to find, because the market had just sold off &mdash;
        the same session in which the Bull Put Spread Scanner found 53 controlled pullbacks.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Switching to the Aggressive preset over the full universe turned that into <em>729 scanned &rarr; 76 rallies
        rejected &rarr; <strong>3 actionable</strong></em>. But look at what the three were: grades of
        <strong> D 51.7, F 44.5, and F 42</strong>, carrying <em>Leader</em>, <em>Underpaid</em>, <em>Below the wall</em>,
        <em> Strike close</em>, and <em>Upside bid</em> between them. The scanner did exactly what it was told and
        graded the results honestly. Three actionable F-grade rows are not three trades &mdash; they are the screen
        telling you the setup does not exist today.
      </p>
      <HelpScreenshot
        src="./help-screenshots/bear-call-spread-scanner/03-empty-scan.png"
        alt="Bear Call Spread Scanner after a Balanced run showing 443 tickers scanned, only 2 rallies rejected, zero actionable spreads, and the watchlist explaining which limit each candidate missed"
        caption={<>
          An empty actionable table with a short watchlist is a normal, correct outcome for this screen. The watchlist
          Status column tells you which gate each candidate missed.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Pick a <strong>preset</strong>. <strong>Downtrend rips</strong> is the highest-probability version: only names already in a confirmed downtrend that have just bounced into a declining average.</li>
        <li>Add <strong>Index ETFs</strong> or <strong>Sector &amp; commodity ETFs</strong> with the independent Include checkboxes. Index funds are the one underlying here with no takeover risk and nothing to squeeze.</li>
        <li>Click <strong>Run Scan</strong>. The first run pulls a year of history and takes roughly 20&ndash;40 seconds; the price <em>and</em> call-chain caches are shared with the Covered Call Scanner, so running one after the other is much faster.</li>
        <li>Click any row for the score breakdown, both legs with their quotes, the exit plan including any close-before date, and the rejection metrics.</li>
        <li>Click the ticker to pull up its price chart with moving averages, MACD, and RSI.</li>
      </ol>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
        <strong>No trades execute here.</strong> The scanner rates setups from public market data and scores are not
        advice. A bear call spread has a defined maximum loss that is several times the credit collected, so size from
        the max loss and never from the premium. Short calls can be assigned before expiration and pin risk rises near
        expiry, so monitoring and an early closing plan are part of the setup rather than an afterthought.
      </div>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        If a scan returns nothing, that is usually correct rather than broken &mdash; in a strong market very few names
        qualify, and that is the screen working. Raise <strong>Max vs market</strong>, widen the RSI band, untick
        <strong> Require 50-day below 200-day</strong> or <strong>Require resistance overhead</strong>, or widen the
        universe. If candidates appear but none get a spread, lower <strong>Min credit</strong> or
        <strong> Min cushion</strong>.
      </div>
    </div>
  )
}

function IronCondorScannerHelp() {
  const screenshotStyle = {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
    border: '1px solid var(--p-333)',
  }

  const captionStyle = {
    margin: '0.45rem 0 0',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  }

  const figureStyle = {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1.5rem',
  }

  return (
    <div>
      <h2>Iron Condor Scanner</h2>
      <p style={{ marginBottom: '1rem' }}>
        The sixth screen in the options family, and structurally the sum of two of the others: a bull put spread below
        the market and a bear call spread above it, same underlying and same expiration, opened for one net credit. The
        credit is the maximum profit and it is kept in full if the stock finishes between the two short strikes. The
        scanner finds names that are going <em>nowhere</em> and whose options are expensive relative to how far they
        actually travel, then prices a specific four-leg structure on each one.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/iron-condor-scanner/01-parameter-presets.png"
          alt="Iron Condor Scanner showing the Balanced preset, universe controls, range filters, strike targets, and execution limits"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          Start with Conservative, Balanced, or Aggressive, then refine the range, premium,
          strike, liquidity, and event-risk gates. The scan summary shows how many names passed
          each stage before a four-leg structure was considered actionable.
        </p>
      </div>

      <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
        <strong>Maximum loss is the wider wing minus the credit &mdash; not the sum of both wings.</strong> Price can
        only finish on one side of the range, so only one wing can ever be breached. This is how brokers margin the
        position. Adding the two wings together is the most common arithmetic error in condor trading: it roughly
        doubles the apparent risk and halves the apparent return on it.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 1: only one side can ever be breached
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A real scanned result on a true scale: IWM at $291.20, sell the $270/$280 put wing and the $304/$315 call wing,
        34 days out, for a $2.91 net credit. The wings are deliberately <em>not</em> equal &mdash; 10 points on the put
        side, 11 on the call side &mdash; which is exactly what makes the arithmetic point visible.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 320" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Iron condor payoff showing a 290 dollar credit plateau between the short strikes, a 709 dollar loss on the put side, and a 809 dollar loss on the call side, with the two never occurring together">
          <line x1="50" y1="150" x2="700" y2="150" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="312" textAnchor="end" fill="var(--text-dim)" fontSize="11">IWM price at expiration →</text>

          {[[155, '$270'], [251, '$280'], [480, '$304'], [585, '$315']].map(([x, label]) => (
            <g key={label}>
              <line x1={x} y1="60" x2={x} y2="288" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
              <text x={x} y="300" textAnchor="middle" fill="var(--text-dim)" fontSize="10">{label}</text>
            </g>
          ))}
          <line x1="358" y1="70" x2="358" y2="288" stroke="var(--accent)" strokeDasharray="2 4" strokeWidth="1" />
          <text x="358" y="64" textAnchor="middle" fill="var(--accent)" fontSize="10.5">today $291.20</text>

          <rect x="223" y="96" width="284" height="54" fill="var(--pos)" opacity="0.10" />

          <polyline points="60,260 155,260 223,150 251,105 480,105 507,150 585,276 680,276"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />

          <circle cx="223" cy="150" r="4" fill="var(--amber)" />
          <circle cx="507" cy="150" r="4" fill="var(--amber)" />

          <text x="365" y="92" textAnchor="middle" fill="var(--pos)" fontSize="11.5" fontWeight="700">Max profit +$290 (the credit)</text>
          <text x="223" y="168" textAnchor="middle" fill="var(--amber)" fontSize="10">BE $277.09</text>
          <text x="507" y="168" textAnchor="middle" fill="var(--amber)" fontSize="10">BE $306.91</text>

          <text x="105" y="250" textAnchor="middle" fill="var(--neg)" fontSize="11.5" fontWeight="700">−$709</text>
          <text x="105" y="234" textAnchor="middle" fill="var(--text-dim)" fontSize="10">put wing</text>
          <text x="640" y="266" textAnchor="middle" fill="var(--neg)" fontSize="11.5" fontWeight="700">−$809</text>
          <text x="640" y="250" textAnchor="middle" fill="var(--text-dim)" fontSize="10">call wing</text>

          <rect x="245" y="228" width="245" height="52" rx="4" fill="var(--surface-inset)" stroke="var(--neg-strong)" strokeWidth="1.5" />
          <text x="367" y="247" textAnchor="middle" fill="var(--neg-strong)" fontSize="11.5" fontWeight="700">Max loss = $809, the worse side</text>
          <text x="367" y="263" textAnchor="middle" fill="var(--text-muted)" fontSize="10.5">NOT $709 + $809. NOT both wings</text>
          <text x="367" y="276" textAnchor="middle" fill="var(--text-dim)" fontSize="10">minus the credit ($1,809)</text>
        </svg>
        <p style={captionStyle}>
          IWM finishes in one place. It cannot be below $270 <em>and</em> above $315, so the two tails can never both
          happen &mdash; the position is margined at the worse one. Sizing this trade from $1,809 instead of
          <strong> $809</strong> more than doubles the apparent risk and turns a 35.9% return on risk into about 16%.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 2: why net drift is not enough
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Both paths below start and end in exactly the same place. Every net-drift measure &mdash; window return, stretch
        sigma, distance from a moving average &mdash; scores them identically. One of them was a fine condor and the
        other was breached twice.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 250" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Two price paths with identical start and end points: a quiet path staying inside the condor range with a low efficiency ratio, and a round trip that breaches both short strikes despite zero net drift">
          <rect x="60" y="95" width="600" height="60" fill="var(--pos)" opacity="0.10" />
          <line x1="60" y1="95" x2="660" y2="95" stroke="var(--pos)" strokeDasharray="5 4" strokeWidth="1.5" />
          <line x1="60" y1="155" x2="660" y2="155" stroke="var(--pos)" strokeDasharray="5 4" strokeWidth="1.5" />
          <text x="668" y="99" fill="var(--pos)" fontSize="10" textAnchor="end">short call $304</text>
          <text x="668" y="167" fill="var(--pos)" fontSize="10" textAnchor="end">short put $280</text>
          <text x="66" y="88" fill="var(--pos)" fontSize="10.5" fontWeight="700">the range you sold</text>

          <polyline points="60,130 140,118 220,136 300,122 380,140 460,120 540,134 620,124 660,128"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />
          <polyline points="60,130 140,105 220,72 300,50 380,62 460,110 540,168 620,196 660,128"
            fill="none" stroke="var(--neg)" strokeWidth="2.5" strokeLinejoin="round" />

          <circle cx="60" cy="130" r="4.5" fill="var(--text-muted)" />
          <circle cx="660" cy="128" r="4.5" fill="var(--text-muted)" />
          <text x="60" y="222" textAnchor="start" fill="var(--text-dim)" fontSize="10">same start</text>
          <text x="660" y="222" textAnchor="end" fill="var(--text-dim)" fontSize="10">same finish</text>

          <text x="250" y="200" fill="var(--accent-bright)" fontSize="11.5" fontWeight="700">efficiency 0.19 — never left the range</text>
          <text x="300" y="42" fill="var(--neg)" fontSize="11.5" fontWeight="700">breached the call wing…</text>
          <text x="560" y="212" fill="var(--neg)" fontSize="11.5" fontWeight="700">…then the put wing</text>
        </svg>
        <p style={captionStyle}>
          This is what the <strong>efficiency ratio</strong> catches and nothing else on the screen does: net distance
          travelled divided by total path length. The blue path covered little ground and stayed put. The red path had
          <em> zero net drift</em> and was a disaster. The pictured IWM result scored 0.19 &mdash; a lot of walking,
          almost no travelling.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Why this is not the Bull Put and Bear Call scanners run together
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The obvious construction is to take both credit screens and keep whatever appears on both lists. That returns
        the empty set. The Bull Put Spread Scanner wants a <em>bullish</em> underlying &mdash; a controlled pullback
        inside an intact uptrend. The Bear Call Spread Scanner wants a <em>bearish</em> one &mdash; a rally refused
        under overhead supply. Nothing is both. Taking the union instead returns a directional bet wearing four legs.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Neutral is not the average of bullish and bearish; it is its own property, it needs its own measurements, and no
        other screen here measures it. That is what this scanner adds. The thesis has two parts and both must hold:
        the underlying is <strong>range-bound and likely to stay that way</strong>, and its <strong>implied volatility
        is expensive relative to what it actually delivers</strong>. The second part is the entire edge &mdash; a
        directional spread can be right about direction and profit on ordinary premium, but a condor has no direction to
        be right about, so if the premium is not rich nothing is paying you.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        How &ldquo;going nowhere&rdquo; is measured
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Efficiency ratio</strong> is net distance travelled divided by total path length. Near 0 means price
        covered a great deal of ground and arrived nowhere, which is what a condor is paid for; near 1 means every day
        pointed the same way. This is the heaviest single term on the screen because it catches what no net-drift test
        can: a stock that rises 20% and falls straight back has <em>zero</em> net drift, so window return, stretch
        sigma, and distance from a moving average all call it quiet &mdash; and a condor sold inside that round trip was
        breached twice.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Variance ratio</strong> compares the variance of five-day moves against five times the variance of daily
        moves. Below 1 the name mean-reverts, which is the behaviour that refills the premium between entry and
        expiration; above 1 its moves compound in one direction. Where the efficiency ratio describes the window just
        observed, this describes the name&rsquo;s habit across the whole year, so it survives a window that happened to
        be quiet. Measured across large caps and index funds the median sits near 0.89, slightly mean-reverting.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Net drift, both moving-average slopes, and relative strength are all read as <strong>magnitudes</strong>, and
        RSI is scored as a band centred on 50. This is the family&rsquo;s only screen that does so. On the Bear Call
        Spread Scanner a falling 50-day is resistance and therefore an asset; to a condor a falling 50-day is simply a
        downtrend, and it breaks the put wing. Fresh 52-week highs <em>and</em> fresh lows are both disqualifying,
        because this is the only screen here short both tails at once.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Reading the premium</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>IV/RV</strong> is at-the-money implied volatility over recent realized volatility. Note this reads the
        opposite way from the Bear Put Spread Scanner, where rich implied vol is a <em>cost</em> because that screen
        buys; this one sells, so rich is the point. The ramp starts at 1.0 rather than the 0.95 the directional sellers
        use, because premium that merely matches realized volatility pays a neutral trade for nothing.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>IV percentile</strong> is the more useful of the two, and is the honest substitute for the
        practitioner&rsquo;s &ldquo;only sell condors at high IV rank&rdquo; rule &mdash; true IV rank needs a year of
        stored implied vol history this application does not keep. It reports the share of the name&rsquo;s own
        past-year <em>realized</em> volatility readings that sit below today&rsquo;s implied, which answers the question
        the rule is actually asking. It matters because it disagrees with IV/RV exactly when the point estimate is
        misleading: a stock whose volatility swings between 15% and 60% but happens to sit at 20% today shows a
        flattering 1.3&times; IV/RV at an implied 26%, while against its own distribution that reading is unremarkable.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Strike selection: delta, not distance
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Short strikes default to <strong>16 delta</strong>, approximately the one-standard-deviation strike, which is
        where the classic condor is sold. Both breakevens must sit outside the expected move over the life of the trade,
        and that is scored on the <em>nearer</em> side &mdash; a generous call wing does nothing for a tight put wing.
        Selling short strikes inside the expected move is the classic condor failure, and the credit looks generous
        there precisely because the market expects to reach them.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>The two wings are matched by delta rather than by distance from spot</strong>, and the difference is not
        cosmetic. Equity put skew means the put 5% below spot carries a materially higher delta than the call 5% above
        it, so a condor with equidistant strikes is a net short-delta position &mdash; a bullish bet, sized by accident,
        inside a structure the trader believes is neutral. It also collects most of its credit from the wing carrying
        most of its risk. The scanner reports the gap between the two short deltas, the whole structure&rsquo;s net
        delta, and each wing&rsquo;s share of the credit, and flags a structure as <em>Lopsided</em> when the two shorts
        drift apart.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How candidates are scored</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Range (30 points)</strong> &mdash; efficiency ratio earns 0&ndash;9, net drift as a magnitude 0&ndash;7, variance ratio 0&ndash;5, moving-average flatness 0&ndash;4, and a band on RSI centred at 50 gives the last 5. Penalties: fresh 52-week highs 9, fresh lows 9, and trending against the market up to 6. The axis floors at zero.</li>
        <li><strong>Vol (25 points)</strong> &mdash; IV/RV from 1.0 to 1.6 earns 0&ndash;10, IV percentile from the 40th to the 85th earns 0&ndash;6, credit over the four-leg realized-vol fair value 0&ndash;6, and contracting realized volatility 0&ndash;3. Only that last term works without a live chain.</li>
        <li><strong>Structure (20 points)</strong> &mdash; needs a live chain throughout. The nearer breakeven from 0.8&sigma; to 1.8&sigma; earns 0&ndash;8, delta balance 0&ndash;4, credit as a share of the wing width from 12% to 33% earns 0&ndash;5, and the odds of finishing between the shorts 0&ndash;3.</li>
        <li><strong>Safety (25 points)</strong> &mdash; size (3) and share liquidity (3) need no chain. The rest does: four-leg slippage 0&ndash;6, the odds of finishing between the breakevens 0&ndash;4, open interest on the worst of four legs 0&ndash;4, a credit surviving all four markets 3, and equal wings 2. Deductions: earnings before expiry 9, and a dividend inviting early assignment 5 (2.5 if merely elevated).</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Grades are <strong>A &ge; 80, B &ge; 70, C &ge; 60, D &ge; 50</strong>, otherwise F, calibrated against the
        other five option screens so a C means the same thing on all six. A grade with an asterisk and a dashed outline
        had no option chain, so it is rescaled from the 39 points that could still be scored, and partial scores always
        sort below fully priced ones.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/iron-condor-scanner/02-expanded-candidate.png"
          alt="Expanded Iron Condor Scanner watchlist candidate showing status warnings and probability of success"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          Expand a result to see the probability cards, score components, quotes, trade math,
          and management plan. This example is deliberately a watchlist candidate: the yellow
          status and warning chips mean it did not satisfy every enabled risk gate.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        The quiet killer: four markets, twice
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        Execution cost carries roughly <strong>double the weight it does on the two-leg screens</strong>, and the
        default ceiling is 45% of the credit rather than 30%. There are four bid/ask spreads to cross opening the
        position and four closing it, against a credit that is not twice a vertical&rsquo;s. The scanner shows the
        mid-price credit beside the <em>natural</em> credit &mdash; what is left after crossing every market &mdash; and
        a structure whose natural credit is not still positive is flagged, because that credit is fictional. Open
        interest is applied to the <em>worst</em> of the four legs, since all four must fill to open and all four to
        close.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Trade math and management</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Maximum profit</strong> is the net credit, kept if price finishes between the short strikes.</li>
        <li><strong>Maximum loss</strong> is the wider wing minus the credit &mdash; size the position from this, never from the premium.</li>
        <li><strong>Breakevens</strong> are the short put minus the credit and the short call plus the credit. Everything between them profits, which is a wider window than the max-profit zone.</li>
        <li><strong>Cushion</strong> is the <em>nearer</em> breakeven expressed as a multiple of the expected move over the life of the trade, alongside the smaller of the two percentage distances.</li>
        <li><strong>Two probabilities</strong> are shown: the odds of finishing between the breakevens (any profit) and between the short strikes (max profit). Both are exact terminal probabilities rather than delta proxies.</li>
        <li><strong>Buy back at</strong> targets <strong>50% of the credit</strong> rather than the 60&ndash;65% a clean vertical can hold for. A condor&rsquo;s payoff is a high win rate against a fat tail, so the last stretch of credit is the part bought most expensively in risk &mdash; earned only by holding a position short gamma on both sides through the period where gamma is largest.</li>
        <li><strong>Reassess at 21 DTE.</strong> Inside three weeks a short condor&rsquo;s gamma rises sharply, and a strike that was comfortably distant becomes one a single session can reach.</li>
        <li><strong>Stop at</strong> roughly twice the credit, capped just inside the wing so the structure can still trade.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Using the risk graph
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        Click <strong>Risk graph</strong> on an expanded row to load the exact four legs into
        Strategy Lab. Confirm both breakevens, the flat maximum-profit zone between the short
        strikes, and the loss slope toward each long strike. The current-date curve shows how
        time value rounds the expiration shape. Move the analysis date or drag the
        <strong> Vol surface</strong> bar to test how theta, gamma, and vega alter the position
        before expiration. The bar proportionally shocks each leg&rsquo;s own IV so the current
        put/call skew remains visible; the graph is a modeled scenario, not an executable closing quote.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/iron-condor-scanner/03-risk-graph.png"
          alt="Iron condor risk graph showing the current-date curve, expiration payoff, both breakevens, strike markers, and position metrics"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          The cyan expiration line shows the defined-risk condor: maximum profit between the
          short strikes and maximum loss beyond a long strike. The purple current-date curve
          includes remaining time value.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Defending a tested side</h3>
      <p style={{ marginBottom: '1rem' }}>
        If price reaches one of the short strikes, that side is tested. <strong>Roll the untested wing closer rather
        than widening the tested one.</strong> The untested side is risk that has just become <em>less</em> likely to
        matter, so bringing it in is the only adjustment that collects new credit without adding to the side already in
        trouble. If both breakevens come into play the range thesis is simply gone, and the position should be closed
        rather than adjusted &mdash; adjusting a broken thesis is how a defined-risk trade becomes an open-ended one.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Event risk</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Earnings inside the expiration remove the name entirely</strong> rather than merely flagging it, and the
        penalty is heavier than on any single vertical. The implied volatility that made the credit look generous
        <em> is</em> the earnings premium; it collapses the morning after regardless of direction, and the gap breaks
        whichever wing it points at. This is also why broad index funds are the classic condor underlying and are
        included by default &mdash; they mean-revert more than single names, cannot be taken over, never report
        earnings, and carry the deepest chains in the market.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>A dividend inside the trade</strong> puts the short call at risk of early exercise, which happens the
        day before the ex-date once remaining extrinsic value is worth less than the dividend. That leaves a short stock
        position nobody intended, arriving alongside three other open legs, so when the exposure is material the plan
        sets a hard <strong>Close before</strong> date. Small caps are deliberately absent from this screen&rsquo;s
        universes: a condor is exposed to a takeover gap <em>and</em> a collapse at the same time, and thin chains turn
        a theoretical credit into an unfillable one.
      </p>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        This screen is educational research, not a recommendation or personalized advice. An iron condor has a high win
        rate and a loss that is several times the credit collected, which is the shape most likely to encourage
        oversizing &mdash; size from the maximum loss, never from the premium or the win rate. All four legs should be
        opened and closed as a single condor order. Short options can be assigned before expiration and pin risk rises
        sharply near expiry, so monitoring and an early closing plan are part of the setup rather than an afterthought.
      </div>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        If a scan returns nothing, that is usually correct rather than broken &mdash; in a trending market very few
        names are genuinely range-bound, and that is the screen working. Raise <strong>Max efficiency</strong> or
        <strong> Max drift</strong>, widen the RSI band, loosen the range-position window, or make sure
        <strong> Index ETFs</strong> are included, since broad funds range far more often than single names. If
        candidates appear but none get a structure, lower <strong>Min credit</strong>, <strong>Min cushion</strong>, or
        <strong> Min leg OI</strong>, or raise <strong>Max slippage</strong>.
      </div>
    </div>
  )
}

function UnbalancedPutCondorScannerHelp() {
  const screenshotStyle = {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
    border: '1px solid var(--p-333)',
  }

  const captionStyle = {
    margin: '0.45rem 0 0',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  }

  const figureStyle = {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1.5rem',
  }

  return (
    <div>
      <h2>Unbalanced Put Condor Scanner</h2>
      <p style={{ marginBottom: '1rem' }}>
        This scanner builds a long-dated, four-put position on broad index ETFs such as SPY, QQQ, IWM, and VOO.
        It buys an upper put debit spread and sells a farther-out-of-the-money put credit spread at the same
        expiration, then searches nearby strikes for the complete package whose net delta best matches the
        selected neutral, slightly bullish, or slightly bearish target.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 1: two spreads, one table-top
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The four legs are easier to hold in your head as two separate spreads that get added together. This is a real
        scanned SPY result at $747.03, 167 days out.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 200" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Diagram showing the purchased upper put spread of buy 715 and sell 710 combined with the sold lower spread of sell 665 and buy 655, producing the complete four-put structure">
          <rect x="20" y="30" width="290" height="120" rx="6" fill="var(--surface-inset)" stroke="var(--pos)" strokeWidth="1.5" />
          <text x="165" y="52" textAnchor="middle" fill="var(--pos)" fontSize="12.5" fontWeight="700">Purchased spread (upper)</text>
          <text x="165" y="76" textAnchor="middle" fill="var(--text-muted)" fontSize="11.5">BUY 1 × $715 put &nbsp;Δ 28.1</text>
          <text x="165" y="96" textAnchor="middle" fill="var(--text-muted)" fontSize="11.5">SELL 1 × $710 put &nbsp;Δ 26.5</text>
          <text x="165" y="120" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">5 points wide · costs money</text>
          <text x="165" y="138" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">this is the part that pays</text>

          <text x="340" y="96" textAnchor="middle" fill="var(--text-muted)" fontSize="22" fontWeight="700">+</text>

          <rect x="370" y="30" width="290" height="120" rx="6" fill="var(--surface-inset)" stroke="var(--amber)" strokeWidth="1.5" />
          <text x="515" y="52" textAnchor="middle" fill="var(--amber)" fontSize="12.5" fontWeight="700">Sold spread (lower / back)</text>
          <text x="515" y="76" textAnchor="middle" fill="var(--text-muted)" fontSize="11.5">SELL 1 × $665 put &nbsp;Δ 15.5</text>
          <text x="515" y="96" textAnchor="middle" fill="var(--text-muted)" fontSize="11.5">BUY 1 × $655 put &nbsp;Δ 13.8</text>
          <text x="515" y="120" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">10 points wide · brings money in</text>
          <text x="515" y="138" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">this is the part that funds it</text>

          <text x="360" y="180" textAnchor="middle" fill="var(--accent-bright)" fontSize="12" fontWeight="700">
            Net delta +0.01 · entered for a $4 credit · widths and quantities stay independent
          </text>
        </svg>
      </div>
      <p style={{ marginBottom: '0.75rem' }}>
        Added together at expiration they make a lopsided table-top. Note the two things that make this structure
        unusual: the profit plateau is <em>wide</em>, and the upper flat is slightly <em>positive</em>, so there is no
        upper breakeven at all &mdash; the market going nowhere is a small win rather than a small loss.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 300" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Four-put condor payoff showing a small positive upper flat above 715, a 504 dollar plateau between 665 and 710, a fall to a 496 dollar loss flat below 655, and a single lower breakeven at 659.96">
          <line x1="50" y1="165" x2="700" y2="165" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="292" textAnchor="end" fill="var(--text-dim)" fontSize="11">SPY price at expiration →</text>

          {[[145, '$655'], [200, '$665'], [500, '$710'], [560, '$715']].map(([x, label]) => (
            <g key={label}>
              <line x1={x} y1="55" x2={x} y2="268" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
              <text x={x} y="280" textAnchor="middle" fill="var(--text-dim)" fontSize="10">{label}</text>
            </g>
          ))}
          <line x1="655" y1="120" x2="655" y2="268" stroke="var(--accent)" strokeDasharray="2 4" strokeWidth="1" />
          <text x="655" y="114" textAnchor="middle" fill="var(--accent)" fontSize="10.5">today $747</text>

          <polyline points="60,242 145,242 200,165 234,80 500,80 560,161 680,161"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />

          <circle cx="200" cy="165" r="4" fill="var(--amber)" />

          <text x="367" y="70" textAnchor="middle" fill="var(--pos)" fontSize="11.5" fontWeight="700">Centre max +$504</text>
          <text x="200" y="183" textAnchor="middle" fill="var(--amber)" fontSize="10">breakeven $659.96</text>
          <text x="102" y="232" textAnchor="middle" fill="var(--neg)" fontSize="11.5" fontWeight="700">−$496</text>
          <text x="102" y="258" textAnchor="middle" fill="var(--text-dim)" fontSize="10">lower flat</text>
          <text x="620" y="151" textAnchor="middle" fill="var(--pos)" fontSize="11" fontWeight="700">upper flat +$4</text>
          <text x="620" y="137" textAnchor="middle" fill="var(--text-dim)" fontSize="10">no upper breakeven</text>
        </svg>
        <p style={captionStyle}>
          The structure sits far below the market &mdash; SPY would have to fall about 4.3% just to reach the top of
          the plateau. That is the point: you are paid a small amount for the market staying up, and paid well if it
          drifts down into the tent. The modeled odds of the underlying even touching the back short strike were 38.8%.
        </p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/unbalanced-put-condor-scanner/01-scanner-overview.png"
          alt="Unbalanced Put Condor Scanner controls, active delta and quantity presets, and ranked four-put results"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          The green buttons show the active delta lean and quantity ratio. Widths and quantities remain independent,
          so a 5-point purchased spread can be paired with a 10-point sold spread and a 5:10 contract ratio.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        The four legs and delta presets
      </h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Buy the upper long put</strong> and <strong>sell the upper short put</strong> to create the purchased spread.</li>
        <li><strong>Sell the lower short put</strong> and <strong>buy the lower long put</strong> to create the back spread.</li>
        <li><strong>15/5, 20/10, and 25/15</strong> name the target deltas of the upper and lower short puts. The scanner checks nearby listed strikes because the net delta of all four legs is the governing result.</li>
      </ol>
      <p style={{ marginBottom: '1rem' }}>
        A <strong>neutral</strong> target seeks approximately zero share-equivalent delta. The +1.5 and −1.5
        quick choices intentionally lean the package slightly bullish or bearish. Contract quantities are included
        in that calculation: five purchased spreads and ten sold spreads can be flatter than a 1:1 construction
        even though the lower wing carries twice as many contracts.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Probability of closing the trade profitably
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Expanding a result shows two planned-exit estimates: close after <strong>50% of the original DTE has
        elapsed</strong> and after <strong>67% has elapsed</strong>. A win means closing all four legs together for
        more than $0 of modeled P/L. Each estimate also shows the underlying price range that produces a modeled
        profit on that close date and the DTE that would still remain.
      </p>
      <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
        Entry uses the current mid; the early-close probability reprices every exit leg at a theoretical mark,
        holds each leg&rsquo;s current implied volatility constant, and excludes commissions and slippage. It
        measures the result <em>on the planned close date</em>; the underlying may have crossed a strike earlier.
        It is a risk-neutral model estimate, not a forecast or a guaranteed win rate.
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/unbalanced-put-condor-scanner/02-probability-cards.png"
          alt="Expanded unbalanced put condor result showing profitable-close probabilities and downside risk probabilities"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          The first card answers whether the whole trade can be closed profitably at the planned dates. The middle
          card answers whether the underlying ever falls far enough to reach the structure at all. The last
          card separates touching the back short, reaching the back long where the expiration max-loss area begins,
          and actually finishing below those strikes.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Reading the payoff and downside probabilities
      </h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Upper flat</strong> is the expiration result above the highest strike. This is why the upper expiration line should begin flat.</li>
        <li><strong>Center max</strong> is the best expiration outcome between the two short puts.</li>
        <li><strong>Lower flat</strong> is the expiration result below the back long. With unequal widths or quantities, this can be much worse than the upper flat outcome.</li>
        <li><strong>Reach the structure</strong> estimates the chance of touching the front long—the highest strike, the first put the position owns below the current price—at any time before expiration. Above that strike the payoff is flat, so this is the probability the trade ever leaves its upper flat outcome. It is measured with the front long&rsquo;s own implied volatility instead of the far out-of-the-money back short&rsquo;s, because put skew would otherwise overstate a barrier this close to the money.</li>
        <li><strong>Never touches it</strong> is the complement of that figure: the chance the underlying stays above the front long for the entire holding period, in which case the four puts expire untested and the result is the upper flat outcome shown on the card. Note that it is normally smaller than the chance of simply <em>finishing</em> above the front long, because the terminal figure also counts paths that dipped below and recovered.</li>
        <li><strong>By expiration versus the earlier close dates.</strong> Both headline percentages on those two cards run the full term to expiration, which is what the &ldquo;· by expiration&rdquo; tag next to each title marks. Beneath each one, the same probability is repeated for the two planned close dates used by the profitable-close card—50% and 67% of the original days to expiration—measured over the shorter window from today to that date only. A touch becomes likelier the longer the position is held, so those interim figures are always below the headline.</li>
        <li><strong>Touch back short</strong> estimates the chance of reaching the sold lower put at any time before expiration.</li>
        <li><strong>Reach max-loss area</strong> estimates the chance of touching the back long before expiration—the price boundary where the expiration payoff becomes flat at its lower-tail result.</li>
        <li><strong>Finish below</strong> probabilities are terminal estimates and are normally lower than the corresponding touch probabilities.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Raising the upper expiration line after an upside move
      </h3>
      <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
        <strong>This is an upside-only adjustment.</strong> “Price moved away from the trade” means the
        underlying moved <strong>up</strong>, leaving the upper long and both short puts farther below the
        market. Do not use this adjustment while price is flat, falling, testing the upper long, or moving
        toward either short put.
      </div>
      <p style={{ marginBottom: '0.75rem' }}>
        The upper expiration line is the position&rsquo;s payoff above the highest put strike. At that
        price every put expires worthless, so the result is the cumulative net cash received or paid for
        the entire position. Selling one or more additional lower put credit spreads brings in another
        net credit. Before transaction costs, that credit raises the upper expiration line dollar for
        dollar. For example, one additional credit spread sold for $0.50 raises the upper line by $50.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The same adjustment makes the complete condor more bullish because a short put spread normally
        carries positive delta. It may also add positive theta while price remains safely above the
        strikes. The quantity ratio changes at the same time: a package with five purchased debit spreads
        and ten sold credit spreads becomes 5:11 after one additional sale. From that point forward, every
        payoff, Greek, probability, and buying-power figure must be calculated from the new 5:11 package,
        not from the original scan and not from the added spread in isolation.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The new credit is compensation for accepting more downside risk. Below the added credit spread,
        its maximum loss is approximately its width minus the credit received. The lower expiration line
        therefore normally moves down, maximum loss and buying-power usage rise, and a downside reversal
        becomes more damaging. The position also becomes more short gamma: positive delta can grow quickly
        as price falls toward the short puts. Assignment, gap, volatility, and four-leg execution risks
        remain, and the small premium available after a large rally may not justify the added tail risk.
      </p>
      <h4 style={{ color: 'var(--text-strong)', marginBottom: '0.4rem' }}>
        Adjustment decision sequence
      </h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Confirm direction:</strong> price has moved up and away from all puts; the structure is untested and the original thesis remains intact.</li>
        <li><strong>Define a target:</strong> specify the upper-line dollar amount or bullish-delta range you are trying to reach. “Collect more credit” by itself is not a risk rule.</li>
        <li><strong>Use the smallest size:</strong> model one added credit spread first, then increase only if the complete package still fits the target delta and capital limits.</li>
        <li><strong>Price the actual market:</strong> use the net executable credit after bid/ask spread and commissions, not a theoretical mid that may not fill.</li>
        <li><strong>Rebuild the whole payoff:</strong> verify the adjusted upper line, center maximum, lower flat, breakeven, maximum loss, and buying-power requirement.</li>
        <li><strong>Recalculate the Greeks and probabilities:</strong> review delta, theta, gamma, vega, the success/failure cards, and every touch/finish probability using the adjusted quantities.</li>
        <li><strong>Plan the reversal response:</strong> if price turns down toward the puts, reduce or close according to the risk plan. Do not keep selling progressively more spreads to repair the mark.</li>
      </ol>
      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        Raising the upper expiration line is <strong>not</strong> the same as locking in profit. It exchanges
        additional downside capacity for current credit. If the updated maximum loss, bullish delta, or
        lower-tail probability is outside the trade plan, skip the adjustment even though price has moved up.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How to use it</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Enter one or more liquid tickers and choose one delta pair or scan all three.</li>
        <li>Choose the target expiration and allowed DTE window.</li>
        <li>Set the purchased and sold widths independently, then choose a 1:1 or 5:10 quantity ratio—or enter custom quantities.</li>
        <li>Select neutral, slightly bullish, or slightly bearish, and adjust the delta tolerances if needed.</li>
        <li>Run the scan. Exact matches satisfy every enabled delta, width, liquidity, and credit constraint; near matches show the closest listed construction and its warnings.</li>
        <li>Expand a row to compare the early-close win probabilities, downside tests, payoff, execution quality, and maximum loss.</li>
        <li>Use <strong>Risk graph</strong> for the full payoff model or <strong>Save trade</strong> to send the exact strikes and quantities to Strategy Lab.</li>
      </ol>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        <strong>Trade at your own risk.</strong> Probability is not protection. Volatility, skew, gaps, dividends,
        assignment, commissions, and four-leg execution can materially change a real closing price. Size from the
        maximum loss, verify every leg and quantity, and use one multi-leg closing order where supported.
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
        Educational references:{' '}
        <a href="https://www.optionseducation.org/optionsoverview/options-pricing" target="_blank" rel="noreferrer">
          Options Industry Council—Options Pricing
        </a>
        {' · '}
        <a href="https://www.optionseducation.org/oic-profit-and-loss-simulator" target="_blank" rel="noreferrer">
          OIC Profit &amp; Loss Simulator
        </a>
      </p>
    </div>
  )
}

function SixtyFortyTwentyFlyScannerHelp() {
  return (
    <div>
      <h2>60/40/20 Fly Scanner</h2>
      <p>
        This scanner builds a same-expiration <strong>1/−2/+1 put butterfly</strong> by
        buying the put nearest 60 delta, selling two puts nearest 40 delta, and buying
        the put nearest 20 delta. It searches listed expirations from 60 through 80 DTE.
        At the target deltas, the three legs begin near delta neutral.
      </p>
      <p>
        SPY, QQQ, IWM, and VOO are included by default. VOO must pass the same live-quote,
        open-interest, bid/ask-width, delta-fit, theta, and net-delta gates as SPY. A thin
        chain is shown as needing review or unavailable rather than treated as equivalent.
      </p>
      <h3>Reading the results</h3>
      <ul>
        <li><strong>Landed deltas</strong> compare the listed contracts with the 60/40/20 targets.</li>
        <li><strong>Net delta</strong> is the complete position in share equivalents.</li>
        <li><strong>Delta/theta</strong> is absolute position delta divided by positive daily theta.</li>
        <li><strong>Liquidity</strong> shows the widest leg bid/ask percentage and minimum leg open interest.</li>
        <li>Expand a row for probability cards, 8- and 14-day modeled P/L, expiration geometry, the risk graph, and the complete exit plan.</li>
      </ul>
      <h3>Management rules</h3>
      <p>
        Monitor the <em>original entry contracts</em>. A 20% change in either monitored
        delta is caution: 48–72 delta for the upper long and 32–48 for the body short.
        Exit at the exact 30% boundaries: 42/78 or 28/52. Also caution when delta/theta
        exceeds 50%, exit above 60%, and close at 30 DTE regardless of price or P/L.
      </p>
      <div className="alert alert-warning">
        Modeled probabilities and 8- or 14-day outcomes are estimates, not promised
        returns. Verify the exact contracts, current Greeks, quotes, maximum loss, and
        multi-leg execution before trading.
      </div>
    </div>
  )
}

function RoadTripButterflyScannerHelp() {
  const screenshotStyle = {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
    border: '1px solid var(--p-333)',
  }

  const captionStyle = {
    margin: '0.45rem 0 0',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  }

  const figureStyle = {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1.5rem',
  }

  return (
    <div>
      <h2>Road Trip Unbalanced Butterfly Scanner</h2>
      <p style={{ marginBottom: '0.75rem' }}>
        This scanner builds the Harvey/Nunamaker road-trip put butterfly: buy one upper put,
        sell two body puts, and buy one lower put at the same expiration. The default five-unit
        position is therefore <strong>5/−10/5</strong>. It looks 70–85 days out, places the upper
        long about 1.25% behind the market, and makes the lower wing wider than the upper wing.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        The governing entry rule is price, not a particular delta ladder. The net debit must stay
        below 5% of initial margin, the complete position should be near delta neutral with positive
        theta, and every result reports the exact strikes, quantities, debit, margin, Greeks, close
        window, target, stop, and adjustment plan.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 1: the expiration shape
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The pictured SPY trade drawn to a true scale: buy 5 × $738 puts, sell 10 × $723, buy 5 × $702,
        for a $120 debit against $3,120 of initial margin.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 300" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Road trip butterfly expiration payoff showing a 7380 dollar peak at the 723 body strike, breakevens at 708.24 and 737.76, and a 3120 dollar loss flat below the 702 lower long">
          <line x1="50" y1="120" x2="700" y2="120" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="292" textAnchor="end" fill="var(--text-dim)" fontSize="11">SPY price at expiration →</text>

          {[[150, '$702'], [360, '$723'], [510, '$738']].map(([x, label]) => (
            <g key={label}>
              <line x1={x} y1="40" x2={x} y2="268" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
              <text x={x} y="280" textAnchor="middle" fill="var(--text-dim)" fontSize="10">{label}</text>
            </g>
          ))}

          <polyline points="60,192 150,192 212,120 360,45 508,118 512,127 680,127"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />

          <circle cx="212" cy="120" r="4" fill="var(--amber)" />
          <circle cx="508" cy="120" r="4" fill="var(--amber)" />
          <circle cx="360" cy="45" r="4.5" fill="var(--pos)" />

          <text x="360" y="36" textAnchor="middle" fill="var(--pos)" fontSize="11.5" fontWeight="700">Max profit +$7,380 at the body</text>
          <text x="212" y="138" textAnchor="middle" fill="var(--amber)" fontSize="10">BE $708.24</text>
          <text x="540" y="112" textAnchor="middle" fill="var(--amber)" fontSize="10">BE $737.76</text>
          <text x="100" y="182" textAnchor="middle" fill="var(--neg)" fontSize="11.5" fontWeight="700">−$3,120</text>
          <text x="100" y="208" textAnchor="middle" fill="var(--text-dim)" fontSize="10">the broken-wing flat</text>
          <text x="612" y="145" textAnchor="middle" fill="var(--text-dim)" fontSize="10">upper line −$120 (the debit)</text>
        </svg>
        <p style={captionStyle}>
          The lower wing (21 points) is wider than the upper (15), which is what creates the loss flat on the left
          rather than a symmetric tent. <strong>Initial margin is that broken-wing risk</strong> &mdash; the width
          difference times 100 times the quantity, plus the debit &mdash; and the 5% debit-to-margin rule is measured
          against it: $120 on $3,120 is 3.8%.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 2: why you never see that shape
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        This is the idea the whole strategy turns on, and the reason the headline probability is not the expiration
        number. The sharp tent above only exists on the final day. For the months you actually hold the trade, the
        profit zone is a broad rounded hill covering a far wider price range &mdash; and the plan is to leave well
        before the two converge.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 280" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Comparison of the narrow sharp expiration tent against the broad rounded pre-expiration profit curve, with the preferred close window marked between halfway and two-thirds through the trade">
          <line x1="50" y1="180" x2="700" y2="180" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="272" textAnchor="end" fill="var(--text-dim)" fontSize="11">underlying price →</text>

          <polyline points="60,215 150,215 212,180 360,70 508,178 512,183 680,183"
            fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
          <path d="M60 210 C 170 205, 200 160, 290 145 S 430 140, 520 158 C 590 170, 630 178, 680 180"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" />

          <text x="360" y="60" textAnchor="middle" fill="var(--text-dim)" fontSize="11">expiration: narrow and sharp</text>
          <text x="300" y="130" textAnchor="middle" fill="var(--accent-bright)" fontSize="11.5" fontWeight="700">two-thirds through: broad and rounded</text>

          <rect x="212" y="196" width="296" height="26" rx="4" fill="var(--pos)" opacity="0.14" />
          <text x="360" y="213" textAnchor="middle" fill="var(--pos)" fontSize="11" fontWeight="700">the wide zone you are actually trading</text>

          <g transform="translate(0, 238)">
            <line x1="60" y1="0" x2="680" y2="0" stroke="var(--border)" strokeWidth="1.5" />
            <rect x="370" y="-9" width="145" height="18" rx="3" fill="var(--pos)" opacity="0.22" stroke="var(--pos)" strokeWidth="1" />
            <text x="442" y="4" textAnchor="middle" fill="var(--pos)" fontSize="10" fontWeight="700">close window</text>
            <text x="62" y="22" fill="var(--text-dim)" fontSize="10">entry</text>
            <text x="200" y="22" textAnchor="middle" fill="var(--text-dim)" fontSize="10">hands off 21–30 days</text>
            <text x="600" y="22" textAnchor="middle" fill="var(--amber)" fontSize="10">15–20 DTE backstop</text>
            <text x="680" y="4" textAnchor="end" fill="var(--text-dim)" fontSize="10">expiry</text>
          </g>
        </svg>
        <p style={captionStyle}>
          This is why the pictured example reads <strong>88.4% success at halfway and 86.6% at two-thirds</strong> while
          the unadjusted expiration tent is only <strong>19.7%</strong>. Those numbers are not in conflict &mdash; they
          answer different questions, and only one of them describes the trade as planned. The 15&ndash;20 DTE date is
          the latest planned exit, not the target.
        </p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/road-trip-butterfly-scanner/01-scanner-overview.png"
          alt="Road Trip Butterfly Scanner settings and ranked IWM QQQ and SPY results with structure, debit-to-margin, Greeks, two-thirds value, plan, and status"
          style={screenshotStyle}
        />
        <p style={captionStyle}>
          Start with the article defaults, then run the scan. A green <strong>Entry ready</strong>
          row fits the structure and price gates; expand it before acting. Live strikes and dollar
          values change with the option chain, so the pictured SPY trade is an example, not a fixed recommendation.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Reading the probability cards
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The headline probability is the <strong>two-thirds close</strong>, not expiration. The two
        checkpoints bracket the preferred close window: halfway through the trade and two-thirds
        through it. At each checkpoint all three option legs are repriced with their current implied
        volatilities held constant, creating the broad rounded T+0 profit zone that exists before the
        sharp expiration tent forms.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Success:</strong> positive modeled closing P/L plus the rally region above the upper long, where the planned reverse Harvey is continued until the right side is at least flat.</li>
        <li><strong>Failure:</strong> the exact complementary downside loss region. Success and failure always total 100% at the same checkpoint.</li>
        <li><strong>Unadjusted expiration tent:</strong> shown separately as context. It is deliberately not the headline because the strategy is managed and normally closed earlier.</li>
        <li><strong>Model limitation:</strong> these are theoretical price-distribution estimates, not historical win rates or guarantees. A volatility, skew, fill, or gap change can alter the real outcome.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/road-trip-butterfly-scanner/02-probability-cards.png"
          alt="Expanded SPY Road Trip result showing 88.4 percent managed success at halfway and 86.6 percent at two-thirds, with exact complementary failure probabilities"
          style={screenshotStyle}
        />
        <p style={captionStyle}>
          In the pictured SPY example, managed success is 88.4% at halfway and 86.6% at
          two-thirds. The unadjusted expiration tent is only 19.7%; that lower number answers a
          different question because it ignores both the earlier close and the reverse-Harvey rally management.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Entry math and the close plan
      </h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Debit ÷ initial margin:</strong> must remain below 5%. Initial margin is the broken-wing downside risk—lower-wing width minus upper-wing width, times 100 and the upper-long quantity—plus the debit paid.</li>
        <li><strong>Hands-off window:</strong> leave the trade alone for the first 21–30 days so theta can work.</li>
        <li><strong>Preferred close window:</strong> manage the exit from halfway through two-thirds through the trade, while the time-value profit zone remains broad.</li>
        <li><strong>Article exit backstop:</strong> the 15–20 DTE date is the latest planned exit, not the probability headline or the start of the preferred close window.</li>
        <li><strong>Profit and stop:</strong> the defaults seek 7%–15% of utilized capital and stop near a 4%–5% loss, well before the expiration maximum loss.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Pre-planned adjustments
      </h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Reverse Harvey on a rally:</strong> sell the upper long and buy the next lower strike toward the body for a credit. Repeat only as needed to lift the right-side expiration line to flat or slightly profitable. Reprice the complete position after every roll.</li>
        <li><strong>Downside trigger:</strong> place the planned conditional near the body, where the curve turns back down, rather than improvising after the decline.</li>
        <li><strong>Put debit-spread hedge:</strong> buy the higher strike and sell the lower strike. The screen prices one current-chain example and shows the planned 50%–75% hedge close; actual size and execution still require judgment.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/road-trip-butterfly-scanner/03-management-adjustments.png"
          alt="Road Trip SPY result showing debit and margin checks, halfway and two-thirds close values, article backstop, reverse Harvey roll, and downside put-spread hedge"
          style={screenshotStyle}
        />
        <p style={captionStyle}>
          The example paid a $120 debit on $3,120 of initial margin, modeled +$256 unchanged at
          halfway and +$419 at two-thirds, and priced one $738-to-$737 reverse Harvey roll that
          would lift the upper line from −$120 to +$25 before costs.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Confirming the payoff in Strategy Lab
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        Click <strong>Risk graph</strong> to load the exact strikes, quantities, entry prices, and
        per-leg implied volatilities into Strategy Lab. The cyan expiration line should show the
        broken-wing tent and lower loss flat; the purple pre-expiration curve should show the wider,
        rounded time-value zone. Confirm that Strategy Lab agrees with the scanner before using any
        target or stop. For the pictured 738/723/702 SPY example, the exact expiration breakevens are
        $708.24 and $737.76, maximum profit is $7,380 at the body, and maximum loss is $3,120 below
        the lower long.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/road-trip-butterfly-scanner/04-risk-graph.png"
          alt="Strategy Lab risk graph for the 738 723 702 SPY Road Trip butterfly showing the rounded current curve, expiration tent, and exact 708.24 and 737.76 breakevens"
          style={screenshotStyle}
        />
        <p style={captionStyle}>
          The graph makes the timing distinction visible: the expiration payoff is narrow and sharp,
          while the earlier model curve spreads positive time value across a much wider price range.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Suggested workflow
      </h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Scan liquid index ETFs with the article defaults and confirm the selected expiration is inside 70–85 DTE.</li>
        <li>Reject any row above the 5% debit-to-margin ceiling or outside the selected net-delta, theta, liquidity, and wing-ratio gates.</li>
        <li>Expand the row and compare halfway and two-thirds success, unchanged P/L, targets, stop, close window, and both adjustments.</li>
        <li>Open the risk graph and reconcile the entry debit, breakevens, maximum profit, maximum loss, strikes, quantities, and expiration.</li>
        <li>Verify a live multi-leg quote at the broker. Use the planned stop and schedule; do not substitute the displayed model for executable prices.</li>
      </ol>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        <strong>Trade at your own risk.</strong> The reverse Harvey prevents the modeled upside line
        from remaining a loss only when the required rolls are available and executed as planned.
        Slippage, volatility and skew changes, gaps, assignment, commissions, liquidity, and delayed
        execution can all produce a different result. Size from the full expiration maximum loss.
      </div>
    </div>
  )
}

function DoubleHedgePutButterflyScannerHelp() {
  const captionStyle = {
    margin: '0.45rem 0 0',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  }

  const figureStyle = {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1.5rem',
  }

  return (
    <div>
      <h2>Double-Hedge Put Butterfly Scanner</h2>
      <p style={{ marginBottom: '0.75rem' }}>
        This screen adapts a March 2021 SPX trade plan to liquid index ETFs. One tranche is a
        single-expiration put butterfly with a <strong>doubled lower wing</strong>: buy 4 puts near
        25 delta, sell 8 puts near 15 delta, and buy 8 puts near 2.5 delta. The default order is
        therefore <strong>4/−8/+8</strong>, roughly 200 days out, on a standard monthly expiration.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        The extra 4 lower puts are the &ldquo;double hedge.&rdquo; They are what separates this from
        the ordinary broken-wing butterfly on the Unbalanced Butterfly screen, and they change the
        shape of the trade in a way that is worth seeing before you touch any control.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 1: the shape you are buying
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Every number on this screen describes one of the four regions below. The diagram is the
        expiration payoff of a real scanned SPY tranche &mdash; buy 4 × 705 puts, sell 8 × 640 puts,
        buy 8 × 290 puts &mdash; drawn with a compressed vertical scale so the deep valley and the
        small profits are visible together.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 320" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Expiration payoff of a 4 by minus 8 by plus 8 double-hedge put butterfly, showing the crash tail at zero, the deep valley at the lower strike, the tall body tent, and the near-flat upper line">
          <line x1="50" y1="215" x2="700" y2="215" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="233" textAnchor="end" fill="var(--text-dim)" fontSize="11">Underlying price at expiration →</text>
          <text x="52" y="30" fill="var(--text-dim)" fontSize="11">P/L (compressed scale)</text>

          <line x1="300" y1="45" x2="300" y2="285" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
          <line x1="590" y1="45" x2="590" y2="285" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
          <line x1="644" y1="45" x2="644" y2="285" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />

          <polyline
            points="60,197 65,215 300,278 536,215 590,55 644,208 695,208"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round"
          />

          <circle cx="60" cy="197" r="4" fill="var(--pos)" />
          <circle cx="300" cy="278" r="4" fill="var(--neg)" />
          <circle cx="590" cy="55" r="4" fill="var(--pos)" />
          <circle cx="644" cy="208" r="4" fill="var(--amber)" />

          <text x="66" y="188" fill="var(--pos)" fontSize="11.5" fontWeight="700">Crash tail +$2,182</text>
          <text x="66" y="174" fill="var(--text-muted)" fontSize="10.5">8 lower puts recover</text>

          <text x="300" y="298" textAnchor="middle" fill="var(--neg)" fontSize="11.5" fontWeight="700">Valley −$113,818 at 290</text>
          <text x="300" y="60" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">lower long</text>

          <text x="590" y="45" textAnchor="middle" fill="var(--pos)" fontSize="11.5" fontWeight="700">Body peak +$26,182 at 640</text>
          <text x="590" y="298" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">body short</text>

          <text x="695" y="200" textAnchor="end" fill="var(--amber)" fontSize="11.5" fontWeight="700">Upper line +$182</text>
          <text x="644" y="298" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">upper long 705</text>

          <text x="536" y="207" textAnchor="middle" fill="var(--accent)" fontSize="10.5">breakeven 574.54</text>
          <text x="86" y="228" textAnchor="middle" fill="var(--accent)" fontSize="10.5">breakeven 5.45</text>
        </svg>
        <p style={captionStyle}>
          Four regions, left to right: a <strong>crash tail</strong> that turns profitable again only
          in a near-total collapse, a <strong>valley</strong> that is the real maximum loss, a
          <strong> tent</strong> that pays most at the body strike, and a nearly flat
          <strong> upper line</strong> where the market simply stays up. Sloped segments all move at
          the same $400 per index point, because the net contract count is 4 everywhere.
        </p>
      </div>
      <p style={{ marginBottom: '1rem' }}>
        Read the two profit regions honestly. The tent is the trade. The crash tail is insurance whose
        breakeven, in this SPY example, sits at $5.45 &mdash; SPY would have to fall 99% for the doubled
        hedge to pay. What the extra puts really buy you is a <em>less steep</em> loss on the way down
        and a much better mark in a fast selloff, which is exactly what the T+0 stress numbers measure.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 2: the scanner and its two gates
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The screen has two filter panels stacked above the results, and they do very different jobs.
        The top panel is everything the scanner can compute from the option chain. The bottom panel is
        everything the scanner <em>cannot</em> know and you must tell it.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 240" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Diagram showing computed structural gates and manually entered monitor gates both feeding the entry ready status">
          <rect x="20" y="20" width="270" height="130" rx="6" fill="var(--surface-inset)" stroke="var(--pos)" strokeWidth="1.5" />
          <text x="36" y="44" fill="var(--pos)" fontSize="13" fontWeight="700">Panel 1 — computed</text>
          <text x="36" y="66" fill="var(--text-muted)" fontSize="11.5">Strikes, deltas, wing ratio</text>
          <text x="36" y="86" fill="var(--text-muted)" fontSize="11.5">Tranche delta inside bias band</text>
          <text x="36" y="106" fill="var(--text-muted)" fontSize="11.5">ATM theta ≥ minimum</text>
          <text x="36" y="126" fill="var(--text-muted)" fontSize="11.5">T+0 at −20% ≥ floor</text>
          <text x="36" y="144" fill="var(--text-dim)" fontSize="10.5">→ Structure matched</text>

          <rect x="20" y="165" width="270" height="60" rx="6" fill="var(--surface-inset)" stroke="var(--amber)" strokeWidth="1.5" />
          <text x="36" y="188" fill="var(--amber)" fontSize="13" fontWeight="700">Panel 2 — you supply</text>
          <text x="36" y="208" fill="var(--text-muted)" fontSize="11.5">3 monitors · warning count · all-clear</text>
          <text x="36" y="222" fill="var(--text-dim)" fontSize="10.5">→ Entry monitors ready</text>

          <path d="M290 90 L 360 110 L 360 130 L 430 130" fill="none" stroke="var(--border)" strokeWidth="1.5" />
          <path d="M290 195 L 360 175 L 360 155 L 430 155" fill="none" stroke="var(--border)" strokeWidth="1.5" />

          <rect x="430" y="105" width="260" height="76" rx="6" fill="var(--surface-inset)" stroke="var(--accent-bright)" strokeWidth="1.5" />
          <text x="450" y="132" fill="var(--accent-bright)" fontSize="13" fontWeight="700">Entry ready</text>
          <text x="450" y="154" fill="var(--text-muted)" fontSize="11.5">Both gates clean, campaign has room</text>
          <text x="450" y="172" fill="var(--text-dim)" fontSize="10.5">Anything missing → &quot;Needs review&quot;</text>
        </svg>
        <p style={captionStyle}>
          A row can be a perfect <strong>Structure matched</strong> and still say
          <strong> Needs review</strong>, and on a fresh install it always will &mdash; the three
          monitors default to <em>Unconfirmed</em>. That is deliberate, not a bug.
        </p>
      </div>

      <HelpScreenshot
        src="./help-screenshots/double-hedge-put-butterfly-scanner/01-scanner-overview.png"
        alt="Double-Hedge Put Butterfly Scanner showing the structure panel, the monitor and campaign panel, and ranked SPY QQQ and IWM results with structure, net delta, theta, T plus zero stress, upper line, and expiration geometry"
        caption={<>
          The live screen. Top panel sets the structure, bottom panel carries the monitors, campaign
          capital, and the <strong>Run scan</strong> button. Strikes and dollar values move with the
          option chain, so every figure pictured here is an example, not a recommendation.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Setting up the scan, control by control
      </h3>
      <p style={{ marginBottom: '0.5rem' }}>Top panel &mdash; the structure:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Tickers:</strong> liquid index ETFs. SPY, QQQ, and IWM are the defaults; they stand in for the original SPX plan without matching its notional size. Up to 20 tickers are scanned.</li>
        <li><strong>STFS market bias:</strong> picks the allowed tranche delta band &mdash; bearish −3 to −1, neutral −1 to +1, bullish +1 to +3 share equivalents. The scanner shifts the <em>lower</em> strike to hit the band, which is why the lower long is not always exactly 2.5 delta.</li>
        <li><strong>Target / Minimum / Maximum DTE:</strong> 200 / 160 / 230 by default. It starts at the standard monthly nearest the target and walks the rest of the window only if the first one yields nothing. Weeklies are excluded.</li>
        <li><strong>Upper-long qty:</strong> scales the whole 1/−2/+2 ratio. Changing 4 to 8 gives 8/−16/+16 <em>and</em> automatically rescales the theta minimum, T+0 floor, upper-line tolerance, and capital per tranche. Do not rescale those by hand.</li>
        <li><strong>Leg Δ tolerance:</strong> how far each leg may sit from 25 / 15 / 2.5 delta. Default 0.02. Widen it when a chain has coarse strikes; every widening is a real drift from the documented structure.</li>
        <li><strong>Min lower-wing ratio:</strong> forces the body-to-lower distance to exceed the upper-to-body distance. Default 1.05. This is what makes it a broken wing rather than a symmetric butterfly.</li>
        <li><strong>Minimum leg OI:</strong> open-interest floor on each of the three strikes. Leave at 0 for a first look, then raise it before you would actually route the order &mdash; a 2.5-delta long-dated put can be very thin.</li>
      </ul>
      <p style={{ marginBottom: '0.5rem' }}>Top panel &mdash; the three entry gates:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Minimum theta</strong> (default +$10/day per base tranche): the trade has to be paid to wait. A structure below this is rejected as a structural miss.</li>
        <li><strong>Minimum T+0 −20%</strong> (default −$10,000): reprice every leg for an immediate 20% drop, keeping each leg&rsquo;s current implied volatility fixed. This is the stress test the doubled hedge exists to pass.</li>
        <li><strong>UEL tolerance</strong> (default $250): how close the upper expiration line must sit to $0. A large positive upper line usually means you were paid a credit and the market simply going nowhere is a small win; a large negative one means a rally costs money.</li>
      </ul>
      <p style={{ marginBottom: '0.5rem' }}>Bottom panel &mdash; what only you can answer:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Structure-price, Concavity, and Skew monitors:</strong> the original plan reads these as changes against their own recent histories. One chain snapshot cannot reconstruct a history, so the scanner refuses to guess and asks you to set Favorable, Unfavorable, or Unconfirmed yourself.</li>
        <li><strong>Warning signals (0&ndash;5):</strong> your count from OBV, ATR, STFS, Force Index, and the term-structure monitor. At <strong>4 or 5 the scanner blocks a new tranche</strong> outright.</li>
        <li><strong>Awaiting 8/34 all-clear:</strong> after a 4- or 5-warning event, leave this checked until a bullish 8/34 EMA crossover prints on the 30-minute chart.</li>
        <li><strong>Campaign capital / Capital per tranche / Open tranches:</strong> $150,000 ÷ $12,500 allows at most 12 open tranches. When capacity is full, every row drops to Needs review no matter how good the structure is.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        The screen still measures today&rsquo;s <strong>body richness</strong> (body mid versus a straight
        line between the two long strikes) and today&rsquo;s <strong>put-skew slope</strong> in IV points,
        and shows them beside the monitors. They are transparent cross-sectional context, offered
        precisely so they cannot be mistaken for the historical monitors.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 3: reading a result row
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Rows sort worst-status-last, so entry-ready structures float to the top. Click any row to
        expand it. Every column heading with an arrow is sortable.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>4/−8/+8 structure:</strong> the three strikes and quantities, green for buys and red for the short body.</li>
        <li><strong>Wing widths:</strong> upper width / lower width, plus the ratio. A 5.38× lower wing means the downside leg is more than five times as wide as the front wing.</li>
        <li><strong>Net delta:</strong> the complete tranche in share equivalents, with the selected bias band underneath. Green means inside the band.</li>
        <li><strong>Theta and T+0 −20%:</strong> the two hard gates, each printed with the floor you set.</li>
        <li><strong>Upper line:</strong> dollars, target near $0.</li>
        <li><strong>Expiration geometry:</strong> peak, valley, and crash tail &mdash; the same three landmarks as the diagram above.</li>
        <li><strong>Entry readiness:</strong> Entry ready or Needs review on top, <em>Structure matched</em> or <em>near_match</em> underneath, warning count last. Always read both lines; they fail independently.</li>
      </ul>
      <HelpScreenshot
        src="./help-screenshots/double-hedge-put-butterfly-scanner/02-entry-trio.png"
        alt="Expanded Double-Hedge result showing the probability cards and the entry trio metrics for tranche delta, ATM theta, T plus zero after a twenty percent and fifteen percent decline, and the upper expiration line"
        caption={<>
          Expanding a row leads with the probability cards, then the entry trio. Success counts both
          the tent and the recovered crash tail; failure is the exact complement, so the pair always
          sums to 100% at the same checkpoint. These are model estimates from a price distribution,
          not historical win rates.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Geometry, monitors, and the campaign panel
      </h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Expiration geometry card:</strong> upper flat, body peak, lower-strike valley, crash tail at $0, and both breakevens. The valley is the number to size from &mdash; in the pictured SPY tranche it is −$113,818, more than nine times the $12,500 of planned capital.</li>
        <li><strong>Roll-down / roll-up reviews:</strong> printed as prices, roughly 2% and 14% above the upper long. They are calendar-free reminders to look, not automatic orders.</li>
        <li><strong>Campaign card:</strong> the $1,000 fixed target, roughly $800 average expectation, $2,500 management loss, 12-week average hold, $20,000 learning reserve, tranche capacity, and the LPTA put count. All dollar figures scale with Upper-long qty.</li>
        <li><strong>LPTA context:</strong> at 4 warnings the plan calls for one roughly 30-DTE, 2-delta long put per three <em>already open</em> tranches; at 5 warnings, two. It hedges the campaign you have, and is not part of this entry order.</li>
        <li><strong>Theta references:</strong> the 120× and 71× appendix figures are shown as context. The source plan preferred conservative tiered fixed targets, so do not treat them as exits.</li>
      </ul>
      <HelpScreenshot
        src="./help-screenshots/double-hedge-put-butterfly-scanner/03-geometry-campaign.png"
        alt="Double-Hedge expanded row showing the expiration geometry landmarks, the monitor confirmation states with body richness and put skew context, and the campaign sizing and LPTA card"
        caption={<>
          The monitor card shows why a clean structure still reads Needs review: three
          <em> Unconfirmed</em> states. Set them only after you have actually checked the signals.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Confirming it in Strategy Lab
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Risk graph</strong> button at the bottom of the expanded row loads the exact
        strikes, quantities, entry prices, and per-leg implied volatilities into Strategy Lab.
        Reconcile the breakevens, peak, and valley against the scanner before trusting either. The
        expiration line should show the sharp tent and the long descent into the lower strike; the
        pre-expiration curve is much rounder and is where the trade actually lives for its first months.
      </p>
      <HelpScreenshot
        src="./help-screenshots/double-hedge-put-butterfly-scanner/04-risk-graph.png"
        alt="Strategy Lab risk graph of the scanned double-hedge put butterfly showing the expiration tent, the descent to the lower strike valley, and the rounded pre-expiration curve"
        caption={<>
          Strategy Lab is the reconciliation step. If the two screens disagree on a breakeven or a
          maximum loss, stop and find out why before routing anything.
        </>}
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Suggested workflow
      </h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Leave the defaults alone on the first run. Enter your tickers, pick the bias that matches your read, and click <strong>Run scan</strong>.</li>
        <li>Check the stats line: tickers scanned, monthly expirations priced, structural matches, entry ready. Structural matches are the number worth reading.</li>
        <li>Ignore <em>Entry readiness</em> for a moment and sort by <strong>Net delta</strong>, then confirm theta and T+0 −20% clear your floors on the rows that interest you.</li>
        <li>Expand the best row. Read the valley first, then the probability cards, then the entry trio.</li>
        <li>Now go do the outside work: check the three monitors and count your warning signals. Come back, set them in the bottom panel, and re-run. Only then does Entry ready mean anything.</li>
        <li>Open the risk graph and reconcile strikes, quantities, breakevens, peak, and valley.</li>
        <li>Price the four-leg complex order live at the broker and confirm the −15% and −20% buying-power scenarios there. Portfolio margin uses broker models and your whole account; the T+0 marks here do not.</li>
      </ol>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        <strong>Trade at your own risk.</strong> Size this from the expiration valley, not from the
        planned $2,500 management loss &mdash; the two differ by more than an order of magnitude. The
        T+0 marks hold each leg&rsquo;s current implied volatility constant, which a real crash will not
        do; a volatility or skew shift, a gap, thin 2.5-delta strikes, early assignment on the short
        body, or slippage across four legs can all produce a materially different result. Outside
        market hours the option feed can blank bid/ask, and any row built from last-trade estimates
        is labelled as such &mdash; re-run during regular hours before acting on it.
      </div>
    </div>
  )
}

function UnbalancedButterflyScannerHelp() {
  const screenshotStyle = {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
    border: '1px solid var(--p-333)',
  }

  const captionStyle = {
    margin: '0.45rem 0 0',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  }

  const figureStyle = {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1.5rem',
  }

  return (
    <div>
      <h2>Unbalanced Butterfly Scanner</h2>
      <p style={{ marginBottom: '1rem' }}>
        This scanner builds the long-dated put broken-wing butterfly from a 4/−8/4 base
        tranche: buy upper puts, sell twice as many body puts, and buy the same number of
        lower puts at one expiration. The lower wing is wider than the front wing. The
        scanner can start with either a 20- or 25-delta upper long, keeps the body near
        15 delta, and searches the lower long and adjacent listed strikes for the selected
        bearish, neutral, or bullish complete-position delta.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 1: what the broken wing buys
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A real scanned SPY result at $747.03, 167 days out: buy 4 &times; $685 puts, sell 8 &times; $650, buy
        4 &times; $590. The upper wing is 35 points and the lower is 60 &mdash; a 1.71&times; ratio &mdash; and the
        whole structure was entered for a $6 debit.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 300" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Unbalanced butterfly payoff showing a near-zero upper flat above 685, a 13994 dollar peak at the 650 body, a breakeven near 615, and a 10006 dollar loss flat below the 590 lower long">
          <line x1="50" y1="120" x2="700" y2="120" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="292" textAnchor="end" fill="var(--text-dim)" fontSize="11">SPY price at expiration →</text>

          {[[130, '$590'], [400, '$650'], [558, '$685']].map(([x, label]) => (
            <g key={label}>
              <line x1={x} y1="38" x2={x} y2="266" stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
              <text x={x} y="278" textAnchor="middle" fill="var(--text-dim)" fontSize="10">{label}</text>
            </g>
          ))}
          <line x1="656" y1="70" x2="656" y2="266" stroke="var(--accent)" strokeDasharray="2 4" strokeWidth="1" />
          <text x="656" y="64" textAnchor="middle" fill="var(--accent)" fontSize="10.5">today $747</text>

          <polyline points="60,230 130,230 243,120 400,44 556,119 560,121 680,121"
            fill="none" stroke="var(--accent-bright)" strokeWidth="2.5" strokeLinejoin="round" />

          <circle cx="243" cy="120" r="4" fill="var(--amber)" />
          <circle cx="400" cy="44" r="4.5" fill="var(--pos)" />

          <text x="400" y="35" textAnchor="middle" fill="var(--pos)" fontSize="11.5" fontWeight="700">Body peak +$13,994</text>
          <text x="243" y="138" textAnchor="middle" fill="var(--amber)" fontSize="10">breakeven ≈ $615</text>
          <text x="95" y="220" textAnchor="middle" fill="var(--neg)" fontSize="11.5" fontWeight="700">−$10,006</text>
          <text x="95" y="246" textAnchor="middle" fill="var(--text-dim)" fontSize="10">lower flat — it stays flat</text>

          <rect x="498" y="140" width="190" height="50" rx="4" fill="var(--surface-inset)" stroke="var(--pos)" strokeWidth="1.5" />
          <text x="593" y="158" textAnchor="middle" fill="var(--pos)" fontSize="11" fontWeight="700">Upper flat −$6</text>
          <text x="593" y="174" textAnchor="middle" fill="var(--text-muted)" fontSize="10">the market staying up costs</text>
          <text x="593" y="186" textAnchor="middle" fill="var(--text-muted)" fontSize="10">essentially nothing</text>
        </svg>
        <p style={captionStyle}>
          The broken wing is what pushes the upper expiration line to roughly $0. A symmetric butterfly is bought for a
          real debit, so a market that simply stays up loses it; widening the lower wing sells enough extra premium to
          pay for the structure. You buy that with a much deeper loss on the far downside &mdash; and here the lower
          flat really is <em>flat</em>, because the 4 lower longs exactly balance the remaining short exposure below $590.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Picture 2: the same shape with the wing doubled
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        This is the one structural difference between this screen and the Double-Hedge Put Butterfly Scanner, and it is
        worth seeing side by side. Both sell 8 body puts. The only change is how many lower puts are bought.
      </p>
      <div style={figureStyle}>
        <svg viewBox="0 0 720 250" role="img" style={{ width: '100%', height: 'auto' }}
          aria-label="Side by side comparison: the 4 by minus 8 by 4 butterfly whose downside loss stays flat, against the 4 by minus 8 by plus 8 double hedge whose downside turns back up into a recovering crash tail">
          {[
            {
              x: 0, title: '4 / −8 / +4', sub: 'this screen', color: 'var(--accent-bright)',
              path: 'M35 175 L 90 175 L 150 120 L 215 55 L 285 118 L 330 118',
              note: 'the downside loss is a flat — it stops',
              note2: 'falling, but it never comes back',
            },
            {
              x: 360, title: '4 / −8 / +8', sub: 'Double-Hedge screen', color: 'var(--teal)',
              path: 'M35 128 L 90 175 L 150 120 L 215 55 L 285 118 L 330 118',
              note: 'the extra 4 puts turn that flat into a',
              note2: 'recovering crash tail',
            },
          ].map(panel => (
            <g key={panel.title} transform={`translate(${panel.x}, 0)`}>
              <rect x="15" y="16" width="330" height="215" rx="6" fill="var(--surface-inset)" stroke={panel.color} strokeWidth="1.5" />
              <text x="180" y="38" textAnchor="middle" fill={panel.color} fontSize="13" fontWeight="700">{panel.title}</text>
              <text x="180" y="54" textAnchor="middle" fill="var(--text-dim)" fontSize="10.5">{panel.sub}</text>
              <line x1="30" y1="118" x2="335" y2="118" stroke="var(--border)" strokeWidth="1" />
              <path d={panel.path} fill="none" stroke={panel.color} strokeWidth="2.5" strokeLinejoin="round" />
              <text x="180" y="200" textAnchor="middle" fill="var(--text-muted)" fontSize="10">{panel.note}</text>
              <text x="180" y="214" textAnchor="middle" fill="var(--text-muted)" fontSize="10">{panel.note2}</text>
            </g>
          ))}
        </svg>
        <p style={captionStyle}>
          Neither is better &mdash; they are different trades. The doubled hedge costs more premium and pulls the
          structure&rsquo;s delta around, which is why that screen has to balance the lower strike into a bias band. The
          version here is cheaper and simpler, and accepts that a genuine collapse is where the money goes.
        </p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/unbalanced-butterfly-scanner/01-scanner-overview.png"
          alt="Unbalanced Butterfly Scanner controls and ranked near-match results using the four-contract base tranche"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          The scanner starts with the monthly expiration nearest the target DTE and continues through
          the allowed monthly window when needed. Exact matches satisfy every enabled constraint; near
          matches show the closest listed construction and explain which target or quote check was missed.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Scaling the complete structure
      </h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Changing <strong>Tranche long qty</strong> preserves the 1/−2/1 relationship. For example,
        increasing it from 4 to 8 changes the order from 4/−8/4 to 8/−16/8. The 20- or 25-delta
        upper-long target and the approximately 15-delta body target remain per-contract strike-selection
        rules, so they do not double. The complete-position delta and theta do double for the same strikes,
        which is why the scanner scales the bearish, neutral, or bullish net-delta range, target theta,
        theta tolerance, and upper-expiration-line tolerance by the same quantity factor.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Modeled dollar outcomes also scale with the number of complete units: entry cost or credit,
        upper line, tent peak, lower flat, planned profit and loss targets, maximum profit, maximum loss,
        and planned capital all rise proportionally before commissions, slippage, or fill differences.
        Probability percentages do not mechanically double because they describe price paths rather than
        contract count.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/unbalanced-butterfly-scanner/03-quantity-scaling.png"
          alt="Unbalanced Butterfly Scanner doubled to an eight-contract long quantity with an 8 minus 16 plus 8 structure and scaled theta and delta targets"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          In this doubled example, each row uses 8/−16/8, the neutral range becomes −2 to +2,
          and the target theta becomes +$40 per day. The selected 20- and 25-delta strike rules
          remain unchanged.
        </p>
      </div>

      <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
        When live bid and ask quotes are unavailable after hours, the scanner can use recent traded
        option prices to estimate volatility, delta, and structure geometry. Those rows are clearly
        marked as <strong>near matches</strong>; their natural price and executable width remain
        unavailable. Refresh during market hours and verify a live multi-leg quote before trading.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Payoff geometry and how the tent develops
      </h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Upper expiration line:</strong> above the upper long, all three put strikes expire worthless. The result is the cumulative net debit or credit from entry and every later adjustment. The course seeks this line near $0 initially.</li>
        <li><strong>Front wing:</strong> the distance from the upper long to the double-short body. This side determines how rapidly the expiration payoff rises into the tent.</li>
        <li><strong>Body or tent peak:</strong> expiration near the double-short strike produces the largest payoff because the upper longs have intrinsic value while the body and lower longs are at or out of the money.</li>
        <li><strong>Lower wing and lower flat:</strong> the body-to-lower-long distance is deliberately wider. Below the lower long, the payoff becomes horizontal again, often at the maximum-loss result.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Before expiration the position does not have a sharp intrinsic-value triangle. Every leg still
        contains time value, so its mark-to-model P/L is a rounded, lower tent. Positive theta generally
        raises and sharpens that tent as time passes. The halfway, two-thirds, and expiration bubbles
        reprice all three strikes at the remaining DTE so the screen shows this evolution instead of
        applying the expiration diagram to every date.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        The successful region is intentionally asymmetric. Price above the upper long is an untested,
        acceptable outcome even when the upper line is approximately flat. Inside the structure,
        success means the complete tranche has modeled P/L of $0 or better on that date. Failure is the
        exact complement: the downside region where the entire adjusted tranche has negative modeled
        P/L. More elapsed time can widen the tent while the probability still moves slightly in either
        direction, because the underlying distribution also has more time to spread into the downside tail.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Reading the probability cards
      </h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Success and failure:</strong> shown at the halfway review, two-thirds review, and expiration. The two values always total 100% at each date.</li>
        <li><strong>Time evolution:</strong> shows theoretical P/L if price is unchanged, at the upper long, and at the body/tent peak, plus the successful underlying range at each checkpoint.</li>
        <li><strong>Reach the structure / never touches:</strong> estimates whether price ever reaches the upper long before the relevant date, not merely where price finishes.</li>
        <li><strong>Finish below the upper long:</strong> can be smaller than the touch probability because price may test the structure and recover.</li>
        <li><strong>Body and lower-tail cards:</strong> separate touching the double-short body, finishing below it, touching the lower long, and finishing in the lower tail.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/unbalanced-butterfly-scanner/02-expanded-analysis.png"
          alt="Expanded Unbalanced Butterfly Scanner result showing success and failure probabilities, time evolution, and touch probabilities"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          Expand a row to compare success and failure as exact complements, see the rounded tent
          develop through time, and separate the chance of touching a strike from the chance of
          finishing beyond it.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Using the risk graph
      </h3>
      <p style={{ marginBottom: '1rem' }}>
        Click <strong>Risk graph</strong> on an expanded result to load the exact strikes,
        quantities, and entry estimate into Strategy Lab. Confirm the nearly flat upper line,
        the body peak, the wider lower wing, the lower breakeven, and the maximum-loss tail.
        The current-date curve shows the rounded pre-expiration tent; the expiration curve shows
        the completed intrinsic-value payoff. Move the analysis date or drag the
        <strong> Vol surface</strong> bar to test how the tent develops. The bar proportionally
        shocks every leg from its own starting IV. Open the volatility-scenario panel to steepen
        or flatten downside skew, shock the butterfly&rsquo;s expiration independently, switch between
        sticky-strike and sticky-delta price paths, and verify each leg&rsquo;s market-to-modeled IV
        reconciliation. These settings reprice the rounded pre-expiration tent; the intrinsic-value
        expiration line itself is unchanged by IV. Every plotted value remains a model estimate.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img
          src="./help-screenshots/unbalanced-butterfly-scanner/04-risk-graph.png"
          alt="Unbalanced butterfly risk graph showing the current-date curve, expiration tent, lower breakeven, strike markers, and position metrics"
          style={screenshotStyle}
        />
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          The cyan expiration line forms the broken-wing tent, while the purple current-date
          curve includes remaining time value. The metrics above the graph should agree with the
          scanner row for the same strikes, quantities, and entry estimate.
        </p>
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Raising the upper expiration line by narrowing the front wing
      </h3>
      <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
        <strong>This is an upside-only adjustment.</strong> It is eligible only after the underlying
        has moved <strong>up and away</strong> from the butterfly, leaving the upper long and body
        farther out of the money. Do not narrow the front wing while price is flat, falling, testing
        the upper long, or moving into the butterfly.
      </div>
      <p style={{ marginBottom: '0.75rem' }}>
        Narrowing means reducing the strike distance between the upper long and the double-short body.
        The roll must produce a <strong>net credit</strong> if its purpose is to raise the upper
        expiration line. That credit becomes part of the trade&rsquo;s cumulative cashflow. Above the
        upper long, where the puts expire worthless, the upper line rises by the net adjustment credit
        after commissions and slippage. For example, collecting $0.40 per 1/−2/1 unit across four
        units raises the upper line by $160 before costs.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        There is more than one way to reduce the front-wing width. An upper long can be rolled down
        toward the body, a body can be rolled up toward the upper long, or both front strikes can be
        repositioned. These are not equivalent. Rolling the long down usually removes put protection;
        rolling eight body contracts can have a much larger Greek and downside-payoff effect than rolling
        four upper longs. The order must therefore be modeled as the exact closing and opening legs that
        will be sent to the broker, not described only as “narrow the wing.”
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The adjustment makes the complete position more bullish. Reducing long-put exposure or adding
        higher-strike short-put exposure shifts delta in the positive direction. That is why the rally
        is a prerequisite: the trade is using distance created by the upside move to accept more bullish
        exposure. If price is already moving down, the same adjustment removes protection or adds short
        puts precisely when their delta and gamma are increasing.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The raised upper line is not free. A narrower front wing changes the tent&rsquo;s height and
        location. Depending on the legs rolled, the body peak may shrink or move, the lower wing may
        effectively become wider, the downside flat and breakeven may worsen, and maximum loss or buying
        power may rise. Positive theta can improve, but short-gamma and volatility exposure can become
        less forgiving. The roll also crosses additional bid/ask markets, so a theoretical credit that
        disappears at executable prices does not raise the real upper line.
      </p>

      <h4 style={{ color: 'var(--text-strong)', marginBottom: '0.4rem' }}>
        Adjustment decision sequence
      </h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Confirm the rally:</strong> price is higher and farther from the upper long; none of the puts is being tested and the original trade thesis remains valid.</li>
        <li><strong>Set the objective:</strong> choose a specific upper-line dollar target or allowed bullish-delta range. Do not adjust merely because a credit is available.</li>
        <li><strong>Model the exact roll:</strong> identify every closing and opening strike and quantity. Confirm that the executable order is a net credit after costs.</li>
        <li><strong>Use the smallest change:</strong> test the narrowest qualifying roll first. Large or repeated rolls can transform the original risk profile.</li>
        <li><strong>Rebuild the complete payoff:</strong> recalculate the cumulative upper line, body peak, lower flat, breakeven, maximum profit, maximum loss, and buying power.</li>
        <li><strong>Recalculate the Greeks:</strong> check total delta, theta, gamma, and vega. The new delta must remain inside the intended bullish limit rather than simply becoming “more positive.”</li>
        <li><strong>Refresh every probability:</strong> recompute success/failure at all three dates and the upper-long, body, and lower-tail touch and finish probabilities from the adjusted structure.</li>
        <li><strong>Define the reversal response:</strong> if price turns back down toward the puts, reduce or close according to the management plan. Do not keep narrowing to repair an adverse mark.</li>
      </ol>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        Raising the upper expiration line is an exchange: the trade receives current credit and becomes
        more bullish while giving up some downside capacity or tent geometry. It does not lock in profit.
        Skip the adjustment whenever the updated maximum loss, delta, liquidity, or downside probability
        falls outside the trade plan—even if the underlying has rallied.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Practical workflow
      </h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Choose the complete-position quantity, then scan both 20- and 25-delta upper-long variants in the 120–240 DTE window around the 160 DTE target.</li>
        <li>Choose the desired market-bias range and compare the complete-position delta, theta, upper line, execution, and maximum loss.</li>
        <li>Expand a result to review success/failure, time-evolved tent values, reach/never-touch, and lower-tail risk.</li>
        <li>Use the risk graph and verify the exact displayed strikes and quantities before entry.</li>
        <li>At the halfway and two-thirds reviews, compare the live mark and Greeks with the original plan. An upside-only narrowing adjustment is optional, not automatic.</li>
        <li>If an adjustment is modeled, save and manage the revised structure as one complete position with its new cashflow and quantities.</li>
      </ol>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        <strong>Trade at your own risk.</strong> Probability and theoretical P/L are model estimates.
        Volatility, skew, gaps, dividends, early assignment, commissions, liquidity, and multi-leg
        execution can materially change the result. Verify the complete adjusted order and size from
        its worst credible loss.
      </div>
    </div>
  )
}

function ETFProviderUpdateHelp() {
  return (
    <div>
      <h2>ETF Provider Update</h2>
      <p style={{ marginBottom: '1rem' }}>
        ETF Provider Update refreshes fund-level metadata (total assets, number of funds, average expense ratio)
        for a selected ETF provider by pulling the latest data from StockAnalysis.com.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Select a provider from the dropdown (e.g. YieldMax, NEOS, Global X).</li>
        <li>Review the current summary cards showing provider name, fund count, total assets, and average expense ratio.</li>
        <li>Click <strong>Update Provider</strong> to fetch the latest data. A confirmation message shows how many funds were updated or inserted.</li>
      </ul>

      <p style={{ marginBottom: '0.75rem' }}>
        Updated provider data is used by the ETF Comparer and Security Research pages for expected yield calculations
        and distribution source attribution.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Examples</h3>
      <p style={{ marginBottom: '1rem' }}>
        Here are some examples of the ETF Provider Update screen with different ETF providers:
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-dim-2)', marginBottom: '0.5rem', fontStyle: 'italic' }}>BlackRock provider showing 484 funds with $4.3T in assets</p>
        <img src="./help-screenshots/etf-provider-update/blackrock-example.jpg" alt="ETF Provider Update example showing BlackRock provider with fund metrics" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-dim-2)', marginBottom: '0.5rem', fontStyle: 'italic' }}>State Street provider showing 183 funds with $1.8T in assets</p>
        <img src="./help-screenshots/etf-provider-update/state-street-example.jpg" alt="ETF Provider Update example showing State Street provider with fund metrics" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-dim-2)', marginBottom: '0.5rem', fontStyle: 'italic' }}>Invesco provider showing 238 funds with $871B in assets</p>
        <img src="./help-screenshots/etf-provider-update/invesco-example.jpg" alt="ETF Provider Update example showing Invesco provider with fund metrics" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>
    </div>
  )
}

function AnnualTaxReportHelp() {
  return (
    <div>
      <h2>Annual Tax Report</h2>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Annual Tax Report</strong> rolls your dividend payments and sell transactions
        into an estimate of taxable activity for a single calendar year. It breaks dividends into
        qualified, ordinary, and return-of-capital buckets, and realized gains into short-term vs.
        long-term lots — presented as previews of IRS Form 1099-DIV and Form 8949. Use it to
        cross-check your broker's 1099 before filing, or to plan sales and dividend timing during
        the year.
      </p>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        <strong>Estimates only.</strong> This is a planning tool, not tax advice. Wash-sale rules
        are not applied. The 60-day qualified-dividend holding test is not enforced. ROC amounts
        come from manual overrides only. Verify every figure against your broker's 1099-DIV and
        1099-B before filing.
      </div>

      <h3 style={{ marginBottom: '0.5rem' }}>Tax-advantaged accounts</h3>
      <p style={{ marginBottom: '1rem' }}>
        If the active portfolio is flagged as a tax-advantaged account (IRA, Roth IRA, 401(k),
        HSA, or 529), the report is suppressed — dividends and gains inside those accounts are not
        reportable in the year they occur. Switch to a taxable account or the <strong>Owner</strong>{' '}
        view to see reportable activity.
      </p>

      <h3 style={{ marginBottom: '0.5rem' }}>Page layout</h3>
      <p style={{ marginBottom: '0.5rem' }}>
        At the top, select a <strong>Tax Year</strong> from the dropdown (populated automatically
        from years that have dividend or sell data). Below the year picker, a summary strip shows
        eight headline numbers at a glance:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Qualified Dividends / Ordinary Dividends / Return of Capital / Total Dividends</strong> — dividend breakdown for the year.</li>
        <li><strong>Short-Term G/L / Long-Term G/L / Total Realized G/L</strong> — net gain or loss from sales, colored green/red.</li>
        <li><strong>Lots Sold</strong> — number of individual tax lots closed during the year.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/tax-report/tax-report-summary-form-previews.jpg" alt="Annual Tax Report summary cards and Form 1099-DIV and Form 8949 previews" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ marginBottom: '0.5rem' }}>Tabs</h3>

      <p><strong>Form Previews</strong></p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Form 1099-DIV preview</strong> — Box 1a (Total Ordinary Dividends, which
            includes both ordinary and qualified), Box 1b (Qualified Dividends subset), and Box 3
            (Nondividend Distributions / Return of Capital).</li>
        <li><strong>Form 8949 preview</strong> — Short-term and long-term rows showing total
            proceeds, cost basis, and net gain or loss. Long-term = held more than 365 days; cost
            basis comes from explicit lot allocations on each sell, falling back to FIFO.</li>
      </ul>

      <p><strong>Dividends</strong></p>
      <p style={{ marginBottom: '0.5rem' }}>
        One row per ticker with dividend activity in the selected year. Columns: Ticker, Treatment,
        Total Dividends YTD for the current year (or Total Dividends for the selected closed year),
        Qualified amount, Ordinary amount, ROC amount, and payment Count. Rows are sortable by
        clicking any column header. A <strong>★</strong> next to the treatment label means a manual
        override is in effect for that ticker and year.
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/tax-report/tax-report-dividends-overrides.jpg" alt="Annual Tax Report Dividends tab with per-ticker tax treatment overrides" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <p><strong>Realized Lots</strong></p>
      <p style={{ marginBottom: '1rem' }}>
        One row per closed lot with: Ticker, Sell Date, Buy Date (shown as <em>unmatched</em> if
        no BUY was found), Shares, Buy Price, Sell Price, Cost, Proceeds, Gain/Loss (colored
        green/red), holding Days, and Term badge (Long-Term or Short-Term).
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/tax-report/tax-report-realized-lots.jpg" alt="Annual Tax Report Realized Lots tab with closed tax lots and gain or loss detail" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Where the numbers come from</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Dividend totals</strong> — sum of all dividend_payment rows whose payment date
            falls in the selected year, grouped by ticker.</li>
        <li><strong>Realized gains</strong> — SELL transactions in the selected year, matched to
            BUY lots. Sells with explicit lot allocations use those; all others fall back to FIFO
            across BUY rows on or before the sell date.</li>
        <li><strong>Short-term vs. long-term</strong> — holding period of more than 365 days
            qualifies a lot as long-term.</li>
      </ul>

      <h3 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Tax-treatment defaults</h3>
      <p style={{ marginBottom: '0.5rem' }}>
        Each ticker is assigned a default treatment based on its asset classification:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Qualified</strong> — common stocks, broad ETFs, ADRs, and the app's standard
            pillar categories (Anchors, Boosters, Growth, Juicers, Hedged Anchor, Gold/Silver).</li>
        <li><strong>Ordinary</strong> — REITs, BDCs, CEFs, MLPs, and preferred shares.</li>
      </ul>

      <h3 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Per-ticker overrides (custom split)</h3>
      <p style={{ marginBottom: '0.5rem' }}>
        On the <strong>Dividends</strong> tab, each row has an inline split editor with a
        <strong> T</strong> total-dividend field and three dollar amount fields:{' '}
        <strong>Q</strong> (Qualified), <strong>O</strong> (Ordinary), and{' '}
        <strong>ROC</strong> (Return of Capital). The <strong>T</strong> field is locked by default;
        check the box next to it to enable edits when your broker statement total differs from the
        app's imported total. As you type amounts, the percent split is calculated automatically.
        Click <strong>Save</strong> (or press Enter) to apply the override; the row will show a ★.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li>Edit <strong>T</strong> only when the broker tax statement total differs from the app's imported dividend total.</li>
        <li>Enter any two of Q, O, and ROC; the remaining box fills with the amount needed to match T.</li>
        <li>The remaining box is based on the two most recently edited amount boxes, so you can change any field and the other one will rebalance.</li>
        <li>Example: if <strong>T</strong> is 1,645.33 and you enter O = 760.90 and ROC = 300.00, Q fills as 584.43.</li>
        <li>Turn on the <strong>%</strong> checkbox only when you need to manually adjust the calculated percentage fields.</li>
        <li>The dollar amounts must add up to T; Save is blocked if the amounts are short or over.</li>
        <li>Click <strong>Default</strong> to clear the override and revert to the asset-class rule.</li>
      </ul>
      <p style={{ marginTop: '0.5rem' }}>
        Overrides are stored per-ticker, per-year — changing 2024 does not affect 2023. There is
        no automatic ROC inference; ROC must come from a manual override, typically driven by Box 3
        of your actual 1099-DIV.
      </p>

      <h3 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Exports</h3>
      <p style={{ marginBottom: '0.5rem' }}>
        Four CSV downloads appear next to the year selector when data is available:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>1099-DIV CSV</strong> — Box 1a, 1b, and 3 totals for the selected year.</li>
        <li><strong>Form 8949 CSV</strong> — one row per realized lot, in IRS Form 8949 column order (description, dates, proceeds, cost, gain/loss, term).</li>
        <li><strong>Dividends CSV</strong> — per-ticker breakdown showing qualified, ordinary, ROC, and total amounts.</li>
        <li><strong>Realized Lots CSV</strong> — full per-lot detail including holding days and short/long-term classification.</li>
      </ul>

      <h3 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>What's not included</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li>Wash-sale adjustments.</li>
        <li>The 60-day qualified-dividend holding-period test.</li>
        <li>Foreign tax credits and foreign withholding (Form 1116).</li>
        <li>Section 199A REIT dividends (Box 5 of 1099-DIV).</li>
        <li>State income taxes.</li>
        <li>Automatic ROC inference — NAV erosion overrides on the NAV Erosion page do not flow into the tax report.</li>
      </ul>
    </div>
  )
}

function ETFComparerHelp() {
  return (
    <div>
      <h2>ETF Comparer</h2>
      <p style={{ marginBottom: '1rem' }}>
        ETF Comparer lets you compare up to seven ETFs side-by-side using an interactive return chart,
        a customizable data table, a distribution history chart, an average return bar chart, and a multi-period comparison table.
        It is designed for a direct head-to-head comparison of ETF return history, yield, distribution patterns, and fund characteristics.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/etf-comparer/return-chart.jpg" alt="ETF Comparer return chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Adding Tickers</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Type one or more ETF tickers (comma- or space-separated) in the input field and press <strong>Add</strong> or Enter.</li>
        <li>Each ticker appears as a chip below the input. Click the × on a chip to remove it.</li>
        <li>Up to seven tickers can be loaded simultaneously.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Return Chart</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Period</strong> — 1M, 3M, 6M, YTD, 1Y, 2Y, 5Y, 10Y, or MAX.</li>
        <li><strong>Return Mode</strong> — choose Total Return (price + reinvested dividends), Price Only (relative share-price change, indexed to the period start), Actual Price (each ETF's real dollar share price, not a relative return), Price + Dividends (cash), Both (total and price), All Three, or All Four traces per ticker.</li>
        <li><strong>Reinvestment %</strong> — adjustable slider from 0% (all dividends taken as cash) to 100% (all dividends reinvested). Only applies to the blended trace in applicable modes.</li>
        <li><strong>% / Index toggle</strong> — show returns as a percentage gain/loss from period start, or as an indexed value starting at 100.</li>
        <li><strong>Labels</strong> — toggle end-of-period return labels on the chart.</li>
        <li><strong>Range slider</strong> — drag to zoom into a specific date range within the selected period.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Distribution History</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Distribution History section appears below the main return chart. It shows one ETF at a time so the monthly
        distribution bars stay readable when several ETFs are loaded. Use the ticker buttons to switch which ETF is shown,
        or use <strong>Hide Chart</strong> to collapse the section.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Distribution amounts and expected yield prefer supported official issuer sites when available. For NEOS funds,
        Goldman Sachs funds such as GPIQ and GPIX, and other supported families, the chart and expected yield use fund-site
        data first and fall back to Yahoo Finance when official data is unavailable. The source label shows where the chart
        data came from.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        When the chart is in <strong>Yield %</strong> mode, an <strong>Annual / Monthly</strong> toggle appears.
        <em>Monthly</em> shows each distribution's per-period yield (distribution ÷ price × 100).
        <em>Annual</em> uses a rolling completed distribution cycle—four payments for quarterly funds,
        twelve months for monthly funds, and the equivalent cycle for other schedules. This keeps one
        unusually high or low payment from distorting the annual yield. Switching back to
        <strong>$ Amount</strong> mode resets the toggle to Monthly automatically.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/etf-comparer/distribution-history.jpg" alt="ETF Comparer distribution history chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Comparison Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A sortable table shows live market data for each ticker. Symbol and Fund Name columns are always visible;
        all other columns are optional. Click <strong>Indicators</strong> to open the column picker and toggle which fields appear.
        Available columns include: stock price, daily % change, assets under management, expense ratio, PE ratio,
        expected dividend yield, dividend yield, expected yield source, volume, dollar volume, open price, 1Y CAGR,
        52-week high/low, issuer, category, max drawdown, and <strong>Ret vs Yld</strong>.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Expected Div. Yield</strong> is a forward-looking estimate based on official issuer distribution rates,
        official distribution history, saved provider data, or Yahoo Finance fallback data, depending on what is available.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Ret vs Yld</strong> compares each ETF's 1-year total return to its expected dividend yield.
        <strong> Good</strong> (green) means the 1-year return exceeds the yield — price appreciation is contributing
        value on top of the income. <strong>Poor</strong> (red) means the yield exceeds the 1-year return — the price
        declined enough over the past year to offset more than the dividend provided. Hover a cell for the exact
        return, yield, and spread values. This column is on by default and can be hidden via the Indicators menu.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/etf-comparer/comparison-table.jpg" alt="ETF Comparer comparison table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Average Return Bar Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the comparison table, a grouped bar chart shows average annualized returns for each ticker
        across standard time windows (year-to-date, 1Y, 5Y, 10Y, and inception where available). This makes it easy to spot which ETF has led
        or lagged across different horizons at a glance.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Use <strong>Download CSV</strong> to export the Average Return table. Exported return columns include
        <strong> Return (%)</strong> in the heading so values such as 19.27 are clearly understood as 19.27%.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/etf-comparer/average-returns.jpg" alt="ETF Comparer average return bar chart and multi-period table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Multi-Period Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A tabular summary shows the same available average-return windows for each ticker. Blank cells mean that ticker
        does not have enough history or aligned data for that period.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>When to Use It</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li>Use ETF Comparer when you want to evaluate several ETFs head-to-head with full return history and fund metrics.</li>
        <li>Use Stock Comparer for the same workflow applied to individual stocks, with stock-specific fundamentals (market cap, PE, PEG, margins, etc.).</li>
        <li>Use Security Research for a single-ticker quick lookup.</li>
        <li>Use ETF/Stock Analysis when you need technical indicators, drawing tools, or a reinvestment-rate simulation for a single ticker.</li>
      </ul>
    </div>
  )
}

function StockComparerHelp() {
  return (
    <div>
      <h2>Stock Comparer</h2>
      <p style={{ marginBottom: '1rem' }}>
        Stock Comparer lets you compare up to seven individual stocks side-by-side using an interactive return chart,
        a customizable data table, an average return bar chart, a multi-period comparison table,
        a distribution history chart, and a Key Fundamentals card panel showing 24+ metrics per stock.
        It mirrors the ETF Comparer layout but uses stock-specific columns and fundamentals.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/stock-comparer/return-chart.jpg" alt="Stock Comparer return chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Adding Tickers</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Type one or more stock tickers (comma- or space-separated) and press <strong>Add</strong> or Enter.</li>
        <li>Each ticker appears as a colored chip. Click × to remove it.</li>
        <li>Up to seven tickers can be compared simultaneously.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Return Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Identical controls to ETF Comparer: period selector (1M–MAX), return mode (Total Return, Price Only, Actual Price, Price + Divs, Both, All Three, All Four),
        reinvestment % slider, % / index toggle, end labels, and a date range slider. Actual Price charts each stock&apos;s real dollar share price instead of a relative return.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/stock-comparer/distribution-history.jpg" alt="Stock Comparer distribution history chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Comparison Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Symbol and Company Name are always visible. Optional columns include stock-specific fields not available for ETFs:
        market cap, forward PE, PEG ratio, dividend growth rate, and EPS (TTM), in addition to the common fields
        (price, daily % change, PE ratio, dividend yield, volume, dollar volume, open, 1Y CAGR, beta, payout ratio,
        debt/equity, 52-week high/low, sector, industry, max drawdown, revenue, profit margin).
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/stock-comparer/comparison-table.jpg" alt="Stock Comparer comparison table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Average Return Bar Chart &amp; Multi-Period Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Same as ETF Comparer — grouped bar chart of 1Y/3Y/5Y/10Y annualized returns and a tabular multi-period summary.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/stock-comparer/average-returns.jpg" alt="Stock Comparer average return bar chart and multi-period table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Distribution History</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Distribution History section shows up to three years of dividend payments for each stock as a bar chart.
        Use the ticker buttons to switch which stock is displayed, or use <strong>Hide Chart</strong> to collapse the section.
        Bars are colored green when the dividend amount is at or above the rolling average, and blue when below.
        Data is sourced from Yahoo Finance, and the source label is shown in the top-right corner of the chart.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        When the chart is in <strong>Yield %</strong> mode, an <strong>Annual / Monthly</strong> toggle appears.
        <em>Monthly</em> shows each payment's per-period yield (distribution ÷ price × 100).
        <em>Annual</em> multiplies by 12 to approximate an annualized rate for direct comparison across payers
        with different frequencies. Switching back to <strong>$ Amount</strong> resets to Monthly.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Key Fundamentals Cards</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the charts and table, each loaded stock gets a fundamentals card showing 24 metrics organized into groups:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Size &amp; Valuation</strong> — Market Cap, Enterprise Value, Trailing PE, Forward PE, PEG Ratio, Price/Book, Price/Sales, Beta.</li>
        <li><strong>Profitability</strong> — Revenue, Net Income, Free Cash Flow, EBITDA, Gross Margin, Operating Margin, Profit Margin, Revenue Growth.</li>
        <li><strong>Balance Sheet</strong> — Total Cash, Total Debt, Debt/Equity.</li>
        <li><strong>Dividend</strong> — Dividend Yield, Payout Ratio, Dividend Growth Rate.</li>
        <li><strong>52-Week Range</strong> — 52-Wk Low and 52-Wk High.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Dividend yield in the fundamentals card is computed from trailing twelve-month dividends divided by current price,
        which avoids scaling inconsistencies in the data provider's reported yield field.
      </p>
    </div>
  )
}

function RebalanceWizardHelp() {
  return (
    <div>
      <h2>Rebalance Wizard</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Rebalance Wizard generates a category-level rebalance trade list for your active portfolio,
        using your existing category targets and an income floor constraint to protect dividend income
        while moving allocations toward their targets.
        It can also be launched from the Categories page via the <strong>Target Assistant</strong>.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/rebalance-wizard/Screenshot 2026-05-09 122956.jpg" alt="Rebalance Wizard trade plan" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Settings</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Income Mode</strong> — <em>Preserve current income</em> sets the income floor to the portfolio's current monthly income. <em>Use custom floor only</em> lets you specify a different floor via the Minimum Monthly Income field.</li>
        <li><strong>Rebalance Priority</strong> — <em>Match targets while preserving income</em> prioritizes closing allocation gaps subject to the income floor. <em>Maximize income while reducing drift</em> picks higher-yielding candidates first.</li>
        <li><strong>Minimum Yield %</strong> — Optional. Buy candidates below this yield are excluded.</li>
        <li><strong>Minimum Monthly Income</strong> — Optional custom income floor. Only used in custom floor mode.</li>
        <li><strong>New Cash</strong> — Dollar amount of fresh capital to deploy. Defaults to 0 (rebalance within existing value).</li>
        <li><strong>Minimum Trade</strong> — Trades smaller than this dollar threshold are suppressed. Defaults to $100.</li>
        <li><strong>Locked Tickers</strong> — Comma-separated list of tickers that should not be sold (e.g. <code>JEPI, MAIN</code>).</li>
        <li><strong>Allow Sells</strong> — Uncheck to generate buy-only trades (useful when adding new cash without trimming existing holdings).</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Plan Summary Cards</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        After generating, summary cards show:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Current Monthly Income</strong> — income before trades.</li>
        <li><strong>Projected Monthly Income</strong> — income after all effective trades, with the delta vs current.</li>
        <li><strong>Required Income Floor</strong> — the floor the optimizer enforced.</li>
        <li><strong>Income Guardrail</strong> — Met (green) or Blocked (red). Blocked means the edited trades would drop income below the floor; exports are disabled until resolved.</li>
        <li><strong>Trade Totals</strong> — total buy dollars and total sell dollars.</li>
        <li><strong>Remaining Drift</strong> — total dollar distance from category targets after applying all trades.</li>
        <li><strong>Execution</strong> — count of trades by status (pending / reviewed / placed / filled / skipped).</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Trade List</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each generated trade shows the action (BUY/SELL), ticker, category, dollar amount, shares, price, yield,
        monthly income delta, and cumulative portfolio yield after the trade. You can:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Switch tickers</strong> — use the dropdown on any trade to pick an alternative candidate from the same category, or type a ticker to look it up live.</li>
        <li><strong>Edit amounts</strong> — override the dollar amount, price, or yield for any trade.</li>
        <li><strong>Remove trades</strong> — click the × to suppress a trade. Removed trades count toward Remaining Drift. Click <strong>Restore Removed</strong> to undo.</li>
        <li><strong>Add manual trades</strong> — click <strong>Add Trade</strong> to insert a custom buy or sell not generated by the optimizer.</li>
        <li><strong>Mark execution status</strong> — set each trade to Reviewed, Placed, Filled, or Skipped to track progress as you work through the list in your broker.</li>
        <li><strong>Mark all reviewed</strong> — batch-sets all pending trades to Reviewed.</li>
      </ul>

      <div className="alert alert-warning" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Income guardrail:</strong> if edited trades would drop projected monthly income below the required floor,
        the page shows a hard-block warning and disables all exports until the issue is resolved.
        Suspicious high-yield replacements (yield above 2× the portfolio average or 25%, whichever is higher) are also flagged.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Category Candidates</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>Candidates</strong> section lets you set preferred tickers per category.
        Preferred tickers are ranked first when the optimizer picks buy candidates for that category.
        Drag candidates up or down to set priority order, then click <strong>Save Preferences</strong> to persist them and regenerate the plan.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Saving and Loading Plans</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Give the plan a name and click <strong>Save Plan</strong> to persist it to the database.</li>
        <li>Previously saved plans appear in the <strong>Saved Plans</strong> dropdown with projected income and status.</li>
        <li>Select a plan and click <strong>Load</strong> to restore all settings, trades, and execution state.</li>
        <li>Click <strong>Update Plan</strong> to overwrite the currently selected saved plan.</li>
        <li>Click <strong>Delete</strong> to remove the selected saved plan.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Exports</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Export Trade List (CSV)</strong> — exports the effective trade list with action, ticker, category, shares, amount, price, yield, income delta, and reason.</li>
        <li><strong>Export Broker Ticket (CSV)</strong> — exports a broker-ready format including execution status and notes, suitable for copy/pasting into a trade journal or broker order system.</li>
        <li><strong>Export Audit JSON</strong> — exports the full plan snapshot including settings, result, trade state, and summary for archiving or debugging.</li>
      </ul>
    </div>
  )
}

function TaxLossHarvestHelp() {
  return (
    <div>
      <h2>Tax-Loss Harvest</h2>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Tax-Loss Harvest</strong> page scans every open BUY lot in your portfolio
        for unrealized losses you can realize to offset capital gains and reduce taxable income.
        Each lot is evaluated individually — so if you bought the same ticker across multiple
        dates you can harvest the losing lots while holding the profitable ones.
      </p>

      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        <strong>Estimates only.</strong> Wash-sale rules, cross-account household treatments,
        and "substantially identical" determinations can be complex. This tool surfaces
        candidates for review — confirm any harvest with a tax professional before trading.
      </div>

      <h3 style={{ marginBottom: '0.5rem' }}>Summary cards</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Harvestable Loss</strong> — Total unrealized loss across all wash-sale-clear candidate lots. Candidate count shown below.</li>
        <li><strong>YTD Realized</strong> — Gains and losses already booked this calendar year from SELL transactions.</li>
        <li><strong>Net After Harvest</strong> — YTD Realized plus Harvestable Loss. Shows whether harvesting would flip you to a net loss for the year.</li>
        <li><strong>Est. Tax Saved</strong> — Loss × (short-term or long-term rate + state rate), summed across clear candidates. Rates are set in <strong>Settings → Tax-Loss Harvesting Rates</strong>.</li>
        <li><strong>Blocked by Wash Sale</strong> — Loss amount in lots that are currently blocked. These will become harvestable once the 30-day window passes.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img
          src="./help-screenshots/Tax-loss/tax-loss-harvest-overview.jpg"
          alt="Tax-Loss Harvest page showing summary cards and candidate table with wash-sale status badges"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h3 style={{ marginBottom: '0.5rem' }}>Candidate table</h3>
      <p style={{ marginBottom: '0.5rem' }}>
        Each row is one BUY lot with an unrealized loss. Columns:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The holding. Lots bought via DRIP reinvestment are tagged with a DRIP label.</li>
        <li><strong>Buy Date</strong> — The date that specific lot was purchased, which determines the holding period.</li>
        <li><strong>Shares</strong> — Open shares remaining in that lot (after any prior partial sells).</li>
        <li><strong>Cost/sh</strong> — Average cost per share including fees for this lot.</li>
        <li><strong>Current</strong> — Current market price from the most recent holdings refresh.</li>
        <li><strong>Unrealized $</strong> — The dollar loss at current price. Shown in red.</li>
        <li><strong>Term</strong> — <strong>ST</strong> (short-term, held ≤ 365 days) or <strong>LT</strong> (long-term, held &gt; 365 days). Determines which tax rate applies.</li>
        <li><strong>Wash</strong> — <span style={{ color: 'var(--pos)' }}>Clear</span> means no conflicting buy in the last 30 days; <span style={{ color: 'var(--neg)' }}>Wash sale → date</span> means a buy of the same ticker occurred within the window and the harvest is blocked until that date.</li>
        <li><strong>Tax Saved</strong> — Estimated tax saved if this lot is harvested, using your configured marginal rates.</li>
        <li><strong>Plan button</strong> — Only enabled for Clear lots. Click to add the harvest to your plan.</li>
      </ul>

      <p style={{ marginBottom: '1rem' }}>
        Click any row to expand it. The expanded panel shows <strong>replacement candidate suggestions</strong>
        (tickers in the same category that aren't substantially identical to what you're selling)
        and, for blocked lots, the specific BUY transactions causing the wash-sale conflict along
        with the exact date the window clears.
      </p>

      <p style={{ marginBottom: '1rem' }}>
        Use the <strong>Hide wash-sale-blocked lots</strong> checkbox to filter the table to
        actionable candidates only.
      </p>

      <h3 style={{ marginBottom: '0.5rem' }}>Planned tab</h3>
      <p style={{ marginBottom: '1rem' }}>
        Harvests you've planned are listed here. Each planned harvest also surfaces as a
        <strong> Needs Review</strong> item in the <strong>Action Center</strong> so it stays
        visible until you act on it. After executing the trade in your brokerage, re-import
        your transactions — the lot will close and the candidate will disappear automatically.
        Use the <strong>Remove</strong> button to dismiss a plan without executing it.
      </p>

      <h3 style={{ marginBottom: '0.5rem' }}>Wash-sale rules</h3>
      <p style={{ marginBottom: '1rem' }}>
        The IRS disallows a loss if you buy the same (or substantially identical) security
        within 30 days before or after the sale. This page checks the 30-day window looking
        backward from today against all BUY transactions for that ticker across all accounts
        in scope — including DRIP reinvestments, which count as acquisitions. A buy in any
        account blocks the loss, not just the one holding the losing lot.
      </p>

      <h3 style={{ marginBottom: '0.5rem' }}>Setting your tax rates</h3>
      <p style={{ marginBottom: '1rem' }}>
        Go to <strong>Settings → Tax-Loss Harvesting Rates</strong> and enter your marginal
        short-term rate, long-term rate, and state rate as percentages (e.g. 32, 15, 5).
        The page defaults to 32% short-term and 15% long-term until you save your own rates.
      </p>
    </div>
  )
}

function BlendedYieldHelp() {
  return (
    <div>
      <h2>Blended Yield Calculator</h2>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Blended Yield Calculator</strong> shows the true after-tax yield of your investment portfolio
        accounting for Federal and state progressive tax brackets. It calculates what you actually <em>keep</em> from
        each fund after taxes, then blends them weighted by allocation to show your portfolio's real income.
      </p>

      <h3 style={{ marginBottom: '0.5rem' }}>Key Concepts</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>After-Tax Yield (ATY)</strong> — The yield you actually receive after paying taxes. What you keep.</li>
        <li><strong>Tax-Equivalent Yield (TEY)</strong> — What a fully taxable bond would need to yield to give you the same after-tax income. Used to compare tax-exempt funds apples-to-apples.</li>
        <li><strong>Blended Yield</strong> — Your portfolio's weighted-average tax-equivalent yield across all holdings. The single best metric to compare different allocations.</li>
        <li><strong>Six Tax Classifications</strong> — Fully Taxable, Treasury (State Exempt), Fed Exempt (Muni), Fed+State Exempt, Return of Capital (ROC), and Qualified/LTCG.</li>
      </ul>

      <h3 style={{ marginBottom: '0.5rem' }}>How to Use</h3>

      <h4 style={{ marginBottom: '0.5rem' }}>Step 1: Set Tax Profile</h4>
      <p style={{ marginBottom: '1rem' }}>
        Select your state, filing status, taxable income, and total portfolio amount.
        The calculator displays your current Federal, State, Combined, and LTCG marginal tax rates.
      </p>

      <h4 style={{ marginBottom: '0.5rem' }}>Step 2: Add Funds</h4>
      <p style={{ marginBottom: '1rem' }}>
        Enter a ticker (e.g., SGOV, JEPI, MUB, TDAQ) and click <strong>Add Fund</strong>. The calculator looks up the fund
        in its built-in database of 100+ common income funds. If found, the name, yield, and tax type fill automatically.
        If not found, you'll be prompted to enter the yield manually (saves to your browser).
      </p>

      <h4 style={{ marginBottom: '0.5rem' }}>Step 3: Load Tickers From Your Portfolio</h4>
      <p style={{ marginBottom: '1rem' }}>
        Click <strong>From Portfolio</strong> to open a picker with your current holdings. Use search to narrow the list,
        check any combination of tickers, or use <strong>Select All</strong> and <strong>Deselect All</strong> to quickly
        choose the full portfolio or clear the selection. Click <strong>Add Tickers</strong> to add the selected holdings
        with their current values as allocations.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        You can still add tickers that are not in your portfolio with the manual ticker box. Portfolio-loaded tickers and
        manually added tickers can be mixed in the same blended-yield scenario.
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img
          src="./help-screenshots/blended-yield/04-portfolio-picker.png"
          alt="Blended Yield Calculator portfolio picker with search, Select All, Deselect All, and Add Tickers controls"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h4 style={{ marginBottom: '0.5rem' }}>Step 4: Configure Each Fund</h4>
      <p style={{ marginBottom: '1rem' }}>
        For each fund card, enter:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Distribution Yield %</strong> — Annual yield (verify current yield from your broker)</li>
        <li><strong>Tax Classification</strong> — The appropriate tax type for this fund</li>
        <li><strong>Allocation % or $</strong> — Your position size (one calculates the other)</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Results update in real-time: Annual/monthly income, After-Tax Yield (ATY), Tax-Equiv Yield (TEY), and effective tax rate.
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img
          src="./help-screenshots/blended-yield/01-portfolio-setup.jpg"
          alt="Blended Yield Calculator tax profile and fund cards"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h4 style={{ marginBottom: '0.5rem' }}>Step 5: Review Portfolio Summary</h4>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Portfolio Summary</strong> shows your blended yield (TEY), after-tax yield, annual and monthly income.
        A color-coded allocation bar shows fund weights. A detailed breakdown table lists every fund with yields,
        tax rates, allocations, and income contributions.
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img
          src="./help-screenshots/blended-yield/02-portfolio-summary.jpg"
          alt="Portfolio Summary results, allocation bar, and breakdown table"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h3 style={{ marginBottom: '0.5rem' }}>Customizing Tax Brackets</h3>
      <p style={{ marginBottom: '1rem' }}>
        Click <strong>Tax Bracket Settings</strong> to expand the editor. You can customize Federal, State, and LTCG brackets
        if tax rates change. Toggle between Single and Married Filing Jointly to edit brackets for different statuses.
        Edit thresholds and rates, add/remove bracket rows, and click <strong>Save Brackets</strong> to persist to your browser.
        Click <strong>Restore 2025 Defaults</strong> to reset to 2025 tax rates.
      </p>

      <p style={{ marginBottom: '1rem' }}>
        A "Custom" badge appears when custom brackets are saved. An "Unsaved" badge appears when you've made changes
        but haven't saved yet.
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img
          src="./help-screenshots/blended-yield/03-tax-bracket-settings.jpg"
          alt="Tax Bracket Settings editor with editable Federal, LTCG, California, Arizona, and Pennsylvania brackets"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
      </div>

      <h3 style={{ marginBottom: '0.5rem' }}>Built-in Fund Database</h3>
      <p style={{ marginBottom: '1rem' }}>
        The calculator includes 100+ common income funds: Covered-Call ETFs (JEPI, XYLD, QYLD, RYLD), YieldMax single-stock
        option funds (TSLY, NVDY, CONY, PLTY, etc.), CEFs (PDI, PTY, TRIN, ARCC), BDCs, municipal bonds, Treasuries, REITs, and growth ETFs.
      </p>

      <h3 style={{ marginBottom: '0.5rem' }}>Important Notes</h3>
      <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
        <strong>Yields are approximate.</strong> The built-in database has approximate yields as of early 2025.
        <strong> Always verify current yields from your broker or fund provider</strong> before relying on calculations.
        Update any yield manually in the card — it saves to your browser.
      </div>

      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>State-Specific Muni Funds</strong> — CA muni funds (CMF, NKX, VCV) auto-reclassify when you switch states.</li>
        <li><strong>Pennsylvania Special Rule</strong> — PA exempts all municipal bond interest from state tax, even national muni funds.</li>
        <li><strong>Not Financial Advice</strong> — This is a calculator only. Tax situations vary widely. Consult a tax professional for your specific situation.</li>
      </ul>

      <h3 style={{ marginBottom: '0.5rem' }}>Tips</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Compare Allocations:</strong> Adjust allocation % or $ in any card to test different portfolio mixes. Find the best after-tax income for your goals.</li>
        <li><strong>Verify Tax Classifications:</strong> Wrong tax type = wrong after-tax yield. Double-check corporate bonds (Fully Taxable), Treasuries (State Exempt), national munis (Fed Exempt), and option funds (ROC).</li>
        <li><strong>Load a Partial Portfolio:</strong> Use From Portfolio to select only the holdings you want to compare, or Select All to model the whole portfolio.</li>
        <li><strong>Save Custom Brackets Once:</strong> If rates change, edit and save custom brackets once. They persist until you click Restore 2025 Defaults.</li>
        <li><strong>Manual Fund Lookup:</strong> If a ticker doesn't auto-populate, search your broker for the current yield and enter it manually. It saves with a blue ★ badge for next time.</li>
      </ul>
    </div>
  )
}

function StockValuationHelp() {
  const imgStyle = { maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }
  const h3 = { color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }
  return (
    <div>
      <h2>Stock Valuation (DCF)</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Stock Valuation screen estimates what a stock is <strong>worth</strong> and tells you whether
        today's price is <strong>undervalued, fairly valued, or overvalued</strong>. Type a ticker and it
        builds an intrinsic value from a discounted cash flow blended with several fair-value models, shows a
        plain over/under verdict, and lays out a full ratio scorecard. It is built for operating companies;
        funds (ETFs, CEFs, mutual funds, BDCs) are turned away because a company DCF doesn't apply to them.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/stock-valuation/verdict-and-intrinsic-value.jpg" alt="Stock Valuation verdict banner, intrinsic-value method table, implied-price chart, and editable DCF assumptions" style={imgStyle} />
      </div>

      <h3 style={h3}>The Verdict Banner</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The banner compares the current price to the blended fair value and reads <strong>Undervalued</strong>{' '}
        (more than 15% below fair value), <strong>Fairly Valued</strong> (within ±15%), or{' '}
        <strong>Overvalued</strong>. <strong>Margin of safety</strong> is the discount to fair value — positive
        is a cushion, negative means you're paying a premium. <strong>Confidence</strong> (high / medium / low)
        tells you how much to trust the number — see the accuracy section below.
      </p>

      <h3 style={h3}>How Fair Value Is Estimated</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Up to five methods are computed where the data allows, then blended into one intrinsic value (the
        surviving low–high range is shown beside it):
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '0.75rem' }}>
        <li><strong>Discounted cash flow (≈45% weight)</strong> — projects free cash flow forward, with the
          growth rate <em>fading</em> from the stage-1 rate down to the terminal rate over the horizon, adds a
          Gordon-growth terminal value, discounts it all to today, and bridges to equity value with net cash.
          Carries the most weight when free cash flow is positive; for banks and no-cash-flow names it drops
          out and the multiples carry the estimate.</li>
        <li><strong>Fair forward P/E, P/B, P/S</strong> — a conservative sector "fair" multiple applied to
          forward EPS, book value per share, and sales per share.</li>
        <li><strong>Dividend discount model</strong> — for dividend payers, the present value of the growing
          future dividend stream (Gordon model).</li>
      </ul>

      <h3 style={h3}>Editable DCF Assumptions</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The DCF is pre-filled with automatic defaults — growth from analyst/historical figures (capped 3–20%),
        a discount rate from the CAPM cost of equity (using beta), 2.5% terminal growth, and a 10-year horizon.
        These are <em>starting points, not gospel</em>. Edit any of the four inputs and press{' '}
        <strong>Recompute</strong> to run bull/bear scenarios; the blended value and verdict update live. This
        is the single most useful habit on this screen — see how far the fair value moves when you nudge the
        growth or discount rate, because that swing <em>is</em> the uncertainty.
      </p>

      <h3 style={h3}>Outlier Exclusion &amp; Confidence</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The methods don't always agree. A method that lands wildly out of line with the others — e.g. a sector
        price/sales multiple applied to a very-low-margin company — is flagged <strong>"excluded — outlier"</strong>{' '}
        and dropped from the blend so one wild estimate can't drag the result. The{' '}
        <strong>Confidence</strong> label then reflects how tightly the <em>surviving</em> methods agree:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '0.75rem' }}>
        <li><strong>High</strong> — the methods cluster tightly; the fair value is relatively trustworthy.</li>
        <li><strong>Medium</strong> — the methods show meaningful spread; sanity-check before acting.</li>
        <li><strong>Low</strong> — the methods disagree a lot; treat the fair value as a rough signal only and
          lean on the ratio scorecard and your own judgment.</li>
      </ul>

      <h3 style={h3}>The Ratio Scorecard</h3>
      <div style={{ marginBottom: '1rem' }}>
        <img src="./help-screenshots/stock-valuation/ratio-scorecard.jpg" alt="Stock Valuation ratio scorecard: valuation multiples, profitability, financial health, and risk-adjusted returns with section grades and per-metric badges" style={imgStyle} />
      </div>
      <p style={{ marginBottom: '0.75rem' }}>
        Separate from the valuation verdict (is it <em>cheap</em>?), the scorecard grades whether it's a{' '}
        <em>good</em> business (and a safe one). Any ratio Yahoo omits but that can be derived from the
        financial statements is computed (FCF yield, debt ratio, interest coverage, payout/PEG/ROE/ROA
        fallbacks). Each metric is colour-graded against a sector benchmark or standard threshold, and each
        section gets its own score:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '0.75rem' }}>
        <li><strong>Valuation multiples</strong> — forward P/E, PEG, P/B, P/S, FCF yield, dividend payout vs. the sector.</li>
        <li><strong>Profitability &amp; returns</strong> — ROE, ROA, and operating/net/gross margins.</li>
        <li><strong>Financial health</strong> — debt/equity, debt ratio, interest coverage, current ratio.</li>
        <li><strong>Risk-adjusted returns</strong> — Sharpe, Sortino, Calmar, and Omega ratios over ~3 years of daily prices.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Each metric has its own <strong>"How to read these"</strong> drop-down on the screen with plain-English
        explanations.
      </p>

      <h3 style={h3}>How Accurate Is This? (Please read)</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Be honest with yourself about what this is: a <strong>model</strong>, not a price target. It is only as
        good as the data it's fed and the assumptions behind it, and small assumption changes move the answer a
        lot. Specifically:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '0.75rem' }}>
        <li><strong>Garbage in, garbage out.</strong> Everything comes live from Yahoo Finance. Stale, missing,
          or quirky figures flow straight through. If a number on the page looks wrong, it probably is.</li>
        <li><strong>The DCF is assumption-sensitive.</strong> The fair value can swing 30–50% from a couple of
          points of growth or discount rate. The auto-filled growth (capped at 20%) is often too optimistic for
          mature companies whose near-term growth is elevated off a depressed base — always Recompute with a
          rate you actually believe.</li>
        <li><strong>Accounting quirks break individual methods.</strong> Companies with negative book equity
          (heavy buybacks/leverage) produce a negative or meaningless Price/Book and ROE; thin-margin firms
          break Price/Sales. The model excludes gross outliers, but it can't repair distorted inputs.</li>
        <li><strong>It's a snapshot, not a forecast of the business.</strong> It doesn't know about lawsuits,
          a pipeline, a turnaround, or a secular decline — only the trailing numbers.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Worked example — Altria (MO), above.</strong> The screen shows a fair value of about $180 vs a
        $73 price — a tempting "59% undervalued." But notice the warning signs working together: Confidence is
        only <strong>Medium</strong>, the methods span roughly $18 to $230, Return on Equity reads −198% and
        Price/Book is negative (Altria has <em>negative shareholder equity</em> from years of buybacks and
        debt), and the headline is dominated by a DCF running a 20% growth rate — implausible for a company
        with declining cigarette volumes. Drop the growth to something realistic (say 2–4%) and Recompute, and
        that $180 falls sharply. The model isn't lying to you — the Medium-confidence flag and the red
        profitability rows are it telling you <em>not</em> to take the headline at face value.
      </p>

      <h3 style={h3}>How Confidence Affects Accuracy</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Treat Confidence as the screen's own honesty meter about the fair value:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '0.75rem' }}>
        <li><strong>High confidence</strong> — independent methods landed close together. The fair value is
          worth taking seriously, though it's still an estimate.</li>
        <li><strong>Medium confidence</strong> — the methods spread out. Use the fair value as a ballpark, not a
          number; cross-check the scorecard and Recompute with your own assumptions.</li>
        <li><strong>Low confidence</strong> — the methods badly disagree (often with one already excluded as an
          outlier). The single fair-value figure is close to meaningless on its own — lean on the scorecard, the
          per-method range, and your own read of the business instead.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        A useful rule of thumb: the wider the per-method range and the lower the confidence, the more the
        verdict is a <em>conversation starter</em> rather than an answer. A confident verdict that lines up with
        a strong scorecard is the strongest signal this screen produces; a low-confidence verdict that conflicts
        with the scorecard is a flag to dig deeper, not a green light.
      </p>

      <p style={{ marginBottom: '0.75rem', color: 'var(--p-9aa7b8)', fontSize: '0.9rem' }}>
        Data is fetched live from Yahoo Finance. The DCF treats free cash flow as firm-level and the discount
        rate as a CAPM cost of equity (not a full WACC) — pragmatic simplifications you can override. This is
        decision support and an educational tool, <strong>not investment advice</strong>. Always do your own
        research before buying or selling.
      </p>
    </div>
  )
}

function StockBuyingChecklistHelp() {
  return (
    <div>
      <h2>Stock Buying Checklist</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Stock Buying Checklist scores an individual stock on both fundamental and technical analysis,
        then blends the two into a single buy verdict. Fundamentals are graded <strong>relative to the
        stock's sector</strong> — a "cheap" utility P/E is different from a "cheap" technology P/E — while
        technicals use standard chart indicators. It is built for individual companies; use the ETF and CEF
        evaluators for funds.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Two Modes</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Deep Dive</strong> — Type one ticker for a full scorecard: a Fundamental composite, a
          Technical composite, a blended verdict, and eight expandable criteria cards. If you enter a fund
          ticker a warning is shown, but the technical analysis still runs.</li>
        <li><strong>Scan a List</strong> — Enter several tickers (or pick your portfolio or watchlist) to score
          them all at once in a sortable table. In this mode each stock is graded against the live median of
          its sector <em>within the batch you scanned</em>.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Automatic Fund Filtering</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Scan tab automatically detects and skips funds so they don't appear alongside stocks or receive
        misleading fundamental scores. The following types are filtered out:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '0.75rem' }}>
        <li><strong>ETFs &amp; mutual funds</strong> — detected from Yahoo Finance's quote type.</li>
        <li><strong>Closed-end funds (CEFs)</strong> — detected from the fund's description, even when Yahoo
          reports them as equities (e.g. FSCO, PDI).</li>
        <li><strong>Business Development Companies (BDCs)</strong> — similarly detected from the description
          (e.g. HTGC, BXSL, ARCC).</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        Skipped tickers appear in an amber banner below the scan results with their type listed, so nothing
        silently disappears. REITs are <em>not</em> filtered — they file standard company financials and
        can be graded as stocks.
      </p>
      <p style={{ marginBottom: '0.75rem', color: 'var(--p-9aa7b8)', fontSize: '0.9rem' }}>
        For skipped tickers, use the dedicated evaluators: <strong>Non Income ETF Checklist Evaluator</strong> for broad
        ETFs, <strong>Option-Income ETF Evaluator</strong> for covered-call/put-write funds, and
        <strong>CEF Buying Checklist</strong> for closed-end funds and BDCs.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Fundamental Criteria</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Valuation</strong> — P/E, forward P/E, PEG, P/B, P/S, and EV/EBITDA versus the sector (lower is better).</li>
        <li><strong>Profitability</strong> — Net, operating, and gross margins plus return on equity and assets.</li>
        <li><strong>Growth &amp; Earnings</strong> — Revenue and earnings growth, positive EPS, and recent earnings beats.</li>
        <li><strong>Balance-Sheet Health</strong> — Debt/equity, current ratio, and (for payers) the dividend payout ratio.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Technical Criteria</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Trend</strong> — Price versus the 50- and 200-day moving averages, including the golden/death cross.</li>
        <li><strong>Momentum</strong> — MACD (12/26/9) and RSI (14).</li>
        <li><strong>Oscillators</strong> — Slow stochastic and the Awesome Oscillator.</li>
        <li><strong>Volume &amp; Range</strong> — On-balance-volume trend, volume vs. its 20-day average, and where price sits in its 52-week range.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>The Blended Verdict</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Fundamental and Technical composites are combined (60% fundamental / 40% technical by default) into a
        verdict of <strong>Strong Buy</strong>, <strong>Buy</strong>, <strong>Hold</strong>, or <strong>Avoid</strong>.
        Keeping the two scores separate is deliberate: it lets you spot a great company with poor entry timing,
        or a hot chart on a weak business, instead of hiding that distinction in one number.
      </p>
      <p style={{ marginBottom: '0.75rem', color: 'var(--p-9aa7b8)', fontSize: '0.9rem' }}>
        Data is fetched live from Yahoo Finance. This is decision support, not investment advice.
      </p>
    </div>
  )
}

function ETFBuyingChecklistHelp() {
  return (
    <div>
      <h2>Non Income ETF Checklist Evaluator</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Non Income ETF Checklist Evaluator grades any broad-market, sector, dividend, or specialty ETF across
        seven structured criteria. It fetches live data for the ticker, scores each criterion Pass / Warn / Fail,
        rolls them up into a composite verdict, and suggests smarter alternatives when the fund falls short.
        It is designed for standard (non-option-income) ETFs — use the Option-Income ETF Evaluator for
        covered-call and put-write funds.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Two Modes</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>
          <strong>Deep Dive</strong> — Type one ticker for a full scored breakdown: seven criteria cards,
          a composite score, a buy verdict, and Smart Alternatives from the same strategy group.
        </li>
        <li>
          <strong>Scan a List</strong> — Evaluate multiple ETFs at once in a sortable ranking table.
          Check <em>My holdings</em> and/or <em>My watchlist</em> to pull tickers automatically, or paste
          extra tickers into the text box. The scanner evaluates <strong>ETFs only</strong> — option-income
          ETFs and CEFs are automatically separated and redirected to their own evaluator. Results include
          Yield, Expense Ratio, Total Return, Composite score, and all five risk-adjusted ratio columns.
        </li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/etf-buying-checklist-evaluator/etf_checklist_top.jpg" alt="Non Income ETF Checklist Evaluator top — ticker lookup, verdict card, and criteria" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>The Seven Criteria</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>
          <strong>1. Strategy Fit</strong> — Does the fund's index, sector, or mandate match your intended exposure?
          Avoids duplicating a strategy you already hold and flags non-obvious category mismatches.
          Informational only — not scored.
        </li>
        <li>
          <strong>2. Expense Ratio</strong> — Scores Pass (≤ your threshold), Warn, or Fail (above threshold).
          Broad market ETFs should be well under 0.10%; sector and specialty funds under 0.50%.
          Thresholds are fully adjustable.
        </li>
        <li>
          <strong>3. Fund Size &amp; Liquidity</strong> — Checks AUM and average daily dollar volume. Funds under $100M
          face elevated closure risk; thin trading increases implicit transaction costs.
        </li>
        <li>
          <strong>4. Performance vs. Peers</strong> — Compares 3Y and 5Y average annual total returns against the
          category peer group from the scanner cache. Funds too new for a 3Y return receive an info badge.
        </li>
        <li>
          <strong>5. Risk / Beta</strong> — Evaluates 3-year beta. Near 1.0 is normal. Above 1.5 flags elevated
          market sensitivity; very low beta (&lt; 0.3) may indicate a niche strategy with limited growth potential.
        </li>
        <li>
          <strong>6. Yield Sustainability</strong> — Only scored when the fund yields above 2%. Checks whether the
          yield exceeds the fund's long-term total return, which would imply NAV erosion.
        </li>
        <li>
          <strong>7. Risk-Adjusted Return Profile</strong> — A bundled criterion that folds five quantitative
          risk ratios into one scored criterion (see <em>Risk-Adjusted Scoring</em> below). Computed from the
          fund's full dividend-adjusted price history and excluded from the composite when fewer than ~250
          trading days (~1 year) of data exist. When sufficient history is present the score joins the composite
          on equal footing with the other criteria.
        </li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Risk-Adjusted Scoring</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Criterion 7 bundles five standard risk-adjusted return ratios into a single 0–100 score. The ratios
        are computed on the <strong>dividend-adjusted (total-return) price series</strong> so
        high-distribution funds are not penalized twice — NAV erosion is already captured by Criterion 6.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Sharpe Ratio</strong> — excess return above the risk-free rate divided by total volatility
          (standard deviation). Measures how much return you get per unit of risk taken.
          &gt; 1.0 is solid; &gt; 1.5 is excellent. Default weight: 10%.</li>
        <li><strong>Sortino Ratio</strong> — like Sharpe but only penalizes <em>downside</em> deviation,
          ignoring upside volatility which isn't harmful. More meaningful than Sharpe for income investors.
          &gt; 1.0 is good; &gt; 2.0 is excellent. Default weight: 15%.</li>
        <li><strong>Calmar Ratio</strong> — annualized return divided by maximum drawdown. Answers: "how
          efficiently does the fund recover from its worst drop?" &gt; 0.5 is acceptable; &gt; 1.5 is
          excellent. Default weight: 20%.</li>
        <li><strong>Omega Ratio</strong> — probability-weighted ratio of gains above zero to losses below
          zero. Captures the entire return distribution, not just volatility. &gt; 1.2 is decent; &gt; 2.0
          is strong. Default weight: 15%.</li>
        <li><strong>Ulcer Index</strong> — measures the <em>depth and duration</em> of drawdowns, not just
          the maximum. A fund that drops 20% and recovers quickly scores better than one that lingers in a
          10% drawdown for months. Lower is better: &lt; 3 is excellent, &lt; 7 is good, &gt; 12 is
          high-pain. Default weight: 25%.</li>
        <li><strong>Max Drawdown</strong> — the largest peak-to-trough decline in the history window.
          Default weight: 10%. The remaining 5% goes to down-capture ratio when a benchmark is available.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem', color: 'var(--p-9aa7b8)', fontSize: '0.9rem' }}>
        The weighted composite of these sub-scores produces the Risk criterion's 0–100 number. A score of
        80+ earns a PASS badge; 50–79 earns WARN; below 50 earns FAIL. When fewer than ~250 trading
        days (~1 year) of history exist the criterion shows an info badge and is excluded from the
        composite average so new funds are never penalised for being young.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Composite Score &amp; Verdict</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The composite is the simple average of all <em>scored</em> criteria (criteria with a numeric score —
        informational and insufficient-data criteria are excluded). Verdict thresholds: composite ≥ 70 with
        no failing criteria → <strong>Strong Buy</strong>; ≥ 60 with at most one fail → <strong>Weak Buy</strong>;
        otherwise → <strong>Do Not Buy</strong>.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/etf-buying-checklist-evaluator/etf-buy-checklist-bottom.jpg" alt="Non Income ETF Checklist Evaluator bottom — smart alternatives and threshold editor" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Smart Alternatives</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When the evaluated fund scores poorly, a Smart Alternatives section appears listing ETFs in the same
        strategy group that score higher on the composite. Each alternative shows the specific improvements
        (lower expense ratio, better total return, larger fund, etc.).
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Customizing Thresholds</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each scoreable criterion has an inline threshold editor under its card. Adjust Pass/Warn/Fail
        boundaries to match your standards — e.g. tightening the expense ratio to 0.05% for core
        holdings or relaxing the AUM floor for a niche strategy. Thresholds are saved in browser local
        storage and persist between sessions. Use <strong>Reset thresholds to defaults</strong> at the
        top of the page to restore factory settings.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>When to Use It</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li>Use this evaluator for any ETF that is not primarily an option-income or covered-call fund.</li>
        <li>Use the <strong>Option-Income ETF Evaluator</strong> for JEPI, XYLD, QYLD, SPYI, and similar covered-call or put-write ETFs — they have different criteria, especially around NAV erosion and track record.</li>
        <li>Use the <strong>CEF Buying Checklist Evaluator</strong> (CEF's menu) for closed-end funds, which add discount/premium, leverage, and distribution-sustainability dimensions not relevant to ETFs.</li>
      </ul>
    </div>
  )
}

function OptionIncomeETFHelp() {
  return (
    <div>
      <h2>Option-Income ETF Evaluator</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Option-Income ETF Evaluator is built specifically for covered-call, put-write, and other
        option-overlay ETFs — funds like JEPI, XYLD, QYLD, SPYI, QQQI, and the YieldMax single-stock
        option series. Standard ETF metrics (PE ratio, category peer return) tell you little about these
        funds; what matters is whether the high yield is sustainable, whether NAV is eroding, whether the
        strategy justifies the fee, and whether the fund has a long enough track record to evaluate.
        A bundled risk-adjusted-return criterion has been added so you can see the full drawdown and
        volatility picture alongside the income-specific checks.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Two Modes</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>
          <strong>Deep Dive</strong> — Type one option-income ETF ticker for a full scorecard: eight
          criteria cards, a composite score, an overall verdict, and Smart Alternatives drawn from ~150
          curated option-income peers. The underlying strategy (S&amp;P 500, Nasdaq 100, single stock, etc.)
          is auto-detected to filter alternatives appropriately.
        </li>
        <li>
          <strong>Scan a List</strong> — Evaluate your option-income holdings and watchlist entries in one
          pass. Check <em>My holdings</em> and/or <em>My watchlist</em>, paste additional tickers if needed,
          then click <strong>Scan</strong>. The scanner evaluates <strong>option-income ETFs only</strong> —
          plain ETFs, CEFs, and stocks are automatically separated and shown in a "skipped" panel with a
          pointer to the correct evaluator. Results are ranked in a sortable table showing Yield, NAV/yr,
          Expense Ratio, Composite score, a Risk bundle score, and individual ratio columns
          (Sharpe / Sortino / Calmar / Omega / Ulcer).
        </li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/option-income-etf-evaluator/option-income-etf-evaluator-top.jpg" alt="Option-Income ETF Evaluator top — ticker lookup, underlying strategy, and criteria" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>The Eight Criteria</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>
          <strong>1. Strategy Fit</strong> — Confirms the fund is an option-income product and that its strategy
          (covered call vs. put-write vs. collar, index vs. single-stock) aligns with your goals.
          Informational only — not scored.
        </li>
        <li>
          <strong>2. Yield Sustainability</strong> — Compares the distribution yield against the fund's
          long-term total return (5Y → 3Y → annualised full-history CAGR, in that order). A gap under
          ~2 pp is normal for option-income; above 4 pp signals the high yield is partly funded by
          returning your own capital rather than genuine option premium income.
        </li>
        <li>
          <strong>3. Expense Ratio</strong> — Option-income ETFs are inherently costlier than index ETFs
          due to strategy complexity. Under 0.50% is competitive; above 0.75% needs strong justification.
          Thresholds are fully adjustable.
        </li>
        <li>
          <strong>4. Fund Size &amp; Liquidity</strong> — AUM and daily dollar volume. Many option-income ETFs
          launched in 2020–2023 and are still small. Funds under $100M face real closure risk; thin trading
          means worse fills on your orders.
        </li>
        <li>
          <strong>5. Total Return</strong> — Checks whether the fund's long-term total return meets a
          minimum floor (default 7% annualised). A high yield that is not also delivering reasonable total
          return means the income trade-off isn't paying off.
        </li>
        <li>
          <strong>6. NAV Trend</strong> — Compares the annualised share-price (price-only) trend against
          annualised total return. A fund whose share price chronically declines while paying a high yield
          is funding the distribution from your capital (return of capital), not from income. At-the-money
          covered-call funds (e.g. QYLD) cap nearly all upside; out-of-the-money writers (e.g. QQQI, SPYI)
          retain more upside and hold NAV better over full cycles.
        </li>
        <li>
          <strong>7. Track Record</strong> — Fund age and manager pedigree. Funds under 3 years have no
          full market-cycle track record. Funds under 1 year are speculative. Established fund families
          (JPMorgan, Global X, Amplify, NEOS) have deeper resources for complex strategies.
        </li>
        <li>
          <strong>8. Risk-Adjusted Return Profile</strong> — A bundled criterion folding five quantitative
          ratios into one score (see <em>Risk-Adjusted Scoring</em> below). This is computed on the
          <strong> dividend-adjusted total-return series</strong> — not the price-only series — so
          high-distribution funds are not penalised twice for NAV erosion that Criterion 6 already
          captures. Excluded from the composite when fewer than ~250 trading days of data exist.
        </li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Risk-Adjusted Scoring</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Criterion 8 bundles five risk-adjusted return ratios into a single 0–100 score displayed both
        in the criterion card and as a <strong>Risk</strong> column in the Scan a List table. The ratios
        are computed server-side from the fund's full price history, not estimated from recent volatility.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Sharpe Ratio</strong> — excess return per unit of total volatility. &gt; 1.0 is solid;
          &gt; 1.5 is excellent. Weight in composite: 10%.</li>
        <li><strong>Sortino Ratio</strong> — like Sharpe but only penalises <em>downside</em> deviation,
          ignoring upside swings that aren't harmful. More meaningful than Sharpe for income portfolios.
          &gt; 1.0 is good; &gt; 2.0 is excellent. Weight: 15%.</li>
        <li><strong>Calmar Ratio</strong> — annualised return divided by maximum drawdown. Measures
          recovery efficiency: "how much return do you get per point of worst-case loss?" &gt; 0.5 is
          acceptable; &gt; 1.5 is strong. Weight: 20%.</li>
        <li><strong>Omega Ratio</strong> — probability-weighted ratio of all gains above zero to all losses
          below zero. Captures the full return distribution, not just its standard deviation. &gt; 1.2
          is decent; &gt; 2.0 is strong. Weight: 15%.</li>
        <li><strong>Ulcer Index</strong> — measures the <em>depth and duration</em> of drawdowns together,
          not just the single worst drop. A fund that dips 20% and recovers in a month scores far better
          than one that languishes in a 10% drawdown for years. Lower is better: &lt; 3 is excellent,
          &lt; 7 is good, &gt; 12 is high-pain. Weight: 25%.</li>
        <li><strong>Max Drawdown</strong> — peak-to-trough decline over the history window. Weight: 10%.
          The remaining 5% goes to down-capture ratio when a benchmark is available.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem', color: 'var(--p-9aa7b8)', fontSize: '0.9rem' }}>
        Composite thresholds: ≥ 80 → PASS · 50–79 → WARN · &lt; 50 → FAIL. Funds with fewer than ~250
        trading days (~1 year) of history show an info badge and are excluded from the composite so new
        funds are never scored as failures for being young.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Why One Bundled Criterion?</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Sharpe, Sortino, Calmar, Omega, and Ulcer are highly correlated — a fund that scores well on one
        tends to score well on all five. Treating them as five separate criteria would let the risk
        dimension crowd out the income-specific checks (yield sustainability, NAV erosion, track record)
        that are the whole point of this evaluator. One bundled criterion keeps the balance right.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/option-income-etf-evaluator/option-income-etf-evaluator-bottom.jpg" alt="Option-Income ETF Evaluator bottom — verdict, smart alternatives, and threshold editor" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Composite Score &amp; Verdict</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The composite is the simple average of all scored criteria (criteria with a numeric score;
        informational and insufficient-data criteria are excluded). Composite ≥ 70 with no failing
        criteria → <strong>Strong Buy</strong>; ≥ 60 with at most one fail → <strong>Weak Buy</strong>;
        otherwise → <strong>Do Not Buy</strong>.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Underlying Strategy Detection</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The evaluator auto-detects what the fund writes options on — S&amp;P 500, Nasdaq 100, Russell 2000,
        a single stock, gold/commodity, or a fixed-income underlying — and shows this at the top of the
        results. The alternatives section uses this to restrict suggestions to funds tracking the same
        type of underlier.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Smart Alternatives</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When the fund scores below the passing threshold, Smart Alternatives lists option-income peers that
        clear all quality checks and target the same underlying. You can filter by underlying, set a target
        yield or minimum yield floor, and the list is re-ranked automatically. Single-stock option funds
        (e.g. YieldMax) are sorted to the bottom and labelled "higher risk" unless the fund you evaluated
        is itself single-stock.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Customizing Thresholds</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        All seven scoreable criteria have inline threshold editors. Adjust them to match your personal
        tolerance. Settings are saved in browser local storage and persist between sessions. Click
        <strong> Reset thresholds to defaults</strong> at the top of the page to restore factory settings.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>When to Use It</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li>Use this evaluator for any ETF that primarily generates income from selling options (covered calls, puts, collars).</li>
        <li>Use the <strong>Non Income ETF Checklist Evaluator</strong> for standard index, sector, or dividend ETFs without an option-overlay strategy.</li>
        <li>Use the <strong>CEF Buying Checklist Evaluator</strong> (CEF's menu) for closed-end funds, which add discount/premium and leverage dimensions.</li>
      </ul>
    </div>
  )
}

function CEFBuyingChecklistHelp() {
  return (
    <div>
      <h2>CEF Buying Checklist Evaluator</h2>
      <p style={{ marginBottom: '1rem' }}>
        The CEF Buying Checklist Evaluator grades a closed-end fund across eight criteria — including the
        discount/premium to NAV, leverage level, distribution sustainability, liquidity, and a bundled
        risk-adjusted-return criterion that captures how the fund behaves across the full drawdown cycle.
        It fetches live data from CEF Connect, scores each criterion Pass / Warn / Fail, produces a
        composite verdict, and suggests alternatives when the fund falls short.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Two Modes</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>
          <strong>Deep Dive</strong> — Type a CEF ticker for a full scored breakdown. Data is sourced from
          CEF Connect (price, NAV, discount/premium, leverage, distribution rate, NAV return history).
          Eight criteria are scored with Pass / Warn / Fail badges and an expandable "What to check"
          section for each. Alternatives are listed at the bottom, narrowed to the same sector or strategy
          theme when the app can detect one.
        </li>
        <li>
          <strong>Scan a List</strong> — Evaluate multiple CEFs at once from a sortable ranking table.
          Check <em>My holdings</em> and/or <em>My watchlist</em> to pull tickers automatically, or paste
          additional tickers into the text box. Alternatively, enable <em>Entire CEF universe</em> to browse
          the whole market — this is mutually exclusive with holdings/watchlist (those checkboxes are disabled
          while it is on), since it is a browse-the-category operation rather than a check-what-I-own one.
          Because the universe holds several hundred funds (currently ~360), you must narrow it with the
          <strong> CEF category</strong> and/or <strong>CEF strategy</strong> dropdowns that appear. These
          are the same Morningstar groupings used on the Closed CEF Information page (Municipal, Covered Call,
          High Yield, Single Country Equity, and so on). Only the chosen slice is scanned, producing a focused,
          rankable list. The scanner evaluates <strong>CEFs only</strong> — option-income ETFs, plain ETFs,
          and stocks are automatically separated and redirected to their own evaluator. Results show Yield,
          Premium/Discount, Composite score, a Risk bundle score, and individual ratio columns.
        </li>
      </ul>
      <p style={{ marginBottom: '0.75rem', color: 'var(--p-9aa7b8)', fontSize: '0.9rem' }}>
        <strong>CEF detection note:</strong> Yahoo Finance frequently labels closed-end funds as ordinary
        equities. The scanner uses the CEF Connect universe as the authoritative CEF list so funds like
        ADX, BST, and PDI are correctly identified even though Yahoo calls them stocks.
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="./help-screenshots/cef/cef_evaluator.jpg" alt="CEF Buying Checklist Evaluator top — ticker lookup, CEF header data, and criteria" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>The Eight Criteria</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>
          <strong>1. Strategy Fit &amp; Mandate</strong> — Does the fund's stated mandate (bond, equity,
          option-overlay, multi-asset) match your timeline and risk tolerance? Flags yield vs. total
          return mix — a 15% yield funded by return-of-capital is very different from 8% from net
          investment income. Informational only — not scored.
        </li>
        <li>
          <strong>2. Distribution Sustainability</strong> — Compares the distribution rate on NAV against
          the fund's long-term NAV total return (5Y preferred, 3Y fallback). Managed-distribution policies
          that pay out more than the portfolio earns will gradually erode NAV. UNII per share (Undistributed
          Net Investment Income) and earnings-based coverage are factored in when reported. Scores Pass when
          income covers the distribution; Warn or Fail when the gap implies NAV consumption.
        </li>
        <li>
          <strong>3. Discount / Premium to NAV</strong> — The unique CEF characteristic. Current discount vs.
          the 52-week average and 1-year z-score. A discount wider than the fund's own history is more
          attractive; a premium above 5% leaves no margin of safety and means you're paying more than the
          portfolio is worth. Both the threshold and warn band are adjustable.
        </li>
        <li>
          <strong>4. Leverage</strong> — Regulatory leverage is capped at 50% for bond funds and 33% for
          equity funds. Funds near those limits have less cushion in falling markets. The type of leverage
          (preferred shares vs. credit facility vs. reverse repos) behaves differently under stress.
          Scores Pass at moderate leverage, Warn as it approaches limits.
        </li>
        <li>
          <strong>5. Expense Ratio</strong> — Total expense including management fees, administration, and
          the interest cost of leverage. CEF fees are structurally higher than ETFs due to active management
          and leverage. A higher-fee fund must deliver superior NAV return to justify it. Adjustable.
        </li>
        <li>
          <strong>6. Manager Quality / NAV Performance</strong> — NAV total return isolates the manager's
          stock-picking and income generation from discount/premium movement, and compares it to the
          category median over 3Y and 5Y. Sponsor reputation, manager tenure, and distribution discipline
          are qualitative signals factored in here.
        </li>
        <li>
          <strong>7. Liquidity</strong> — A single trade should not exceed ~10–20% of average daily volume,
          otherwise you move the market against yourself. Wider bid-ask spreads in thin funds increase
          implicit transaction costs; limit orders are always recommended for CEFs. Adjustable volume floor.
        </li>
        <li>
          <strong>8. Risk-Adjusted Return Profile</strong> — A bundled criterion folding five quantitative
          risk ratios (Sharpe, Sortino, Calmar, Omega, Ulcer) into one score (see <em>Risk-Adjusted
          Scoring</em> below). Computed from the fund's full dividend-adjusted price history. Excluded from
          the composite when fewer than ~250 trading days (~1 year) of data exist.
        </li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Risk-Adjusted Scoring</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Criterion 8 bundles five risk ratios into a single 0–100 score displayed both in the criterion
        card and as a <strong>Risk</strong> column in the Scan a List table.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Sharpe Ratio</strong> — excess return per unit of total volatility.
          &gt; 1.0 is solid; &gt; 1.5 is excellent. Weight: 10%.</li>
        <li><strong>Sortino Ratio</strong> — like Sharpe but only penalises downside volatility.
          &gt; 1.0 is good; &gt; 2.0 is excellent. Weight: 15%.</li>
        <li><strong>Calmar Ratio</strong> — annualised return ÷ maximum drawdown. Measures recovery
          efficiency. &gt; 0.5 is acceptable; &gt; 1.5 is strong. Weight: 20%.</li>
        <li><strong>Omega Ratio</strong> — probability-weighted ratio of all gains to all losses.
          Captures the full return distribution. &gt; 1.2 is decent; &gt; 2.0 is strong. Weight: 15%.</li>
        <li><strong>Ulcer Index</strong> — depth and <em>duration</em> of drawdowns. A fund that dips
          20% briefly scores better than one lingering in a 10% drawdown for years. Lower is better:
          &lt; 3 excellent, &lt; 7 good, &gt; 12 high-pain. Weight: 25%.</li>
        <li><strong>Max Drawdown</strong> — peak-to-trough decline. Weight: 10%. Down-capture
          ratio gets the remaining 5% when a benchmark is available.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem', color: 'var(--p-9aa7b8)', fontSize: '0.9rem' }}>
        The sub-scores are weighted and averaged to a 0–100 composite. ≥ 80 → PASS · 50–79 → WARN
        · &lt; 50 → FAIL. Funds with fewer than ~250 trading days get an info badge and are excluded
        from the composite — new funds are never scored as failures for being young.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Composite Score &amp; Verdict</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The composite is the simple average of all scored criteria (informational and
        insufficient-data criteria are excluded). Verdict: composite ≥ 70 with no failing
        criteria → <strong>Strong Buy</strong>; ≥ 60 with at most one fail → <strong>Weak
        Buy</strong>; otherwise → <strong>Do Not Buy</strong>.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="./help-screenshots/cef/cef_evaluator_bottom.jpg" alt="CEF Buying Checklist Evaluator bottom — verdict card, alternatives, and threshold editors" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }} />
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Better Alternatives</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The alternatives section compares the current CEF against peers that score higher on the same checklist.
        When the fund name, strategy, or category indicates a recognizable theme — such as infrastructure,
        utilities, energy/MLP/midstream, real estate, municipal bonds, preferreds, senior loans, covered-call
        income, technology, health care, or emerging markets — suggestions are narrowed to that theme first.
        For example, an infrastructure CEF is compared with other infrastructure CEFs instead of every broad
        global-income CEF in the same Morningstar category.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        If the app cannot detect a specific theme, or if too few same-theme peers are available, it falls back
        to the broader CEF category so the alternatives list still has enough funds to compare.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Customizing Thresholds</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Five criteria have inline threshold editors: Distribution Sustainability gap, Discount/Premium
        bounds, Leverage level, Expense Ratio cutoffs, and Liquidity (volume minimums). Thresholds are
        saved in browser local storage and persist between sessions. Click <strong>Reset thresholds
        to defaults</strong> at the top of the page to restore factory settings.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>CEF-Specific Tips</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Always use limit orders</strong> — market orders in thinly traded CEFs can result in significantly worse fills than the displayed price.</li>
        <li><strong>Check Section 19(a) notices</strong> — published monthly by most CEFs, they break down how much of each distribution is income vs. return of capital.</li>
        <li><strong>Watch z-scores over time</strong> — a fund's current discount only becomes a buy signal when it's wider than its own historical average, not just because it's at a discount.</li>
        <li><strong>Scan all your CEFs in one pass</strong> — use Scan a List with "My holdings" to rank every CEF you own by composite score and risk profile. Sorts by any column.</li>
        <li><strong>Explore a whole CEF category</strong> — enable "Entire CEF universe" and pick a category or strategy (e.g. Covered Call or Municipal) to rank that slice of the market head-to-head, even funds you don't yet own. A very large slice is capped at the scan limit, so it shows the first batch.</li>
        <li>Use the <strong>CEFs &amp; Income ETFs: A Guide</strong> page (CEF's menu) for a full educational walkthrough of the CEF structure, discount mechanics, and how CEFs compare to covered-call ETFs.</li>
      </ul>
    </div>
  )
}

function HoldingTargetsHelp() {
  return (
    <div>
      <h2>Holding Targets</h2>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Holding Targets</strong> is the ticker-level planning layer that sits between Categories and the Rebalance Wizard.
        Plan buys and sales for each holding, preview how trades would change your income and allocation, and distribute
        reallocation cash without leaving the page. Changes are what-if only — nothing executes until you act in your broker.
      </p>

      <figure style={{ margin: '0 0 1.5rem' }}>
        <img
          src="./help-screenshots/holding-targets/holding-targets-overview-plan.png"
          alt="Holding Targets overview with a loaded plan, summary cards, Reallocation Cash Pool, and Category and Pillar Breakdown"
          loading="lazy"
          decoding="async"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
        <figcaption style={{ color: 'var(--text-dim)', fontSize: '.78rem', lineHeight: 1.5, marginTop: '.4rem' }}>
          Overview: plan controls and status, scenario totals, the Reallocation Cash Pool, and the Category / Pillar Breakdown.
        </figcaption>
      </figure>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Quick-Set Controls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Set every holding to X% of portfolio</strong> — type a percentage and click <strong>Apply</strong> to bulk-assign that weight to every holding at once. Use this as a starting point, then fine-tune individual rows in the table below.</li>
        <li><strong>Enter amounts as % / $ / Shares</strong> — sets the default unit for every Buy / Sell box and Reinvest allocation. A trade can be entered as a percentage of the whole portfolio, a dollar amount, or a number of shares. You can switch units inside an individual trade box without changing the global default.</li>
        <li><strong>Adjust all categories to a 100% portfolio</strong> — when checked, the adjusted scenario rescales all requested targets proportionally so they sum to exactly 100%, regardless of what you entered. Uncheck to keep your raw requested weights as-is.</li>
        <li><strong>Save adjusted targets</strong> — copies the currently adjusted weights into the saved plan, making the adjusted scenario the plan you see when it is loaded again.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Saved Plan Status</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Plan loaded</strong> — the tables and totals are showing your saved targets and their proposed trades.</li>
        <li><strong>Show current weights</strong> — temporarily returns the page to the live, trade-free portfolio without deleting the saved plan.</li>
        <li><strong>Load plan</strong> — reapplies a saved plan after you have switched back to current weights.</li>
        <li><strong>Discard plan</strong> — permanently removes the saved ticker targets for this portfolio view.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Summary Cards</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Portfolio / # holdings</strong> — active portfolio name and how many holdings are covered by this scenario.</li>
        <li><strong>Requested Total</strong> — sum of all your requested target weights. Shown in amber when over 100%, red when significantly over.</li>
        <li><strong>Adjusted Scenario</strong> — what the targets become after the auto-adjust rescaling (if enabled). "Every requested target × X.XXXX" shows the scaling factor applied.</li>
        <li><strong>Net Trade</strong> — estimated net cash flow if all proposed trades executed. Positive = net buy (requires new cash); zero = cash-neutral rebalance.</li>
        <li><strong>Monthly Income After</strong> — projected monthly income after all proposed trades, with the monthly and annual change vs. today.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Reallocation Cash Pool</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The cash pool lets you plan how to deploy proceeds from proposed sales into holdings you want to grow.
        It activates when a proposed sale generates proceeds and you check <strong>Reinvest</strong> beside a recipient holding in the table below.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Manual Pool Cash Available</strong> — total proceeds available to distribute after covering planned buys.</li>
        <li><strong>Allocation Entered / Cash Remaining</strong> — how much of the pool you've assigned so far and what's left.</li>
        <li><strong>Selected Recipients</strong> — count of holdings marked Reinvest that will receive distributed cash.</li>
        <li><strong>Projected Monthly / Annual Income Gain</strong> — estimated additional income from the planned cash distribution.</li>
        <li><strong>Enter the amount on each row</strong> — once a holding is checked as a recipient, an inline box appears right on that row in the table below. Type the amount you want to send it directly there — in portfolio percent, dollars, or shares depending on the global <strong>Enter amounts as</strong> toggle. A small <em>+$X/mo</em> hint shows the income that allocation would add.</li>
        <li><strong>Auto-fill</strong> — three shortcuts that populate the per-row amounts for you, so you don't have to type each one:
          <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginTop: '0.4rem' }}>
            <li><em>Equal</em> — splits the available pool evenly across all selected recipients.</li>
            <li><em>By Gap</em> — sends more to categories furthest below their target %.</li>
            <li><em>By Yield</em> — weights by distribution yield to maximize added monthly income.</li>
          </ul>
          You can fine-tune any individual row by hand after running an auto-fill.
        </li>
        <li><strong>Apply Allocation</strong> — commits the entered per-row amounts to the requested targets and refreshes the income projections.</li>
        <li><strong>Clear Selections</strong> — removes all Reinvest checkmarks and resets allocations.</li>
        <li><strong>Cash Pool ↑ / ↓</strong> — collapses or expands the cash pool panel.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Category / Pillar Breakdown Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The main table groups all holdings by category (and subcategory). Each category row shows a summary,
        and each holding row provides Buy and Sell controls for planning its target.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Category Plan</strong> — the category's target % from the Categories page.</li>
        <li><strong>Requested</strong> — the sum of all requested ticker weights within that category.</li>
        <li><strong>Coverage</strong> — how the requested sum compares to the Category Plan. Shown in amber/red when significantly over.</li>
        <li><strong>Adjusted</strong> — the ticker weights after the auto-adjust scaling factor is applied.</li>
        <li><strong>Current</strong> — actual current allocation % in the live portfolio.</li>
        <li><strong>Monthly Income Now / After</strong> — current monthly income and projected monthly income after proposed trades.</li>
        <li><strong>Current Value / Target Value / To Target</strong> — dollar value today, dollar value at the target weight, and the difference (red = need to sell, green = need to buy).</li>
        <li><strong>Reinvest checkbox</strong> — marks a holding as a recipient for cash-pool distribution.</li>
        <li><strong>Equal weight / Keep current buttons</strong> (category footer) — shortcuts to split the category plan equally among its holdings, or reset all holdings in the category to their current actual weights.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Per-Holding Tables</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the breakdown, each category (Anchors, Boosters, Growth, etc.) expands into its own table where you review positions and plan trades ticker by ticker.
      </p>

      <figure style={{ margin: '0 0 1.5rem' }}>
        <img
          src="./help-screenshots/holding-targets/holding-targets-category-holdings.png"
          alt="Anchors and Boosters holding tables showing shares held, requested targets, Buy and Sell controls, and projected income"
          loading="lazy"
          decoding="async"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
        <figcaption style={{ color: 'var(--text-dim)', fontSize: '.78rem', lineHeight: 1.5, marginTop: '.4rem' }}>
          Category tables: compare current shares and weights with requested targets, then open Buy or Sell for the holding you want to change.
        </figcaption>
      </figure>

      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Shares Held / Price</strong> — current shares held and the latest price per share.</li>
        <li><strong>Yield</strong> — the holding's projected forward yield (annualized distribution ÷ price). Use it as a quick reference when deciding which holdings to reallocate <em>toward</em> — higher-yield names add more monthly income per dollar moved.</li>
        <li><strong>% of category / Current %</strong> — the holding's share of its category today, and its share of the whole portfolio today.</li>
        <li><strong>Requested Target</strong> — a read-only summary of the planned position shown in portfolio percent, dollars, and total shares. Use the separate Buy / Sell controls to change it.</li>
        <li><strong>Plan Trade</strong> — click <strong>Buy</strong> or <strong>Sell</strong> to open the focused trade box beneath that holding.</li>
        <li><strong>Adjusted %</strong> — the target after the auto-adjust scaling factor is applied.</li>
        <li><strong>Buy / Sell $ &amp; Buy / Sell Shares</strong> — the trade implied by the gap between current and target, shown in both dollars and shares.</li>
        <li><strong>Monthly Income Now / +/-</strong> — current monthly income from the holding and how it would change under the proposed target.</li>
        <li><strong>Reinvest / Alloc</strong> — check to make the holding a cash-pool recipient; an inline amount box then appears for you to type its share of the pool.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Buy / Sell Trade Box</h3>
      <figure style={{ margin: '0 0 1.25rem' }}>
        <img
          src="./help-screenshots/holding-targets/holding-targets-buy-plan-editor.png"
          alt="Loaded Buy trade box for a comparison holding with the planned share amount restored"
          loading="lazy"
          decoding="async"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid var(--p-333)' }}
        />
        <figcaption style={{ color: 'var(--text-dim)', fontSize: '.78rem', lineHeight: 1.5, marginTop: '.4rem' }}>
          A loaded Buy plan: the existing amount is restored, the requested target and projected trade remain visible, and the result can be reviewed before applying changes.
        </figcaption>
      </figure>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Click <strong>Buy</strong> or <strong>Sell</strong> on the holding row. The action can also be changed inside the box.</li>
        <li>Choose <strong>Portfolio %</strong>, <strong>Dollars</strong>, or <strong>Shares</strong>, then enter the amount. Switching units converts the current amount rather than clearing it.</li>
        <li>Review <strong>Planned Buy / Sell</strong> and <strong>Position After Trade</strong>. A sale larger than the position is blocked.</li>
        <li>Click <strong>Apply Buy to Plan</strong> or <strong>Apply Sale to Plan</strong>. Reopening the same planned trade restores its amount and displays <strong>Current plan loaded</strong>.</li>
      </ol>
      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Requested vs. adjusted trade:</strong> when automatic 100% adjustment is enabled, the final adjusted dollar and share trade shown on the row can be proportionally different from the amount entered in the trade box.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Uncategorized Holdings</h3>
      <p style={{ marginBottom: '1rem' }}>
        Any holding that hasn't been assigned to a category on the <strong>Categories</strong> page appears in an
        <strong> Uncategorized</strong> group at the bottom. You can still set targets and use the cash pool for
        uncategorized holdings — assign them to categories later on the Categories page to track them within a pillar.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Workflow Tips</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Use <strong>Set every holding to X%</strong> to seed all weights, then use each row's <strong>Buy</strong> or <strong>Sell</strong> box to refine individual holdings.</li>
        <li>Enable <strong>Adjust all categories to 100%</strong> so the scaled scenario always sums cleanly — watch the Coverage column to see where you're over or under within each category.</li>
        <li>When a category is over its plan, use the <strong>Equal weight</strong> shortcut in that category's header to redistribute evenly among its members.</li>
        <li>To redeploy sale proceeds, plan a <strong>Sell</strong>, then check <strong>Reinvest</strong> on destination holdings and either type each allocation inline or use an <strong>Auto-fill</strong> shortcut (Equal, By Gap, By Yield) before clicking <strong>Apply Allocation</strong>.</li>
        <li>Click <strong>Save adjusted targets</strong> when you want the proportionally adjusted scenario to replace the requested values in your saved plan.</li>
      </ol>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
        <strong>No trades execute here.</strong> Holding Targets is a planning and preview tool. To generate actual broker trade instructions, use the <strong>Rebalance Wizard</strong> (button in the top-right corner or the Analysis → Planning menu).
      </div>
    </div>
  )
}

function RealizedGainRepairHelp() {
  return (
    <div>
      <h2>Realized Gain Repair &amp; Missing Cost Basis</h2>
      <p style={{ marginBottom: '1rem' }}>
        This is a one-time cleanup for portfolios imported before the cost-basis fix, plus an
        ongoing way to supply cost information the app cannot work out on its own. It corrects
        the realized gain or loss recorded against past <strong>sales</strong>. It does not
        change what you own, what you paid for what you still hold, or any price.
      </p>

      <div className="alert alert-warning" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>Expect your reported realized gains to go down.</strong> The old figures were
        too high. Some sales come back with a smaller, correct gain; others end up with no gain
        at all, because the information needed to calculate one does not exist in your data.
        That is the correct result — see <em>Why some sales end up blank</em> below.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>What This Fixes</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A capital gain is the sale proceeds minus what the shares cost you. When the app could
        not establish what shares cost, it used <strong>zero</strong> — which turned the entire
        proceeds of the sale into profit. A position sold for $9,761 reported $9,761 of gain
        even if it lost money.
      </p>
      <p style={{ marginBottom: '0.5rem' }}>Three situations produced that, and all three are corrected:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Shares transferred in from another broker.</strong> A broker's activity export
          records an incoming transfer with no price, which is indistinguishable from shares that
          genuinely cost nothing. These now use the cost carried over with the position.
        </li>
        <li>
          <strong>Sales after a transfer out.</strong> Moving shares to another broker empties
          the record of what remained, so every later sale had nothing to cost against.
        </li>
        <li>
          <strong>Cash sweep and money market funds.</strong> Cash arrives in them by routes the
          activity export never files as a purchase, so the history shows far more shares sold
          than bought. A position where every recorded purchase happened at one price now uses
          that price, which is why a $1.00 sweep fund correctly reports no gain.
        </li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>Do I need to do this?</strong> Open <strong>Action Center</strong>. If a
        <strong> Recalculate realized gains</strong> item appears, sales in your data are still
        reporting their whole proceeds as profit. The item disappears once the recalculation has
        run. You can also check at any time from the Import page — see below.
      </div>

      <HelpScreenshot
        src="./help-screenshots/realized-gain-repair/action-center-item.png"
        alt="Action Center item reading Recalculate realized gains, with the count of affected sales and the tickers involved"
        caption="The Action Center raises the problem without you having to look for it, and the item clears itself once the recalculation has run."
      />

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Step 1 — Run the Recalculation</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Go to <strong>Import</strong> and find the <strong>Realized Gain Repair</strong> panel
        near the bottom of the page, just above Database Backups.
      </p>

      <HelpScreenshot
        src="./help-screenshots/realized-gain-repair/repair-panel.png"
        alt="Realized Gain Repair panel on the Import page with Check for Problems and Recalculate Realized Gains buttons and a findings summary"
        caption="Check for Problems changes nothing — it reports how many sales are affected, the amount involved, and which tickers, so you can see the scale before deciding."
      />
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Check for Problems</strong> — read-only. It reports how many sales are
          reporting their entire proceeds as profit, the dollar amount involved, and which
          tickers. Nothing is changed. If it says nothing looks outstanding, you are done.
        </li>
        <li>
          <strong>Recalculate Realized Gains</strong> — rebuilds the gain or loss on every past
          sale from your transaction history. It asks for confirmation first and takes a
          database backup before it writes anything.
        </li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Afterwards the panel reports what actually changed: how many sales were corrected, how
        much in proceeds that represented, how many now show no gain, and the name of the backup
        it saved. If a backup could not be written, it says so rather than staying silent.
      </p>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>No input is required for this step</strong>, and it is safe to run more than
        once — it recalculates from your existing transactions and produces the same answer every
        time. Shares, prices, holdings, and specific-lot assignments are never touched; only the
        recorded gain on each sale is rewritten.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Why Some Sales End Up Blank</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A sale can only be costed against a purchase. Where a purchase was never imported, no
        cost exists to use, and the app now reports <strong>no gain</strong> rather than
        inventing one. Those sales are excluded from the totals on the Annual Tax Report instead
        of counting the whole proceeds as profit, and the report tells you how many lots and how
        much in proceeds are affected.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        This is common if you have been investing longer than the history your broker lets you
        export. A position can easily show 200 shares sold against 80 shares bought — the other
        120 were bought before the exported window begins. Step 2 is how you fill that in.
      </p>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Step 2 — Supply the Missing Cost (What Input Is Needed)</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        After the recalculation, the Import panel lists every position that still needs
        attention. <strong>Click a ticker there to open it</strong> — most of these positions are
        closed, so they no longer appear on the Holdings table and this link is the way in. You
        can also open any position from <strong>Manage Holdings</strong> using its
        <strong> Txn</strong> button.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        The transaction window shows a panel explaining what that position needs. There are two
        cases, and they need different information from you.
      </p>

      <HelpScreenshot
        src="./help-screenshots/realized-gain-repair/basis-gap-panel.png"
        alt="Cost basis panel in the transaction window showing the affected account, a Set cost button for a transferred-in purchase, and a Record opening lot button for the share shortfall"
        caption="Both cases on one position: a transferred-in purchase that needs a price, and a shortfall of shares with no purchase behind them. The account that owns the gap is named above them."
      />

      <h4 style={{ marginBottom: '0.4rem' }}>Case A — A transferred-in purchase with no price</h4>
      <p style={{ marginBottom: '0.5rem' }}>
        The panel offers a <strong>Set cost</strong> button naming the share count and date.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>What you must supply:</strong> <em>Price Per Share</em> — what those shares originally cost at the delivering broker.</li>
        <li><strong>Where to find it:</strong> your old broker's statement or 1099-B for that position. If your statement gives a total cost, divide it by the share count shown on the button.</li>
        <li><strong>Optional but recommended:</strong> <em>Originally Acquired</em> — the date the shares were first bought. A transfer's date is when they arrived at the new broker, but the holding period for long-term versus short-term carries over from the original purchase. Leave it blank and the transfer date is used.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        Save, and every sale that drew on those shares recalculates immediately.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Case B — More shares sold than were ever bought</h4>
      <p style={{ marginBottom: '0.5rem' }}>
        There is no purchase to correct here, because the purchase was never imported. The panel
        shows the arithmetic — shares bought against shares sold and transferred out — and the
        resulting shortfall. You have two ways to resolve it:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>
          <strong>Import the missing history</strong> (preferred when you can get it). Request a
          longer transaction history from your broker and import it on the Import page. Real
          purchase records give exact per-lot costs.
        </li>
        <li>
          <strong>Record an opening lot</strong> when the history is not available. The
          <strong> Record opening lot</strong> button pre-fills a purchase for the exact shortfall,
          dated the day before your earliest record for that position.
          <br />
          <strong>What you must supply:</strong> <em>Price Per Share</em> — your best estimate of
          the average cost of those shares. Everything else is filled in for you, and the note
          marks the row as an opening lot so you can find it later.
        </li>
      </ul>
      <div className="alert alert-warning" style={{ marginTop: '0.5rem', marginBottom: '1.25rem' }}>
        <strong>An estimated opening lot produces an estimated gain.</strong> It is far closer to
        the truth than treating the shares as free, but do not file taxes from a figure you
        estimated. Use your broker's 1099-B as the authority for tax reporting.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>One Account at a Time</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A position's transactions can span several linked accounts, but a change you make applies
        to <strong>one</strong> account. The panel therefore groups what it finds by account and
        names the owner of each gap.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>If a gap belongs to the account you have selected, the buttons appear and work.</li>
        <li>
          If it belongs to another account, the panel says <em>&ldquo;switch to this account to
          make changes&rdquo;</em> instead of offering a button. Change the account in the
          selector at the top of the screen and reopen the position.
        </li>
      </ul>
      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1.25rem' }}>
        <strong>Why this matters:</strong> an opening lot recorded against the wrong account is
        accepted but has no effect — it joins a different account's records, where the sales you
        are trying to fix never look for it. Following the account label avoids that.
      </div>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Where the Corrected Numbers Appear</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Annual Tax Report</strong> — short- and long-term totals, with unpriced lots flagged and excluded rather than counted as profit.</li>
        <li><strong>Gains &amp; Losses</strong> — the Realized tab.</li>
        <li><strong>Total Return</strong> — the Realized and Combined position views.</li>
        <li><strong>Manage Holdings</strong> — the Realized G/L column on each transaction.</li>
      </ul>

      <h3 style={{ color: 'var(--accent)', marginTop: '1.25rem', marginBottom: '0.5rem' }}>If Something Looks Wrong</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Undo everything:</strong> restore the backup taken before the recalculation, from Database Backups on the Import page.</li>
        <li><strong>A sale still shows no gain:</strong> that position still has a shortfall. Reopen it and check the panel — it names what is missing.</li>
        <li><strong>Nothing changed after recording an opening lot:</strong> it most likely went to the wrong account. Check the account named in the panel.</li>
        <li><strong>A transfer out shows no gain:</strong> that is correct. Moving shares between your own accounts is not a sale and realizes nothing.</li>
        <li><strong>A sale really did have no cost</strong> (a spinoff, or a fully written-off position): leave it. On the Action Center you can mark the item done and it will not return.</li>
      </ul>
    </div>
  )
}

const CONTENT_MAP = {
  overview: Overview,
  'action-center': ActionCenterHelp,
  options: OptionsHelp,
  'option-dashboard': OptionDashboardHelp,
  'option-trades': OptionTradesHelp,
  'general-option-scanner': GeneralOptionScannerHelpEntry,
  'put-selling-scanner': PutSellingScannerHelp,
  'bull-put-spread-scanner': BullPutSpreadScannerHelp,
  'covered-call-scanner': CoveredCallScannerHelp,
  'bear-put-spread-scanner': BearPutSpreadScannerHelp,
  'bear-call-spread-scanner': BearCallSpreadScannerHelp,
  'iron-condor-scanner': IronCondorScannerHelp,
  'unbalanced-put-condor-scanner': UnbalancedPutCondorScannerHelp,
  'unbalanced-butterfly-scanner': UnbalancedButterflyScannerHelp,
  'double-hedge-put-butterfly-scanner': DoubleHedgePutButterflyScannerHelp,
  'road-trip-butterfly-scanner': RoadTripButterflyScannerHelp,
  'sixty-forty-twenty-fly-scanner': SixtyFortyTwentyFlyScannerHelp,
  import: ImportHelp,
  'realized-gain-repair': RealizedGainRepairHelp,
  export: ExportHelp,
  'etf-provider-update': ETFProviderUpdateHelp,
  portfolios: PortfoliosHelp,
  'menu-control': MenuControlHelp,
  'command-palette': CommandPaletteHelp,
  settings: SettingsHelp,
  'tax-report': AnnualTaxReportHelp,
  'tax-loss': TaxLossHarvestHelp,
  'blended-yield': BlendedYieldHelp,
  dashboard: DashboardHelp,
  holdings: HoldingsHelp,
  'reinvestment-impact': ReinvestmentImpactHelp,
  categories: CategoriesHelp,
  'holding-targets': HoldingTargetsHelp,
  growth: GrowthHelp,
  // Growth 2 was folded into Growth as its Dollars tab. Keep the retired id
  // resolving so an existing deep link still lands on the documentation.
  'growth-2': GrowthHelp,
  dividends: DividendsHelp,
  'div-calendar': DivCalendarHelp,
  'earnings-calendar': EarningsCalendarHelp,
  'div-compare': DivCompareHelp,
  'dividend-history': DividendHistoryHelp,
  'dividend-ledger': DividendLedgerHelp,
  'total-return': TotalReturnHelp,
  'gains-losses': GainsLossesHelp,
  'safe-withdrawal': SafeWithdrawalHelp,
  'dividend-calculator': DividendCalculatorHelp,
  'general-scanner': GeneralScannerHelp,
  'security-research': SecurityResearchHelp,
  'etf-screen': ETFScreenHelp,
  'etf-comparer': ETFComparerHelp,
  'stock-comparer': StockComparerHelp,
  'stock-valuation': StockValuationHelp,
  'stock-buying-checklist': StockBuyingChecklistHelp,
  'etf-buying-checklist-evaluator': ETFBuyingChecklistHelp,
  'option-income-etf-evaluator': OptionIncomeETFHelp,
  'cef-buying-checklist-evaluator': CEFBuyingChecklistHelp,
  watchlist: WatchlistHelp,
  'buy-sell': BuySellHelp,
  'nav-erosion': NavErosionHelp,
  'nav-screener': NavScreenerHelp,
  'drip-score': DripScoreHelp,
  'single-strategy': SingleStrategyHelp,
  'income-sim': IncomeSimHelp,
  correlation: CorrelationHelp,
  diversification: DiversificationHelp,
  'fund-definitions': FundDefinitionsHelp,
  analytics: AnalyticsHelp,
  'portfolio-builder': PortfolioBuilderHelp,
  'portfolio-tester': PortfolioTesterHelp,
  'cash-flow': CashFlowHelp,
  'dist-compare': DistCompareHelp,
  consolidation: ConsolidationHelp,
  'macro-dashboard': MacroDashboardHelp,
  'income-growth': IncomeGrowthHelp,
  'growth-income-freedom': GrowthIncomeFreedomHelp,
  'retirement-readiness': RetirementReadinessHelp,
  'rebalance-wizard': RebalanceWizardHelp,
}

export default function Help() {
  const [activeGroup, setActiveGroup] = useState('overview')
  const [activeSection, setActiveSection] = useState('overview')

  const firstContentSection = (group) => group.sections.find(section => section.type !== 'heading')

  const handleGroupClick = (group) => {
    setActiveGroup(group.id)
    setActiveSection(firstContentSection(group)?.id)
  }

  const currentGroup = GROUPS.find(g => g.id === activeGroup)
  const ContentComponent = CONTENT_MAP[activeSection] || null

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1>Help</h1>
        <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>Version {APP_VERSION}</span>
      </div>

      {/* Group selector */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.75rem' }}>
        {GROUPS.map(g => (
          <button
            key={g.id}
            onClick={() => handleGroupClick(g)}
            style={{
              padding: '0.45rem 1.1rem',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem',
              background: activeGroup === g.id ? 'var(--primary)' : 'var(--border)',
              color: activeGroup === g.id ? 'var(--white)' : 'var(--text-dim-2)',
              transition: 'background 0.15s',
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Sub-tabs (hidden when group has only one section) */}
      {currentGroup && currentGroup.sections.length > 1 && (
        <div className="tabs help-tabs" style={{ marginBottom: '1.5rem' }}>
          {currentGroup.sections.map((s, index) => (
            s.type === 'heading' ? (
              <div key={`${s.label}-${index}`} className="tab-heading">{s.label}</div>
            ) : (
              <button
                key={s.id}
                className={`tab ${activeSection === s.id ? 'active' : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                {s.label}
              </button>
            )
          ))}
        </div>
      )}

      <div className="card" style={{ lineHeight: '1.7' }}>
        {ContentComponent && <ContentComponent />}
      </div>
    </div>
  )
}
