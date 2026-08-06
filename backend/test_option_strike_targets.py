"""Expiration-aware strike placement invariants shared by option scanners."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from option_strike_targets import (
    dte_distance_scale,
    dte_scaled_pct,
    strike_for_delta,
)


class ExpirationAwareStrikeTargets(unittest.TestCase):

    def test_fixed_delta_moves_farther_from_spot_as_dte_increases(self):
        spot = 100.0
        volatility = 0.20
        put_near = strike_for_delta(spot, 0.16, volatility, 30, "put")
        put_far = strike_for_delta(spot, 0.16, volatility, 120, "put")
        call_near = strike_for_delta(spot, 0.16, volatility, 30, "call")
        call_far = strike_for_delta(spot, 0.16, volatility, 120, "call")

        self.assertLess(put_far, put_near)
        self.assertGreater(call_far, call_near)
        self.assertGreater(spot - put_far, spot - put_near)
        self.assertGreater(call_far - spot, call_near - spot)

    def test_reference_geometry_uses_square_root_time(self):
        self.assertAlmostEqual(dte_distance_scale(120, 30), 2.0, places=6)
        self.assertAlmostEqual(dte_scaled_pct(5.0, 120, 30), 10.0, places=6)


if __name__ == "__main__":
    unittest.main()
