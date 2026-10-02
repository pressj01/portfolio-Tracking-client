"""Chapter plan for the Import and Manage Portfolios walkthrough.

The guide intentionally does not teach the Shear Group workflow.  All source
captures are local, scrubbed help captures already used by the app.
"""
from pathlib import Path

PUBLIC = Path(__file__).resolve().parents[1] / 'public' / 'help-screenshots'
IMPORT = PUBLIC / 'import'
PORTFOLIOS = PUBLIC / 'portfolios'

SCENES = []

def chapter(key, title, subtitle, bullets, narration, image, crop=None, kind='screen'):
    SCENES.append({
        'id': key, 'title': title, 'subtitle': subtitle, 'bullets': bullets,
        'narration': narration, 'image': image, 'crop': crop, 'kind': kind,
    })

BROKER = IMPORT / 'brokerage-import-tab-overview.jpg'
SCHWAB_POSITIONS = IMPORT / 'schwab-positions-import.jpg'
SCHWAB_TRANSACTIONS = IMPORT / 'schwab-transactions-import.jpg'
ETRADE_POSITIONS = IMPORT / 'etrade-positions-import.jpg'
FIDELITY_TRANSACTIONS = IMPORT / 'fidelity-transactions-import.jpg'
ROBINHOOD_TRANSACTIONS = IMPORT / 'robinhood-transactions-import.jpg'
GENERIC = IMPORT / 'generic-upload-tab.jpg'
GENERIC_MERGE = IMPORT / 'generic-upload-merge-mode-notice.jpg'
PORTFOLIOS_OVERVIEW = PORTFOLIOS / 'manage-portfolios-overview-blurred.jpg'

chapter(
    '00-welcome', 'Import accounts. Organize every portfolio.',
    'Portfolio Tracker • Import and Manage Portfolios guide',
    ['Broker imports, explained', 'Schwab: detailed walkthrough', 'Owner and flexible aggregates'],
    'Welcome to Portfolio Tracker. This guide explains the Import screen and the Manage Portfolios screen. We will walk through the recommended brokerage import order, look closely at the Charles Schwab workflow, explain the Generic Import choices, and then set up accounts, Owner, and aggregates. You can create as many individual accounts or portfolios as you need. Those accounts remain independent, and you can combine any selection of them in one or more aggregate views whenever you want.',
    BROKER, kind='title')

chapter(
    '01-import-map', 'Start with the import map',
    'Broker Import is a three-step workflow',
    ['1. Positions: shares and cost basis', '2. Transactions: dividends, DRIP, and lots', '3. Refresh: optional market-data update'],
    'Start on Broker Import. The screen is designed to be used in order. First import a current Positions export. That establishes the current shares and cost basis for the selected account. Next import Transaction History. That adds purchases, sales, dividends, reinvestments, and lots after the positions snapshot exists. Last, Refresh is optional. Use it when you want the latest prices and forward-looking dividend fields. A positions file is a full current snapshot, so use a complete export rather than a partial file. The other tabs are for broker-neutral spreadsheets, a combined app export, or a Snowball migration, not the normal broker path.',
    BROKER)

chapter(
    '02-schwab-positions', 'Schwab, step one: current positions',
    'Export from Schwab, then import into the selected account',
    ['Schwab: Accounts > Positions > CSV or Excel', 'Choose Charles Schwab and Positions', 'Upload, preview, then confirm'],
    'For a single Charles Schwab account, go to Accounts, then Positions in Schwab, and export the current view to CSV or Excel. Back in Portfolio Tracker, choose Charles Schwab, leave the workflow on Positions, and choose This account. The import reads the holdings, shares, cost basis, and current prices from that export. You can download the Schwab template when you need the exact field names. Choose the file, set the NAV snapshot date if needed, and select Preview. Review the rows before you confirm the import. This is the step that makes the account holdings match the complete broker snapshot.',
    SCHWAB_POSITIONS)

