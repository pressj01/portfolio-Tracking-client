"""
Phase 2d codemod: convert hardcoded colors inside named const/let style objects
(e.g. `const dateStyle = { background: '#1a1a2e', ... }`) into theme tokens.

The original sweep only touched JSX `style={{ ... }}` attributes, so style objects
defined as standalone consts (dateStyle, selectStyle, cardStyle, inputStyle, ...)
kept their hardcoded dark backgrounds/borders and stayed dark in light mode.

Safety:
- Only object literals assigned with `const|let|var NAME = { ... }` are considered.
- An object is treated as a STYLE object only if it contains a CSS-ish key
  (padding/margin/borderRadius/fontSize/display/cursor/width/height/...) AND
  contains NO Plotly key (paper_bgcolor/plot_bgcolor/xaxis/yaxis/marker/gridcolor/
  hovertemplate/hoverlabel/...). Plotly layout/trace objects are thus skipped.
- Inside a style object, every hex AND dark rgba()/rgb() is converted together, so
  no dark-text-on-light-bg islands are produced.

Usage:
    py scripts/sweep_style_objects.py            # dry run
    py scripts/sweep_style_objects.py --apply    # write
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from sweep_inline_colors import build_token_map, HEX6, HEX3  # noqa: E402

ROOT = pathlib.Path(".")
APPLY = "--apply" in sys.argv

CSS_KEYS = re.compile(
    r"\b(padding|margin|borderRadius|fontSize|fontWeight|display|cursor|width|"
    r"height|minWidth|maxWidth|minHeight|maxHeight|flex|gap|alignItems|"
    r"justifyContent|textAlign|lineHeight|boxShadow|background|backgroundColor|"
    r"border|borderColor|borderTop|borderBottom|borderLeft|borderRight|"
    r"position|overflow|zIndex|opacity|transition|gridTemplateColumns)\b"
)
PLOTLY_KEYS = re.compile(
    r"\b(paper_bgcolor|plot_bgcolor|gridcolor|zerolinecolor|hovertemplate|"
    r"hoverlabel|tickfont|titlefont|marker|hoverinfo|xaxis|yaxis|colorscale|"
    r"showlegend|autosize|colorbar)\b"
)

# rgb/rgba -> token, for the common dark-chrome overlays used as backgrounds.
RGBA = re.compile(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)")


def rgba_token(m):
    r, g, b = int(float(m.group(1))), int(float(m.group(2))), int(float(m.group(3)))
    a = float(m.group(4)) if m.group(4) is not None else 1.0
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    # Only remap dark, opaque-ish overlays meant as panel/surface backgrounds.
    if lum < 0.30 and a >= 0.20:
        if a >= 0.55:
            return "var(--panel)"
        return "var(--panel-dim)"
    if lum > 0.80 and a < 0.18:
        return "var(--grid-line)"
    return m.group(0)


def find_object_spans(src):
    """Find object literals assigned via const|let|var NAME = { ... } and return
    (start, end) char ranges of the braces (inclusive)."""
    spans = []
    for m in re.finditer(r"\b(?:const|let|var)\s+[A-Za-z0-9_]+\s*=\s*\{", src):
        i = src.index("{", m.start())
        depth = 0
        sq = dq = bt = False
        j = i
        n = len(src)
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
    spans = find_object_spans(src)
    out = []
    last = 0
    count = 0

    def repl_hex(m):
        nonlocal count
        hexv = m.group(0).lower()
        tok = tokens.get(hexv)
        if tok:
            count += 1
            return f"var(--{tok})"
        unmatched[hexv] = unmatched.get(hexv, 0) + 1
        return m.group(0)

    def repl_rgba(m):
        nonlocal count
        res = rgba_token(m)
        if res != m.group(0):
            count += 1
        return res

    for (s, e) in spans:
        chunk = src[s:e]
        # Classify: style object only.
        if not CSS_KEYS.search(chunk) or PLOTLY_KEYS.search(chunk):
            continue
        out.append(src[last:s])
        chunk = HEX6.sub(repl_hex, chunk)
        chunk = HEX3.sub(repl_hex, chunk)
        chunk = RGBA.sub(repl_rgba, chunk)
        out.append(chunk)
        last = e
    out.append(src[last:])
    return "".join(out), count


def main():
    tokens = build_token_map()
    files = sorted(ROOT.glob("src/**/*.jsx"))
    unmatched = {}
    total = 0
    per_file = []
    for f in files:
        src = f.read_text(encoding="utf-8")
        new, count = convert(src, tokens, unmatched)
        if count:
            per_file.append((f.as_posix(), count))
            total += count
            if APPLY and new != src:
                f.write_text(new, encoding="utf-8")

    print(f"{'APPLIED' if APPLY else 'DRY RUN'}: {total} conversions in style objects "
          f"across {len(per_file)} files (of {len(files)} scanned).\n")
    for name, count in sorted(per_file, key=lambda x: -x[1]):
        print(f"  {count:4d}  {name}")
    if unmatched:
        print("\nHex with NO matching token (left unchanged):")
        for hexv, n in sorted(unmatched.items(), key=lambda x: -x[1]):
            print(f"  {n:4d}  {hexv}")


if __name__ == "__main__":
    main()
