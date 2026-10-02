"""Source-checked chapter plan for the Manage Holdings marketing walkthrough."""

SCENES = []

def chapter(key, title, subtitle, bullets, narration, shots, kind='screen'):
    SCENES.append(dict(id=key, title=title, subtitle=subtitle, eyebrow='HOLDINGS WALKTHROUGH',
                       bullets=bullets, narration=narration, shots=shots, kind=kind,
                       capture=shots[0][0]))

OVERVIEW = ('01-overview-full.jpg', (0, 100, 1904, 880))
BOXES = ('01-overview-full.jpg', (25, 450, 1870, 563))
POSITION = ('21-position-full.jpg', (25, 892, 1600, 1370))
INCOME = ('22-income-full.jpg', (25, 892, 1870, 1370))
RISK = ('23-risk-actions-full.jpg', (25, 892, 1870, 1370))
EDIT = ('07-edit-top-full.jpg', (598, 69, 1292, 985))
EDIT_BOTTOM = ('08-edit-bottom-full.jpg', (598, 69, 1292, 985))
TXNS = ('10-transactions-full.jpg', (250, 69, 1660, 985))
BUY = ('24-buy-form-full.jpg', (250, 69, 1660, 985))
SELL = ('11-sell-full.jpg', (250, 69, 1660, 985))
SPECIFIC = ('12-specific-lots-full.jpg', (250, 69, 1660, 985))

chapter('00-welcome', 'Know every holding. Control every detail.', 'Portfolio Tracker • Complete Manage Holdings guide',
        ['Income at a glance', 'Position and dividend detail', 'Holding and transaction editing'],
        'Welcome to Manage Holdings in Portfolio Tracker. This is where an account’s positions, dividend settings, income estimates, and transaction history come together. In this detailed walkthrough, we will explain every summary box, work across the complete holdings table, and show how the different editing controls are used. You will see how to add a position, correct its information, maintain purchase and sale lots, record dividends, and check reinvestment across accounts. The goal is a clear view of what you own, what your records say, and which control to use when something needs attention.', [OVERVIEW], 'title')

chapter('01-account', 'Start with the right account', 'Account selector, cost basis, and the top toolbar',
        ['Choose the account before editing', 'Original or broker adjusted basis', 'Import, refresh, history, and add tools'],
        'Start with the account selector at the top right. It determines which portfolio you are viewing. The Basis selector switches between original cost and broker adjusted cost where the application has that information. Keep the basis consistent when comparing cost and gain or loss across pages. The toolbar provides Import Holdings, Transaction History, Deposits and Withdrawals, the dividend source filter, price and dividend refresh, dividend repair, and the two ways to add a holding. In an aggregate view, the page identifies how holding edits are routed. For a correction to one specific account, select that account first, or use the expanded transaction ledger’s explicit account selector.', [OVERVIEW, ('01-overview-full.jpg',(1000,0,1904,265))])

chapter('02-accrual', 'Post-refresh accrual: what the box means', 'Keep the accrual estimate separate from recorded payment history',
        ['Account name and estimated amount', 'Payments or elapsed time since refresh', 'Ticker, expected date, and payment amount'],
        'The Post-Refresh Accrual Estimate panel describes income estimated since the most recent refresh. Each account card shows an account name and an accrual amount. When payment details are available, the card lists the ticker, expected payment date, and amount. The line below the total may show a count of payments since refresh, or an estimate over an elapsed number of days. A dash and no prior refresh mean there is no refresh baseline yet. Use this panel to identify income that may need review. It is an accrual view, and you should compare it with recorded dividend history when confirming what actually arrived in the account.', [('01-overview-full.jpg',(25,265,1870,425)), BOXES])

