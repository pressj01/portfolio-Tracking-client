"""
Phase 2b codemod: convert hardcoded hex colors inside JSX style={{ ... }} blocks
into theme tokens (var(--token)).

Safety design:
- ONLY rewrites hex literals that occur inside a style={{ ... }} attribute. Plotly
  chart configs are plain object literals (paper_bgcolor:'#...', line:{color:'#...'})
  and are never inside a style attribute, so they are left untouched.
- Within a style block, BOTH background and text/border colors convert together,
  so we never create dark-text-on-dark-background islands.
- Token map is parsed from src/index.css :root, so dark output is identical
  (each token defaults to its original hex) and light is driven by [data-theme].

Usage:
    py scripts/sweep_inline_colors.py            # dry run: report only
    py scripts/sweep_inline_colors.py --apply    # write changes
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(".")
CSS = ROOT / "src" / "index.css"
APPLY = "--apply" in sys.argv

HEX6 = re.compile(r"#[0-9a-fA-F]{6}\b")
HEX3 = re.compile(r"#[0-9a-fA-F]{3}\b")


def build_token_map():
    """hex(lower) -> token name, parsed from the first :root { } block."""
    text = CSS.read_text(encoding="utf-8")
    start = text.index(":root")
    brace = text.index("{", start)
    depth = 0
    i = brace
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    block = text[brace : i + 1]
    mapping = {}
    for m in re.finditer(r"--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;", block):
        name, hexv = m.group(1), m.group(2).lower()
        # First token to claim a hex wins; semantic names are emitted before the
        # value-keyed --p-* palette in :root, so this prefers semantic names.
        mapping.setdefault(hexv, name)
    return mapping


def find_style_spans(src):
    """Return (start, end) char ranges covering each style={{ ... }} object,
    i.e. the region between the outer JSX braces."""
    spans = []
    for m in re.finditer(r"style=\{", src):
        # Start scanning at the JSX expression brace.
        i = m.end() - 1  # position of the first '{'
        depth = 0
        sq = dq = bt = False
        n = len(src)
        j = i
        while j < n:
            c = src[j]
            if sq:
                if c == "'" and src[j - 1] != "\\":
                    sq = False
            elif dq:
                if c == '"' and src[j - 1] != "\\":
                    dq = False
            elif bt:
                if c == "`" and src[j - 1] != "\\":
                    bt = False
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
            else:
                if c == "'":
                    sq = True
                elif c == '"':
                    dq = True
                elif c == "`":
                    bt = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        spans.append((i, j + 1))
                        break
            j += 1
    return spans


def convert(src, tokens, unmatched):
    spans = find_style_spans(src)
    out = []
    last = 0
    count = 0

    def repl(m):
        nonlocal count
        hexv = m.group(0).lower()
        tok = tokens.get(hexv)
        if tok:
            count += 1
            return f"var(--{tok})"
        unmatched[hexv] = unmatched.get(hexv, 0) + 1
        return m.group(0)

    for (s, e) in spans:
        out.append(src[last:s])
        chunk = src[s:e]
        chunk = HEX6.sub(repl, chunk)
        chunk = HEX3.sub(repl, chunk)
        out.append(chunk)
        last = e
    out.append(src[last:])
    return "".join(out), count


def main():
    tokens = build_token_map()
    files = sorted(ROOT.glob("src/**/*.jsx"))
    unmatched = {}
    total = 0
    changed_files = 0
    per_file = []
    for f in files:
        src = f.read_text(encoding="utf-8")
        new, count = convert(src, tokens, unmatched)
        if count:
            per_file.append((f.as_posix(), count))
            total += count
            changed_files += 1
            if APPLY and new != src:
                f.write_text(new, encoding="utf-8")

    print(f"{'APPLIED' if APPLY else 'DRY RUN'}: {total} hex->token conversions "
          f"across {changed_files} files (of {len(files)} scanned).\n")
    for name, count in sorted(per_file, key=lambda x: -x[1]):
        print(f"  {count:4d}  {name}")
    if unmatched:
        print("\nHex colors found in style blocks with NO matching token "
              "(left unchanged — review/add tokens):")
        for hexv, n in sorted(unmatched.items(), key=lambda x: -x[1]):
            print(f"  {n:4d}  {hexv}")


if __name__ == "__main__":
    main()
