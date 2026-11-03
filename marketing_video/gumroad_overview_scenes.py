"""Show-and-tell scene plan for the Gumroad Portfolio Tracker overview."""


def shot(path: str | None = None, *, weight: float = 1.0, privacy_boxes=None, kind: str | None = None):
    return {"path": path, "weight": weight, "privacy_boxes": privacy_boxes or [], "kind": kind}


SCENES = [
    {
        "id": "00-title", "kind": "title", "title": "Portfolio Tracker",
        "subtitle": "A complete show-and-tell overview — from daily results to long-term income goals.",
        "narration": (
            "Welcome to Portfolio Tracker. This is a show-and-tell tour of the actual screens, starting at the top of the "
            "Portfolio Dashboard and moving all the way through Total Return, Gains and Losses, Growth, Watchlists, and the "
            "Dividend Calculator."
        ),
    },
    {
        "id": "01-dashboard-top", "eyebrow": "PORTFOLIO DASHBOARD", "title": "Dashboard overview and shared range",
        "shots": [
            shot("marketing_video/dashboard_captures/01-headline-metrics.png", weight=8),
            shot("marketing_video/dashboard_captures/02-timeframes-and-alerts.png", weight=5),
            shot("marketing_video/dashboard_captures/03-nav-erosion-boxes.png", weight=5),
        ],
        "narration": (
            "We begin at the top of the current Portfolio Dashboard. The headline cards summarize the latest account movement, "
            "price return, and total return for open positions and for the complete tracker history. The shared performance date "
            "range keeps the Dashboard, Total Return, Gains and Losses, and Growth views aligned. Just below, the NAV erosion "
            "summary shows whether portfolio income has been supported by underlying value."
        ),
    },
    {
        "id": "02-dashboard-metrics", "eyebrow": "PORTFOLIO DASHBOARD", "title": "Risk and income metrics",
        "shots": [
            shot("marketing_video/dashboard_captures/04-grade-and-risk-boxes.png", weight=5),
            shot("marketing_video/dashboard_captures/05-income-and-yield-boxes.png", weight=6),
        ],
        "narration": (
            "The next dashboard group adds the current portfolio grade and risk context, including beta, alpha, drawdown, "
            "Sharpe, Sortino, Calmar, Omega, and related measures. The income cards bring together lifetime income, current-period "
            "dividends, forward monthly and annual estimates, reinvestment, yield on cost, and current yield."
        ),
    },
    {
        "id": "03-dashboard-history", "eyebrow": "PORTFOLIO DASHBOARD", "title": "Portfolio history and guidance",
        "shots": [
            shot("marketing_video/dashboard_captures/06-portfolio-value-chart.png", weight=6),
            shot("marketing_video/dashboard_captures/07-grade-exposure-guide.png", weight=5),
            shot("marketing_video/dashboard_captures/08-account-alpha-guide.png", weight=5),
        ],
        "narration": (
            "Portfolio Value Over Time displays the account history by day, week, or month and can switch between price return "
            "and total return. Directly below it, expandable guides explain the grade and exposure readings and show how account "
            "alpha is interpreted. These reference panels can stay collapsed during everyday use and open when more context is needed."
        ),
    },
    {
        "id": "04-dashboard-calendar", "eyebrow": "PORTFOLIO DASHBOARD", "title": "Income calendar and allocation",
        "shots": [
            shot("marketing_video/dashboard_captures/09-weekly-calendar.png", weight=5),
            shot("marketing_video/dashboard_captures/10-portfolio-all-categories.png", weight=5),
        ],
        "narration": (
            "Farther down, the weekly dividend calendar shows expected payments for each day and the estimated total for the week. "
            "The portfolio overview then breaks the account into categories, targets, current weights, and drift so allocations can "
            "be reviewed before opening an individual category."
        ),
    },
    {
        "id": "05-dashboard-holdings", "eyebrow": "PORTFOLIO DASHBOARD", "title": "Holdings overview",
        "shots": [
            shot("marketing_video/dashboard_captures/13-holdings-overview-controls.png", weight=5),
            shot("marketing_video/dashboard_captures/17-returns-table-view.png", weight=5),
        ],
        "narration": (
            "At the bottom of the Dashboard, the holdings overview can be filtered and switched among Common, General, Dividends, "
            "and Returns. The current Returns table separates current value, cost basis, distributions, realized results, and total "
            "profit for each position. This completes the top-to-bottom Dashboard tour."
        ),
    },
    {
        "id": "06-total-return", "eyebrow": "TOTAL RETURN", "title": "The complete Total Return screen",
        "shots": [
            shot("marketing_video/gumroad_current_captures/total-return-01.png", weight=7),
            shot("marketing_video/gumroad_current_captures/total-return-02.png", weight=7),
            shot("marketing_video/gumroad_current_captures/total-return-03.png", weight=7),
            shot("marketing_video/gumroad_current_captures/total-return-04.png", weight=7),
            shot("marketing_video/gumroad_current_captures/total-return-05.png", weight=7),
            shot("marketing_video/gumroad_current_captures/total-return-06.png", weight=7),
        ],
        "narration": (
            "The Total Return screen starts with the portfolio summary and a return-by-ticker chart. Price gain or loss and recorded "
            "distributions stay separate, while Total Return combines them into dollars and percentages. The benchmark line makes it "
            "easy to see which holdings finished above or below the comparison. Scrolling down, Performance Comparison places selected "
            "portfolio and outside tickers on the same normalized timeline, with controls for period and return type. The next chart "
            "plots total return against yield on cost, with bubble size representing position size and color representing category. "
            "The holdings table at the bottom exposes the numbers behind the charts: shares, price paid, current price, invested amount, "
            "current value, price gain or loss, distributions received, and total return for each ticker."
        ),
    },
    {
        "id": "07-gains-losses", "eyebrow": "GAINS & LOSSES", "title": "The complete Gains & Losses screen",
        "shots": [
            shot("marketing_video/gumroad_current_captures/gains-losses-01.png", weight=7),
            shot("marketing_video/gumroad_current_captures/gains-losses-02.png", weight=7),
            shot("marketing_video/gumroad_current_captures/gains-losses-03.png", weight=7),
            shot("marketing_video/gumroad_current_captures/gains-losses-04.png", weight=7),
            shot("marketing_video/gumroad_current_captures/gains-losses-05.png", weight=7),
            shot("marketing_video/gumroad_current_captures/gains-losses-06.png", weight=7),
        ],
        "narration": (
            "Gains and Losses opens with the accounting summary and a full position table. The cards separate total invested, current "
            "value, unrealized price gain or loss, unrealized results including dividends, realized price-only results, realized results "
            "including dividends, and the combined totals. Use the Unrealized, Realized, and Combined tabs to change the table without "
            "leaving the screen. As we scroll, the cumulative chart shows how price-only and dividend-inclusive results developed over "
            "time. The ticker comparison makes the difference between price gain and total gain visible for each holding. At the bottom, "
            "the winners-versus-losers chart ranks positions, and the realized-gains timeline shows when completed gains or losses were "
            "recorded."
        ),
    },
    {
        "id": "08-growth", "eyebrow": "GROWTH", "title": "The complete Growth screen",
        "shots": [
            shot("marketing_video/gumroad_current_captures/growth-01.png", weight=8),
            shot("marketing_video/gumroad_current_captures/growth-02.png", weight=10),
        ],
        "narration": (
            "Growth opens on the current Dollars tab with the shared performance date range. The cards connect the selected period "
            "with starting value, ending value, transaction-aware return in dollars, and the matching percentage. The first chart "
            "places portfolio value beside invested capital. The second separates price return from distributions and shows the "
            "combined tracker return. The Vs market and Lots tabs remain available from the same screen for benchmark and open-lot views."
        ),
    },
    {
        "id": "09-watchlists", "eyebrow": "WATCHLISTS", "title": "Create, organize, and review watchlists",
        "shots": [
            shot("marketing_video/gumroad_current_captures/watchlist-01.png", weight=10),
            shot("marketing_video/gumroad_current_captures/watchlist-02.png", weight=6),
        ],
        "narration": (
            "Watchlists keep research ideas separate from owned positions. The main page supports multiple named lists, and the Home "
            "badge identifies the list connected to the Dashboard. The current table shows the symbol and name, price, daily move, "
            "yield, five-year dividend growth, next ex-date, assets under management, one-year return, NAV status, notes, and actions. "
            "Use Add Stocks to extend the active list, Edit to change an item, or Remove to take it off the list. None of these research "
            "tickers are treated as portfolio holdings."
        ),
    },
    {
        "id": "10-watchlist-home", "eyebrow": "HOME WATCHLIST", "title": "Embed or remove the watchlist on the Dashboard",
        "shots": [
            shot("marketing_video/gumroad_current_captures/watchlist-01.png", weight=7),
            shot("marketing_video/gumroad_current_captures/dashboard-watchlist-01.png", weight=10),
        ],
        "narration": (
            "The Watchlists page controls whether the current Watchlist is embedded in the Dashboard. Check Show the watchlist on the "
            "Dashboard, and the list marked Home appears as this live Dashboard card. When several lists exist, the picker in the card "
            "chooses which list is displayed. The card shows symbol, name, price, daily change, and yield, with links to edit the list. "
            "Click Hide on the card, or clear the setting on the Watchlists page, to remove it from the Dashboard. The saved lists, "
            "tickers, and notes remain intact."
        ),
    },
    {
        "id": "11-dividend-portfolio", "eyebrow": "DIVIDEND CALCULATOR", "title": "Set a portfolio growth target",
        "shots": [
            shot("marketing_video/gumroad_current_captures/dividend-portfolio-01.png", weight=10),
            shot("marketing_video/gumroad_current_captures/dividend-portfolio-02.png", weight=8),
            shot("marketing_video/gumroad_current_captures/dividend-portfolio-03.png", weight=8),
            shot("marketing_video/gumroad_current_captures/dividend-portfolio-04.png", weight=7),
            shot("marketing_video/gumroad_current_captures/dividend-portfolio-05.png", weight=7),
        ],
        "narration": (
            "The current Dividend Calculator is a full planning workspace. Add tickers individually or load selected holdings from a "
            "portfolio, then review the current monthly and annual payout at the top. In Portfolio Growth mode, enter a target portfolio "
            "value and projection length. Contributions can be annual or monthly, continue for the full period or stop after a limited "
            "window, and be split evenly or by custom percentages. Price growth, dividend reinvestment, taxes, and inflation remain "
            "editable. The goal banner reports when the target is reached, and the chart compares nominal value, today's dollars, and "
            "the target. Scrolling down shows result cards, the return breakdown, shares over time, growth projections, the year-by-year "
            "table, and final values for each ticker."
        ),
    },
    {
        "id": "12-dividend-income", "eyebrow": "PORTFOLIO PAYMENTS", "title": "Set an income and payment target",
        "shots": [
            shot("marketing_video/gumroad_current_captures/dividend-income-01.png", weight=10),
            shot("marketing_video/gumroad_current_captures/dividend-income-02.png", weight=8),
            shot("marketing_video/gumroad_current_captures/dividend-income-03.png", weight=8),
            shot("marketing_video/gumroad_current_captures/dividend-income-04.png", weight=7),
            shot("marketing_video/gumroad_current_captures/dividend-income-05.png", weight=7),
        ],
        "narration": (
            "Switch to Income Growth when the objective is portfolio payments rather than account size. Enter the target annual income, "
            "and the banner shows whether that payment target is reached within the projection. The Annual Income Growth chart compares "
            "nominal income with inflation-adjusted income and marks the target line. The result cards translate the plan into total "
            "income, monthly income, annual income, portfolio value, yield on cost, current yield, and estimated taxes. The lower charts "
            "and tables show how portfolio value, payments, cumulative dividends, shares, and per-ticker results change over time."
        ),
    },
    {
        "id": "13-outro", "kind": "outro", "title": "One connected view of the portfolio",
        "subtitle": "Monitor results. Research ideas. Plan growth and income.",
        "narration": (
            "That is the show-and-tell overview of Portfolio Tracker: the complete home dashboard, return and gain analysis, growth and "
            "benchmark views, flexible watchlists, and portfolio-growth and income targets. For informational purposes only. Not "
            "financial advice."
        ),
    },
]