chapter('03-drip-count', 'Ticker DRIP Coverage', 'Counts of securities, with each ticker counted once',
        ['Total number of visible tickers', 'DRIP count and percentage', 'Not DRIP count and percentage'],
        'Ticker DRIP Coverage counts the ticker names in the current dividend source view. The large number is the total count. The green badge shows how many have dividend reinvestment enabled and the percentage they represent. The amber badge shows how many do not. Every ticker counts once, regardless of its value, share count, or dividend rate. This makes the box useful for checking how widely reinvestment is enabled across the portfolio. A small position has the same weight in this count as a large position. The count follows the holding’s DRIP setting, rather than proving that every historical dividend has already purchased shares.', [BOXES, ('01-overview-full.jpg',(25,450,645,558))])

chapter('04-income-boxes', 'Four income boxes, one clear split', 'Forward monthly income and how it is allocated',
        ['Est. Monthly Income = annual estimate ÷ 12', 'Mo$ Reinvested and Mo$ Not Reinvested', '% Reinvested is weighted by income dollars'],
        'The other four boxes describe estimated income. Estimated Monthly Income is the portfolio’s annual dividend estimate divided by twelve. It is a monthly average, so quarterly or uneven payments do not necessarily arrive in equal monthly amounts. Mo dollars Reinvested is the estimated monthly income allocated to holdings with reinvestment enabled. Mo dollars Not Reinvested is the estimated monthly income allocated to cash. Percent Reinvested divides estimated reinvested income by total estimated monthly income. These boxes are forward estimates based on the recorded dividend inputs and DRIP settings. They help you see the balance between projected reinvestment and cash income; they are not a statement of actual cash received this month.', [BOXES, ('01-overview-full.jpg',(645,450,1870,558))])

chapter('05-percentages', 'Why the two DRIP percentages differ', 'Count ticker names in one box; count income dollars in the other',
        ['2 of 4 tickers on DRIP = 50%', '$20 of $100 income reinvested = 20%', 'Mixed account settings affect the dollar split'],
        'Expand Why the DRIP Percentages Can Be Different for an explanation built into the screen. Suppose two of four tickers have DRIP enabled. The ticker coverage is fifty percent. If those two tickers produce twenty dollars of the portfolio’s hundred dollars of estimated monthly income, the income reinvested percentage is only twenty percent. Both answers are correct. One counts names; the other counts dollars. Share quantities, dividend amounts, and payment frequency affect the dollar calculation. In a combined or Owner view, the same ticker can reinvest in one account and take cash in another. Review the account-level split when a headline percentage needs explanation.', [('02-drip-help-full.jpg',(25,590,1870,1090)), BOXES])

chapter('06-columns', 'Make the table work for you', 'Columns, search, ordering, and sorting',
        ['Search the available fields', 'Hide columns with checkboxes', 'Reorder with arrows or by dragging'],
        'The holdings table has a wide set of fields, and Columns lets you choose the ones you need. Open the control, then search for a field or browse the list. Each description explains what that column means. Uncheck an optional column to hide it. The ticker stays visible. Use the up and down buttons, drag a row in the menu, or drag a table header to change the order. Show all restores all fields; Reset order and visibility restores the default arrangement. On the table, click a sortable header to change the sort direction. Horizontal scrolling reveals fields farther across the table, while header tooltips provide a quick definition.', [('03-columns-full.jpg',(1140,665,1865,1435)), ('04-columns-search-full.jpg',(1140,665,1865,1410))])

chapter('07-date-range', 'Compare the right period', 'Shared Performance Date Range and Custom dates',
        ['1D through 5Y, YTD, All, Life, or Custom', 'Current positions remain visible', 'Life uses the remaining position’s cost basis'],
        'The Shared Performance Date Range controls the period-dependent performance figures. One day measures from the previous close; seven days looks back seven calendar days. The month and year presets choose calendar-based start dates, and year to date starts at January first. All begins with the portfolio’s own recorded history. Custom exposes inclusive start and end dates. Read the explanatory lines for the actual resolved window. This control does not hide holdings or change the current shares, value, or cost basis. The regular gain and loss columns follow the selected window. Life is different: it measures current value against the cost of shares still held. The separate Life Gain and Loss columns retain that cost-basis meaning.', [('05-custom-range-full.jpg',(25,660,1870,950)), POSITION])

