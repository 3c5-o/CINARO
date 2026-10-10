"""Safe Xtream relay regression tests; no provider credentials or network access."""
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from xtream_import import _open_media, _detect_container, _stream_url, _public_media_target


class XtreamPlaybackTests(unittest.IsolatedAsyncioTestCase):
    async def test_safe_redirect_returns_media_and_preserves_range(self):
        seen = []
        async def handler(request):
            seen.append((str(request.url), request.headers.get("range")))
            if request.url.host == "provider.example":
                return httpx.Response(302, headers={"location": "https://cdn.example.net/media.mp4"})
            return httpx.Response(206, headers={"content-range": "bytes 0-511/10000"},
                                  content=b"\x00\x00\x00\x18ftypisom" + b"m" * 500)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with patch("xtream_import.public_dns", new_callable=AsyncMock, return_value=True):
                stream, hops = await _open_media(client,
                    "http://provider.example:2082/movie/user/pass/42.mp4",
                    {"Range": "bytes=0-511"})
                self.assertEqual(hops, 1)
                self.assertEqual(stream.status_code, 206)
                self.assertEqual(_detect_container(await stream.aread()), "mp4")
                await stream.aclose()
        self.assertEqual(len(seen), 2)
        self.assertEqual(seen[1][1], "bytes=0-511")

    async def test_private_redirect_is_rejected_without_request(self):
        seen = []
        async def handler(request):
            seen.append(str(request.url))
            return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with patch("xtream_import.public_dns", new_callable=AsyncMock, return_value=True):
                with self.assertRaises(HTTPException) as caught:
                    await _open_media(client, "http://provider.example:2082/movie/one/two/7.mp4", {})
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(len(seen), 1)

    async def test_missing_and_extra_redirects_are_rejected(self):
        async def handler(request):
            return httpx.Response(302, headers={"location": "/again"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with patch("xtream_import.public_dns", new_callable=AsyncMock, return_value=True):
                with self.assertRaises(HTTPException) as caught:
                    await _open_media(client, "https://provider.example/video", {})
        self.assertEqual(caught.exception.detail, "provider_stream_redirect_failed")

    async def test_media_404_status_preserved_for_error_diagnostics(self):
        async def handler(request):
            return httpx.Response(404)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with patch("xtream_import.public_dns", new_callable=AsyncMock, return_value=True):
                stream, hops = await _open_media(client, "https://provider.example/video", {})
                self.assertEqual(stream.status_code, 404)
                self.assertEqual(hops, 0)
                await stream.aclose()

    async def test_dns_must_be_public_even_if_hostname_looks_public(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
            with patch("xtream_import.public_dns", new_callable=AsyncMock, return_value=False):
                with self.assertRaises(HTTPException) as caught:
                    await _open_media(client, "https://cdn.example.net/video.mp4", {})
        self.assertEqual(caught.exception.detail, "provider_stream_unreachable_destination")

    async def test_format_fingerprints_and_url_encoding(self):
        self.assertEqual(_detect_container(b"\x00\x00\x00\x18ftypisom"), "mp4")
        self.assertEqual(_detect_container(bytes.fromhex("1a45dfa3") + b"\x00"), "mkv")
        self.assertEqual(_detect_container(b"#EXTM3U\n"), "hls")
        self.assertEqual(_detect_container(b"<html>not a video</html>"), "html_or_error")
        self.assertFalse(_public_media_target("http://localhost/video"))
        self.assertFalse(_public_media_target("http://10.0.0.1/video"))
        self.assertTrue(_public_media_target("https://cdn.example.net/v.mp4"))
        account = {"url": "http://provider.example:2082", "username": "x@user", "password": "a#b"}
        stream_url = _stream_url(account, "movie", "10", "mp4")
        self.assertIn("x%40user/a%23b/10.mp4", stream_url)
