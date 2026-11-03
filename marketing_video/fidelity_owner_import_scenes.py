"""Scene plan for the Fidelity portfolios show-and-tell guide."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CAPTURES = ROOT / "fidelity_owner_import_captures"

SCENES = [
    {
        "id": "welcome", "image": CAPTURES / "02-portfolios-intro.png", "crop": (0, 0, 1920, 490),
        "title": "Create portfolios and import Fidelity data",
        "subtitle": "A show-and-tell walkthrough from setup to a validated import",
        "bullets": ["Open the Portfolios screen", "Create two Fidelity accounts", "Use Owner and aggregates deliberately"],
        "narration": "In this show-and-tell, we will create two regular Fidelity portfolios, add them to an Owner account, create a separate aggregate portfolio, and import example Fidelity positions and transactions. We will start on the Portfolios screen, where every portfolio begins as its own regular account.",
    },
    {
        "id": "navigate", "image": CAPTURES / "02-portfolios-intro.png", "crop": (0, 0, 1920, 470),
        "title": "Navigate to Portfolios",
        "subtitle": "Admin → Portfolios is the control center for accounts, Owner, and aggregates",
        "bullets": ["Open Admin", "Choose Portfolios", "Use New Portfolio for each real account"],
        "narration": "From anywhere in the application, open Admin and choose Portfolios. This screen is where you create, select, organize, and import into individual accounts. A regular portfolio represents one real brokerage or manual account. It is the account that owns its own holdings, cash, transactions, and import history.",
    },
    {
        "id": "owner", "image": CAPTURES / "03-owner-explained.png", "crop": (0, 0, 1920, 620),
        "title": "What the Owner account means",
        "subtitle": "An optional personal rollup—not a brokerage account and not an import destination",
        "bullets": ["Create it once when you want a personal rollup", "Check member accounts in the Owner column", "Import only into each underlying regular account"],
        "narration": "Owner is an optional personal rollup. Think of it as the combined view of the real accounts that belong to one owner. You create Owner once, then use the Owner column to choose its member accounts. Owner adds those accounts together for viewing; it does not replace them, and it has no broker file of its own. Continue importing positions and transactions into each regular account, and Owner reflects the combined result.",
    },
    {
        "id": "two_accounts", "image": CAPTURES / "04-demo-portfolios-owner-membership.png", "crop": (0, 560, 1920, 730),
        "title": "Create two Fidelity portfolios",
        "subtitle": "Two separate regular accounts, then include both in Owner",
        "bullets": ["New Portfolio → choose Fidelity", "Create Fidelity Income Demo and Fidelity Activity Demo", "Check both boxes in the Owner column"],
        "narration": "Here are the two regular demo accounts: Fidelity Income Demo and Fidelity Activity Demo. To make each one, choose New Portfolio, enter a descriptive account name, select Fidelity as the broker source, and save it as a user-owned account. Then check the Owner box for each account you want included. In this example, both Fidelity portfolios are members, so Owner shows their combined data while each remains an independent portfolio.",
    },
    {
        "id": "aggregate", "image": CAPTURES / "13-finished-owner-and-aggregate.png", "crop": (0, 100, 1240, 700),
        "title": "Use regular aggregates for flexible views",
        "subtitle": "A read-only virtual portfolio you define from selected regular accounts",
        "bullets": ["Create an aggregate and check its member accounts", "It never changes the underlying portfolios", "Create as many aggregates as you need; accounts may be reused"],
        "narration": "A regular aggregate portfolio is different from Owner. It is a read-only virtual view that you name and define by selecting any regular portfolios. Here, Demo Fidelity Aggregate contains the two Fidelity demos. It does not move data or change either account. You can create as many aggregates as you need for any comparison or grouping, and the same regular portfolio can belong to more than one aggregate at the same time.",
    },
    {
        "id": "positions_file", "image": CAPTURES / "06-fidelity-positions-file-selected.png", "crop": (0, 0, 1280, 700),
        "title": "Import Fidelity positions first",
        "subtitle": "Broker Import → Step 1 Positions → Fidelity",
        "bullets": ["Select Fidelity Income Demo first", "Choose the Fidelity Positions format", "Upload fidelity_positions_Demo.xlsx"],
        "narration": "For a Fidelity account, select the destination portfolio first, open Import Portfolio Data, choose Broker Import, and start with Step 1, Positions. Select Fidelity and upload the renamed fidelity_positions_Demo spreadsheet. A positions file establishes the current holdings and cash snapshot, so it should normally be imported before transaction history.",
    },
    {
        "id": "positions_preview", "image": CAPTURES / "07-fidelity-positions-preview.png", "crop": (0, 0, 1280, 700),
        "title": "Preview before importing positions",
        "subtitle": "Confirm the file account, destination, holdings, cash, and totals",
        "bullets": ["The demo file is recognized as Fidelity Income Demo", "Review the filtered cash row and securities", "Import only after the preview matches the statement"],
        "narration": "Always use Preview before importing. The preview confirms the file account and the selected destination, then shows the holdings, cash, and total account value it found. In this demo, the Fidelity snapshot identifies two securities plus cash. Check those results against the exported statement, then choose Import into Fidelity Income Demo. The completed import reports two new positions.",
    },
    {
        "id": "transactions_warning", "image": CAPTURES / "09-fidelity-transactions-warning.png", "crop": (0, 0, 1280, 700),
        "title": "Import Fidelity transactions second",
        "subtitle": "Broker Import → Step 2 Transactions—normally after a positions snapshot",
        "bullets": ["Select Fidelity Activity Demo", "Upload fidelity_transactions_Demo.xlsx", "Use complete history only when rebuilding positions intentionally"],
        "narration": "Next, select Fidelity Activity Demo and choose Step 2, Transactions. Transaction files add buys, sells, dividends, and DRIP activity. The application warns when there is no current positions snapshot, because a partial history can rebuild the wrong share counts. In this controlled demonstration, the supplied file is complete sample history, so we acknowledge the confirmation. In normal use, import positions first, then add the full transaction export.",
    },
    {
        "id": "transactions_preview", "image": CAPTURES / "11-fidelity-transactions-preview.png", "crop": (0, 0, 1280, 700),
        "title": "Validate and import the transaction preview",
        "subtitle": "The example detects buys, a dividend, and a DRIP reinvestment",
        "bullets": ["Confirm the activity types and dates", "Verify the destination account", "Import to complete the demo portfolio"],
        "narration": "Preview the transaction spreadsheet and verify the activity types, dates, tickers, quantities, and destination portfolio. This Fidelity example finds two buys, one dividend, and one DRIP reinvestment. When the preview matches the export, import it into Fidelity Activity Demo. The confirmation shows the activity that was added, while Owner and the Demo Fidelity Aggregate remain combined views of their chosen regular accounts.",
    },
    {
        "id": "recap", "image": CAPTURES / "13-finished-owner-and-aggregate.png", "crop": (0, 100, 1240, 700),
        "title": "Portfolio setup recap",
        "subtitle": "Regular accounts hold data; Owner and aggregates organize the view",
        "bullets": ["Create one regular portfolio per real account", "Use Owner for one optional personal rollup", "Create unlimited aggregates for flexible groupings"],
        "narration": "To recap: create a regular portfolio for every real account and import directly into it. Use the optional Owner account when you want one personal rollup of selected user-owned accounts. Use regular aggregates for any other virtual grouping. You can have many aggregates, reuse accounts across them, and change their members without changing the original account data. For informational purposes only. Not financial advice.",
    },
]
