import asyncio
import json
import unittest
from unittest.mock import patch

from xtream_monitor import (
    anime_category_ids, configured_accounts, fetch_snapshot,
    public_https_url, tally, timestamp
)


class StreamResponse:
    def __init__(self, value, status=200):
        self.status_code = status
        self.content = json.dumps(value).encode()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def aiter_bytes(self):
        yield self.content


class Client:
    def __init__(self, responses):
        self.responses = responses

    def stream(self, method, url, params, follow_redirects=False, timeout=18):
        assert method == "GET"
        assert url.startswith("https://provider.example/")
        assert follow_redirects is False
        assert params["username"] == "private_user"
        assert params["password"] == "secret"
        action = params.get("action", "")
        return StreamResponse(self.responses[action])


class XtreamTests(unittest.IsolatedAsyncioTestCase):
    def test_public_hosts(self):
        self.assertTrue(public_https_url("https://provider.example:8443"))
        for address in [
            "http://provider.example", "https://127.0.0.1:1234",
            "https://localhost", "https://user:pass@provider.example",
            "https://provider.example/path", "https://10.0.0.1"
        ]:
            self.assertFalse(public_https_url(address))

    def test_classification_and_counts(self):
        movie_categories = [
            {"category_id": "1", "category_name": "Movies"},
            {"category_id": "2", "category_name": "Anime Movies"}
        ]
        series_categories = [
            {"category_id": "3", "category_name": "Series"},
            {"category_id": "4", "category_name": "انمي"}
        ]
        data = tally([
            {"category_id": "1"}, {"category_id": "2"}
        ], [{"category_id": "3"}, {"category_id": "4"}],
            [{"stream_id": 1}, {"stream_id": 2}], movie_categories, series_categories)
        self.assertEqual(data["movies"], 1)
        self.assertEqual(data["series"], 1)
        self.assertEqual(data["anime"], 2)
        self.assertEqual(data["live"], 2)
        self.assertTrue(data["animeEstimated"])
        self.assertEqual(anime_category_ids(series_categories), {"4"})

    def test_config_does_not_require_any_account(self):
        with patch.dict("os.environ", {"XTREAM_MONITOR_ACCOUNTS_JSON": "[]"}):
            self.assertEqual(configured_accounts(), [])
        with patch.dict("os.environ", {"XTREAM_MONITOR_ACCOUNTS_JSON": '[{"id":"a"},{"id":"a"}]'}):
            with self.assertRaises(ValueError):
                configured_accounts()

    async def test_snapshot_never_returns_secrets_or_stream_urls(self):
        payloads = {
            "": {"user_info": {
                "status": "Active", "exp_date": "1800000000", "created_at": "1700000000",
                "active_cons": "1", "max_connections": "3",
                "is_trial": "0", "allowed_output_formats": ["m3u8", "ts"]
            }, "server_info": {"timezone": "UTC", "time_now": "2026-10-09 12:00:00"}},
            "get_vod_categories": [{"category_id": "1", "category_name": "Movies"},
                                   {"category_id": "2", "category_name": "Anime"}],
            "get_series_categories": [{"category_id": "4", "category_name": "Anime"}],
            "get_vod_streams": [{"category_id": "1", "stream_id": 1, "stream_url": "private"},
                                {"category_id": "2", "stream_id": 2}],
            "get_series": [{"category_id": "4", "series_id": 8}],
            "get_live_streams": [{"stream_id": 3, "stream_url": "live-secret"}]
        }
        account = {
            "id": "one", "name": "Account 1",
            "url": "https://provider.example", "username": "private_user",
            "password": "secret", "enabled": True
        }
        async def allowed(_host, _port):
            return True
        with patch("xtream_monitor.public_dns", allowed):
            snapshot = await fetch_snapshot(Client(payloads), account)
        self.assertEqual(snapshot["health"], "online")
        self.assertEqual(snapshot["counts"]["movies"], 1)
        self.assertEqual(snapshot["counts"]["anime"], 2)
        self.assertEqual(snapshot["counts"]["live"], 1)
        self.assertEqual(snapshot["subscription"]["activeConnections"], 1)
        self.assertIn("expiresAt", snapshot["subscription"])
        exposed = json.dumps(snapshot)
        self.assertNotIn("private_user", exposed)
        self.assertNotIn("secret", exposed)
        self.assertNotIn("stream_url", exposed)

    def test_timestamp_validation(self):
        self.assertIsNone(timestamp("n/a"))
        self.assertIsNone(timestamp("0"))
        self.assertTrue(timestamp("1800000000").startswith("2027"))


if __name__ == "__main__":
    unittest.main()
