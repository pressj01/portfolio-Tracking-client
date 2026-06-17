"""
Theme imperative window.Plotly.newPlot charts for light/dark mode.

For each .jsx file that calls window.Plotly.newPlot(el, data, LAYOUT, cfg):
  1. Wrap the 3rd argument (layout) in themedPlotlyLayout(LAYOUT, isDark).
  2. Ensure `import { themedPlotlyLayout } from '<rel>/utils/chartTheme'` and
     `import { useTheme } from '<rel>/context/ThemeContext'`.
  3. Insert `const { isDark } = useTheme()` at the top of the default-exported
     component (right after its opening `{`).
  4. Add `isDark` to the dependency array of every useEffect that draws a chart.

themedPlotlyLayout overrides paper/plot/font/title/grid/axis colors from CSS vars,
so hardcoded dark values inside the layout are corrected at render time, and the
isDark dep forces a redraw on theme toggle.

Usage:
    py scripts/theme_plotly_charts.py <file.jsx> [<file.jsx> ...] [--apply]
"""
import pathlib
import re
import sys

APPLY = "--apply" in sys.argv
FILES = [a for a in sys.argv[1:] if a != "--apply"]


def rel_prefix(path):
    # path like src/pages/analytics/IncomeCharts.jsx -> depth under src
    parts = pathlib.Path(path).as_posix().split("/")
    # locate 'src'
    idx = parts.index("src")
    depth = len(parts) - idx - 2  # folders below src, minus the file itself
    return "../" * depth if depth > 0 else "./"


def split_args(s):
    """Split a top-level argument list string into argument substrings."""
    args, depth, start = [], 0, 0
    sq = dq = bt = False
    i = 0
    while i < len(s):
        c = s[i]
        if sq:
            if c == "'" and s[i - 1] != "\\":
                sq = False
        elif dq:
            if c == '"' and s[i - 1] != "\\":
                dq = False
        elif bt:
            if c == "`" and s[i - 1] != "\\":
                bt = False
        else:
            if c == "'":
                sq = True
            elif c == '"':
                dq = True
            elif c == "`":
                bt = True
            elif c in "([{":
                depth += 1
            elif c in ")]}":
                depth -= 1
            elif c == "," and depth == 0:
                args.append((start, i))
                start = i + 1
        i += 1
    args.append((start, len(s)))
    return args


def find_call_args_span(src, call_start):
    """Given index of '(' after newPlot, return (open_idx, close_idx)."""
    i = call_start
    depth = 0
    sq = dq = bt = False
    while i < len(src):
        c = src[i]
        if sq:
            if c == "'" and src[i - 1] != "\\":
                sq = False
        elif dq:
            if c == '"' and src[i - 1] != "\\":
                dq = False
        elif bt:
            if c == "`" and src[i - 1] != "\\":
                bt = False
        else:
            if c == "'":
                sq = True
            elif c == '"':
                dq = True
            elif c == "`":
                bt = True
            elif c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    return call_start, i
        i += 1
    return None


def wrap_layouts(src):
    """Wrap the 3rd arg of each window.Plotly.newPlot( ... ) call."""
    out = []
    last = 0
    count = 0
    for m in re.finditer(r"(?:window\.)?Plotly\.newPlot\s*\(", src):
        paren = src.index("(", m.start())
        span = find_call_args_span(src, paren)
        if not span:
            continue
        o, c = span
        inner = src[o + 1 : c]
        parts = split_args(inner)
        if len(parts) < 3:
            continue
        ls, le = parts[2]
        layout = inner[ls:le]
        if "themedPlotlyLayout" in layout:
            continue
        new_layout = f" themedPlotlyLayout({layout.strip()}, isDark)"
        new_inner = inner[:ls] + new_layout + inner[le:]
        out.append(src[last:o + 1])
        out.append(new_inner)
        last = c
        count += 1
    out.append(src[last:])
    return "".join(out), count


def add_isdark_deps(src):
    """Append isDark to dependency arrays of useEffects that draw charts."""
    count = 0
    result = []
    idx = 0
    for m in re.finditer(r"useEffect\(\s*\(\)\s*=>\s*\{", src):
        pass  # handled below by simpler approach
    # Simpler: for each newPlot occurrence, find the enclosing useEffect's closing
    # `}, [ ... ])` and add isDark if absent. We rewrite dependency arrays that
    # belong to effects containing newPlot.
    # Find all `}, [<deps>])` following a newPlot within the same effect.
    return src, count  # deps handled in main via regex pass


