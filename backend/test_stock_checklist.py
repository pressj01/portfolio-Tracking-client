import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


def _series(values):
    idx = pd.date_range("2024-01-01", periods=len(values), freq="D")
    return pd.Series(values, index=idx, dtype=float)


class StockChecklistIndicatorTest(unittest.TestCase):
    def setUp(self):
        n = 260
        self.idx = pd.date_range("2024-01-01", periods=n, freq="D")
        up = np.linspace(100, 140, n)
        down = np.linspace(140, 100, n)
        self.up_close = pd.Series(up, index=self.idx)
        self.up_high = self.up_close + 0.5
        self.up_low = self.up_close - 0.5
        self.up_vol = pd.Series(np.linspace(1e6, 2e6, n), index=self.idx)
        self.down_close = pd.Series(down, index=self.idx)
        self.down_high = self.down_close + 0.5
        self.down_low = self.down_close - 0.5
        self.down_vol = pd.Series(np.linspace(2e6, 1e6, n), index=self.idx)

    def test_awesome_oscillator_trends(self):
        up_val, up_sig = app_module._awesome_oscillator(self.up_high, self.up_low)
        self.assertGreater(up_val, 0)
        self.assertEqual(up_sig, "BUY")
        down_val, down_sig = app_module._awesome_oscillator(self.down_high, self.down_low)
        self.assertLess(down_val, 0)
        self.assertEqual(down_sig, "SELL")

    def test_awesome_oscillator_short_series_is_neutral(self):
        short = _series([1, 2, 3])
        self.assertEqual(app_module._awesome_oscillator(short, short), (None, "NEUTRAL"))

    def test_obv_volume_signal_confirms_direction(self):
        up = app_module._obv_volume_signal(self.up_close, self.up_vol)
        self.assertEqual(up["signal"], "BUY")
        self.assertGreater(up["obv_trend_pct"], 0)
        self.assertIsNotNone(up["volume_vs_avg"])
        down = app_module._obv_volume_signal(self.down_close, self.down_vol)
        self.assertEqual(down["signal"], "SELL")
        self.assertLess(down["obv_trend_pct"], 0)

    def test_obv_volume_signal_handles_missing_volume(self):
        out = app_module._obv_volume_signal(self.up_close, None)
        self.assertEqual(out["signal"], "NEUTRAL")
        self.assertIsNone(out["volume_vs_avg"])

    def test_macd_values_trends(self):
        self.assertEqual(app_module._macd_values(self.up_close)["state"], "BUY")
        self.assertEqual(app_module._macd_values(self.down_close)["state"], "SELL")
        macd = app_module._macd_values(self.up_close)
        self.assertAlmostEqual(macd["histogram"], round(macd["macd"] - macd["signal_line"], 4), places=4)

    def test_macd_values_short_series_is_neutral(self):
        out = app_module._macd_values(_series([1, 2, 3, 4]))
        self.assertEqual(out["state"], "NEUTRAL")
        self.assertIsNone(out["macd"])

    def test_stochastic_state_bands(self):
        self.assertEqual(app_module._stochastic_state(10, 15), "BUY")    # oversold
        self.assertEqual(app_module._stochastic_state(90, 85), "SELL")   # overbought
        self.assertEqual(app_module._stochastic_state(50, 50), "NEUTRAL")
        self.assertEqual(app_module._stochastic_state(None, None), "NEUTRAL")

    def test_checklist_frac_pct_scales_fractions_including_over_100(self):
        self.assertEqual(app_module._checklist_frac_pct(0.278), 27.8)
        self.assertEqual(app_module._checklist_frac_pct(1.4147), 141.47)  # ROE > 100%
        self.assertIsNone(app_module._checklist_frac_pct(None))


class FundKindClassifierTest(unittest.TestCase):
    def _kind(self, quote_type, summary='', name='Example', industry=''):
        info = {'longBusinessSummary': summary, 'industry': industry}
        return app_module._stock_checklist_fund_kind(quote_type, info, name)

    def test_etf_and_mutual_fund_from_quote_type(self):
        self.assertEqual(self._kind('ETF'), 'ETF')
        self.assertEqual(self._kind('MUTUALFUND'), 'Mutual Fund')
        self.assertEqual(self._kind('MONEYMARKET'), 'Mutual Fund')

    def test_bdc_from_summary_even_when_equity(self):
        self.assertEqual(
            self._kind('EQUITY', 'Hercules Capital is a business development company specializing in...'),
            'BDC',
        )

    def test_closed_end_fund_loose_phrasing(self):
        # yfinance phrases these loosely and reports them as EQUITY
        self.assertEqual(
            self._kind('EQUITY', 'FS Credit Opportunities Corp. is a close ended fixed income fund.'),
            'Closed-End Fund',
        )
        self.assertEqual(
            self._kind('EQUITY', 'Acme is a closed-end management investment company.'),
            'Closed-End Fund',
        )

    def test_ordinary_stock_is_not_a_fund(self):
        self.assertIsNone(self._kind('EQUITY', 'Apple Inc. designs and sells consumer electronics.'))

    def test_reit_is_treated_as_stock(self):
        self.assertIsNone(
            self._kind('EQUITY', 'Realty Income is a real estate investment trust.', industry='REIT - Retail'),
        )

    def test_option_income_etf_detected_from_name_when_yahoo_category_is_generic(self):
        info = {'quoteType': 'ETF', 'category': 'Digital Assets'}
        self.assertEqual(
            app_module._classify_fund_kind(
                'SOLM', info, 'Amplify Solana 3% Monthly Option Income ETF', cef_universe=set()
            ),
            'option_income',
        )

    def test_option_income_etf_detected_from_summary_keywords(self):
        for phrase in ('covered call', 'buy-write', 'option premium'):
            with self.subTest(phrase=phrase):
                info = {
                    'quoteType': 'ETF',
                    'category': 'Large Blend',
                    'longBusinessSummary': f'The fund uses a {phrase} strategy to generate income.',
                }
                self.assertEqual(
                    app_module._classify_fund_kind(
                        'TEST', info, 'Example ETF', cef_universe=set()
                    ),
                    'option_income',
                )

    def test_option_income_name_does_not_override_cef_detection(self):
        info = {'quoteType': 'ETF', 'category': 'Derivative Income'}
        self.assertEqual(
            app_module._classify_fund_kind(
                'TEST', info, 'Covered Call Fund', cef_universe={'TEST'}
            ),
            'cef',
        )


if __name__ == "__main__":
    unittest.main()