chapter('08-position-columns', 'Read the position and cost fields', 'Identity, ownership, share history, and today’s value',
        ['Ticker, Description, Category, and % Acct', 'Shares, Purchased, Base, and DRIP Sh', 'Paid, Current, Cost, and Value'],
        'Begin at the left of the table. Ticker and Description identify the security, and Category is the classification assigned to the holding. Percent Account shows its share of current holdings value. Shares is the current quantity; Purchased shows the original or earliest lot date. Base separates originally purchased shares from DRIP Shares acquired through reinvestment. Cash Reinvested records the cash used for those reinvestments. Paid is the average cost per share, Current is the market price, Cost is the position’s recorded cost basis, and Value is its current market value. These fields answer different questions: quantity, purchase history, cost, and today’s valuation. Click the ticker to open its research sheet, or the triangle to inspect its ledger.', [POSITION, ('21-position-full.jpg',(25,892,1150,1270))])

chapter('09-return-columns', 'Period return, lifetime gain, and realized gain', 'Use the column label and date window to interpret each number',
        ['G/L $ and G/L % follow the selected range', 'Life G/L measures shares still held', 'Realized G/L records completed sales'],
        'Gain and Loss dollars and percent follow the shared range. Each row describes the ticker’s current lot in that window. The portfolio total uses the broader tracker price-return calculation, which can include positions held during the range and fully sold afterward. That is why a selected-period total should not be interpreted as simply adding lifetime open-position gains. Life Gain and Loss is current value minus the cost of the remaining shares, and its percentage compares that difference with their cost. Realized Gain and Loss is profit or loss from completed sales. Keep price performance, realized sales, and dividends separate when explaining results. The table’s labels and notes help you compare the same scope across the application.', [POSITION, RISK])

chapter('10-dividend-columns', 'Dividend schedule and income estimates', 'Payment inputs, timing, and forward income',
        ['Div$, Freq, Ex-Div, and Pay Date', 'DRIP checkbox and annual/monthly estimates', 'Estimated reinvested dollars, cash, and shares'],
        'Div dollars is the recent distribution per share. Frequency identifies the payment cadence: weekly, monthly, quarterly, semiannual, or annual. Ex Dividend and Pay Date describe the distribution schedule; a pay date marked as estimated comes from the projected schedule rather than a confirmed payment. The DRIP checkbox records whether this holding reinvests. Changing it updates the application’s setting; it does not place a broker order. Year dollars and Month dollars are annual and monthly income estimates. DRIP dollars and Cash dollars split estimated monthly income according to the reinvestment setting. Month Shares and Year Shares estimate shares purchasable by reinvesting at the current price. Those are hypothetical quantities, not completed purchases.', [INCOME])

chapter('11-yield-history', 'Yield, actual income, and dividend sources', 'Separate income estimates from the recorded history',
        ['YOC compares annual income with cost', 'Yield compares annual income with current value', 'Actuals, paid-for-itself, and source fields'],
        'Yield on Cost compares estimated annual dividends with the recorded cost basis. Current Yield compares that annual estimate with current market value. They can differ because your purchase cost differs from today’s price. The column named for the current month shows that month’s holding income figure. Dividend Paid, Year to Date Dividends, and Total Dividends summarize the application’s dividend records. Paid For Itself shows the fraction of original cost recovered through cumulative dividends; one hundred percent means dividends equal that cost. Dividend Source identifies where the actuals came from, such as imported broker history, a snapshot, or Yahoo. If DRIP is a hypothetical share calculation at current price, rather than a record of actual reinvested shares.', [RISK, INCOME])

