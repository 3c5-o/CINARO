"""CINARO Xtream batch discovery + signed playback, with no credentials in client data.

Reads encrypted credentials from the private vault. Bulk import is orchestrated
by the authenticated Admin UI; provider IDs and episode metadata may be returned
to that Owner, but account passwords are never included.
"""
import asyncio
import hashlib
import hmac
import re
import time
from urllib.parse import urlsplit, urljoin, quote
import ipaddress

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from xtream_monitor import (
    anime_category_ids, json_get, public_dns, public_provider_url, require_owner
)
from xtream_store import accounts_for_probe, encryption_key

router = APIRouter(tags=["xtream-import"])
_ACCOUNT_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_STREAM_ID = re.compile(r"^[0-9]{1,15}$")
_EXT = {"mp4", "mkv", "ts", "avi"}
_MIME = {"mp4": "video/mp4", "mkv": "video/x-matroska",
         "ts": "video/mp2t", "avi": "video/x-msvideo"}
_CATALOG_CACHE = {}
_CACHE_LOCK = asyncio.Lock()


def _extension(raw, default="mp4"):
    ext = str(raw or default).lower().strip().lstrip(".")
    return ext if ext in _EXT else "mp4"


def _signature(account_id, kind, media_id, ext):
    value = "|".join((account_id, kind, media_id, ext)).encode()
    return hmac.new(encryption_key(), b"CINARO/xtream-play/v1/" + value,
                    hashlib.sha256).hexdigest()


def _source_path(account_id, kind, media_id, ext):
    if not _ACCOUNT_ID.fullmatch(account_id) or not _STREAM_ID.fullmatch(media_id):
        raise ValueError("invalid_provider_media_id")
    if kind not in ("movie", "series") or ext not in _EXT:
        raise ValueError("invalid_provider_media_format")
    sig = _signature(account_id, kind, media_id, ext)
    return f"/xtream/play/{account_id}/{kind}/{media_id}.{ext}?sig={sig}"


async def _account(client, identifier):
    if not _ACCOUNT_ID.fullmatch(identifier or ""):
        raise HTTPException(400, "invalid_account_id")
    try:
        items = await accounts_for_probe(client)
    except Exception:
        raise HTTPException(503, "xtream_vault_unavailable") from None
    account = next((item for item in items if item["id"] == identifier), None)
    if not account:
        raise HTTPException(404, "account_not_found")
    if not account["enabled"] or not account["username"] or not account["password"]:
        raise HTTPException(409, "account_disabled_or_credentials_unavailable")
    url = account["url"]
    if not public_provider_url(url, allow_http=True):
        raise HTTPException(400, "invalid_public_provider_url")
    parts = urlsplit(url)
    if not await public_dns(parts.hostname, parts.port or (80 if parts.scheme == "http" else 443)):
        raise HTTPException(503, "provider_host_unreachable")
    return account


def _normalize_catalog(account_id, movies, tv, vod_categories, series_categories):
    anime_vods = anime_category_ids(vod_categories)
    anime_tv = anime_category_ids(series_categories)
    items = []
    for row in movies:
        if not isinstance(row, dict):
            continue
        ident = str(row.get("stream_id") or "")
        if not _STREAM_ID.fullmatch(ident):
            continue
        raw_tmdb = str(row.get("tmdb_id") or row.get("tmdb") or "")
        items.append({
            "accountId": account_id, "kind": "movie",
            "contentType": "movie", "id": ident,
            "title": str(row.get("name") or "فيلم")[:180],
            "year": str(row.get("year") or "")[:4],
            "tmdbId": int(raw_tmdb) if raw_tmdb.isdigit() else 0,
            "poster": str(row.get("stream_icon") or "")[:500],
            "categoryId": str(row.get("category_id") or ""),
            "animeCategory": str(row.get("category_id") or "") in anime_vods,
            "extension": _extension(row.get("container_extension"))
        })
    for row in tv:
        if not isinstance(row, dict):
            continue
        ident = str(row.get("series_id") or "")
        if not _STREAM_ID.fullmatch(ident):
            continue
        raw_tmdb = str(row.get("tmdb_id") or row.get("tmdb") or "")
        is_anime = str(row.get("category_id") or "") in anime_tv
        items.append({
            "accountId": account_id, "kind": "series",
            "contentType": "anime" if is_anime else "series", "id": ident,
            "title": str(row.get("name") or "مسلسل")[:180],
            "year": str(row.get("year") or "")[:4],
            "tmdbId": int(raw_tmdb) if raw_tmdb.isdigit() else 0,
            "poster": str(row.get("cover") or "")[:500],
            "categoryId": str(row.get("category_id") or "")
        })
    # Stable order makes cursor-based batches repeatable across refreshes.
    return sorted(items, key=lambda item: (item["kind"], item["contentType"], int(item["id"])))


