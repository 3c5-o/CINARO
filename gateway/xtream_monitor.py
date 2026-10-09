"""Read-only Xtream account dashboard. No Xtream passwords or stream URLs leave the gateway.

Configuration: XTREAM_MONITOR_ACCOUNTS_JSON (Railway secret), JSON array of
{"id":"main","name":"المصدر الأول","url":"https://provider.example:443",
 "username":"...","password":"...","enabled":true}.
Requires HTTPS and public DNS hosts. Does not import or play any media.
"""
import asyncio
import ipaddress
import json
import os
import re
import socket
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request

router = APIRouter(prefix="/admin/xtream", tags=["xtream-monitor"])
_CACHE = {}
_CACHE_TTL = 300
_LOCK = asyncio.Lock()
_ACCOUNT_ID = re.compile(r"^[a-zA-Z0-9_-]{1,40}$")
_ANIME_WORDS = ("anime", "animation", "أنمي", "انمي", "انيمي", "انيميشن", "أنيمي")
_MAX_LIST_BYTES = 32 * 1024 * 1024


def configured_accounts():
    raw = os.getenv("XTREAM_MONITOR_ACCOUNTS_JSON", "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise ValueError("xtream_config_invalid") from exc
    if not isinstance(data, list) or len(data) > 25:
        raise ValueError("xtream_config_invalid")
    results, seen = [], set()
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("xtream_config_invalid")
        identifier = str(item.get("id") or "")
        if not _ACCOUNT_ID.fullmatch(identifier) or identifier in seen:
            raise ValueError("xtream_config_invalid")
        seen.add(identifier)
        host = str(item.get("url") or "").strip().rstrip("/")
        username = str(item.get("username") or "")
        password = str(item.get("password") or "")
        if not host or not username or not password:
            raise ValueError("xtream_config_invalid")
        results.append({
            "id": identifier, "name": str(item.get("name") or identifier)[:64],
            "url": host, "username": username, "password": password,
            "enabled": item.get("enabled") is not False
        })
    return results


def public_https_url(raw):
    try:
        value = urlsplit(raw)
        if value.scheme != "https" or not value.hostname or value.username or value.password:
            return False
        if value.path not in ("", "/") or value.query or value.fragment:
            return False
        host = value.hostname.lower()
        if host == "localhost" or host.endswith((".local", ".internal", ".localhost")):
            return False
        try:
            ipaddress.ip_address(host)
            return False  # require a DNS name, not arbitrary private/public IP literals
        except ValueError:
            return "." in host
    except (ValueError, TypeError):
        return False


async def public_dns(host, port):
    try:
        results = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
        return bool(results) and all(ipaddress.ip_address(item[4][0]).is_global for item in results)
    except (OSError, ValueError):
        return False


def timestamp(raw):
    try:
        v = int(raw)
        return datetime.fromtimestamp(v, timezone.utc).isoformat() if v > 0 else None
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def anime_category_ids(categories):
    return {
        str(category.get("category_id"))
        for category in categories if isinstance(category, dict)
        and any(w in str(category.get("category_name") or "").casefold() for w in _ANIME_WORDS)
    }


def tally(vods, series, live, vod_categories, series_categories):
    anime_vods = anime_category_ids(vod_categories)
    anime_series = anime_category_ids(series_categories)
    av = sum(1 for row in vods if str(row.get("category_id")) in anime_vods)
    ass = sum(1 for row in series if str(row.get("category_id")) in anime_series)
    return {
        "movies": len(vods) - av,
        "series": len(series) - ass,
        "anime": av + ass,
        "live": len(live),  # monitoring count only, no live streaming UI or playback URLs
        "animeMovies": av,
        "animeSeries": ass,
        "vodTotal": len(vods),
        "seriesTotal": len(series),
        "animeEstimated": True,
        "categories": {
            "movie": len(vod_categories),
            "series": len(series_categories)
        }
    }


async def json_get(client, url, params):
    # Bounded fetch; never follow provider redirects with credentials.
    async with client.stream("GET", url, params=params, follow_redirects=False, timeout=18) as response:
        if response.status_code != 200:
            raise RuntimeError("provider_http_" + str(response.status_code))
        data = bytearray()
        async for chunk in response.aiter_bytes():
            data.extend(chunk)
            if len(data) > _MAX_LIST_BYTES:
                raise RuntimeError("provider_list_too_large")
    try:
        return json.loads(data)
    except (ValueError, UnicodeError):
        raise RuntimeError("provider_invalid_json") from None


async def fetch_snapshot(client, account):
    start = time.monotonic()
    snap = {
        "id": account["id"], "name": account["name"],
        "host": "", "enabled": account["enabled"],
        "health": "disabled" if not account["enabled"] else "unknown",
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "latencyMs": None, "error": None, "counts": None, "subscription": None
    }
    try:
        url = account["url"]
        if not public_https_url(url):
            raise RuntimeError("public_https_required")
        parsed = urlsplit(url)
        snap["host"] = parsed.hostname
        if not account["enabled"]:
            return snap
        if not await public_dns(parsed.hostname, parsed.port or 443):
            raise RuntimeError("provider_host_unreachable")
        params = {"username": account["username"], "password": account["password"]}
        auth = await json_get(client, url + "/player_api.php", params)
        if not isinstance(auth, dict) or not isinstance(auth.get("user_info"), dict):
            raise RuntimeError("provider_auth_invalid")
        u = auth["user_info"]
        info = auth.get("server_info") if isinstance(auth.get("server_info"), dict) else {}
        status = str(u.get("status") or "unknown")
        snap["subscription"] = {
            "status": status,
            "expiresAt": timestamp(u.get("exp_date")),
            "createdAt": timestamp(u.get("created_at")),
            "trial": str(u.get("is_trial", "0")).lower() in ("1", "true"),
            "activeConnections": _int_or_none(u.get("active_cons")),
            "maxConnections": _int_or_none(u.get("max_connections")),
            "allowedFormats": [str(v)[:18] for v in u.get("allowed_output_formats", [])[:10]]
                if isinstance(u.get("allowed_output_formats"), list) else [],
            "serverTimezone": str(info.get("timezone") or "")[:60] or None,
            "serverTime": str(info.get("time_now") or "")[:60] or None
        }
        if status.casefold() not in ("active", "enabled"):
            snap["health"] = "inactive"
            return snap
        expiry = snap["subscription"]["expiresAt"]
        if expiry and datetime.fromisoformat(expiry) <= datetime.now(timezone.utc):
            snap["health"] = "expired"
            return snap
        actions = [
            "get_vod_categories", "get_series_categories",
            "get_vod_streams", "get_series", "get_live_streams"
        ]
        results = await asyncio.gather(*(
            json_get(client, url + "/player_api.php", {**params, "action": action})
            for action in actions
        ), return_exceptions=True)
        if any(isinstance(v, BaseException) or not isinstance(v, list) for v in results):
            snap["health"] = "partial"
            snap["error"] = "provider_catalog_incomplete"
        else:
            snap["counts"] = tally(results[2], results[3], results[4], results[0], results[1])
            snap["health"] = "online"
    except (RuntimeError, httpx.HTTPError, ValueError, OverflowError) as exc:
        snap["health"] = "error"
        code = str(exc)
        snap["error"] = code if code in (
            "public_https_required", "provider_host_unreachable", "provider_auth_invalid",
            "provider_catalog_incomplete", "provider_invalid_json", "provider_list_too_large"
        ) or code.startswith("provider_http_") else "provider_connection_failed"
    except Exception:
        snap["health"] = "error"
        snap["error"] = "provider_check_failed"
    finally:
        snap["latencyMs"] = round((time.monotonic() - start) * 1000)
    return snap


def _int_or_none(value):
    try:
        return max(0, int(value))
    except (ValueError, TypeError):
        return None


async def require_owner(token, client, supabase_url, service_key, owner_email):
    if not token or not supabase_url or not service_key:
        raise HTTPException(401, "authentication_required")
    try:
        response = await client.get(
            supabase_url.rstrip("/") + "/auth/v1/user",
            headers={"apikey": service_key, "Authorization": "Bearer " + token},
            timeout=8, follow_redirects=False
        )
        if response.status_code != 200:
            raise HTTPException(403, "admin_access_denied")
        body = response.json()
        if not isinstance(body, dict) or str(body.get("email") or "").casefold() != owner_email.casefold():
            raise HTTPException(403, "admin_access_denied")
        if not body.get("email_confirmed_at"):
            raise HTTPException(403, "admin_access_denied")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "authentication_unavailable") from None


