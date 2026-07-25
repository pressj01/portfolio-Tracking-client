# DRIP Score Screen — Implementation Spec

Historical DRIP-vs-cash analyzer for a user-defined ticker set over a user-defined
window. Answers three questions per fund: **reinvest, take the cash, or stay out.**

Inspired by the "Simply Money DRIP Score™" spreadsheet, with corrected math
(see [Math](#2-math) for what changed and why).

---

## 1. Scope

### What this is
- User enters a list of tickers, names it, saves it.
- User sets an explicit `start_date` / `end_date`. **One common window for every
  ticker in the set** — this is the core fix vs. the source spreadsheet, which used
  per-fund inception dates and produced rows that could not be compared.
- Backend replays *actual* historical prices and *actual* historical distributions.
- Output: one row per ticker + a per-ticker detail view.

### What this is NOT
- Not `/reinvestment-impact` — that screen is about the user's **own holdings** and
  projects **forward** (`/api/analytics/income-growth-sim`). This screen is
  ticker research, backward-looking, on an arbitrary universe.
- Not `_dc_simulate_basket` / `_dc_simulate_price_path` — those are **forward
  Monte-Carlo GBM projections**, not history. Do not reuse them here.

### Reuse target
`backend/portfolio_tester.py` already does exactly the data layer needed:

| Function | Why it fits |
|---|---|
| `fetch_prices(tickers, start, end)` | Returns `(close_df, dividends_df)` with `auto_adjust=False, actions=True` — dividends separate from price. 10-min `_PRICE_CACHE`. Handles `yahoo_symbol_for_ticker` mapping. |
| `validate_coverage(close, tickers, requested_start)` | Returns `(ok, bad)` with each ticker's earliest date and a reason string. This is the "ticker has no data for the period" requirement, already written. |
| `_years_between(a, b)` | `(b - a).days / 365.25`, floored at 1e-9. |

`MAX_TICKERS_PER_PORTFOLIO = 75`, `MIN_DAYS = 120`, `MAX_YEARS = 25` are the existing
guardrails — adopt the same limits.

---

## 2. Math

### 2.1 Why the source spreadsheet's math was replaced

| Metric | Problem | Replacement |
|---|---|---|
| `DRIP Score = FullDRIP − NoDRIP` (pp) | Scale-contaminated. A fund up 200% gets a wider spread mechanically, so the column partly ranks *total return*, not *DRIP benefit*. | Kept as a display column, but **decomposed**; primary metric is Reinvestment Efficiency. |
| `Income vs Decay = yield ÷ NAV decline` | Denominator crosses zero → needs a `999` sentinel; ~⅓ of the sheet was the same value. Unrankable near the boundary. | **Distribution Coverage** — a continuous matched-period performance proxy with no sentinel. |
| `NoDRIP` assumes cash earns 0% | Cash sits in a MMF at ~4%, not a mattress. Overstates the DRIP case on every row. | `cash_rate` input, default 0.04. |
| Single blended `Opportunity` score | Cannot distinguish *great NAV / no yield* from *terrible NAV / huge yield* — opposite situations, same score. | 2-D verdict matrix + score for ordering **within** a bucket. |
| One exit date | The whole result may hinge on the endpoint. | **DRIP Win Rate** across all exit dates. |

### 2.2 Simulation

Per ticker, over the common window. Let `I` = `initial_investment` (default 50 000 —
affects only the dollar columns in the detail view; all ratios are scale-invariant).

```
P0     = first close on/after start_date
P_end  = last  close on/before end_date
d_t    = distribution per share on date t
P_t    = close on date t
```

Generalised over reinvest fraction `f ∈ {1.0, 0.5, 0.0}`:

```
shares[0] = I / P0
cash      = 0

for each distribution date t:
    gross      = shares * d_t
    reinvested = gross * f
    shares    += reinvested / P_t
    cash       = cash * (1 + cash_rate)^(Δt_years) + gross * (1 - f)

cash   = cash * (1 + cash_rate)^(remaining_years_to_end)
value  = shares * P_end + cash
TR_f   = value / I − 1
```

> **Note on the source sheet:** its `VALUE NO DRIP` column is `shares × price` only —
> cash is tracked separately and added at the end. Verified to the cent on its AAPW
> tab: `8.59% + 18,536.71/50,000 = 45.66%`, matching its NO DRIP TOTAL RETURN exactly.
> Our version is the same identity with cash growth added.

### 2.3 Fund-quality baseline (cash-rate independent)

Metrics describing *the fund* must not be contaminated by a cash assumption. Compute
these with `cash_rate = 0`:

```
years              = (end_date − start_date).days / 365.25
price_appreciation = P_end / P0 − 1
nav_annual         = (P_end / P0)^(1/years) − 1
gross_income       = Σ (shares0 × d_t)            # no DRIP, no cash growth
fund_total_return  = price_appreciation + gross_income / I
annual_yield       = (gross_income / I) / years
annual_fund_TR     = fund_total_return / years
```

`nav_annual` is retained as the API key for compatibility, but it is market-price
CAGR, not an official fund NAV series. The UI labels it **Price CAGR**.

### 2.4 Reinvestment Efficiency — the headline metric

```
G      = shares_full_end / shares[0] − 1      # share growth from reinvestment
C_fv   = cash balance at end for f = 0        # what the cash was actually worth
RE     = (shares[0] × P_end × G) / C_fv
```

**Reads as:** every $1 of distributions was worth `$RE` at exit under DRIP, versus
holding it as cash. Scale-free, sign-identical to the original DRIP Score, plain
language.

`RE` includes both the price advantage **and** the compounding of reinvested
distributions — that is correct, because both are genuine benefits of DRIP that the
cash path does not get. Do not describe it as "average reinvestment price"; it is not.

**Identity (use as a unit test):**
```
DRIP_score_pp = TR_full − TR_none  ==  (C_fv / I) × (RE − 1)
                                        └ income ┘  └ edge ┘
```
Display both factors. They are independent drivers — *how much* income you collected,
and *how much better* reinvesting it was — and the source sheet blended them into one
number where you cannot tell which is responsible.

### 2.5 Distribution Coverage — replaces Income vs Decay

```
coverage = annual_fund_TR / annual_yield        if annual_yield >= 0.01
         = fund_total_return / (gross_income/I) # equivalent matched-period ratio
         = null  ("not an income fund")         otherwise
```

| Coverage | Meaning |
|---|---|
| ≥ 1 | Period total return fully supported the distribution rate. |
| 0 – 1 | Positive total return, but price loss offset part of the distributions. |
| < 0 | Period total return was negative despite distributions. |

Coverage is a **performance proxy**, not a tax-source classification. It can flag
price erosion that overwhelmed part or all of the distributions, but actual return of
capital requires issuer tax notices or other source documentation.

### 2.6 DRIP Opportunity — 60/40, fixed inputs

Weighting preserved from the source (60% NAV, 40% yield). Inputs corrected so a fund
cannot score on yield it did not earn:

```
navScore      = 100 × clamp((nav_annual + 0.10) / 0.20, 0, 1)
covered_yield = min(annual_yield, max(0, annual_fund_TR))
yieldScore    = 100 × clamp(covered_yield / 0.15, 0, 1)
opportunity   = 0.60 × navScore + 0.40 × yieldScore
```

`covered_yield` is the fix: yield counts only to the extent the fund earned it. A
negative-total-return fund contributes **zero** yield score regardless of headline %.

Calibration: `navScore` is 0 at −10%/yr, 50 at flat, 100 at +10%/yr. `yieldScore`
saturates at 15% covered yield. Both constants belong in module-level named
constants, not inline.

### 2.7 DRIP Win Rate — robustness

The DRIP Score is one path to one endpoint. Sweep the exit date:

```
for each candidate exit τ (each eligible trading-day close, τ ≥ start + max(6 months, 25% of window)):
    RE(τ) computed from accumulated state at τ
win_rate = count(RE(τ) > 1) / count(τ)
```

Single forward pass, O(n) — accumulate `shares_full` and `cash` once and evaluate at
each τ.

**Stability is distance from a coin flip, not height:**
```
stable = abs(win_rate − 0.5) >= (WIN_RATE_STABLE − 0.5)     # i.e. ≤0.35 or ≥0.65
```
A naive `win_rate >= 0.65` test flags a 0% win rate as unstable, which is backwards —
0% is the most *reliable* "take the cash" signal there is. Caught on live data: CONY
and MSTY both sweep to 0% and must read as stable.

`RE = 1.22, win 91%` is a signal. `RE = 1.04, win 52%` is a coin flip in a green cell.

**Also flag `conflicted`** when the final verdict disagrees with the majority of exit
dates:
```
conflicted = (RE > 1) != (win_rate > 0.5)
```
This is not hypothetical — GDXY over 2025-06-02 → 2026-07-23 returns `RE = 0.876`
(DRIP lost at the final exit) with `win_rate = 76%` (DRIP won at most exits). A
single-endpoint score labels that fund red with no indication the call is a
coin-flip on timing. `conflicted` is a stronger signal than the raw threshold and
should drive the UI badge.

### 2.8 Verdict

Primary classification is 2-D:

| | **Coverage ≥ 1** | **Coverage 0–1** | **Coverage < 0** |
|---|---|---|---|
| **Yield ≥ 8%** | **Compounder** — DRIP | **Harvester** — take cash | **Liquidator** — avoid |
| **Yield < 8%** | **Grower** — hold, not for income | **Fading** — watch | **Broken** — avoid |

DRIP call within a bucket — **RE decides the direction, the win rate only qualifies
confidence:**
```
edge = RE − 1
|edge| < DRIP_EDGE_DEADBAND (0.02) → "Toss-up"
edge > 0                            → "DRIP"
edge < 0                            → "Take cash"
```
Do **not** gate the call on the win rate. Caught on live data: MSTY over
2024-07 → 2026-07 has `RE = 0.407` (every $1 reinvested became 41¢) with a **49%**
win rate, and an earlier `win_rate <= 0.35` gate downgraded that to "Toss-up". The
sweep counts how *often* DRIP led without weighting by how *much*, so it must not
override an emphatic economic answer — it belongs in the `stable` / `conflicted`
badges, which is where the reader learns the call is timing-dependent.

`opportunity` orders rows **within** a bucket; it is not the verdict.

### 2.9 Taxes

Deliberately absent. Distributions are taxed whether or not they are reinvested, so
the DRIP-vs-cash comparison is tax-neutral. Surface a one-line note in the UI so its
absence doesn't read as an omission. (The `cash_rate` yield *is* taxable and DRIP
growth is not — a second-order effect; note it, don't model it.)

---

## 3. Partial data

The common case is not "ticker doesn't exist" — it's "fund launched 8 months into a
24-month window". Make it an explicit request parameter rather than a hardcoded rule:

`partial_data: "include" | "exclude"` (default `"include"`)

- `exclude` — `validate_coverage`'s `bad` list is rejected outright; returned in
  `excluded[]` with its `reason` string.
- `include` — ticker runs on its own effective window; row carries
  `coverage_pct = ticker_days / window_days`, `effective_start`, and
  `partial: true`. **Ranked in a separate group from full-coverage rows** — a fund
  with 30% coverage must never outrank a full-window fund on the same axis.

Either way the response always reports what happened per ticker. Never silently drop.

**Hard rejects regardless of policy:** no data returned, empty price history, or
effective window `< MIN_DAYS`.

---

## 4. Database

Follow the `nav_erosion_saved_backtests` pattern (`backend/database.py:588`), including
the `try/except SELECT → ALTER TABLE` migration idiom used throughout that file.

```sql
CREATE TABLE IF NOT EXISTS drip_score_sets (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL UNIQUE,
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TEXT,
    start_date         TEXT,
    end_date           TEXT,
    cash_rate          REAL NOT NULL DEFAULT 0.04,
    initial_investment REAL NOT NULL DEFAULT 50000,
    partial_data       TEXT NOT NULL DEFAULT 'include'
);

CREATE TABLE IF NOT EXISTS drip_score_set_tickers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id     INTEGER NOT NULL,
    ticker     TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_drip_set_tickers ON drip_score_set_tickers(set_id);

-- optional: last-run cache so reopening the screen doesn't refetch
CREATE TABLE IF NOT EXISTS drip_score_runs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id    INTEGER NOT NULL,
    run_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    params_json TEXT NOT NULL,
    rows_json   TEXT NOT NULL
);
```

`PRAGMA foreign_keys` is not enabled in this codebase — delete child rows explicitly
in the DELETE endpoint rather than relying on `ON DELETE CASCADE`.

---

## 5. Backend module — `backend/drip_score.py`

New module, mirroring `portfolio_tester.py`'s shape (pure functions, pandas in,
dicts out, no Flask imports).

```python
# module constants — no magic numbers inline
NAV_SCORE_FLOOR   = -0.10
NAV_SCORE_CEIL    =  0.10
YIELD_SCORE_CAP   =  0.15
NAV_WEIGHT        =  0.60
YIELD_WEIGHT      =  0.40
HIGH_YIELD_CUTOFF =  0.08
MIN_INCOME_YIELD  =  0.01
WIN_RATE_STABLE   =  0.65
DEFAULT_CASH_RATE =  0.04

def simulate_drip(close, divs, ticker, start, end, *,
                  initial=50_000.0, reinvest=1.0, cash_rate=0.0) -> dict
    """Single-ticker replay. Returns shares/cash/value series + terminal state."""

def compute_ticker_metrics(close, divs, ticker, start, end, *,
                           initial, cash_rate) -> dict
    """Runs f=1.0/0.5/0.0, derives every metric in §2. One row of the grid."""

def compute_win_rate(close, divs, ticker, start, end, *, cash_rate) -> dict
    """Exit-date sweep → {win_rate, stable, n_exits}."""

def classify(annual_yield, coverage, re_value, win_rate) -> dict
    """→ {bucket, drip_call, rationale}"""

def run_drip_score(tickers, start, end, *, initial, cash_rate,
                   partial_data='include') -> dict
    """Orchestrator: fetch_prices → validate_coverage → per-ticker → rank."""
```

`run_drip_score` calls `portfolio_tester.fetch_prices` and
`portfolio_tester.validate_coverage` directly — do not duplicate the fetch layer.

---

## 6. API

Register in `backend/app.py` alongside the existing `/api/portfolio-tester/*` routes
(`app.py:29506`), importing lazily inside the handler as that route does
(`from portfolio_tester import ...`).

```
GET    /api/drip-score/sets              → [{id, name, ticker_count, start_date, end_date, updated_at}]
POST   /api/drip-score/sets              → {name, tickers[], start_date, end_date, cash_rate, initial_investment, partial_data}
GET    /api/drip-score/sets/<id>         → full set incl. tickers[]
PUT    /api/drip-score/sets/<id>         → upsert tickers + params
DELETE /api/drip-score/sets/<id>         → delete set + child rows

POST   /api/drip-score/run
       body: {tickers[], start_date, end_date, cash_rate, initial_investment, partial_data}
       200:  {meta:{start_date,end_date,years,cash_rate,initial_investment},
              rows:[...], partial:[...], excluded:[{ticker,reason,earliest}]}

GET    /api/drip-score/detail?ticker=X&start_date=&end_date=&cash_rate=&initial_investment=
       200:  {summary:{...}, schedule:[{date, price, dividend, div_full, div_50, div_zero,
                                        shares_full, shares_50, value_full, value_50,
                                        value_none, cash_none, current_yield}]}
```

`detail` is the equivalent of the source spreadsheet's per-ticker tab, including its
`current_yield` column (the source's formula verified exact against its AAPW tab:
`0.2648 × 52 / 36.00 = 38.25%`).

**Annualise each payment by elapsed time, not by a global cadence:**
```
current_yield_t = d_t × (365.25 / gap_days_t) / P_t
```
where `gap_days_t` is the days since the previous payment (the first payment
borrows the second's gap). Two bugs this avoids, both found on live MSTY data:

* A single window-wide frequency misannualises every payment on the other side of
  a cadence change. MSTY paid monthly until early 2025 then weekly; a global ×52
  reported **466%** where the true figure is ~109%.
* Snapping each gap to a canonical cadence instead has a 3× cliff at the
  monthly/quarterly boundary — MSTY's 48-day gap (2024-09-06 → 2024-10-24) read
  **59.89%** between neighbours of 109% and 118%. Elapsed time gives 113.92%.

On a clean weekly schedule elapsed time yields `365.25/7 = 52.18` against the
52-week convention — a 0.34% difference, far cheaper than either cliff. Keep the
bucket label (`period_frequency`) as descriptive text only.

**Row shape** (`rows[]`):
```json
{
  "ticker": "AAPW", "name": "Roundhill AAPL WeeklyPay ETF",
  "price_appreciation": 0.0859, "nav_annual": 0.0772,
  "tr_full": 0.5386, "tr_50": 0.4953, "tr_none": 0.4566,
  "annual_yield": 0.3343, "covered_yield": 0.3343,
  "drip_score": 0.0820, "re": 1.221, "income_factor": 0.3707,
  "coverage": 1.21, "nav_score": 88.6, "yield_score": 100.0,
  "opportunity": 93.1, "win_rate": 0.91, "stable": true,
  "bucket": "Compounder", "drip_call": "DRIP",
  "coverage_pct": 1.0, "partial": false,
  "effective_start": "2025-06-02", "distribution_count": 58, "frequency": "weekly"
}
```

Return **decimals, not percentages** — formatting is the frontend's job.

---

## 7. Frontend — `src/pages/DripScore.jsx`

Route `/drip-score`, `NavLink` next to NAV Erosion Screener in `src/App.jsx`.

**Layout**
1. **Set bar** — saved-set dropdown, name field, Save / Save As / Delete.
2. **Ticker entry** — textarea or chip input, paste-friendly (comma/space/newline),
   uppercase + dedupe on blur. 75 max, matching `MAX_TICKERS_PER_PORTFOLIO`.
3. **Params** — start/end date pickers, cash rate, initial investment, partial-data
   toggle. Run button.
4. **Coverage banner** — excluded tickers with reasons; partial tickers with their
   effective windows. Always visible when non-empty. This is the "let the user know
   there is no data for the time period chosen" requirement.
5. **Grid** — sortable, full-coverage rows first, partial rows in a labelled second
   group. Bucket as a coloured chip, not a bare number.
6. **Detail drawer** — row click → schedule table + share-count/value chart.

**House rules that apply here**
- Money must go through the `money.js` helpers (USD→CAD display conversion). Never
  hand-roll `'$' + toLocaleString`.
- Charts via `ThemedPlot`, not raw Plotly.
- Any sub-component using `isDark` must call the hook itself — `no-undef` is an ESLint
  **error** in this repo precisely because that mistake blanked whole screens.
- Colour scale: keep green/yellow/red for `drip_score` sign, but pair every colour
  with a text label. Do not rely on colour alone.

---

## 8. Edge cases

| Case | Handling |
|---|---|
| Zero distributions in window | `annual_yield = 0` → coverage `null`, bucket `Grower`/`Broken` by NAV. `RE` undefined → `null`, `drip_call = "N/A"`. Do not divide by zero. |
| `C_fv = 0` (no cash path) | `RE = null`. Guard before the division in §2.4. |
| Ticker delisted mid-window | `P_end` = last available close; set `effective_end` and mark `partial`. |
| Stock split in window | **Resolved — no action needed.** Verified empirically: Yahoo's `Close` is already split-adjusted even with `auto_adjust=False`. NVDA's 10:1 split (2024-06-10) shows `Close` continuous at 120.89 → 121.79 across the split date, with `Stock Splits = 10.0` recorded separately. Dividends are back-adjusted on the same basis. Share counts stay continuous; do **not** apply a second adjustment. |
| Special/irregular distribution | Included as-is; frequency inference uses the median gap, so one-offs don't distort it. |
| `end_date` in the future | Clamp to last trading day; report clamped value in `meta`. |
| Window < `MIN_DAYS` | 400 with a clear message. |
| Same ticker twice | Dedupe on entry. |

---

## 9. Tests — `backend/test_drip_score.py`

Follow the existing `test_*.py` convention (monkeypatched fetch, no network).

1. **Identity** — `TR_full − TR_none == (C_fv/I) × (RE − 1)` on synthetic data.
2. **Flat price, any yield** — `RE > 1`, matching the analytic
   `P·((1+d/P)^n − 1)/(d·n)` exactly. **Not** `RE == 1.0`: at a flat price DRIP still
   beats 0% cash, because reinvested shares generate their own distributions while
   idle cash does not. The break-even cash rate is roughly the distribution yield.
3. **Monotonic rising price** — `TR_full > TR_50 > TR_none`, `RE > 1`, win rate 1.0.
4. **Monotonic falling price** — `TR_full < TR_50 < TR_none`, `RE < 1`, win rate 0.0.
   (This is the GDXY case from the source sheet: 22.93% / 24.97% / 25.87%.)
5. **Cash rate sensitivity** — raising `cash_rate` strictly lowers `RE`.
6. **Coverage sign** — negative total return with positive yield → `coverage < 0` →
   bucket `Liquidator`.
7. **Covered yield** — negative-TR fund gets `yield_score == 0` despite a 70% headline.
8. **Zero distributions** — no crash, `coverage is None`, `re is None`.
9. **Partial data** — `include` returns the row flagged and ranked separately;
   `exclude` returns it in `excluded[]` with a reason.
10. **Split handling** — synthetic 2:1 split mid-window; share count and terminal
    value must be continuous across it.

Cross-check regression: the source sheet's `DRIP Score = TR_full − TR_none` identity
held exactly on ~20 of its rows (AMDW 82.41, GOOW 37.13, MSTY −21.26, HOOY −8.66,
GDXY −2.94, HOII −1.77, GIF −0.66). Our `drip_score` column must reproduce that
relationship.

---

## 10. Build order

1. ~~`drip_score.py` — §2 math + unit tests.~~ **DONE.** `backend/drip_score.py` +
   `backend/test_drip_score.py`, 22 tests green, verified end-to-end against live
   Yahoo data. Run with `py -m unittest test_drip_score` from `backend/`
   (this environment has no `pytest`).
2. ~~DDL + set CRUD endpoints.~~ **DONE.** Tables in `backend/database.py`
   (after `nav_erosion_saved_backtests`), routes in `backend/app.py` (after
   `portfolio_tester_run`), round-trip tests in `backend/test_drip_score_api.py`
   (12 tests, Flask test client against a temp DB, no network).
   `drip_score` is imported lazily inside the handlers — it pulls in
   `portfolio_tester` → `yfinance`, and this codebase deliberately keeps yfinance
   off the startup path.
3. ~~`/api/drip-score/run`.~~ **DONE.** Accepts inline `tickers` or a `set_id`
   (body values override the set's stored parameters). Caches the latest run per
   set in `drip_score_runs`, readable via
   `GET /api/drip-score/sets/<id>/last-run`. Ad-hoc runs are not cached.
   Fund names resolve offline — see below.
4. ~~`DripScore.jsx` — grid + coverage banner.~~ **DONE.**
   `src/pages/DripScore.jsx`, route `/drip-score`, NavLink beside NAV Erosion
   Screener, styles appended to `src/index.css` under the `ds-` prefix (CSS tokens
   only, so light mode works without a second pass). Verified in the browser:
   `npm run dev` → `#/drip-score` (the app uses **hash** routing). ESLint: 0 errors.
5. ~~`/api/drip-score/detail` + detail drawer.~~ **DONE.**
   `build_detail` / `run_detail` in `drip_score.py` merge the three DRIP modes into
   one schedule; the drawer (row click, Escape to close) shows summary tiles, a
   three-way terminal comparison with the winner marked, and the full payment table.
6. ~~Win-rate sweep (§2.7).~~ **DONE** — built in step 1, refined in step 4
   (see the RE-decides-direction note in §2.8).

---

## 11. Empirical validation

The math in §2 was run end-to-end against live Yahoo data before this spec was
finalised. Window 2025-06-02 → 2026-07-23, `cash_rate = 0.04`, 161 exit dates swept.

| Ticker | NAV ann. | Yield | Coverage | RE (4% cash) | RE (0% cash) | Win rate | Expected bucket |
|---|---|---|---|---|---|---|---|
| AAPW | +13.01% | 35.11% | 1.34 | 1.280 | 1.312 | 99% | Compounder → DRIP |
| DGRO | +20.75% | 2.54% | 9.14 | 1.106 | 1.133 | 100% | Grower |
| GDXY | −34.93% | 52.37% | 0.35 | 0.876 | 0.897 | 76% | Harvester (**conflicted**) |
| CONY | −70.08% | 49.26% | −0.34 | 0.602 | 0.620 | 0% | Liquidator → avoid |
| MSTY | −85.12% | 40.49% | −0.95 | 0.421 | 0.434 | 0% | Liquidator → avoid |

Confirms:
- **`P0 = 36.09` for AAPW matches the source spreadsheet exactly** — same data source,
  same start handling.
- **The §2.4 identity holds to the cent**: `TR_full − TR_none = 12.46pp` and
  `(C_fv/I)(RE − 1) = 12.46pp`.
- **Cash rate behaves as specified** — raising it to 4% strictly lowers `RE` on every
  ticker (spec §9 test 5 passes empirically).
- **Coverage separates the failure modes** the source sheet's 999 sentinel could not:
  DGRO (9.14, healthy, low yield) and CONY (−0.34, paying out of capital) are at
  opposite ends instead of both sitting in the ambiguous middle.
- **Path dependence is real and large.** AAPW's DRIP Score was 8.19pp in the source
  video and is 12.46pp today — a 52% move in ~2 weeks purely from the exit price
  ($39.01 → $41.49). Single-endpoint scoring is not stable enough to publish without
  the §2.7 sweep.

Reproduce with the ad-hoc script in the git history for this doc, or via
`test_drip_score.py` once step 1 lands.

---

## Open items

- ~~**Fund names**~~ **RESOLVED — no network call.** `etf_provider_funds`
  (bundled seed data, ~2 600 funds) maps `symbol` → `fund_name` and covers the whole
  option-income universe with properly-cased names matching the source spreadsheet
  ("Roundhill AAPL WeeklyPay ETF", "iShares Core Dividend Growth ETF").
  `holdings.description` is the fallback for anything the seed misses, though it is
  the broker's ALL-CAPS text. Unknown tickers get `name: null` rather than failing.
- **`initial_investment`** — every ratio is scale-invariant, so this only affects the
  detail view's dollar columns. Could be a detail-view-only input rather than a
  set-level parameter.
