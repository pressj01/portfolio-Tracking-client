"""
Fix the [data-theme="light"] block: the 540 --p-* palette overrides were written
as duplicates of their dark :root values (a no-op), so tokenized panels/inputs
stayed dark in light mode. This rewrites every --p-* value inside the light block
to a proper light-mode value derived from the dark :root value via light_value().

Semantic tokens (--bg, --surface, --text, etc.) are NOT touched — only --p-*.

Usage:
    py scripts/fix_palette_light_overrides.py            # dry run
    py scripts/fix_palette_light_overrides.py --apply    # write
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from generate_palette_tokens import light_value  # noqa: E402

CSS = pathlib.Path("src/index.css")
APPLY = "--apply" in sys.argv


def block_span(text, selector):
    """Return (open_brace_index, close_brace_index) of the selector's block."""
    start = text.index(selector)
    brace = text.index("{", start)
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


def main():
    text = CSS.read_text(encoding="utf-8")

    rb, re_ = block_span(text, ":root")
    root_block = text[rb:re_]
    root_p = dict(re.findall(r"--(p-[0-9a-fA-F]+):\s*(#[0-9a-fA-F]{3,6})\s*;", root_block))

    lb, le = block_span(text, '[data-theme="light"]')
    light_block = text[lb:le]

    changed = [0]
    skipped = []

    def repl(m):
        tok, cur = m.group(1), m.group(2)
        dark = root_p.get(tok)
        if not dark:
            skipped.append(tok)
            return m.group(0)
        want = light_value(dark)
        if want.lower() == cur.lower():
            return m.group(0)
        changed[0] += 1
        return f"--{tok}: {want};"

    new_light = re.sub(r"--(p-[0-9a-fA-F]+):\s*(#[0-9a-fA-F]{3,6})\s*;", repl, light_block)
    new_text = text[:lb] + new_light + text[le:]

    print(f"{'APPLIED' if APPLY else 'DRY RUN'}: {changed[0]} --p-* light overrides "
          f"updated (of {len(root_p)} palette tokens).")
    if skipped:
        print(f"  {len(skipped)} light tokens had no :root match (left as-is).")
    if APPLY and new_text != text:
        CSS.write_text(new_text, encoding="utf-8")
        print("  index.css written.")


if __name__ == "__main__":
    main()
