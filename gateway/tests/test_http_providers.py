import json
import os
import unittest
from unittest.mock import AsyncMock, patch

from xtream_monitor import fetch_snapshot, public_provider_url, public_https_url
from xtream_store import save_account


class Response:
    def __init__(self, status, data):
        self.status_code = status
        self.payload = data

    def json(self):
        return self.payload


class StorageClient:
    def __init__(self):
        self.rows = []

    async def get(self, url, **kwargs):
        return Response(200, list(self.rows))

    async def post(self, url, json, **kwargs):
        self.rows.append(json)
        return Response(201, [json])


class StreamResponse:
    def __init__(self, data):
        self.status_code = 200
        self.data = json.dumps(data).encode()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def aiter_bytes(self):
        yield self.data


class SourceClient:
    def stream(self, method, url, params, follow_redirects=False, timeout=18):
        assert method == "GET"
        assert url == "http://provider.example:8080/player_api.php"
        assert params["username"] == "xtream-user"
        assert params["password"] == "xtream-password"
        assert follow_redirects is False
        return StreamResponse({"user_info": {"status": "Disabled"}})


class HttpXtreamTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "XTREAM_ENCRYPTION_KEY": "test-encryption-key-only-" + ("k" * 40),
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "test-service-secret-" + ("k" * 40)
        })
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_http_is_opt_in_and_public_only(self):
        self.assertFalse(public_provider_url("http://provider.example:8080"))
        self.assertTrue(public_provider_url("http://provider.example:8080", allow_http=True))
        self.assertTrue(public_provider_url("http://1.1.1.1:8080", allow_http=True))
        self.assertTrue(public_https_url("https://provider.example"))
        for value in [
            "http://localhost:8080", "http://127.0.0.1:8080",
            "http://192.168.1.1:8080", "http://10.0.0.1",
            "http://169.254.169.254", "http://provider.example/admin",
            "http://user:secret@provider.example", "http://provider.example?x=1",
            "file:///etc/passwd", "http://provider.example:99999"
        ]:
            self.assertFalse(public_provider_url(value, allow_http=True), value)

    async def test_http_storage_requires_explicit_consent(self):
        db = StorageClient()
        data = {
            "name": "HTTP provider", "url": "http://provider.example:8080",
            "username": "xtream-user", "password": "xtream-password", "enabled": True
        }
        with self.assertRaisesRegex(ValueError, "http_requires_consent"):
            await save_account(db, data)
        with patch("xtream_monitor.public_dns", new_callable=AsyncMock, return_value=True) as dns:
            account = await save_account(db, {**data, "allowHttp": True})
            dns.assert_awaited_once_with("provider.example", 8080)
        self.assertEqual(account["url"], data["url"])
        self.assertNotIn("xtream-password", str(db.rows))

    async def test_monitor_http_via_gateway_only(self):
        with patch("xtream_monitor.public_dns", new_callable=AsyncMock, return_value=True) as dns:
            snapshot = await fetch_snapshot(SourceClient(), {
                "id": "http", "name": "HTTP", "url": "http://provider.example:8080",
                "username": "xtream-user", "password": "xtream-password", "enabled": True
            })
            dns.assert_awaited_once_with("provider.example", 8080)
        self.assertEqual(snapshot["health"], "inactive")
        self.assertIsNone(snapshot["error"])
