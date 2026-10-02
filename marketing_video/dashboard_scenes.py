"""Scene plan and narration for the detailed Portfolio Dashboard video."""

SCENES = [
    {
        "id": "00-title",
        "capture": "01-headline-metrics.png",
        "eyebrow": "PORTFOLIO TRACKER",
        "title": "The Portfolio Dashboard",
        "subtitle": "A complete guide to every section, control, and view.",
        "kind": "title",
        "narration": (
            "Welcome to the Portfolio Tracker dashboard. This is the day-to-day command center for the account: "
            "performance, income, risk, allocation, upcoming payments, and holding-level detail on one page. "
            "In this walkthrough, we will examine the entire dashboard, explain what every group of boxes is showing, "
            "and work through the chart controls, date ranges, calendar, category drilldowns, and all four table views."
        ),
    },
    {
        "id": "01-headline",
        "capture": "01-headline-metrics.png",
        "eyebrow": "ACCOUNT SNAPSHOT",
        "title": "Headline value and return boxes",
        "subtitle": "Separate the full account, tracker history, and open positions.",
        "narration": (
            "At the top, the page identifies the active account and the number of holdings included. Portfolio Value is the full account today: open holdings plus any idle cash. Account Change is the move from the previous market close to the latest observation, with both dollars and percent. "
            "Tracker Price Return measures price performance for every position held at any time in the selected range, including positions that were completely sold during that window. Open Lots Price Return narrows the calculation to positions still owned now. Open Lots Total Return uses that same open-position scope, then adds distributions. Tracker Total Return adds distributions to the broader tracker history, including qualifying fully closed positions. The dates under each return box show the exact data window actually used."
        ),
    },
    {
        "id": "02-timeframes",
        "capture": "02-timeframes-and-alerts.png",
        "eyebrow": "SHARED DATE RANGE",
        "title": "One range, several different questions",
        "subtitle": "Presets, Lifetime cost basis, and an inclusive Custom window.",
        "narration": (
            "Above the date controls, compact warnings surface fund-closure risk and any Action Center items that need review. The Shared Performance Date Range then controls performance throughout the dashboard and stays synchronized with Growth, Total Return, Gains and Losses, and Holdings. "
            "One Day means the move since the previous close. Seven Days goes back exactly seven calendar days. One, Three, and Six Months use the same calendar day in the earlier month. Year to Date starts from the final close on or before January first. One Year and Five Years use calendar-year lookbacks. All begins with the portfolio's first recorded trade and runs a time-weighted tracker replay. Life asks a different question: current value minus cost basis for shares still held, matching Holdings. Custom uses the inclusive start and end dates you enter. Except for Life, each range ends at today's live quote when available, otherwise the most recent close."
        ),
    },
    {
        "id": "03-nav-risk",
        "capture": "03-nav-erosion-boxes.png",
        "eyebrow": "INCOME SUSTAINABILITY",
        "title": "Read the NAV erosion boxes together",
        "subtitle": "Coverage, raw price change, distributions, and total return.",
        "narration": (
            "The NAV erosion row asks whether portfolio income has been supported by underlying value. Overall Verdict combines the raw NAV decline, the payout gap, benchmark-gated coverage, and relative drag into a historical risk score. The adjacent coverage verdict translates the benchmark-gated result into Low, Moderate, or High. "
            "Yield-Funding Coverage divides qualifying price-loss dollars by distributions; lower is better. Raw NAV Erosion, labeled e, ignores the benchmark and shows the direct principal change. Positive e means NAV fell, zero means it was flat, and negative means NAV rose. Distribution Rate, d, is cash distributions divided by starting NAV. Accounting Total Return, r, is the NAV change plus distributions. These three reconcile through e equals d minus r. The expandable guide immediately below explains the symbols, colors, benchmark gate, and cases where a zero coverage value can still carry a warning."
        ),
    },
    {
        "id": "04-grade-risk",
        "capture": "04-grade-and-risk-boxes.png",
        "eyebrow": "RISK AND QUALITY",
        "title": "Grade, exposure, and risk-adjusted results",
        "subtitle": "Every box follows the selected market window.",
        "narration": (
            "The next strip grades the portfolio over the selected market window. Portfolio Grade is the composite letter and score. Portfolio Beta estimates sensitivity to the selected benchmark; switch between the S and P 500 and Nasdaq to see which comparison is useful. A beta of one moves roughly with the benchmark, below one is less sensitive, and above one is more sensitive. The dollar line estimates the account impact of a one-percent benchmark move. "
            "When sufficient transaction and daily-value history exists, Account Alpha shows the annualized return beyond what that beta would predict. Ulcer Index focuses on the depth and duration of drawdowns, so lower is better. Calmar compares annualized return with maximum drawdown. Omega compares gains above the threshold with losses below it. Sortino penalizes downside volatility, while Sharpe measures return per unit of total volatility. One Day and Seven Days can be too short for meaningful annualized ratios, and Life produces no grade because cost-basis gain or loss is not a daily price series."
        ),
    },
    {
        "id": "05-income-boxes",
        "capture": "05-income-and-yield-boxes.png",
        "eyebrow": "INCOME AND REINVESTMENT",
        "title": "Understand each income box",
        "subtitle": "Recorded cash, forward estimates, DRIP behavior, IRR, and yield.",
        "narration": (
            "The remaining boxes summarize income and cash-flow behavior. Lifetime Income is all supported distributions recorded for the account. Year-to-Date Dividends and the named current-month Income box are actual payments inside those periods. Estimated Monthly Income is the forward annual estimate divided by twelve, and Estimated Annual Income is the full next-twelve-month run rate. "
            "Estimated Monthly Reinvested, Estimated Monthly Not Reinvested, and Estimated Percent Reinvested split that forward run rate according to DRIP settings. The three current-month reinvestment boxes perform the same split using payments actually recorded so far this month. Portfolio IRR is money-weighted, so it reflects the timing of deposits, withdrawals, and cash flows; Manage Exclusions can remove selected holdings from that calculation. Average Yield on Cost compares annual income with purchase cost. Current Yield compares forward income with today's value. The S and P 500 box supplies current index level, daily move, and year-to-date context."
        ),
    },
    {
        "id": "06-value-chart",
        "capture": "06-portfolio-value-chart.png",
        "eyebrow": "ACCOUNT HISTORY",
        "title": "Portfolio Value Over Time",
        "subtitle": "Change sampling and return treatment without leaving the chart.",
        "narration": (
            "Portfolio Value Over Time turns recorded account snapshots into an equity curve. High, Low, and Current callouts identify the important visible points, and normal chart zooming can narrow the period under inspection. Daily shows every recorded trading-day value. Weekly keeps the last recorded value in each calendar week, and Monthly keeps the last value in each month, reducing noise without changing the underlying history. "
            "Price Return plots recorded portfolio value without adding dividend payments. Total Return adjusts earlier points for later deposits and withdrawals and includes distributions, so the rise toward today represents investment gain rather than added capital. Record NAV refreshes prices and dividends before saving the current account snapshot. Backfill History fills missing transaction-supported dates without changing recorded days. Repair Chart rebuilds previously backfilled points while preserving official snapshots and today's value."
        ),
    },
    {
        "id": "07-grade-guide",
        "capture": "07-grade-exposure-guide.png",
        "eyebrow": "REFERENCE GUIDE",
        "title": "Grade and exposure definitions",
        "subtitle": "See which periods grade, how beta reads, and how each metric is weighted.",
        "narration": (
            "The Grade and Exposure Guide is the dashboard's built-in legend. It separates the market windows that can produce a grade from very short ranges and from Life. It also explains the beta ranges used for conservative, balanced, aggressive, and very aggressive income portfolios. The table lists each graded metric, what it measures, the thresholds for letter grades, and its weight in the composite Portfolio Grade. Use this section whenever a letter changes after switching the date range: the grade is always describing that selected stretch, not a permanent label for the account."
        ),
    },
    {
        "id": "08-alpha-guide",
        "capture": "08-account-alpha-guide.png",
        "eyebrow": "ALPHA EXPLAINED",
        "title": "What Account Alpha does—and does not—mean",
        "subtitle": "A cash-flow-aware comparison with the account's market exposure.",
        "narration": (
            "Understanding Account Alpha explains the cash-flow-aware account calculation. The app rebuilds daily account return, removes deposits, withdrawals, and transfers, and compares the result with the benchmark the account tracks most closely. Positive alpha means the account earned more than its beta alone predicts; near zero means exposure explains most of the result; and negative alpha means it lagged that expectation. "
            "The guide also calls out the limitations. Short windows annualize a small sample and can swing sharply. The alpha card can use fewer dates than the selected range when imported transaction history begins later. Account Alpha is not the Alpha column for an individual holding, and it is not part of Portfolio Grade. If the card is unavailable, this section states which history or coverage requirement is missing."
        ),
    },
    {
        "id": "09-week-calendar",
        "capture": "09-weekly-calendar.png",
        "eyebrow": "THIS WEEK'S INCOME",
        "title": "Upcoming Dividends This Week",
        "subtitle": "Expected pay dates, daily totals, and holding-level payments.",
        "narration": (
            "The weekly calendar shows expected dividend pay dates from Monday through Sunday. The heading gives the exact calendar-week range, and Estimated Total adds every scheduled payment in that week. Each day displays its own total, followed by the paying holdings, expected dollar amount, and available yield context. Today's column is highlighted so the schedule is easy to orient. Empty days remain visible, making the timing and concentration of income obvious. Open Month Calendar moves to the full dividend calendar when you need a wider planning horizon or more payment detail."
        ),
    },
    {
        "id": "10-allocation",
        "capture": "10-portfolio-all-categories.png",
        "eyebrow": "PORTFOLIO STRUCTURE",
        "title": "Allocation by category",
        "subtitle": "Actual weight, invested amount, gain, target, and drift.",
        "narration": (
            "The Portfolio section combines an allocation donut with a matching table. At the All Categories level, each color represents one category and the slice size is its share of current holdings value. When category targets exist, the chart also visualizes under-target space. The table pairs each category's current Value with the amount Invested. Gain can show price return only, or total return with lifetime dividends and realized gains from trimmed shares. "
            "Target is the desired portfolio weight. Allocation is the current share of holdings value. Diff is Allocation minus Target: positive is overweight and negative is underweight. The item count under each category name shows how many holdings are contributing to that row."
        ),
    },
    {
        "id": "11-category-filter",
        "capture": "11-portfolio-category-drilldown.png",
        "eyebrow": "CATEGORY FILTERS",
        "title": "Drill from categories into sub-categories",
        "subtitle": "The chart and table always change together.",
        "narration": (
            "Choose a Category to focus the Portfolio chart and table. If that category contains sub-categories, the top-level rows become those sub-categories, plus an Unassigned bucket when needed. The label beside the filter shows how much of the entire account the selected parent represents. Selecting a Sub-category drills one level deeper again. Clear returns directly to the all-category view. Because sub-categories and individual holdings do not have category-level target weights, Target and Diff appear only where they are meaningful."
        ),
    },
    {
        "id": "12-holding-drilldown",
        "capture": "12-portfolio-holdings-drilldown.png",
        "eyebrow": "HOLDING DRILLDOWN",
        "title": "Inspect the positions inside a group",
        "subtitle": "Read weight inside the parent and weight inside the full account.",
        "narration": (
            "At the deepest level, the donut slices and rows represent individual holdings inside the selected category or sub-category. Value, Invested, and Gain now describe each position. Allocation remains the holding's percentage of the full portfolio, while the smaller second line shows its percentage of the selected parent. Switch Gain from Price Return to Total Return to add recorded distributions and realized trims; the row then identifies those included components. This view is useful for spotting which holdings are driving a category's size or result without leaving the dashboard."
        ),
    },
    {
        "id": "13-holdings-controls",
        "capture": "13-holdings-overview-controls.png",
        "eyebrow": "HOLDINGS OVERVIEW",
        "title": "Summary cards and row filters",
        "subtitle": "Four purpose-built tables share the same visible holding set.",
        "narration": (
            "The final section is a detailed holdings overview. Value totals the open holdings currently visible and shows their cost basis; cash is not included here. Total Profit combines open-position price gain or loss, supported lifetime dividends, and realized trims, with the percentage measured against invested basis. Passive Income is the estimated next-twelve-month dividends divided by current holdings value, with the annual dollar estimate beneath it. "
            "Category and Sub Category filter the visible rows. Show Sold adds fully closed positions where a view supports them. Search matches ticker, security name, or category, and the clear control resets the filters. Field Help expands definitions for every summary card and column. Edit on Holdings opens the page used to change lots and DRIP settings."
        ),
    },
    {
        "id": "14-common-view",
        "capture": "14-common-table-view.png",
        "eyebrow": "TABLE VIEW 1",
        "title": "Common view",
        "subtitle": "The broadest one-row summary for each holding.",
        "narration": (
            "Common is the broadest table view. It brings together the holding name and ticker, current grade, shares, average cost, current price, category and sub-category, cost basis, current value, forward dividends, current yield, estimated yield, five-year dividend growth, Paid for Itself, Total Profit, portfolio share, and the NAV testing control. Paid for Itself is lifetime distributions received as a percentage of original cost; one hundred percent means distributions have returned the initial amount invested. Use Common when you want a balanced snapshot without choosing a specialized analysis lens."
        ),
    },
    {
        "id": "15-general-view",
        "capture": "15-general-table-view.png",
        "eyebrow": "TABLE VIEW 2",
        "title": "General view",
        "subtitle": "Position size, basis, unrealized result, beta, alpha, and NAV settings.",
        "narration": (
            "General concentrates on position structure and market behavior. Status distinguishes open and sold rows. Shares, category, sub-category, and Share in Portfolio describe position size and placement. Average Cost, Current Price, Cost Basis, and Current Value show what was paid and what the position is worth now. Unrealized Gain and Unrealized Percent isolate price change on shares still held, excluding dividends and realized trims. Beta and Alpha follow the dashboard's shared performance window for the individual security. The NAV column lets you keep automatic testing, force a test, skip it, or assign a more appropriate benchmark symbol."
        ),
    },
    {
        "id": "16-dividend-view",
        "capture": "16-dividends-table-view.png",
        "eyebrow": "TABLE VIEW 3",
        "title": "Dividends view",
        "subtitle": "Forward income, yield, growth, cadence, and the next scheduled dates.",
        "narration": (
            "Dividends turns the table toward income planning. It retains the holding, shares, category, sub-category, and current value, then adds estimated next-twelve-month Dividends and annualized dividend per share. Dividend Yield shows current yield with yield on cost beneath it. Estimated Yield uses the forward income estimate and current value. Dividend Growth reports the five-year rate when source data is available. Paid for Itself tracks lifetime recovery of original cost through distributions. Next Payment, Ex-Dividend, and Frequency show when the holding is expected to pay, when eligibility is determined, and whether the cadence is weekly, monthly, quarterly, semiannual, or annual."
        ),
    },
    {
        "id": "17-returns-view",
        "capture": "17-returns-table-view.png",
        "eyebrow": "TABLE VIEW 4",
        "title": "Returns view",
        "subtitle": "See price gain, cash received, realized results, and total profit together.",
        "narration": (
            "Returns focuses on the pieces of profit. Cost Basis and Current Value frame the open position. Dividends Received is recorded lifetime cash. Paid for Itself expresses those distributions against original cost. Capital Gain is current value minus cost basis for open holdings, or proceeds minus cost for sold rows. Realized P and L is profit or loss already locked in from shares sold. Total Profit combines capital result, distributions, and realized trims. Share in Portfolio shows current weight, and NAV keeps the income-sustainability test beside the return result. This is the clearest view for separating price performance from cash income and completed sales."
        ),
    },
    {
        "id": "18-table-tools",
        "capture": "18-table-columns-and-totals.png",
        "eyebrow": "TABLE CONTROLS",
        "title": "Sort, reorder, hide, and total the table",
        "subtitle": "Each view remembers its own layout.",
        "narration": (
            "Every holdings view uses the same table tools. Click a column header to sort; click it again to reverse direction. Drag a header to move that column. Open Columns to reorder fields or hide the ones you do not need. The first column stays frozen for orientation when the table scrolls horizontally, and each of the four views remembers its own column layout. The footer totals the fields that can be meaningfully summed, such as shares, cost basis, current value, dividends, unrealized result, total profit, and dividends received. Filters also recalculate the summary cards and footer, so every number describes the rows currently on screen."
        ),
    },
    {
        "id": "19-outro",
        "capture": "10-portfolio-all-categories.png",
        "eyebrow": "PORTFOLIO TRACKER",
        "title": "From account summary to holding detail",
        "subtitle": "Monitor performance, income, risk, and allocation in one connected page.",
        "kind": "outro",
        "narration": (
            "That is the complete Portfolio Dashboard: headline account results, shared time frames, NAV and risk context, income tracking, account history, the weekly payment calendar, allocation drilldowns, and four customizable holding tables. Use the page from top to bottom for a full review, or jump directly to the section that answers today's question. Portfolio Tracker. See the whole portfolio, and understand what is driving it. For informational purposes only. Not financial advice."
        ),
    },
]

