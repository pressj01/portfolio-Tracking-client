import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class CefConnectFetchTest(unittest.TestCase):
    def setUp(self):
        app_module._CEFCONNECT_CACHE.clear()

    def test_blocked_html_is_detected_for_json(self):
        self.assertTrue(app_module._cefconnect_blocked_body(
            "<!DOCTYPE html><title>YOUR REQUEST HAS BEEN BLOCKED!</title>",
            expect_json=True,
        ))
        self.assertTrue(app_module._cefconnect_blocked_body("<html>no json</html>", expect_json=True))
        self.assertFalse(app_module._cefconnect_blocked_body('[{"Ticker":"PDI"}]', expect_json=True))

    def test_fund_html_is_not_treated_as_blocked(self):
        self.assertFalse(app_module._cefconnect_blocked_body(
            "<!DOCTYPE html><html><body>Japan Smaller Cap Fund</body></html>",
            expect_json=False,
        ))
        self.assertTrue(app_module._cefconnect_blocked_body(
            "<!DOCTYPE html>YOUR REQUEST HAS BEEN BLOCKED!",
            expect_json=False,
        ))

    def test_json_fetch_parses_live_body(self):
        with (
            patch.object(app_module, "_cefconnect_http_get", return_value='[{"Ticker":"PDI"}]'),
            patch.object(app_module, "_persist_market_payload"),
        ):
            payload = app_module._cefconnect_json("/api/v3/DailyPricing", "test-daily")
        self.assertEqual(payload[0]["Ticker"], "PDI")

    def test_json_fetch_falls_back_to_persisted_payload(self):
        with (
            patch.object(
                app_module,
                "_cefconnect_http_get",
                return_value="<!DOCTYPE html>YOUR REQUEST HAS BEEN BLOCKED!",
            ),
            patch.object(
                app_module,
                "_load_persisted_market_payload",
                return_value=[{"Ticker": "UTG"}],
            ),
        ):
            payload = app_module._cefconnect_json("/api/v3/DailyPricing", "test-stale")
        self.assertEqual(payload[0]["Ticker"], "UTG")

    def test_pricing_endpoint_returns_502_without_data(self):
        with (
            app_module.app.test_client() as client,
            patch.object(app_module, "_cef_daily_rows", side_effect=RuntimeError("blocked")),
        ):
            res = client.get("/api/closed-cef/pricing")
        self.assertEqual(res.status_code, 502)
        body = res.get_json()
        self.assertIn("CEF Connect", body["error"])
        self.assertEqual(body["detail"], "blocked")


if __name__ == "__main__":
    unittest.main()
