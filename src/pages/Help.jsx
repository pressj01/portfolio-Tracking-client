import React, { useState } from 'react'

const APP_VERSION = '1.18.0'

const GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    sections: [
      { id: 'overview', label: 'Overview' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    sections: [
      { id: 'import', label: 'Import' },
      { id: 'export', label: 'Export' },
      { id: 'portfolios', label: 'Portfolios' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    sections: [
      { id: 'holdings', label: 'Holdings' },
      { id: 'categories', label: 'Categories' },
      { id: 'growth', label: 'Growth' },
      { id: 'dividends', label: 'Dividends' },
      { id: 'div-calendar', label: 'Div Calendar' },
      { id: 'div-compare', label: 'Div Compare' },
      { id: 'total-return', label: 'Total Return' },
    ],
  },
  {
    id: 'analysis',
    label: 'Analysis',
    sections: [
      { id: 'etf-screen', label: 'ETF/Stock Screen' },
      { id: 'watchlist', label: 'Watchlist' },
      { id: 'buy-sell', label: 'Buy/Sell Signals' },
      { id: 'nav-erosion', label: 'NAV Erosion' },
      { id: 'nav-screener', label: 'NAV Screener' },
      { id: 'income-sim', label: 'Income Sim' },
      { id: 'correlation', label: 'Correlation' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'portfolio-builder', label: 'Portfolio Builder' },
      { id: 'dist-compare', label: 'Dist Compare' },
      { id: 'consolidation', label: 'Consolidation' },
      { id: 'macro-dashboard', label: 'Macro Dashboard' },
      { id: 'income-growth', label: 'Income Growth' },
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
      </p>
      <h3 style={{ marginBottom: '0.5rem' }}>Key Capabilities</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
        <li><strong>Import</strong> — Bulk-load holdings from your own Excel spreadsheet or a generic template. Supports merge mode so you can re-import without losing app-only data.</li>
        <li><strong>Holdings</strong> — Add, edit, and delete positions manually or through transaction lots (BUY/SELL). Tracks cost basis, gain/loss, dividend yields, DRIP reinvestment, and more.</li>
        <li><strong>Dashboard</strong> — At-a-glance summary of portfolio value, income, and allocation.</li>
        <li><strong>Dividends</strong> — Dividend analysis, calendar view, and comparison tools.</li>
        <li><strong>Analysis</strong> — ETF screening, NAV erosion analysis, correlation matrix, income simulation, buy/sell signals, portfolio builder, consolidation analysis, and macro regime dashboard.</li>
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
        The Import page lets you bulk-load holdings into a portfolio from an Excel file. There are two import modes,
        each on its own tab: <strong>My Spreadsheet</strong> (owner format) and <strong>Generic Upload</strong>.
        Both support merge mode — if the portfolio already has data, existing tickers are updated and new tickers are added,
        while app-only fields (like DRIP toggles or pay dates you edited manually) are preserved unless the spreadsheet provides them.
      </p>

      {/* ── My Spreadsheet ──────────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tab 1: My Spreadsheet (Owner Format)</h3>
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
      <p style={{ marginBottom: '0.75rem' }}>
        This mode accepts any Excel file with at minimum a <strong>Ticker</strong> and <strong>Shares</strong> column.
        Missing data (prices, dividends, descriptions) is automatically enriched from Yahoo Finance.
        A downloadable template with all 32 supported columns and up to 12 portfolio tabs is available.
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
          <strong>(Optional) Download the template</strong> — click "Download Template" to get a pre-formatted .xlsx
          with all supported column headers. Fill in at least the Ticker and Shares columns. Optional columns include:
          Price Paid, Current Price, Dividend, Frequency, Ex-Div Date, Pay Date, DRIP, Category, Purchase Date,
          Dividends Paid, YTD Divs, Total Divs Received, and more.
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
      </ul>
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

      {/* ── Table Overview ──────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Table Overview</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Sorting</strong> — Click any column header to sort ascending/descending. An arrow indicates the active sort.</li>
        <li><strong>Frozen columns</strong> — Ticker, Description, Category, and Shares stay visible as you scroll horizontally.</li>
        <li><strong>DRIP checkbox</strong> — Toggle dividend reinvestment directly in the table without opening the edit form.</li>
        <li><strong>Expand transactions</strong> — Click the small arrow (&#9654;) next to a ticker to expand and see its transaction lots inline.</li>
      </ul>

      {/* ── Toolbar Buttons ─────────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Toolbar Buttons</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Refresh Prices & Divs</strong> — Fetches the latest prices, dividend amounts, and ex-div dates from Yahoo Finance for all holdings.</li>
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
        <li><strong>+ Add Holding</strong> — Opens the Add/Edit form to create a new position directly (no transaction).</li>
        <li><strong>+ Add/Edit via Transaction</strong> — Opens the Transaction modal to add a brand-new ticker by recording a BUY transaction.</li>
      </ul>

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

      <h4 style={{ marginBottom: '0.4rem' }}>With Transactions</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        If the ticker has transaction lots, the Position fields (Shares, Price Paid, Purchase Date) are grayed out
        and show a blue info banner: <em>"Shares, Price Paid, and Purchase Date are managed by transactions.
        Use the Txn button to add or edit lots."</em> All other fields (Dividend info, Category, DRIP, tracking fields) remain editable.
      </p>

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
        <li>Click "Add via Transaction". The position recalculates (shares decrease). A realized gain/loss is calculated using FIFO cost basis.</li>
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
          the total allocated dollar value and percentage, and total portfolio value.
          Below the numbers is a colored <strong>allocation bar</strong> that visualizes each category's
          share of the portfolio. Hovering over a segment shows the category name and percentage.
          Any unallocated value appears as a gray segment labeled "Unallocated".
        </li>
        <li>
          <strong>Category Cards (left panel)</strong> — One card per category showing the category name,
          number of tickers, actual allocation percentage, dollar value, and a small progress bar.
          Cards are expandable to show the individual tickers inside.
        </li>
        <li>
          <strong>Unallocated Assets (right panel, sticky)</strong> — Lists all tickers that haven't been
          assigned to any category. These are shown as clickable pill-shaped buttons. This panel stays
          visible as you scroll through categories.
        </li>
      </ul>

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
          highlight with a blue border. Use "Select all" or "Clear" links at the top of the panel for convenience.
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

      {/* ── Expanded Category View ────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Expanded Category Details</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When you expand a category card, you see a table listing each ticker in that category with:
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The stock/ETF symbol.</li>
        <li><strong>Description</strong> — The holding's name.</li>
        <li><strong>Value</strong> — Current market value of that position.</li>
        <li><strong>% of Category</strong> — What percentage of the category's total value this ticker represents.</li>
        <li><strong>&times;</strong> — Unassign button to remove the ticker from this category.</li>
      </ul>
      <p>
        If the category is empty, a hint message appears: <em>"Click a ticker on the right to assign it here"</em>,
        directing you to the Unallocated Assets panel.
      </p>

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
        <li><strong>Div Paid</strong> — Last dividend amount paid per share.</li>
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
        The Dividend Calendar shows every ex-dividend and pay date for your portfolio holdings
        in a scrollable card-based timeline. It lets you see at a glance which dividends are coming up,
        when you'll receive payment, how much you'll earn per share, and which payments have already
        been made this week or month. This is useful for planning reinvestments and tracking your
        expected income day by day.
      </p>

      {/* ── What the Page Shows ─────────────────────────────── */}
      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>What the Page Shows</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each holding with an ex-dividend date appears as a card in a grid layout. The cards are sorted
        chronologically by ex-dividend date. Each card contains:
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
          <strong>If no events appear</strong>, ensure your holdings have ex-dividend dates populated.
          Run "Refresh Prices &amp; Divs" on the Holdings page or re-import your data to pull the
          latest dates from Yahoo Finance.
        </li>
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
        It also shows dividend sustainability metrics (coverage ratio and NAV erosion probability),
        making it especially useful for evaluating high-yield income funds before adding them to your portfolio.
      </p>

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
        <li><strong>Coverage</strong> — TTM coverage ratio: distributions divided by net investment income. Above 1.0 means the fund is earning enough to cover its payouts sustainably.</li>
        <li><strong>Cov Signal</strong> — BUY if coverage &gt; 1.0, SELL if &lt; 1.0, NEUTRAL if equal.</li>
        <li><strong>NAV Erosion</strong> — Probability label: <span style={{ color: '#81c784' }}>Low</span>, <span style={{ color: '#ffc107' }}>Medium</span>, or <span style={{ color: '#ef9a9a' }}>High</span>. Indicates risk that the fund's share price is being slowly eroded by distributions that exceed earnings.</li>
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
        <li><strong>Coverage</strong> — TTM distribution coverage ratio.</li>
        <li><strong>Cov Signal</strong> — BUY/SELL/NEUTRAL from coverage.</li>
        <li><strong>NAV Erosion</strong> — Low/Medium/High probability.</li>
        <li><strong>Portfolio $</strong> — Market value of this position (blank for watchlist tickers).</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li><strong>Scan the treemap</strong> for a quick visual — are most large positions green or red?</li>
        <li><strong>Check summary badges</strong> to see the overall signal balance across your portfolio.</li>
        <li><strong>Sort the table by "Overall"</strong> to group all SELL signals together and review them.</li>
        <li><strong>Sort by "NAV Erosion"</strong> to surface high-risk income funds that may be eroding your capital.</li>
        <li><strong>Sort by "Coverage"</strong> to see which funds are paying out more than they earn (coverage &lt; 1.0).</li>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>What is NAV Erosion?</h3>
      <p style={{ marginBottom: '1rem' }}>
        NAV (Net Asset Value) erosion occurs when a fund's share price falls faster than its
        distributions can compensate for. A fund paying a 15% annual distribution yield but losing
        20% of its price per year is eroding your principal. The coverage ratio measures this:
        a ratio above 1.0 means the fund earns enough to cover its payouts; below 1.0 means
        it's paying out of capital.
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Inputs</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker</strong> — The ETF or fund to analyze (e.g., JEPI, XYLD, QYLD).</li>
        <li><strong>Initial Investment</strong> — Dollar amount to start with (default $10,000).</li>
        <li><strong>Start / End Date</strong> — The historical backtest window.</li>
        <li><strong>Reinvestment %</strong> — Drag the slider or type a number (0–100%). At 0%, all distributions are taken as cash. At 100%, all distributions buy more shares (full DRIP). Use values between to simulate partial reinvestment.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Summary Statistics</h3>
      <p style={{ marginBottom: '0.75rem' }}>After running the backtest, a strip of metric tiles shows:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Total Distributions</strong> — All cash paid out over the period.</li>
        <li><strong>Shares Purchased</strong> — Shares bought via DRIP reinvestment.</li>
        <li><strong>Total Reinvested</strong> — Dollar amount reinvested.</li>
        <li><strong>Final Portfolio Value</strong> — Ending value of all shares held.</li>
        <li><strong>Price Change %</strong> — How much the share price moved over the period.</li>
        <li><strong>NAV Erosion</strong> — Yes or No verdict.</li>
        <li><strong>Final Shares Deficit/Surplus</strong> — Whether you ended up with more or fewer shares than needed to match your original investment at current prices.</li>
        <li><strong>Coverage Ratio</strong> — Weighted average with a probability assessment: High / Borderline / Low erosion risk.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Charts</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Main Line Chart</strong> — Shows share price (blue), portfolio value (green), and a dashed gray break-even threshold over time. If the green line stays above the dashed line, your investment is holding its own.</li>
        <li><strong>Coverage Ratio Chart</strong> — Monthly coverage ratio plotted over time with color-coded markers: red below 0.8, orange below 1.0, green at or above 1.0. Watch for sustained red periods.</li>
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
        <li><strong>Shares Deficit</strong> — Break-even minus total shares. <span style={{ color: '#ef9a9a' }}>Red = you need more shares</span>; <span style={{ color: '#81c784' }}>green = you have surplus</span>.</li>
        <li><strong>Coverage</strong> — That month's coverage ratio, color-coded.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>How to Use</h3>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Enter a high-yield ticker (QYLD, XYLD, JEPI, SVOL, etc.) and set your investment amount.</li>
        <li>Start with a wide date range (e.g., 2018–present) to capture a full market cycle.</li>
        <li>Run at <strong>0% reinvestment</strong> first — this shows worst-case NAV erosion with no DRIP offsetting it.</li>
        <li>Then run at <strong>100%</strong> — this shows whether full DRIP can overcome price decay.</li>
        <li>Find the reinvestment percentage where the Shares Deficit turns positive — that's the break-even DRIP rate for this fund.</li>
        <li>Check the coverage chart: consistent red months mean the fund is paying out of capital, not earnings.</li>
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
        <li>Portfolio Coverage (dollar-weighted average across all funds)</li>
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
        <li><strong>Shares Deficit</strong> — Positive = erosion winning, negative = surplus.</li>
        <li><strong>Coverage</strong> — Weighted coverage ratio, color-coded.</li>
        <li><strong>Note</strong> — Any data warnings for that ticker.</li>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Simulation Modes</h3>

      <h4 style={{ marginBottom: '0.4rem' }}>Historical Mode</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Uses actual historical dividend and price data to project how your holdings would have
        grown over the selected horizon. Set start and end dates, then run. Results show year-by-year
        income growth including the compounding effect of DRIP and monthly contributions.
      </p>

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

      <h4 style={{ marginBottom: '0.4rem' }}>Comparison Mode</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        Toggle <strong>Compare Tickers</strong> to enable side-by-side analysis. Add tickers
        with individual investment amounts and reinvestment percentages. Run to see a multi-line
        chart comparing projected income growth and cumulative value across all tickers.
        Use this to decide between alternative income ETFs or strategies.
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
        <li><strong>Coverage Ratio</strong> — Colored display of NAV erosion probability for the portfolio.</li>
        <li><strong>Coverage Bar Chart</strong> — Per-ticker coverage ratios with a 1.0 sustainability line. Tickers below the line are paying out more than they earn.</li>
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
        <li><strong>Coverage Ratio</strong> — TTM distribution sustainability.</li>
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
        grade card, coverage ratio, per-ticker metrics table, and chart tabs (Risk & Returns,
        Income & Allocation, Backtesting, Tools).
      </p>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Holdings Table Columns</h3>
      <p style={{ marginBottom: '0.75rem' }}>After analysis runs, the holdings table expands with metrics:</p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '1rem' }}>
        <li><strong>Ticker, Grade, Score, Weight %, Current Price, Shares, Dollar Amount</strong></li>
        <li><strong>Ulcer Index, Sharpe, Sortino, Calmar, Omega</strong> — Risk metrics</li>
        <li><strong>Max Drawdown, Annual Return, Total Return, Annual Volatility, Coverage Ratio</strong></li>
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
        The exported format matches the Generic Upload template, so you can use the file as a backup
        or reimport it into any portfolio later.
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
          The file downloads automatically. A green success message confirms the filename.
        </li>
      </ol>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Aggregate Mode</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        When the <strong>Aggregate</strong> portfolio is selected, the Excel export creates one sheet per
        sub-portfolio. To reimport it later, use the <em>Generic Upload</em> tab with
        <strong> "Import all tabs as separate portfolios"</strong> checked.
        The CSV export combines all portfolios into a single flat file.
      </p>

      <div className="alert alert-info" style={{ marginTop: '1rem' }}>
        <strong>Tip:</strong> Export is a great way to back up your data before a major reimport or
        before clearing a portfolio. The Excel file is fully compatible with the Generic Upload importer.
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Portfolio Table</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Each row shows a portfolio's name, holding count, total value, and creation date.
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.9' }}>
        <li><strong>Rename</strong> — click a portfolio name (underlined in blue) to edit it inline. Press Enter or click away to save.</li>
        <li><strong>Select</strong> — switches the active portfolio in the navbar without leaving the page.</li>
        <li><strong>Clear</strong> — removes all holdings and data from the portfolio but keeps the portfolio itself. Useful before a clean reimport.</li>
        <li><strong>Delete</strong> — permanently deletes the portfolio and all its data. The default portfolio (ID 1) cannot be deleted.</li>
        <li><strong>Include checkbox</strong> — marks a portfolio for inclusion in the Owner reconciliation and the aggregate.</li>
        <li><strong>+ New Portfolio</strong> button (top-right) — creates a new empty portfolio with a name you enter.</li>
      </ul>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Aggregate Portfolio</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        An aggregate is a read-only combined view of multiple portfolios. It appears in the navbar dropdown
        when configured. You can use it to see total portfolio values and income across all selected portfolios.
      </p>
      <ol style={{ paddingLeft: '1.5rem', lineHeight: '2' }}>
        <li>Enter a name for the aggregate in the <strong>Aggregate Name</strong> field.</li>
        <li>Check the portfolios you want included.</li>
        <li>Click <strong>"Create Aggregate"</strong> (or "Save Aggregate Config" to update an existing one).</li>
        <li>To remove the aggregate entirely, click <strong>"Delete Aggregate"</strong>.</li>
      </ol>

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Reconcile Owner</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        This feature is available when the Owner-format import has been used. It updates the Owner portfolio
        (profile 1) to match the combined holdings of all portfolios with <strong>Include</strong> checked.
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tab 1: Macro Conditions</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Displays the current macro regime (e.g., Stable Inflation + Stable Rates) along with alert
        badges for notable conditions like Oil Rising or Rising Volatility. Shows sparkline charts
        for key indicators: Inflation Expectations, Oil (WTI), 10-Year Yield, Short-Term Rate, VIX,
        Dollar Index, and Credit Spreads, each with 3-month trend direction and change.
      </p>

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

      <h3 style={{ color: '#64b5f6', marginTop: '2rem', marginBottom: '0.5rem' }}>Tab 3: Rebalancing Tilts</h3>
      <p style={{ marginBottom: '0.75rem' }}>
        Based on current macro conditions, suggests which sensitivity categories to overweight or
        underweight. Provides per-holding action recommendations (increase, hold, reduce, sell)
        to better align your portfolio with the macro environment.
      </p>

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

      <h4 style={{ color: '#90caf9', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Transition Matrix (Heatmap)</h4>
      <p style={{ marginBottom: '0.75rem' }}>
        A 4×4 grid showing the historical probability of moving from one quadrant (row) to another
        (column) in a single week. Read it as: "From this row, there is an X% chance of being in
        this column next week."
      </p>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>▶ arrow</strong> — Marks the row for the current quadrant. This is the row that matters most — it shows where we might go next.</li>
        <li><strong>Numbers in parentheses</strong> — The count of times that specific transition actually occurred in the historical data. Higher counts mean more confidence in that probability.</li>
        <li><strong>Diagonal values</strong> — The "self-transition" or stickiness of each regime. High diagonal values (e.g., 85%) mean regimes tend to persist week-to-week.</li>
        <li>The matrix uses a conditional approach: it filters historical data to weeks with similar momentum conditions and applies mean-reversion adjustments when Z-scores are elevated.</li>
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

      <h3 style={{ color: '#64b5f6', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Controls</h3>
      <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem' }}>
        <li><strong>Scenario</strong> — Bullish (+5% annual div growth, +8% price drift), Neutral (flat), or Bearish (-20% div cut, -20% price decline). Bearish uses aggressive rates to realistically model income decline even with DRIP compounding.</li>
        <li><strong>Timeframe</strong> — 1 to 20 years. Preset buttons or custom input.</li>
        <li><strong>Monthly Investment</strong> — Additional dollars invested each month, allocated proportionally across holdings. Increases share count and future income.</li>
        <li><strong>Reinvest All / DRIP toggle</strong> — Toggle DRIP on or off for all holdings at once, or use the per-holding checkboxes in the holdings table below. When DRIP is on, dividends are reinvested to buy more shares, compounding income over time.</li>
        <li><strong>Deterministic / Monte Carlo toggle</strong> — Deterministic shows a single clean projection line. Monte Carlo runs 300 random paths and shows the median plus 10th/90th percentile range.</li>
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

const CONTENT_MAP = {
  overview: Overview,
  import: ImportHelp,
  export: ExportHelp,
  portfolios: PortfoliosHelp,
  settings: SettingsHelp,
  holdings: HoldingsHelp,
  categories: CategoriesHelp,
  growth: GrowthHelp,
  dividends: DividendsHelp,
  'div-calendar': DivCalendarHelp,
  'div-compare': DivCompareHelp,
  'total-return': TotalReturnHelp,
  'etf-screen': ETFScreenHelp,
  watchlist: WatchlistHelp,
  'buy-sell': BuySellHelp,
  'nav-erosion': NavErosionHelp,
  'nav-screener': NavScreenerHelp,
  'income-sim': IncomeSimHelp,
  correlation: CorrelationHelp,
  analytics: AnalyticsHelp,
  'portfolio-builder': PortfolioBuilderHelp,
  'dist-compare': DistCompareHelp,
  consolidation: ConsolidationHelp,
  'macro-dashboard': MacroDashboardHelp,
  'income-growth': IncomeGrowthHelp,
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
