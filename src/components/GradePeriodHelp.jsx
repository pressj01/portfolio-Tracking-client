import {
  GRADE_PERIOD_HELP_ROWS,
  LIFE_VS_ALL_HELP_ROWS,
  PERFORMANCE_PERIODS,
} from '../utils/performancePeriods'

export default function GradePeriodHelp({ variant = 'help' }) {
  const dashboard = variant === 'dashboard'
  const pStyle = dashboard
    ? { color: 'var(--text-dim)', fontSize: '0.82rem', lineHeight: 1.5, margin: '0.75rem 0 0' }
    : { marginBottom: '0.75rem' }
  const hStyle = dashboard
    ? { color: 'var(--text-strong)', fontSize: '0.88rem', fontWeight: 600, margin: '1rem 0 0' }
    : { color: 'var(--accent-2)', fontSize: '1rem', fontWeight: 600, margin: '1rem 0 0.4rem' }
  const strongStyle = dashboard ? { color: 'var(--text-strong)' } : undefined

  return (
    <div className="grade-period-help">
      <h4 style={hStyle}>What the time-period buttons measure</h4>
      <p style={pStyle}>
        Except for <strong style={strongStyle}>Life</strong>, a button selects a market-performance
        window ending at the latest available market observation: a live quote when one is available
        today, otherwise the most recent market close. The date printed below the controls is the
        effective market range actually used, so it can move when a requested date lands on a weekend
        or market holiday.
      </p>
      <p style={pStyle}>
        <strong style={strongStyle}>Price Return</strong> is the transaction-aware market-price
        performance over that window, with dividends excluded. <strong style={strongStyle}>Tracker
        Total Return</strong> uses the same window and adds distributions. Dated buys and sells are
        treated as cash flows rather than investment performance, and the tracker includes every lot
        held during the window, including a lot that was later sold.
      </p>
      <table
        style={{
          fontSize: dashboard ? '0.8rem' : '0.9rem',
          marginTop: '0.65rem',
          marginBottom: dashboard ? 0 : '0.75rem',
          width: '100%',
          borderCollapse: 'collapse',
        }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '0.35rem 0.6rem 0.35rem 0' }}>Button</th>
            <th style={{ textAlign: 'left', padding: '0.35rem 0' }}>Measurement</th>
          </tr>
        </thead>
        <tbody>
          {PERFORMANCE_PERIODS.map(period => (
            <tr key={period.key}>
              <td style={{ padding: '0.35rem 0.6rem 0.35rem 0', verticalAlign: 'top' }}>
                <strong style={strongStyle}>{period.label}</strong>
              </td>
              <td style={{ padding: '0.35rem 0', verticalAlign: 'top' }}>{period.hint}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={pStyle}>
        For every market-window button, the return baseline is the final close on or before the
        requested start date. That is why a range starting on a non-trading day still includes the
        next market session&apos;s move. Custom uses the two entered dates inclusively; its displayed
        effective range still reflects the market observations available on those dates.
      </p>

      <h4 style={hStyle}>How long is Lifetime?</h4>
      <p style={pStyle}>
        <strong style={strongStyle}>Life is not a length of time.</strong> It is not &quot;5 years&quot;
        and it is not &quot;since the first trade.&quot; It is cost-basis G/L: current value minus what
        you paid for shares you still hold.
      </p>
      <p style={pStyle}>
        The dates on the Life cards (for example 3/8/2022–8/20/2026) are only a label: the
        <strong style={strongStyle}> earliest purchase or import date among open lots</strong>, through
        {' '}<strong style={strongStyle}>today</strong>. A lot bought last month is mixed in the same way
        as a lot bought years ago. Those dollars are not &quot;return over that window.&quot;
      </p>

      <h4 style={hStyle}>What Life shows that All does not</h4>
      <p style={pStyle}>
        <strong style={strongStyle}>Life shows Holdings cost-basis G/L. All does not.</strong> They can
        show similar dates and still disagree, because they answer different questions. Life is the
        number that matches the Holdings table totals. All never shows that, even if the date labels
        look like &quot;the whole history.&quot;
      </p>
      <table
        style={{
          fontSize: dashboard ? '0.8rem' : '0.9rem',
          marginTop: '0.65rem',
          marginBottom: dashboard ? 0 : '0.75rem',
          width: '100%',
          borderCollapse: 'collapse',
        }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '0.35rem 0.6rem 0.35rem 0' }} />
            <th style={{ textAlign: 'left', padding: '0.35rem 0.6rem 0.35rem 0' }}>Life</th>
            <th style={{ textAlign: 'left', padding: '0.35rem 0' }}>All</th>
          </tr>
        </thead>
        <tbody>
          {LIFE_VS_ALL_HELP_ROWS.map(row => (
            <tr key={row.topic}>
              <td style={{ padding: '0.35rem 0.6rem 0.35rem 0', verticalAlign: 'top' }}>
                <strong style={strongStyle}>{row.topic}</strong>
              </td>
              <td style={{ padding: '0.35rem 0.6rem 0.35rem 0', verticalAlign: 'top' }}>{row.life}</td>
              <td style={{ padding: '0.35rem 0', verticalAlign: 'top' }}>{row.all}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={pStyle}>
        Use <strong style={strongStyle}>Life</strong> to see whether you are up or down vs what you paid.
        Use <strong style={strongStyle}>All</strong> to see how the book performed as an investment since
        it started.
      </p>

      <h4 style={hStyle}>Grade and the indexes on Life</h4>
      <p style={pStyle}>
        <strong style={strongStyle}>Grade cannot be computed for the Lifetime setting.</strong>{' '}
        The same is true of the indexes and ratios next to it: <strong style={strongStyle}>beta, Sharpe,
        Sortino, Calmar, Omega, and Ulcer</strong>. They all need daily returns over a market window.
        Life never produces that series, so those cards stay blank. That is expected, not a failed load.
      </p>

      <h4 style={hStyle}>Which filters produce a grade?</h4>
      <table
        style={{
          fontSize: dashboard ? '0.8rem' : '0.9rem',
          marginTop: '0.65rem',
          marginBottom: dashboard ? 0 : '0.75rem',
          width: '100%',
          borderCollapse: 'collapse',
        }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '0.35rem 0.6rem 0.35rem 0' }}>Filter</th>
            <th style={{ textAlign: 'left', padding: '0.35rem 0' }}>Grade and indexes?</th>
          </tr>
        </thead>
        <tbody>
          {GRADE_PERIOD_HELP_ROWS.map(row => (
            <tr key={row.filter}>
              <td style={{ padding: '0.35rem 0.6rem 0.35rem 0', verticalAlign: 'top' }}>
                <strong style={strongStyle}>{row.filter}</strong>
              </td>
              <td style={{ padding: '0.35rem 0', verticalAlign: 'top' }}>{row.grade}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={pStyle}>
        <strong style={strongStyle}>5Y and All both work.</strong> If you want a grade for as far back
        as this portfolio goes, use <strong style={strongStyle}>All</strong>, not Life. All is the
        market replay from the first recorded trade, including lots you already sold. Life is
        remaining-share cost basis.
      </p>
      <p style={pStyle}>
        Click <strong style={strongStyle}>YTD</strong>, <strong style={strongStyle}>1M</strong>,{' '}
        <strong style={strongStyle}>1Y</strong>, <strong style={strongStyle}>5Y</strong>, or{' '}
        <strong style={strongStyle}>All</strong> to load a grade for that stretch.
      </p>
    </div>
  )
}
