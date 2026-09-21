const PUT_STRATEGIES = new Set(['cash-secured-put', 'bull-put-spread'])

export default function OptionSelectionControls({ strategy, filters, onChange, showPricing = false }) {
  const isPut = PUT_STRATEGIES.has(strategy)
  const numeric = (key, label, min = 0, max, step = 1) => (
    <label style={{ display: 'grid', gap: 4 }}>
      {label}
      <input type="number" min={min} max={max} step={step} value={filters[key] ?? ''}
        placeholder="Any" onChange={event => onChange(key, event.target.value === '' ? null : Number(event.target.value))} />
    </label>
  )
  const check = (key, label) => <label><input type="checkbox" checked={!!filters[key]} onChange={event => onChange(key, event.target.checked)} /> {label}</label>
  return <details style={{ margin: '0.75rem 0', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 6 }}>
    <summary style={{ cursor: 'pointer' }}>Selection quality, ranking{isPut ? ', and trading costs' : ''}</summary>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem', marginTop: '0.75rem', fontSize: '0.85rem' }}>
      <label style={{ display: 'grid', gap: 4 }}>Rank results by
        <select value={filters.ranking_mode || 'return_on_capital'} onChange={event => onChange('ranking_mode', event.target.value)}>
          <option value="probability">Probability of any profit</option>
          <option value="return_on_capital">Expected return on capital</option>
          {isPut && <option value="downside_risk">Lowest stress loss / capital</option>}
          <option value="expected_value">Expected dollar value</option>
        </select>
      </label>
      {isPut && <>
        {showPricing && <label style={{ display: 'grid', gap: 4 }}>Entry pricing
          <select value={filters.bid_ask_level || 'Conservative (use bid/ask values)'} onChange={event => onChange('bid_ask_level', event.target.value)}>
            <option>Conservative (use bid/ask values)</option><option>25% price improvement</option><option>Mid</option>
          </select>
        </label>}
        {numeric('commission_per_contract', 'Commission / contract / side ($)', 0, undefined, 0.01)}
        {numeric('exit_slippage_per_contract', 'Estimated exit slippage / contract ($)', 0, undefined, 0.25)}
        {numeric('expiration_candidates', 'Expirations to compare', 1, 5)}
        {numeric('min_prob_profit', 'Minimum probability of any profit (%)', 0, 100)}
        {numeric('max_stress_loss_pct', 'Maximum stress loss / capital (%)', 0, 100)}
        {numeric('profit_target_pct', 'Profit target (% of net credit)', 1, 100)}
        {numeric('stop_loss_credit_multiple', 'Loss stop (multiple of net credit)', 0.1, undefined, 0.25)}
        {strategy === 'cash-secured-put' && numeric('max_assignment_dollars', 'Maximum assignment obligation ($)', 0, undefined, 100)}
        {check('require_live_quotes', 'Require two-sided quotes')}
        {check('require_stabilization', 'Require a bounce and slowing decline')}
        {check('require_short_below_support', 'Short strike below the 10-session closing low')}
      </>}
    </div>
    {isPut && <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
      Net results reserve entry and exit commissions plus estimated exit slippage. Costs are editable assumptions.
      Stress means a 10% price decline and 25% IV increase after one day. Probabilities are model estimates.
      The loss stop is a P/L loss, not the total buyback debit. Review total account exposure before accepting assignment.
    </p>}
  </details>
}