async def _catalog(client, account):
    identifier = account["id"]
    async with _CACHE_LOCK:
        cache = _CATALOG_CACHE.get(identifier)
        if cache and time.monotonic() - cache["at"] < 600:
            return cache["data"]
    root = account["url"] + "/player_api.php"
    auth = {"username": account["username"], "password": account["password"]}
    actions = ("get_vod_categories", "get_series_categories", "get_vod_streams", "get_series")
    # Do not include live streams: they are monitored only.
    results = await asyncio.gather(*(
        json_get(client, root, {**auth, "action": action}) for action in actions
    ))
    if any(not isinstance(row, list) for row in results):
        raise HTTPException(502, "provider_catalog_incomplete")
    data = _normalize_catalog(identifier, results[2], results[3], results[0], results[1])
    async with _CACHE_LOCK:
        _CATALOG_CACHE[identifier] = {"at": time.monotonic(), "data": data}
    return data


def _stream_url(account, kind, media_id, extension):
    # Xtream credentials never appear in public CINARO source records.
    username = quote(str(account["username"]), safe="")
    password = quote(str(account["password"]), safe="")
    return f'{account["url"]}/{kind}/{username}/{password}/{media_id}.{extension}'


def _public_media_target(target):
    """Accept only publicly addressable HTTP(S) media locations, including paths."""
    try:
        parsed = urlsplit(target)
        if parsed.scheme not in ("http", "https"):
            return False
        if not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            return False
        _ = parsed.port
        host = parsed.hostname.lower()
        if host == "localhost" or host.endswith((".local", ".localhost", ".internal")):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return "." in host and not host.endswith(".")
    except (ValueError, TypeError):
        return False


async def _open_media(client, start_url, headers):
    """Follow bounded redirects only after validating DNS at every location.

    Do not expose credential-bearing Xtream or CDN URLs to any client or log.
    """
    current = start_url
    for redirects in range(4):
        if not _public_media_target(current):
            raise HTTPException(502, "provider_stream_invalid_destination")
        parsed = urlsplit(current)
        if not await public_dns(parsed.hostname, parsed.port or
                                (443 if parsed.scheme == "https" else 80)):
            raise HTTPException(502, "provider_stream_unreachable_destination")
        try:
            request = client.build_request("GET", current, headers=headers, timeout=30)
            upstream = await client.send(request, stream=True, follow_redirects=False)
        except Exception:
            raise HTTPException(502, "provider_stream_connect_failed") from None
        if upstream.status_code not in (301, 302, 303, 307, 308):
            return upstream, redirects
        location = upstream.headers.get("location", "")
        await upstream.aclose()
        if not location or redirects >= 3:
            raise HTTPException(502, "provider_stream_redirect_failed")
        current = urljoin(current, location)
    raise HTTPException(502, "provider_stream_redirect_failed")


def _detect_container(chunk):
    """Small, read-only probe: do not download a full film."""
    if len(chunk) >= 12 and chunk[4:8] == b"ftyp":
        return "mp4"
    if chunk.startswith(bytes.fromhex("1a45dfa3")):
        return "mkv"
    if len(chunk) >= 189 and chunk[0] == 0x47 and chunk[188] == 0x47:
        return "ts"
    if chunk.lstrip().startswith(b"#EXTM3U"):
        return "hls"
    if chunk.lstrip().lower().startswith((b"<html", b"<!doctype html", b"<?xml")):
        return "html_or_error"
    return "unknown"


