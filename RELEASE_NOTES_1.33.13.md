# Portfolio Tracking Client v1.33.13

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

This release carries forward everything shipped after v1.32.1, adds a day-by-day record of what your holdings paid, feeds your saved budget into the retirement models, settles option trades a broker export can never close, and makes the cost-basis correction from v1.33.5 something you can actually run and finish. The Windows installer is code signed.

v1.33.6 was prepared but never published, so everything described for it is included here and is new to anyone coming from v1.33.5. v1.33.8 corrected the realized total on the Option Trades summary, which reported only the current year while every other card on it counted every trade. v1.33.9 adds a backup and restore for your cash-flow plan, so the expenses you typed in by hand can be saved to a file and loaded back. v1.33.10 makes Retirement Readiness and Cash Flow & Sustainability report the same monthly expenses, and stops the plan reporting more than the bills you entered. v1.33.11 adds a Put / Call Condor Scanner and a full dividend-payment Month calendar that follows the selected account or aggregate, uses imported transaction history when available, and still works when no transactions have been imported. v1.33.12 carries that same accurate pay-date pipeline into the rest of the application, so the Dashboard, holdings, analysis, Action Center, refresh, and accrual views agree with the calendar. v1.33.13 preserves hand-entered dividend details through their current payment cycle and keeps Retirement Readiness assumptions where you set them.

## New in v1.33.13

### Retirement Readiness Remembers Your Assumptions

Retirement Readiness now saves every value you enter automatically. Your expense, income, cash-reserve, yield, tax, stress, and projection assumptions return when you reopen the app, so you do not need to re-enter a planning scenario every time.

- **Saved separately for each selection.** Each account and aggregate retains its own Retirement Readiness setup, preventing one household or portfolio scenario from changing another.
- **Cash Flow remains available on demand.** The screen initially seeds from its matching Cash Flow & Sustainability plan. After you make an adjustment, your saved Retirement Readiness values take priority; **Re-sync from plan** is the deliberate way to replace them with the current plan again.
- **The guidance is easier to find.** Retirement Readiness help is grouped with the portfolio planning tools and explains the cash-runway and model calculations in plain language.

### Manual Dividend Overrides Stay Put Until the Payment Passes

A declared distribution can be corrected by hand when your issuer or broker has better information than a feed. Those corrections now remain attached to that specific payment instead of being overwritten by the next refresh.

- **Ex-dividend date, payment date, distribution amount, and frequency overrides are protected** through the expected payment date, then automatically release for the next declaration.
- **Calendar and dashboard views use the same protected dates.** A manually confirmed distribution does not become a mismatched next-cycle ex-date paired with the current payment date.
- **Existing accurate pay-date logic is retained.** Confirmed issuer dates and imported payment history still drive projections when no active manual override exists.

## New in v1.33.12

### One Dividend Pay-Date Pipeline Everywhere

The pay date shown in the Month calendar is now the same pay date used throughout the application.

- **Imported dividend history drives recurring dates.** Genuine payment transactions establish the schedule for each ticker and account, including weekly, ordinal-weekday, and month-end patterns. Snowball, broker, generic, and portfolio-export dividend payments all count as actual history.
- **Every screen agrees.** Dashboard upcoming dividends, holdings tables, Manage Holdings, Common Info, Dividend Analysis, Action Center, refresh results, and accrual summaries now consume the same resolved payment date.
- **Confirmed dates stay authoritative.** Issuer-published and otherwise confirmed dates are never replaced by an inferred transaction pattern.
- **No-history users keep the prior behavior.** If no usable dividend payments have been imported, the existing saved schedule and frequency estimator remain the fallback, with estimated dates clearly marked.
- **Imports switch immediately.** Importing the first genuine dividend payment invalidates the schedule cache, so the next request uses the new history-aware projection without restarting the desktop app.

## New in v1.33.11

### Put / Call Condor Scanner

The Options section now includes a scanner for building put condors, call condors, or both sides together on Mini-SPX (^XSP) and SPY.

- **Build around a firm risk limit.** The scanner starts with a one-point debit spread near the market, finances it with a farther out-of-the-money credit spread, and will adjust the protective wing without exceeding the maximum expiration loss you set.
- **Control the setup.** Choose target days to expiration, strike placement, the credit spread's short delta, credit targets, open-interest requirements, spread-width limits, and other liquidity filters.
- **Evaluate both sides correctly.** Both mode pairs put and call structures that share an expiration and measures the combined eight-leg payoff, rather than adding two standalone maximum-loss figures that cannot occur at the same settlement price.
- **See the trade before handing it off.** Results include expiration payoff, risk graphs, estimated probabilities of touching and finishing beyond key strikes, and an early-close estimate. A selected structure can be sent directly to Option Trade Tracker with its legs and assumptions intact.

