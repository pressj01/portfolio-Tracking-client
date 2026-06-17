"""Register specific hex colors as --p-<hex> tokens in both :root (dark=identity)
and [data-theme="light"] (light_value), so the style sweep can convert them.

Usage: py scripts/add_tokens.py [--apply] <hex> [<hex> ...]
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from generate_palette_tokens import light_value  # noqa: E402
from repair_palette_tokens import block_span      # noqa: E402

CSS = pathlib.Path("src/index.css")
APPLY = "--apply" in sys.argv
hexes = [a.lower().lstrip("#") for a in sys.argv[1:] if a != "--apply"]


def insert_before_close(text, selector, lines):
    b, e = block_span(text, selector)
    return text[:e] + "\n" + "\n".join(lines) + "\n" + text[e:]


def main():
    text = CSS.read_text(encoding="utf-8")
    existing = set(re.findall(r"--p-([0-9a-fA-F]+):", text))
    todo = [h for h in hexes if h not in existing]
    if not todo:
        print("All requested tokens already exist.")
        return
    dark = ["  /* --- added tokens --- */"] + [f"  --p-{h}: #{h};" for h in todo]
    light = ["  /* --- added tokens (light) --- */"] + [f"  --p-{h}: {light_value('#'+h)};" for h in todo]
    text = insert_before_close(text, ":root", dark)
    text = insert_before_close(text, '[data-theme="light"]', light)
    print(f"{'APPLIED' if APPLY else 'DRY RUN'}: adding {len(todo)} tokens: {todo}")
    if APPLY:
        CSS.write_text(text, encoding="utf-8")
        print("  index.css written.")


if __name__ == "__main__":
    main()