chapter('12-risk', 'Understand the risk and comparison columns', 'Historical context for a more complete holding review',
        ['Beta and up/down benchmark sensitivity', 'RvY: return compared with yield', 'Closure risk and selected-window grade'],
        'Beta describes historical price sensitivity to the benchmark shown for that ticker. Delta Up and Delta Down estimate sensitivity on benchmark up days and down days. They are historical relationships, not guaranteed future moves. Return versus Yield compares total return with yield on a compatible time basis. Its header button switches between Yield on Cost and Current Yield. Good indicates return at least matches the yield comparison; Poor indicates the income rate exceeds total return. Close is the fund closure-risk field, which concerns a fund issuer closing a small ETF. Stocks are not rated there. Grade is the composite assessment for the selected market window and is blank on Life. Missing data can produce a dash instead of a rating.', [RISK])

chapter('13-edit-choice', 'Edit, Txn, and Del: choose the right control', 'Holding details and ledger events have different editing paths',
        ['Edit opens holding information', 'Txn opens purchase and sale history', 'Del removes the holding after confirmation'],
        'At the far right, each holding has Edit, Transaction, and Delete controls. Edit opens the holding’s basic information, dividend settings, income fields, and reinvestment information. Transaction opens the purchase and sale ledger. Use it for trade dates, share quantities, purchase or sale prices, and fees. Delete is for removing a holding from the selected portfolio and presents a confirmation. Within an expanded ledger, Delete acts on one event instead. Read the confirmation to understand what will be removed. As a routine workflow, open Edit for a category or dividend correction, and use Transaction when the broker’s trading history needs a correction. Save only after checking the account and the record.', [RISK, EDIT])

chapter('14-basic-position', 'Edit Basic Info and Position', 'Identity and classification first, then the position’s source of truth',
        ['Ticker, Description, and Category', 'Transaction-backed position fields are locked', 'Update saves; Cancel discards the form'],
        'In the Edit dialog, Basic Info contains Ticker, Description, and Category. Description and Category make the holding easier to recognize and organize. Changing the ticker is a rename: saving can rename it across portfolios, transactions, dividends, categories, and ticker settings. Use that for an actual symbol correction. Position contains Shares, Price Paid, Current Price, and Purchase Date. When transactions exist, the dialog explains that Shares, Price Paid, and Purchase Date are managed by transactions and disables those fields. Correct the underlying lots with the Transaction button. For a simple holding without transaction history, those position fields can be entered directly. Update saves the holding form, and Cancel closes it without saving.', [EDIT])

chapter('15-edit-dividends', 'Edit Dividend Info and manual overrides', 'Distribution amount, cadence, DRIP, and dates',
        ['Div/Share is one distribution per share', 'Frequency sets the payment cadence', 'Review override notes before saving'],
        'Dividend Info contains Dividends per Share, Frequency, DRIP, Ex Dividend Date, and Pay Date. Enter the amount for a single distribution per share, then choose the appropriate cadence. Auto allows market data detection; a manually selected cadence can remain pinned until changed. The DRIP checkbox tells the application how to allocate the holding’s income estimate. Enter the schedule dates using the format shown in the form. Manual amount and date corrections can temporarily override automatic data. When an override is active, the form shows its duration and a Use market data now link. Undo reverses that pending choice. Follow the displayed note: some fields resume market data on save, while others resume on the next refresh.', [EDIT, ('07-edit-top-full.jpg',(610,525,1270,738))])

chapter('16-edit-tracking', 'Edit income tracking and reinvestment fields', 'Recorded actuals, calculated ratios, and forward estimates',
        ['Dividends Paid, YTD, and Total Divs', 'Paid For Itself and income estimates', 'Cash and shares from reinvestment'],
        'Scroll within the holding dialog to Dividend Tracking and Total Returns. Dividends Paid, Year to Date Dividends, and Total Dividends Received let you maintain the holding’s income totals. Check them against your actual payment records rather than copying an annual estimate into an actual-income field. Paid For Itself is stored as a ratio: a value of one represents one hundred percent, and the table formats it as a percentage. Estimated Annual and Monthly Dividend describe projected income. On save, the form recalculates applicable estimates and ratios from the position, distribution, and frequency inputs. Reinvestment contains Cash Not Reinvested, Cash Reinvested, and Shares from Dividends. Use real history for historical figures and review the recalculated values before relying on them.', [EDIT_BOTTOM])