Probability and early-close figures are model estimates based on the current implied-volatility inputs. They exclude commissions, slippage, assignment effects, volatility changes, and jumps.

### Dividend Calendar Month View

Dividend Calendar now has a **Month** tab that presents every payment inside its calendar day, with the ticker, fund or company name, expected amount, yield, confirmation status, daily total, and monthly total visible together.

- **The calendar follows the selection.** An individual account sees only its holdings. An Owner selection includes its linked accounts once, without duplicating the Owner snapshot, and an aggregate uses only its configured members. Different users and accounts therefore see their own tickers and payment amounts.
- **Imported transactions improve historical dates.** Actual dividend transactions can establish recurring pay-date patterns for that account, including weekly schedules, ordinal weekdays, and month-end or one-business-day-before-month-end behavior. Future estimates in an import are not treated as actual history.
- **Confirmed schedules remain authoritative.** Issuer dates and saved pay dates take priority over inferred transaction patterns, preventing a late broker-posting date from moving a known payment.
- **No import is required.** When a user has no dividend transactions, the existing schedule and income data remain the fallback. The calendar uses known ex-dividend/pay-date relationships, payment frequency, and annual-income estimates, and marks projected amounts with a tilde so they are not mistaken for confirmed cash.
- **Dense months stay usable.** Day cells expand to show all matching tickers instead of hiding the additional holdings behind a summary count.

## New in v1.33.10

### Monthly Expenses Now Agree Across Retirement Readiness and Cash Flow

Retirement Readiness reported a higher monthly expense figure than Cash Flow & Sustainability, and the expenses table on Cash Flow did not add up to the total printed above it. Four separate causes sat behind that, and all four are fixed.

- **Your bills are counted at the amount you entered.** The plan applied its expense inflation from each bill's "Active from" date forward to the month being viewed, so a bill entered last month was already reported as costing more than it does. Eighteen bills adding to $5,135.00 were reported as $5,147.65. The month you are looking at now charges exactly what its table lists, and expense inflation applies only to projected future months — a twelve-month projection still grows at the rate you saved. This also stops a plan drifting further from its own entries the longer it goes untouched.
- **Inflation is no longer charged twice.** Retirement Readiness fills its monthly expense box by averaging the next twelve months of your plan, and that average already carried inflation, which Retirement Readiness then applied again across its own twenty-year projection. It now reads those twelve months in today's money, so quarterly and annual bills are still smoothed into a monthly figure but nothing is inflated before the projection starts.
- **Cash Flow shows cents.** The summary cards and section totals rounded to whole dollars while Retirement Readiness showed cents, so identical figures looked like different ones. The monthly totals now carry cents. Multi-year scenario results stay in whole dollars, since those are modelled rather than counted.
- **Portfolio totals are added at full precision.** Cash Flow rounded each holding before adding them up, leaving its portfolio value and annual income a few cents below the same portfolio measured on Retirement Readiness.

Monthly expenses, portfolio value, portfolio income, other income, and the portfolio funding need now read the same on both screens. The funding need labelled "this month" also matches the twelve-month normalized figure beside it whenever your bills are all monthly, instead of sitting below it.

## New in v1.33.9

### Back Up and Restore Your Cash-Flow Plan

Every expense and income entry on Cash Flow & Sustainability is typed in by hand and exists nowhere else, so losing the database meant re-entering all of it. A new **Save or restore this plan** section downloads a copy and loads one back.

- **Download backup (.json)** is the complete plan: every expense and additional-income entry, saved-off entries, paid checkmarks, per-month amount edits, and the saved assumptions — horizon, expense inflation, portfolio tax, cash reserve, and surplus handling.
- **Download spreadsheet (.csv)** is the same entries in a form Excel opens, for reviewing or bulk editing. Entries only; paid history and assumptions are not in it.
- **Add to this plan** loads a file alongside what is already saved and skips entries that already match, so re-importing your own export changes nothing. **Replace everything** clears the plan first and then loads the file, restoring the saved assumptions from a .json backup, and asks for confirmation naming the file and the count being deleted.
- An import is all-or-nothing. A single unreadable row rejects the whole file and lists every problem by line number, in file order, leaving the plan untouched — a restore that loaded the readable half would leave a plan that looks complete and is not.
- A hand-edited spreadsheet works as long as it has Type, Name, and Amount columns. Headings are matched loosely, dollar signs and commas in amounts are accepted, and dates can be written either as 2026-08-15 or 8/15/2026.
- A plan that borrows its bills and income from another selection can be backed up — the file holds the entries actually being modelled — but not imported into, since those entries belong to the selection that owns them.

### The Spreadsheet Separates a Bill's Anchor From Its Next Occurrence

