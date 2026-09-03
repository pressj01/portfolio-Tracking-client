# Portfolio Tracking Client v1.35.8

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## CEF Buying Checklist

- Refined peer comparisons and alternative recommendations so funds must share the same category, strategy and detected theme. Leveraged funds are compared with other leveraged funds within 10 percentage points of their reported leverage; unleveraged funds are compared with unleveraged funds. An emerging-markets equity fund such as EMF can no longer appear as a bond-fund alternative to TEI simply because both invest in emerging markets.
- Replaced the flat 1.25% / 1.50% expense cutoffs with an actual comparable-peer benchmark. The checklist shows the peer median, arithmetic average, sample size, and expandable tables of the peers and their leverage and expenses. Defaults pass expenses at or below the median, warn through 1.25 times the median, and fail above that. Total expenses still include financing costs; the app explains why a pass on the amount of leverage does not establish whether borrowing is inexpensive.
- Expense and track-record comparisons now require at least three other peers with usable data. Smaller samples are shown for context and left unscored, with no automatic expense failure. Missing leverage is no longer treated as no leverage. Peer calculations exclude the selected fund and duplicate tickers, use a proper median, and compare matching NAV-return periods.
- Corrected warning-band badges that could show Pass just beyond a pass threshold. Removed the earnings-coverage score adjustment because the data feed does not establish matching earnings and distribution periods. The composite now makes the number of scored checks visible, and alternatives must have the same scored criteria as the selected fund.
- Added hidden **How grading works and why these defaults?** help covering each check, the screening choices behind the defaults, score adjustments, peer selection, composite scores and verdicts. It distinguishes the app's thresholds from regulatory requirements and explains the limits of comparisons that include leverage costs. Existing non-expense custom thresholds are retained.
- CEF tickers in **Scan a List** results now open the selected fund's CEF information page. Peer-comparison tickers and alternative recommendations link to the same fund-detail pages.

## Owner Imports and Upgrade Safety

- Fixed standalone Owner portfolios being treated as account rollups and blocked from imports. An Owner portfolio with no member accounts can retain its own holdings, choose a broker and receive supported imports; an Owner rollup with member accounts continues to route single-account imports to the underlying brokerage account.
- Preserved standalone Owner data during legacy-database upgrades and subsequent reconciliation. Only snapshots produced by rollup reconciliation are cleared when membership changes; directly imported holdings are retained. Added regression coverage for upgrade preservation and import routing.

## Windows Installation

- Fixed the app refusing to start on Windows PCs with Smart App Control turned on. The window never appeared; an error box reported only "Backend exited during startup with code 1", and the diagnostic log named `ImportError: DLL load failed while importing internals: An Application Control policy has blocked this file`. Nothing was wrong with the installation — Windows was blocking one of the files. Smart App Control, on by default for clean Windows 11 installs, refuses to load any program file it neither recognizes nor sees a trusted signature on. The installer, the app, and the backend program have carried a signature for several releases, which is why the app got as far as starting up at all, but the roughly 190 compiled data-analysis modules the backend loads on its way up did not. All of them are now signed with the same certificate, and the build refuses to publish if even one of them is missing its signature. Reinstalling over an affected copy is enough; your database and settings are untouched.
- A startup failure caused by Windows blocking a file now says so. "Exited during startup with code 1" reads like a bug in the app and sends you to reinstall it, which cannot help when the installation was never the problem. The dialog now names Windows as the cause, points at the Event Viewer entry that identifies the blocked file, and lays out the two ways forward: on a personal PC, Smart App Control can be turned off in Windows Security — worth knowing that Windows will not allow it to be turned back on afterwards without reinstalling Windows — while on a work PC the same block can come from a policy only your administrator can change. Startup failures with any other cause report exactly as they did before.

## Market Data Reliability