chapter('17-add-holding', 'Add a holding: snapshot or first transaction', 'Choose the entry path that matches your records',
        ['+ Add Holding creates a simple position', 'Lookup helps populate market information', '+ Add/Edit via Transaction records a first buy'],
        'Add Holding opens the same grouped form with empty fields. Enter the ticker, use Lookup to retrieve available market information, review the description and category, and enter the share quantity and purchase details. Check the dividend cadence and dates before selecting Add. Cancel exits without creating the position. Add or Edit via Transaction is the alternative for starting with a trade record. Its new-ticker form includes the ticker lookup, description, category, trade date, shares, price per share, fees, and notes. A new ticker begins with a buy. This establishes transaction history that can later drive position calculations. Import Holdings provides another route when your broker file already contains the positions or transactions.', [('09-add-holding-full.jpg',(610,70,1290,985)), ('13-add-transaction-full.jpg',(250,130,1660,945))])

chapter('18-ledger', 'Expand the ticker to see its ledger', 'Trades and cash dividends with running position detail',
        ['Triangle expands or collapses the ledger', 'Edit or delete one event', 'Cash dividends and DRIP buys stay separate'],
        'Select the triangle beside a ticker to expand its ledger. This view brings together trades and actual dividend payments. It shows event type, date, shares, price, fees, cost or proceeds, unrealized gain, realized gain, and running position, average cost, and total cost. Read the event type first: a cash dividend does not add shares or change the position’s cost basis. Reinvested shares appear as a separate buy. Sortable headers help review the entries, and the built-in help explains how to read and manage the table. Edit opens that specific event in its actual account. Delete removes that event and recalculates the holding; it is separate from deleting the whole holding.', [('17-ledger-full.jpg',(25,890,1870,1570))])

chapter('19-buy-edit', 'Add or correct a buy transaction', 'The trade details drive position and cost-basis calculations',
        ['Date, shares, price, fees, and notes', 'Originally Acquired is for transferred shares', 'Edit loads an existing event for correction'],
        'The Transaction dialog shows saved trades above an Add Transaction form. Choose Buy to record purchased shares, enter the actual trade date, share quantity, price per share, and any fees, then add a note if useful. Originally Acquired is for shares transferred from another broker: it preserves the original acquisition date separately from the transfer-related record. Leave it blank for an ordinary purchase. To correct a saved trade, select its Edit control. The form loads that event, and its save control updates the existing transaction. Cancel Edit returns to adding a new event. Close exits the dialog. Recording or correcting trades recalculates the position and cost basis, so verify quantities and prices against the source record.', [BUY, TXNS])

chapter('20-sell-lots', 'Record a sale with the appropriate lot method', 'FIFO by default; Specific Lots when the source record supports it',
        ['Sell shares, price, date, and fees', 'FIFO uses the oldest available shares first', 'Specific Lots assigns quantities to buy lots'],
        'Choose Sell to record a completed sale. The form changes to Shares Sold and displays available shares when open lots are present. Enter the sale date, quantity, execution price, fees, and notes. FIFO is the default cost-basis method: it matches the oldest available purchase lots first. Specific Lots displays the eligible buy dates, prices, cost per share, and available quantities. Enter the quantity sold from each lot; those allocations are summed into the sale quantity. Match this to the lot treatment documented in your broker records. The application then recalculates the remaining shares, cost basis, and realized gain or loss. These controls record transactions in Portfolio Tracker; they do not execute a trade at your broker.', [SELL, SPECIFIC])