The expenses table shows the upcoming bill under the heading "Due date", while the file has to carry the date the recurrence is anchored to or each restore would walk the whole schedule forward. Both are now present and named for what they are: **Due date (recurring)** and **Pay by (recurring)** are saved and restored, and **Next due** is the upcoming occurrence as of the moment the file was exported, written for reading only.

### The Due Date Is No Longer Hidden Behind a Toggle

Adding an expense pre-filled its due date with the 1st of the month being viewed and kept the field inside a collapsed **Dates, taxes, inflation and notes** drawer, so a bill anchored to the 1st unless someone opened the drawer and noticed. That anchor drives every future occurrence, the pay-by date, and the calendar.

- Due date now sits in the main row beside Amount and Frequency, and starts empty so it has to be entered. Pay by still fills itself in two days earlier and can still be changed.
- Changing the viewed month no longer rewrites a due date. Only "Active from" follows the month now, so switching months cannot quietly re-anchor a bill or discard a date already typed.

### Help

- Added a **Backing up and restoring your plan** section under Cash Flow & Sustainability in Help, covering both file formats, the difference between adding and replacing, what a hand-edited spreadsheet needs, and why the anchor and the next occurrence are separate columns.

## New in v1.33.8

### Daily, Weekly & Monthly Payments

A day-by-day record of what the holdings actually paid, rather than only a monthly or annual total. Four "as of today" cards sit above a month browser, so the live figures never change depending on which month is being read below.

- Week-to-date and month-to-date are running totals over the daily rows, so the column reads as a balance rather than a series of unrelated numbers. A quiet day carries the total forward instead of showing zero or a gap, and color distinguishes a day that added money from one that only carried.
- The ledger window pads out to whole weeks rather than clipping to the month. A week straddling a month boundary needs its adjacent-month days present or its seven-day total is simply wrong; those rows are marked as belonging to the neighboring month and left out of the month-to-date column.
- Projected payments are kept separate from money actually received. Actual and estimated totals are carried alongside the combined figure at every level, and projections can be excluded outright.
- Payments are recorded against the account that received them, so the Owner view reports the accounts underneath it and breaks the month total back out per account, rather than reading Owner literally and returning an empty page.

### Retirement Readiness and the Freedom Simulator Use Your Cash-Flow Plan

Retirement Readiness had every input hardcoded — $4,500 of expenses and no income — and never read the budget you had already entered, so a saved plan and its Social Security entry could not reach the model.

- Retirement Readiness now seeds expenses, per-category inflows, and the plan's own assumptions — horizon, expense inflation, portfolio tax, cash reserve, and surplus handling — from your saved cash-flow plan. A selection with no entries falls back to the defaults, so one account's numbers are never left on screen while another is selected.
- The Freedom Simulator's monthly freedom target now comes from the plan rather than defaulting to $5,000. It is the same quantity the plan already works out: expenses less the income that does not come from the portfolio.
- Household bills belong to a person rather than to a brokerage account, so a plan can now borrow another plan's line items. Sub-accounts included in Owner link themselves, including accounts and plans created later, and only empty, unlinked plans are ever touched. Borrowed entries are shown read-only, since edits still apply to the account that owns them.
- Fixed a stuck "Cash-flow plan not found" banner sitting over data that had loaded correctly. Changing the account selection could let the previous request answer against the new selection.

### Option Trades

- Added expired-leg reconciliation. A broker's trade-activity export contains only fills, so an option that simply expires produces no record and the trade sat open forever — 302 legs across 131 trades on a real book, the oldest more than 1,386 days past expiration. The ledger now lists every stale leg and settles all of them at once or one trade at a time.
- Each expiration is recorded on the date it actually happened. Realized P/L is attributed by closing date and the holding period measures to it, so settling a 2024 expiration no longer books it into the current month or reports it as held for two extra years.
- The summary cards now describe the rows the filters leave behind. Narrowing the ledger to one ticker, status, purpose, or year restates open risk, realized P/L, win rate, and profit factor for that slice instead of continuing to report the whole account.
- Added a year filter, and the two realized cards follow it all the way: **All years** reports every date on record, the current year reports year-to-date, and an earlier year reports that year and its December in place of year-to-date and month-to-date. A trade counts under both the year it opened and the year it closed. The year list always offers the current year, so it rolls forward each January on its own.
- Fixed the realized card reporting only the current year while **All years** was selected. It sat beside a win rate and profit factor covering every trade, and disagreed with the realized total in the totals row directly below it. Those three now describe the same set of trades.
- Added a totals row under the ledger. Money is summed; percentages are not, so return on risk is recalculated from the summed dollars and the annualized columns pool profit over risk-years — averaging the row percentages produced nonsense, because a trade closed after one day annualizes to an enormous number.
- Froze the ledger's column headers, its totals row, and the columns through Entry, so a trade keeps its ticker, strategy, dates, and opening price while the result columns are scrolled into view on a screen the full width does not fit.

### Installation Fix

