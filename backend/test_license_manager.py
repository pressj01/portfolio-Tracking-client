import datetime as dt
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests
from flask import Flask, jsonify

sys.path.insert(0, str(Path(__file__).resolve().parent))
import license_manager as lm  # noqa: E402

KEY = "AAAA1111-BBBB2222-CCCC3333-DDDD4444"
START = dt.datetime(2026, 9, 1, 12, 0, tzinfo=dt.timezone.utc)


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


def ok(uses=1, **purchase):
    return FakeResponse(200, {"success": True, "uses": uses,
                              "purchase": {"email": "buyer@example.com", "sale_id": "s1", **purchase}})


def not_found(message="That license does not exist for the provided product."):
    return FakeResponse(404, {"success": False, "message": message})


class LicenseManagerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = mock.patch.dict(os.environ, {
            "PORTFOLIO_LICENSE_DIR": self.tmp.name,
            "GUMROAD_PRODUCT_ID": "prod-123",
            "PORTFOLIO_LICENSE_ENFORCE": "1",
        })
        self.env.start()
        self.now = START
        self.clock = mock.patch.object(lm, "_now", side_effect=lambda: self.now)
        self.clock.start()
        self.post = mock.patch.object(lm.requests, "post")
        self.gumroad = self.post.start()
        lm._record_cache.update(loaded_at=0.0, path=None, value=None)

    def tearDown(self):
        self.post.stop()
        self.clock.stop()
        self.env.stop()
        lm._record_cache.update(loaded_at=0.0, path=None, value=None)
        self.tmp.cleanup()

    def saved(self):
        with open(lm.license_path(), encoding="utf-8") as handle:
            return json.load(handle)

    def activate(self):
        self.gumroad.return_value = ok()
        return lm.activate(f"  {KEY} ")

    # ── Activation ──────────────────────────────────────────────────────────

    def test_fresh_install_is_locked(self):
        status = lm.license_status()
        self.assertEqual(status["state"], "inactive")
        self.assertFalse(status["licensed"])
        self.assertTrue(status["enforced"])

    def test_activation_saves_the_key_and_counts_one_use(self):
        status = self.activate()
        self.assertTrue(status["licensed"])
        self.assertEqual(status["state"], "active")
        self.assertEqual(status["masked_key"], "AAAA••••4444")
        self.assertNotIn(KEY, json.dumps(status))
        sent = self.gumroad.call_args.kwargs["data"]
        self.assertEqual(sent, {"product_id": "prod-123", "license_key": KEY, "increment_uses_count": "true"})
        record = self.saved()
        self.assertEqual(record["license_key"], KEY)
        self.assertEqual(record["machine"], lm.machine_id())
        self.assertEqual(record["email"], "buyer@example.com")

    def test_request_is_form_encoded_so_the_product_id_padding_survives(self):
        # Gumroad product IDs end in "==". Sent as JSON or unencoded, the ID
        # Gumroad reads no longer matches and every key is "not found".
        self.post.stop()
        sent = {}

        def capture(session, prepared, **kwargs):
            sent.update(content_type=prepared.headers.get("Content-Type"), body=prepared.body)
            return FakeResponse(404, {"success": False, "message": "captured"})

        try:
            with mock.patch.object(requests.Session, "send", capture):
                with self.assertRaises(lm.LicenseRejected):
                    lm.verify_with_gumroad(KEY, "0rro9W8meLpAlFfbSeRhuA==")
        finally:
            self.gumroad = self.post.start()
        self.assertEqual(sent["content_type"], "application/x-www-form-urlencoded")
        self.assertIn("product_id=0rro9W8meLpAlFfbSeRhuA%3D%3D", sent["body"])

    def test_reentering_the_same_key_does_not_count_another_use(self):
        self.activate()
        lm.activate(KEY)
        self.assertEqual(self.gumroad.call_args.kwargs["data"]["increment_uses_count"], "false")

    def test_unknown_key_is_rejected_and_nothing_is_saved(self):
        self.gumroad.return_value = not_found()
        with self.assertRaisesRegex(lm.LicenseRejected, "does not exist"):
            lm.activate(KEY)
        self.assertFalse(os.path.exists(lm.license_path()))

    def test_refunded_purchase_cannot_activate(self):
        self.gumroad.return_value = ok(refunded=True)
        with self.assertRaisesRegex(lm.LicenseRejected, "refunded"):
            lm.activate(KEY)

    def test_offline_activation_reports_unavailable_not_rejected(self):
        self.gumroad.side_effect = requests.ConnectionError("no route")
        with self.assertRaises(lm.LicenseCheckUnavailable):
            lm.activate(KEY)

    def test_missing_product_id_disables_enforcement(self):
        with mock.patch.dict(os.environ, {"GUMROAD_PRODUCT_ID": ""}), \
                mock.patch.object(lm, "GUMROAD_PRODUCT_ID", ""):
            status = lm.license_status()
            self.assertFalse(status["enforced"])
            self.assertTrue(status["licensed"])
            with self.assertRaises(lm.LicenseNotConfigured):
                lm.activate(KEY)

    def test_activation_from_another_computer_is_not_honoured(self):
        self.activate()
        with mock.patch.object(lm, "machine_id", return_value="other-machine"):
            lm._record_cache.update(loaded_at=0.0, path=None, value=None)
            status = lm.license_status()
        self.assertEqual(status["state"], "inactive")
        self.assertFalse(status["licensed"])

    # ── Weekly re-check ─────────────────────────────────────────────────────

    def test_no_check_before_a_week(self):
        self.activate()
        self.gumroad.reset_mock()
        self.now = START + dt.timedelta(days=6)
        lm.recheck()
        self.gumroad.assert_not_called()

    def test_weekly_check_extends_the_activation(self):
        self.activate()
        self.now = START + dt.timedelta(days=8)
        self.assertEqual(lm.license_status()["state"], "overdue")
        self.gumroad.return_value = ok()
        status = lm.recheck()
        self.assertEqual(status["state"], "active")
        self.assertEqual(self.gumroad.call_args.kwargs["data"]["increment_uses_count"], "false")
        self.assertEqual(self.saved()["last_verified_at"], lm._iso(self.now))

    def test_offline_check_keeps_working_through_the_grace_period(self):
        self.activate()
        self.gumroad.side_effect = requests.Timeout("timed out")
        self.now = START + dt.timedelta(days=8)
        status = lm.recheck()
        self.assertTrue(status["licensed"])
        self.assertEqual(status["state"], "overdue")
        self.assertIn("timed out", status["last_check_error"])

        self.now = START + dt.timedelta(days=20)
        self.assertTrue(lm.license_status(force=True)["licensed"])
        self.now = START + dt.timedelta(days=22)
        status = lm.license_status(force=True)
        self.assertEqual(status["state"], "expired")
        self.assertFalse(status["licensed"])

    def test_gumroad_outage_is_not_a_revocation(self):
        self.activate()
        self.gumroad.return_value = FakeResponse(502, ValueError("html"))
        self.now = START + dt.timedelta(days=8)
        status = lm.recheck()
        self.assertTrue(status["licensed"])
        self.assertFalse(self.saved()["revoked"])

    def test_refund_found_at_the_weekly_check_revokes(self):
        self.activate()
        self.gumroad.return_value = ok(refunded=True)
        self.now = START + dt.timedelta(days=8)
        status = lm.recheck()
        self.assertEqual(status["state"], "revoked")
        self.assertFalse(status["licensed"])
        self.assertIn("refunded", status["reason"])

    def test_disabled_key_revokes_and_check_now_can_restore(self):
        self.activate()
        self.gumroad.return_value = not_found("This license key has been disabled.")
        self.now = START + dt.timedelta(days=8)
        self.assertEqual(lm.recheck()["state"], "revoked")

        # The scheduled check leaves a revoked activation alone ...
        self.gumroad.reset_mock()
        lm.recheck()
        self.gumroad.assert_not_called()
        # ... but "Check now" asks again, e.g. after the seller re-enables it.
        self.gumroad.return_value = ok()
        self.assertEqual(lm.recheck(force=True)["state"], "active")

    def test_failed_checks_retry_at_most_hourly(self):
        self.activate()
        self.gumroad.side_effect = requests.ConnectionError("offline")
        self.now = START + dt.timedelta(days=8)
        lm.recheck()
        self.gumroad.reset_mock()
        self.now += dt.timedelta(minutes=30)
        lm.recheck()
        self.gumroad.assert_not_called()
        self.now += dt.timedelta(minutes=31)
        lm.recheck()
        self.gumroad.assert_called_once()

    def test_clock_moved_backwards_makes_the_check_due(self):
        self.activate()
        self.now = START - dt.timedelta(days=30)
        status = lm.license_status(force=True)
        self.assertTrue(status["check_due"])

    # ── API guard ───────────────────────────────────────────────────────────

    def client(self):
        app = Flask(__name__)
        lm.register_routes(app)

        @app.route("/api/health")
        def health():
            return jsonify({"ok": True})

        @app.route("/api/profiles")
        def profiles():
            return jsonify([])

        return app.test_client()

    def test_guard_blocks_data_until_activation(self):
        client = self.client()
        self.assertEqual(client.get("/api/health").status_code, 200)
        blocked = client.get("/api/profiles")
        self.assertEqual(blocked.status_code, 403)
        self.assertTrue(blocked.get_json()["license_required"])

        self.gumroad.return_value = ok()
        response = client.post("/api/license/activate", json={"license_key": KEY})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get("/api/profiles").status_code, 200)

        client.post("/api/license/deactivate")
        self.assertEqual(client.get("/api/profiles").status_code, 403)

    def test_guard_is_off_when_not_enforced(self):
        with mock.patch.dict(os.environ, {"PORTFOLIO_LICENSE_ENFORCE": "0"}):
            self.assertEqual(self.client().get("/api/profiles").status_code, 200)

    def test_activate_route_maps_errors_to_status_codes(self):
        client = self.client()
        self.gumroad.return_value = not_found()
        self.assertEqual(client.post("/api/license/activate", json={"license_key": KEY}).status_code, 400)
        self.gumroad.side_effect = requests.ConnectionError("offline")
        self.assertEqual(client.post("/api/license/activate", json={"license_key": KEY}).status_code, 503)


if __name__ == "__main__":
    unittest.main()