chapter('21-order', 'Match the order of same-day trades', 'Execution order can affect FIFO matching and cost basis',
        ['Up/down arrows change same-day trade order', 'Only the same account and date qualify', 'Edit Date to move an event to another day'],
        'When more than one buy or sell occurs for the same ticker, account, and date, the Same Day Order controls show up and down arrows. Use them to match the broker’s actual execution order. They do not move a trade onto a different date or into another account. FIFO matching and cost basis recalculate after each move. Only Trade means there is no other qualifying trade to reorder. Not Applicable marks a dividend payment because cash dividends do not affect FIFO trade order. In the expanded ledger, use Edit when the event belongs on another date. If the application identifies missing opening history or an unpriced purchase, repair that source record before assuming a sale’s unavailable gain is zero.', [TXNS, ('17-ledger-full.jpg',(25,890,1870,1570))])

chapter('22-dividend-event', 'Record or edit an actual dividend payment', 'Choose the account, then enter the cash event',
        ['+ Add Transaction opens account selection', 'Choose Dividend payment and Continue', 'Payment date, cash amount, and notes'],
        'The expanded ledger’s Add Transaction control asks for an account and a transaction type. Choose Buy or Sell for a trade, or Dividend Payment for an actual cash payment, then Continue. The dividend form shows the account, payment date, cash amount, and notes. Enter the total cash payment for the event, rather than a per-share dividend estimate, then use Save Dividend. Cancel leaves the record unchanged. An existing dividend event has its own Edit control. A reinvested dividend needs its cash payment recorded here and the resulting shares recorded as a separate buy transaction. Keeping both events distinct preserves a clear view of income received and the shares acquired with that income.', [('18-event-account-full.jpg',(670,330,1235,750)), ('19-dividend-editor-full.jpg',(670,280,1235,810))])

chapter('23-history-cash', 'Review history and account cash flows', 'Search past trades, sold positions, and money movements',
        ['History includes no-longer-held tickers', 'Search, event-type filter, and closed positions', 'Deposits and withdrawals support Account Alpha'],
        'Transaction History opens the account’s saved buys, sells, and actual dividends, including tickers that are no longer held. Search by ticker, account, or notes, filter by event type, and select Closed Positions Only when reviewing past positions. Deposits and Withdrawals serves a different purpose. It records money added or removed and share transfers, so Account Alpha can separate external funding from investment performance. Add a missing event with its type, date, amount or share details, and note. The completed-period controls identify stretches with a complete cash-flow record, including periods where no money moved. Mark a period complete only after all its flows are present. That completeness determines when Account Alpha can be measured.', [('14-history-full.jpg',(190,69,1720,980)), ('15-cash-flows-full.jpg',(400,130,1520,960))])

chapter('24-refresh-repair', 'Refresh market inputs and preview dividend repair', 'Know the difference between viewing sources and changing records',
        ['Source filter changes which holdings are shown', 'Refresh updates price and dividend data', 'Preview first, then Apply Repair if appropriate'],
        'All Dividend Sources filters the table and summary counts by the source of dividend actuals. Selecting a source changes the view; it does not repair the underlying record. Refresh Prices and Dividends updates market inputs. After a refresh, Latest Refresh Result can show payable distributions, changed holding dividend fields, and payment-history rows recorded, updated, or already present. The Dividend Repair mode chooses imported actuals plus Yahoo, imported actuals only, or Yahoo only. Preview Dividend Repair shows the proposed repair scope, source counts, and any date or amount updates. Inspect those details before selecting Apply Repair. Cancel leaves the repair unapplied. Preview and refresh may take time; wait for the completed result before reviewing the figures.', [('01-overview-full.jpg',(25,190,1660,255)), ('16-repair-full.jpg',(400,310,1510,775))])

chapter('25-owner-drip', 'Manage reinvestment across accounts', 'Owner-only DRIP Matrix and account synchronization',
        ['Filter the matrix by ticker', 'Each checkbox belongs to one account', 'Sync to Owner updates the consolidated view'],
        'The Owner view adds DRIP Matrix and Sync DRIP from Accounts. The matrix puts ticker rows against account columns, so you can inspect whether the same security reinvests in each account. Use Filter Ticker to find one symbol. Each checkbox belongs to that ticker in a specific account, and toggling it updates that account’s application record. Sync to Owner consolidates the account-level DRIP flags and share counts into the Owner view. The toolbar’s Sync DRIP from Accounts performs that synchronization directly. Review the account settings before syncing, particularly where the same ticker takes cash in one account and reinvests in another. These settings track your reinvestment choices in the application; brokerage instructions remain separate.', [('20-drip-matrix-full.jpg',(500,70,1420,985))])

