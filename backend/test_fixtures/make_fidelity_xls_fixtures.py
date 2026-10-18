"""Write the Excel 97-2003 (.xls) Fidelity fixtures used by test_transaction_import.py.

The layouts copy real Fidelity downloads re-saved from Excel: blank rows above
the header, Run Date stored as an Excel date, account numbers stored as numbers,
the website's lowercase Positions headers, and Fidelity Trader+'s positions
columns. Every account, amount, and quantity is made up.

xlwt is needed only to regenerate these files; the app reads them with xlrd.
    py -3.13 -m pip install xlwt
    py -3.13 backend/test_fixtures/make_fidelity_xls_fixtures.py
"""

from datetime import date
from pathlib import Path

import xlwt

HERE = Path(__file__).resolve().parent
DATE = xlwt.easyxf(num_format_str="mm/dd/yyyy")


def write_sheet(path, sheet_name, rows, first_row=0):
    book = xlwt.Workbook()
    sheet = book.add_sheet(sheet_name)
    for r, row in enumerate(rows, start=first_row):
        for c, value in enumerate(row):
            if value is None:
                continue
            if isinstance(value, date):
                sheet.write(r, c, value, DATE)
            else:
                sheet.write(r, c, value)
    book.save(str(path))


def accounts_history():
    header = [
        "Run Date", "Account", "Account Number", "Action", "Symbol", "Description",
        "Type", "Price ($)", "Quantity", "Commission ($)", "Fees ($)",
        "Accrued Interest ($)", "Amount ($)", "Settlement Date",
    ]
    rows = [
        header,
        [date(2026, 10, 15), "Health Savings Account", 111111111,
         "DEBIT CARD PURCHASE EXAMPLE MERCHANT as of 2026-10-15 (Cash)", None,
         "No Description", "Cash", None, 0, None, None, None, -257.38, None],
        [date(2026, 10, 15), "Rollover IRA", 222222222,
         "DIVIDEND RECEIVED ETF OPPORTUNITIES TR TDAQ LIFT ETF (TDAX) (Cash)", "TDAX",
         "ETF OPPORTUNITIES TR TDAQ LIFT ETF", "Cash", None, 0, None, None, None, 92.89, None],
        [date(2026, 10, 1), "Rollover IRA", 222222222,
         "YOU BOUGHT ARES CAPITAL CORP COM (ARCC) (Cash)", "ARCC",
         "ARES CAPITAL CORP COM", "Cash", 20.11, 100, 0, 0, None, -2011.0,
         date(2026, 10, 2)],
    ]
    write_sheet(HERE / "fidelity_accounts_history.xls", "Accounts_History", rows, first_row=2)


def website_positions():
    header = [
        "Account number", "Account name", "Symbol", "Description", "Quantity",
        "Last price", "Last price change", "Current value", "Today's gain/loss dollar",
        "Today's gain/loss percent", "Total gain/loss dollar", "Total gain/loss percent",
        "Percent of account", "Cost basis total", "Average cost basis", "Type",
    ]
    rows = [
        header,
        [None, "Rollover IRA", "SPAXX", "FIDELITY GOVERNMENT MONEY MARKET", None, None,
         None, 5000.25, None, None, None, None, 0.7255, None, None, "Cash"],
        [None, "Rollover IRA", "ARCC", "ARES CAPITAL CORP COM", 100, 18.92, 0.33, 1892.0,
         33.0, 0.0177, -119.0, -0.0592, 0.2745, 2011.0, 20.11, "Cash"],
    ]
    write_sheet(HERE / "fidelity_portfolio_positions.xls", "Portfolio_Positions_Oct-15-2026", rows)


def trader_plus_positions():
    header = [
        "Symbol", "Bid", "Ask", "Volume", "$ Avg Cost", "Notes", "$ Day G/L", "% Day G/L",
        "$ Total G/L", "% Total G/L", "Value", "% of Acct", "Basis", "Day Range",
        "52W Range", "Earnings Date", "Div Amt", "Div Ex-Date", "Description", "Quantity",
        "Last", "Div Pay Date",
    ]
    rows = [
        header,
        ["IDVO", 40.74, 42.0, 220649, 42.69, "--", 8.0, 0.19, -165.0, -3.87, 4104.0, 68.45,
         4269.0, "40.46-41.10", "36.19-43.82", "--", 0.2124, "Sep-29-2026",
         "AMPLIFY ETF TR CWP INTL ENHANCE", 100, 41.04, "Sep-30-2026"],
        ["ARCC", 18.9, 18.94, 4061572, 20.11, "--", 33.0, 1.77, -119.0, -5.92, 1892.0, 31.55,
         2011.0, "18.63-19.02", "17.40-21.14", "Oct-27-2026", 0.48, "Sep-15-2026",
         "ARES CAPITAL CORP COM", 100, 18.92, "Sep-30-2026"],
    ]
    write_sheet(HERE / "fidelity_trader_plus_positions.xls", "Positions_Rollover_IRA_0000_tra", rows, first_row=1)


if __name__ == "__main__":
    accounts_history()
    website_positions()
    trader_plus_positions()
