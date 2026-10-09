"""Confidential Xtream credentials in service-role-only Supabase PostgREST.

Plaintext exists only transiently in the Railway process. Never include it in
HTTP responses, analytics, client-visible logs or public app_config.
"""
import base64
import hashlib
import os
import secrets
from datetime import datetime, timezone
from urllib.parse import urlsplit
import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

TABLE = "xtream_accounts"
MAX_ACCOUNTS = 25


def encryption_key():
    # A dedicated long independent Railway secret is preferred. The existing
    # service-role key is an initial fallback to avoid storing plaintext.
    secret = os.environ.get("XTREAM_ENCRYPTION_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not secret or len(secret) < 32:
        raise RuntimeError("encryption_not_configured")
    return hashlib.sha256(b"CINARO/xtream/v1/" + secret.encode()).digest()


def encrypt(value):
    nonce = secrets.token_bytes(12)
    payload = AESGCM(encryption_key()).encrypt(nonce, value.encode("utf-8"), b"cinaro-xtream-v1")
    return base64.urlsafe_b64encode(nonce + payload).decode("ascii")


def decrypt(encoded):
    raw = base64.urlsafe_b64decode(encoded.encode("ascii"))
    return AESGCM(encryption_key()).decrypt(raw[:12], raw[12:], b"cinaro-xtream-v1").decode("utf-8")


def private_headers():
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not key:
        raise RuntimeError("db_unavailable")
    headers = {"apikey": key, "Content-Type": "application/json"}
    # Secret API keys are not JWTs; legacy service_role JWTs still need Bearer.
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = "Bearer " + key
    return headers


def rest_url():
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("db_unavailable")
    return base + "/rest/v1/" + TABLE


def safe_record(row):
    # Username is not necessary for account monitoring and stays encrypted.
    return {
        "id": row["id"],
        "name": row["name"],
        "url": row["base_url"],
        "enabled": row["enabled"] is not False,
        "managed": True,
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "hasCredentials": bool(row.get("username_ciphertext") and row.get("password_ciphertext"))
    }


async def all_rows(client):
    response = await client.get(
        rest_url(), params={"select": "*", "order": "updated_at.desc", "limit": str(MAX_ACCOUNTS + 1)},
        headers=private_headers(), follow_redirects=False, timeout=12
    )
    if response.status_code != 200:
        raise RuntimeError("db_accounts_unavailable")
    rows = response.json()
    if not isinstance(rows, list):
        raise RuntimeError("db_accounts_invalid")
    return rows


async def accounts_for_probe(client):
    rows = await all_rows(client)
    accounts = []
    for row in rows:
        try:
            accounts.append({
                "id": row["id"],
                "name": row["name"],
                "url": row["base_url"],
                "enabled": row["enabled"],
                "username": decrypt(row["username_ciphertext"]),
                "password": decrypt(row["password_ciphertext"])
            })
        except Exception:
            # One corrupt record does not expose secrets or stop all accounts.
            accounts.append({
                "id": row["id"], "name": row["name"], "url": row["base_url"],
                "enabled": False, "username": "", "password": ""
            })
    return accounts


async def save_account(client, data, identifier=None):
    from xtream_monitor import public_provider_url, public_dns
    if not isinstance(data, dict):
        raise ValueError("invalid_payload")
    old = None
    rows = await all_rows(client)
    if identifier:
        old = next((row for row in rows if row["id"] == identifier), None)
        if not old:
            raise ValueError("account_not_found")
    elif len(rows) >= MAX_ACCOUNTS:
        raise ValueError("account_limit_reached")
    name = str(data.get("name", old["name"] if old else "")).strip()
    url = str(data.get("url", old["base_url"] if old else "")).strip().rstrip("/")
    if not name or len(name) > 80 or not public_provider_url(url, allow_http=True):
        raise ValueError("invalid_name_or_public_url")
    parsed = urlsplit(url)
    # HTTP account credentials travel in cleartext between this server and
    # the Xtream provider; require owner acknowledgement on first use/change.
    if parsed.scheme == "http" and not data.get("allowHttp") is True and not (
        old and old["base_url"] == url
    ):
        raise ValueError("http_requires_consent")
    # Disabling an existing account must work even if its provider DNS is
    # currently down. Revalidate DNS only when introducing/changing a host.
    if (not old or url != old["base_url"]) and not await public_dns(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)):
        raise ValueError("invalid_public_host")
    username = data.get("username")
    password = data.get("password")
    # Blank fields on edit preserve existing encrypted credentials.
    if old:
        u = encrypt(str(username)) if username is not None and str(username) != "" else old["username_ciphertext"]
        p = encrypt(str(password)) if password is not None and str(password) != "" else old["password_ciphertext"]
    else:
        if not isinstance(username, str) or not isinstance(password, str) or not username or not password:
            raise ValueError("credentials_required")
        u, p = encrypt(username), encrypt(password)
    if any(len(str(field or "")) > 256 for field in (username, password)):
        raise ValueError("credentials_too_long")
    enabled = data.get("enabled", old["enabled"] if old else True)
    if not isinstance(enabled, bool):
        raise ValueError("invalid_enabled")
    item = {
        "id": identifier or ("x-" + secrets.token_hex(8)), "name": name, "base_url": url,
        "username_ciphertext": u, "password_ciphertext": p, "enabled": enabled,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    if old:
        result = await client.patch(
            rest_url(), params={"id": "eq." + item["id"]}, json={k: v for k, v in item.items() if k != "id"},
            headers={**private_headers(), "Prefer": "return=representation"}, timeout=12, follow_redirects=False
        )
    else:
        result = await client.post(
            rest_url(), json=item,
            headers={**private_headers(), "Prefer": "return=representation"}, timeout=12, follow_redirects=False
        )
    if result.status_code not in (200, 201) or not result.json():
        raise RuntimeError("account_save_failed")
    return safe_record(result.json()[0])


async def delete_account(client, identifier):
    rows = await all_rows(client)
    if not any(row["id"] == identifier for row in rows):
        raise ValueError("account_not_found")
    response = await client.delete(
        rest_url(), params={"id": "eq." + identifier},
        headers=private_headers(), timeout=12, follow_redirects=False
    )
    if response.status_code not in (200, 204):
        raise RuntimeError("account_delete_failed")
    return True