chapter('26-finish', 'A repeatable routine for clearer records', 'Review income. Verify history. Edit the right record.',
        ['Review the summary boxes and date window', 'Check the position and its source records', 'Save the appropriate holding or event edit'],
        'A practical routine begins with the correct account and basis. Review the income and DRIP boxes, choose a performance window, and arrange the table around the fields you want to compare. Open Edit for holding information and dividend settings. Open the transaction ledger for purchases, sales, and actual dividend events. Compare history with your broker records, review repair previews, and use the cross-account matrix when managing the Owner view. Portfolio Tracker brings those details together so you can maintain clearer records and understand what each number represents. For informational purposes only. Not financial advice.', [OVERVIEW], 'outro')

# Give each headline box a readable close-up without changing the narration.
SCENES[2]['shots']=[('01-overview-full.jpg',(25,310,650,428)),('01-overview-full.jpg',(1510,310,1870,428))]
SCENES[3]['shots']=[('01-overview-full.jpg',(25,450,645,563))]
SCENES[4]['shots']=[('01-overview-full.jpg',(left,450,right,563)) for left,right in [(645,950),(950,1250),(1250,1560),(1560,1870)]]

# Each entry starts the next visual when the existing narration reaches the
# named control.  These are intentionally spoken phrases, rather than evenly
# sized time slices, so the visuals can be rebuilt without re-recording audio.
TIMING_CUES = {
    '01-account': ['The toolbar provides'],
    '02-accrual': ['When payment details are available'],
    '04-income-boxes': ['Mo dollars Reinvested', 'Mo dollars Not Reinvested', 'Percent Reinvested'],
    '05-percentages': ['In a combined or Owner view'],
    '06-columns': ['then search for a field'],
    '07-date-range': ['This control does not hide holdings'],
    '08-position-columns': ['Shares is the current quantity'],
    '09-return-columns': ['Life Gain and Loss'],
    '11-yield-history': ['Dividend Paid, Year to Date Dividends'],
    '13-edit-choice': ['Edit opens the holding'],
    '15-edit-dividends': ['Manual amount and date corrections'],
    '17-add-holding': ['Add or Edit via Transaction'],
    '19-buy-edit': ['To correct a saved trade'],
    '20-sell-lots': ['Specific Lots displays'],
    '21-order': ['In the expanded ledger'],
    '22-dividend-event': ['The dividend form'],
    '23-history-cash': ['Deposits and Withdrawals'],
    '24-refresh-repair': ['The Dividend Repair mode'],
}

# Keep the on-screen callout in step with its matching crop.  A few chapters
# use two crops for one explanatory point before moving to the next point.
SHOT_BULLETS = {
    '04-income-boxes': [1, 2, 2, 3],
    '11-yield-history': [1, 3],
    '15-edit-dividends': [1, 3],
    '17-add-holding': [1, 3],
    '19-buy-edit': [1, 3],
    '20-sell-lots': [1, 3],
    '21-order': [1, 3],
    '22-dividend-event': [1, 3],
    '23-history-cash': [1, 3],
    '24-refresh-repair': [1, 3],
}

for scene in SCENES:
    scene['timing_cues'] = TIMING_CUES.get(scene['id'], [])
    if len(scene['timing_cues']) != len(scene['shots']) - 1:
        raise ValueError(f"{scene['id']} needs one timing cue for every visual change")
    scene['shot_bullets'] = SHOT_BULLETS.get(scene['id'], list(range(1, len(scene['shots']) + 1)))
    if len(scene['shot_bullets']) != len(scene['shots']):
        raise ValueError(f"{scene['id']} needs one callout selection for every visual")
