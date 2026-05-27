import React, { useState } from 'react'

const QUESTIONS = [
  {
    id: 1,
    question: 'Does the portfolio match my income and risk goals?',
    detail: (
      <>
        <p>
          A CEF's portfolio should align with your personal investment objectives before you look at anything else.
          Equity-sector CEFs carry equity volatility; multi-sector bond CEFs carry credit and duration risk;
          option-income CEFs cap upside in exchange for premium income.
        </p>
        <h4>What to check</h4>
        <ul>
          <li><strong>Asset class and strategy</strong> — Read the fund's stated mandate. Does it match your timeline and risk tolerance?</li>
          <li><strong>Portfolio characteristics</strong> — Review top holdings, sector weights, and country allocation on the fund's detail page.</li>
          <li><strong>Yield vs. total return mix</strong> — A fund paying a 15% yield exclusively from return-of-capital is not the same as one paying 8% from net investment income.</li>
          <li><strong>Correlation to your existing holdings</strong> — Adding a second leveraged equity CEF when you already own one adds concentration, not diversification.</li>
        </ul>
      </>
    ),
  },
  {
    id: 2,
    question: 'Is the distribution sustainable?',
    detail: (
      <>
        <p>
          Distribution sustainability is arguably the most important question for income-focused investors.
          A high yield means nothing if the fund cuts or eliminates its distribution.
        </p>
        <h4>What to check</h4>
        <ul>
          <li><strong>Distribution rate on NAV</strong> — Compare the rate to the fund's underlying portfolio yield. If the fund pays 12% but earns 6% on its assets, the gap is likely being funded by return-of-capital or asset sales.</li>
          <li><strong>Distribution type</strong> — "Income / Regular" distributions come from portfolio income. "Return of Capital" distributions return your own money and can erode NAV over time if not offset by capital gains.</li>
          <li><strong>Managed distribution policies</strong> — These set a fixed payout regardless of income earned. They provide stability but must be monitored for NAV erosion over time.</li>
          <li><strong>Distribution history</strong> — Has the fund maintained or grown its payout, or has it been cut repeatedly?</li>
          <li><strong>Section 19(a) notices</strong> — These required disclosures tell you how much of each distribution comes from income vs. capital vs. return-of-capital.</li>
        </ul>
      </>
    ),
  },
  {
    id: 3,
    question: 'Is the discount justified or likely to narrow?',
    detail: (
      <>
        <p>
          One of the unique advantages of CEFs is the ability to buy a portfolio of assets at a discount to their
          actual value. But not all discounts are buying opportunities — some are persistent warnings.
        </p>
        <h4>What to check</h4>
        <ul>
          <li><strong>Current discount vs. 52-week average</strong> — A discount that is wider than the fund's own historical average may represent an entry opportunity; one that is narrower than average may be a sell signal.</li>
          <li><strong>Discount vs. category peers</strong> — A fund trading at a bigger discount than similar funds warrants further investigation. Is the discount caused by poor management, leverage risk, or temporary market sentiment?</li>
          <li><strong>Discount trend</strong> — Is the discount widening or narrowing? Review the NAV vs. Price chart over multiple periods.</li>
          <li><strong>Catalysts for narrowing</strong> — Activist shareholders, tender offers, rights offerings, and improving fund performance can all cause discount narrowing — adding alpha beyond the underlying portfolio return.</li>
          <li><strong>Premiums are a warning</strong> — Buying at a premium means you are paying more than the portfolio is worth. You need the fund to outperform or the premium to persist for the trade to work.</li>
        </ul>
      </>
    ),
  },
  {
    id: 4,
    question: 'How much leverage is used, and how does it behave in stress?',
    detail: (
      <>
        <p>
          Most CEFs use leverage — borrowing money at short-term rates to buy more assets — to boost income and
          returns. Leverage amplifies both gains and losses and creates specific risks in rising-rate or
          risk-off environments.
        </p>
        <h4>What to check</h4>
        <ul>
          <li><strong>Leverage ratio</strong> — Regulatory leverage is capped at 50% for bond funds and 33% for equity funds. Funds near those limits have less cushion.</li>
          <li><strong>Cost of leverage</strong> — If a fund borrows at 5% to buy assets yielding 6%, the spread is thin. Rising rates can quickly make leverage a drag rather than a boost.</li>
          <li><strong>Type of leverage</strong> — Preferred shares (fixed cost, no forced deleveraging), bank credit facilities (variable rate, subject to covenants), and reverse repos all behave differently in stress.</li>
          <li><strong>Historical behavior in downturns</strong> — Review the fund's NAV and price history during past stress periods (2020, 2022). How severe were the drawdowns? Did the fund cut its distribution?</li>
          <li><strong>Deleveraging risk</strong> — If a fund is forced to sell assets to meet leverage covenants during a downturn, it can lock in losses and accelerate NAV decline.</li>
        </ul>
      </>
    ),
  },
  {
    id: 5,
    question: 'Are expenses reasonable relative to peers?',
    detail: (
      <>
        <p>
          CEFs typically have higher expense ratios than open-end funds or ETFs because of management fees,
          administrative costs, and the cost of leverage. But expenses are a direct drag on returns and
          should be evaluated in context.
        </p>
        <h4>What to check</h4>
        <ul>
          <li><strong>Total expense ratio</strong> — Includes management fees, administration, and the interest cost of leverage. Compare to peers in the same category and strategy.</li>
          <li><strong>Management fee alone</strong> — Some sponsors charge high base fees on top of leverage costs. A 1.5% management fee on top of 1.5% leverage cost equals 3% of assets that must be earned before you see a return.</li>
          <li><strong>Is performance justifying the cost?</strong> — A higher-fee fund with consistently superior NAV total returns may be worth the cost. A higher-fee fund with mediocre performance is not.</li>
          <li><strong>Trend in expenses</strong> — Rising expense ratios over time can indicate increasing leverage costs or administrative bloat.</li>
        </ul>
      </>
    ),
  },
  {
    id: 6,
    question: 'Is the manager reputable with a strong track record?',
    detail: (
      <>
        <p>
          Unlike passive ETFs, CEFs are actively managed. The quality of the portfolio manager is a
          significant driver of long-term outcomes.
        </p>
        <h4>What to check</h4>
        <ul>
          <li><strong>Sponsor reputation</strong> — Well-known sponsors (Nuveen, PIMCO, BlackRock, Eaton Vance, Calamos) have established infrastructure, credit research teams, and regulatory track records.</li>
          <li><strong>NAV total return vs. category</strong> — Does the fund consistently outperform its peers on a NAV basis? Price return includes discount movement; NAV return isolates the manager's stock-picking and income generation.</li>
          <li><strong>Manager tenure</strong> — Has the same team managed the fund through multiple market cycles? Manager changes can alter strategy and risk profile.</li>
          <li><strong>Distribution history</strong> — Consistent or growing distributions over many years are a sign of disciplined management.</li>
          <li><strong>Communication and transparency</strong> — Does the sponsor publish clear shareholder reports, Section 19(a) notices, and commentary? Opaque communication is a red flag.</li>
        </ul>
      </>
    ),
  },
  {
    id: 7,
    question: 'Is liquidity sufficient for my position size?',
    detail: (
      <>
        <p>
          Many CEFs are small and thinly traded. Entering or exiting a large position can move the price
          against you, especially during market stress when bid-ask spreads widen.
        </p>
        <h4>What to check</h4>
        <ul>
          <li><strong>Average daily volume</strong> — As a rule of thumb, a single trade should not exceed 10–20% of average daily volume, or you risk moving the market. For a fund trading 50,000 shares/day, a 10,000-share order is manageable; a 100,000-share order is not.</li>
          <li><strong>Market cap / total assets</strong> — Smaller funds are less liquid. A $50M fund and a $2B fund in the same category behave very differently in terms of liquidity and discount volatility.</li>
          <li><strong>Bid-ask spread</strong> — Wider spreads mean higher implicit transaction costs. Use limit orders, not market orders, for CEF trades.</li>
          <li><strong>Discount volatility</strong> — Thinly traded funds can see their discount swing dramatically on small order flow. This cuts both ways: it can create opportunities, but also magnify losses on exit.</li>
        </ul>
      </>
    ),
  },
]

