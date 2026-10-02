"""Scene plan for the Growth workspace marketing walkthrough."""

from pathlib import Path


PUBLIC = Path(__file__).resolve().parents[1] / "public" / "help-screenshots"
GROWTH = PUBLIC / "growth"
LOTS = PUBLIC / "gains-losses"


def scene(key, title, subtitle, bullets, narration, image, *, crop=None, kind="screen"):
    return {
        "id": key,
        "title": title,
        "subtitle": subtitle,
        "bullets": bullets,
        "narration": narration,
        "image": image,
        "crop": crop,
        "kind": kind,
    }


SCENES = [
    scene(
        "00-welcome",
        "Growth: three complementary views",
        "Value, performance versus a benchmark, and lot-level accounting.",
        ["Dollars: what the account is worth", "Vs market: how holdings performed", "Lots: where gains and losses came from"],
        "Welcome to Growth in Portfolio Tracker. This workspace answers three related but different questions. Dollars shows what the account is worth and how its value changed. Vs market compares the selected holdings with a benchmark using transaction-aware returns. Lots separates the results that are still open from gains and losses that were already realized. In this walkthrough, we will explain every tab, the summary bubbles, and the charts that turn account history into a clear performance story.",
        GROWTH / "growth-tabs-current.png",
        kind="title",
    ),
    scene(
        "01-workspace",
        "One shared range across all three tabs",
        "The selected scope keeps the three readings comparable.",
        ["Dollars, Vs market, and Lots", "Shared date presets plus Custom", "Ticker and category filters narrow the scope"],
        "Start with the controls at the top. Dollars, Vs market, and Lots are three views of the same selected account and performance range. The date presets run from one day through five years, All, Life, and Custom. Except for Life, returns end at the latest market observation. Life is different: it is cost-basis gain and loss rather than a market-return window. With the same account, holdings scope, and date range, Tracker Total Return percent is designed to reconcile across Growth, Total Return, Dashboard, and Gains and Losses after the close.",
        GROWTH / "growth-tabs-current.png",
    ),
    scene(
        "02-dollars-bubbles",
        "Dollars: value and cash-flow-adjusted return",
        "Read the account total separately from investment performance.",
        ["Start and End Value include account cash", "Tracker Total Return $ excludes deposits and trades as performance", "Tracker Total Return % is the shared return measure"],
        "The Dollars tab begins with the account-level bubbles. Start Value and End Value are the account values at the two ends of the selected window. They include tracked cash, and the account reading can also include open-option value when shown. Tracker Total Return dollars is different. It is the cash-flow-adjusted investment result: price return plus distributions, without treating deposits, purchases, or sales as investment gain. Tracker Total Return percent expresses that same return as a percentage, making it the best number to compare with the other Growth tabs and the Total Return screen.",
        GROWTH / "dollars-tab-current.png",
        crop=(0, 0, 2400, 1500),
    ),
    scene(
        "03-dollars-charts",
        "Dollars: follow value, price movement, and distributions",
        "The curves explain why account value and return are not the same thing.",
        ["Portfolio value is the account history", "Invested cost basis is optional context", "Transaction-aware return separates price and distributions"],
        "Below the bubbles, Portfolio Value plots the account over time. The portfolio line follows recorded value, while the optional invested line provides cost-basis context. It is an account-value chart, so deposits, withdrawals, cash, and purchases can move it. The Transaction-Aware Return chart answers a cleaner investment question. Its price-return line shows market movement only. Its distributions line records income, and the tracker-total line combines the two without counting cash flows as performance. Toggle between return percent and amount when you want a normalized rate or the matching dollar result.",
        GROWTH / "dollars-tab-current.png",
        crop=(0, 1030, 2400, 2550),
    ),
    scene(
        "04-vs-market-bubbles",
        "Vs market: compare the same holdings fairly",
        "A benchmark changes the comparison, not the portfolio result.",
        ["Choose a benchmark such as SPY", "Cards use the selected date range and holdings", "Open-lot and tracker results answer different questions"],
        "Choose Vs market when the question is not only how much you made, but how the selected holdings performed against a benchmark. Enter a market ticker, such as SPY, and use Go to load it. The portfolio calculation does not change when you change the benchmark; only the comparison series, difference, and benchmark risk statistics change. The bubbles show Portfolio Grade, transaction-aware price return, open-lots price return, open-lots total return, tracker total return, and both portfolio and benchmark Sharpe and Sortino. Open-lots metrics include only positions still held. Tracker metrics also include positions that were fully closed during the selected range.",
        GROWTH / "vs-market-tab-current.png",
        crop=(0, 0, 2400, 1450),
    ),
    scene(
        "05-vs-market-indexes",
        "Vs market: price and total-return indexes",
        "Both lines start at 100, so the ending value reads as a return.",
        ["Cyan or green: portfolio", "Dotted orange: benchmark", "Total return reinvests distributions"],
        "The two index charts make the comparison visual. Both series begin at one hundred. An ending value of one hundred and fifteen means a fifteen-percent return, not a one-hundred-and-fifteen-dollar account balance. The Transaction-Aware Price Return Index uses market-price movement only, with the portfolio in cyan and the benchmark as the dotted orange line. The Transaction-Aware Total Return Index uses the same starting point but reinvests distributions, shown by the green portfolio line. The distance between the price and total-return readings highlights the contribution from dividends and other distributions.",
        GROWTH / "vs-market-tab-current.png",
        crop=(0, 1120, 2400, 2380),
    ),
    scene(
        "06-vs-market-drivers",
        "Vs market: find the holdings driving the result",
        "Ticker bars reveal percentage performance; the growth map adds position size.",
        ["Green bars gained; red bars lost", "Bars are return percentages, not dollar profit", "Growth-map area is value and color is return"],
        "Performance by Ticker ranks the included holdings by transaction-aware total return for the selected period. Green bars are positive and red bars are negative. A long bar identifies a large percentage move, but not necessarily the largest dollar contribution, because position sizes differ. The Portfolio Growth Map completes that picture. Each tile is a holding. Its area reflects the holding's current tracked market value, while its color reflects its total return: red for a loss, neutral near zero, and green for a gain. Together, the bars and map expose both performance and concentration.",
        GROWTH / "performance-charts.jpg",
    ),
    scene(
        "07-lots-period",
        "Lots: period performance and lifetime accounting",
        "Use the upper bubbles for the selected window and the lower bubbles for cost basis.",
        ["Period cards follow the shared date range", "Lifetime cards stay on cost-basis accounting", "Account Value adds cash and open options where available"],
        "The Lots tab, labeled Gains and Losses inside the panel, separates a selected-period replay from lifetime accounting. The upper bubbles follow the shared performance range: Start Value, End Value, price return, distributions, tracker total return, and their open-lot counterparts. Purchases and sales change weights without being counted as returns. The Lifetime Cost-Basis section below does not change when you move the date filter. It compares current value with what was paid for the shares, includes realized results for sold shares, and can show Account Value separately when cash and open option contracts need to be reconciled with a broker.",
        LOTS / "gains-losses-current.png",
        crop=(0, 0, 1390, 1650),
    ),
    scene(
        "08-lots-tables",
        "Lots: unrealized, realized, and combined results",
        "Drill into what remains open, what was sold, and the complete record.",
        ["Unrealized: holdings still owned", "Realized: closed sales and their locked-in result", "Combined: the complete history by ticker"],
        "The Lots tables bring the accounting down to each ticker. Unrealized lists the shares still held, with invested amount, current value, price gain or loss, dividends received, and total gain or loss. Realized lists closed sales, including their locked-in proceeds versus cost basis. Combined places both sides together for every ticker you have owned, so a fully sold position does not disappear from the lifetime picture. The chart above the tables compares price gain and loss with total gain and loss over time, while the ticker bars make the dividend contribution visible beside price-only results. Use the table tabs and Columns control to focus on the detail you need.",
        LOTS / "Screenshot 2026-05-09 101659.jpg",
    ),
    scene(
        "09-finish",
        "A fuller view of growth",
        "Read the tab that matches the question you are asking.",
        ["Dollars for account value", "Vs market for benchmarked performance", "Lots for position and sale accounting"],
        "To recap, use Dollars to understand account value and transaction-aware dollar return. Use Vs market to compare the selected holdings with a benchmark, then use its bubbles, indexes, bars, and growth map to find the drivers. Use Lots when you need to separate current holdings from completed sales and inspect cost-basis accounting ticker by ticker. Keep the account, filter, and shared date range aligned when you compare screens. For informational purposes only. Not financial advice.",
        GROWTH / "growth-tabs-current.png",
        kind="outro",
    ),
]
