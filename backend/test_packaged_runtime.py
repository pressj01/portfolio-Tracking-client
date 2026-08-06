import os
import unittest
from unittest.mock import patch

import app as app_module
from config import DB_PATH


class PackagedRuntimeTest(unittest.TestCase):
    def test_uploads_are_written_beside_the_configured_database(self):
        self.assertEqual(
            os.path.normcase(os.path.dirname(app_module.UPLOAD_FOLDER)),
            os.path.normcase(os.path.dirname(DB_PATH)),
        )

    def test_health_identifies_the_expected_backend_instance(self):
        with patch.dict(os.environ, {"PORTFOLIO_BACKEND_TOKEN": "packaged-test"}):
            response = app_module.app.test_client().get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            "ok": True,
            "instance_token": "packaged-test",
        })


if __name__ == "__main__":
    unittest.main()