export default function CEFBuyingGuide() {
  const [open, setOpen] = useState(null)

  return (
    <div className="page cef-page">
      <div className="cef-title-row">
        <div>
          <h1>What Investors Should Look At When Buying Closed-End Funds</h1>
          <p>Seven essential questions to ask before you buy any CEF.</p>
        </div>
      </div>

      <div className="cef-guide-intro">
        <p>
          Closed-end funds offer income investors a compelling combination of professional management,
          diversified exposure, and the potential to buy assets at a discount to their true value.
          But they also carry unique risks — leverage, discount volatility, distribution sustainability —
          that don't exist in ordinary stocks or ETFs.
        </p>
        <p>Before buying a CEF, ask yourself these seven questions:</p>
      </div>

      <div className="cef-guide-list">
        {QUESTIONS.map((q) => {
          const isOpen = open === q.id
          return (
            <div key={q.id} className={`cef-guide-card${isOpen ? ' cef-guide-card--open' : ''}`}>
              <button
                className="cef-guide-header"
                onClick={() => setOpen(isOpen ? null : q.id)}
                aria-expanded={isOpen}
              >
                <span className="cef-guide-number">{q.id}</span>
                <span className="cef-guide-question">{q.question}</span>
                <span className="cef-guide-chevron">{isOpen ? '▲' : '▼'}</span>
              </button>
              {isOpen && (
                <div className="cef-guide-detail">
                  {q.detail}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="cef-disclosure" style={{ marginTop: 32 }}>
        <strong>Disclaimer</strong>
        <p>
          This guide is for educational purposes only and does not constitute investment advice.
          All investments carry risk, including possible loss of principal. Past performance is no
          guarantee of future results. Consult a qualified financial advisor before making investment decisions.
        </p>
      </div>
    </div>
  )
}