- Fixed a new installation failing to finish building its database. A migration ran before the table it reads from was created, which left the schema half built on a fresh install while an existing database was unaffected.

### Realized Gain Repair

v1.33.5 corrected how cost basis is calculated, but a database created before it still carried the old, inflated gains, and nothing in the application said so. Correcting them is now a screen rather than something only a new import could reach.

- Added a Realized Gain Repair panel to the Import screen. **Check for Problems** reports how many past sales are recording their entire proceeds as profit — the signature of a sale costed against a missing basis — with the amount and the tickers involved. **Recalculate Realized Gains** rebuilds the gain or loss on every past sale from your transaction history.
- Added an Action Center item that raises the same finding without being looked for, and clears itself once the recalculation has run. If a sale genuinely had no cost, the item can be marked done and stays gone.
- **Expect your reported realized gains to fall.** The inflated figures were wrong. Most sales come back with a correct basis; where none can be recovered the gain is left blank rather than invented, and the Annual Tax Report leaves those out of its totals rather than counting the proceeds as profit.
- The recalculation reports what actually changed — sales corrected, proceeds involved, and how many now show no gain — rather than only stating that it ran.
- A database backup is taken first, and a backup that could not be written now says so plainly instead of being reported as if it existed. Only the recorded gain is rewritten: shares, prices, holdings, and lot assignments are left untouched, so the recalculation can be run as often as you like.

### Supplying a Missing Cost Basis

A recalculated sale that still has no basis needs a number that only you have. The application now shows which ones, where they are, and what would fix each.

- Added a cost basis panel to the transaction window on Manage Holdings. It reports how many sales on that position have no gain and how much in proceeds they represent, then distinguishes the two reasons that happens, because they need opposite remedies.
- Shares transferred in from another broker arrive with no price. The panel offers to set what those shares originally cost, and the sales behind them recalculate on save.
- A position that sold more shares than its imported purchase history covers has no purchase to correct at all. The panel shows the arithmetic — shares bought against shares sold and transferred out — and offers to record the missing opening lot at a cost you supply, or points to importing the missing history instead.
- Everything is reported per account. A holding's transactions can span linked accounts while changes apply to one, so the panel names the account that owns each gap and asks you to switch rather than offering an action that cannot take effect there.
- Positions needing a basis are usually closed and so appear nowhere on the holdings table. The repair result now links directly to each one, and those links open the position's transaction window even when the position is long gone.
- The "needs cost basis" marker on a transaction is now clickable and opens that transaction for editing.

### Help

- Added an illustrated **Realized Gain Repair** section under Admin in Help. It covers what the correction fixes, how to tell whether your portfolio is affected, what to expect from the recalculation, and exactly what information you need to supply for each of the two cases that need it — including the warning that an estimated opening lot produces an estimated gain that should not be used for tax filing.

## New in v1.33.5

### Cost Basis Lost to Transfers, Emptied Lots, and Cash Sweeps

A sale whose cost basis could not be established was priced at zero, so the entire proceeds were booked as capital gain. On the development portfolio that invented $1.94M of gains across 273 sells. Three separate routes reached that state, and all three are fixed.

- Fixed shares transferred in from another broker being treated as free. A transfer arrives in the broker's activity export as a purchase with no price on the row, which was indistinguishable from shares that genuinely cost nothing, and the transfer check was never reached for incoming shares at all. They now resolve against the position's carried-over basis — the same source outgoing transfers already used.
- Fixed sales that follow a transfer out. Moving shares away empties the lot history, so every later sale found nothing to cost against. That was handled only while a holding row survived to read a basis from; a position since closed fell through to zero. One holding booked $9,761.21 of proceeds as $9,761.21 of profit that way.
- Fixed cash sweep and money market positions. Cash reaches them by routes the activity export never files as a purchase, so the ledger records far more shares sold than bought. Rather than special-case those funds, a position whose every recorded purchase happened at one price now uses that price as its basis — true of a $1.00 sweep fund, equally true of anything bought repeatedly at one price. All eight sweep funds now correctly report no gain.
- Where a cost basis genuinely cannot be recovered, the sale now reports none rather than a fabricated one. The Annual Tax Report flags those lots, excludes them from its totals instead of counting the proceeds as profit, and states how many lots and how much in proceeds need attention and how to supply it.
- The Annual Tax Report walked the lots itself and carried all three defects independently, so it is corrected alongside the rest of the application and the two now agree.
- Added an Originally Acquired date to buy transactions on Manage Holdings, for shares transferred in from another broker. A transfer's transaction date is the day the shares landed at the receiving broker, but the capital-gains holding period carries over from the delivering one, so long-held positions read as short-term for a year after any account move. Leaving it blank keeps the existing behavior, and existing transactions are unchanged.
- Added a backend cost-basis report and repair that lists the positions needing attention and replays them, rewriting only the stored realized gain, so an existing database can be corrected without re-importing.
- Added regression coverage for all three routes, the carried-over holding period, and the repair.

