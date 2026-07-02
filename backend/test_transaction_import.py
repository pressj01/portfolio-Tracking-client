import tempfile
import sys
import unittest
import csv
from pathlib import Path
import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from transaction_import import (
    parse_etrade_transactions_xlsx,
    parse_schwab_csv,
    parse_shear_group_activity,
    parse_shear_group_positions,
)


class TransactionImportParserTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