def _episodes(account_id, payload):
    raw = payload.get("episodes") if isinstance(payload, dict) else None
    if not isinstance(raw, dict) or not raw:
        raise ValueError("series_episodes_missing")
    seasons = []
    total = 0
    for season_key, entries in sorted(raw.items(), key=lambda item: int(item[0]) if str(item[0]).isdigit() else 9999):
        if not str(season_key).isdigit() or not isinstance(entries, list):
            raise ValueError("series_episodes_incomplete")
        if not 1 <= int(season_key) <= 100 or not 1 <= len(entries) <= 500:
            raise ValueError("series_episode_limit_exceeded")
        episodes = []
        seen = set()
        for row in entries:
            if not isinstance(row, dict):
                raise ValueError("series_episodes_incomplete")
            media_id = str(row.get("id") or "")
            num = row.get("episode_num") or row.get("episode_number")
            if not _STREAM_ID.fullmatch(media_id) or not str(num).isdigit() or int(num) < 1:
                raise ValueError("series_episodes_incomplete")
            if int(num) in seen:
                raise ValueError("series_duplicate_episodes")
            seen.add(int(num))
            ext = _extension(row.get("container_extension") or row.get("info", {}).get("container_extension") if isinstance(row.get("info"), dict) else row.get("container_extension"))
            episodes.append({
                "id": f"e{int(num)}", "number": int(num),
                "title": str(row.get("title") or f"الحلقة {num}")[:150],
                "duration": 0, "thumbnail": "",
                "sources": [{"label": "Xtream", "path": _source_path(account_id, "series", media_id, ext),
                             "type": _MIME[ext]}],
                "subtitles": []
            })
        total += len(episodes)
        episodes.sort(key=lambda x: x["number"])
        seasons.append({"number": int(season_key), "title": f"الموسم {int(season_key)}", "episodes": episodes})
    if not seasons or not total:
        raise ValueError("series_episodes_missing")
    # Xtream's series_info may include authoritative counts; reject partial
    # responses rather than silently publishing a one-episode "full" series.
    expected_seasons = payload.get("seasons") if isinstance(payload, dict) else None
    if isinstance(expected_seasons, list):
        actual = {season["number"]: len(season["episodes"]) for season in seasons}
        for season in expected_seasons:
            if not isinstance(season, dict):
                continue
            num = season.get("season_number", season.get("number"))
            expected = season.get("episode_count", season.get("episodes_count"))
            if str(num).isdigit() and str(expected).isdigit() and int(num) >= 1:
                if actual.get(int(num), 0) < int(expected):
                    raise ValueError("series_episodes_incomplete")
    return seasons, total


