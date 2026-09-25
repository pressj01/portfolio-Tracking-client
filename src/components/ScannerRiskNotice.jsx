export default function ScannerRiskNotice() {
  return (
    <div
      role="note"
      aria-label="Options trading risk notice"
      style={{
        margin: '0 0 1rem',
        padding: '0.65rem 0.8rem',
        color: 'var(--text-muted)',
        background: 'color-mix(in srgb, var(--amber) 9%, var(--surface-sunken))',
        border: '1px solid color-mix(in srgb, var(--amber) 55%, var(--border))',
        borderRadius: 6,
        fontSize: '0.8rem',
        lineHeight: 1.45,
      }}
    >
      <strong style={{ color: 'var(--amber)' }}>Educational purposes only.</strong>{' '}
      Trade scans, quotes, probabilities, scores, and modeled outcomes are educational information,
      not financial, investment, or trading advice. They do not promise or guarantee profits, win
      rates, or returns. Verify every leg, price, quantity, expiration, liquidity, and maximum loss
      before placing an order.
    </div>
  )
}
