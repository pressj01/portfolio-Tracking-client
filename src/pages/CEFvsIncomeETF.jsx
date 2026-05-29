import React, { useState } from 'react'

const TABS = [
  { id: 'cef', label: 'What Is a CEF?' },
  { id: 'etf', label: 'What Is an Income ETF?' },
  { id: 'compare', label: 'CEFs vs Covered Call Funds' },
]

const COMPARE_ROWS = [
  {
    category: 'Structure',
    cef: 'Closed-end: fixed share count set at IPO. Shares trade on an exchange between investors.',
    ccf: 'Open-end ETF: new shares are created or redeemed daily via an authorized participant mechanism.',
  },
  {
    category: 'Price vs. NAV',
    cef: 'Market price diverges from NAV — funds trade at a discount or premium. Discounts can be buying opportunities; premiums are a risk.',
    ccf: 'Market price stays very close to NAV because arbitrageurs can create or redeem shares whenever a gap opens.',
  },
  {
    category: 'Primary Income Source',
    cef: 'Broad mix: bond coupons, stock dividends, option premiums, and realized gains. Income type varies widely by fund mandate.',
    ccf: 'Option premiums collected by selling covered calls (or cash-secured puts) against an underlying equity or index portfolio.',
  },
  {
    category: 'Leverage',
    cef: 'Many CEFs use structural leverage (preferred shares, credit facilities) — typically 20–40% — to amplify income and returns.',
    ccf: 'Rarely used. Most covered-call ETFs hold shares 1:1 and write options on those same shares — no borrowed capital.',
  },
  {
    category: 'Upside Participation',
    cef: 'Equity and balanced CEFs retain full or partial upside depending on strategy. Bond CEFs have limited upside by nature.',
    ccf: 'Structurally capped. Selling calls gives away gains above the strike price in exchange for premium income.',
  },
  {
    category: 'NAV Erosion Risk',
    cef: 'Real risk if distributions exceed sustainable income — especially with managed distribution policies or high leverage in falling markets.',
    ccf: 'Real risk if premiums collected are paid out faster than the portfolio grows. At-the-money funds (e.g. QYLD) are more exposed than OTM writers.',
  },
  {
    category: 'Expense Ratios',
    cef: 'Higher — typically 1.0–2.5% total (management + leverage costs). Active management and leverage overhead are priced in.',
    ccf: 'Lower — typically 0.35–0.80% for established funds. Passive or semi-passive option overlays have lower overhead than CEF active management.',
  },
  {
    category: 'Portfolio Transparency',
    cef: 'Quarterly or monthly holdings disclosure. Daily NAV published, but underlying positions lag.',
    ccf: 'Full daily portfolio disclosure required by SEC rules for most ETFs.',
  },
  {
    category: 'Tax Treatment',
    cef: 'Distributions may be classified as ordinary income, qualified dividends, long-term capital gains, or return of capital — varies by fund.',
    ccf: 'Option premium income is generally short-term capital gains (ordinary rates). Qualified dividend component depends on the underlying holdings.',
  },
  {
    category: 'Market Liquidity',
    cef: 'Varies widely — smaller funds can be thinly traded with wide bid-ask spreads. Large orders can move the price.',
    ccf: 'Generally better — popular covered-call ETFs (JEPI, XYLD, QYLD) trade millions of shares daily with tight spreads.',
  },
  {
    category: 'Discount / Catalyst Opportunity',
    cef: 'Unique advantage: buying at a wide discount adds alpha if the discount narrows. Activist investors and tender offers can accelerate this.',
    ccf: 'No discount mechanism — what you see is what you pay. No extra alpha from discount compression.',
  },
  {
    category: 'Best Suited For',
    cef: 'Income investors comfortable with active management, leverage risk, and discount volatility in exchange for potentially higher distributions.',
    ccf: 'Income investors who want a simpler, lower-cost, more transparent structure with reliable monthly income and less leverage risk.',
  },
]