def attach_xtream_import(app, client_provider, supabase_url, service_key, owner_email):
    async def owner_client(header):
        client = client_provider()
        if not client:
            raise HTTPException(503, "gateway_unavailable")
        token = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else ""
        await require_owner(token, client, supabase_url, service_key, owner_email)
        return client

    @router.get("/admin/xtream/catalog")
    async def catalog(authorization: str = Header(default=""),
                      account: str = Query(...), kind: str = Query("all"),
                      cursor: int = Query(0, ge=0),
                      limit: int = Query(100, ge=1, le=100)):
        if kind not in ("all", "movie", "series", "anime"):
            raise HTTPException(400, "invalid_kind")
        client = await owner_client(authorization)
        item = await _account(client, account)
        try:
            rows = await _catalog(client, item)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(502, "provider_catalog_unavailable") from None
        if kind == "movie":
            rows = [row for row in rows if row["kind"] == "movie"]
        elif kind == "series":
            rows = [row for row in rows if row["contentType"] == "series"]
        elif kind == "anime":
            rows = [row for row in rows if row["contentType"] == "anime"]
        selected = rows[cursor: cursor + limit]
        return {"ok": True, "total": len(rows), "cursor": cursor,
                "nextCursor": min(len(rows), cursor + len(selected)),
                "hasMore": cursor + len(selected) < len(rows), "items": selected}

    @router.get("/admin/xtream/detail")
    async def detail(authorization: str = Header(default=""),
                     account: str = Query(...), kind: str = Query(...),
                     media_id: str = Query(...),
                     extension: str = Query("mp4")):
        if kind not in ("movie", "series") or not _STREAM_ID.fullmatch(media_id):
            raise HTTPException(400, "invalid_media_id")
        if extension not in _EXT:
            raise HTTPException(400, "invalid_media_id")
        client = await owner_client(authorization)
        item = await _account(client, account)
        if kind == "movie":
            # Playback is always a gateway capability URL, never an Xtream credential URL.
            return {"ok": True, "sources": [{
                "label": "Xtream",
                "path": _source_path(account, "movie", media_id, extension),
                "type": _MIME[extension]
            }]}
        try:
            raw = await json_get(client, item["url"] + "/player_api.php", {
                "username": item["username"], "password": item["password"],
                "action": "get_series_info", "series_id": media_id
            })
            seasons, count = _episodes(account, raw)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except Exception:
            raise HTTPException(502, "series_info_unavailable") from None
        return {"ok": True, "seasons": seasons, "episodeCount": count}

    @router.get("/admin/xtream/playback-check")
    async def playback_check(authorization: str = Header(default=""),
                             account: str = Query(...),
                             kind: str = Query("movie"),
                             media_id: str = Query(...),
                             extension: str = Query("mp4")):
        """Read at most a few kilobytes to diagnose one owned catalog entry."""
        client = await owner_client(authorization)
        if kind not in ("movie", "series") or not _STREAM_ID.fullmatch(media_id) or extension not in _EXT:
            raise HTTPException(400, "invalid_media_id")
        entry = await _account(client, account)
        report = {"ok": False, "upstreamStatus": None, "redirects": 0,
                  "contentType": "", "detectedFormat": "unknown",
                  "reason": "not_checked"}
        try:
            upstream, hops = await _open_media(client,
                _stream_url(entry, kind, media_id, extension),
                {"Range": "bytes=0-4095"})
        except HTTPException as exc:
            report["reason"] = str(exc.detail)
            return report
        try:
            report["upstreamStatus"] = upstream.status_code
            report["redirects"] = hops
            report["contentType"] = upstream.headers.get("content-type", "")[:100]
            if upstream.status_code not in (200, 206):
                report["reason"] = "provider_media_http_" + str(upstream.status_code)
                return report
            sample = bytearray()
            async for data in upstream.aiter_raw(chunk_size=512):
                sample.extend(data[:max(0, 4096 - len(sample))])
                if len(sample) >= 512:
                    break
            report["detectedFormat"] = _detect_container(bytes(sample))
            report["ok"] = report["detectedFormat"] in ("mp4", "mkv", "ts", "hls")
            report["reason"] = "media_bytes_received" if report["ok"] else "media_bytes_unrecognized"
            return report
        except Exception:
            report["reason"] = "provider_media_probe_failed"
            return report
        finally:
            await upstream.aclose()

    @router.api_route("/xtream/play/{account}/{kind}/{media_id}.{ext}", methods=["GET", "HEAD"])
    async def play(request: Request, account: str, kind: str, media_id: str,
                   ext: str, sig: str = Query("")):
        if not _ACCOUNT_ID.fullmatch(account) or kind not in ("movie", "series") or not _STREAM_ID.fullmatch(media_id) or ext not in _EXT:
            raise HTTPException(404, "stream_not_found")
        if not hmac.compare_digest(sig, _signature(account, kind, media_id, ext)):
            raise HTTPException(403, "stream_signature_invalid")
        client = client_provider()
        if client is None:
            raise HTTPException(503, "gateway_unavailable")
        entry = await _account(client, account)
        url = _stream_url(entry, kind, media_id, ext)
        headers = {}
        range_value = request.headers.get("range", "")
        if range_value and re.fullmatch(r"bytes=\d*-(?:\d*)?", range_value):
            headers["Range"] = range_value
        upstream, _redirect_count = await _open_media(client, url, headers)
        if upstream.status_code not in (200, 206):
            await upstream.aclose()
            raise HTTPException(502, "provider_media_http_" + str(upstream.status_code))
        exposed = {"Cache-Control": "no-store", "Accept-Ranges": "bytes"}
        for name in ("Content-Length", "Content-Range"):
            if upstream.headers.get(name):
                exposed[name] = upstream.headers[name]
        async def chunks():
            try:
                async for chunk in upstream.aiter_raw(chunk_size=256 * 1024):
                    if await request.is_disconnected():
                        break
                    yield chunk
            finally:
                await upstream.aclose()
        if request.method == "HEAD":
            await upstream.aclose()
            return StreamingResponse(iter(()), status_code=upstream.status_code,
                                     headers=exposed, media_type=_MIME[ext])
        return StreamingResponse(chunks(), status_code=upstream.status_code,
                                 headers=exposed, media_type=_MIME[ext])

    app.include_router(router)
