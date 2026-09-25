# CINARO 2.5

CINARO is an Arabic-first movies and series application with separate **User** and **Admin** experiences. Version 2.5 moves the production data layer from Firebase to **Supabase** and introduces a new design system for both editions.

## Architecture

- **User PWA / APK:** `web/`
- **Admin PWA / APK:** `admin/`
- **Android wrapper:** `android-app/`
- **Backend:** Supabase Auth + PostgreSQL + RLS + Realtime + Cron
- **Playback:** HTML5/HLS player with existing CINARO playback controls
- **Metadata:** TMDb token remains local to the Admin app and is not stored in the public database

## Supabase project

Production project: **CINARO**

The clients use the project **publishable key only**. No Supabase secret/service-role key is committed to this repository.

Core database areas:

- `profiles`
- `account_status`
- `admin_memberships`
- `app_config`
- `sections`
- `content`
- `user_states`
- `content_requests`
- `reports`
- `content_views`
- `audit_logs`

Every exposed table has Row Level Security enabled. Administrative writes are authorized by database policies, not by hidden buttons in the UI.

## Roles

- **Owner / Admin:** full control.
- **Supervisor:** restricted to assigned management sections and explicit create/edit/delete/publish permissions.
- **User:** can read published content and manage only their own state, requests and reports.
- **Guest:** local mode is supported; Supabase anonymous auth is used when available.

## Mandatory updates

CINARO 2.5 uses a mandatory update gate.

- `latestVersion` controls the newest release.
- When the APK is older than `latestVersion`, CINARO blocks normal use and shows only **Update now**.
- The APK version is read from the Android URL version parameter / native identifier so an old APK cannot appear current merely because it loaded newer web files.
- `minimumVersion` is the final supported floor.
- The Admin app records the release date and an old-version shutdown deadline.
- Supabase Cron raises `minimumVersion` to `latestVersion` automatically after the configured deadline; the default release lifecycle in the Admin UI is seven days.

Maintenance mode remains separate and has priority over the update screen.

## Security

- Do not put Supabase secret keys in `web/`, `admin/`, APK assets, GitHub Pages, or client-side environment variables.
- RLS is the authorization boundary.
- User-controlled metadata is not used to authorize Admin access.
- Owner access is granted through `admin_memberships`; merely knowing an email address is not enough.
- Administrative operations are recorded in `audit_logs`.
- The Android signing workflow keeps using the existing GitHub repository secrets:
  - `CINARO_KEYSTORE_BASE64`
  - `CINARO_KEYSTORE_PASSWORD`
  - `CINARO_KEY_ALIAS`
  - `CINARO_KEY_PASSWORD`

## Local validation

Requires Node.js 20+:

```bash
npm test
```

The validation checks JavaScript syntax, Supabase client configuration, forced-update behavior, PWA cache versioning, Android versioning, and release workflow wiring.

## Android builds

Version 2.5.0 uses:

- User: `com.cinaro.app`
- Admin: `com.cinaro.admin`
- `versionCode 12`
- User version: `2.5.0`
- Admin version: `2.5.0-admin`

On pull requests, GitHub Actions builds test APKs. On `main`, the workflow uses the stable release signing secrets when available and publishes the CINARO 2.5.0 release.

## First Owner account

Supabase Auth starts independently from the old Firebase Auth database. The same CINARO Admin email/password can continue to be used, but the Auth account must first exist in Supabase. The Owner membership is then granted to that real Supabase user ID; passwords are never stored in this repository.
