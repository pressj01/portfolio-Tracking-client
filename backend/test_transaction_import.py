import tempfile
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from transaction_import import parse_schwab_csv


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


if __name__ == "__main__":
    unittest.main()
