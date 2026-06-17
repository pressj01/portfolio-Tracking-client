"""
Phase 1 of the theming refactor: convert every solid hex color in src/index.css
into a CSS custom property so a light theme can override them later.

- Dark output is IDENTICAL: every variable defaults to its original hex value.
- rgba(...) values are intentionally left untouched (deferred to a later phase).
- ~40 recurring "chrome" colors get semantic names; the long tail is value-keyed
  as --p-<hex>.
- A [data-theme="light"] block overrides the semantic core with light values.

The script self-checks: after substitution, re-expanding every var() back to its
:root value must reproduce the original file byte-for-byte.
"""
import re
import pathlib

CSS = pathlib.Path("src/index.css")

# ---- Curated semantic names for the recurring chrome colors -----------------
# hex (lowercase) -> token name (without leading --)
SEMANTIC = {
    # surfaces / structure
    "#1a1a2e": "bg",
    "#16213e": "surface",
    "#0f3460": "border",          # NOTE: dual role (border + table-header bg)
    "#0e1117": "surface-sunken",  # chart backgrounds
    "#13172a": "surface-2",
    "#10192e": "surface-inset",
    "#1a2233": "grid-line",
    # text
    "#e0e0e0": "text",
    "#e0e8f5": "text-strong",
    "#c8d6e5": "text-soft",
    "#b0bec5": "text-muted",
    "#8899aa": "text-dim",
    "#90a4ae": "text-dim-2",
    "#607d8b": "text-faint",
    "#7a8aa6": "text-faint-2",
    # brand / accent (blue family)
    "#64b5f6": "accent",
    "#90caf9": "accent-2",
    "#7ecfff": "accent-bright",
    "#9ad7ff": "accent-soft",
    "#1976d2": "primary",
    "#1565c0": "primary-hover",
    "#1a6fb5": "primary-2",
    # buttons / states
    "#2e7d32": "success-solid",
    "#1b5e20": "success-solid-hover",
    "#c62828": "danger-solid",
    "#b71c1c": "danger-solid-hover",
    "#455a64": "secondary-solid",
    "#37474f": "secondary-solid-hover",
    # semantic value text
    "#4dff91": "pos",
    "#00e89a": "pos-bright",
    "#00c853": "pos-strong",
    "#62f27b": "pos-2",
    "#ff6b6b": "neg",
    "#d50000": "neg-strong",
    "#ef5350": "neg-2",
    "#e05555": "neg-3",
    "#ff8a8a": "neg-soft",
    "#f9a825": "warning",
    "#ffd54f": "warning-text",
    "#ffc107": "amber",
    "#ffb84d": "amber-2",
    "#a78bfa": "purple",
    "#00c9a7": "teal",
    "#58c4d8": "teal-2",
    # absolutes
    "#fff": "white",
    "#ffffff": "white",
    "#000": "black",
}

# ---- Light-theme overrides for the semantic core ----------------------------
# Only the named tokens are overridden; the value-keyed long tail stays at its
# dark value for now and is refined per-component in a later phase.
LIGHT = {
    "bg": "#f4f6fb",
    "surface": "#ffffff",
    "border": "#d6dbe6",
    "surface-sunken": "#eef1f7",
    "surface-2": "#f0f2f7",
    "surface-inset": "#f5f7fb",
    "grid-line": "#e2e6ee",
    "text": "#1a2332",
    "text-strong": "#0f1726",
    "text-soft": "#243040",
    "text-muted": "#4a5664",
    "text-dim": "#5a6675",
    "text-dim-2": "#5a6675",
    "text-faint": "#7a8696",
    "text-faint-2": "#7a8696",
    "accent": "#1565c0",
    "accent-2": "#1976d2",
    "accent-bright": "#0277bd",
    "accent-soft": "#0288d1",
    "primary": "#1976d2",
    "primary-hover": "#1565c0",
    "primary-2": "#1565c0",
    "success-solid": "#2e7d32",
    "success-solid-hover": "#1b5e20",
    "danger-solid": "#c62828",
    "danger-solid-hover": "#b71c1c",
    "secondary-solid": "#607d8b",
    "secondary-solid-hover": "#455a64",
    "pos": "#1b8a4b",
    "pos-bright": "#0a9e6e",
    "pos-strong": "#0a8a3c",
    "pos-2": "#1b8a4b",
    "neg": "#d32f2f",
    "neg-strong": "#c62828",
    "neg-2": "#d32f2f",
    "neg-3": "#c0392b",
    "neg-soft": "#e57373",
    "warning": "#b26a00",
    "warning-text": "#8a6d00",
    "amber": "#b26a00",
    "amber-2": "#b26a00",
    "purple": "#6d28d9",
    "teal": "#00897b",
    "teal-2": "#0277bd",
    "white": "#ffffff",
    "black": "#000000",
}

