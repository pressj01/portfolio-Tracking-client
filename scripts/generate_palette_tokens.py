"""
Generate light-theme tokens for hex colors that appear only in inline JSX styles
(never in index.css), so the Phase 2b codemod can convert them too.

For each unmatched hex it adds:
  :root                 --p-<hex>: <hex>;          (dark = identical)
  [data-theme="light"]  --p-<hex>: <light>;        (role-based light value)

Light value heuristic (refined per-component later as needed):
  - dark colors  (L < 0.32)  -> light surface  (very light, faint hue)
  - light colors (L > 0.68)  -> dark text/border
  - mid accents              -> darkened for contrast on white
"""
import colorsys
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from sweep_inline_colors import build_token_map, find_style_spans, HEX6, HEX3  # noqa: E402

CSS = pathlib.Path("src/index.css")


def parse_hex(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def clamp(x):
    return max(0.0, min(1.0, x))


def light_value(hexv):
    r, g, b = parse_hex(hexv)
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    if l < 0.32:                       # dark background/surface -> light surface
        nl, ns = 0.97 - l * 0.18, min(s, 0.18)
    elif l > 0.68:                     # light text/element -> dark
        nl, ns = 0.16 + (1 - l) * 0.25, s
    else:                              # mid accent -> darken if light-ish
        nl, ns = (l * 0.6 if l > 0.5 else l), s
    nr, ng, nb = colorsys.hls_to_rgb(h, clamp(nl), clamp(ns))
    return "#%02x%02x%02x" % (round(nr * 255), round(ng * 255), round(nb * 255))


def collect_unmatched(tokens):
    seen = []
    for f in sorted(pathlib.Path(".").glob("src/**/*.jsx")):
        src = f.read_text(encoding="utf-8")
        for (s, e) in find_style_spans(src):
            chunk = src[s:e]
            for m in list(HEX6.finditer(chunk)) + list(HEX3.finditer(chunk)):
                v = m.group(0).lower()
                if v not in tokens and v not in seen:
                    seen.append(v)
    return seen


def insert_into_block(text, selector, lines):
    """Insert lines before the closing brace of the given top-level block."""
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
    insertion = "\n" + "\n".join(lines) + "\n"
    return text[:i] + insertion + text[i:]


def main():
    tokens = build_token_map()
    unmatched = collect_unmatched(tokens)
    if not unmatched:
        print("No unmatched hex colors. Nothing to add.")
        return

    dark_lines = ["  /* --- inline-only palette (added Phase 2b) --- */"]
    light_lines = ["  /* --- inline-only palette light overrides (Phase 2b) --- */"]
    for v in unmatched:
        tok = "p-" + v[1:]
        dark_lines.append(f"  --{tok}: {v};")
        light_lines.append(f"  --{tok}: {light_value(v)};")

    text = CSS.read_text(encoding="utf-8")
    text = insert_into_block(text, ":root", dark_lines)
    text = insert_into_block(text, '[data-theme="light"]', light_lines)
    CSS.write_text(text, encoding="utf-8")
    print(f"Added {len(unmatched)} inline-only palette tokens to :root and "
          f"[data-theme=\"light\"].")


if __name__ == "__main__":
    main()
