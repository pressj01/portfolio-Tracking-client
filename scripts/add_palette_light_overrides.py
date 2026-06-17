"""
Add light-theme overrides for every --p-* palette token that doesn't already
have one. Phase 1 tokenized index.css colors into --p-<hex> palette tokens but
only wrote light overrides for the 46 semantic tokens, so CSS-class rules using
palette tokens (dark panels, near-white text) stayed dark in light mode.

Uses the same role-based heuristic as generate_palette_tokens.py.
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from generate_palette_tokens import light_value, insert_into_block  # noqa: E402

CSS = pathlib.Path("src/index.css")


def block_range(text, selector):
    start = text.index(selector)
    brace = text.index("{", start)
    depth, i = 0, brace
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    return brace, i


def main():
    text = CSS.read_text(encoding="utf-8")

    rb, re_ = block_range(text, ":root")
    root_block = text[rb:re_]
    lb, le = block_range(text, '[data-theme="light"]')
    light_block = text[lb:le]

    # All --p-* defs in :root (token -> dark hex)
    root_p = dict(re.findall(r"--(p-[0-9a-fA-F]+):\s*(#[0-9a-fA-F]{3,6})\s*;", root_block))
    # Already-overridden tokens in light block
    light_have = set(re.findall(r"--(p-[0-9a-fA-F]+):", light_block))

    missing = [(t, h) for t, h in root_p.items() if t not in light_have]
    if not missing:
        print("All palette tokens already have light overrides.")
        return

    lines = ["  /* --- palette light overrides (backfill) --- */"]
    for tok, hexv in missing:
        lines.append(f"  --{tok}: {light_value(hexv)};")

    text = insert_into_block(text, '[data-theme="light"]', lines)
    CSS.write_text(text, encoding="utf-8")
    print(f"Added light overrides for {len(missing)} palette tokens.")


if __name__ == "__main__":
    main()
