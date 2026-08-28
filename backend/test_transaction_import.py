import tempfile
import sys
import unittest
import csv
from pathlib import Path
import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
from transaction_import import (
    parse_etrade_transactions_xlsx,
    parse_fidelity_positions_xlsx,
    parse_fidelity_transactions_xlsx,
    parse_generic_transactions,
    parse_schwab_csv,
    parse_shear_group_activity,
    parse_shear_group_positions,
    parse_snowball_holdings_csv,
    parse_snowball_categories_csv,
)


class TransactionImportParserTest(unittest.TestCase):
    def test_snowball_holdings_reads_category_heading(self):
        content = "\n".join([
            "Holding,Holdings' name,Shares,Cost basis,Current value,Share price,Sector,Category",
            "ARCC,Ares Capital,10,200,220,22,Financial Services,BDC",
            "ADX,Adams Diversified Equity Fund,5,100,110,22,Funds,CORE EQUITY",
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Snowball_Export_Holdings.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_snowball_holdings_csv(str(path), path.name)

        self.assertEqual(
            {position["ticker"]: position["category"] for position in result["positions"]},
            {"ARCC": "BDC", "ADX": "CORE EQUITY"},
        )

    def test_snowball_categories_nests_subcategories_under_parents(self):
        content = "\n".join([
            "Holding,Category",
            "ARCC,GROWTH / Growth-Stocks",
            "ADX,GROWTH / Growth-Stocks",
            "WMT,GROWTH / Growth-Funds",
            "KSLV,INCOME / Income-CC Silver",
            "ICSH,CASH",
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Snowball_Export_Holdings.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_snowball_categories_csv(str(path), path.name)

        self.assertEqual(result["format_type"], "categories")
        self.assertEqual(
            result["summary"],
            {
                "categories": 3,
                "subcategories": 3,
                "assignments": 5,
                "filtered": 0,
                "duplicates_skipped": 1,
            },
        )
        self.assertEqual(
            result["assignments"],
            [
                {"ticker": "ARCC", "category": "GROWTH", "subcategory": "Growth-Stocks"},
                {"ticker": "ADX", "category": "GROWTH", "subcategory": "Growth-Stocks"},
                {"ticker": "WMT", "category": "GROWTH", "subcategory": "Growth-Funds"},
                {"ticker": "KSLV", "category": "INCOME", "subcategory": "Income-CC Silver"},
                {"ticker": "ICSH", "category": "CASH", "subcategory": ""},
            ],
        )
        self.assertEqual(
            result["categories"],
            [
                {"name": "GROWTH", "subcategories": ["Growth-Stocks", "Growth-Funds"]},
                {"name": "INCOME", "subcategories": ["Income-CC Silver"]},
                {"name": "CASH", "subcategories": []},
            ],
        )

    def _write_etrade_all_transactions_csv(self, path):
        rows = [
            ["All Transactions Activity Types"],
            [],
            ["Account Activity for Trading -7113 from LAST 30 Days"],
            [],
            ["Total:", "1833.93"],
            [],
            ["Activity/Trade Date", "Transaction Date", "Settlement Date", "Activity Type", "Description", "Symbol", "Cusip", "Quantity #", "Price $", "Amount $", "Commission", "Category", "Note"],
            ["06/03/26", "06/03/26", "", "Bought", "NEOS BOOSTED BITCOIN HIGH INCM UNSOLICITED TRADE", "XBCI", "--", "3.0", "35.517", "-106.55", "0.0", "--", "--"],
            ["06/02/26", "06/02/26", "06/02/26", "Dividend", "INCOMESTKD 1X BTC AND 1X GP", "ISBG", "--", "", "", "1.39", "0.0", "--", "--"],
            ["05/28/26", "05/28/26", "05/28/26", "Bought", "KURV TECH TITANS SELECT ETF DIVIDEND REINVESTMENT", "KQQQ", "--", "0.223", "31.272", "-6.97", "0.0", "--", "--"],
            ["05/12/26", "05/12/26", "05/12/26", "Dividend", "TAPPALPHA S&P 500 GROWTH & DLY DIVIDEND REINVESTMENT", "TSPY", "--", "0.046", "25.329", "-1.16", "0.0", "--", "--"],
            ["05/08/26", "05/08/26", "05/08/26", "Sold", "YIELDMAX ULTRA OPTION INC UNSOLICITED TRADE", "ULTY", "--", "-4.242", "31.991", "135.70", "0.0", "--", "--"],
            ["05/08/26", "05/08/26", "05/08/26", "Transfer", "TRNSFR CASH TO MARGIN", "--", "--", "", "", "33.37", "0.0", "--", "--"],
        ]
        with open(path, "w", newline="", encoding="utf-8") as fh:
            csv.writer(fh).writerows(rows)

    def _write_etrade_all_transactions_xlsx(self, path):
        rows = []
        with tempfile.NamedTemporaryFile("w+", newline="", encoding="utf-8", delete=False) as fh:
            temp_csv = Path(fh.name)
        try:
            self._write_etrade_all_transactions_csv(temp_csv)
            with open(temp_csv, newline="", encoding="utf-8") as fh:
                rows = list(csv.reader(fh))
        finally:
            temp_csv.unlink(missing_ok=True)

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "DownloadTxnHistory"
        for row in rows:
            ws.append(row)
        wb.save(path)
        wb.close()

    def _assert_etrade_all_transactions_result(self, result):
        self.assertEqual(result["account_name"], "Trading -7113")
        self.assertEqual(result["summary"]["buys"], 3)
        self.assertEqual(result["summary"]["sells"], 1)
        self.assertEqual(result["summary"]["dividends"], 1)
        self.assertEqual(result["summary"]["filtered"], 1)
        self.assertEqual(result["summary"]["drip_detected"], 2)

        by_type = [(t["type"], t["ticker"], t["notes"]) for t in result["transactions"]]
        self.assertIn(("BUY", "XBCI", ""), by_type)
        self.assertIn(("DIVIDEND", "ISBG", "Dividend"), by_type)
        self.assertIn(("SELL", "ULTY", ""), by_type)
        drip_tickers = {t["ticker"] for t in result["transactions"] if "[DRIP]" in (t["notes"] or "")}
        self.assertEqual(drip_tickers, {"KQQQ", "TSPY"})

    def test_etrade_all_transactions_csv_imports_trades_dividends_and_drips(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "renamed-export.csv"
            self._write_etrade_all_transactions_csv(path)

            result = parse_etrade_transactions_xlsx(str(path), path.name)

        self._assert_etrade_all_transactions_result(result)

    def test_etrade_all_transactions_xlsx_imports_by_content_not_filename(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "not-an-etrade-name.xlsx"
            self._write_etrade_all_transactions_xlsx(path)

            result = parse_etrade_transactions_xlsx(str(path), path.name)

        self._assert_etrade_all_transactions_result(result)

    def test_schwab_positions_accepts_total_cost_basis_without_cost_per_share(self):
        content = "\n".join([
            '"Positions for account Custodial Brokerage ...843 as of 05:35 PM ET, 2026/05/26",,,,,,,,,,,,,,,,,,',
            ",,,,,,,,,,,,,,,,,,",
            "Symbol,Description,Qty (Quantity),Price,Price Chng $ (Price Change $),Price Chng % (Price Change %),Mkt Val (Market Value),Day Chng $ (Day Change $),Day Chng % (Day Change %),Cost Basis,Gain $ (Gain/Loss $),Gain % (Gain/Loss %),Reinvest?,Reinvest Capital Gains?,% of Acct (% of Account),Ex-Div (Ex-Dividend Date),Div Pay Date,Div $,Asset Type",
            "BLOX,NICHOLAS CRYPTO INCOME ETF,31.9129,17.25,0.3,1.77%,$550.50 ,$9.57 ,1.77%,$674.28 ,($126.93),-18.82%,Yes,N/A,18.94%,5/22/2026,5/26/2026,6.3254,ETFs & Closed End Funds",
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab-positions.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_schwab_csv(str(path), path.name)

        self.assertEqual(result["summary"]["holdings"], 1)
        position = result["positions"][0]
        self.assertEqual(position["ticker"], "BLOX")
        self.assertAlmostEqual(position["quantity"], 31.9129)
        self.assertEqual(position["purchase_value"], 674.28)
        self.assertAlmostEqual(position["cost_per_share"], 674.28 / 31.9129)

    def test_schwab_positions_prefers_total_cost_basis_when_both_basis_fields_exist(self):
        content = "\n".join([
            '"Positions for account Custodial Brokerage ...843 as of 05:35 PM ET, 2026/05/26",,,,,,,,,,,,',
            ",,,,,,,,,,,,",
            "Symbol,Description,Qty (Quantity),Cost/Share,Price,Mkt Val (Market Value),Cost Basis,Gain $ (Gain/Loss $),Reinvest?,Asset Type",
            "BLOX,NICHOLAS CRYPTO INCOME ETF,10,50,17.25,$172.50 ,$600.00 ,($427.50),Yes,ETFs & Closed End Funds",
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab-positions-both.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_schwab_csv(str(path), path.name)

        position = result["positions"][0]
        self.assertEqual(position["purchase_value"], 600.00)
        self.assertEqual(position["cost_per_share"], 60.00)

    def test_schwab_positions_captures_cash_for_account_value(self):
        content = "\n".join([
            '"Positions for account Brokerage ...843 as of 04:00 PM ET, 2026/06/29",,,,,,,,,',
            ",,,,,,,,,",
            "Symbol,Description,Qty (Quantity),Price,Mkt Val (Market Value),Cost Basis,Gain $ (Gain/Loss $),Reinvest?,Asset Type",
            "BLOX,NICHOLAS CRYPTO INCOME ETF,10,$17.25,$172.50,$200.00,($27.50),Yes,ETFs & Closed End Funds",
            'Cash & Cash Investments,,,,\"$6,425.39\",,,,Cash and Money Market',
            'Positions Total,,,,\"$6,597.89\",,,,',
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab-positions-with-cash.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_schwab_csv(str(path), path.name)

        self.assertEqual(result["summary"]["cash"], 6425.39)
        self.assertEqual(result["summary"]["account_value"], 6597.89)
        self.assertEqual(result["source_format"], "schwab")

    def test_fidelity_positions_removes_export_footer_before_account_validation(self):
        content = "\n".join([
            "Account number,Account name,Symbol,Description,Last Price,Current value,Cost basis total,Average cost basis,Total gain/loss $,Quantity,Dist. yield",
            ",ROTH IRA,SPAXX**,HELD IN MONEY MARKET,,$11.10,,,,,3.32%",
            ',ROTH IRA,AVDV,AVANTIS INTERNATIONAL SMALL CAP VAL ETF,$102.22,"$1,581.03","$1,635.52",$105.74,($54.49),15.467,2.84%',
            "",
            '"The data and information in this spreadsheet is provided solely for informational purposes.",,,,,,,,,,',
            '"Brokerage services are provided by Fidelity Brokerage Services LLC.",,,,,,,,,,',
            "Date downloaded Jul-29-2026 9:33 p.m ET,,,,,,,,,,",
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Portfolio_Positions.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_fidelity_positions_xlsx(str(path), path.name)

        self.assertEqual(result["account_name"], "ROTH IRA")
        self.assertEqual(result["summary"]["holdings"], 1)
        self.assertEqual(result["summary"]["filtered"], 4)
        self.assertEqual(result["summary"]["cash"], 11.10)
        self.assertEqual(result["summary"]["account_value"], 1592.13)
        position = result["positions"][0]
        self.assertEqual(position["ticker"], "AVDV")
        self.assertEqual(position["description"], "AVANTIS INTERNATIONAL SMALL CAP VAL ETF")
        self.assertEqual(position["purchase_value"], 1635.52)

    def test_fidelity_positions_keeps_purchased_money_market_funds(self):
        content = "\n".join([
            "Account number,Account name,Symbol,Description,Last Price,Current value,Cost basis total,Average cost basis,Total gain/loss $,Quantity,Type,Dist. yield,Est. annual income",
            ",ROTH IRA,SPAXX**,HELD IN MONEY MARKET,,$11.10,,,,,Cash,3.32%,",
            ',ROTH IRA,FZDXX,FIDELITY TREASURY MONEY MARKET,$1.00,"$5,000.00","$5,000.00",$1.00,$0.00,5000,Cash,3.51%,175.50',
            ',ROTH IRA,AVDV,AVANTIS INTERNATIONAL SMALL CAP VAL ETF,$102.22,"$1,581.03","$1,635.52",$105.74,($54.49),15.467,ETF,2.84%,',
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Portfolio_Positions.csv"
            path.write_text(content, encoding="utf-8")
            result = parse_fidelity_positions_xlsx(str(path), path.name)

        tickers = {row["ticker"] for row in result["positions"]}
        self.assertEqual(tickers, {"FZDXX", "AVDV"})
        self.assertEqual(result["summary"]["cash"], 11.10)
        fzdxx = next(row for row in result["positions"] if row["ticker"] == "FZDXX")
        self.assertEqual(fzdxx["quantity"], 5000)
        self.assertEqual(fzdxx["estim_payment_per_year"], 175.50)

    def test_fidelity_positions_accepts_file_that_is_already_clean(self):
        content = "\n".join([
            "Account number,Account name,Symbol,Description,Last Price,Current value,Cost basis total,Average cost basis,Total gain/loss $,Quantity,Dist. yield",
            ',ROTH IRA,AVDV,AVANTIS INTERNATIONAL SMALL CAP VAL ETF,$102.22,"$1,581.03","$1,635.52",$105.74,($54.49),15.467,2.84%',
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Already_Clean.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_fidelity_positions_xlsx(str(path), path.name)

        self.assertEqual(result["summary"]["holdings"], 1)
        self.assertEqual(result["summary"]["filtered"], 0)
        self.assertEqual(result["positions"][0]["ticker"], "AVDV")

    def test_fidelity_transactions_keeps_closed_position_dividend_history(self):
        content = "\n".join([
            "Run Date,Account,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Amount ($)",
            '04/02/2025,Trust - Fidelity - No MM*,DIVIDEND RECEIVED as of 04/02/2025,OXLC,OXFORD LANE CAPITAL CORP,Cash,,,0,0,356.40',
            '05/01/2025,Trust - Fidelity - No MM*,DIVIDEND RECEIVED as of 05/01/2025,OXLC,OXFORD LANE CAPITAL CORP,Cash,,,0,0,882.49',
            '02/03/2026,Trust - Fidelity - No MM*,YOU SOLD SRV,SRV,S RV INC,Cash,-798,40.95,0,0,32678.10',
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "History.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_fidelity_transactions_xlsx(str(path), path.name)

        self.assertEqual(result["summary"]["dividends"], 2)
        self.assertEqual(result["summary"]["sells"], 1)
        dividends = [txn for txn in result["transactions"] if txn["type"] == "DIVIDEND"]
        self.assertEqual([txn["ticker"] for txn in dividends], ["OXLC", "OXLC"])
        self.assertEqual([txn["date"] for txn in dividends], ["2025-04-02", "2025-05-01"])
        self.assertEqual([txn["dividend_amount"] for txn in dividends], [356.40, 882.49])

    def test_fidelity_transactions_imports_cap_gain_and_return_of_capital(self):
        # Roundhill-style payouts arrive as several Fidelity action lines on
        # the same day. The calendar uses shares × full DPS ($2,315.81); the
        # payments ledger previously kept only DIVIDEND RECEIVED ($1,519.25).
        content = "\n".join([
            "Run Date,Account,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Amount ($)",
            '08/25/2026,ROTH IRA,DIVIDEND RECEIVED as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,1519.25',
            '08/25/2026,ROTH IRA,LONG-TERM CAP GAIN as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,500.00',
            '08/25/2026,ROTH IRA,SHORT-TERM CAP GAIN as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,200.00',
            '08/25/2026,ROTH IRA,RETURN OF CAPITAL as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,96.56',
            '08/25/2026,ROTH IRA,REINVESTMENT as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,10,50.00,0,0,-500.00',
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "History.csv"
            path.write_text(content, encoding="utf-8")
            result = parse_fidelity_transactions_xlsx(str(path), path.name)

        dividends = [txn for txn in result["transactions"] if txn["type"] == "DIVIDEND"]
        drips = [txn for txn in result["transactions"] if txn["type"] == "BUY"]
        self.assertEqual(result["summary"]["dividends"], 4)
        self.assertEqual(result["summary"]["drip_detected"], 1)
        self.assertAlmostEqual(sum(txn["dividend_amount"] for txn in dividends), 2315.81, places=2)
        self.assertEqual({txn["notes"] for txn in dividends}, {
            "[acct:ROTH IRA] Dividend Received",
            "[acct:ROTH IRA] Long-Term Cap Gain",
            "[acct:ROTH IRA] Short-Term Cap Gain",
            "[acct:ROTH IRA] Return of Capital",
        })
        self.assertEqual(drips[0]["notes"], "[DRIP] Reinvestment")
        self.assertEqual(drips[0]["shares"], 10)

    def test_fidelity_transactions_skips_foreign_tax_withheld(self):
        content = "\n".join([
            "Run Date,Account,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Amount ($)",
            '08/25/2026,ROTH IRA,FOREIGN TAX WITHHELD as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,-12.10',
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "History.csv"
            path.write_text(content, encoding="utf-8")
            result = parse_fidelity_transactions_xlsx(str(path), path.name)
        self.assertEqual(result["summary"]["dividends"], 0)
        self.assertEqual(result["transactions"], [])

    def test_generic_transactions_csv_parses_trades_dividends_and_drips(self):
        content = "\n".join([
            "Date,Type,Ticker,Shares,Price Per Share,Fees,Dividend Amount,Notes",
            "2026-01-15,BUY,SCHD,10,27.50,0,,Initial purchase",
            "2026-02-03,DIVIDEND,SCHD,,,,8.25,Cash dividend",
            "2026-02-03,DRIP,SCHD,0.30,27.50,0,,Reinvested shares",
            "2026-03-10,SELL,SCHD,2,29.00,0.05,,Partial sale",
            "not-a-date,BUY,SCHD,1,30.00,0,,Invalid row",
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "generic-transactions.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_generic_transactions(str(path), path.name)

        self.assertEqual(result["summary"]["buys"], 2)
        self.assertEqual(result["summary"]["sells"], 1)
        self.assertEqual(result["summary"]["dividends"], 1)
        self.assertEqual(result["summary"]["drip_detected"], 1)
        self.assertEqual(result["summary"]["filtered"], 1)
        self.assertEqual(result["source_format"], "generic_transactions")
        self.assertEqual(result["transactions"][0]["date"], "2026-01-15")
        self.assertEqual(result["transactions"][1]["dividend_amount"], 8.25)
        self.assertEqual(result["transactions"][2]["notes"], "[DRIP] Reinvested shares")
        self.assertEqual(result["transactions"][3]["fees"], 0.05)

    def test_generic_transactions_xlsx_accepts_friendly_header_aliases(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "generic-transactions.xlsx"
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Transactions"
            ws.append([
                "Transaction Date", "Action", "Symbol", "Quantity",
                "Price/Share", "Commission", "Cash Amount", "Memo",
            ])
            ws.append([
                "04/15/2026", "capital gain distribution", "JEPI",
                None, None, None, 12.34, "Long-term capital gain",
            ])
            wb.save(path)
            wb.close()

            result = parse_generic_transactions(str(path), path.name)

        self.assertEqual(result["summary"]["dividends"], 1)
        txn = result["transactions"][0]
        self.assertEqual(txn["type"], "DIVIDEND")
        self.assertEqual(txn["ticker"], "JEPI")
        self.assertEqual(txn["dividend_amount"], 12.34)

    def test_shear_group_positions_accepts_csv_export(self):
        content = "\n".join([
            "Account Number,Account Name,Account Nick Name,Symbol/CUSIP,Description,Quantity,Price ($),Day Change ($),Value ($),Price as Of,Unit Cost,Cost Basis ($),Unrealized G/L ($),Unrealized G/L (%),Held In,Security Type Description",
            '45514950,PRESSER JAMES,PRESSER JAMES,DGRW,WISDOMTREE U S QUALITY DIVIDEND GROWTH ETF,57.00 ,$96.33 ,$3.14,"$5,490.81 ",04:15 PM ET,$60.27 ,"$3,435.25 ","$2,055.56",59.84%,CASH,Mutual Fund - Closed-end',
            '45514950,PRESSER JAMES,PRESSER JAMES,9999227,Insured Cash Account,"1,661.34 ",$1.00 ,-,"$1,661.34 ",5/22/26 03:00 AM ET,-,-,-,-,CASH,Money Market',
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Positions.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_shear_group_positions(str(path), path.name)

        self.assertEqual(result["summary"]["holdings"], 1)
        self.assertEqual(result["summary"]["cash"], 1661.34)
        position = result["positions"][0]
        self.assertEqual(position["ticker"], "DGRW")
        self.assertEqual(position["purchase_value"], 3435.25)
        self.assertAlmostEqual(position["cost_per_share"], 3435.25 / 57.0)

    def test_shear_group_positions_cleans_excel_line_breaks_from_fund_names(self):
        content = "\n".join([
            "Account Number,Account Name,Account Nick Name,Symbol/CUSIP,Description,Quantity,Price ($),Value ($),Unit Cost,Cost Basis ($),Unrealized G/L ($),Security Type Description",
            '45514950,PRESSER JAMES,PRESSER JAMES,JPME,"JPMORGAN_x000d_\nDIVERSIFIED RETURN U S_x000D_\nMID CAP EQUITY ETF",10,$114.00,"$1,140.00",$104.00,"$1,040.00",$100.00,ETF',
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Positions.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_shear_group_positions(str(path), path.name)

        self.assertEqual(
            result["positions"][0]["description"],
            "JPMORGAN DIVERSIFIED RETURN U S MID CAP EQUITY ETF",
        )

    def test_shear_group_activity_feeds_gains_losses_transactions(self):
        content = "\n".join([
            "Date,Activity,Symbol,Description,Quantity,Unit Price,Value,Held In,Account Nickname,Account Number",
            "1/07/2026,buy,RSP,INVESCO S&P 500 EQUAL WEIGHT ETF,122,$195.83,-$23891.11,cash,PRESSER JAMES,45514950",
            "1/07/2026,sell,KOMP,STATE STREET SPDR S&P KENSHO NEW ECONOMIES COMPOSITE ETF,-11,$63.77,$701.47,cash,PRESSER JAMES,45514950",
            "4/29/2026,cash dividend,DHS,WISDOMTREE U S HIGH DIVIDEND ETF,-,-,$56.30,cash,PRESSER JAMES,45514950",
            "4/29/2026,dividend reinvest,WOBDX,JPMORGAN CORE BOND CL I,12.392,$10.33,-$128.01,cash,PRESSER JAMES,45514950",
        ])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Activity.csv"
            path.write_text(content, encoding="utf-8")

            result = parse_shear_group_activity(str(path), path.name)

        self.assertEqual(result["summary"]["buys"], 2)
        self.assertEqual(result["summary"]["sells"], 1)
        self.assertEqual(result["summary"]["dividends"], 1)
        sell = [t for t in result["transactions"] if t["type"] == "SELL"][0]
        self.assertEqual(sell["ticker"], "KOMP")
        self.assertEqual(sell["shares"], 11)
        self.assertEqual(sell["price_per_share"], 63.77)


class ImportedDividendReplaceTest(unittest.TestCase):
    def test_larger_same_day_import_replaces_partial_broker_row(self):
        replace = app_module._should_replace_imported_dividend
        self.assertTrue(replace("fidelity_transactions", 1519.25, 2315.81))
        self.assertFalse(replace("fidelity_transactions", 2315.81, 1519.25))
        self.assertFalse(replace("fidelity_transactions", 2315.81, 2315.81))
        self.assertTrue(replace("refresh_estimate", 2315.81, 1519.25))

    def test_smaller_same_day_import_from_another_fidelity_account_is_added(self):
        additional = app_module._imported_dividend_is_additional
        self.assertTrue(additional(
            "[acct:ROTH IRA] Dividend Received", 1519.25,
            "[acct:INDIVIDUAL] Dividend Received", 796.56,
        ))
        self.assertFalse(additional(
            "[acct:ROTH IRA] Dividend Received", 1519.25,
            "[acct:ROTH IRA] Dividend Received", 1519.25,
        ))
        self.assertFalse(additional(
            "[acct:ROTH IRA] Dividend Received", 2315.81,
            "[acct:ROTH IRA] Dividend Received", 1519.25,
        ))


if __name__ == "__main__":
    unittest.main()
