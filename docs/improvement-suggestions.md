# Product and data improvement suggestions

Captured from a review of Portfolio Tracking Client **v1.35.2** on 2026-08-19 (branch `feature/snowball-category-hierarchy`).

The app is already strong at income, CEFs, option overlays, and brokerage imports. The highest-value improvements are not more screens. They are findability, finishing half-wired workflows, and a few data-integrity holes that already spawned repair tools.

Do **not** prioritize more scanners, more simulators, or dark mode (already present). The spine of the product is already there: Schwab All-Accounts mapping, estimated vs actual DRIP, ETF closure risk, basis modes, Action Center.

Suggested implementation order if only a few items get built:

1. Finish Snowball parent/subcategory assignment (current branch).
2. Command palette plus hide unused pages.
3. WAL-safe backup plus transaction dedupe hash.
4. Action Center one-click refresh plus option / NAV / import items.

---

## 1. Make the product easier to find, not larger

There are ~90 screens. The Portfolio menu alone has more than 20 items, Analysis has another ~25, and Menu Control can only reorder — it cannot hide, pin, or regroup.

A command palette (page + ticker + action) plus **hide unused screens** would help more than another calculator. Role presets would also help: Income tracker, CEF analyst, Options overlay.

Related overlap that should be folded, not kept as peers:

| User question | Current screens |
|---|---|
| How is the portfolio doing? | Growth, Portfolio Growth 2, Total Return, Gains & Losses, Dashboard |
| What did I get paid? | Dashboard week grid, Dividends, Dividend Ledger, Dividend Calendar, Dividend History, Dividend Compare |
| Can this income cover my life? | Retirement Readiness, Cash Flow, Safe Withdrawal, Income Simulator, Income Growth, Growth & Income Freedom |

“Portfolio Growth 2” is still a prototype name. Growth 2’s dollar + broker-reconciliation view should become the Growth page, with tabs for vs-market / dollars / lots.

---

## 2. Finish Snowball category hierarchy

This is one of the few current gaps that actually deserves extra-high reasoning. The tree import and holdings import do not agree:

- **Categories import** creates parent + slash subcategories (`GROWTH / Growth-Stocks`) but does not assign tickers.
- **Holdings import** treats the raw label as a top-level category, so you can end up with both `GROWTH / Growth-Stocks` and `GROWTH` → `Growth-Stocks`.
- Import copy contradicts itself: one blurb says the categories file does **not** import sub-categories; another says `GROWTH / Growth-Stocks` does.

A Snowball migrant still has to hand-assign tickers, so Action Center’s “Assign unallocated holdings” and Rebalance Wizard stay noisy.

A single “Migrate from Snowball” path would be better: holdings + category tree + ticker mapping, with a preview of assigned vs skipped.

---

## 3. Turn Action Center into the daily inbox

The idea is right. The wiring is not.

“Refresh Data” currently links to Holdings instead of running a market refresh. Completing “Assign unallocated holdings” can hide a real allocation hole. It also does not yet cover the follow-ups this user actually cares about:

- option expirations and rolls
- NAV erosion / CEF discount
- estimated vs actual dividend deposits
- stale Schwab re-import for one account

Dashboard already has useful banners (stale import, ETF closure). Action Center should be the place those land, with one-click refresh.

---

## 4. First-run import should be a checklist, not a format encyclopedia

Import offers 16 formats. The real happy path is:

1. Schwab All-Accounts positions
2. Map accounts
3. Transactions for dividends / DRIP / lots
4. Optional Snowball categories
5. Refresh prices

That order is documented in Help. It is not the UI. Wrong order still wrecks cost basis and share counts.

Broker-first would be better: pick Schwab → positions vs history → map accounts. Hide Snowball unless migrating. Empty Dashboard should start that wizard instead of rendering an empty holdings spreadsheet.

---

## 5. Dashboard should stop being a second Holdings page

Dashboard currently stacks headline cards, grades, income run-rate, week calendar, donut, **and** a ~40-column holdings grid. Holdings is already the editor. CommonInfo is a third holdings table with a Snowball-shaped layout, no Help section, and a name that does not explain itself.

Daily view should be: value, income this week, what’s broken, what’s paying. Drill into Holdings to edit. Rename or absorb CommonInfo.

---

## 6. Unify ticker research

CEF discount, NAV trend, distribution coverage, checklist score, and closure risk are one decision, split across Closed CEF Information, NAV Erosion, Security Research, ETF Screen, and four checklists.

A ticker click from Dashboard / Holdings should open one research sheet with those already filled from the position.

---

## 7. Fix the data problems that already needed repair scripts

These are more important than new features because they make numbers lie.

**WAL-safe backup/restore.** The live DB uses WAL. Import backup still does `shutil.copy2` on `portfolio.db` only (`_create_import_backup`). Restore can leave old `-wal` files to replay onto a restored copy. `backend/backups/` already has ~100 copies. Use SQLite’s `backup()` API, checkpoint, then atomically replace.

**Stable transaction identity.** `transactions` has no unique key besides `id`. Re-import dupes are why `dedup_transactions.py` exists. Option trades already have `dedupe_hash`; equity trades should too.

**One Snowball assignment helper.** Slash labels should always become parent + subcategory + `ticker_categories.subcategory_id`, from both the categories file and the holdings file.

**Don’t stamp an official close on a partial Yahoo refresh.** Auto-capture currently writes `source='close'` even when some tickers failed and kept yesterday’s price.

**Persist market-data freshness.** Yahoo/XFUNDS caches are in-memory, so a restart is a cold start and a scrape miss can silently fall back to Yahoo (already a bad fit for new XFUNDS names like DRMY/FIZY).

**IV Rank needs a daily collector.** It only accumulates when a scan prices a chain, needs 20 observations, and generic scans hard-cap at 40 symbols. That is more useful than more strategy constructors.

**Don’t dual-write holdings and leak zero-quantity rows.** Source of truth is `all_account_info`. Parallel `holdings` / `dividends` tables and leftover qty ≈ 0 rows still leak into reports. Treat `all_account_info` as canonical; never `DROP TABLE` user holdings/dividends as a schema migration.

**Refresh ETF provider seed instead of `INSERT OR IGNORE` forever.** Once any row exists, a newer `backend/seed/etf_providers.db` never applies.

---

## 8. Smaller, cheap wins

- Help is still labeled **1.35.0** while the app is **1.35.2**. It also misses CommonInfo, Split View, several Options education pages, and most of the CEF guides. Add a chooser: “I want this week’s pay / broker vs app / CEF discount / NAV bleed.”
- Retire leftover per-strategy scanner pages and Help entries now that General Option Scanner is the product.
- Remove or hide the unreachable “Owner spreadsheet” import tab.
- Don’t ship a shared default FRED API key in `backend/config.py`.
- Tighten `ticker_categories.subcategory_id` so it has a real foreign key; incomplete deletes currently leave orphans.

---

## Notes from the review

- Menu Control (`src/pages/MenuControl.jsx`) reorders items but cannot hide them or move them between menus.
- There is no global search / command palette.
- Action Center’s primary button is a `NavLink` to `/holdings`, not `/api/refresh`.
- Snowball category tests cover tree import well; holdings import of slash labels into subcategories is the missing path.
- `docs/GENERAL_OPTION_SCANNER_HANDOFF.md` and `docs/options-volatility-surface-roadmap.md` still describe leftover scanner work (IV Rank warmup, 40-name cap, historical vol surface).
