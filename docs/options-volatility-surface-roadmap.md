# Options volatility-surface roadmap

## Current release

The shared scanner risk profile uses a proportional whole-surface volatility
shock. Every leg starts from its own market IV (plus any explicit per-leg point
adjustment), so strike skew and expiration differences remain intact while the
entire position is repriced.

## Future upgrade

Add selectable surface-dynamics scenarios without removing the proportional
default:

- skew steepening and flattening;
- expiration-specific term-structure shocks;
- sticky-strike and sticky-delta behavior;
- optional underlying-specific calibration from historical surface moves;
- clearly labeled scenario assumptions and before/after leg-IV values.

These modes should continue to reprice each leg independently and should scale
aggregate P/L and Greeks with contract quantity without changing per-contract
strike selection or delta targets.