def ensure_imports(src, rel):
    changed = False
    if "themedPlotlyLayout" not in re.sub(r"window\.Plotly.*", "", src) or \
       "import { themedPlotlyLayout }" not in src and "themedPlotlyLayout }" not in src:
        if "themedPlotlyLayout" not in src.split("window.Plotly")[0]:
            pass
    # Ensure chartTheme import
    if not re.search(r"import\s*\{[^}]*themedPlotlyLayout[^}]*\}\s*from\s*['\"][^'\"]*chartTheme['\"]", src):
        # insert after first import line
        m = re.search(r"^import .*$", src, re.M)
        ins = f"import {{ themedPlotlyLayout }} from '{rel}utils/chartTheme'\n"
        src = src[:m.end()] + "\n" + ins.rstrip("\n") + src[m.end():]
        changed = True
    if not re.search(r"import\s*\{[^}]*useTheme[^}]*\}\s*from\s*['\"][^'\"]*ThemeContext['\"]", src):
        m = re.search(r"^import .*$", src, re.M)
        ins = f"import {{ useTheme }} from '{rel}context/ThemeContext'\n"
        src = src[:m.end()] + "\n" + ins.rstrip("\n") + src[m.end():]
        changed = True
    return src, changed


def ensure_hook(src):
    """Insert const { isDark } = useTheme() into the default exported component."""
    if re.search(r"const\s*\{[^}]*isDark[^}]*\}\s*=\s*useTheme\(\)", src):
        return src, False
    m = re.search(r"export default function \w+\s*\([^)]*\)\s*\{", src)
    if not m:
        return src, False
    return src[:m.end()] + "\n  const { isDark } = useTheme()" + src[m.end():], True


def add_deps(src):
    """For each useEffect containing newPlot, add isDark to its dep array."""
    count = 0
    # Match an effect body up to its closing `}, [deps])`. Greedy-safe per-effect
    # parsing: find 'useEffect(' then balance to matching ')'.
    out = []
    last = 0
    for m in re.finditer(r"useEffect\s*\(", src):
        paren = src.index("(", m.start())
        span = find_call_args_span(src, paren)
        if not span:
            continue
        o, c = span
        body = src[o:c + 1]
        if "newPlot" not in body and "themedPlotlyLayout" not in body:
            continue
        # find the dependency array: last top-level `[ ... ]` before c
        dep_m = list(re.finditer(r"\]\s*\)$", body))
        # locate the deps array opening bracket as the last ', [' at depth 1
        depstart = body.rfind(", [")
        if depstart == -1:
            depstart = body.rfind(",[")
        if depstart == -1:
            continue
        br_open = body.index("[", depstart)
        br_close = body.rfind("]")
        deps = body[br_open + 1:br_close]
        if "isDark" in deps:
            continue
        new_deps = deps.strip()
        new_deps = (new_deps + ", isDark") if new_deps else "isDark"
        new_body = body[:br_open + 1] + new_deps + body[br_close:]
        out.append(src[last:o])
        out.append(new_body)
        last = c + 1
        count += 1
    out.append(src[last:])
    return "".join(out), count


def process(path):
    src = pathlib.Path(path).read_text(encoding="utf-8")
    if "Plotly.newPlot" not in src:
        return path, 0, "no newPlot"
    rel = rel_prefix(path)
    new, wrapped = wrap_layouts(src)
    if wrapped == 0:
        return path, 0, "nothing wrapped"
    new, _ = ensure_imports(new, rel)
    new, _ = ensure_hook(new)
    new, deps = add_deps(new)
    if APPLY and new != src:
        pathlib.Path(path).write_text(new, encoding="utf-8")
    return path, wrapped, f"deps+{deps}"


def main():
    if not FILES:
        print("pass one or more .jsx files")
        return
    for f in FILES:
        path, n, note = process(f)
        print(f"{'APPLIED' if APPLY else 'DRY'}: {path}: wrapped {n} layouts ({note})")


if __name__ == "__main__":
    main()
