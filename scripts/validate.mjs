import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
  } else {
    console.log("PASS:", message);
  }
}

const webHtml = read("web/index.html");
const webApp = read("web/app.js");
const webSupabase = read("web/supabase.js");
const webStyles = read("web/styles.css");
const webSw = read("web/sw.js");
const adminHtml = read("admin/index.html");
const adminApp = read("admin/app.js");
const adminSupabase = read("admin/supabase.js");
const adminStyles = read("admin/styles.css");
const adminSw = read("admin/sw.js");
const buildGradle = read("android-app/app/build.gradle");
const workflow = read(".github/workflows/android-apk.yml");
const packageJson = JSON.parse(read("package.json"));

assert(packageJson.version === "2.6.0", "package version is 2.6.0");
assert(packageJson.scripts.test.includes("web/supabase.js"), "tests check user Supabase client");
assert(packageJson.scripts.test.includes("admin/supabase.js"), "tests check admin Supabase client");
assert(!packageJson.scripts.test.includes("firebase.js"), "test command no longer depends on Firebase");

assert(webHtml.includes('supabase.js?v=2.6.0'), "user shell loads Supabase 2.6 client");
assert(adminHtml.includes('supabase.js?v=2.6.0'), "admin shell loads Supabase 2.6 client");
assert(!webHtml.includes('firebase.js'), "user shell does not load Firebase");
assert(!adminHtml.includes('firebase.js'), "admin shell does not load Firebase");
assert(webHtml.includes('id="serviceGate"'), "user app has blocking service gate");
assert(webHtml.includes('id="serviceGateAction"'), "forced update gate has update action");
assert(webHtml.includes('data-route="search" class="nav-search"'), "user mobile navigation includes central search");

assert(webApp.includes('const WEB_APP_VERSION = "2.6.0"'), "user runtime version is 2.6.0");
assert(webApp.includes("URL_APP_VERSION"), "user runtime reads APK version from URL");
assert(webApp.includes("NATIVE_APP_VERSION"), "user runtime can read native version");
assert(webApp.includes("updateAvailable"), "forced update checks latest version");
assert(webApp.includes("state.remoteConfig.forceUpdate !== false"), "forced update defaults to enabled");
assert(webApp.includes("cinaro:supabase-ready"), "user app listens for Supabase readiness");
assert(!webApp.includes("cinaro:firebase-ready"), "user app no longer listens for Firebase readiness");

assert(adminApp.includes("cinaro:admin-supabase-ready"), "admin app listens for Supabase readiness");
assert(adminApp.includes("settingUpdateReleasedAt"), "admin manages update release timestamp");
assert(adminApp.includes("settingOldVersionShutdownAt"), "admin manages old-version shutdown timestamp");
assert(adminApp.includes("7 * 24 * 60 * 60 * 1000"), "admin defaults old-version shutdown to seven days");
assert(adminHtml.includes('id="settingUpdateReleasedAt"'), "admin UI exposes update release time");
assert(adminHtml.includes('id="settingOldVersionShutdownAt"'), "admin UI exposes seven-day shutdown time");
assert(adminHtml.includes("dashboard-quick-actions"), "admin dashboard includes quick actions");
assert(adminHtml.includes("system-live-pill"), "admin topbar includes live system status");

for (const [name, source] of [["user", webSupabase], ["admin", adminSupabase]]) {
  assert(source.includes("@supabase/supabase-js@2.117.2"), name + " client pins Supabase JS");
  assert(source.includes("sb_publishable_"), name + " client uses publishable key");
  assert(!/service_role|sb_secret_/i.test(source), name + " client contains no service-role or secret key");
  assert(source.includes("zmkkoggsqvwvwkanlyux.supabase.co"), name + " client targets CINARO Supabase project");
}

assert(webSupabase.includes('from("content_requests")'), "user requests use Supabase");
assert(webSupabase.includes('from("reports")'), "user reports use Supabase");
assert(webSupabase.includes('from("user_states")'), "favorites/history use Supabase");
assert(webSupabase.includes('signInWithPassword'), "user login uses Supabase Auth");
assert(webSupabase.includes('signUp'), "user registration uses Supabase Auth");

assert(adminSupabase.includes('from("admin_memberships")'), "admin permissions use database memberships");
assert(adminSupabase.includes('from("audit_logs")'), "admin audit logging uses Supabase");
assert(adminSupabase.includes('from("account_status")'), "admin account blocking uses Supabase");
assert(adminSupabase.includes('listenContentForSections'), "admin supports scoped supervisor content");

assert(webStyles.includes("CINARO 2.6 — Aurora Cinema Design"), "Aurora Cinema user design system is present");
assert(adminStyles.includes("CINARO Admin 2.6 — Obsidian Control Design"), "Obsidian Control admin design system is present");
assert(webSw.includes('cinaro-v2.6.0'), "user PWA cache bumped");
assert(webSw.includes('"./supabase.js"'), "user PWA caches Supabase client");
assert(adminSw.includes('cinaro-admin-v2.6.0'), "admin PWA cache bumped");
assert(adminSw.includes('"./supabase.js"'), "admin PWA caches Supabase client");

assert(buildGradle.includes("versionCode 13"), "Android versionCode bumped");
assert(buildGradle.includes('versionName "2.6.0"'), "Android user version is 2.6.0");
assert(buildGradle.includes('versionName "2.6.0-admin"'), "Android admin version is 2.6.0-admin");
assert(buildGradle.includes("?v=2.6.0#home"), "user APK URL carries native release version");
assert(buildGradle.includes("?v=2.6.0#dashboard"), "admin APK URL carries native release version");

assert(workflow.includes("CINARO-User-v2.6.0.apk"), "workflow names user APK 2.6.0");
assert(workflow.includes("CINARO-Admin-v2.6.0.apk"), "workflow names admin APK 2.6.0");
assert(workflow.includes('TAG="v2.6.0"'), "workflow publishes v2.6.0");
assert(workflow.includes("CINARO_KEYSTORE_BASE64"), "stable signing secrets remain configured");

if (process.exitCode) {
  console.error("\nCINARO validation failed.");
  process.exit(process.exitCode);
}

console.log("\nCINARO 2.6 validation passed.");
