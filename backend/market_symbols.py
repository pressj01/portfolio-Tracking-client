import re


# Historical broker exports keep the ticker that existed on the trade date.
# These aliases represent the same security and must share one accounting lot,
# while market data is requested under the current Yahoo symbol.
_ACCOUNTING_SYMBOL_ALIASES = {
    "AITXD": "AITX",  # temporary post-reverse-split suffix
    "NYCB": "FLG",    # renamed Flagstar Financial
    "WPAY": "TOPW",   # renamed Roundhill Top WeeklyPay ETF
}


def accounting_symbol_for_ticker(ticker):
    """Return the stable/current symbol used to join one economic position."""
    symbol = (ticker or "").strip().upper()
    return _ACCOUNTING_SYMBOL_ALIASES.get(symbol, symbol)


def accounting_aliases_for_ticker(ticker):
    """Return every stored symbol that belongs to the same accounting lot."""
    canonical = accounting_symbol_for_ticker(ticker)
    aliases = [canonical]
    aliases.extend(
        alias for alias, target in _ACCOUNTING_SYMBOL_ALIASES.items()
        if target == canonical
    )
    return tuple(dict.fromkeys(aliases))


def yahoo_symbol_for_ticker(ticker):
    """Convert common broker ticker spellings to Yahoo Finance symbols."""
    symbol = accounting_symbol_for_ticker(ticker)
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
