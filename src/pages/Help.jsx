import React, { useState } from 'react'

const APP_VERSION = '1.28.0'

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
    id: 'admin',
    label: 'Admin',
    sections: [
      { id: 'import', label: 'Import' },
      { id: 'export', label: 'Export' },
      { id: 'etf-provider-update', label: 'ETF Provider Update' },
      { id: 'portfolios', label: 'Portfolios' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    sections: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'holdings', label: 'Holdings' },
      { id: 'categories', label: 'Categories' },
      { id: 'growth', label: 'Growth' },
      { id: 'growth-2', label: 'Portfolio Growth 2' },
      { id: 'dividends', label: 'Dividends' },
      { id: 'div-calendar', label: 'Div Calendar' },
      { id: 'earnings-calendar', label: 'Earnings Calendar' },
      { id: 'div-compare', label: 'Div Compare' },
      { id: 'dividend-history', label: 'Dividend History' },
      { id: 'total-return', label: 'Total Return' },
      { id: 'gains-losses', label: 'Gains & Losses' },
      { id: 'safe-withdrawal', label: 'Safe Withdrawal' },
      { id: 'dividend-calculator', label: 'Dividend Calculator' },
    ],
  },
  {
    id: 'analysis',
    label: 'Analysis',
    sections: [
      { id: 'general-scanner', label: 'General Scanner' },
      { id: 'security-research', label: 'Security Research' },
      { id: 'etf-screen', label: 'ETF/Stock Screen' },
      { id: 'etf-comparer', label: 'ETF Comparer' },
      { id: 'stock-comparer', label: 'Stock Comparer' },
      { id: 'watchlist', label: 'Watchlist' },
      { id: 'buy-sell', label: 'Buy/Sell Signals' },
      { id: 'nav-erosion', label: 'NAV Erosion' },
      { id: 'nav-screener', label: 'NAV Screener' },
      { id: 'single-strategy', label: 'Single Strategy' },
      { id: 'income-sim', label: 'Income Sim' },
      { id: 'correlation', label: 'Correlation' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'portfolio-builder', label: 'Portfolio Builder' },
      { id: 'portfolio-tester', label: 'Portfolio Tester' },
      { id: 'dist-compare', label: 'Dist Compare' },
      { id: 'consolidation', label: 'Consolidation' },
      { id: 'macro-dashboard', label: 'Macro Dashboard' },
      { id: 'income-growth', label: 'Income Growth' },
      { id: 'retirement-readiness', label: 'Retirement Readiness' },
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
        <li><strong>Import</strong> — Bulk-load brokerage positions and transaction history from your own spreadsheet, a generic template, brokerage exports, or the app's own combined holdings + transactions workbook. Supports Schwab (Positions &amp; Transactions), E*TRADE (Positions, Buys &amp; Sells, Dividends), Fidelity (Positions &amp; Transactions), Robinhood (Positions PDF &amp; Transactions), Snowball (Holdings Migration &amp; Transactions), and Portfolio Export (Holdings + Transactions). Automatic database backups before every import and dividend repair with one-click restore.</li>
        <li><strong>Holdings</strong> — Add, edit, and delete positions manually or through transaction lots (BUY/SELL). Tracks cost basis, gain/loss, dividend yields, DRIP reinvestment, and more.</li>
        <li><strong>Dashboard</strong> — At-a-glance summary of portfolio value, income, and allocation. Includes an Action Center preview panel showing the top follow-up items.</li>
        <li><strong>Action Center</strong> — Automatically generated follow-up items drawn from your portfolio data, categorized by priority (Needs Review, Watch, Clear) and kind (Allocation, Dividend, Income, Rebalance, Tax, etc.).</li>
        <li><strong>Dividends</strong> — Dividend analysis, calendar view, dividend history, dividend compare, and dividend calculator.</li>
        <li><strong>Growth</strong> — Portfolio growth charts, total return tracking, gains &amp; losses breakdown, and safe withdrawal rate analysis.</li>
        <li><strong>Watchlist</strong> — Track tickers outside your portfolio with live price and dividend data.</li>
        <li><strong>Analysis</strong> — Stock and ETF Analysis, ETF Comparer, Stock Comparer, Security Research, General Scanner, Single Strategy Scanner, Buy/Sell Signals, NAV Erosion analysis, NAV Erosion Screener, Income Simulator, Income Growth, Correlation Matrix, Portfolio Analytics, Portfolio Builder, Portfolio Tester, Distribution Compare, Consolidation Analysis, Macro Regime Dashboard, and Rebalance Wizard.</li>
        <li><strong>Taxes</strong> — Annual Tax Report with realized gains/losses and dividend income summaries.</li>
        <li><strong>Multi-Portfolio</strong> — Create multiple portfolios and view them individually or as an aggregate.</li>
        <li><strong>Market Data</strong> — Prices, dividends, and ex-div dates refresh automatically from Yahoo Finance.</li>
      </ul>
    </div>
  )
}

