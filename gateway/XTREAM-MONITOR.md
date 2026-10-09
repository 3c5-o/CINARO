# CINARO Xtream — management and account monitoring

## Full account management inside the admin app

Open CINARO Admin → Settings → Xtream Accounts (or the Xtream sidebar section).
Add the HTTPS base URL, username, password, display name, and enabled flag.
Edit, disable/re-enable, remove accounts, or refresh their status without touching Railway Variables.
Only the verified CINARO primary owner account may access this gateway API.

## Mandatory one-time database migration

On the CINARO Supabase project referenced by admin/supabase.js, apply:

supabase/migrations/20261009130000_add_xtream_accounts_vault.sql

The current connected Supabase plugin does not expose the CINARO project, so the migration has NOT yet been applied in production.
Until it is applied, account management returns db_accounts_unavailable; do not claim it is fully operational.

## Credential security

Credentials are submitted via HTTPS with a Supabase bearer token to the Railway gateway.
The gateway encrypts them with AES-256-GCM and persists ciphertext in a table restricted to service_role.
Passwords and usernames are never included in listing, monitoring responses, client storage, or audit logs.
Gateway derives encryption key from XTREAM_ENCRYPTION_KEY if set; otherwise derives it from SUPABASE_SERVICE_ROLE_KEY.
Use a long independent XTREAM_ENCRYPTION_KEY on Railway if possible; back up the secret securely, as rotating it without re-encryption makes existing stored credentials unreadable.
Use only accounts and content you have authorization to access.

## Metrics and limitations

Shows account status, expiry date/days remaining, account creation date, active and max connections, trial status, supported formats, timezone, latency, and separate movie/series/anime/live counts.
Live channels are COUNT-ONLY. No live-TV page, stream extraction, or streaming endpoint is added.
Anime categorization is estimated from provider category names and can miss titles. Totals across accounts can include duplicates.
IPTV account monitoring is not equivalent to importing VOD and series into CINARO or verifying playback of an entire film.
Monitoring runs against public HTTPS hosts only; 25 accounts maximum, short request timeouts and caching.

## Endpoints (owner-only)

GET /admin/xtream/manage — listing without any credentials
POST /admin/xtream/manage — create account
PATCH /admin/xtream/manage/{id} — rename/change credentials/enable
DELETE /admin/xtream/manage/{id} — remove
GET /admin/xtream/accounts[?fresh=true] — provider status and counts

Owner is checked server-side using Supabase Auth /auth/v1/user, not by trusting a client flag.

## Forced provider shutdown

Admin Settings → Media Catalog API or Anime API → إيقاف قسري الآن / تشغيل المزوّد.
Force shutdown blocks new imports and hides matching imported items from clients receiving the updated app_config.
The new user player also blocks manually entered deep links for those items. Older app releases and raw media source URLs are not remotely revocable by this UI alone.

## Playback compatibility

Android Media3 supports MP4, HLS, MPEG-DASH, TS, and MKV demuxing, subject to device codec/DRM/server behavior.
Web player supports MP4 and compatible browser formats, hls.js, mpegts.js, dash.js; MKV usually needs Android native player.
Neither backend nor client can repair nonexistent segments, invalid credentials or incompatible codecs.