### Realized and Combined Positions on Total Return

- Added a Positions toggle with Unrealized, Realized, and Combined views. Open positions answer how a holding is doing; a position that has been sold answers a different question and previously had nowhere to be shown.
- Realized rows are scoped by sell date rather than by the holding window, so a position sold inside the selected period appears in it regardless of when it was bought. The view reports Sell Date, Shares, Cost Basis, Proceeds, Price Return, Distributions, and Total Return, and its gain or loss reconciles to the transaction ledger to the cent.
- Combined shows one row per ticker, adding realized sales to open performance. Net return stays money-weighted.

### Gains & Losses, Growth, and Comparer Charts

- Rolled up realized sells by ticker on Gains & Losses. The tab listed one row per fill, so a ticker sold across weekly assignments or DRIP lots flooded it with hundreds of near-identical rows. It now shows one row per ticker with the individual sells behind an expander, weighted buy and sell prices, and the sell date collapsed to a first-to-last range.
- Added portfolio and benchmark return cards to Growth and Portfolio Growth 2, so the returns are stated outright instead of the chart being the only place to read them. Both index charts are normalized to 100 at the start of the window, so each card is derived from the last plotted value and cannot drift from the line it summarizes.
- Both charts now open their hover readout on the newest date, so the latest values are legible without moving a mouse over the chart.
- Gave the ETF Comparer and Stock Comparer fourteen series colors instead of seven. The eighth ticker was handed the same blue as the first and the ninth the same orange as the second, and the chips, the swatch column, and the chart all agreed on the wrong answer, so two funds were indistinguishable everywhere. Every color in the replacement set is legible against both the light and the dark chart background and separable from its neighbors for color-blind readers; past fourteen tickers a color returns lighter rather than pixel-identical.

## New in v1.33.4

### Diversification X-Ray on a New Installation

The X-Ray screen still reported "no holdings data" for every position on a newly installed copy, even though the same holdings resolved correctly when running from source. The look-through code was never the problem: the built-in fund data it depends on was only written during a refresh run, so a computer that had never completed one started with nothing to look through.

- Fixed X-Ray showing every fund as an unresolved gap on a new installation. The built-in issuer registry, the economic-exposure definitions for funds that hold Treasury bills instead of the asset they track (Gold, Silver, Bitcoin, Ethereum, Solana), and the wrapper-fund definitions are now installed when the backend starts, not only part-way through a refresh. Those holdings appear correctly the first time the screen is opened.
- X-Ray now resolves itself automatically the first time it is used on a computer that has never downloaded fund holdings, and shows its progress while it works. Every later refresh remains a deliberate choice.
- Fixed the installed application charting every account at once. The X-Ray screen could not read the selected portfolio once packaged and silently fell back to all accounts combined, so the totals belonged to a portfolio the account selector was not showing.
- A resolve that fails now says so. A failure before the first fund was fetched previously left the screen looking exactly like a refresh that had never been requested, and a run where no fund publisher could be reached said nothing at all — that now reports a likely internet or firewall block instead of appearing to be broken fund data.
- Fixed a screen with no fund holdings yet advising that the funds be defined by hand. It now distinguishes a cache that has not been filled from funds whose issuers genuinely publish nothing, and offers the right action for each.
- The release build now verifies on a brand-new database that the packaged installer arrives with its fund issuer registry, economic exposures, and wrapper definitions already present, before the installer is published.

## New in v1.33.3

### Installed Build Fixes

These problems only appeared in the installed application, never when running from source.

- Fixed the installed backend failing to start. It created its uploads folder next to the program files, which Windows keeps read-only for a standard user, so the backend exited before the app could reach it.
- Fixed the desktop launcher attaching to the wrong backend. It previously only checked that something answered on the local port, so an already-running copy could be adopted by mistake. Each launch now issues its own identity token and waits for that exact backend, and reports a startup failure instead of hanging if the backend exits.
- Fixed the Diversification X-Ray screen returning no fund holdings in the installed build. The look-through module could not reach the running application's data fetchers once packaged, so every fund resolved as undisclosed.
- Added the Diversification module to the packaged build inputs, which had been left out of the installer definition, the build script, and both CI build steps.
- The release build now smoke-tests the packaged X-Ray seed and fund routes and the packaged backend's startup and health check before the installer is published.

### Interface Fixes

- Fixed a DRIP Matrix window on Manage Holdings that could not be closed. With no accounts included in Owner, or when the backend was unreachable, the window shrank far enough to clip its own Close button. It now keeps a minimum width, closes with Escape or a click outside, and shows a real message with a Retry option instead of an empty grid.
- Reordered the Options risk graph so the chart and its summary metrics appear directly under the controls, with the option chain picker and volatility scenario panel below them.
- Fixed the Bull Put Spread Scanner watchlist, where the status explanation overlapped the indicative spread, DTE, and warning columns.

