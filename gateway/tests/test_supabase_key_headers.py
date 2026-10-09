import os
import unittest
from unittest.mock import patch
from xtream_store import private_headers


class SupabaseKeyHeaderTests(unittest.TestCase):
    def test_secret_key_uses_apikey_only(self):
        with patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": "sb_secret_example"}, clear=False):
            headers = private_headers()
            self.assertEqual(headers["apikey"], "sb_secret_example")
            self.assertNotIn("Authorization", headers)

    def test_legacy_service_role_keeps_authorization(self):
        with patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": "legacy-jwt"}, clear=False):
            headers = private_headers()
            self.assertEqual(headers["Authorization"], "Bearer legacy-jwt")