function TabCEF() {
  return (
    <div className="cef-edu-section">
      <div className="cef-edu-hero">
        <div className="cef-edu-hero-badge">CEF</div>
        <div>
          <h2>Closed-End Fund</h2>
          <p className="cef-edu-hero-sub">A professionally managed pool of assets that raises a fixed amount of capital through an IPO, then trades on a stock exchange.</p>
        </div>
      </div>

      <div className="cef-edu-cards">
        <div className="cef-edu-card">
          <h3>How It Works</h3>
          <p>
            When a CEF launches, it raises a set amount of money through an initial public offering and issues a
            fixed number of shares. Unlike a mutual fund, no new shares are created when investors want to buy,
            and no shares are redeemed when they want to sell. Instead, buyers and sellers simply trade existing
            shares on the stock exchange — just like a stock.
          </p>
          <p>
            This fixed structure means the market price of a CEF can diverge from the value of the underlying
            portfolio (its <strong>Net Asset Value</strong>, or NAV). When investors are pessimistic, the fund
            trades at a <strong>discount</strong> to NAV — you can buy $1.00 of assets for less than $1.00.
            When sentiment is positive, it trades at a <strong>premium</strong>.
          </p>
        </div>

        <div className="cef-edu-card">
          <h3>The Discount / Premium Mechanism</h3>
          <p>
            The discount/premium is one of the most distinctive — and exploitable — features of the CEF structure.
            A fund that historically trades at a 5% discount but is currently at a 15% discount may represent
            a genuine opportunity: you are buying the portfolio cheaper than usual, and if sentiment recovers
            the discount may narrow back toward average, providing extra return on top of the underlying portfolio.
          </p>
          <ul>
            <li><strong>Discount</strong> — Market price &lt; NAV. Common in most CEFs. Can be a buying opportunity.</li>
            <li><strong>Premium</strong> — Market price &gt; NAV. You are overpaying for the portfolio. Usually a warning.</li>
            <li><strong>Historical average discount</strong> — The reference point. A discount wider than average is more interesting; narrower is less so.</li>
          </ul>
        </div>

        <div className="cef-edu-card">
          <h3>Leverage</h3>
          <p>
            Most CEFs borrow money — through preferred shares, credit facilities, or reverse repurchase
            agreements — to buy more assets than equity alone would allow. A fund with $1 billion in equity
            capital might borrow another $400 million and invest $1.4 billion in total. This leverage
            amplifies both income and NAV movement in both directions.
          </p>
          <ul>
            <li>Leverage boosts income when the portfolio yield exceeds borrowing costs.</li>
            <li>It amplifies losses in falling markets and can force forced asset sales.</li>
            <li>Regulatory caps: 50% leverage for bond funds, 33% for equity funds.</li>
            <li>Rising short-term interest rates shrink the spread between asset yield and borrowing cost.</li>
          </ul>
        </div>

        <div className="cef-edu-card">
          <h3>Distribution Policies</h3>
          <p>
            CEFs often use <strong>managed distribution policies</strong> — paying a fixed dollar amount per
            share per month regardless of what the portfolio actually earns. This provides income predictability,
            but distributions can include return of capital (ROC) when income falls short. ROC is not automatically
            bad — it can be tax-advantaged — but it erodes NAV if not offset by capital appreciation.
          </p>
          <ul>
            <li><strong>Net investment income (NII)</strong> — Ordinary income from dividends, interest, and option premiums.</li>
            <li><strong>Realized gains</strong> — From selling portfolio holdings at a profit.</li>
            <li><strong>Return of capital (ROC)</strong> — Returns your own invested principal. Reduces cost basis; sustainable only if portfolio appreciates.</li>
          </ul>
          <p>Section 19(a) notices, required by the SEC, disclose the breakdown of each distribution payment.</p>
        </div>

        <div className="cef-edu-card">
          <h3>Common CEF Categories</h3>
          <ul>
            <li><strong>Municipal bond CEFs</strong> — Tax-exempt income, often leveraged. Popular with high-income investors.</li>
            <li><strong>Taxable bond CEFs</strong> — High-yield, investment-grade, multi-sector, global bonds. Most use leverage.</li>
            <li><strong>Equity CEFs</strong> — Dividend-focused or sector-specific equity portfolios. Less common than bond CEFs.</li>
            <li><strong>Option-overlay CEFs</strong> — Equity portfolios that sell covered calls to generate premium income. Similar to covered-call ETFs but with CEF structure.</li>
            <li><strong>Preferred stock / senior loan CEFs</strong> — Floating-rate or fixed-income hybrid securities. Often leveraged.</li>
          </ul>
        </div>

        <div className="cef-edu-card">
          <h3>Key Risks</h3>
          <ul>
            <li><strong>Discount widening</strong> — The market price can fall even if NAV is stable, simply from sentiment shifts.</li>
            <li><strong>Leverage risk</strong> — Amplified losses in downturns; possible forced deleveraging.</li>
            <li><strong>Distribution cuts</strong> — A fund paying an unsustainable yield will eventually reduce or eliminate its payout.</li>
            <li><strong>NAV erosion</strong> — Persistent return-of-capital distributions that aren't offset by appreciation reduce the portfolio's asset base over time.</li>
            <li><strong>Liquidity risk</strong> — Thin trading in smaller funds makes large trades difficult without moving the price.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function TabETF() {
  return (
    <div className="cef-edu-section">
      <div className="cef-edu-hero">
        <div className="cef-edu-hero-badge cef-edu-hero-badge--etf">ETF</div>
        <div>
          <h2>Income ETF</h2>
          <p className="cef-edu-hero-sub">An exchange-traded fund that prioritizes current income distribution — from dividends, bond coupons, or option premiums — over capital appreciation.</p>
        </div>
      </div>

      <div className="cef-edu-cards">
        <div className="cef-edu-card">
          <h3>How It Works</h3>
          <p>
            An ETF issues shares that represent a proportional interest in a pool of assets. What makes ETFs
            structurally different from CEFs is the <strong>creation/redemption mechanism</strong>: large
            institutional investors called Authorized Participants (APs) can exchange baskets of the underlying
            securities for new ETF shares (creation), or return ETF shares to receive the underlying basket back
            (redemption). This process keeps the ETF's market price tightly aligned with its NAV at all times.
          </p>
          <p>
            Because new shares can always be created on demand, there is no fixed supply — and therefore no
            discount or premium of any consequence. The ETF market price and NAV are nearly always within a
            fraction of a percent of each other.
          </p>
        </div>

        <div className="cef-edu-card">
          <h3>Types of Income ETFs</h3>
          <ul>
            <li>
              <strong>Dividend ETFs</strong> — Hold high-yielding stocks or stocks with consistent dividend
              growth (e.g. VYM, SCHD, DVY). Income comes from stock dividends — often qualified and tax-efficient.
            </li>
            <li>
              <strong>Bond ETFs</strong> — Hold corporate, government, or high-yield bonds. Income comes from
              interest payments (ordinary income tax treatment). Examples: HYG, LQD, BND.
            </li>
            <li>
              <strong>Covered-call ETFs</strong> — Hold a stock or index portfolio and systematically sell
              call options against those holdings. Income comes from option premiums. Examples: JEPI, XYLD, QYLD, SPYI.
            </li>
            <li>
              <strong>Preferred stock ETFs</strong> — Hold preferred shares that pay fixed dividends. Income
              is hybrid in tax treatment. Examples: PFF, PFFD.
            </li>
            <li>
              <strong>Multi-asset income ETFs</strong> — Blend multiple income sources (dividends, bonds,
              options) into one fund for diversified income.
            </li>
          </ul>
        </div>

        <div className="cef-edu-card">
          <h3>Covered-Call ETFs in Detail</h3>
          <p>
            The fastest-growing segment of income ETFs, covered-call funds write (sell) call options against
            a portfolio of stocks or an index. The buyer of the call pays a premium upfront; the ETF collects
            that premium and distributes it to shareholders as income.
          </p>
          <p>
            The trade-off is straightforward: <strong>you give up upside above the strike price in exchange
            for current income.</strong> If the market rallies strongly, call buyers profit at the fund's
            expense. If the market is flat or declining, the premium offsets some of the loss.
          </p>
          <ul>
            <li><strong>At-the-money (ATM)</strong> writers (e.g. QYLD, XYLD) capture maximum premium but give up nearly all upside. NAV tends to erode in bull markets.</li>
            <li><strong>Out-of-the-money (OTM)</strong> writers (e.g. JEPI, SPYI, QQQI) keep some upside participation and tend to hold NAV better over time.</li>
            <li><strong>Index vs. individual-stock options</strong> — Index options (SPX, NDX) receive favorable 60/40 tax treatment; individual-stock options are taxed as ordinary income.</li>
          </ul>
        </div>

        <div className="cef-edu-card">
          <h3>Advantages of Income ETFs</h3>
          <ul>
            <li><strong>Price/NAV alignment</strong> — No discount or premium risk. You always pay close to fair value.</li>
            <li><strong>Lower costs</strong> — Expense ratios are generally much lower than comparable CEFs, especially after accounting for CEF leverage costs.</li>
            <li><strong>Daily transparency</strong> — Full portfolio holdings are disclosed every trading day.</li>
            <li><strong>No leverage risk</strong> — Most income ETFs do not borrow money, eliminating forced-deleveraging and rate-sensitivity risk.</li>
            <li><strong>Liquidity</strong> — Large, popular income ETFs trade enormous volumes daily with tight bid-ask spreads.</li>
            <li><strong>Simplicity</strong> — No need to monitor discounts, Section 19(a) notices, or leverage ratios.</li>
          </ul>
        </div>

        <div className="cef-edu-card">
          <h3>Key Risks</h3>
          <ul>
            <li><strong>Capped upside</strong> — Covered-call ETFs structurally limit your participation in bull markets.</li>
            <li><strong>NAV erosion</strong> — High distributions from option premiums can exceed the portfolio's total return, slowly eroding the asset base.</li>
            <li><strong>Tax inefficiency</strong> — Option premium income is often taxed as ordinary income (short-term capital gains), making covered-call ETFs less tax-efficient than dividend ETFs.</li>
            <li><strong>Rising volatility sensitivity</strong> — Option premiums shrink in low-volatility regimes and spike in high-volatility ones, making distributions lumpy or unpredictable.</li>
            <li><strong>No discount opportunity</strong> — You can't buy at a discount; the creation/redemption mechanism eliminates that edge.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function TabCompare() {
  return (
    <div className="cef-edu-section">
      <div className="cef-edu-hero">
        <div className="cef-edu-hero-badge cef-edu-hero-badge--compare">vs</div>
        <div>
          <h2>CEFs vs. Covered Call Funds</h2>
          <p className="cef-edu-hero-sub">Both generate income and trade on exchanges — but their structures, risks, and mechanics differ in important ways.</p>
        </div>
      </div>

      <div className="cef-edu-compare-intro">
        <p>
          Closed-end funds and covered-call ETFs both appeal to income investors, and at first glance they can
          look similar: they trade on exchanges, pay monthly distributions, and often target yields well above
          the S&P 500. But under the hood, they are built very differently. Understanding those differences
          helps you choose the right tool — or combine them intelligently.
        </p>
      </div>

      <div className="cef-edu-table-wrap">
        <table className="cef-edu-compare-table">
          <thead>
            <tr>
              <th className="cef-edu-compare-cat">Factor</th>
              <th className="cef-edu-compare-cef">
                <span className="cef-edu-col-badge">CEF</span>
                Closed-End Fund
              </th>
              <th className="cef-edu-compare-ccf">
                <span className="cef-edu-col-badge cef-edu-col-badge--etf">ETF</span>
                Covered Call Fund
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row, i) => (
              <tr key={i}>
                <td className="cef-edu-compare-cat-cell">{row.category}</td>
                <td>{row.cef}</td>
                <td>{row.ccf}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cef-edu-verdict-grid">
        <div className="cef-edu-verdict-card cef-edu-verdict-card--cef">
          <h3>When a CEF May Be Better</h3>
          <ul>
            <li>You want access to leveraged bond strategies with higher yields than ETFs offer.</li>
            <li>You have the expertise to monitor discounts and buy at historically wide levels.</li>
            <li>You are comfortable with active management and are willing to pay for superior manager skill.</li>
            <li>You want municipal bond income (tax-exempt) — the muni CEF universe is deep and well-established.</li>
            <li>You want income from a wide variety of asset classes (loans, preferred, EM debt) not well-covered by ETFs.</li>
          </ul>
        </div>
        <div className="cef-edu-verdict-card cef-edu-verdict-card--etf">
          <h3>When a Covered Call ETF May Be Better</h3>
          <ul>
            <li>You want a simple, low-cost, transparent income product with no leverage risk.</li>
            <li>You don't want to track discounts, NAV erosion, or Section 19(a) notices.</li>
            <li>You need high daily liquidity — large covered-call ETFs trade billions per day.</li>
            <li>You are in a sideways or declining market where option premiums offset losses better than fixed income.</li>
            <li>You want equity market exposure with a built-in income smoothing mechanism.</li>
          </ul>
        </div>
      </div>

      <div className="cef-edu-summary-box">
        <h3>The Bottom Line</h3>
        <p>
          CEFs and covered-call ETFs are complementary, not competing, tools. A CEF brings leverage, active management,
          and the unique discount/NAV dynamic. A covered-call ETF brings simplicity, low cost, and equity-linked income
          with a transparent, no-leverage structure. Many income portfolios hold both — using CEFs for bond and
          alternative-income exposure and covered-call ETFs for equity-linked income with controllable risk.
        </p>
        <p>
          The most important question is not which structure is "better" — it is whether the fund's income is
          sustainable, whether you are paying a fair price, and whether the risk profile matches your goals.
        </p>
      </div>
    </div>
  )
}

export default function CEFvsIncomeETF() {
  const [activeTab, setActiveTab] = useState('cef')

  return (
    <div className="page cef-page">
      <div className="cef-title-row">
        <div>
          <h1>CEFs &amp; Income ETFs: A Complete Guide</h1>
          <p>Understand what each structure is, how it works, and how to choose between them.</p>
        </div>
      </div>

      <div className="cef-tabs" style={{ marginBottom: '1.5rem' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`cef-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'cef' && <TabCEF />}
      {activeTab === 'etf' && <TabETF />}
      {activeTab === 'compare' && <TabCompare />}

      <div className="cef-disclosure" style={{ marginTop: 40 }}>
        <strong>Disclaimer</strong>
        <p>
          This page is for educational purposes only and does not constitute investment advice. All investments
          carry risk, including possible loss of principal. Past performance is no guarantee of future results.
          Consult a qualified financial advisor before making investment decisions.
        </p>
      </div>
    </div>
  )
}
