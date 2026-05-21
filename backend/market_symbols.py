import re


def yahoo_symbol_for_ticker(ticker):
    """Convert common broker ticker spellings to Yahoo Finance symbols."""
    symbol = (ticker or "").strip().upper()
    explicit = {
        "BRKA": "BRK-A",
        "BRKB": "BRK-B",
    }
    if symbol in explicit:
        return explicit[symbol]

    preferred = re.match(r"^([A-Z]+)-?PR([A-Z])$", symbol)
    if preferred:
        return f"{preferred.group(1)}-P{preferred.group(2)}"

    return symbol
