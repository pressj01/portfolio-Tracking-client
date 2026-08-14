import { Link } from 'react-router-dom'
import { generalScannerRoute, OPTION_SCANNER_GROUPS, OPTION_SCANNERS } from '../utils/optionScannerCatalog'

export default function OptionScannerHub() {
  return (
    <main className="page osh-page">
      <header className="osh-hero">
        <div>
          <span className="osh-eyebrow">One model · strategy-specific controls</span>
          <h1>Strategy Scanners</h1>
          <p>
            Choose any option strategy the app already scans. Every choice opens the new shared scanner model
            with editable common filters and the selected trade&apos;s own construction controls.
          </p>
        </div>
        <div className="osh-count">
          <strong>{OPTION_SCANNERS.length}</strong>
          <span>scanner screens</span>
          <small>available now</small>
        </div>
      </header>

      <div className="osh-notice">
        <strong>General Option Scanner</strong>
        <span>
          Use one Samurai-style screen for shared filters, strategy-specific controls, ticker drilldown,
          locally collected Yahoo IV Rank, IV−RV, RV Rank, Volatility score, and an interactive payoff model. A link from that screen still
          provides access to the original strategy screen when needed.
        </span>
        <Link className="btn btn-xs btn-scan" to="/general-option-scanner">Open General Scanner</Link>
      </div>

      <div className="osh-groups">
        {OPTION_SCANNER_GROUPS.map(group => (
          <section className="osh-group" key={group.id}>
            <header>
              <h2>{group.label}</h2>
              <p>{group.description}</p>
            </header>
            <div className="osh-card-list">
              {group.scanners.map(scanner => (
                <Link className="osh-card" to={generalScannerRoute(scanner.key)} key={scanner.key}>
                  <div>
                    <strong>{scanner.label}</strong>
                    <span>{scanner.screenLabel}</span>
                  </div>
                  <p>{scanner.description}</p>
                  <dl>
                    <div><dt>View</dt><dd>{scanner.stance}</dd></div>
                    <div><dt>Risk</dt><dd>{scanner.risk}</dd></div>
                  </dl>
                  <b>Open scanner <span aria-hidden="true">→</span></b>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