## Desktop Deployment

- Added a GitHub Actions deployment path for Windows PC, Intel Mac, and Apple-silicon Mac installers from the same release workflow.
- Windows builds are signed through Microsoft Azure Trusted Signing using the public certificate profile for James Presser, so the installer, app executable, and bundled backend executable are Authenticode signed before upload.
- Added CI signature verification for the Windows installer, desktop executable, and packaged backend before the installer artifact is published. The build fails rather than publishing an unsigned or invalidly signed installer.
- The GitHub release now uses this full release description so Windows and Mac downloads share one complete feature and bug-fix summary.

## Everything Included From v1.33.x

The remainder of this description covers every change merged after v1.32.1: two new pages, portfolio-performance analysis, income planning, options research, imports, market-data reliability, layout improvements, and automated coverage.

## New Pages

### Put Selling Scanner

- Finds large-cap stocks, mid-cap stocks, index ETFs, and sector or commodity ETFs whose selloff is unusually large relative to their own pre-decline volatility.
- Ranks candidates with a transparent 100-point score across dislocation, premium, quality, and stabilization, with grades and a full score breakdown.
- Pulls option chains for leading candidates and suggests an expiration and put strike near the selected DTE and delta targets.
- Shows bid/ask, premium per contract, required cash, raw and annualized cash return, estimated probability of expiring out of the money, and effective basis if assigned.
- Supports Conservative, Balanced, and Aggressive presets plus custom universes based on built-in lists, holdings, watchlists, or pasted tickers.
- Treats earnings as an event risk: it first looks for an expiration before earnings and can exclude candidates when no safe expiration is available.
- Adds an in-page Stock and ETF Analysis price-chart popup with candles or line view, 50/200-day moving averages, volume, MACD, RSI, and periods from three months to five years.
- Adds dedicated in-app help, scoring documentation, workflow guidance, screenshots, and warnings. The scanner is analysis-only and does not execute trades.

### DRIP vs. Cash Analyzer

- Replays actual prices and distributions over one common date window to compare 100% reinvestment, 50% reinvestment, and taking all distributions as cash.
- Supports named saved sets, editable ticker chips, up to 75 unique symbols, cached results, and separate handling for funds with shorter histories.
- Reports price appreciation and CAGR, total return for all three reinvestment choices, initial and ending shares, ending values, covered yield, coverage, DRIP Score, reinvestment efficiency, win rate, and opportunity score.
- Adds Compounder, Harvester, Liquidator, Grower, Fading, and Broken verdicts plus DRIP, Take cash, Toss-up, Conflicted, and Unstable calls.
- Adds pinned table headers and ticker columns, result color grading, detailed hover definitions, uppercase ticker entry, expanded comparison columns, and complete illustrated help.

## Portfolio Performance and Dashboard

### Total Return

- Added a page-wide 7D, 1M, 3M, 6M, YTD, 1Y, 5Y, All, and Custom date selector. The selected range now controls the summary cards, return-by-ticker chart, comparison chart, return-vs-yield scatter plot, and holdings table together.
- Replaced the all-time summary with transaction-aware Start Value, End Value, Price Return, Distributions, Total Return, daily time-weighted Total Return %, and SPY cards for the selected period, with exact effective dates printed on every card.
- Rebuilt portfolio performance from dated buys and sells so trades change portfolio weights without appearing as gains or losses. Missing opening lots can be reconciled backward from current shares, and holdings without transaction history begin on their saved purchase or import/snapshot date instead of the ticker’s first-ever quote.
- Added an Entire Portfolio comparison line alongside individual holdings and external tickers.
- Expanded comparison modes to Total Return, Price Only, Price + Dividends held as cash, and Both. Matching colors and distinct line styles make price and reinvested-return traces directly comparable.
- Updated the holdings table for the selected period with Start Value, End Value, Price Return, Distributions, Total Return, Total Return %, and each holding’s exact Effective Range.
- Updated the scatter plot to use selected-period return and ending position value, improved signed hover values, and synchronized category filtering across the full page.

### Growth

- Replaced the limited 1Y/5Y/Max selector with the shared 7D, 1M, 3M, 6M, YTD, 1Y, 5Y, All, and Custom ranges. Custom dates are inclusive and validated before loading.
- All now begins at the portfolio’s first recorded trade rather than using older benchmark history, and the exact requested and effective dates are displayed above the analysis.
- Made the selected period and category filters apply consistently to the portfolio grade, Total Return %, Sharpe and Sortino metrics, price-return chart, dividend-reinvested total-return chart, ticker bar chart, and heatmap.
- Added a selected-period Total Return % card and effective-date labels to the grade and return cards.
- Aligned the portfolio grade with the Dashboard’s adjusted-price, current-value-weighted calculation so both pages produce the same grade for the same holdings and period.
- Changed Performance by Ticker from several fixed trailing periods to the currently selected period, with positive and negative bars color-coded for faster comparison.
- Clarified the indexed charts as Price Return Index and Total Return Index (Dividends Reinvested).

