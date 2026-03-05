"""Generate the downloadable Excel template for generic users."""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import os

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), '..', 'templates', 'portfolio_upload_template.xlsx')


def create_template():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Portfolio"

    # All columns the app supports — required columns first, then optional
    headers = [
        # Required
        "Ticker", "Shares",
        # Core pricing
        "Price Paid", "Current Price",
        # Holdings info
        "Description", "Type", "Date Purchased",
        # Gain/loss
        "Purchase Value", "Current Value", "Gain/Loss", "Gain/Loss %", "% Change",
        # Dividend info
        "Div/Share", "Frequency", "Ex-Div Date", "DRIP",
        "Div Paid", "Est. Annual Pmt", "Monthly Income",
        # Yield
        "Yield On Cost", "Current Yield", "% of Account",
        # Dividend tracking
        "YTD Divs", "Total Divs Received", "Paid For Itself",
        # Reinvestment
        "Cash Not Reinvest", "Cash Reinvested",
        "Shares from Div", "Shares/Year", "Shares/Month",
        # Withdrawal
        "8% Annual Wdraw", "8% Monthly Wdraw",
    ]

    header_font = Font(bold=True, color="FFFFFF", size=11)
    required_fill = PatternFill(start_color="1565C0", end_color="1565C0", fill_type="solid")
    optional_fill = PatternFill(start_color="37474F", end_color="37474F", fill_type="solid")
    thin_border = Border(bottom=Side(style="thin", color="90CAF9"))

    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = required_fill if col <= 2 else optional_fill
        cell.alignment = Alignment(horizontal="center")

    # Example rows (only filling key columns, leaving optional ones blank)
    examples = [
        {"Ticker": "JEPI", "Shares": 100, "Price Paid": 55.50, "Current Price": 57.20,
         "Description": "JPMorgan Equity Premium Income ETF", "Type": "ETF",
         "Div/Share": 0.45, "Frequency": "M", "Ex-Div Date": "03/01/25", "DRIP": "Y",
         "Date Purchased": "2024-01-15", "YTD Divs": 135.00, "Total Divs Received": 540.00},
        {"Ticker": "SCHD", "Shares": 50, "Price Paid": 78.20, "Current Price": 82.50,
         "Description": "Schwab US Dividend Equity ETF", "Type": "ETF",
         "Div/Share": 0.62, "Frequency": "Q", "Ex-Div Date": "03/15/25", "DRIP": "N",
         "Date Purchased": "2023-06-01", "YTD Divs": 31.00, "Total Divs Received": 186.00},
        {"Ticker": "O", "Shares": 25, "Price Paid": 52.00, "Current Price": 55.80,
         "Description": "Realty Income Corp", "Type": "REIT",
         "Div/Share": 0.26, "Frequency": "M", "Ex-Div Date": "02/28/25", "DRIP": "Y",
         "Date Purchased": "2024-03-10", "YTD Divs": 19.50, "Total Divs Received": 78.00},
    ]
    for row_idx, example in enumerate(examples, 2):
        for col_idx, header in enumerate(headers, 1):
            val = example.get(header)
            if val is not None:
                cell = ws.cell(row=row_idx, column=col_idx, value=val)
                cell.border = thin_border

    # Column widths
    for i, header in enumerate(headers, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = max(len(header) + 4, 12)

    # ── Instructions sheet ─────────────────────────────────────────────────────
    ins = wb.create_sheet("Instructions")
    instructions = [
        ("Column", "Required", "Description"),
        ("Ticker", "YES", "Stock/ETF ticker symbol (e.g., JEPI, SCHD, O)"),
        ("Shares", "YES", "Number of shares owned"),
        ("Price Paid", "No", "Average cost basis per share (defaults to current market price if blank)"),
        ("Current Price", "No", "Current market price per share (auto-fetched from Yahoo Finance if blank)"),
        ("Description", "No", "Security name/description (auto-fetched if blank)"),
        ("Type", "No", "Asset type: ETF, EQUITY, CEF, BDC, REIT (auto-detected if blank)"),
        ("Date Purchased", "No", "Date the position was purchased (YYYY-MM-DD format)"),
        ("Purchase Value", "No", "Total cost basis (auto-calculated as Price Paid x Shares if blank)"),
        ("Current Value", "No", "Total current value (auto-calculated as Current Price x Shares if blank)"),
        ("Gain/Loss", "No", "Dollar gain or loss (auto-calculated if blank)"),
        ("Gain/Loss %", "No", "Percentage gain or loss (auto-calculated if blank)"),
        ("% Change", "No", "Price change percentage (auto-calculated if blank)"),
        ("Div/Share", "No", "Dividend per share amount (auto-fetched from Yahoo Finance if blank)"),
        ("Frequency", "No", "Dividend frequency: W=Weekly, M=Monthly, Q=Quarterly, SA=Semi-Annual, A=Annual"),
        ("Ex-Div Date", "No", "Last ex-dividend date (auto-fetched if blank)"),
        ("DRIP", "No", "Dividend reinvestment: Y=Yes, N=No (defaults to N)"),
        ("Div Paid", "No", "Total dividends paid to date"),
        ("Est. Annual Pmt", "No", "Estimated annual dividend payment (auto-calculated as Div/Share x Shares if blank)"),
        ("Monthly Income", "No", "Approximate monthly dividend income (auto-calculated if blank)"),
        ("Yield On Cost", "No", "Annual yield based on price paid (auto-calculated if blank)"),
        ("Current Yield", "No", "Annual yield based on current price (auto-calculated if blank)"),
        ("% of Account", "No", "Position weight as percentage of total portfolio"),
        ("YTD Divs", "No", "Year-to-date dividends received"),
        ("Total Divs Received", "No", "Total lifetime dividends received from this position"),
        ("Paid For Itself", "No", "Ratio of total dividends received to purchase value"),
        ("Cash Not Reinvest", "No", "Cash dividends not reinvested"),
        ("Cash Reinvested", "No", "Total cash dividends that were reinvested"),
        ("Shares from Div", "No", "Number of shares acquired through DRIP"),
        ("Shares/Year", "No", "Shares bought per year from dividends"),
        ("Shares/Month", "No", "Shares bought per month from dividends"),
        ("8% Annual Wdraw", "No", "Annual withdrawal amount at 8% rate"),
        ("8% Monthly Wdraw", "No", "Monthly withdrawal amount at 8% rate"),
    ]
    for row_idx, (a, b, c) in enumerate(instructions, 1):
        cell_a = ins.cell(row=row_idx, column=1, value=a)
        cell_b = ins.cell(row=row_idx, column=2, value=b)
        cell_c = ins.cell(row=row_idx, column=3, value=c)
        if row_idx == 1:
            for cell in (cell_a, cell_b, cell_c):
                cell.font = header_font
                cell.fill = required_fill
        elif b == "YES":
            cell_b.font = Font(bold=True, color="FF6B6B")

    ins.column_dimensions['A'].width = 22
    ins.column_dimensions['B'].width = 10
    ins.column_dimensions['C'].width = 80

    os.makedirs(os.path.dirname(TEMPLATE_PATH), exist_ok=True)
    wb.save(TEMPLATE_PATH)
    return TEMPLATE_PATH


if __name__ == "__main__":
    path = create_template()
    print(f"Template created at: {path}")
