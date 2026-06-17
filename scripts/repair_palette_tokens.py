"""
Definitive repair for the value-keyed --p-<hex> palette tokens.

A --p-<hex> token's name encodes its original DARK hex, so the correct values are
deterministic regardless of any prior corruption:
    :root                 --p-<hex>: #<hex>;            (the dark value)
    [data-theme="light"]  --p-<hex>: light_value(#<hex>);

An earlier broken script overwrote the :root (dark) values with light values,
breaking dark mode. This restores both blocks from the token names. Semantic
tokens (--bg, --surface, ...) are NOT value-keyed and are left untouched.

Usage:
    py scripts/repair_palette_tokens.py            # dry run
    py scripts/repair_palette_tokens.py --apply    # write
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from generate_palette_tokens import light_value  # noqa: E402

CSS = pathlib.Path("src/index.css")
APPLY = "--apply" in sys.argv

TOKEN_LINE = re.compile(r"(--p-([0-9a-fA-F]{3,6})):\s*(#[0-9a-fA-F]{3,6})\s*;")


def block_span(text, selector):
    # Anchor on the real CSS rule `selector {`, not a stray mention of the
    # selector inside the header comment (which contains [data-theme="light"]).
    m = re.search(re.escape(selector) + r"\s*\{", text)
    if not m:
        raise ValueError("rule not found: " + selector)
    brace = m.end() - 1
    depth, i = 0, brace
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return brace, i
        i += 1
    raise ValueError("unbalanced braces for " + selector)


def fix_block(text, selector, value_fn):
    b, e = block_span(text, selector)
    block = text[b:e]
    changed = [0]

    def repl(m):
        name, hexkey, cur = m.group(1), m.group(2).lower(), m.group(3)
        want = value_fn("#" + hexkey)
        if want.lower() != cur.lower():
            changed[0] += 1
        return f"{name}: {want};"

    block = TOKEN_LINE.sub(repl, block)
    return text[:b] + block + text[e:], changed[0]


def add_missing_light(text):
    """Insert light overrides for any --p-* token present in :root but missing
    from the light block."""
    rb, re_ = block_span(text, ":root")
    root_p = dict((m.group(2).lower(), m.group(1))
                  for m in TOKEN_LINE.finditer(text[rb:re_]))
    lb, le = block_span(text, '[data-theme="light"]')
    light_have = {m.group(2).lower() for m in TOKEN_LINE.finditer(text[lb:le])}
    missing = [hexkey for hexkey in root_p if hexkey not in light_have]
    if not missing:
        return text, 0
    lines = ["  /* --- palette light overrides (backfill) --- */"]
    for hexkey in missing:
        lines.append(f"  --p-{hexkey}: {light_value('#' + hexkey)};")
    insertion = "\n" + "\n".join(lines) + "\n"
    return text[:le] + insertion + text[le:], len(missing)


def main():
    text = CSS.read_text(encoding="utf-8")
    text, dark_fixed = fix_block(text, ":root", lambda h: h)
    text, light_fixed = fix_block(text, '[data-theme="light"]', light_value)
    text, added = add_missing_light(text)
    print(f"{'APPLIED' if APPLY else 'DRY RUN'}: restored {dark_fixed} dark (:root), "
          f"fixed {light_fixed} light values, added {added} missing light overrides.")
    if APPLY:
        CSS.write_text(text, encoding="utf-8")
        print("  index.css written.")


if __name__ == "__main__":
    main()