HEX6 = re.compile(r"#[0-9a-fA-F]{6}\b")
HEX3 = re.compile(r"#[0-9a-fA-F]{3}\b")

def main():
    original = CSS.read_text(encoding="utf-8")

    # Collect every distinct solid hex (preserve order of first appearance).
    seen = []
    for m in HEX6.finditer(original):
        v = m.group(0).lower()
        if v not in seen:
            seen.append(v)
    for m in HEX3.finditer(original):
        v = m.group(0).lower()
        if v not in seen:
            seen.append(v)

    # Build value -> token name map.
    name_of = {}
    for v in seen:
        if v in SEMANTIC:
            name_of[v] = SEMANTIC[v]
        else:
            name_of[v] = "p-" + v[1:]  # value-keyed, e.g. --p-1a2744

    # Substitute usages (6-digit first, then 3-digit). \b prevents 3-digit
    # from matching inside a 6-digit literal.
    def repl(m):
        return f"var(--{name_of[m.group(0).lower()]})"
    body = HEX6.sub(repl, original)
    body = HEX3.sub(repl, body)

    # ---- self-check: expand vars back, must equal original -----------------
    expand = {f"var(--{name_of[v]})": v for v in seen}
    check = body
    for token, hexv in expand.items():
        check = check.replace(token, hexv)
    # original used mixed-case hex in places; compare case-insensitively
    if check.lower() != original.lower():
        raise SystemExit("SELF-CHECK FAILED: round-trip does not match original")

    # ---- assemble :root + [data-theme=light] blocks ------------------------
    # Group semantic tokens (in curated order) then the value-keyed palette.
    semantic_vals = {}  # token -> dark hex (first hex that mapped to it)
    palette_vals = {}
    for v in seen:
        tok = name_of[v]
        if v in SEMANTIC:
            semantic_vals.setdefault(tok, v)
        else:
            palette_vals[tok] = v

    lines = []
    lines.append("/* =========================================================")
    lines.append("   Theme tokens (Phase 1 of theming refactor).")
    lines.append("   Dark is the default. Every color below is overridable;")
    lines.append("   [data-theme=\"light\"] overrides the semantic core.")
    lines.append("   rgba() overlays are not yet tokenized (later phase).")
    lines.append("   ========================================================= */")
    lines.append(":root {")
    lines.append("  /* --- semantic core --- */")
    # emit semantic tokens in the order declared in SEMANTIC for readability
    emitted = set()
    for hexv, tok in SEMANTIC.items():
        if tok in semantic_vals and tok not in emitted:
            lines.append(f"  --{tok}: {semantic_vals[tok]};")
            emitted.add(tok)
    lines.append("")
    lines.append("  /* --- palette (component-specific, value-keyed) --- */")
    for tok, hexv in palette_vals.items():
        lines.append(f"  --{tok}: {hexv};")
    lines.append("}")
    lines.append("")
    lines.append("[data-theme=\"light\"] {")
    lines.append("  /* Semantic core overrides. The value-keyed --p-* palette")
    lines.append("     is refined per-component in a later phase. */")
    emitted = set()
    for hexv, tok in SEMANTIC.items():
        if tok in semantic_vals and tok not in emitted and tok in LIGHT:
            lines.append(f"  --{tok}: {LIGHT[tok]};")
            emitted.add(tok)
    lines.append("}")
    lines.append("")

    header = "\n".join(lines)
    CSS.write_text(header + body, encoding="utf-8")
    print(f"Tokenized {len(seen)} distinct hex colors "
          f"({len(semantic_vals)} semantic, {len(palette_vals)} palette).")

if __name__ == "__main__":
    main()