function ImportHelp() {
  return (
    <div>
      <h2>Import Brokerage Positions, Transactions, and Snowball Data</h2>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Import Brokerage Positions and Snowball Data</strong> page lets you bulk-load holdings into a portfolio from an Excel or CSV file.
        There are two main import modes, each on its own tab: <strong>My Spreadsheet</strong> (owner format) and <strong>Generic Upload</strong>.
        Both support merge mode — if the portfolio already has data, existing tickers are updated and new tickers are added,
        while app-only fields (like DRIP toggles or pay dates you edited manually) are preserved unless the spreadsheet provides them.
      </p>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>Brokerage templates:</strong> The Generic Upload area also includes downloadable brokerage-position templates.
        Use the matching template if you want to paste or export positions from a broker first, then import them into the app.
        The app currently provides templates for <strong>E*TRADE</strong>, <strong>Charles Schwab</strong>, <strong>Fidelity</strong>, and <strong>Robinhood</strong>, plus a generic template and Snowball holdings migration template.
      </div>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>App export import:</strong> The <strong>Import Brokerage Positions and Snowball Data</strong> tab also includes
        <strong> Portfolio Export (Holdings + Transactions)</strong>. Use it to round-trip a workbook exported from the app's Export page;
        the preview shows both the holdings sheets and the Transactions sheet before import.
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Brokerage Position Templates</h3>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/import/Screenshot 2026-05-10 144007.jpg" alt="Import Brokerage Positions and Snowball Data tab showing format selector and drop zone" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>E*TRADE template</strong> — use this when you want a worksheet laid out for E*TRADE position data before importing.</li>
        <li><strong>Charles Schwab (Positions) template</strong> — use this when preparing Schwab position exports or copy/paste data for import.</li>
        <li><strong>Fidelity (Positions) template</strong> — use this when preparing a Fidelity positions workbook with the exact columns the importer reads.</li>
        <li><strong>Robinhood Holdings reference</strong> — a CSV showing the fields read from the Robinhood Holdings PDF. The actual import still expects the PDF export.</li>
        <li><strong>Robinhood Transactions template</strong> — a CSV with the exact activity columns this importer reads for buys, sells, dividends, capital gains, and ACAT share transfers.</li>
        <li><strong>Snowball Holdings template</strong> — use this for a migration-style holdings snapshot when moving from Snowball into the app.</li>
        <li><strong>Generic template</strong> — use this when your source does not match a brokerage template and you want the broadest flexible import format.</li>
      </ul>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem', marginTop: '0.5rem' }}>
        <div style={{ flex: '1 1 30%', minWidth: '200px' }}>
          <img src="/help-screenshots/import/Screenshot 2026-05-10 144111.jpg" alt="Charles Schwab Positions format selector" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
        </div>
        <div style={{ flex: '1 1 30%', minWidth: '200px' }}>
          <img src="/help-screenshots/import/Screenshot 2026-05-10 144201.jpg" alt="E*TRADE Positions format selector" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
        </div>
        <div style={{ flex: '1 1 30%', minWidth: '200px' }}>
          <img src="/help-screenshots/import/Screenshot 2026-05-10 144335.jpg" alt="Fidelity Positions format selector" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
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

      <h4 style={{ marginBottom: '0.4rem' }}>Snowball Holdings (Migration)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Use this when migrating from Snowball and you want to bring over a holdings snapshot, dividend metadata, and categories.</li>
        <li>It keeps only the fields the app already supports and discards Snowball-only analytics columns.</li>
        <li>For the most accurate broker-current holdings, use a broker Positions import instead of treating Snowball as the final source of truth.</li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <strong>Recommended workflow:</strong>
        <ol style={{ paddingLeft: '1.5rem', marginTop: '0.5rem', marginBottom: 0 }}>
          <li>Import a <strong>Positions</strong> file first (Schwab, E*TRADE, Fidelity, or Robinhood) to set accurate current holdings, share counts, and cost basis.</li>
          <li>Then import <strong>Transaction History</strong> (Schwab Transactions, E*TRADE Buys &amp; Sells / Dividends, Fidelity Transactions, Robinhood Transactions, or Snowball Transactions) for dividend tracking and realized gain records.</li>
          <li>Run <strong>Refresh Prices &amp; Divs</strong> to update market data, dividend fields, and pay-date estimates.</li>
        </ol>
        When a Positions import has been done first, transaction imports store history without overwriting your holdings data.
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Reimporting Old or Partial Files</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Transaction-history files are incremental.</strong> Reimporting an older transaction file skips duplicate BUY/SELL rows that already exist for the same ticker, date, shares, and price. New rows in a later export are added.</li>
        <li><strong>Dividend payments are deduped by ticker, account, and payment date.</strong> If the app previously created a refresh estimate for that date, an imported broker dividend replaces the estimate; otherwise the duplicate payment is skipped.</li>
        <li><strong>Broker Positions and Snowball Holdings imports are current snapshots.</strong> Existing tickers are updated, new tickers are inserted, and holdings missing from the imported snapshot can be removed as stale.</li>
        <li><strong>Do not use a partial Positions file to add only new holdings.</strong> Because positions imports represent the full current account, a partial file can remove holdings that are not listed in the file. Use a complete current positions export, or use Generic Upload when you want an additive/update-style holdings merge.</li>
        <li><strong>Reimporting an old Positions file can roll holdings back.</strong> It will update share counts, cost basis, values, and stale holdings to match that older file. Restore from the automatic backup if the snapshot was not the one you meant to apply.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Transaction History Imports</h3>
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

      <h4 style={{ marginBottom: '0.4rem' }}>Charles Schwab (Transactions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Schwab, go to <strong>Accounts &gt; History</strong>, set the date range, then export to CSV.</li>
        <li>Set the format selector to <strong>Charles Schwab (Transactions)</strong>.</li>
        <li>Imports: BUY, SELL, DRIP reinvestment shares, cash dividends, reinvested dividends, capital gain distributions, return of capital, and dividend adjustments.</li>
        <li>If a refresh-estimated dividend already exists for the same ticker, account, and date, the imported broker dividend replaces that estimate so Dividend History keeps the actual payment amount.</li>
        <li>DRIP reinvestments are tagged as <code>[DRIP]</code> buys.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/import/Screenshot 2026-05-10 144133.jpg" alt="Partial history warning and Charles Schwab Transactions format" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>E*TRADE (Buys &amp; Sells)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In E*TRADE, go to <strong>Accounts &gt; Transaction History</strong>, filter to "Buys &amp; Sells", then download the XLSX.</li>
        <li>Set the format selector to <strong>E*TRADE (Buys &amp; Sells)</strong>.</li>
        <li>Imports: BUY and SELL transactions with date, shares, price, and commission.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/import/Screenshot 2026-05-10 144254.jpg" alt="E*TRADE Buys and Sells format selector" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>E*TRADE (Dividends)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In E*TRADE, go to <strong>Accounts &gt; Transaction History</strong>, filter to "Dividends", then download the XLSX.</li>
        <li>Set the format selector to <strong>E*TRADE (Dividends)</strong>.</li>
        <li>Imports: cash dividend payments and DRIP reinvestment buys. Positive amounts are recorded as dividends; negative amounts with shares are recorded as <code>[DRIP]</code> buys.</li>
        <li>If a refresh-estimated dividend already exists for the same ticker, account, and date, the imported broker dividend replaces that estimate so Dividend History keeps the actual payment amount.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/import/Screenshot 2026-05-10 144224.jpg" alt="E*TRADE Dividends format selector" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Fidelity (Transactions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Fidelity, export the <strong>Transactions XLSX</strong> workbook for a single account.</li>
        <li>Set the format selector to <strong>Fidelity (Transactions)</strong>.</li>
        <li>Imports: BUY, SELL, cash dividend receipts, and DRIP reinvestment rows.</li>
        <li>If a refresh-estimated dividend already exists for the same ticker, account, and date, the imported broker dividend replaces that estimate so Dividend History keeps the actual payment amount.</li>
        <li>If the portfolio already has holdings from a positions import, the transaction import preserves those holdings and stores the Fidelity history for recordkeeping.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/import/Screenshot 2026-05-10 144401.jpg" alt="Fidelity Transactions format selector and drop zone" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Robinhood (Positions PDF)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Robinhood, download your <strong>Holdings PDF</strong> from the app or website.</li>
        <li>Set the format selector to <strong>Robinhood (Positions PDF)</strong>.</li>
        <li>Imports: current positions with ticker, shares, and current value.</li>
        <li><strong>Note:</strong> Robinhood does not include cost basis in the Holdings PDF, so the current value is used as the initial cost basis. Update cost basis manually on the Holdings page or import Robinhood Transactions to build lot-level cost basis.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/import/Screenshot 2026-05-10 144418.jpg" alt="Robinhood Positions PDF format selector and drop zone" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Robinhood (Transactions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>In Robinhood, export your <strong>Activity CSV</strong>.</li>
        <li>Set the format selector to <strong>Robinhood (Transactions)</strong>.</li>
        <li>Imports: BUY, SELL, cash dividends, manufactured dividends, capital gain distributions, and ACAT share transfers.</li>
        <li>If a refresh-estimated dividend already exists for the same ticker, account, and date, the imported broker dividend replaces that estimate so Dividend History keeps the actual payment amount.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/import/Screenshot 2026-05-10 144437.jpg" alt="Robinhood Transactions format selector and drop zone" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Snowball Transactions</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Set the format selector to <strong>Snowball Transactions</strong>.</li>
        <li>Upload a <strong>single-account CSV export</strong>. Combined or merged exports are rejected.</li>
        <li>Imports: BUY, SELL, and DIVIDEND transactions. Stock splits are applied to pre-split lots automatically.</li>
        <li>Snowball exports may not exactly match the broker's live positions — use Positions imports for accurate current holdings.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Portfolio Export (Holdings + Transactions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Use the workbook exported from the <strong>Export</strong> page's <strong>Export Holdings with Transactions</strong> option.</li>
        <li>Set the format selector to <strong>Portfolio Export (Holdings + Transactions)</strong>.</li>
        <li>The preview shows the portfolio sheet(s) and the Transactions sheet together so you can confirm both before importing.</li>
        <li>Import restores the holdings sheets and transaction history from the same workbook in one pass.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/import/Screenshot 2026-05-10 144023.jpg" alt="Snowball Transactions format selector with automatic backup notice" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Common Steps (All Transaction Formats)</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2', marginBottom: '1rem' }}>
        <li>Select the correct portfolio from the navbar dropdown.</li>
        <li>Open the <strong>Import Brokerage Positions and Snowball Data</strong> tab.</li>
        <li>Choose the format from the dropdown and upload the file.</li>
        <li>Click <strong>Preview</strong> to parse and review the data before committing.</li>
        <li>Click <strong>Import into &lt;Portfolio&gt;</strong> to load the data.</li>
        <li>Duplicate transactions (same ticker, date, shares, price) are automatically skipped on re-import.</li>
      </ol>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Database Backups &amp; Restore</h3>
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
        <img src="/help-screenshots/import/Screenshot 2026-05-10 144051.jpg" alt="Automatic database backup notice shown before each import" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      {/* ── My Spreadsheet ──────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tab 1: My Spreadsheet (Owner Format)</h3>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/import/My_Spreadsheet.jpg" alt="My Spreadsheet tab showing the owner-format import interface" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <p style={{ marginBottom: '0.75rem' }}>
        This mode is designed for the developer's personal dividend-tracking Excel file. It expects a specific column layout
        (the "All Accounts" sheet) and can also import auxiliary sheets for weekly payouts, monthly payouts, and dividend-month data.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Step-by-Step</h4>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Select the correct portfolio</strong> from the navbar dropdown at the top-right. The page shows
          "Importing into: <em>Portfolio Name</em>" to confirm your target.
        </li>
        <li>
          <strong>Click "My Spreadsheet" tab</strong> (selected by default).
        </li>
        <li>
          <strong>Drag & drop your Excel file</strong> (.xlsx or .xlsm) onto the drop zone, or click it to browse.
          The filename appears once selected.
        </li>
        <li>
          <strong>Choose single-sheet or multi-sheet mode:</strong>
          <ul style={{ paddingLeft: '1.5rem', marginTop: '0.25rem' }}>
            <li><strong>Single sheet (default)</strong> — the "Sheet Name" field defaults to "All Accounts". If your Excel file uses a different tab name, you <strong>must</strong> update this field to match the exact tab name in your workbook, otherwise the import will fail with a "sheet not found" error. Only the named sheet is imported into the currently selected portfolio.</li>
            <li><strong>Multi-sheet</strong> — check "Import all sheets as separate portfolios". Each sheet becomes its own portfolio, named after the sheet tab. This ignores the Sheet Name field.</li>
          </ul>
        </li>
        <li>
          <strong>Toggle auxiliary imports</strong> (all on by default):
          <ul style={{ paddingLeft: '1.5rem', marginTop: '0.25rem' }}>
            <li><em>Import Weekly Payouts</em> — reads the "Weekly_Payers" sheet.</li>
            <li><em>Import Monthly Payouts</em> — reads the "Monthly Tracking" sheet.</li>
            <li><em>Import Dividend Months</em> — reads the "DivMonths" sheet.</li>
          </ul>
          Uncheck any you don't need. If a sheet is missing, that step reports an error but the main import still succeeds.
        </li>
        <li>
          <strong>Import as Transactions (optional)</strong> — check "Import rows as transactions" if you want each row
          compared against the current position. The app calculates the share difference and creates a BUY or SELL transaction
          for the delta rather than overwriting the position directly. This is useful for tracking lot-level cost basis.
        </li>
        <li>
          <strong>Click "Import Spreadsheet"</strong> (or "Merge Spreadsheet" if the portfolio already has data).
          A spinner shows while processing. Results appear at the bottom — green for success, red for errors.
        </li>
      </ol>

      <div className="alert alert-info" style={{ marginTop: '1rem', marginBottom: '1.5rem' }}>
        <strong>Merge Mode:</strong> When the portfolio already contains holdings, the button label changes to "Merge Spreadsheet".
        Existing tickers are updated with spreadsheet values. New tickers are added. Fields you've edited only in the app
        (DRIP, pay dates, etc.) are kept unless the spreadsheet also provides those columns.
      </div>

      {/* ── Generic Upload ──────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tab 2: Generic Upload</h3>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/import/Screenshot 2026-05-10 143859.jpg" alt="Generic Upload tab showing portfolio upload and watchlist import sections" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
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
          <strong>Click the "Generic Upload" tab.</strong>
        </li>
        <li>
          <strong>(Optional) Download a template</strong> — click the download button that matches your import type.
          The generic template gives you a pre-formatted .xlsx with all supported column headers, and the brokerage templates
          give you matching columns for supported broker export/paste workflows. Fill in at least the Ticker and Shares columns. Optional columns include:
          Price Paid, Current Price, Dividend, Frequency, Ex-Div Date, Pay Date, DRIP, Category, Purchase Date,
          Dividends Paid, YTD Divs, Total Divs Received, and more.
          <div style={{ marginBottom: '0.75rem', marginTop: '0.75rem' }}>
            <img src="/help-screenshots/import/Screenshot 2026-05-10 143932.jpg" alt="Upload Your Portfolio section with Download Template button" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
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
      <p style={{ marginBottom: '0.5rem', color: '#90a4ae', fontSize: '0.9rem' }}>
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
                <td style={{ padding: '0.4rem 0.75rem', color: req === 'Yes' ? '#81c784' : '#90a4ae' }}>{req}</td>
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
        <img src="/help-screenshots/import/Screenshot 2026-05-10 143951.jpg" alt="Generic Upload merge mode notice and Merge Portfolio button" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Cards</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Priority Filters</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Use the filter buttons to focus the list:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>All</strong> — shows every item regardless of priority.</li>
        <li><strong>Needs Review</strong> — shows only warning-priority items that need action.</li>
        <li><strong>Watch</strong> — shows info-priority items to monitor.</li>
        <li><strong>Clear</strong> — shows success-priority items that are in good shape.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Action Items</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each item card shows:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Kind</strong> — the category of the item: Allocation, Data, Dividend, Income, Portfolio, Rebalance, or Tax.</li>
        <li><strong>Priority badge</strong> — Needs Review (warning), Watch (info), or Clear (success).</li>
        <li><strong>Title &amp; Detail</strong> — a plain-English description of the issue or observation.</li>
        <li><strong>Open button</strong> — navigates directly to the relevant page in the app so you can act on the item.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Dashboard Preview</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Dashboard shows a compact preview of up to four Action Center items at the top of the page.
        Each preview card links directly to the relevant page. Click <strong>Open Action Center</strong> to
        see the full list with filters and details.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>When Action Items Are Generated</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Items are computed from the data already in the app — holdings, dividend history, category weights,
        and income estimates. They are recalculated each time you open the Action Center or Dashboard.
        No manual refresh is needed; click <strong>Refresh Data</strong> (links to Holdings) if you want
        to ensure market data is current before reviewing items.
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

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/dashboard/dashboard-page.jpg" alt="Dashboard showing Action Center preview, summary cards strip, Portfolio Value Over Time chart, Grade Thresholds guide, and Upcoming Dividends this week" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>
      <p style={{ marginBottom: '0.75rem', color: '#90a4ae', fontSize: '0.9rem' }}>
        The screenshot above shows (top to bottom): the <strong>Action Center</strong> preview panel with follow-up items;
        the <strong>summary cards strip</strong> covering portfolio grade, risk ratios, income totals, NAV erosion, and returns;
        the <strong>Portfolio Value Over Time</strong> equity-curve chart with the Record NAV button;
        the collapsible <strong>Grade Thresholds Guide</strong>; and the <strong>Upcoming Dividends This Week</strong>
        section. The full holdings table continues below.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Cards</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The top section displays key metrics as cards:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Portfolio Grade</strong> — composite grade based on yield, growth, and risk metrics.</li>
        <li><strong>Ulcer / Calmar / Omega / Sortino / Sharpe</strong> — risk-adjusted performance ratios.</li>
        <li><strong>YTD Dividends</strong> — total dividends received year-to-date.</li>
        <li><strong>Current Month Income</strong> — dividends received (or estimated) for the current calendar month.</li>
        <li><strong>Est. Monthly Income</strong> — estimated monthly dividend income across all holdings.</li>
        <li><strong>Mo$ Reinvested</strong> — portion of monthly income being reinvested via DRIP (shown in blue).</li>
        <li><strong>Mo$ Not Reinvested</strong> — portion of monthly income taken as cash (shown in amber).</li>
        <li><strong>Est. Annual Income</strong> — estimated annual dividend income.</li>
        <li><strong>Portfolio Value</strong> — total current market value.</li>
        <li><strong>Avg Yield on Cost / Current Yield</strong> — dividend yield based on cost basis vs current price.</li>
        <li><strong>Price Return / Total Return</strong> — portfolio returns excluding and including dividends.</li>
        <li><strong>NAV Erosion Ratio</strong> — dollar-weighted benchmark-adjusted NAV erosion context for income-oriented funds. The portfolio severity follows the aggregate ratio thresholds: low at 0.25 or below, moderate from 0.25-0.75, and high above 0.75.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>DRIP$ and Cash$ Columns</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Holdings Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The main table lists all holdings with sortable columns. Click any column header to sort.
        Key columns include:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Ticker</strong> — click to open a detailed ticker modal with charts and dividend history.</li>
        <li><strong>Freq</strong> — dividend payment frequency (W=Weekly, M=Monthly, Q=Quarterly, SA=Semi-Annual, A=Annual).</li>
        <li><strong>%Acct</strong> — percentage of total portfolio value.</li>
        <li><strong>G/L%</strong> — unrealized gain/loss percentage.</li>
        <li><strong>PrRtn / TotRtn</strong> — price-only return and total return (including dividends).</li>
        <li><strong>YTD</strong> — year-to-date dividends received.</li>
        <li><strong>Mo$ / Yr$</strong> — estimated monthly and annual dividend income.</li>
        <li><strong>MoShr</strong> — estimated fractional shares acquired per month if the monthly dividend is fully reinvested at the current price (DRIP simulation).</li>
        <li><strong>DRIP$</strong> — monthly income being reinvested (blue). Only present for shares in DRIP-enabled accounts.</li>
        <li><strong>YrShr</strong> — estimated fractional shares acquired per year if the annual dividend is fully reinvested at the current price.</li>
        <li><strong>PFI%</strong> — "Paid For Itself" — percentage of original cost recovered through dividends.</li>
        <li><strong>RvY</strong> — Return vs. Yield. Compares each holding's all-time total return to its dividend yield. <strong>Good</strong> (green) means total return exceeds yield; <strong>Poor</strong> (red) means yield exceeds total return, suggesting price decline is eroding dividend income. A toggle in the column header switches between <strong>CYld</strong> (current yield, the default) and <strong>YOC</strong> (yield on cost).</li>
        <li><strong>NAV</strong> — benchmark-adjusted NAV erosion ratio plus controls for whether the holding should be tested and what benchmark it should use.</li>
        <li><strong>Grd</strong> — composite grade for the holding.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Return vs. Yield (RvY)</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>NAV Testing Controls</h3>
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
        These controls affect the Dashboard's per-holding NAV value and portfolio-level NAV Erosion Ratio.
        The standalone NAV Erosion backtest and NAV Erosion Screener still use their own ticker inputs and
        automatic benchmark rules.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Value Over Time</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the summary cards, an equity curve chart tracks your portfolio's total market value over time.
        Each data point is a NAV (Net Asset Value) snapshot — the sum of <code>shares × current price</code>
        across all holdings on that date. Once you have two or more snapshots, the chart draws a line; a single
        snapshot appears as a dot.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9', marginBottom: '1rem' }}>
        <li><strong>Record NAV button</strong> — click at any time to save today's portfolio value using the prices already refreshed on page load. No import required. The button records a snapshot for the active portfolio and, if it is a sub-portfolio, also records one for Owner automatically.</li>
        <li><strong>Import trigger</strong> — any holdings import (Owner spreadsheet, generic upload, broker positions, or broker transactions) automatically records a snapshot for the imported portfolio and Owner.</li>
        <li><strong>One snapshot per day</strong> — clicking the button or importing multiple times on the same day simply updates that day's value rather than creating duplicates.</li>
        <li><strong>Accuracy</strong> — snapshots from the button and from imports use identical logic. Both reflect the prices currently stored in the database, which are refreshed from yfinance on each page load or import.</li>
      </ul>
      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>How often should I snapshot?</strong> Monthly snapshots give a smooth long-term trend.
        Weekly or daily snapshots reveal drawdowns and recovery patterns. The <strong>Record NAV</strong> button
        makes it easy to capture a value on any day without running a full import.
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Action Center Preview</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Near the top of the Dashboard, an <strong>Action Center</strong> card shows up to four follow-up items
        generated automatically from your portfolio data. Items are grouped by priority: amber for "Needs Review",
        blue for "Watch", and green for "Clear". Each card links directly to the relevant page. Click
        <strong> Open Action Center</strong> to see the full list with priority filters and details.
        The preview is hidden when the portfolio has no action items.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Upcoming Dividends</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the summary cards, a card shows dividends expected this week based on ex-dividend dates,
        with estimated payout amounts per holding. Pay dates prefixed with <strong>~</strong> are estimated;
        pay dates without the tilde are confirmed (sourced from the holding's stored pay date data).
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
        <img src="/help-screenshots/holdings/holdings-page.jpg" alt="Holdings page full view showing table and controls" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Detailed Views and Features</h3>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/holdings/complete-holdings-table.jpg" alt="Holdings table overview" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      {/* ── Table Overview ──────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Table Overview</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Sorting</strong> — Click any column header to sort ascending/descending. An arrow indicates the active sort.</li>
        <li><strong>Frozen columns</strong> — Ticker, Description, Category, and Shares stay visible as you scroll horizontally.</li>
        <li><strong>DRIP checkbox</strong> — Toggle dividend reinvestment directly in the table without opening the edit form. When enabled, all future dividends are automatically reinvested as new shares at the ex-dividend date using historical prices. The Holdings page and Historical Dividend History page will automatically calculate the reinvested shares and show the DRIP status.</li>
        <li><strong>Expand transactions</strong> — Click the small arrow (&#9654;) next to a ticker to expand and see its transaction lots inline. This section reflects transactions recorded for that ticker only.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/holdings/drip-setting.jpg" alt="DRIP setting in Holdings table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
        <p style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '0.5rem' }}>The DRIP checkbox appears in the Holdings table and can be toggled directly without opening the edit form. When enabled, dividends are automatically reinvested into additional shares using historical prices from the payment date.</p>
      </div>

      {/* ── Toolbar Buttons ─────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Toolbar Buttons</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Refresh Prices &amp; Divs</strong> - Fetches the latest prices, dividend amounts, ex-div dates, pay dates, and dividend frequency from Yahoo Finance for the currently selected Holdings scope. Individual accounts refresh only themselves; Owner refreshes its included source accounts; Aggregate refreshes its configured member accounts.</li>
        <li><strong>Latest Refresh Result</strong> - After Refresh Prices &amp; Divs finishes, a temporary result section appears near the top of the Holdings screen. Each account card shows:
          <ul style={{ paddingLeft: '1.25rem', lineHeight: '1.7', marginTop: '0.25rem' }}>
            <li><strong>Month-to-date payable distributions</strong> — total estimated cash from holdings with expected pay dates from the first day of the refresh month through the refresh date.</li>
            <li><strong>Post-refresh accrual estimate</strong> — estimated dividends earned between the previous refresh timestamp and this refresh.</li>
            <li><strong>Holding dividend fields changed</strong> — how many holdings had metadata (dividend/share, ex-date, pay date, frequency, YTD, current-month income) updated.</li>
            <li><strong>Payment history</strong> — how many payment rows were recorded (new), updated (amount changed), or already existed (skipped).</li>
            <li><strong>Distribution ticker chips</strong> — the tickers included in the month-to-date payable total, with their estimated dollar amounts.</li>
          </ul>
        </li>
        <li><strong>DRIP during refresh</strong> - If a holding has DRIP turned on, Refresh Prices &amp; Divs can simulate reinvested dividends from the holding's import/purchase date using Yahoo dividend history and closing prices. When that succeeds, the holding's share count, shares from dividends, cash reinvested, estimated annual income, approximate monthly income, and estimated payment amount can all increase. This updates the Holdings row only; it does not create BUY transactions or rewrite transaction-lot history.</li>
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
        <img src="/help-screenshots/holdings/add-holding.jpg" alt="Add Holding form" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
        <p style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '0.5rem' }}>The Add Holding form allows you to quickly create a new position by entering the ticker, company name, category, number of shares, current price, and dividend information directly. This creates a "direct" position without transaction-lot tracking.</p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/holdings/add-transaction.jpg" alt="Add Transaction form" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
        <p style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '0.5rem' }}>The Add Transaction form records a BUY transaction, establishing cost basis and creating a transaction lot that can later be sold (SELL) for capital gains tracking. This method provides full transaction history and lot-level cost tracking.</p>
      </div>

      {/* ── Maintenance Actions in Detail ───────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Maintenance Actions in Detail</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The four maintenance buttons in the toolbar (<strong>Refresh Prices &amp; Divs</strong>,
        <strong> Preview Div Repair</strong>, <strong>DRIP Matrix</strong>, and
        <strong> Sync DRIP from Accounts</strong>) handle different jobs. Use the right one for the right
        problem — they overlap in places but are <em>not</em> interchangeable.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>Refresh Prices &amp; Divs</h4>
      <p style={{ marginBottom: '0.5rem' }}>
        <strong>What it does.</strong> Calls Yahoo Finance for every ticker currently held in the active
        portfolio scope and updates the holdings table with the latest:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.7', marginBottom: '0.5rem' }}>
        <li><em>Current price</em> — used to recompute Current Value, Gain/Loss, and any yield/coverage metric.</li>
        <li><em>Dividend per share, frequency, ex-div date, pay date</em> — refreshes the forward-looking distribution metadata used by Estimated Annual Income, Approx Monthly Income, and the Dividend Calendar.</li>
        <li><em>DRIP share growth</em> — for holdings with DRIP turned on, refresh uses dividend history and close prices to estimate reinvested shares since the import/purchase date. If new DRIP shares are found, the holding's share count and income estimates are recalculated from the larger share balance. This affects the Holdings row and payment estimates, but does not add transaction-lot records.</li>
        <li><em>Accrued income since last refresh</em> — the gap between the previous refresh timestamp and now is used to estimate dividends earned per holding, surfaced in the Latest Refresh Result and Post-Refresh Accrual Estimate cards.</li>
        <li><em>Estimated payment rows on payable distributions</em> — if a holding's expected pay date falls from the start of the current month through the refresh date, an estimate row is written into Dividend History with source <code>refresh_estimate</code>. A later broker import for the same ticker/account/date overwrites the estimate with the actual payment, so estimates never double-count.</li>
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

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/holdings/refresh-data.jpg" alt="Refresh Prices and Dividends" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
        <p style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '0.5rem' }}>The "Refresh Prices & Divs" button fetches the latest market data from Yahoo Finance for all holdings. The Latest Refresh Result section shows a summary of what was updated: current prices, dividend amounts, DRIP shares, accrued income since the last refresh, and estimated upcoming payment rows added to your dividend history.</p>
      </div>

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>Preview Div Repair</h4>
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

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>DRIP Matrix (Owner only)</h4>
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

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>Sync DRIP from Accounts (Owner only)</h4>
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
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Row Action Buttons</h3>
      <p style={{ marginBottom: '0.5rem' }}>Each row in the table has three action buttons:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Edit</strong> — Opens the Add/Edit form pre-filled with the holding's current data.</li>
        <li><strong>Txn</strong> — Opens the Transaction modal for that ticker, showing existing lots and a form to add more.</li>
        <li><strong>Del</strong> — Deletes the holding (with confirmation dialog). This removes the holding and all its transactions.</li>
      </ul>

      {/* ── Adding a Holding (Direct) ──────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Adding a Holding (Direct — No Transaction)</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Adding a Holding via Transaction</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Editing a Holding</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        There are two ways to open the edit form:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Click the ticker name (blue link) in the table, or</li>
        <li>Click the "Edit" button in the row's Actions column.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        The form opens pre-filled with all current values. The Ticker field is locked (you cannot rename a ticker — delete and re-add instead).
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Without Transactions</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        All fields are editable. Change shares, price paid, dividends, category, or any other field and click "Update".
        Calculated fields (Cost Basis, Gain/Loss, Est. Annual Dividend, Paid For Itself) update automatically.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/holdings/edit-holding-simple.jpg" alt="Edit holding without transactions" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
        <p style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '0.5rem' }}>When editing a "direct" holding (one without transaction lots), all fields are editable. You can update shares, price paid, dividend information, category, and DRIP status directly. Calculated fields like Cost Basis and Gain/Loss update automatically.</p>
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>With Transactions</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        If the ticker has transaction lots, the Position fields (Shares, Price Paid, Purchase Date) are grayed out
        and show a blue info banner: <em>"Shares, Price Paid, and Purchase Date are managed by transactions.
        Use the Txn button to add or edit lots."</em> All other fields (Dividend info, Category, DRIP, tracking fields) remain editable.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/holdings/edit-holding-with-lots.jpg" alt="Edit holding with transactions" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
        <p style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '0.5rem' }}>When editing a holding with transaction lots, the Position fields (Shares, Price Paid, Purchase Date) are locked and grayed out because they are calculated from your transaction history. You can still edit dividend information, category, and DRIP status. Use the "Txn" button to modify the transaction lots themselves.</p>
      </div>

      {/* ── Managing Transactions ──────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Managing Transactions on an Existing Holding</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Deleting a Holding</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Viewing Transaction Lots Inline</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>How the DRIP Flag Works</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Setting DRIP to <strong>Y</strong> on a holding does <em>not</em> automatically add shares in real
        time. Instead, every time you run <strong>Refresh Prices &amp; Divs</strong>, the app runs a
        simulation that estimates how many shares your dividends would have purchased since your last broker
        import. This keeps the share count and income projections accurate between imports without requiring
        you to log every DRIP lot manually.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>What the simulation does</h4>
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

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>Why the simulated count will drift from your broker</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The simulation uses Yahoo Finance dividend history and closing prices — not your broker's actual
        reinvestment records. Brokers sometimes use NAV or a slightly different price for DRIP purchases,
        apply fractional-share rounding differently, or execute reinvestment on a different date.
        Over time these small differences accumulate, and the simulated share count will diverge from what
        your brokerage statement shows.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>Keeping it accurate</h4>
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

      {/* ── Page Layout ──────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Page Layout</h3>
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
          Cards are expandable to show the individual tickers inside.
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
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Allocation Color Coding</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When a category has a target allocation set, the percentage and progress bar are color-coded:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><span style={{ color: '#00e89a', fontWeight: 600 }}>Green</span> — Within 3% of target (on track).</li>
        <li><span style={{ color: '#ffc107', fontWeight: 600 }}>Yellow</span> — 3–8% away from target (slightly off).</li>
        <li><span style={{ color: '#ff6b6b', fontWeight: 600 }}>Red</span> — More than 8% away from target (needs attention).</li>
        <li><span style={{ color: '#7ecfff', fontWeight: 600 }}>Blue</span> — No target set (informational only).</li>
      </ul>

      {/* ── Creating a Category ───────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Creating a Category</h3>
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

      {/* ── Assigning Tickers ─────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Assigning Tickers to a Category</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        There are two ways to assign unallocated tickers to a category:
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/categories/category-cards-unallocated-assets.jpg" alt="Category cards and Unallocated Assets panel" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
        <p style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '0.5rem' }}>
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
          expanded category — no confirmation needed. The category's count, value, and allocation update instantly.
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

      {/* ── Unassigning Tickers ────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Unassigning Tickers</h3>
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

      {/* ── Editing a Category ────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Editing a Category</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Expand the category</strong> by clicking its card header.</li>
        <li>Click the <strong>"Edit"</strong> button in the top-right of the expanded area.</li>
        <li>The modal opens pre-filled with the current name and target allocation.</li>
        <li>Make your changes and click <strong>"Update"</strong>.</li>
      </ol>

      {/* ── Deleting a Category ───────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Deleting a Category</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Target Assistant</h3>
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
        <img src="/help-screenshots/categories/target-assistant-suggestion-table.jpg" alt="Target Assistant suggested target table with Quality scores and dollar moves" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
        <p style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '0.5rem' }}>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Expanded Category Details</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When you expand a category card, you see a table listing each ticker in that category with:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The stock/ETF symbol.</li>
        <li><strong>Description</strong> — The holding's name.</li>
        <li><strong>Value</strong> — Current market value of that position.</li>
        <li><strong>Freq</strong> — Dividend payment frequency. Weekly payers are highlighted in green.</li>
        <li><strong>% of Category</strong> — What percentage of the category's total value this ticker represents.</li>
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

      {/* ── Dashboard Overview ────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Dashboard Overview</h3>
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
        <li>Target allocations don't need to add up to 100% — you might intentionally leave some portfolio value uncategorized.</li>
        <li>The allocation bar at the top gives you a quick visual sense of balance without needing to read individual numbers.</li>
      </ul>
    </div>
  )
}

function GrowthHelp() {
  return (
    <div>
      <h2>Growth & Performance</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Growth page shows how your portfolio has performed over time compared to a benchmark.
        It tracks both <strong>price-only returns</strong> (capital gains) and <strong>total returns</strong>
        (capital gains + dividends), so you can see the full picture of your investment performance.
        The page also grades your portfolio's risk-adjusted returns using industry-standard metrics
        and provides per-ticker breakdowns via bar charts and heatmaps.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/growth/filters-and-metrics.jpg" alt="Growth page filters and metrics strip" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      {/* ── Filters ────────────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filters</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Three filters at the top of the page control what data is displayed. Changing any filter
        triggers a fresh data fetch — all charts and metrics update together.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Categories</strong> — A multi-select dropdown that lets you filter holdings by category.
          By default "All Holdings" is selected, showing the entire portfolio. Check one or more categories
          to see performance for just those groups. The dropdown shows "X selected" when categories are active.
          Click outside the dropdown to close it.
        </li>
        <li>
          <strong>Benchmark</strong> — A text input defaulting to <strong>SPY</strong> (S&P 500 ETF).
          Type any ticker symbol and press Enter or click "Go" to compare your portfolio against that benchmark.
          The benchmark appears as a dotted orange line on the charts and gets its own Sharpe/Sortino scores
          in the metrics strip.
        </li>
        <li>
          <strong>Period</strong> — Three tab buttons: <strong>1Y</strong> (1 year), <strong>5Y</strong> (5 years),
          and <strong>Max</strong> (all available history). This controls the time range for the line charts
          and the data window for the performance metrics.
        </li>
      </ul>

      {/* ── Metrics Strip ──────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Metrics Strip</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A row of summary cards appears below the filters:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Portfolio Grade</strong> — A letter grade (A+ through F) with a numeric score, summarizing
          overall risk-adjusted performance. The grade considers both return and volatility.
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Charts</h3>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/growth/performance-charts.jpg" alt="Growth page performance charts including price-only and total return charts" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

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
        A grouped horizontal bar chart showing each ticker's return over multiple time windows:
        <strong> 1M</strong> (1 month), <strong>3M</strong>, <strong>6M</strong>, <strong>YTD</strong>
        (year-to-date), and <strong>1Y</strong> (1 year). Each window has its own color. This lets you
        quickly spot which holdings are driving performance and which are dragging it down.
        The chart height scales with the number of tickers.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Performance Heatmap</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A color-coded grid with tickers on the Y-axis and time windows on the X-axis. Each cell shows
        the percentage return for that ticker over that period. Colors range from <span style={{ color: '#ff6b6b' }}>red</span> (negative)
        through dark (near zero) to <span style={{ color: '#81c784' }}>green</span> (positive).
        This gives you an at-a-glance view of which holdings have been strong or weak across different
        time horizons. Hover over any cell to see the exact value.
      </p>

      {/* ── How to Use ─────────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Optimization View</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Optimization tab is an income-smoothing planner. It takes the calendar's known or
        estimated pay dates, dividend frequency, dividend amount, share count, and estimated annual
        income, then projects cash flow into the next 12 calendar months. The month-to-month shape
        follows the pay-date schedule, while the 12-month total is reconciled to the same estimated
        annual income used on the Dividends page.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Important:</strong> this screen is about <em>timing</em>. It answers "which months
        look light or heavy?" and "which pay schedules might help?" It does not decide whether a
        ticker is attractive, safe, undervalued, or appropriate to buy.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>Top Cards</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Average monthly income</strong> - the projected 12-month total divided by 12. This should closely match the Dividends page's estimated monthly income, apart from rounding.</li>
        <li><strong>Lowest month</strong> - the month with the lowest projected dividend income in the next 12 months.</li>
        <li><strong>Highest month</strong> - the month with the highest projected dividend income in the next 12 months.</li>
        <li><strong>Total shortfall</strong> - the sum of all below-average months' shortfalls. This is not a required investment amount; it is a way to measure how uneven the calendar is.</li>
      </ul>

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>12-Month Income Smoothing Heatmap</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Month tile</strong> - projected dividend income expected to be paid in that calendar month.</li>
        <li><strong>Green tile</strong> - month is at or above the portfolio's average monthly income.</li>
        <li><strong>Amber tile</strong> - month is below average but not a severe shortfall.</li>
        <li><strong>Red tile</strong> - month is materially below average.</li>
        <li><strong>"Below avg"</strong> - percentage shortfall versus the average monthly income. For example, "10% below avg" means that month is projected to be 10% lighter than the portfolio average month.</li>
      </ul>

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>Shortfall Months Table</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Month</strong> - the calendar month being analyzed.</li>
        <li><strong>Projected</strong> - estimated dividend income expected to be paid in that month.</li>
        <li><strong>Shortfall to avg</strong> - how many dollars that month is below the average monthly income. Yellow numbers mean the month is under target. "On target" means the month is at or above average.</li>
        <li><strong>Top current payers</strong> - current holdings projected to pay in that month, sorted by estimated dollar contribution from highest to lowest.</li>
      </ul>

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>Suggestions</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Suggestions translate the shortfall table into plain language. If January is below average,
        the page may say January needs about a certain dollar amount to match the average month.
        That means January is light compared with your own portfolio average; it does not mean you
        must add that exact amount or buy a specific ticker.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>Schedule-Fit Candidates</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Schedule-Fit Candidates are funds whose known pay dates overlap your current shortfall
        months. This is pay-date fit only, not a buy recommendation. A ticker can rank highly here
        simply because it pays in a month where your current income is light.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> - the candidate symbol. The row may show whether it is already owned, watchlisted, or known from available calendar data.</li>
        <li><strong>Provider</strong> - the fund family or source group, such as NEOs, TAPPALPHA, X Funds, Tuttle funds, Kurv funds, Amplify, Shelton SEPI, YieldMax, or REX Shares.</li>
        <li><strong>Freq</strong> - dividend frequency used for the schedule: weekly, monthly, quarterly, semiannual, or annual.</li>
        <li><strong>Helps</strong> - shortfall months where that ticker has a known pay schedule. The smaller basis line shows which helped month is used for the share-count math and that month's shortfall.</li>
        <li><strong>Distribution/share</strong> - projected total distribution per share in the basis month. Weekly payers include all projected weekly payments in that month.</li>
        <li><strong>Yield</strong> - approximate annualized distribution yield based on the latest payout, frequency, and current price when available.</li>
        <li><strong>Shares needed to fill the gap</strong> - estimated shares needed to offset the basis month's shortfall using the listed distribution/share. This is math only, not a trade recommendation.</li>
        <li><strong>Est. cost</strong> - approximate cost of those what-if shares using the latest available price.</li>
      </ul>

      <h4 style={{ color: '#90caf9', marginTop: '1rem', marginBottom: '0.4rem' }}>Candidate Universe</h4>
      <p style={{ marginBottom: '1rem' }}>
        The Candidate Universe lists the fund families and seeded tickers the app is allowed to
        consider for future schedule-fit analysis. Tickers without schedule data are shown as tracked
        candidates, but they are not ranked until the app has usable pay-date metadata. Adding a ticker
        to holdings or watchlist and refreshing dividend metadata can make it eligible for scoring.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
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
          <strong>Switch to 5Y or Max</strong> to see long-term trends. Short-term noise smooths out
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

function PortfolioGrowth2Help() {
  return (
    <div>
      <h2>Portfolio Growth 2</h2>
      <p style={{ marginBottom: '1rem' }}>
        Portfolio Growth 2 gives you a dollar-value view of your portfolio over time: how much it is worth,
        how much you have invested, and where profit or loss is coming from. Unlike the Growth page, which
        indexes everything to 100 for comparison, this page shows actual dollar amounts and breaks
        performance down by source: capital gains, dividends, realized P&amp;L, and fees.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        Both charts share the same period selector and ticker filter, so every view stays in sync as you
        explore different time ranges or focus on a subset of your holdings.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/growth-2/Screenshot 2026-05-09 095042.jpg" alt="Portfolio Growth 2 performance chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Shared Controls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Period</strong> - Eight buttons covering 7d, 1m, 3m, 6m, YTD, 1y, 5y, and all. Controls
          the date range used by both charts, and changing it triggers a fresh data fetch.
        </li>
        <li>
          <strong>Tickers</strong> - A multi-select dropdown listing every ticker in the active portfolio.
          By default all tickers are included. Uncheck tickers to exclude them from both charts, or check
          specific ones to focus on a subset. The button shows "All (N)" when nothing is excluded, or
          "X of N" when a subset is selected.
        </li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Chart 1 - Portfolio Value</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows the total dollar value of your portfolio over the selected period, calculated as current
        share quantities multiplied by historical daily closing prices. This is not a simulated backtest -
        it uses your actual holdings and shows what those shares were worth each day.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Portfolio line (cyan)</strong> - Total market value of all held shares each day.
          A light fill beneath the line helps visualize the shape of the curve.
        </li>
        <li>
          <strong>Show cost basis</strong> - Toggle the orange dashed line showing your total invested
          amount (sum of purchase values across all active tickers). When the portfolio line is above this
          line you are in unrealized profit; below it you are at a loss.
        </li>
        <li>
          <strong>Show trades</strong> - Overlay buy and sell markers on the portfolio value line.
          Green upward triangles mark buy transactions; red downward triangles mark sells. Hover over a
          marker to see the ticker, share count, and price. Trade data comes from your imported transaction
          history. For holdings without individual transaction records, the original purchase date from
          the holdings table is used as a single buy marker.
        </li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Chart 2 - Portfolio Performance</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows your cumulative profit or loss over the selected period, optionally broken down by source.
        All values start at zero at the beginning of the period, or at your cost basis depending on the
        P/L setting, and accumulate day by day.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Profit Sources</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Capital gain (cyan)</strong> - Unrealized price change: the difference between the
          current portfolio value and its value at the start of the period, or your total cost basis when
          using "From the first trade".</li>
        <li><strong>Dividends (orange)</strong> - Cumulative dividends received within the period, sourced
          from yfinance per-share dividend data multiplied by your share quantities.</li>
        <li><strong>Realized P&amp;L (green)</strong> - Cumulative realized gains and losses from sell
          transactions recorded in your transaction history. Only shown when the total is large enough
          to be visible on the chart (more than 1% of the total P&amp;L range).</li>
        <li><strong>Fee (purple)</strong> - Cumulative transaction fees from your imported trade history.
          Only shown when fees are material (more than 1% of total P&amp;L range). Fees reduce overall profit
          so this line runs negative.</li>
        <li><strong>Total (dotted)</strong> - The sum of all active sources. When "Group by the profit
          source" is off, only this line is shown as a solid cyan line.</li>
      </ul>

      <h4 style={{ marginBottom: '0.4rem' }}>Performance Controls</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Total profit % / Total profit $</strong> - Switch the Y-axis between dollar amounts
          and percentage returns. In percentage mode all values are expressed relative to the base amount
          (either period-start value or total cost basis).
        </li>
        <li>
          <strong>Group by</strong> - Choose <em>No grouping</em> (default), <em>Ticker</em> (one series per
          holding), or <em>Category</em> (one series per category). Use this when you want to compare how
          different parts of the portfolio contribute to performance.
        </li>
        <li>
          <strong>Group by the profit source</strong> - When on (default), the chart shows separate lines
          for capital gain, dividends, realized P&amp;L, and fees plus a dotted total. When off, only the
          single combined total line is shown, which is cleaner when you just want overall P&amp;L.
        </li>
        <li>
          <strong>Calculate P/L for: Selected period</strong> - P&amp;L is measured from the portfolio value
          at the first day of the selected period. The total line starts at zero and shows how much you
          have gained or lost since that date.
        </li>
        <li>
          <strong>Calculate P/L for: From the first trade</strong> - P&amp;L is measured against your total
          invested cost basis (sum of purchase values). Capital gain reflects the difference between
          current value and what you paid. This gives a true "return on investment" view regardless of
          which period is selected.
        </li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tips</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Use <strong>Show cost basis</strong> and <strong>"From the first trade"</strong> together to
          see at a glance how far your portfolio is above or below your total investment.</li>
        <li>Switch to <strong>Total profit %</strong> when comparing portfolios of different sizes.</li>
        <li>Turn off <strong>"Group by the profit source"</strong> for a clean single-line total view,
          then turn it back on to see how much of your profit comes from dividends versus price appreciation.</li>
        <li>Use the <strong>Tickers</strong> filter to isolate a specific holding or category of holdings
          and see how their value and P&amp;L have tracked over time.</li>
        <li>Fees and Realized P&amp;L lines only appear when they represent more than 1% of the total P&amp;L
          range. If you do not see them, those amounts are present but too small to show at the current
          chart scale.</li>
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
        <img src="/help-screenshots/dividends/Screenshot 2026-05-09 095253.jpg" alt="Dividend Analysis page" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      {/* ── Filters ────────────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Category Filter</h3>
      <p style={{ marginBottom: '1rem' }}>
        A category dropdown at the top lets you filter the analysis to specific categories (same behavior
        as the Growth page). Select one or more categories to see dividend metrics for just those groups,
        or leave it on "All Holdings" for the full portfolio view. Changing the filter refreshes all
        charts, metrics, and the data table.
      </p>

      {/* ── Metrics Strip ──────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Metrics Strip</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Charts</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Data Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the charts is a sortable data table with one row per holding and a totals row at the bottom.
        Click any column header to sort — click again to reverse the direction. Sort arrows indicate
        the active column and direction.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Columns</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The stock/ETF symbol.</li>
        <li><strong>Description</strong> — The holding's name.</li>
        <li><strong>Category</strong> — The assigned category.</li>
        <li><strong>YTD Divs</strong> — Year-to-date dividends received for this holding.</li>
        <li><strong>Total Divs</strong> — Lifetime total dividends received (shown in bold).</li>
        <li><strong>Paid For Itself</strong> — Percentage of cost recovered through dividends.
          Colored <span style={{ color: '#4dff91' }}>green</span> at 100%+ and <span style={{ color: '#ffd700' }}>gold</span> at 50%+.</li>
        <li><strong>Div Paid</strong> — Estimated cash amount of one dividend payment for your current share count.</li>
        <li><strong>Est. Annual</strong> — Estimated annual dividend income from this holding.</li>
        <li><strong>Est. Monthly</strong> — Estimated monthly dividend income.</li>
        <li><strong>Yield on Cost</strong> — Annual dividend yield based on your purchase price (what you're earning on your original investment).</li>
        <li><strong>Current Yield</strong> — Annual dividend yield based on today's market price.</li>
        <li><strong>Gain / Loss</strong> — Unrealized capital gain or loss. Colored
          <span style={{ color: '#4dff91' }}> green</span> if positive,
          <span style={{ color: '#ff6b6b' }}> red</span> if negative.</li>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
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
        The Dividend Calendar has two views. <strong>Calendar</strong> shows ex-dividend and
        pay-date events for your current holdings. <strong>Optimization</strong> projects those
        payments across the next 12 months so you can see whether income is evenly distributed
        or concentrated in certain months. Use this page for dividend timing and income-smoothing
        research; it is not a buy/sell signal.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/div-calendar/Screenshot 2026-05-09 100041.jpg" alt="Dividend Calendar" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      {/* ── What the Page Shows ─────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Calendar View</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Calendar tab shows each holding with an ex-dividend date as a card in a grid layout.
        Cards are sorted chronologically and contain:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Date column (left)</strong> — The day, month abbreviation, and day-of-week for the
          ex-dividend date.
        </li>
        <li>
          <strong>Ticker icon</strong> — A colored circle showing the first letter of the ticker symbol.
          The color is unique to each holding and matches the card's left border color.
        </li>
        <li>
          <strong>Ticker &amp; Description</strong> — The symbol and a truncated name of the holding.
        </li>
        <li>
          <strong>Ex-Div chip</strong> — The ex-dividend date. To receive the dividend, you must own
          shares <em>before</em> this date. Buying on or after the ex-div date means you won't receive
          that period's dividend.
        </li>
        <li>
          <strong>Pay Date chip</strong> — The date the dividend payment is deposited. Dates marked
          with an asterisk (*) are <strong>estimated</strong> — the actual pay date has not yet been
          confirmed by the company. Dates without an asterisk are confirmed.
        </li>
        <li>
          <strong>Amount &amp; Frequency</strong> — The dividend amount per share and the payment
          frequency (e.g., Monthly, Quarterly, Weekly).
        </li>
      </ul>

      {/* ── Paid Status ─────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Paid Status Indicators</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Cards automatically show whether a payment has already been made:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Paid this week</strong> — The pay date fell within the current calendar week
          (Monday through today). The card dims slightly, the left border turns dark green,
          and a green <span style={{ color: '#00e89a' }}>✓ paid this week</span> badge appears
          next to the ticker.
        </li>
        <li>
          <strong>Paid this month</strong> — The pay date was earlier in the current month but
          before this week. Same visual treatment but shows "paid this month".
        </li>
        <li>
          <strong>No badge</strong> — The payment is upcoming (pay date is today or in the future).
        </li>
      </ul>

      {/* ── Filters ─────────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filters</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Three filter buttons appear above the card grid. Click one to narrow the view:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>All</strong> — Shows every holding with an ex-dividend date on record,
          including past and future. This is the default view.
        </li>
        <li>
          <strong>Upcoming</strong> — Shows only holdings whose pay date is today or in the future.
          Hides already-paid events, giving you a clean forward-looking view.
        </li>
        <li>
          <strong>Next 30 Days</strong> — Shows only holdings with a pay date within the next
          30 days. Useful for short-term income planning.
        </li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        A count next to the filter buttons shows how many holdings match the current filter
        (e.g., "12 holdings"). If no events match the active filter, a "No events match this filter"
        message is shown.
      </p>

      {/* ── Estimated vs Confirmed ──────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Estimated vs. Confirmed Pay Dates</h3>
      <p style={{ marginBottom: '1rem' }}>
        A note in the filter bar explains the asterisk convention:
        <em> "* estimated pay date | no asterisk = confirmed"</em>.
        Estimated pay dates are calculated by the app based on the holding's typical payment schedule.
        Confirmed dates come directly from the data source (Yahoo Finance or your import).
        Always check your broker for the official payment date on high-value holdings.
      </p>

      {/* ── How to Use ──────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Select "Upcoming" filter</strong> to see your forward dividend schedule. This clears
          out past payments and shows only what's coming.
        </li>
        <li>
          <strong>Use "Next 30 Days"</strong> when you want to plan short-term cash flow or know
          exactly what income to expect this month.
        </li>
        <li>
          <strong>Check the Pay Date chip</strong> for each card to know when cash will land in your
          account. If it has an asterisk, treat the date as approximate.
        </li>
        <li>
          <strong>Watch for the ex-dividend date</strong> if you're considering adding to a position —
          buying before the ex-div date captures the upcoming dividend; buying on or after it means
          waiting until the next cycle.
        </li>
        <li>
          <strong>Switch to "All"</strong> to review past payments and confirm which holdings paid
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
        <img src="/help-screenshots/earnings-calendar/Screenshot 2026-05-09 100408.jpg" alt="Earnings Calendar" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>What the Page Shows</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each holding with an earnings date appears as a card. Cards are sorted upcoming-first
        (soonest at the top), then past earnings most-recent first. Each card contains:
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filters</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Upcoming</strong> (default) &mdash; Future earnings only.</li>
        <li><strong>Next 30 Days</strong> &mdash; Reports landing in the next month.</li>
        <li><strong>Past 30 Days</strong> &mdash; Recent reports, useful for reviewing surprises.</li>
        <li><strong>All</strong> &mdash; Everything on file for your holdings.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Sources</h3>
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
      <p style={{ marginBottom: '1rem', color: '#90a4ae', fontSize: '0.85rem' }}>
        Note: Zacks's per-symbol earnings pages are gated by Imperva bot detection, so they can't
        be scraped from the backend. If Zacks ever publishes an open feed, it would be a natural
        addition here.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Use</h3>
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
        <img src="/help-screenshots/div-compare/Screenshot 2026-05-09 100606.jpg" alt="Dividend Compare" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      {/* ── Forward vs TTM ─────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Forward vs. TTM — What's the Difference?</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Forward Annual Dividend (Fwd Ann. Div/Sh)</strong> — The projected annual dividend
          per share based on the most recent declared dividend, annualized. This is what you expect
          to receive going forward if the current rate holds. Shown in <span style={{ color: '#4dff91' }}>green</span>.
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
          Shown in <span style={{ color: '#7ecfff' }}>blue</span>.
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
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Holdings Table</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Look Up Tickers</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
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
        <img src="/help-screenshots/dividend-history/Screenshot 2026-05-09 100726.jpg" alt="Dividend History" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Views and Ranges</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Yearly</strong> — shows annual totals as a bar chart.</li>
        <li><strong>Monthly</strong> — shows monthly dividends as an area chart with an optional 3-month moving average.</li>
        <li><strong>Weekly</strong> — shows weekly dividend history for shorter lookbacks.</li>
        <li><strong>Range buttons</strong> — Monthly and Weekly views include preset lookback ranges so you can quickly zoom in or out.</li>
        <li><strong>Partial current period</strong> - The current month is labeled like <em>Apr '26 partial</em>, the current year is labeled like <em>2026 YTD</em>, and today's weekly entry is labeled <em>today</em>. These labels mean the period is still incomplete.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Sources</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Broker payments</strong> - Imported dividend transactions from Schwab, E*TRADE, Fidelity, Snowball, or generic sources are treated as actual payment history.</li>
        <li><strong>Refresh estimates</strong> - Refresh Prices &amp; Divs can add source <code>refresh_estimate</code> rows when a holding's expected pay date matches the refresh date. These rows let the history chart begin tracking same-day distributions even before a broker transaction file is imported. Dividend repair excludes them from actual payment totals so they do not replace or inflate imported broker actuals.</li>
        <li><strong>Actuals replace estimates</strong> - If a later broker import brings in the actual payment for the same ticker, account, and date, the actual amount replaces the refresh estimate.</li>
        <li><strong>Legacy payout tables</strong> - If older monthly or weekly payout tables exist for an account, Dividend History keeps using that history and only fills missing periods with refresh-estimated rows. A new refresh estimate will not hide the older history.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filters and Overlay</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Category filter</strong> — limit the history to selected portfolio categories.</li>
        <li><strong>Show Cumulative</strong> — overlays a cumulative dividends line on a second axis.</li>
        <li><strong>Weekly category note</strong> — when filtering weekly history by category, values are estimated proportionally for the selected slice.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Strip</h3>
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

function TotalReturnHelp() {
  return (
    <div>
      <h2>Total Return Dashboard</h2>
      <p style={{ marginBottom: '1rem' }}>
        The Total Return page gives you the complete picture of your investment performance —
        combining both capital gains (price appreciation) and dividend income into a single
        return figure. This is the most accurate measure of how your portfolio is actually doing,
        since dividends can represent a significant portion of total returns for income-focused investors.
        The page includes an all-time summary, a 1-year bar chart, a flexible side-by-side comparison
        tool, a scatter plot, and a detailed holdings table.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/total-return/Screenshot 2026-05-09 100848.jpg" alt="Total Return analysis" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      {/* ── Category Filter ─────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Category Filter</h3>
      <p style={{ marginBottom: '1rem' }}>
        If you have categories defined, a filter dropdown appears at the top. Select one or more
        categories to narrow the summary, charts, and table to just those holdings. "All Holdings"
        is the default. Changes trigger an immediate refresh of all data on the page.
      </p>

      {/* ── Summary Strip ───────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Strip</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A row of metric cards shows all-time portfolio figures (since each position was purchased):
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Total Invested</strong> — Sum of all purchase values (shares × price paid).</li>
        <li><strong>Current Value</strong> — Today's market value of all holdings.</li>
        <li><strong>Price Gain / Loss</strong> — Capital appreciation only (Current Value − Total Invested). Green if positive, red if negative.</li>
        <li><strong>Total Divs Received</strong> — Lifetime dividend income across all holdings.</li>
        <li><strong>Total Return $</strong> — Price gain/loss + dividends received. The true dollar profit.</li>
        <li><strong>Total Return %</strong> — Total Return $ as a percentage of Total Invested.</li>
        <li><strong>SPY — 1Y</strong> — SPY's 1-year price return, shown as a live benchmark reference.</li>
      </ul>
      <p style={{ marginBottom: '1rem', color: '#90a4ae', fontSize: '0.9rem' }}>
        Note: Summary figures are <strong>all-time since purchase</strong>. The charts below pull
        live data from Yahoo Finance for the selected period.
      </p>

      {/* ── Total Return Bar Chart ──────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Total Return % by Ticker Chart</h3>
      <p style={{ marginBottom: '1rem' }}>
        A horizontal bar chart showing each holding's total return percentage over the trailing
        1 year (live from Yahoo Finance, including dividends). Bars are color-coded per ticker —
        green bars are positive, red are negative. A gold dashed vertical line marks SPY's 1-year
        return as a benchmark reference. Each ticker label is colored to match its bar.
        Hover over any bar for the exact value.
      </p>

      {/* ── Performance Comparison ──────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Performance Comparison Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A fully customizable line chart that lets you plot any combination of your holdings and
        external tickers side by side on a normalized scale (all lines start at 100). This is ideal
        for seeing which of your positions has outperformed, or comparing your holdings to benchmarks
        like SPY, QQQ, or sector ETFs.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Controls</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Portfolio Tickers dropdown</strong> — Multi-select from your holdings. Use "All"
          to add every holding at once, or "Clear" to deselect all. Each selected ticker becomes a
          colored line on the chart.
        </li>
        <li>
          <strong>External Tickers</strong> — Type any ticker symbols (e.g., <em>SPY QQQ VOO</em>)
          and click "Add" to include tickers you don't own. These are fetched live from Yahoo Finance.
          Added tickers are shown as a list; click "Clear" to remove them.
        </li>
        <li>
          <strong>Period</strong> — Eight time range buttons: 3M, 6M, 9M, 1Y, 2Y, 3Y, 4Y, 5Y.
          Changes update the chart immediately.
        </li>
        <li>
          <strong>Return Type</strong> — Toggle between <strong>Price</strong> (capital gains only)
          and <strong>Total Return</strong> (price + dividends reinvested). Total Return will show
          dividend-paying stocks outperforming their price-only line over longer periods.
        </li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        All lines are normalized to 100 at the start of the selected period so that different-priced
        securities can be directly compared. A dashed gray baseline at 100 marks the starting point.
        Hover over the chart for a unified tooltip showing all values at a given date.
      </p>

      {/* ── Scatter Chart ───────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Total Return % vs. Yield on Cost Scatter</h3>
      <p style={{ marginBottom: '1rem' }}>
        A bubble scatter chart plotting each holding's all-time total return (Y-axis) against its
        annual yield on cost (X-axis). Bubble size represents position size. This chart reveals
        the relationship between income generation and capital appreciation — holdings in the
        upper-right have both strong dividends and strong price growth. Hover over any bubble to
        see the ticker and exact values.
      </p>

      {/* ── Holdings Table ──────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Holdings Table — All-Time Total Return Summary</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A sortable table with one row per holding showing the full all-time return breakdown.
        Click any column header to sort; click again to reverse. A Portfolio Total row at the
        bottom aggregates key columns.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The symbol.</li>
        <li><strong>Category</strong> — Assigned category.</li>
        <li><strong>Shares</strong> — Quantity held (3 decimal places).</li>
        <li><strong>Price Paid</strong> — Average cost per share.</li>
        <li><strong>Curr Price</strong> — Current market price.</li>
        <li><strong>Invested</strong> — Total cost basis (shares × price paid).</li>
        <li><strong>Curr Value</strong> — Current market value.</li>
        <li><strong>Price G/L</strong> — Unrealized capital gain/loss in dollars. Green/red colored.</li>
        <li><strong>Price Ret %</strong> — Capital-only return percentage. Green/red colored.</li>
        <li><strong>Divs Rcvd</strong> — Total dividends received since purchase.</li>
        <li><strong>Total Ret $</strong> — Price G/L + Dividends Received. Green/red colored.</li>
        <li><strong>Total Ret %</strong> — Total Return $ as a percentage of Invested. Green/red colored.</li>
        <li><strong>RvY</strong> — Return vs. Yield. Compares the all-time Total Ret % to the holding's dividend yield. <strong>Good</strong> (green) when total return exceeds yield; <strong>Poor</strong> (red) when yield exceeds total return. A toggle in the column header switches between <strong>CYld</strong> (current yield, default) and <strong>YOC</strong> (yield on cost). See the Dashboard help section for a full explanation of the metric.</li>
      </ul>

      {/* ── How to Use ──────────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Check the summary strip first</strong> — Total Return % gives you your all-time
          portfolio performance in a single number. Compare it to SPY's 1Y return shown alongside it.
        </li>
        <li>
          <strong>Use the bar chart</strong> to quickly see which holdings are dragging returns over
          the past year. Negative red bars are candidates for review.
        </li>
        <li>
          <strong>Build a comparison chart</strong> by selecting a few key holdings plus SPY and QQQ
          as external tickers. Set the period to 3Y or 5Y and switch to "Total Return" mode to see
          the true long-term performance including dividends.
        </li>
        <li>
          <strong>Use the scatter chart</strong> to find your best all-round performers — tickers
          with both high yield on cost and strong total return sit in the upper-right quadrant.
        </li>
        <li>
          <strong>Sort the table by Total Ret %</strong> to rank your holdings from best to worst
          all-time performance. This helps identify underperformers worth trimming.
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
        returns from total returns that include dividends, so you can see how much of your
        performance comes from capital appreciation versus income collected.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/gains-losses/Screenshot 2026-05-09 101659.jpg" alt="Gains and Losses breakdown" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      {/* ── Category Filter ─────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Category Filter</h3>
      <p style={{ marginBottom: '1rem' }}>
        If you have categories defined, a dropdown appears at the top. Select one or more
        categories to filter all summary cards, tables, and charts to just those holdings.
        "All Holdings" is the default.
      </p>

      {/* ── Summary Cards ───────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Cards</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Two rows of metric cards show the high-level numbers:
      </p>
      <h4 style={{ marginBottom: '0.4rem' }}>Top Row — Unrealized (Open Positions)</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Total Invested</strong> — Sum of all purchase values for positions you still hold.</li>
        <li><strong>Current Value</strong> — Today's market value of those positions.</li>
        <li><strong>Unrealized Price G/L</strong> — Capital gain or loss only (Current Value minus Total Invested). Does not include dividends. Red if negative, green if positive.</li>
        <li><strong>Unrealized Total G/L</strong> — Price G/L plus all dividends received on open positions. This is your true unrealized profit. A position can be red on price but green on total if dividends more than offset the price decline.</li>
      </ul>
      <h4 style={{ marginBottom: '0.4rem' }}>Bottom Row — Realized & Combined</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Realized Price G/L</strong> — Capital gain or loss from positions you have sold (sell proceeds minus cost basis). Sourced from SELL transactions recorded via the Holdings transaction system.</li>
        <li><strong>Realized Total G/L</strong> — Realized Price G/L plus all dividends collected on those tickers while you held them. Even a position sold at a price loss can show a positive Total G/L if enough dividends were collected.</li>
        <li><strong>Combined Price G/L</strong> — Unrealized Price G/L + Realized Price G/L. Your overall capital-only profit/loss across all positions, open and closed.</li>
        <li><strong>Combined Total G/L</strong> — Unrealized Total G/L + Realized Total G/L. Your true overall profit/loss including all dividends ever collected. This is the most comprehensive performance number on the page.</li>
      </ul>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Tabs</h3>
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
        <li><strong>Total G/L</strong> — Price G/L + Dividends Received.</li>
        <li><strong>Total G/L %</strong> — Total G/L as a percentage of Invested.</li>
        <li><strong>RvY</strong> — Return vs. Yield. Compares the Total G/L % to the holding's dividend yield. <strong>Good</strong> (green) when total return exceeds yield; <strong>Poor</strong> (red) when yield exceeds total return. A toggle in the column header switches between <strong>CYld</strong> (current yield, default) and <strong>YOC</strong> (yield on cost). See the Dashboard help section for a full explanation.</li>
      </ul>
      <p style={{ marginBottom: '1rem', color: '#90a4ae', fontSize: '0.9rem' }}>
        A Portfolio Total footer row sums key columns across all holdings.
      </p>

      <h4 style={{ marginBottom: '0.4rem' }}>Realized Tab</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        One row per sell event, sourced from SELL transactions recorded in the Holdings page.
        Shows the cost basis, sale proceeds, and gain/loss for each sale.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The symbol sold.</li>
        <li><strong>Sell Date</strong> — Date the sale was executed.</li>
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
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Charts</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the table, a set of charts visualize your gains and losses over time. Use the period
        buttons (3M, 6M, 1Y, 2Y, 3Y, 5Y) to change the time range. All chart data is fetched
        live from Yahoo Finance.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Cumulative G/L Over Time</strong> — Two area lines showing your portfolio's running
          Price G/L (blue) and Total G/L including dividends (green) over the selected period. A dashed
          zero line marks breakeven. Hover for exact dollar values at any date.</li>
        <li><strong>Price G/L vs Total G/L by Ticker</strong> — Horizontal grouped bar chart comparing
          each ticker's price-only and total gain/loss side by side. Makes it easy to spot which
          holdings are being "saved" by their dividends (large gap between the two bars).</li>
        <li><strong>Winners vs Losers</strong> — Vertical bar chart ranking every ticker by Total G/L.
          Green bars are winners, red bars are losers. Sorted from highest to lowest so your best
          and worst performers are immediately visible.</li>
        <li><strong>Realized Gains Timeline</strong> — Appears only if you have sold positions. Shows
          each sale as a bar on a timeline, colored green for gains and red for losses. Useful for
          tracking when you locked in profits or took losses.</li>
      </ul>

      {/* ── How to Use ──────────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>
          <strong>Check the summary cards first</strong> — Compare Price G/L to Total G/L in each
          row. If Total G/L is significantly higher, dividends are a major contributor to your returns.
        </li>
        <li>
          <strong>Use the Combined tab</strong> to see each ticker's full history across both open
          and closed positions. The Net Total G/L column is the definitive profit/loss figure.
        </li>
        <li>
          <strong>Sort the Unrealized table by Total G/L %</strong> to find your best and worst
          performing open positions when dividends are included.
        </li>
        <li>
          <strong>Compare the two bar chart types</strong> — if a ticker has a red Price G/L bar
          but a green Total G/L bar, the dividends earned more than offset the price decline.
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Key Concepts</h3>
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
        <img src="/help-screenshots/safe-withdrawal/Screenshot 2026-05-09 101918.jpg" alt="Safe Withdrawal Rate calculator" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>What It Shows</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>N% of Cost / Week, Month, Year</strong> — withdrawal amounts at the selected percent of original cost basis.</li>
        <li><strong>Est Monthly Dividends</strong> — current estimated monthly income from the selected holdings.</li>
        <li><strong>Break-even % (Portfolio YoC)</strong> — aggregate yield on cost for the selected holdings. Any withdrawal rate above this eats into principal. The card turns <span style={{ color: '#4ade80' }}>green</span> when your selected percent is below break-even and <span style={{ color: '#ff6b6b' }}>red</span> when it exceeds it.</li>
        <li><strong>Yield on Cost / Current Yield</strong> — side-by-side context for each holding.</li>
        <li><strong>Sustainable flag</strong> — highlights holdings where current income meets or exceeds the selected percent-of-cost target.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Filters and Table</h3>
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
        <img src="/help-screenshots/general-scanner/Screenshot 2026-05-09 125140.jpg" alt="General Scanner interface" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Saved Universe vs Ad Hoc Pulls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Saved Universe</strong> — this is your persistent scanner list. Refresh Data and Force Refresh work against this saved universe.</li>
        <li><strong>Pull Stocks or ETFs Without Saving Them</strong> — use this box to type tickers such as <code>AAPL MSFT QQQ SPYI</code> and screen them temporarily without adding them to the saved universe.</li>
        <li><strong>Pull Now</strong> fetches scanner data for just the tickers you entered and shows that temporary subset.</li>
        <li><strong>Back to Saved Universe</strong> returns the page to your normal saved scanner universe.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Views</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Descriptive</strong> — basic company or ETF identity fields such as ticker, company, sector, industry, country, market cap, price, and volume.</li>
        <li><strong>Fundamental</strong> — valuation and quality fields such as P/E, forward P/E, PEG, dividend yield, margin, ROE, debt/equity, and beta.</li>
        <li><strong>Technical</strong> — price, change, moving averages, RSI, MACD, stochastic, 52-week levels, and volume.</li>
        <li><strong>ETF</strong> — ETF-specific fields such as strategy, cap size, category, expense ratio, AUM, and dividend yield.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Refresh Buttons</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Refresh Data</strong> updates scanner prices and cached fields for the saved universe using the existing cache where possible.</li>
        <li><strong>Force Refresh</strong> re-fetches ticker info from Yahoo Finance and is the best choice after adding a lot of new tickers or when classifications look stale.</li>
        <li>If you were on a temporary ad hoc pull, refresh switches you back to the saved universe so you do not stay stuck on a tiny temporary subset.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Filters and Signals</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Signal</strong> presets include Top Gainers, Top Losers, New High, New Low, Most Active, Unusual Volume, Overbought, Oversold, and several SMA-based setups.</li>
        <li><strong>Active filter chips</strong> appear above the results table and can be removed one at a time.</li>
        <li><strong>Market Cap</strong> is mainly meaningful for stocks. In ETF context, the scanner ignores the stock market-cap range filter so ETF screens are not accidentally narrowed by stock-only sizing rules.</li>
        <li><strong>ETF Strategy</strong> lets you screen option-income, bonds, preferred, BDC, CEF, and other ETF groups from the ETF classification data in cache.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Universe Management</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Universe</strong> opens the saved ticker list so you can add or remove names manually.</li>
        <li><strong>Reset to Defaults</strong> replaces your current saved scanner universe with the built-in default stock and ETF list and clears cached scanner data. The app now requires typed confirmation before it runs.</li>
        <li><strong>Save as Defaults</strong> writes the current universe to the local defaults file so that universe can be reused later.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Tips</h3>
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
        <img src="/help-screenshots/security-research/Screenshot 2026-05-09 103658.jpg" alt="Security Research page" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Lookup Modes</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>ETF</strong> - enter an ETF ticker to review the fund name, objective, issuer, category, legal type, expense ratio, assets, NAV, inception date, yield data, top holdings, and allocation breakdown.</li>
        <li><strong>Stock</strong> - enter a stock ticker to review business description, sector and industry, valuation metrics, fundamentals, dividend data, and payout context.</li>
        <li><strong>Lookup</strong> - fetches the selected ticker using the current ETF or Stock mode. Pressing Enter in the ticker box also runs the lookup.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>ETF Research Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Name &amp; Description</strong> summarizes the fund objective or description.</li>
        <li><strong>Metric grid</strong> shows issuer, category, legal type, expense ratio, total assets, NAV, inception date, dividend frequency, estimated yield, SEC yield, <strong>1Y Ret vs Yield</strong>, TTM dividend per share, and source link when available.</li>
        <li><strong>Top Holdings</strong> lists the largest reported positions with weights.</li>
        <li><strong>Allocation</strong> displays sector or asset-class weights as horizontal bars.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Stock Research Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Business Description</strong> gives a plain-language company summary.</li>
        <li><strong>Valuation</strong> includes price, market cap, enterprise value, beta, trailing and forward P/E, price/book, and price/sales.</li>
        <li><strong>Fundamentals</strong> includes revenue, revenue growth, margins, net income, free cash flow, and debt/equity.</li>
        <li><strong>Dividends</strong> includes dividend frequency, rate, yield, <strong>1Y Ret vs Yield</strong>, payout ratio, TTM dividend per share, and last dividend when available.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>1Y Return vs. Yield</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>1Y Ret vs Yield</strong> field appears in the ETF metric grid (next to the yield fields) and in the Stock dividends section.
        It compares the ticker's trailing one-year total return to its current dividend yield to give a quick signal on whether the return justifies the income:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Good</strong> (green) — the 1-year total return exceeds the current yield. Price appreciation is adding return on top of the income the fund pays.</li>
        <li><strong>Poor</strong> (red) — the current yield is higher than the 1-year total return. The position is paying income, but price decline over the past year has offset more than the dividend provided.</li>
        <li><strong>—</strong> — shown when 1-year return data has not yet loaded or the ticker pays no dividend.</li>
      </ul>
      <p style={{ marginBottom: '0.75rem', color: '#90a4ae', fontSize: '0.9rem' }}>
        The 1-year return data is fetched from the same source as the Annual Chart (Yahoo Finance total return). The value populates a few seconds after the research result loads. No toggle is available here because there is no portfolio cost basis — only current market yield is used.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Annual Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Click <strong>Open Annual Chart</strong> from any research result to show a one-year chart comparing price return and total return.
        The chart scrolls into view below the research cards and helps you see whether dividends materially changed the one-year outcome.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Average Return Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the annual chart, an <strong>Average Return</strong> bar chart shows average annualized returns over standard multi-year windows
        (1Y, 3Y, 5Y, 10Y, and since inception where available), comparing the ticker against its selected benchmark.
        The benchmark defaults to SPY and can be changed in the benchmark field above the research result.
        This helps you quickly assess whether the ticker has outperformed its reference index over multiple time horizons.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Distribution History Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the average return chart, a <strong>Distribution History</strong> bar chart shows recent dividend
        or distribution payments for the looked-up ticker. When the chart is in <strong>Yield %</strong> mode,
        an <strong>Annual / Monthly</strong> toggle appears. <em>Monthly</em> shows the per-period yield
        (distribution ÷ price × 100). <em>Annual</em> multiplies by 12 for an annualized approximation,
        making payers of different frequencies easier to compare. Switching back to <strong>$ Amount</strong>
        resets to Monthly.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>When to Use It</h3>
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
        at any percentage over any time period.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/etf-screen/Line_Chart.jpg" alt="ETF Screening chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Loading a Ticker</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Type a ticker symbol in the input field and click <strong>Load</strong> (or press Enter).</li>
        <li>Select a <strong>time period</strong>: 1D, 5D, 1W, 1M, 3M, 6M, YTD, 1Y, or 5Y.</li>
        <li>The main chart loads with price data and volume bars below it.</li>
      </ol>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Chart Controls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Chart Type</strong> — Toggle between Line and Candlestick.</li>
        <li><strong>Scale</strong> — Linear, Logarithmic, or Percentage. Use Log for long-term charts; Percentage to normalize from a 100-base.</li>
        <li><strong>Y-Axis Expansion</strong> — Top/bottom margin inputs to add breathing room around price action.</li>
        <li><strong>X-Axis Expansion</strong> — Horizontal padding to see more whitespace on either side.</li>
        <li><strong>Volume</strong> — Toggle volume bars on or off.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Technical Indicators</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Click any indicator name in the sidebar to add it to the chart. Most indicators appear as
        a subplot panel below the price chart. Click an indicator's header to expand its parameter settings.
        Available indicators include:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Overlays</strong> — SMAs (Simple Moving Averages), Bollinger Bands (plotted on the price chart itself).</li>
        <li><strong>Momentum</strong> — RSI (Relative Strength Index), MACD (Moving Average Convergence Divergence), Stochastic, CCI (Commodity Channel Index), Momentum.</li>
        <li><strong>Volatility</strong> — ATR (Average True Range), Awesome Oscillator.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>Remove any indicator by clicking its × or toggling it off in the sidebar.</p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Drawing Tools</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Comparison Tickers</h3>
      <p style={{ marginBottom: '1rem' }}>
        Add comparison tickers to overlay multiple securities on the same chart. Each additional
        ticker gets a unique colored line and appears as a chip below the input. Remove a comparison
        ticker by clicking the × on its chip.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Returns Tab</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Switch to the <strong>Returns</strong> tab to analyze historical performance including dividends.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Return Mode</strong> — Toggle between Total Return (price + DRIP), Price Only, or Dividend Only.</li>
        <li><strong>Reinvestment Slider</strong> — Set 0–100% of dividends to reinvest. 0% = take all distributions as cash; 100% = reinvest everything. The slider updates results instantly.</li>
        <li><strong>Return Summary Strip</strong> — Shows the period, total return %, price return %, dividend contribution %, annualized return, and max drawdown for the loaded ticker.</li>
        <li><strong>Comparison Statistics</strong> — If comparison tickers are added, a sidebar shows the same metrics for each one side-by-side.</li>
      </ul>
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
        <img src="/help-screenshots/watchlist/Screenshot 2026-05-09 102831.jpg" alt="Watchlist with price and dividend data" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Adding Tickers</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Type a ticker symbol in the input field (auto-converts to uppercase).</li>
        <li>Optionally type a note explaining why you're watching it (e.g., "considering for income sleeve").</li>
        <li>Press <strong>Enter</strong> or click <strong>+Add</strong>. The app fetches market data and signals.</li>
        <li>To remove a ticker, click the <strong>Remove</strong> button on its row.</li>
      </ol>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Signal Count Badges</h3>
      <p style={{ marginBottom: '1rem' }}>
        At the top of the table, summary badges show how many tickers have a BUY, SELL, or NEUTRAL
        overall signal — a quick pulse check on your watchlist as a whole.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Table Columns</h3>
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
        <li><strong>NAV Erosion</strong> — Probability label: <span style={{ color: '#81c784' }}>Low</span>, <span style={{ color: '#ffc107' }}>Medium</span>, or <span style={{ color: '#ef9a9a' }}>High</span>. Indicates whether the income wrapper appears to be losing price/NAV faster than its distribution stream justifies.</li>
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
        <img src="/help-screenshots/buy-sell-signals/Screenshot 2026-05-09 103926.jpg" alt="Buy/Sell Signals dashboard" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Signal Summary Badges</h3>
      <p style={{ marginBottom: '1rem' }}>
        At the top, four badges show total counts: BUY, SELL, NEUTRAL, and TOTAL tickers analyzed.
        A timestamp shows when the data was last refreshed. Click <strong>Refresh</strong> to re-fetch
        the latest prices and recalculate all signals.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Treemap</h3>
      <p style={{ marginBottom: '1rem' }}>
        A color-coded treemap visualizes all holdings simultaneously. Each rectangle's size represents
        the position's dollar value in your portfolio — larger rectangles are bigger positions.
        Color indicates the overall signal: green for BUY, red for SELL, orange for NEUTRAL.
        This gives an instant visual sense of whether most of your portfolio value is in bullish or
        bearish territory. Hover over any rectangle to see the ticker and signal details.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Signal Detail Table</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Use</h3>
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
        The NAV Erosion page is a backtester for a single high-yield ETF or fund. It simulates
        month-by-month what would have happened to your investment over a historical period,
        accounting for share price changes, distributions, and your chosen reinvestment level.
        It answers a critical question for income investors: <em>Is this fund's distribution
        sustainable, or is it slowly eating into your principal?</em>
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/nav-erosion/Screenshot 2026-05-09 110511.jpg" alt="NAV Erosion analysis" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>What is NAV Erosion?</h3>
      <p style={{ marginBottom: '1rem' }}>
        NAV (Net Asset Value) erosion occurs when a fund's share price falls faster than its
        distributions can compensate for. A fund paying a 15% annual distribution yield but losing
        20% of its price per year may be eroding your principal. The NAV erosion ratio compares
        the fund's price decline against a relevant benchmark, then scales the destructive decline
        by the fund's distribution yield. A lower ratio means less benchmark-adjusted erosion.
        Benchmark weakness is treated as context: if the benchmark is down too, the fund's decline
        is not automatically treated as structural NAV erosion.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Formula</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The benchmark-adjusted NAV erosion ratio is computed as:
      </p>
      <pre style={{
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '4px',
        padding: '0.75rem 1rem',
        marginBottom: '0.75rem',
        color: '#e0e0e0',
        fontSize: '0.95rem',
        whiteSpace: 'pre-wrap',
      }}>{`Ratio = |Fund Price Return| ÷ TTM Distribution Yield   (when erosion applies)
Ratio = 0                                                (when it does not)

Where:
  Fund Price Return     = (End Price − Start Price) ÷ Start Price
  Benchmark Return      = (Bench End − Bench Start) ÷ Bench Start
                          (sum of component returns for composite benchmarks)
  TTM Distribution Yield = (Trailing-12-mo distributions per share) ÷ End Price`}</pre>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Benchmark gate.</strong> The benchmark acts as a context filter, not a subtraction.
        Erosion is only counted (numerator = <code>|Fund Return|</code>) when <em>both</em> conditions hold:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Fund Return is negative (the fund's price actually fell), <em>and</em></li>
        <li>Benchmark Return is flat or positive (the underlying market was not down).</li>
      </ul>
      <p style={{ marginBottom: '0.75rem' }}>
        If the fund is up, or if the benchmark itself is down, the numerator is forced to <code>0</code>
        — a fund is not punished for tracking a falling market lower, only for losing price while its
        benchmark held up. This is what makes the ratio "benchmark-adjusted."
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        <strong>Why divide by yield.</strong> Dividing the destructive price decline by the distribution
        yield asks: "How much of the yield is being financed out of NAV?" A ratio of <code>0.50</code> means
        roughly half of the yield is offset by price erosion; <code>1.00</code> means the entire yield was
        eaten by NAV decline. Ratio thresholds are <strong>≤ 0.25 Low</strong>, <strong>0.25–0.75 Moderate</strong>,
        and <strong>&gt; 0.75 High</strong>. The final severity is also forced to <strong>High</strong>
        when the fund price declined 50% or more, or when the ending share deficit is 5% or more of break-even shares.
      </p>
      <p style={{ marginBottom: '1rem' }}>
        <strong>Portfolio aggregate.</strong> The portfolio-level ratio is dollar-weighted across all
        eligible holdings: <code>Σ(erosion$ per ticker) ÷ Σ(TTM distribution$ per ticker)</code>, where
        <code> erosion$ = numerator × start price × shares</code> and
        <code> distribution$ = TTM dist per share × shares</code>.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Inputs</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The ETF or fund to analyze (e.g., JEPI, XYLD, QYLD).</li>
        <li><strong>Initial Investment</strong> — Dollar amount to start with (default $10,000).</li>
        <li><strong>Start / End Date</strong> — The historical backtest window.</li>
        <li><strong>Reinvestment %</strong> — Drag the slider or type a number (0–100%). At 0%, all distributions are taken as cash. At 100%, all distributions buy more shares (full DRIP). Use values between to simulate partial reinvestment.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Automatic Benchmark Context</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        NAV erosion is benchmark-adjusted so a fund is not punished just because its whole underlying market is weak.
        The app chooses a best-effort benchmark from known ticker mappings and fund description keywords. Examples:
        Nasdaq income funds generally compare to <code>QQQ</code>, S&amp;P 500 income funds to <code>SPY</code>,
        Russell 2000 funds to <code>IWM</code>, defense funds to <code>ITA</code>, gold funds to <code>GLD</code>,
        silver funds to <code>SLV</code>, and bitcoin funds to <code>BTC-USD</code>.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        For holding-level overrides, use the Dashboard NAV column. There you can force a fund to be tested, skip it,
        or enter a custom benchmark ticker/composite when the automatic benchmark is not the right fit.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Statistics</h3>
      <p style={{ marginBottom: '0.75rem' }}>After running the backtest, a strip of metric tiles shows:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Total Distributions</strong> — All cash paid out over the period.</li>
        <li><strong>Shares Purchased</strong> — Shares bought via DRIP reinvestment.</li>
        <li><strong>Total Reinvested</strong> — Dollar amount reinvested.</li>
        <li><strong>Final Portfolio Value</strong> — Ending value of all shares held.</li>
        <li><strong>Price Change %</strong> — How much the share price moved over the period.</li>
        <li><strong>NAV Erosion</strong> — Yes or No verdict.</li>
        <li><strong>Final Shares Needed / Extra To Breakeven</strong> — The final share gap versus break-even, shown as both shares and a percent of break-even shares. Needed means you are short of break-even; extra means you are above it.</li>
        <li><strong>Total NAV Erosion Ratio</strong> — Benchmark-adjusted ratio for the selected period. Ratio-only severity is low at 0.25 or below, moderate from 0.25–0.75, and high above 0.75. The screen also forces High for a 50%+ price decline or a 5%+ final share deficit.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Charts</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Main Line Chart</strong> — Shows share price (blue), portfolio value (green), and a dashed gray break-even threshold over time. If the green line stays above the dashed line, your investment is holding its own.</li>
        <li><strong>NAV Erosion Ratio Chart</strong> — Monthly benchmark-adjusted NAV erosion ratio plotted over time with color-coded markers: green at or below 0.25, orange at or below 0.75, red above 0.75. The headline severity can still be High from the price-decline or share-deficit rules even when the period ratio is moderate.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Monthly Detail Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>A sortable month-by-month table with 12 columns:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Date</strong> — Month/year.</li>
        <li><strong>Price</strong> — Share price that month.</li>
        <li><strong>Price Δ%</strong> — Monthly price change.</li>
        <li><strong>Div/Share</strong> — Distribution paid per share.</li>
        <li><strong>Total Dist</strong> — Total distribution for your holding.</li>
        <li><strong>Reinvested</strong> — Amount reinvested based on slider.</li>
        <li><strong>Shares Bought</strong> — New shares purchased via DRIP.</li>
        <li><strong>Total Shares</strong> — Cumulative shares held.</li>
        <li><strong>Portfolio Value</strong> — Current total value.</li>
        <li><strong>Break-Even Shares</strong> — Shares needed to recover original investment at current price.</li>
        <li><strong>Shares Needed / Extra To Breakeven</strong> — The share gap versus break-even, shown as shares plus percent. <span style={{ color: '#ef9a9a' }}>Red needed = you need that many more shares</span>; <span style={{ color: '#81c784' }}>green extra = you have that many shares above break-even</span>.</li>
        <li><strong>NAV Ratio</strong> — That month's benchmark-adjusted NAV erosion ratio, color-coded.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Enter a high-yield ticker (QYLD, XYLD, JEPI, SVOL, etc.) and set your investment amount.</li>
        <li>Start with a wide date range (e.g., 2018–present) to capture a full market cycle.</li>
        <li>Run at <strong>0% reinvestment</strong> first — this shows worst-case NAV erosion with no DRIP offsetting it.</li>
        <li>Then run at <strong>100%</strong> — this shows whether full DRIP can overcome price decay.</li>
        <li>Find the reinvestment percentage where Shares Needed falls to zero or becomes Extra — that's the break-even DRIP rate for this fund.</li>
        <li>Check the NAV ratio chart: consistent red months mean the fund price is lagging its benchmark despite distributions.</li>
      </ol>
    </div>
  )
}

function NavScreenerHelp() {
  return (
    <div>
      <h2>NAV Erosion Screener (Portfolio)</h2>
      <p style={{ marginBottom: '1rem' }}>
        The NAV Erosion Screener extends the single-ticker backtester to a full portfolio of up
        to 80 ETFs simultaneously. You set individual investment amounts and reinvestment percentages
        per ticker, run them all over the same date range, and get a side-by-side comparison of
        which funds are eroding capital and which are performing sustainably. You can save and reload
        named backtest scenarios to compare strategies over time.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/nav-erosion-portfolio/Screenshot 2026-05-09 112656.jpg" alt="NAV Erosion Screener portfolio backtest grid" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Building Your Backtest Grid</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Each row in the grid represents one ETF. Enter the <strong>Ticker</strong>, <strong>Initial Investment $</strong>, and <strong>% of Divs to Reinvest</strong> (0–100).</li>
        <li>Click <strong>+Add ETF</strong> to add more rows (up to 80).</li>
        <li>Click <strong>×</strong> on any row to remove it, or <strong>Clear</strong> to wipe all rows.</li>
        <li>Set the global <strong>Start Date</strong> and <strong>End Date</strong> — all tickers use the same date range.</li>
        <li>Click <strong>Run Backtest</strong> to analyze all rows.</li>
      </ol>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Saving and Loading Backtests</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Save List</strong> — Saves the current ticker grid (tickers, amounts, reinvest %) without the date range. Useful for persisting your standard watchlist.</li>
        <li><strong>Save Backtest…</strong> — Saves the full scenario including date range and grid under a custom name. The save form lets you overwrite an existing backtest or create a new one.</li>
        <li><strong>Saved Backtests dropdown</strong> — Load a previously saved scenario. Click <strong>Load</strong> to restore it, or <strong>Delete</strong> to remove it permanently.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Strip</h3>
      <p style={{ marginBottom: '0.75rem' }}>After running, 11 metric tiles show portfolio-wide results:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Total Invested, Total Final Value, Total Gain/Loss, Portfolio Return %</li>
        <li>Total Distributions, Total Reinvested</li>
        <li>NAV Erosion count (e.g., "3 of 8 funds eroding")</li>
        <li>Portfolio NAV erosion ratio (dollar-weighted average across all funds); the portfolio severity follows this weighted ratio rather than the worst individual fund.</li>
        <li>Best Performer (ticker + return %), Worst Performer</li>
        <li>Error Count (tickers where no data was found)</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>A sortable 17-column table with a TOTAL footer row:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker, Amount, Reinvest %</strong> — Your inputs.</li>
        <li><strong>Start Price / End Price</strong> — Share price at beginning and end of period.</li>
        <li><strong>Price Δ%</strong> — Total price change.</li>
        <li><strong>Total Distributions</strong> — All cash paid out.</li>
        <li><strong>Total Reinvested</strong> — Distributions that were reinvested.</li>
        <li><strong>Final Value</strong> — Portfolio value at end.</li>
        <li><strong>Gain/Loss $</strong> and <strong>Gain/Loss %</strong> — Capital-only gain/loss. Green/red colored.</li>
        <li><strong>Total Return $</strong> and <strong>Total Return %</strong> — Including distributions.</li>
        <li><strong>NAV Erosion</strong> — Yes (red) or No (green).</li>
        <li><strong>Shares Needed / Extra To Breakeven</strong> — Positive share gap means erosion is winning; extra shares mean reinvestment has put the position above break-even.</li>
        <li><strong>NAV Ratio</strong> — Weighted benchmark-adjusted NAV erosion ratio, color-coded.</li>
        <li><strong>Note</strong> — Any data warnings for that ticker.</li>
      </ul>
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
        <img src="/help-screenshots/scanner/Screenshot 2026-05-09 125056.jpg" alt="Single Strategy Scanner results" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Ticker List and Saved Settings</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker chips</strong> — add tickers one at a time, then remove them with the × button.</li>
        <li><strong>Saved list</strong> — the page loads and saves your scanner ticker list to the backend, so it is ready next time you open it.</li>
        <li><strong>Saved thresholds</strong> — SMA proximity and stochastic settings are remembered locally.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Scan Rules</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Trend filter</strong> — 50 SMA must be at or above the 175 SMA.</li>
        <li><strong>SMA proximity</strong> — price must be within the selected percentage band around the 175 SMA.</li>
        <li><strong>Stochastic band</strong> — Slow Stochastic %K must fall within your selected range.</li>
        <li><strong>Daily or Weekly</strong> — switching timeframe changes the available lookback periods and reruns the scan after your first manual run.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results</h3>
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
        <img src="/help-screenshots/income-sim/Screenshot 2026-05-09 113052.jpg" alt="Income Simulator projections" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>DRIP Projections Panel</h3>
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
        <img src="/help-screenshots/income-sim/Screenshot 2026-05-09 113238.jpg" alt="Income Simulator settings and filters panel" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Simulation Modes</h3>

      <h4 style={{ marginBottom: '0.4rem' }}>Historical Mode</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Uses actual historical dividend and price data to project how your holdings would have
        grown over the selected horizon. Set start and end dates, then run. Results show year-by-year
        income growth including the compounding effect of DRIP and monthly contributions.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/income-sim/Screenshot 2026-05-09 113309.jpg" alt="Income Simulator historical projection results" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
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
        <img src="/help-screenshots/income-sim/Screenshot 2026-05-09 113942.jpg" alt="Income Simulator forward projection with market bias" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h4 style={{ marginBottom: '0.4rem' }}>Comparison Mode</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Toggle <strong>Compare Tickers</strong> to enable side-by-side analysis. Add tickers
        with individual investment amounts and reinvestment percentages. Run to see a multi-line
        chart comparing projected income growth and cumulative value across all tickers.
        Use this to decide between alternative income ETFs or strategies.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/income-sim/Screenshot 2026-05-09 114242.jpg" alt="Income Simulator comparison mode with multiple tickers" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>
      <p style={{ marginBottom: '0.75rem' }}>
        You can also turn on <strong>Compare Reinvestment Impact</strong> to show baseline vs. reinvested
        results for the same holdings. In that mode, the charts and results table split each holding into
        paired rows so you can see exactly what reinvestment changes.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Saved Scenarios</h3>
      <p style={{ marginBottom: '1rem' }}>
        Click <strong>Save Scenario…</strong> to name and store your current simulation setup.
        Load saved scenarios from the dropdown to quickly compare different strategies without
        re-entering all parameters. Rename or delete saved scenarios as needed.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Charts and Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Income Chart</strong> — Bars showing projected income per period, with a cumulative growth line overlay.</li>
        <li><strong>Comparison Charts</strong> — In comparison mode, separate lines per ticker show projected income and cumulative portfolio value.</li>
        <li><strong>Results Table</strong> — Year-by-year or ticker-by-ticker breakdown with columns for Amount, Reinvest %, Price, Distributions, Reinvested, Final Value, Gain/Loss, Annualized Return, and Yield. Hover over any column header for a tooltip explaining what that column measures (e.g., Hist &mu;% = historical mean monthly return, Hist &sigma;% = volatility, Skew = downside tail risk).</li>
        <li><strong>Dividend Chart</strong> — Shows monthly dividend distributions with a trailing-3-month smoothing to eliminate pay-month spikes from quarterly or semi-annual payers.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/income-sim/Screenshot 2026-05-09 114346.jpg" alt="Income Simulator results table and charts" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/income-sim/Screenshot 2026-05-09 115416.jpg" alt="Income projection chart with dividend distributions" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/income-sim/Screenshot 2026-05-09 115453.jpg" alt="Monthly dividend chart with smoothing" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>
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
        <img src="/help-screenshots/correlation/Screenshot 2026-05-09 120623.jpg" alt="Correlation Matrix heatmap" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Adding Tickers</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Type a ticker and click <strong>Add</strong> (or press Enter). It appears as a chip below the input.</li>
        <li>Add at least <strong>2 tickers</strong> — the Run button is disabled until you have 2 or more.</li>
        <li>Remove a ticker by clicking the <strong>×</strong> on its chip.</li>
        <li>Click <strong>Clear</strong> to reset everything.</li>
      </ol>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Period Selection</h3>
      <p style={{ marginBottom: '1rem' }}>
        Choose from 3 months, 6 months, 1 year, 2 years, 5 years, or Max. Longer periods smooth out
        short-term noise and show structural relationships. Shorter periods reveal how assets behaved
        during recent market conditions.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>
          <strong>Correlation Heatmap</strong> — A color-coded grid. <span style={{ color: '#81c784' }}>Green</span> cells
          (near +1.0) mean tickers move together. <span style={{ color: '#ef9a9a' }}>Red</span> cells (near −1.0) mean they
          move opposite. Yellow/orange near 0 means uncorrelated. Hover over any cell for the exact value to 3 decimal places.
        </li>
        <li>
          <strong>Correlation Table</strong> — The same data as a numeric matrix. Diagonal cells show 1.00 (each ticker vs itself) and are grayed out.
        </li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Use</h3>
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
        <img src="/help-screenshots/analytics/Screenshot 2026-05-09 121143.jpg" alt="Portfolio Analytics dashboard" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Loading Tickers</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Manual entry</strong> — Type a ticker and click Add (or Enter). Repeat for each ticker. Remove with the × chip button.</li>
        <li><strong>Load Portfolio</strong> — Instantly loads all your current portfolio holdings. The button shows the count.</li>
        <li><strong>Clear</strong> — Resets the ticker list.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Settings</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Benchmark</strong> — Defaults to SPY. Change to any ticker for comparison.</li>
        <li><strong>Period</strong> — 1M, 3M, 6M, YTD, 1Y, 2Y, 5Y, or Max.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Analysis Mode</h3>
      <p style={{ marginBottom: '0.75rem' }}>Click <strong>Analyze</strong> to run the base analysis. Results include:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Portfolio Grade Card</strong> — Letter grade (A+ through F) and numeric score with a breakdown bar showing individual grades and weights for Risk, Income, Diversification, and other dimensions.</li>
        <li><strong>NAV Erosion Ratio</strong> — Colored display of dollar-weighted benchmark-adjusted NAV erosion context for the portfolio. Ratio is lower-is-better, and portfolio severity follows the aggregate ratio rather than the worst individual holding.</li>
        <li><strong>NAV Erosion Bar Chart</strong> — Per-ticker NAV ratios with low/moderate/high thresholds. Tickers above 0.75, down 50%+, or carrying a 5%+ share deficit deserve a closer look.</li>
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
        <li><strong>NAV Erosion Ratio</strong> — Benchmark-adjusted NAV erosion ratio for eligible income funds, with High severity also triggered by a 50%+ price decline or 5%+ ending share deficit.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Optimization Modes</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Chart Tabs</h3>
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
        <img src="/help-screenshots/portfolio-builder/Screenshot 2026-05-09 122850.jpg" alt="Portfolio Builder optimizer" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Managing Portfolios</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Saved portfolios appear in a <strong>left sidebar list</strong>. Click one to load it.</li>
        <li>Click the portfolio title to <strong>rename</strong> it inline.</li>
        <li>Use <strong>Save As</strong> to duplicate the current portfolio under a new name.</li>
        <li>Delete portfolios with the trash icon in the sidebar.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Adding Holdings</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Type a ticker symbol in the input field.</li>
        <li>Enter a <strong>dollar amount</strong> for that position.</li>
        <li>Click <strong>Add</strong>. The holding appears in the holdings table.</li>
        <li>Click any dollar amount in the table to <strong>edit it inline</strong> — press Enter to save.</li>
        <li>Remove a holding with the <strong>×</strong> button on its row.</li>
      </ol>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Running Analysis</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Set the <strong>Period</strong> and <strong>Benchmark</strong> (default SPY), then click
        <strong> Analyze</strong>. Results are identical in format to the Portfolio Analytics page:
        grade card, NAV erosion ratio, per-ticker metrics table, and chart tabs (Risk & Returns,
        Income & Allocation, Backtesting, Tools).
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Holdings Table Columns</h3>
      <p style={{ marginBottom: '0.75rem' }}>After analysis runs, the holdings table expands with metrics:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker, Grade, Score, Weight %, Current Price, Shares, Dollar Amount</strong></li>
        <li><strong>Ulcer Index, Sharpe, Sortino, Calmar, Omega</strong> — Risk metrics</li>
        <li><strong>Max Drawdown, Annual Return, Total Return, Annual Volatility, NAV Erosion Ratio</strong></li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Comparing Portfolios</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Check the checkbox next to <strong>2 or more portfolios</strong> in the left sidebar.</li>
        <li>Click <strong>Compare</strong>. A radar chart and metrics comparison table appear.</li>
        <li>The comparison table highlights the <strong>winner</strong> (▲) and <strong>loser</strong> (▼) for each metric between portfolios.</li>
      </ol>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Strategies</h3>
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
        Yahoo Finance date range from <strong>6 months to 25 years</strong>. It produces a full suite of
        financial metrics, a head-to-head score card that calls out the winner, and interactive
        growth, drawdown, annual-return, rolling-CAGR, and monthly-income charts.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/portfolio-tester/Screenshot 2026-05-09 123458.jpg" alt="Portfolio Tester backtest results" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <div className="alert alert-info" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
        <strong>How it differs from Portfolio Builder:</strong> Portfolio Builder is for designing and
        grading a single hypothetical allocation against a benchmark. Portfolio Tester is purely for
        <em> head-to-head backtesting</em>: two fully-defined portfolios run side-by-side on the same
        dates with the same settings so you can see which one would have done better.
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Building Portfolio A and B</h3>
      <p style={{ marginBottom: '0.5rem' }}>Each portfolio card lets you build the allocation four different ways:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Type a ticker + optional weight %</strong> and click <strong>Add</strong> (or press Enter). If no weight is given, it's added at 0% and you can click Equal or Normalize to distribute.</li>
        <li><strong>Load All Current</strong> — replaces the portfolio with every current holding, weighted by current dollar value. Useful when you want to benchmark your real portfolio against a hypothetical alternative.</li>
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
        The row footer shows the running total in green (at 100%) or amber (off).
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Shared Run Settings</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Start / End</strong> date inputs, plus <strong>preset buttons</strong>: 6M, 1Y, 2Y, 3Y, 4Y, 5Y, 10Y, 15Y, 20Y, 25Y. Presets set end to today and start to N years before.</li>
        <li><strong>Initial</strong> — starting investment for the backtest (default $10,000). Applied equally to both portfolios and the benchmark.</li>
        <li><strong>Benchmark checkbox + ticker</strong> — uncheck the <strong>Benchmark</strong> box to run <em>Portfolio A vs Portfolio B only</em> with no benchmark line. Check it to include a reference ticker (default <code>SPY</code>; change to <code>QQQ</code>, <code>VTI</code>, etc. as needed).</li>
        <li><strong>Rebalance</strong> — None, Monthly, Quarterly, or Annually. If set, each portfolio is rebalanced back to its target weights at that frequency.</li>
        <li><strong>Include dividends</strong> — when off, the backtest runs on pure price-only returns. When on, dividends are paid through the simulation.</li>
        <li><strong>Reinvest dividends</strong> — only meaningful if Include Dividends is on. When on (DRIP), distributions buy more shares at the pay date; when off, they accumulate as cash drag and are tallied as "total distributions paid."</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Coverage Validation (Hard Stop)</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Head-to-Head Score Card</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        At the top of the results, eight key metrics are shown as side-by-side score cards with the
        winning value <strong>bolded in green with a ✓</strong>:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>CAGR</strong>, <strong>Total Return</strong>, <strong>Final Value</strong> — higher wins.</li>
        <li><strong>Std Dev</strong> — lower (less volatile) wins.</li>
        <li><strong>Max Drawdown</strong> — higher (less negative) wins.</li>
        <li><strong>Sharpe</strong>, <strong>Sortino</strong>, <strong>MAR / Calmar</strong> — higher wins.</li>
      </ul>
      <p style={{ marginBottom: '1rem' }}>
        A header badge calls out the <strong>overall winner</strong> — the portfolio that won the most
        metrics — or "Tied" if they match. The score card is only meaningful when two portfolios are
        present; with one portfolio, it shows its values without a winner concept.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Total Return</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Below the score cards, a <strong>Portfolio Total Return</strong> section shows a summary card for each portfolio
        with the total return percentage, dollar gain/loss, initial investment amount, and final value.
        Values are color-coded green (positive) or red (negative). This provides a quick at-a-glance view
        of how much each portfolio gained or lost over the backtest period.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Performance Summary Table</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Charts</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Growth & Drawdown</strong> — Dual-panel chart. The top panel shows portfolio value over time starting at your Initial amount. The bottom panel shows <strong>drawdown from peak</strong> (% below the running all-time high; 0% = at peak, −20% = 20% below prior peak and not yet recovered). A gray zero-reference line anchors the drawdown panel.</li>
        <li><strong>Annual Returns</strong> — Grouped bar chart by calendar year. <strong>Only complete Jan–Dec years</strong> are shown — partial-year stubs are excluded so short runs don't get misleading bars. If your range doesn't cover a full year, the panel shows a note telling you to extend the range.</li>
        <li><strong>Rolling 1-Year CAGR</strong> — Rolling trailing-12-month return for each portfolio, useful for spotting which regime periods each strategy excelled in.</li>
        <li><strong>Monthly Dividend Income</strong> — Grouped bars of cash distributions received per month. Only shown when Include Dividends is on. Bars are anchored to the month-start so labels line up cleanly with the calendar. A caption under the chart totals the distributions for each portfolio.</li>
      </ul>
      <p style={{ marginBottom: '1rem', color: '#8899aa', fontSize: '0.88rem' }}>
        All chart values are formatted to two decimal places on both hover tooltips and axis ticks.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Coverage Footer</h3>
      <p style={{ marginBottom: '1rem' }}>
        Below the charts, a small gray footer lists every ticker used in the run and the earliest
        Yahoo Finance date available for it. This helps you spot tickers that silently shortened the
        effective window (e.g., an ETF that launched partway through a 10-year range).
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tips</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>To compare your <strong>real portfolio</strong> against a single-fund alternative, click <strong>Load All Current</strong> on A and add a single ticker at 100% weight on B.</li>
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
        <img src="/help-screenshots/dist-compare/Screenshot 2026-05-09 123641.jpg" alt="Distribution Compare analysis" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Mode & Comparison Type</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Historical</strong> — Uses actual dividend and price history for the simulation.</li>
        <li><strong>Simulation</strong> — Projects forward using a selected market condition.</li>
        <li><strong>Comparison Type</strong> — Choose Income vs Growth, Growth vs Growth, or Income vs Income to set the framing of the analysis.</li>
        <li><strong>Market Condition</strong> — Neutral, Bull, or Bear (for Simulation mode).</li>
        <li><strong>Duration</strong> — 1–20 years for simulation mode.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Configuring Funds</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Set <strong>Fund A</strong> and <strong>Fund B</strong> tickers — type the symbol and click Lookup to fetch live data.</li>
        <li>Optionally add <strong>Fund C</strong> as a third comparison or benchmark.</li>
        <li>Enter an <strong>investment amount</strong> per fund.</li>
        <li>Override the <strong>yield</strong> if you want to test a different dividend rate than the current one.</li>
        <li>Toggle <strong>DRIP on/off</strong> per fund — when on, distributions buy more shares; when off, income is taken as cash.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Withdrawal Settings</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Monthly Withdrawal</strong> — Dollar amount withdrawn each month from distributions.</li>
        <li><strong>Strategy</strong> — Fixed amount, dynamic (adjusts with income), or percentage of portfolio value.</li>
        <li><strong>Inflation Adjustment</strong> — Check to increase withdrawal by an inflation rate each year, simulating real-world spending increases.</li>
        <li><strong>Dynamic Reduction</strong> — Automatically reduce the withdrawal by a set % when the portfolio falls below a threshold, extending longevity.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Monthly Tables</strong> — Month-by-month breakdown per fund showing: Month, Price, Shares, Portfolio Value, Distribution/Share, Income, Withdrawal, Excess/Shortfall (green = income covers withdrawal; red = shortfall), Cumulative Income, and ROI.</li>
        <li><strong>Summary Cards</strong> — Side-by-side final values: Final Portfolio Value, Total Withdrawn, Total Distributions, Initial vs Remaining Shares, Total Value.</li>
        <li><strong>Grade Panel</strong> — Winner verdict with individual letter grades and a comparison metrics table covering ROI, Income Adequacy, Max Drawdown, Recovery Time, Ulcer Index, and whether the fund was depleted.</li>
        <li><strong>Charts</strong> — Portfolio Value Over Time, Total Value with crossover annotations, Cumulative Distributions, Share Count, and Price Trend for all funds on the same axes.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Saving and Exporting</h3>
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
        <img src="/help-screenshots/consolidation/Screenshot 2026-05-09 124407.jpg" alt="Consolidation Analysis" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      {/* Overlap Tab */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tab 1: Overlap Analysis</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 2: Consolidation Simulator</h3>
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
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 3: Market Regime Analysis</h3>
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
        The exported format matches the Generic Upload template, and the combined workbook also includes
        a Transactions sheet so you can round-trip holdings and lot history from one file.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Export</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Aggregate Mode</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When the <strong>Aggregate</strong> portfolio is selected, the Excel export creates one sheet per
        sub-portfolio. The combined holdings + transactions export also keeps one sheet per portfolio and adds a Transactions sheet.
        To reimport it later, use the <em>Generic Upload</em> tab with
        <strong> "Import all tabs as separate portfolios"</strong> checked for the holdings-only workbook, or the
        <strong> Portfolio Export (Holdings + Transactions)</strong> format on the Import page for the combined workbook.
        The CSV export combines all portfolios into a single flat file.
      </p>

      <div className="alert alert-info" style={{ marginTop: '1rem' }}>
        <strong>Tip:</strong> Export is a great way to back up your data before a major reimport or
        before clearing a portfolio. The holdings-only Excel file is fully compatible with the Generic Upload importer,
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
        The Portfolios page lets you create and manage multiple independent portfolios, configure an
        Aggregate view that combines selected portfolios, and reconcile an Owner portfolio against
        the combined totals of sub-portfolios.
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/portfolios/manage-portfolios-overview-blurred.jpg" alt="Manage Portfolios page showing portfolio table with total values blurred" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each row shows a portfolio's name, holding count, total value, and creation date.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Rename</strong> — click a portfolio name (underlined in blue) to edit it inline. Press Enter or click away to save.</li>
        <li><strong>Select</strong> — switches the active portfolio in the navbar without leaving the page.</li>
        <li><strong>Clear</strong> — removes all holdings and data from the portfolio but keeps the portfolio itself. Useful before a clean reimport.</li>
        <li><strong>Delete</strong> — permanently deletes the portfolio and all its data. The Owner/default portfolio (ID 1) cannot be deleted, so its row does not show a Delete button.</li>
        <li><strong>Owner checkbox</strong> — marks a portfolio for inclusion in the Owner aggregate. Portfolios checked here are used for Owner reconciliation and for calculating the DRIP/Cash income split on the Dashboard.</li>
        <li><strong>Combined checkbox</strong> — marks a portfolio for inclusion in the Combined Portfolios aggregate. This can include accounts not part of Owner (e.g. a separate brokerage account).</li>
        <li><strong>+ New Portfolio</strong> button (top-right) — creates a new empty portfolio. New portfolios are automatically included in both Owner and Combined.</li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Owner and broker imports:</strong> Owner is a permanent portfolio, but it is not locked to one broker.
        To use a different broker for Owner, select Owner, clear or export first if needed, then import that broker's
        positions or transaction file. If Owner represents multiple source portfolios, import broker files into the
        underlying source portfolios instead, then use Reconcile Owner to roll those accounts back up into Owner.
        Broker and Snowball imports into Owner are blocked when Owner is made up of more than one source account.
      </div>

      <div className="alert alert-info" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <strong>Owner vs Combined:</strong> These are independent configurations. Owner typically represents your primary
        brokerage accounts, while Combined includes everything across all brokerages. For example, you might have
        four accounts in Owner but five in Combined (adding an account at a different brokerage). The Dashboard's
        DRIP$/Cash$ columns use the Owner configuration to determine which accounts' DRIP flags to consider.
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Combined Portfolios (Aggregate)</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The Combined Portfolios aggregate is a read-only combined view of multiple portfolios. It appears in the navbar dropdown
        when configured. Use the "Combined" checkboxes in the table above to select which portfolios are included.
      </p>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Check the "Combined" boxes for the portfolios you want included.</li>
        <li>Enter a name for the aggregate in the <strong>Aggregate Name</strong> field.</li>
        <li>Click <strong>"Save Aggregate Config"</strong> (or "Create Aggregate" for the first time).</li>
        <li>To remove the aggregate entirely, click <strong>"Delete Aggregate"</strong>.</li>
      </ol>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Reconcile Owner</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        This feature is available when the Owner-format import has been used. It updates the Owner portfolio
        (profile 1) to match the combined holdings of all portfolios with <strong>Owner</strong> checked.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li>Tickers present in sub-portfolios but missing from Owner are <strong>added</strong>.</li>
        <li>Tickers in Owner that no longer exist in any included sub-portfolio are <strong>removed</strong>.</li>
        <li>Share counts are updated to match the combined totals.</li>
        <li>Click <strong>"Reconcile Owner"</strong> and confirm the prompt to proceed.</li>
      </ul>

      <div className="alert alert-info" style={{ marginTop: '1rem' }}>
        <strong>Note:</strong> Reconcile Owner is a destructive update to the Owner portfolio.
        Consider exporting the Owner portfolio first if you want a backup.
      </div>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Data Overview</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows three counts for the currently selected portfolio: number of <strong>Holdings</strong>,
        <strong> Dividend Records</strong>, and <strong>Income Tracking</strong> rows.
        Use this to confirm a successful import or to check whether a portfolio has data before clearing it.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Single-Stock ETFs</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Clear All Data</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Permanently deletes all holdings, dividends, income tracking, and payout data for the
        currently selected portfolio. The portfolio itself is kept — only its data is removed.
        Use this to start fresh before a clean reimport.
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
        <img src="/help-screenshots/macro-dashboard/Screenshot 2026-05-09 124729.jpg" alt="Macro Regime Dashboard" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tab 1: Macro Conditions</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Displays the current macro regime (e.g., Stable Inflation + Stable Rates) along with alert
        badges for notable conditions like Oil Rising or Rising Volatility. Shows sparkline charts
        for key indicators: Inflation Expectations, Oil (WTI), 10-Year Yield, Short-Term Rate, VIX,
        Dollar Index, and Credit Spreads, each with 3-month trend direction and change.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/macro-dashboard/Screenshot 2026-05-09 124802.jpg" alt="Macro Conditions tab showing economic indicators" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 2: Portfolio Exposure</h3>
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
        <img src="/help-screenshots/macro-dashboard/Screenshot 2026-05-09 124826.jpg" alt="Portfolio Exposure breakdown by macro sensitivity" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 3: Rebalancing Tilts</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Based on current macro conditions, suggests which sensitivity categories to overweight or
        underweight. Provides per-holding action recommendations (increase, hold, reduce, sell)
        to better align your portfolio with the macro environment.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/macro-dashboard/Screenshot 2026-05-09 124844.jpg" alt="Rebalancing Tilts recommendations" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 4: Income Benchmark</h3>
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
        <img src="/help-screenshots/macro-dashboard/Screenshot 2026-05-09 124904.jpg" alt="Income Benchmark allocation comparison" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 5: Classifications</h3>
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
        <img src="/help-screenshots/macro-dashboard/Screenshot 2026-05-09 124932.jpg" alt="Classifications tab for macro sensitivity overrides" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 6: Regime Quadrants</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Uses a Markov Chain transition model to classify the current macroeconomic regime into one of
        four quadrants based on the direction of growth and inflation, then projects forward probabilities
        of transitioning to other regimes. Data is sourced from FRED economic indicators and market proxies.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>The Four Quadrants</h4>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Q1 Goldilocks</strong> — Growth UP + Inflation DOWN. Favors equities, tech, and growth stocks.</li>
        <li><strong>Q2 Reflation</strong> — Growth UP + Inflation UP. Favors commodities, energy, and equities.</li>
        <li><strong>Q3 Stagflation</strong> — Growth DOWN + Inflation UP. Favors gold, TIPS, and utilities.</li>
        <li><strong>Q4 Deflation</strong> — Growth DOWN + Inflation DOWN. Favors long-term bonds, cash, and defensives.</li>
      </ul>

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/macro-dashboard/Screenshot 2026-05-09 124944.jpg" alt="Regime Quadrants showing macro classification" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How Classification Works</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        The current quadrant is determined using real economic data from FRED (Federal Reserve Economic Data):
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Growth</strong> — Composite Z-score of Industrial Production (INDPRO) and Housing Starts (HOUST), using their 3-month rate of change.</li>
        <li><strong>Inflation</strong> — Z-score of CPI (CPIAUCSL) 3-month rate of change.</li>
        <li><strong>Z-score</strong> — Measures how far current values are from their historical average in standard deviations. Positive = above average (rising), negative = below average (falling).</li>
        <li>If Growth Z {'>'} 0 and Inflation Z {'<'} 0 → Q1 Goldilocks. Growth Z {'>'} 0 and Inflation Z {'>'} 0 → Q2 Reflation. And so on.</li>
      </ul>

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>FRED Economic Indicators Card</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows the raw Z-scores for each FRED series along with their direction (Rising/Falling) and
        extremity level (Normal, Elevated, or Extreme). "Elevated" means the Z-score is above 1.0,
        "Extreme" means above 2.0. These labels help gauge how far conditions have moved from normal
        and whether mean-reversion is likely.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Regime Quadrant Map (Scatter Plot)</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A 2D scatter plot showing 5 years of weekly observations. The X-axis is the growth score
        and the Y-axis is the inflation score. Each dot is color-coded by quadrant. The orange
        diamond marked "Now" shows where current conditions sit. The quadrant lines cross at
        the origin (0,0) — points in the upper-right are Q2 Reflation, upper-left are Q3 Stagflation, etc.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>This Week's Outlook — Next Week Probabilities</h4>
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

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Historical Transition Matrix (Heatmap)</h4>
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

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>4-Week Outlook Cards</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Four cards above the forward projections chart showing the probability of being in each
        quadrant at the 4-week horizon. The highest-probability quadrant is highlighted with
        a colored border. This is the quick-read summary of where things are heading.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Forward Projections (Stacked Bar Chart)</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Shows the probability distribution across all four quadrants at 1, 2, 4, 8, and 13 week
        horizons. Calculated using matrix exponentiation (raising the transition matrix to the
        power of N weeks). Over longer horizons, probabilities tend to converge toward the
        long-run equilibrium distribution as mean-reversion takes effect.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Markov Chain Transition Bars</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Horizontal bar chart showing 1-week transition probabilities from the current quadrant.
        The "Stay in Q{'{n}'}'" bar shows persistence probability. Other bars show the chance of
        transitioning to each alternative regime. The highest non-self transition is flagged as
        "Primary Risk" if above 25%.
      </p>

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Interpretation Card</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A narrative summary that puts the numbers in context:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Regime Change indicator</strong> — GREEN (stable, high self-transition), YELLOW (moderate risk), or RED (regime shift likely).</li>
        <li><strong>Growth/Inflation trends</strong> — Direction and 4-week rate of change for each factor.</li>
        <li><strong>Primary Risk</strong> — The most likely alternative quadrant and its weekly probability.</li>
        <li><strong>Likely Direction of Change</strong> — A paragraph explaining what FRED data suggests about where conditions are heading, including specific Z-scores and their implications.</li>
      </ul>

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Asset Class Performance Table</h4>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Controls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Scenario</strong> — Bullish (+5% annual div growth, +8% price drift), Neutral (flat), or Bearish (-20% div cut, -20% price decline). Bearish uses aggressive rates to realistically model income decline even with DRIP compounding.</li>
        <li><strong>Timeframe</strong> — 1 to 20 years. Preset buttons or custom input.</li>
        <li><strong>Monthly Investment</strong> — Additional dollars invested each month, allocated proportionally across holdings. Increases share count and future income.</li>
        <li><strong>Reinvest All / DRIP toggle</strong> — Toggle DRIP on or off for all holdings at once, or use the per-holding checkboxes in the holdings table below. When DRIP is on, dividends are reinvested to buy more shares, compounding income over time.</li>
        <li><strong>Deterministic / Monte Carlo toggle</strong> — Choose a single fixed base case or a 300-path range of possible outcomes.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Projection Methods</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Deterministic</strong> — Runs one fixed projection using the selected scenario's dividend growth and price drift. The same inputs produce the same result, so it is best for a clean base case.</li>
        <li><strong>Monte Carlo (300 paths)</strong> — Runs 300 randomized paths around the selected scenario. Dividend changes and price changes vary month to month, then the chart displays the median path with a 10th-to-90th percentile band.</li>
        <li><strong>P10 / P90</strong> — These columns appear in Monte Carlo mode. P10 is the lower 10th-percentile outcome and P90 is the upper 90th-percentile outcome for that month or year.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>DRIP and Partial Shares</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When viewing the Owner (aggregate) portfolio, DRIP reinvestment calculations use only the shares from
        sub-accounts that have DRIP enabled for each ticker — not the full aggregate share count. For example,
        if you hold 500 shares of QQQI across four accounts but only one account (86 shares) has DRIP on,
        the simulation reinvests dividends on those 86 shares only. This matches the real-world behavior where
        DRIP is configured per brokerage account. Use the <strong>DRIP Matrix</strong> on the Holdings page
        to see and control which accounts have DRIP enabled for each ticker.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Display</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Timeframe &le; 5 years</strong> — Monthly view: line chart and table showing month-by-month income with year subtotals. Income is smoothed evenly across months rather than spiking in pay months.</li>
        <li><strong>Timeframe &gt; 5 years</strong> — Annual view: bar chart and table showing year-over-year income changes.</li>
        <li><strong>Change columns</strong> — Green for income increases, red for decreases. Shows both dollar and percentage change.</li>
        <li><strong>Monte Carlo columns</strong> — P10 (pessimistic 10th percentile) and P90 (optimistic 90th percentile) appear when Monte Carlo is enabled.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Holdings Breakdown</h3>
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
        Retirement Readiness compares your current portfolio income against monthly living expenses and a
        Monthly Expense Protection Buffer (MEPB). It starts from the currently selected portfolio, applies stress
        assumptions, then projects how surplus reinvestment can change the income path over time.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Core Inputs</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Monthly Expenses</strong> - how much cash you need every month to live on. This is the baseline income target.</li>
        <li><strong>MEPB Ratio</strong> - your Monthly Expense Protection Buffer safety multiplier. If expenses are $4,500 and MEPB is 3, the model wants stressed portfolio income of $13,500 per month.</li>
        <li><strong>Reinvest Surplus</strong> - the percent of income above monthly expenses that gets reinvested. If income is $6,000, expenses are $4,500, and this is 100%, the extra $1,500 is reinvested.</li>
        <li><strong>Cash Reserve</strong> - cash you already have set aside outside the portfolio for shortfalls or emergencies.</li>
        <li><strong>Cash Target Months</strong> - how many months of expenses you want in reserve. If expenses are $4,500 and this is 6, the target reserve is $27,000.</li>
        <li><strong>Years</strong> - how far forward the model projects income, expenses, surplus reinvestment, and cash reserve.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Stress Inputs</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Expense Inflation %</strong> - annual rate at which monthly expenses increase over time.</li>
        <li><strong>Income Growth %</strong> - annual growth or decline assumption for portfolio income after the initial stress cuts.</li>
        <li><strong>Dividend Cut %</strong> - immediate stress cut to current income. If current income is $8,000 per month and this is 20%, stressed income starts at $6,400 per month.</li>
        <li><strong>Income Haircut %</strong> - an extra safety discount after the dividend cut, useful for volatile funds where distributions may vary month to month.</li>
        <li><strong>Price Drawdown %</strong> - stress reduction to portfolio value. It mainly affects the assumed yield of reinvested surplus during the stressed period.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Readiness badge</strong> - Covered, Ready, Close, Building, or Risky based on stressed income, buffer target, cash runway, and whether non-investment inflows already cover expenses.</li>
        <li><strong>Bear Buffer Ratio</strong> - bear-market after-tax income divided by the expenses the portfolio must pay.</li>
        <li><strong>Buffer Gap</strong> - additional stressed monthly income needed to reach the selected MEPB target.</li>
        <li><strong>Passive Income - MEPB Trend Lines</strong> - compares total expenses, expenses after non-investment inflows, good-market income, bear-market income, and the MEPB target.</li>
        <li><strong>Monthly MEPB Projection Table</strong> - month-by-month good and bear market projections with yearly totals.</li>
      </ul>
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

      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/dividend-calculator/Screenshot 2026-05-09 102110.jpg" alt="Dividend Calculator projections interface" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Calculation Settings</h3>
      <p style={{ marginBottom: '0.5rem' }}>
        Set your global assumptions once at the top of the page. These apply to every ticker you add and can be
        adjusted at any time — the projection updates when you click <strong>Recalculate</strong>.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Years to Invest</strong> — Length of the projection (1–50 years).</li>
        <li><strong>Initial Investment Per Ticker</strong> — Starting dollar amount applied to each ticker. Updating this value re-derives the share count for any already-loaded tickers.</li>
        <li><strong>Annual Investment (split equally)</strong> — Total dollars added each year, divided evenly across all loaded tickers and contributed at the end of each compounding period.</li>
        <li><strong>Dividend Tax Rate</strong> — Applied to taxable dividends each period. The Return of Capital % on each ticker reduces the taxable portion.</li>
        <li><strong>Stock Price Growth (All Tickers)</strong> — Default annual price appreciation applied to every ticker. You can override this per ticker after it loads.</li>
        <li><strong>Dividends Reinvested (DRIP)</strong> — Percentage of net dividends reinvested each period (0–100%). Anything not reinvested is tracked as cash dividends.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Adding Tickers</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Type a symbol (e.g. <code>SCHD</code>, <code>JEPI</code>, <code>AAPL</code>) into the ticker bar and click
        <strong> Add Ticker</strong>. The app fetches current price, dividend yield, dividend growth rate, and
        payout frequency from Yahoo Finance, then auto-fills the row. Add as many tickers as you like — the
        annual contribution is split equally across them and final results are aggregated.
      </p>
      <p style={{ marginBottom: '0.75rem' }}>
        Each ticker becomes its own card with editable fields. Click the <strong>x</strong> on a chip or the
        <strong> Remove</strong> button on the card to drop a ticker. <strong>Reset</strong> clears everything
        back to defaults.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Per-Ticker Inputs</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Initial Investment / Stock Price / Number of Shares</strong> — These three fields stay in sync. Editing any one of them recomputes the others. Override the share count or price if you want to model a position different from the live market.</li>
        <li><strong>Initial Dividend Yield</strong> — Annual yield based on the trailing distribution. Drives the first-year income.</li>
        <li><strong>Dividend Growth</strong> — Annual percentage increase applied to the dividend per share each year. Auto-filled from Yahoo's historical growth rate; override based on your own expectations.</li>
        <li><strong>Return of Capital</strong> — Percentage of distributions that aren't taxable income (common for covered-call ETFs and some MLPs). Reduces the dividend tax drag without affecting cash flow.</li>
        <li><strong>Stock Price Growth</strong> — Per-ticker price appreciation. Defaults to the global setting but can be tuned individually.</li>
        <li><strong>Payout Frequency</strong> — Weekly, Monthly, Quarterly, Semi-Annually, or Annually. Higher frequencies compound faster when DRIP is on.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Running the Calculation</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Click <strong>Calculate</strong> to project results. Whenever inputs change after a calculation, a
        <strong> Needs recalculation</strong> badge appears next to the settings card and a banner above the
        results — click <strong>Recalculate</strong> to refresh. Inputs are stored locally in the page; nothing
        is saved to the database.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Results</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Summary Stats</strong> — Ending Wealth (final portfolio value plus uncollected cash dividends), Annual / Monthly Dividend Income at the final year, Yield on Cost, and total Estimated Dividend Taxes after Return of Capital adjustments.</li>
        <li><strong>Portfolio &amp; Income Chart</strong> — Combined view of portfolio value (filled area), cumulative dividends, and annual income on a secondary axis.</li>
        <li><strong>Shares Over Time</strong> — One line per ticker when multiple are loaded, or a single line for one ticker. Shows how DRIP grows your share count year by year.</li>
        <li><strong>Year-by-Year Breakdown</strong> — Detailed table with shares, portfolio value, gross/net dividends, taxes, reinvested vs. cash dividends, and cumulative contributions per year.</li>
        <li><strong>Per-Ticker Final Values</strong> — When two or more tickers are loaded, an additional table compares each ticker's final shares, portfolio value, income, taxes, and dividends. Useful for picking between candidates.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How DRIP Compounds</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each period the model: (1) pays the gross dividend on current shares, (2) subtracts taxes on the taxable
        portion (gross x (1 - ROC%) x tax rate), (3) splits the net dividend between reinvested and cash based
        on the DRIP %, (4) adds that period's annual-contribution slice, (5) buys new shares with the combined
        cash at the current price, and (6) grows the price and dividend per share to the next period. Higher
        payout frequencies, higher dividend growth, and lower taxes all amplify long-run compounding.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tips</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li>Use the per-ticker comparison table to evaluate two or more funds with similar yields but different growth or ROC profiles.</li>
        <li>Set DRIP to 0% to model income-now scenarios (retirement) and 100% to model accumulation phases.</li>
        <li>Bump the Dividend Tax Rate to 0% to preview tax-advantaged accounts (IRA, Roth, HSA) and back to your marginal rate for taxable accounts.</li>
        <li>For high-yield covered-call ETFs (JEPI, JEPQ, QQQI, SPYI, etc.), check the fund's distribution classification — many report a meaningful ROC %, which substantially lowers the projected tax drag.</li>
      </ul>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Select a provider from the dropdown (e.g. YieldMax, NEOS, Global X).</li>
        <li>Review the current summary cards showing provider name, fund count, total assets, and average expense ratio.</li>
        <li>Click <strong>Update Provider</strong> to fetch the latest data. A confirmation message shows how many funds were updated or inserted.</li>
      </ul>

      <p style={{ marginBottom: '0.75rem' }}>
        Updated provider data is used by the ETF Comparer and Security Research pages for expected yield calculations
        and distribution source attribution.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Examples</h3>
      <p style={{ marginBottom: '1rem' }}>
        Here are some examples of the ETF Provider Update screen with different ETF providers:
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <p style={{ fontSize: '0.9rem', color: '#90a4ae', marginBottom: '0.5rem', fontStyle: 'italic' }}>BlackRock provider showing 484 funds with $4.3T in assets</p>
        <img src="/help-screenshots/etf-provider-update/blackrock-example.jpg" alt="ETF Provider Update example showing BlackRock provider with fund metrics" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <p style={{ fontSize: '0.9rem', color: '#90a4ae', marginBottom: '0.5rem', fontStyle: 'italic' }}>State Street provider showing 183 funds with $1.8T in assets</p>
        <img src="/help-screenshots/etf-provider-update/state-street-example.jpg" alt="ETF Provider Update example showing State Street provider with fund metrics" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <p style={{ fontSize: '0.9rem', color: '#90a4ae', marginBottom: '0.5rem', fontStyle: 'italic' }}>Invesco provider showing 238 funds with $871B in assets</p>
        <img src="/help-screenshots/etf-provider-update/invesco-example.jpg" alt="ETF Provider Update example showing Invesco provider with fund metrics" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
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
        <img src="/help-screenshots/tax-report/tax-report-summary-form-previews.jpg" alt="Annual Tax Report summary cards and Form 1099-DIV and Form 8949 previews" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
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
        <img src="/help-screenshots/tax-report/tax-report-dividends-overrides.jpg" alt="Annual Tax Report Dividends tab with per-ticker tax treatment overrides" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <p><strong>Realized Lots</strong></p>
      <p style={{ marginBottom: '1rem' }}>
        One row per closed lot with: Ticker, Sell Date, Buy Date (shown as <em>unmatched</em> if
        no BUY was found), Shares, Buy Price, Sell Price, Cost, Proceeds, Gain/Loss (colored
        green/red), holding Days, and Term badge (Long-Term or Short-Term).
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/help-screenshots/tax-report/tax-report-realized-lots.jpg" alt="Annual Tax Report Realized Lots tab with closed tax lots and gain or loss detail" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
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
        <img src="/help-screenshots/etf-comparer/return-chart.jpg" alt="ETF Comparer return chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Adding Tickers</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Type one or more ETF tickers (comma- or space-separated) in the input field and press <strong>Add</strong> or Enter.</li>
        <li>Each ticker appears as a chip below the input. Click the × on a chip to remove it.</li>
        <li>Up to seven tickers can be loaded simultaneously.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Return Chart</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Period</strong> — 1M, 3M, 6M, YTD, 1Y, 2Y, 5Y, 10Y, or MAX.</li>
        <li><strong>Return Mode</strong> — choose Total Return (price + reinvested dividends), Price Only, Price + Dividends (cash), Both (total and price), All Three, or All Four traces per ticker.</li>
        <li><strong>Reinvestment %</strong> — adjustable slider from 0% (all dividends taken as cash) to 100% (all dividends reinvested). Only applies to the blended trace in applicable modes.</li>
        <li><strong>% / Index toggle</strong> — show returns as a percentage gain/loss from period start, or as an indexed value starting at 100.</li>
        <li><strong>Labels</strong> — toggle end-of-period return labels on the chart.</li>
        <li><strong>Range slider</strong> — drag to zoom into a specific date range within the selected period.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Distribution History</h3>
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
        <em>Annual</em> multiplies the per-period yield by 12 to approximate an annualized rate, making monthly
        and less-frequent payers directly comparable. Switching back to <strong>$ Amount</strong> mode
        resets the toggle to Monthly automatically.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/etf-comparer/distribution-history.jpg" alt="ETF Comparer distribution history chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Comparison Table</h3>
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
        <img src="/help-screenshots/etf-comparer/comparison-table.jpg" alt="ETF Comparer comparison table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Average Return Bar Chart</h3>
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
        <img src="/help-screenshots/etf-comparer/average-returns.jpg" alt="ETF Comparer average return bar chart and multi-period table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Multi-Period Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        A tabular summary shows the same available average-return windows for each ticker. Blank cells mean that ticker
        does not have enough history or aligned data for that period.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>When to Use It</h3>
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
        <img src="/help-screenshots/stock-comparer/return-chart.jpg" alt="Stock Comparer return chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Adding Tickers</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Type one or more stock tickers (comma- or space-separated) and press <strong>Add</strong> or Enter.</li>
        <li>Each ticker appears as a colored chip. Click × to remove it.</li>
        <li>Up to seven tickers can be compared simultaneously.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Return Chart</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Identical controls to ETF Comparer: period selector (1M–MAX), return mode (Total Return, Price Only, Price + Divs, Both, All Three, All Four),
        reinvestment % slider, % / index toggle, end labels, and a date range slider.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/stock-comparer/distribution-history.jpg" alt="Stock Comparer distribution history chart" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Comparison Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Symbol and Company Name are always visible. Optional columns include stock-specific fields not available for ETFs:
        market cap, forward PE, PEG ratio, dividend growth rate, and EPS (TTM), in addition to the common fields
        (price, daily % change, PE ratio, dividend yield, volume, dollar volume, open, 1Y CAGR, beta, payout ratio,
        debt/equity, 52-week high/low, sector, industry, max drawdown, revenue, profit margin).
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/stock-comparer/comparison-table.jpg" alt="Stock Comparer comparison table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Average Return Bar Chart &amp; Multi-Period Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Same as ETF Comparer — grouped bar chart of 1Y/3Y/5Y/10Y annualized returns and a tabular multi-period summary.
      </p>
      <div style={{ marginBottom: '1.5rem' }}>
        <img src="/help-screenshots/stock-comparer/average-returns.jpg" alt="Stock Comparer average return bar chart and multi-period table" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Distribution History</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Key Fundamentals Cards</h3>
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
        <img src="/help-screenshots/rebalance-wizard/Screenshot 2026-05-09 122956.jpg" alt="Rebalance Wizard trade plan" style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }} />
      </div>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Settings</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Plan Summary Cards</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Trade List</h3>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Category Candidates</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        The <strong>Candidates</strong> section lets you set preferred tickers per category.
        Preferred tickers are ranked first when the optimizer picks buy candidates for that category.
        Drag candidates up or down to set priority order, then click <strong>Save Preferences</strong> to persist them and regenerate the plan.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Saving and Loading Plans</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li>Give the plan a name and click <strong>Save Plan</strong> to persist it to the database.</li>
        <li>Previously saved plans appear in the <strong>Saved Plans</strong> dropdown with projected income and status.</li>
        <li>Select a plan and click <strong>Load</strong> to restore all settings, trades, and execution state.</li>
        <li>Click <strong>Update Plan</strong> to overwrite the currently selected saved plan.</li>
        <li>Click <strong>Delete</strong> to remove the selected saved plan.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Exports</h3>
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
          src="/help-screenshots/Tax-loss/tax-loss-harvest-overview.jpg"
          alt="Tax-Loss Harvest page showing summary cards and candidate table with wash-sale status badges"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }}
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
        <li><strong>Wash</strong> — <span style={{ color: '#4dff91' }}>Clear</span> means no conflicting buy in the last 30 days; <span style={{ color: '#ff6b6b' }}>Wash sale → date</span> means a buy of the same ticker occurred within the window and the harvest is blocked until that date.</li>
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

      <h4 style={{ marginBottom: '0.5rem' }}>Step 3: Configure Each Fund</h4>
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
          src="/help-screenshots/blended-yield/01-portfolio-setup.jpg"
          alt="Blended Yield Calculator tax profile and fund cards"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }}
        />
      </div>

      <h4 style={{ marginBottom: '0.5rem' }}>Step 4: Review Portfolio Summary</h4>
      <p style={{ marginBottom: '1rem' }}>
        The <strong>Portfolio Summary</strong> shows your blended yield (TEY), after-tax yield, annual and monthly income.
        A color-coded allocation bar shows fund weights. A detailed breakdown table lists every fund with yields,
        tax rates, allocations, and income contributions.
      </p>

      <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img
          src="/help-screenshots/blended-yield/02-portfolio-summary.jpg"
          alt="Portfolio Summary results, allocation bar, and breakdown table"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }}
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
          src="/help-screenshots/blended-yield/03-tax-bracket-settings.jpg"
          alt="Tax Bracket Settings editor with editable Federal, LTCG, California, Arizona, and Pennsylvania brackets"
          style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #333' }}
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
        <li><strong>Save Custom Brackets Once:</strong> If rates change, edit and save custom brackets once. They persist until you click Restore 2025 Defaults.</li>
        <li><strong>Manual Fund Lookup:</strong> If a ticker doesn't auto-populate, search your broker for the current yield and enter it manually. It saves with a blue ★ badge for next time.</li>
      </ul>
    </div>
  )
}

