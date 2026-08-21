import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import market_calendar


class IvRankCollectApiTest(unittest.TestCase):
    def test_continuation_tickers_are_forwarded_to_collector(self):
        result = {
            "observed_on": "2026-08-21",
            "collected": [{"ticker": "LATE"}],
            "failed": [],
            "remaining": [],
            "pending_before": 1,
            "done": True,
        }
        with patch.object(market_calendar, "is_nyse_trading_day", return_value=True), \
             patch.object(app_module, "collect_daily_iv_rank", return_value=result) as collect:
            response = app_module.app.test_client().post(
                "/api/iv-rank/collect",
                json={"tickers": ["LATE"]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["collected"][0]["ticker"], "LATE")
        self.assertEqual(collect.call_args.kwargs["tickers"], ["LATE"])

    def test_rejects_non_list_continuation(self):
        response = app_module.app.test_client().post(
            "/api/iv-rank/collect",
            json={"tickers": "AAPL"},
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
