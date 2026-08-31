# Portfolio Tracking Client v1.35.6

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Account Cash

- Account cash was written only by a broker import and then stood untouched until the next one, rendering as a bare dollar figure that reads as current. On a book of weekly payers something settles nearly every business day, so the stored figure is usually days behind and an ordinary import lag reads as a broken number. Manage Portfolios now has a **Cash** column you can edit in place between imports.
- Deliberately no lock on the field: the next import overwrites a typed figure without asking, exactly as a typed figure overwrites the last import. Cash is the one field where the broker outranks you — a typed number starts decaying the moment the next distribution settles, so a lock would make the app prefer the staler figure. The Owner rollup owns no cash of its own and sums its members, so writing to it is refused rather than stranding a figure nothing reads.
- Every place cash appears now carries its age — "as imported 8/26 · 3 days ago", or "entered by hand today". A rollup is only as fresh as its stalest account, so it reports the oldest stamp and says so, and an account holding cash with no stamp at all leaves the total undated rather than borrowing a date it cannot support.
- Added an estimate of how far a stale balance has drifted since it was written, drawn from the distributions that settled after the stamp day. Holdings on DRIP are excluded outright — those bought shares, so folding them into a cash estimate would invent money. It is worded as the floor it is ("+$113.75 paid since · at least $1,098") because trades, option premium, fees, and interest also move cash and leave no trace in the payment ledger; the tooltip names what it cannot see. Accounts carrying a margin debit are supported, and their negative balance reads correctly as it shrinks toward zero.
- Documented how cash works in the three places the surprise shows up: a collapsible explainer on Manage Portfolios, a Cash balances section in Help under Portfolios, and a note on the Total Return card that the cash inside Account Value is dated — that card is where a broker comparison actually happens.

## Performance Windows

- Fixed the 1D window silently dropping most of the portfolio. 1D is the only period resolved by session rather than by date, so guards written for a long window ran on a two-row frame and "a ticker needs at least two real observations" quietly became "a ticker needs a perfect 2-of-2 hit rate or it is deleted." On a 266-ticker book that removed most of the account: Start Value read $5,963 against a $5.66M portfolio, and a -$75,000 day reported as -$219. Each ticker's last real close is now carried forward before the trim discards the rows that explain the gap, so a position that simply did not print is priced at its actual last trade instead of dropping out. Only price levels carry — dividends, capital gains, and splits are events, and repeating one would pay the same distribution twice.
- Whatever still gets excluded is now weighed against the book it left, and the screens refuse a confident number when the gap is material. Under 2% stays a footnote; past that the cards read **Partial**, demote the figure to a subline, and a banner names the dollars left out. Total Return, Dashboard, Growth, Gains & Losses, and Growth 2 all react the same way.
- Fixed the calendar-offset presets (7D, 1M, 3M, 6M, 1Y, 2Y, 5Y) opening on the session *after* their start date whenever that date landed on a weekend or holiday, losing the first session's move without leaving a trace. Only YTD and Custom reached back past a closed market for a baseline, though the page has always claimed all of them did. This is not rare — the monthly and yearly offsets land on the same day-of-month, a weekend roughly two times in seven, and 7D lands on the same weekday as today, so it was wrong every weekend. On a real book, 7D from a Saturday reported -$713 against the -$3,637 its equivalent Custom range showed, understating the week's loss fivefold. Every preset now anchors on the close on or before its start date; ranges that already began on a trading day are unchanged.

## Option Scanners

- Made the scanner probabilities and the payoff graph one coherent model. Long-dated downside structures now score the untested region above their highest put as a campaign success rather than a loss, where a small entry debit had made that flat line slightly negative at expiration; both readings are computed and reported separately. Strategy Lab no longer fills its probability cards field by field, which could place a live probability of profit beside a snapshot max-profit figure computed from a different IV and make the subset larger than the whole.
- The payoff chart keeps each leg's observed IV instead of collapsing every quote into one average, which had flattened the skew the scanner just measured, and it now carries the real risk-free rate and dividend yield rather than a hardcoded 4% and no yield.
- Long Call and the other 18 generic strategies are substantially faster: seven serial quote requests per ticker became three concurrent ones against a single primed session, measured at 18x wall clock and 57% fewer requests for identical rows. Their expiration odds now come from the same probability model the other scanners share — verified against closed-form Black-Scholes on live chains to within 0.05 percentage points — replacing a sampled approach coarse enough that two different strikes on two different expirations reported identical max-loss probabilities. Probability of success and failure had been blank for all 19 strategies.
- Covered call, cash-secured put, and bull put scans reuse a primed quote session and cache expiration catalogs so a ticker is not asked twice for the same chain. Their probability cards now use the traded strike's own implied volatility instead of a lower at-the-money reading, so expiration loss odds stay in line with the short leg's delta instead of collapsing toward 1%.
- A throttled quote feed used to surface as "No candidates met every active filter," sending you to loosen rules that were never consulted. Scans now name the outage, set an error when nothing priced at all, and show how much of the universe went unpriced.
- Quality presets now skip stocks with earnings inside the trade and require a favorable volatility skew, with skip/allow/require controls and exact-versus-near result filters.
- Fixed the delta presets in the editor — conservative/balanced/aggressive — raising an error on every selection because the engine only accepted numeric pairs, and corrected the unbalanced butterfly's upper long delta options.
- Fixed far-OTM covered calls displaying as in-the-money on the Strategy Lab risk graph.