def attach_monitor(app, client_provider, supabase_url, service_key, owner_email):
    from xtream_store import accounts_for_probe, all_rows, safe_record, save_account, delete_account
    from fastapi.responses import JSONResponse
    from fastapi import Body
    from fastapi import status as status_codes

    async def owner_client(header):
        client = client_provider()
        if not client:
            raise HTTPException(503, "gateway_unavailable")
        token = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else ""
        await require_owner(token, client, supabase_url, service_key, owner_email)
        return client

    @router.get("/accounts")
    async def monitor_accounts(
        authorization: str = Header(default=""),
        fresh: bool = Query(False)
    ):
        client = await owner_client(authorization)
        try:
            accounts = await accounts_for_probe(client)
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from None
        async with _LOCK:
            now = time.monotonic()
            state = _CACHE.get("snapshots")
            # Never reuse results from before a CRUD mutation or a different
            # set of accounts. The whole cache is invalidated on every write.
            if state and now - state["time"] < (20 if fresh else _CACHE_TTL):
                return {"ok": True, "accounts": state["data"], "cached": True,
                        "configured": len(state["data"]), "syncEnabled": False}
            sem = asyncio.Semaphore(2)
            async def one(account):
                async with sem:
                    return await fetch_snapshot(client, account)
            data = await asyncio.gather(*(one(account) for account in accounts))
            _CACHE["snapshots"] = {"time": time.monotonic(), "data": data}
            return {"ok": True, "accounts": data, "cached": False,
                    "configured": len(data), "syncEnabled": False}

    @router.get("/manage")
    async def list_managed_accounts(authorization: str = Header(default="")):
        client = await owner_client(authorization)
        try:
            rows = await all_rows(client)
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from None
        return {"ok": True, "accounts": [safe_record(row) for row in rows]}

    @router.post("/manage", status_code=status_codes.HTTP_201_CREATED)
    async def create_managed_account(request: Request, authorization: str = Header(default="")):
        client = await owner_client(authorization)
        try:
            body = await request.json()
            record = await save_account(client, body)
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from None
        _CACHE.clear()
        return {"ok": True, "account": record}

    @router.patch("/manage/{identifier}")
    async def edit_managed_account(identifier: str, request: Request, authorization: str = Header(default="")):
        client = await owner_client(authorization)
        if not _ACCOUNT_ID.fullmatch(identifier):
            raise HTTPException(400, "invalid_account_id")
        try:
            body = await request.json()
            record = await save_account(client, body, identifier)
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from None
        _CACHE.clear()
        return {"ok": True, "account": record}

    @router.delete("/manage/{identifier}")
    async def delete_managed_account(identifier: str, authorization: str = Header(default="")):
        client = await owner_client(authorization)
        if not _ACCOUNT_ID.fullmatch(identifier):
            raise HTTPException(400, "invalid_account_id")
        try:
            await delete_account(client, identifier)
        except ValueError as error:
            raise HTTPException(404, str(error)) from None
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from None
        _CACHE.clear()
        return {"ok": True, "deleted": True}

    app.include_router(router)