chapter(
    '03-schwab-all-accounts', 'Schwab, one file for multiple accounts',
    'All Accounts routes a combined positions export safely',
    ['Schwab: switch account selector to All Accounts', 'Choose which Schwab portfolios are updated', 'Preview and confirm each account mapping'],
    'Schwab can also export Positions for All Accounts. In Schwab, switch the account selector to All Accounts before exporting the CSV or Excel file. On this screen choose Charles Schwab, Positions, then All Accounts. The preview separates the export into account blocks and lists your portfolios that are tagged Charles Schwab on Manage Portfolios. Check only the portfolios you want to update. You can verify or change each mapping before anything is written, skip an account in the file, or create a destination portfolio for a new account. Confirmed routing is remembered for the next combined export. This shortcut is for Positions; transaction history is still imported one account at a time.',
    BROKER, crop=(35, 340, 1395, 760))

chapter(
    '04-schwab-transactions', 'Schwab, step two: transaction history',
    'Bring in activity after the positions snapshot',
    ['Schwab: Accounts > History > choose date range', 'Choose Transactions on the workflow', 'Imports buys, sells, DRIP, and dividends'],
    'After the positions import, choose Transactions in the same workflow. In Schwab, go to Accounts, then History, choose the date range you need, and export the Transactions CSV or Excel file. Preview it and then import it into that one selected account. This adds transaction history such as buys, sells, dividend payments, and DRIP reinvestments. Importing positions first matters: it preserves the current broker holdings while the history is added behind them. Reimporting an older history file safely skips matching transaction rows and duplicate dividend payments. When a file is incomplete, use the review screen before confirming so you do not mistake a partial history for the entire account record.',
    SCHWAB_TRANSACTIONS)

chapter(
    '05-other-brokers', 'Other broker imports follow the same pattern',
    'E*TRADE, Fidelity, Robinhood, and Interactive Brokers',
    ['Choose the matching broker source', 'Positions first, then transactions', 'Preview every file before confirming'],
    'The other broker choices work the same basic way. Select the broker that supplied the export, start with its current Positions file for the selected account, then import its Transaction History, and optionally refresh prices and dividend data. E*TRADE, Fidelity, Robinhood, and Interactive Brokers each have their matching format and downloadable template or field guidance on the screen. Interactive Brokers uses its Activity Statement for positions and its Transaction History export for activity. Fidelity also offers an optional All Accounts positions shortcut that uses the same preview-and-map approach as Schwab. Regardless of broker, the important sequence is unchanged: a complete current positions snapshot first, activity history second, and a preview before the final import.',
    ETRADE_POSITIONS)

chapter(
    '06-generic-positions', 'Generic Import: flexible positions',
    'Use a spreadsheet when it is not a supported broker export',
    ['Required: Ticker and Shares', 'Optional: cost, dividend, dates, and DRIP', 'Download Holdings Template to start'],
    'Choose Generic Positions when your data is in your own spreadsheet or another source that does not match a brokerage importer. The minimum columns are Ticker and Shares. You can also provide Price Paid, Dividend, Frequency, Ex-Dividend Date, and DRIP. Use Download Holdings Template to begin with the supported layout. The app enriches eligible holdings with market data. If the selected portfolio already has positions, Generic Import uses merge mode: it updates matching tickers and adds new ones while preserving app-only values, such as DRIP or pay dates, unless your spreadsheet supplies them. You can also import all filled workbook tabs as separate portfolios, which is useful for a multi-account spreadsheet.',
    GENERIC, crop=(0, 0, 3766, 1350))

chapter(
    '07-generic-activity', 'Generic transactions and combined workbooks',
    'Choose the tab that matches the file you have',
    ['Generic Transactions: broker-neutral event history', 'Positions + Transactions: one app-export workbook', 'Use positions first when history is partial'],
    'Generic Transactions is the companion to Generic Positions. Use its XLSX or CSV format for one row per BUY, SELL, DIVIDEND, DRIP, deposit, withdrawal, or share transfer. It uses the same preview, duplicate protection, and realized-gain workflow as broker transaction imports. Positions plus Transactions is different: it restores one workbook that contains both a portfolio sheet and a Transactions sheet, such as a workbook exported by this app. Its scope controls can import both sections together or run positions only or transactions only. Match the tab to the file. A combined workbook belongs on Positions plus Transactions, while a normal broker export belongs on Broker Import.',
    GENERIC_MERGE)