## Risk Graphs

- The option risk graphs now read like thinkorswim. Analysis date, the time slider, volatility surface, price range, and day-step lines move inside the chart shell so they sit against the curves and travel with the graph into the Expand overlay. Price slices — greeks and P/L at the current price and its offsets — move from the page tail to directly beneath the graph, with the current price row highlighted.
- The break-even line is drawn dotted across the full paper width so it survives zoom and pan, making it obvious whether a day-step line is in profit, and the boxed current-price annotation is replaced by a bare rotated price at the axis.
- Repricing is now layout-neutral: a spinner inside the fixed-height readout strip and a dimmed chart frame, replacing a block-level notice that was inserted and removed on every slider tick and shoved the whole page down and back.

## NAV Erosion

- Added an up-market price recovery test to NAV erosion scoring. A fund's share-price recovery on benchmark up days is measured amount-weighted from unadjusted price returns only, and can reduce the raw-loss warning by at most 75% — distributions and total return are deliberately kept out of that credit, so a fund cannot buy down an erosion warning with its own payout. The portfolio view reports an aggregate recovery score and capture rate, banded Low (0–25), Moderate (above 25–75), and High.

## Holdings and Dividends

- Added a **Transaction History** panel to Manage Holdings with filters, clearer labeling of closed positions and zero-value rows, and hover help on values and column headings explaining how a lot is read.
- Squared the Daily, Weekly, and Monthly payments ledger with the dividend calendar so the two views agree on what a holding has actually paid.

## Charts

- SMA 50 and SMA 200 now overlay the price charts on Stock and ETF Analysis, the scanner popups, and Strategy Lab.

## Interactive Brokers Import

- Added Interactive Brokers as a supported broker: import an IBKR Activity Statement's positions and transaction history the same way other brokers work, including CAD conversion, preferred-share tickers, and skipped option contracts. Interactive Brokers is now available throughout Import, Manage Portfolios, option-trade import, and Help. Month-end snapshots, nearby same-amount dividends, lifetime income from closed positions, and ticker research all stay in sync when a purchase date is missing from the statement.

## Grades and NAV Scores

- Fixed a class of holdings showing no grade and no NAV erosion score at all. A quote-feed rate limit was being cached as a permanent verdict rather than a temporary outage, so a brief Yahoo throttle could pin blank grades across every account for the full 30-minute cache window. Outages are now detected correctly and are never cached over a good result, so the next load retries instead of repeating the same blank cards.
- Added broker-to-Yahoo symbol resolution so holdings using a broker-specific spelling can be graded. Interactive Brokers exports several Canadian listings and preferred shares under symbols Yahoo doesn't recognize; Settings now has a **Broker Symbol Mapping** panel that scans your holdings for anything Yahoo can't price, resolves what it can, and lets you fill in the rest by hand.
- Fixed a display bug where a holding could show a real letter grade in the table while a banner said Yahoo had no listing for it and it "cannot be graded" — both were true at different moments, and the older of the two was left showing after the newer one changed.
- Fixed NAV erosion scores silently defaulting to a falsely reassuring "Low" verdict when only the benchmark's price history failed to download; a fund is no longer scored against itself when its benchmark data goes missing.
- NAV erosion benchmark downloads are now shared across every holding that uses the same benchmark instead of being re-fetched once per holding, which was itself a source of the rate-limit outages above.

## NAV Erosion Back-Test

- A benchmark with no available price history (a typo, or a symbol Yahoo doesn't carry) no longer aborts the entire NAV erosion back-test. The tool now falls back to the fund's mapped default benchmark, and the raw NAV numbers, chart, and distributions that never depended on a benchmark are no longer blocked by one that failed.

## Dividends and Distributions

- Fidelity payouts that are split across a dividend line, a capital-gain line, and a return-of-capital line on the same day are now summed into one payment instead of only the ordinary dividend portion being recorded. A fuller re-import replaces a partial amount saved before this fix.
- Added automatic issuer-website distribution parsers so newer or less-common funds can pick up official ex-date, pay-date, and per-share figures without waiting on a manual data source to catch up.
- Fixed an OTF (Blue Owl Technology Finance) forward dividend schedule issue that could show an incorrect upcoming payment.

## Portfolio Analytics

- Portfolio Analytics 1-month returns and period grades now match the Dashboard's numbers, using the same calendar lookback, window-scaled observation floor, and equity-only price series.

## Earlier Option Scanner Work

- Unbalanced Butterfly and related butterfly-family scans are significantly faster: the probability schedule, profit-capture panel, and price-scenario table are now built only for the winning structure instead of every structure considered during the scan.
- Fixed the profit-capture panel showing 0.0% at early checkpoints of a long-dated butterfly. A structure that can only reach a small fraction of its max profit far from expiration was technically correct but unhelpful; the panel now reports against what the structure can actually reach at that point in time.
- Added a monthly price-scenario table showing hold-it-out P/L at several prices.

## Fixes

- Fixed deleting a portfolio with linked records: a deterministic alphabetical delete order could violate foreign-key constraints on a populated database. Deletion now follows the live foreign-key graph, removing child rows before their parents.
- Fixed the Grd (grade) column sort on the Holdings screen sorting grades as text instead of by rank.
- Fixed the Split View page menu showing duplicate chart entries.
- Moved the Share of Portfolio column next to Subcategory on the General holdings view.

## Builds

GitHub Actions produces installers from this release tag:

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.35.5...v1.35.6
