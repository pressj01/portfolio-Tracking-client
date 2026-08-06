# Options volatility-surface roadmap

## Current release

The shared scanner risk profile uses a proportional whole-surface volatility
shock. Every leg starts from its own market IV (plus any explicit per-leg point
adjustment), so strike skew and expiration differences remain intact while the
entire position is repriced.

The risk profile also supports:

- downside-skew steepening and flattening, expressed in volatility points per
  10% downside moneyness;
- independent volatility-point changes for every expiration in the position;
- sticky-strike and sticky-delta price-path behavior;
- clearly labeled assumptions and a per-leg reconciliation from market IV to
  final modeled IV.

Sticky-delta slopes are estimated independently from the modeled legs in each
expiration. If an expiration has fewer than two distinct strikes, it safely
falls back to sticky-strike behavior. The current option chain is the
underlying-specific baseline; scenario changes remain explicit manual inputs.

## Future upgrade

Historical, underlying-specific calibration remains optional future work. It
requires storing dated option-chain surfaces; price history alone cannot
reconstruct prior implied-volatility skew and term structure without inventing
data. When that history exists, calibration should estimate typical parallel,
skew and term moves while keeping every assumption visible and editable.

All modes reprice each leg independently and scale aggregate P/L and Greeks
with contract quantity without changing per-contract strike selection or delta
targets.
