"""Click-by-click live Fidelity portfolio demonstration."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LIVE = ROOT / 'fidelity_clickwalk_captures'
EARLIER = ROOT / 'fidelity_owner_import_captures'

SCENES = [
    {
        'id':'navigate_admin', 'image':LIVE/'01-admin-menu.png', 'title':'Navigate to the Portfolios screen',
        'subtitle':'Click Admin, then choose Portfolios.', 'click':(955,38), 'focus':(916,65,1110,210),
        'bullets':['Click Admin in the top navigation','Choose Portfolios from the menu'],
        'narration':'Start from any application page. Move to the Admin menu in the top navigation and click it. In the menu that opens, click Portfolios. This is the place to create and organize regular brokerage accounts, decide which accounts belong to Owner, and create regular aggregate views.'
    },
    {
        'id':'new_portfolio', 'image':LIVE/'02-portfolios.png', 'title':'Start a regular portfolio',
        'subtitle':'Click New Portfolio for each real brokerage account.', 'click':(1140,162), 'focus':(1060,130,1220,190),
        'bullets':['A regular portfolio represents one real account','It stores its own holdings, cash, and transactions'],
        'narration':'On Manage Portfolios, click New Portfolio. A regular portfolio is the real account record. It owns its own holdings, cash snapshot, transaction history, and imports. Create one regular portfolio for each brokerage account you want to track separately.'
    },
    {
        'id':'name_portfolio', 'image':LIVE/'03-new-portfolio-name.png', 'title':'Name the portfolio and save it',
        'subtitle':'Enter a clear account name, then confirm.', 'click':(590,336), 'focus':(385,257,855,432),
        'bullets':['Enter a descriptive name','Click OK to create the account','Repeat for Fidelity Income Demo and Fidelity Activity Demo'],
        'narration':'Type a clear account name in the New Portfolio dialog, then click OK. In this walkthrough, the two import targets are Fidelity Income Demo and Fidelity Activity Demo. I also create a small Fidelity Creation Walkthrough account on screen so you can see the real creation process end to end.'
    },
    {
        'id':'set_fidelity_owner', 'image':LIVE/'04-fidelity-broker-source.png', 'title':'Choose Fidelity and add Owner members',
        'subtitle':'Set the broker source to Fidelity, then check the Owner box for the accounts to roll up.', 'click':(291,94), 'focus':(207,70,522,155),
        'bullets':['Set the broker source to Fidelity','Keep the account User-owned','Check Owner for both demo accounts'],
        'narration':'After creation, set the Broker Source to Fidelity. The two demo accounts are user-owned and their Owner checkboxes are selected. Owner is an optional personal rollup: it combines only the regular user-owned accounts you check. It is not a brokerage account, so you never import a Fidelity file into Owner itself.'
    },
    {
        'id':'positions_upload', 'image':LIVE/'05-positions-file.png', 'title':'Import the current Fidelity positions snapshot',
        'subtitle':'Select Fidelity Income Demo, then upload the positions workbook.', 'click':(610,348), 'focus':(48,300,1200,520),
        'bullets':['Admin → Import','Broker Import → Step 1 Positions','Upload fidelity_positions_Demo.xlsx'],
        'narration':'Select Fidelity Income Demo in the portfolio selector. Then open Admin, Import, Broker Import, and Step 1 Positions. Choose Fidelity and upload fidelity_positions_Demo.xlsx. The positions file establishes the account’s current holdings and cash, so this is normally the first import.'
    },
    {
        'id':'positions_preview', 'image':LIVE/'06-positions-preview.png', 'title':'Preview and perform the positions import',
        'subtitle':'Verify the destination, then click Import into Fidelity Income Demo.', 'click':(220,503), 'focus':(45,375,1195,630),
        'bullets':['Preview matches VTI: 8 and JEPQ: 150','Cash is filtered from the holdings rows','The completed import updates the test account'],
        'narration':'Use Preview before importing. The live preview identifies Fidelity Income Demo as both the file account and destination. It shows eight VTI shares, one hundred fifty JEPQ shares, and the separate cash row. After verifying that result, click Import into Fidelity Income Demo. The import was performed in the test account and refreshed its two positions.'
    },
    {
        'id':'transactions', 'image':EARLIER/'11-fidelity-transactions-preview.png', 'title':'Import the Fidelity activity workbook',
        'subtitle':'Select Fidelity Activity Demo, choose Step 2 Transactions, preview, then import.', 'click':(220,345), 'focus':(43,325,1190,610),
        'bullets':['Upload fidelity_transactions_Demo.xlsx','Preview buys, dividend, and DRIP','The live import preserves the account’s broker holdings'],
        'narration':'Now select Fidelity Activity Demo. In Broker Import, click Step 2 Transactions and upload fidelity_transactions_Demo.xlsx. The preview finds two buys, one dividend, and one DRIP reinvestment. I performed this import in the test account. Because it already has a broker positions snapshot, the transaction import records the history while keeping the current broker share counts.'
    },
    {
        'id':'income_holdings', 'image':LIVE/'07-income-holdings.png', 'title':'Navigate to the first test account',
        'subtitle':'Fidelity Income Demo holds 8 VTI and 150 JEPQ.', 'click':(1215,28), 'focus':(28,510,1205,650),
        'bullets':['Use the top portfolio selector','Then Portfolio → Holdings','This account has VTI: 8 and JEPQ: 150'],
        'narration':'To inspect a test account, choose it in the top portfolio selector and open Portfolio, Holdings. Fidelity Income Demo now shows its imported positions: eight VTI shares and one hundred fifty JEPQ shares. Those are this regular account’s own positions; they remain separate even when included in Owner.'
    },
    {
        'id':'activity_holdings', 'image':LIVE/'08-activity-holdings.png', 'title':'Navigate to the second test account',
        'subtitle':'Fidelity Activity Demo holds 12 VTI and 0.37 JEPI.', 'click':(1215,28), 'focus':(28,510,1205,650),
        'bullets':['Select Fidelity Activity Demo','Portfolio → Holdings','This account has VTI: 12 and JEPI: 0.37'],
        'narration':'Switch the same selector to Fidelity Activity Demo, then stay on Portfolio, Holdings. Its imported history supports twelve VTI shares and point three seven JEPI shares. Notice that VTI is shared by both test accounts, while JEPI exists only in this activity account.'
    },
    {
        'id':'owner_shared', 'image':LIVE/'09-owner-aggregation.png', 'title':'Navigate to Owner: matching tickers combine',
        'subtitle':'Owner shows VTI as 20 shares: 8 from Income plus 12 from Activity.', 'click':(1215,28), 'focus':(30,385,1200,450),
        'bullets':['Select Owner in the same portfolio selector','Owner contains one VTI row','8 + 12 = 20 shares'],
        'narration':'Now choose Owner in the portfolio selector and open Holdings. Owner combines matching tickers from its selected member accounts into one row. Here, the Owner VTI row shows twenty shares: eight from Fidelity Income Demo plus twelve from Fidelity Activity Demo. This proves that matching ticker shares aggregate together in Owner.'
    },
    {
        'id':'owner_unique', 'image':LIVE/'10-owner-unique-tickers.png', 'title':'Owner keeps unique tickers at their source totals',
        'subtitle':'JEPQ remains 150 and JEPI remains 0.37 because each is in only one demo account.', 'click':(477,500), 'focus':(29,440,1200,530),
        'bullets':['JEPQ appears only in Fidelity Income Demo: 150','JEPI appears only in Fidelity Activity Demo: 0.37','Owner changes the view, never the underlying accounts'],
        'narration':'The unique tickers illustrate the other half of the rule. JEPQ appears only in Fidelity Income Demo, so Owner shows the same one hundred fifty shares. JEPI appears only in Fidelity Activity Demo, so Owner shows the same point three seven shares. Owner is a combined view, not a data move. Regular aggregates work the same way: create as many named, read-only groupings as needed, without changing the real account data.'
    },
]