- Yahoo's rate limit cannot be avoided, but the app was making every throttle worse. A refusal was indistinguishable from an ordinary missing symbol, so several parts of the app retried it symbol by symbol at the same time, turning one throttle into dozens of requests and extending the block that caused them. Every Yahoo request now goes through a single gateway with one policy: rate-limit-aware backoff that honors the wait Yahoo asks for, capped at a 20-second budget so nothing hangs; a cooldown that closes the gate after three consecutive throttles and reopens it with one probe rather than a stampede; and request coalescing, so simultaneous identical requests share one round trip. A delisted ticker or a bad date range still fails immediately, because retrying cannot change that answer. Measured under a sustained throttle, a single session — the dashboard across four ranges, a put scan, and a portfolio comparison — dropped from 17 requests to 3.
- Being rate limited is no longer reported as bad data. The portfolio comparison used to say "missing price history" and the DRIP score "no data returned" when Yahoo was simply refusing to answer; both now name the cooldown, so you can wait it out instead of hunting for a data problem that does not exist. When a fetch is throttled the last good prices are served with an explicit stale marker rather than a blank.
- Fixed three ways a momentary throttle could be recorded as a lasting fact: a refused quote was cached as an all-empty result, a refused options catalog was cached as "this ticker has no options," and a refused symbol check wrote a permanent blank into the symbol map so that symbol would never be looked up again.
- Fixed a symbol-matching bug that mislabeled downloaded price data for anyone holding a ticker whose name collides with a data column, notably LOW and OPEN.

## Settings

- Added a **Price Data Freshness** card, off by default. Choosing Reuse Recent Prices lets repeated screens share a recent download instead of re-fetching, with a 1–60 minute window (default 10), a Clear button, and a running count of requests saved. Both options are spelled out side by side so the trade-off is not a guess, and the card states plainly that only market prices are ever reused — never holdings, transactions, cost basis, or dividend records. Flipping between two dashboard ranges three times costs 12 Yahoo requests with it off and 4 with it on.
- Fixed a stray "0" appearing next to Use Override on the currency card. The display was the symptom; the cause was that a deliberately empty exchange rate was being stored as the number zero, so every user without an override was holding a wrong value that merely happened to be invisible in most places.

## Portfolios

- Owner is now an optional rollup you create when you want it, rather than an account that always exists. It is created explicitly, its membership is chosen per account in a new Owner column, and it can be deleted. It is labeled throughout as what it is — a rollup with no broker, which sums its members' cash and cannot be renamed — so it is no longer mistaken for a brokerage account. Test and non-owned accounts are excluded from it by design.
- Deleting the portfolio you currently have selected now moves you to your first remaining account instead of falling back to a hidden internal one, which could leave the app pointed at a portfolio you could not see.

## Holdings and Transactions

- Added same-day execution ordering for transactions. Buys and sells sharing a date were replayed in the order the database happened to hold them, which is not necessarily the order they filled — and with FIFO lot matching, that order decides which lots a sale consumes and what cost basis it reports. Manage Holdings now shows a **Same-day Order** column with arrows to place same-day rows in their real sequence, recalculating lot matching and cost basis after each move. Upgrading changes nothing on its own: every existing transaction keeps the order it was already being replayed in.

## Total Return

- The reconciliation coverage note now names the positions it counted. It could previously only tell you how many were reconciled, which raised the obvious next question — which ones, and is my ledger actually wrong — and left no way to check. Each position is listed with the shares added back, what the ledger nets to, and what you actually hold, labeled as a ledger deficit (check purchases and transfers in) or a surplus (check sales and transfers out). Genuine gaps sort to the top, since a long list is otherwise mostly rows that need nothing, and positions opened before your earliest imported trade are called out as worked backward from today's holdings rather than presented as facts from the ledger.
- Clarified what Account Value includes. Start and End Value never include cash on any period, not only Life, and Account Value appears on every period ending today — the cards said otherwise by implication. Added hover explanations on the cards and strengthened the wording in the hidden help.

## Security Research

- Distribution frequency now appears on the Security Research cards, so a fund's cadence is visible alongside its distribution history instead of having to be inferred from the chart.

## Fund Scanners

- Fixed the CEF scan dropping real closed-end funds. Confirmed CEFs no longer require Yahoo metadata to be shown or graded — CEF Connect already supplies enough, and Yahoo's response for closed-end funds is frequently missing or misclassified, ADX being the standing example. Confirmed CEFs are also moved to the front of the queue before the batch limit applies, so a scan can no longer spend its whole allowance on non-CEFs and silently drop a CEF further down the list.

## Help

- Fixed the Holdings help describing the ticker link as another way to open the edit form; it opens the Security Research sheet.

## Builds

GitHub Actions produces installers from this release tag:

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.35.7...v1.35.8