chapter(
    '08-portfolio-overview', 'Manage Portfolios: one row per real account',
    'Create, classify, show, order, and select accounts',
    ['New Portfolio creates an independent account', 'Rows retain their own broker and data', 'Select switches the active account'],
    'Now open Manage Portfolios. Each regular row is a real, independent portfolio or brokerage account. Use New Portfolio whenever you want another account; there is no fixed limit. Give it a meaningful name, choose the appropriate broker source before importing, and it keeps its own holdings, transaction history, cash snapshot, and settings. The table lets you rename an account inline, select it as the active account, or move it up and down in the portfolio selector. Add accounts for every brokerage, retirement account, experiment, household member, or separate strategy you want to track. Creating another account does not merge it with any existing account.',
    PORTFOLIOS_OVERVIEW, crop=(0, 0, 2832, 1660))

chapter(
    '09-portfolio-controls', 'What the portfolio controls mean',
    'Broker source, account type, Show, Owner, cash, and actions',
    ['Broker Source authorizes matching broker imports', 'User-owned vs Test / non-owned controls Owner eligibility', 'Show changes the selector, not the data'],
    'The Broker Source is the broker whose importer is allowed to write to that portfolio; it is independent of the account name. Account Type marks a portfolio User-owned or Test / non-owned. Test accounts remain usable, but cannot be included in Owner. Show controls whether an account appears in the top portfolio selector. Clearing Show simply hides it there; it does not delete data. Cash is a dated snapshot, not a live balance. Click a regular account’s cash amount to update it manually; broker imports can replace it later. The arrows set display order, and Select changes the active account. Clear removes holdings and the transaction ledger, Reset also removes option trades and the DRIP contribution schedule, and Delete removes the portfolio itself after a confirmation and backup.',
    PORTFOLIOS_OVERVIEW, crop=(0, 110, 2832, 1580))

chapter(
    '10-owner', 'Owner is an optional personal rollup',
    'Include chosen user-owned accounts without changing them',
    ['Create Owner once, only if you want it', 'Check Owner on accounts that belong in it', 'Owner is never a broker import destination'],
    'Owner is optional. Create it only when you want a personal rollup of selected user-owned brokerage accounts. Then use the Owner checkbox on each regular user-owned account to include or exclude it. Owner does not turn those accounts into one database record: each account stays independent and keeps its own broker import destination. Owner itself is never a place to import a broker file. Instead, import each brokerage file into its matching regular account, and the checked accounts feed the Owner rollup. The Dashboard uses this configuration for Owner-level income and DRIP-versus-cash calculations. Test or non-owned accounts cannot be checked for Owner, so temporary portfolios stay out of a personal rollup by design.',
    PORTFOLIOS_OVERVIEW, crop=(0, 110, 1500, 1480))

chapter(
    '11-aggregates', 'Aggregates combine any accounts you choose',
    'Create multiple read-only virtual portfolios',
    ['Add Aggregate, name it, then choose members', 'Any subset can appear in one or many aggregates', 'Show, order, select, or delete the view'],
    'Aggregates are separate from Owner. An aggregate is a read-only virtual portfolio that combines the real portfolios you check as members. Click Add Aggregate, rename it, and choose its member accounts. You can make as many aggregates as you want: one for every account, one for a household, one for retirement accounts, or one for a strategy. There is no one-to-one rule. The same individual account can be included in any number of aggregates, and every aggregate can use any combination of the available regular portfolios. Owner itself is not an aggregate member. Each aggregate has its own Show checkbox, ordering arrows, Select button, and Delete button. Deleting an aggregate removes only the virtual definition; it never removes the underlying accounts or their data.',
    PORTFOLIOS_OVERVIEW, crop=(0, 1530, 2832, 2360))

chapter(
    '12-finish', 'A safe, repeatable account workflow',
    'Import accurately, then organize the views you need',
    ['One regular portfolio per account', 'Positions → Transactions → optional Refresh', 'Owner and aggregates are flexible views'],
    'To recap: create a regular portfolio for every real account you want to track, tag it with the matching broker source, and import a complete positions snapshot before transaction history. Use Generic Import when your spreadsheet is not a supported broker export. Create Owner only for the personal rollup you want, and use aggregates for any other combinations. You can add more accounts at any time, keep them independent, and place the same account into any combination of aggregate views. Review previews before imports and read the Clear, Reset, and Delete confirmations carefully. For informational purposes only. Not financial advice.',
    PORTFOLIOS_OVERVIEW, kind='outro')