const CONTENT_MAP = {
  overview: Overview,
  'action-center': ActionCenterHelp,
  import: ImportHelp,
  export: ExportHelp,
  'etf-provider-update': ETFProviderUpdateHelp,
  portfolios: PortfoliosHelp,
  settings: SettingsHelp,
  'tax-report': AnnualTaxReportHelp,
  'tax-loss': TaxLossHarvestHelp,
  'blended-yield': BlendedYieldHelp,
  dashboard: DashboardHelp,
  holdings: HoldingsHelp,
  categories: CategoriesHelp,
  growth: GrowthHelp,
  'growth-2': PortfolioGrowth2Help,
  dividends: DividendsHelp,
  'div-calendar': DivCalendarHelp,
  'earnings-calendar': EarningsCalendarHelp,
  'div-compare': DivCompareHelp,
  'dividend-history': DividendHistoryHelp,
  'total-return': TotalReturnHelp,
  'gains-losses': GainsLossesHelp,
  'safe-withdrawal': SafeWithdrawalHelp,
  'dividend-calculator': DividendCalculatorHelp,
  'general-scanner': GeneralScannerHelp,
  'security-research': SecurityResearchHelp,
  'etf-screen': ETFScreenHelp,
  'etf-comparer': ETFComparerHelp,
  'stock-comparer': StockComparerHelp,
  watchlist: WatchlistHelp,
  'buy-sell': BuySellHelp,
  'nav-erosion': NavErosionHelp,
  'nav-screener': NavScreenerHelp,
  'single-strategy': SingleStrategyHelp,
  'income-sim': IncomeSimHelp,
  correlation: CorrelationHelp,
  analytics: AnalyticsHelp,
  'portfolio-builder': PortfolioBuilderHelp,
  'portfolio-tester': PortfolioTesterHelp,
  'dist-compare': DistCompareHelp,
  consolidation: ConsolidationHelp,
  'macro-dashboard': MacroDashboardHelp,
  'income-growth': IncomeGrowthHelp,
  'retirement-readiness': RetirementReadinessHelp,
  'rebalance-wizard': RebalanceWizardHelp,
}