### Portfolio Growth 2

- Adopted the same shared 7D, 1M, 3M, 6M, YTD, 1Y, 5Y, All, and Custom period controls used by the other performance pages.
- Added synchronized Start Value, End Value, Total Profit, and Total Return % cards, each showing the exact effective range; End Value also identifies included cash.
- Kept the dollar-value chart, profit/loss chart, and headline cards on the same dates and ticker selection.
- Made All begin at the first recorded trade and use the same inception basis as “From the first trade,” removing an ambiguous second basis choice for that range.
- Prevented holdings from being backfilled into periods before they were owned, while anchoring the latest all-holdings value to the stored holdings and cash used by the Dashboard.
- Added inclusive custom-range validation and clearer requested-versus-effective date messaging.

### Dashboard and Shared Performance Updates

- Expanded Dashboard performance analysis with transaction-aware Start Value, End Value, Price Return, Distributions, Total Return, time-weighted Total Return %, and SPY comparisons.
- Synchronized the Dashboard period across metric cards, holding-return chart, comparison chart, scatter plot, and detailed holdings table.
- Improved portfolio and ticker comparison modes, including Total Return, Price Only, Price + Dividends, and Both, while preserving actual ownership dates and excluding deposits, purchases, and sales from performance.
- Restored Dashboard category filtering and synchronized saved holdings-column preferences across open windows.
- Added automatic migration for the Closure Risk column in older saved Dashboard column layouts.
- Froze the first five Dashboard holdings columns through Purchased so identifying details stay visible during horizontal scrolling.
- Recovered missing SPY/QQQ benchmark batches and falls back to the last good beta values instead of leaving Portfolio Beta blank.
- Fixed Dashboard holding synchronization, manual-edit refreshes, and Shear aggregate distribution data.
- Added explanations for Dashboard NAV warning colors and a Holdings DRIP-coverage summary.

## Income, DRIP, and Sustainability Planning

- Added per-ticker reinvestment percentages to Dividend Calculator, with global “apply to every ticker” and per-ticker “follow all-tickers %” controls.
- Corrected DRIP portfolio selection and ticker lookup in Portfolio Income Simulator.
- Fixed saved income-simulator scenarios, projection behavior, and NAV-erosion modeling.
- Counted Owner-direct holdings in Cash Flow & Sustainability without double-counting the same ticker from linked source accounts.
- Clarified cash-flow metrics and labels.
- Simplified the projected Price Impact chart to one annual-income line while keeping current-payout and selected-price markers.
- Improved DRIP-vs-cash comparisons and added precise hover explanations for every return and ending-value column.
- Updated Growth & Income Freedom planning and accumulation modeling, including new test coverage for long-horizon scenarios.

## Comparers, Research, and Fund Analysis

- Added a reusable ticker library to ETF Comparer and Stock Comparer with saved tickers and current portfolio holdings.
- Reworked Option-Income ETF Evaluator alternatives so they must beat the evaluated fund by at least two composite points and show a concrete advantage.
- Added matched-window CAGR comparisons, a side-by-side alternatives table with signed deltas, rank context, click-to-evaluate tickers, preloaded ETF Compare links, and a best-in-group empty state.
- Added split/rename artifact protection for NUSI/QQQH and removed dead NUSI from the option-income universe.
- Fixed the NUSI return-chart split discontinuity.
- Prioritized official XFUNDS issuer data for Security Research, including API-based fund profiles, distribution-rate fields, caching, ticker validation, and graceful continuation when Yahoo data is unavailable.
- Improved distribution cadence detection and increased logarithmic chart-hover precision across ETF, Stock, Security Research, and Distribution History views.
- Recovered individual tickers omitted from bulk price downloads.
- Unified portfolio performance periods and grades used by research and growth views.

## Options, Imports, Watchlists, and Scanners

- Updated the Option Trade Tracker with improved open-risk handling, realized-performance calculations, income classification, and a clearer execution ledger for multi-leg option positions.
- Added focused backend coverage for option trade tracker calculations and close/expire behavior.
- Added CBTX option-import parsing and automated coverage.
- Routed broker imports by each portfolio’s configured source so transactions and positions land in the correct account.
- Preserved frozen original cost basis during transaction rollups while allowing broker-adjusted basis to remain authoritative for broker-managed accounts.
- Fixed Watchlist expected dividend yields and froze Watchlist columns through Signal.
- Fixed the General Scanner default-universe TypeError, restored deterministic seeding, and added coverage for built-in and user-added single-stock ETFs.
- Cached the single-stock ETF list and lazily refreshed dependent option-income universes after Settings changes, eliminating hundreds of repeated database reads during scans.

