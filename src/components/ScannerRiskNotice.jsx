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
      <strong style={{ color: 'var(--amber)' }}>Trade at your own risk.</strong>{' '}
      Scanner results, quotes, probabilities, and modeled outcomes are educational estimates—not
      guarantees or investment advice. Verify every leg, price, quantity, expiration, liquidity,
      and maximum loss before placing an order.
    </div>
  )
}