export default function Help() {
  const [activeGroup, setActiveGroup] = useState('overview')
  const [activeSection, setActiveSection] = useState('overview')

  const handleGroupClick = (group) => {
    setActiveGroup(group.id)
    setActiveSection(group.sections[0].id)
  }

  const currentGroup = GROUPS.find(g => g.id === activeGroup)
  const ContentComponent = CONTENT_MAP[activeSection] || null

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1>Help</h1>
        <span style={{ color: '#90a4ae', fontSize: '0.85rem' }}>Version {APP_VERSION}</span>
      </div>

      {/* Group selector */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', borderBottom: '2px solid #0f3460', paddingBottom: '0.75rem' }}>
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
              background: activeGroup === g.id ? '#1976d2' : '#0f3460',
              color: activeGroup === g.id ? '#fff' : '#90a4ae',
              transition: 'background 0.15s',
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Sub-tabs (hidden when group has only one section) */}
      {currentGroup && currentGroup.sections.length > 1 && (
        <div className="tabs" style={{ marginBottom: '1.5rem' }}>
          {currentGroup.sections.map(s => (
            <button
              key={s.id}
              className={`tab ${activeSection === s.id ? 'active' : ''}`}
              onClick={() => setActiveSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="card" style={{ lineHeight: '1.7' }}>
        {ContentComponent && <ContentComponent />}
      </div>
    </div>
  )
}

