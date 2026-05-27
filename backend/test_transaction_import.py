import tempfile
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from transaction_import import parse_schwab_csv, parse_shear_group_activity, parse_shear_group_positions


class TransactionImportParserTest(unittest.TestCase):
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