## Calculation, Layout, and Reliability Fixes

- Corrected return and NAV-erosion calculations, including ownership windows, transfers, distributions, back-testing, and portfolio-level totals.
- Updated NAV Erosion and Portfolio NAV Erosion guidance and made the back-tester table fit its container without unnecessary horizontal scrolling.
- Fixed render crashes in Market Regime Analysis, Consolidation Simulator, Technical Scanner charts, and Portfolio Income Simulator error handling.
- Added an Unclassified panel to the Income Benchmark workflow so affected holdings can actually be reclassified.
- Added ESLint with `no-undef` as an error to catch the class of scope bug that caused those render failures.
- Improved import error handling and added broad backend and frontend regression coverage for the new calculations, pages, imports, scanners, caches, charts, and data-recovery paths.
- Added repository synchronization guidance to protect user and collaborator changes before future edits.

## Pages and Workspaces Updated

In addition to the three new pages, this release updates Dashboard, Total Return, Growth, Portfolio Growth 2, Growth & Income Freedom, Retirement Readiness, Cash Flow & Sustainability, Dividend Calculator, Portfolio Income Simulator, Option Trades, Manage Holdings, Manage Portfolios, Watchlist, ETF Comparer, Stock Comparer, ETF Analysis, Security Research, Option-Income ETF Evaluator, Options Strategy Lab, NAV Erosion, Portfolio NAV Erosion, Consolidation Analysis, Macro Regime Dashboard, Technical Scanner, Import, Reinvestment Impact, and Help.

## Complete Included Change List

The following commits are included after v1.32.1:

- Restore dashboard category filtering.
- Support CBTX option imports.
- Clarify cash-flow metrics and prioritize XFUNDS data.
- Fix return and NAV-erosion calculations.
- Fix render crashes from out-of-scope hook values.
- Add ESLint with `no-undef` to catch scope bugs.
- Make the NAV Erosion back-tester table fit its container.
- Add saved and portfolio tickers to comparers.
- Add per-ticker DRIP percentages with global override toggles.
- Make Option-Income Evaluator alternatives genuinely better picks.
- Fix the NUSI return-chart split discontinuity on both integrated development lines.
- Explain Dashboard NAV warning colors.
- Add the Holdings DRIP-coverage summary.
- Use XFUNDS data for Security Research.
- Merge the complete portfolio-growth development history into the default branch.
- Improve Dashboard synchronization and Total Return analysis.
- Freeze the first five Dashboard holdings columns through Purchased.
- Recover benchmark data so the Portfolio Beta card does not blank.
- Fix DRIP portfolio selection and ticker lookup.
- Fix income-simulator scenarios and NAV erosion.
- Count Owner-direct holdings in Cash Flow income.
- Simplify the Price Impact chart to one income line.
- Add the DRIP vs. Cash Analyzer page and help.
- Enhance DRIP-vs-cash comparisons.
- Explain DRIP return columns on hover.
- Recover tickers omitted from price batches.
- Fix distribution cadence and logarithmic hover precision.
- Fix Dashboard holding synchronization and Shear aggregate data.
- Fix Watchlist expected dividend yields.
- Freeze Watchlist columns through Signal.
- Stop transaction rollups from overwriting the frozen original basis.
- Fix the TypeError that broke the General Scanner default universe.
- Cache the single-stock ETF list and resolve its dependents lazily.
- Add repository sync-before-editing guidance.
- Force DRIP ticker input to uppercase.
- Route broker imports by portfolio source.
- Unify portfolio performance periods and grades.
- Add the Put Selling Scanner and income-planning updates.
- Update the Option Trade Tracker calculations, ledger behavior, and tests.
- Add signed Windows deployment and a shared PC/Mac GitHub release description.
- Fix duplicate option imports.
- Fix the unclosable DRIP Matrix window.
- Fix installed-build startup and Diversification X-Ray, and reorder the risk graph.
- Make Diversification X-Ray work on a newly installed copy.
- Add realized and combined position views to Total Return.
- Fix cost basis lost to transfers, drained lot queues, and cash sweeps.
- Roll up realized sells by ticker and pin the Growth chart hover.
- Give the comparers 14 series colors instead of 7.
- Surface the cost-basis repair and the basis it cannot recover.
- Feed the cash-flow plan into Retirement Readiness and the Freedom Simulator.
- Close option trades whose legs expired with no broker record.
- Run the cash-flow plan link migration after its table exists.
- Add the Daily, Weekly & Monthly Payments ledger.
- Scope the Option Trades summary to the ledger filters.
- Report every year on the Option Trades card when All years is selected.

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.32.1...v1.33.8
