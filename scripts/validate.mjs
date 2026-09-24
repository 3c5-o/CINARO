import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(root, "web");
const adminRoot = path.join(root, "admin");
const errors = [];
const ok = (condition, message) => { if (!condition) errors.push(message); };

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const expectedVersion = packageJson.version;
ok(expectedVersion === "2.3.2", "Package version must be CINARO 2.3.2");

const requiredFiles = [
  "index.html",
  "styles.css",
  "data.js",
  "firebase.js",
  "app.js",
  "sw.js",
  "manifest.webmanifest",
  "offline.html",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/images/cinaro-hero.webp",
  "assets/images/poster-placeholder.webp"
];

const requiredAdminFiles = [
  "index.html",
  "styles.css",
  "firebase.js",
  "app.js",
  "sw.js",
  "manifest.webmanifest",
  "assets/admin-hero.svg",
  "assets/icons/favicon-32.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png"
];

for (const file of requiredFiles) {
  ok(fs.existsSync(path.join(webRoot, file)), `Missing required web file: ${file}`);
}

for (const file of requiredAdminFiles) {
  ok(fs.existsSync(path.join(adminRoot, file)), `Missing required admin file: ${file}`);
}

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(webRoot, "data.js"), "utf8"), sandbox, { filename: "data.js" });
const data = sandbox.window.CINARO_DATA;
ok(data && Array.isArray(data.items), "CINARO_DATA.items must be an array");

if (data?.items) {
  const ids = data.items.map((item) => item.id);
  ok(new Set(ids).size === ids.length, "Content IDs must be unique");
  ok(data.version >= 2, "Production data version must be 2 or newer");

  for (const item of data.items) {
    ok(typeof item.id === "string" && /^[a-z0-9-]+$/.test(item.id), `Invalid item ID: ${item.id}`);
    ok(["movie", "series"].includes(item.kind), `Invalid kind for ${item.id}`);
    ok(typeof item.title === "string" && item.title.trim().length > 0, `Missing title for ${item.id}`);
    ok(Array.isArray(item.genres) && item.genres.length > 0, `Missing genres for ${item.id}`);
    ok(Boolean(item.poster) && Boolean(item.backdrop), `Missing artwork for ${item.id}`);

    const mediaEntries = item.kind === "movie"
      ? [{ label: item.id, sources: item.sources }]
      : (item.seasons || []).flatMap((season) => (season.episodes || []).map((episode) => ({
          label: `${item.id}/s${season.number}/e${episode.number}`,
          sources: episode.sources
        })));

    if (item.kind === "series") {
      ok(Array.isArray(item.seasons) && item.seasons.length > 0, `Series has no seasons: ${item.id}`);
      const episodeKeys = mediaEntries.map((entry) => entry.label);
      ok(new Set(episodeKeys).size === episodeKeys.length, `Duplicate episode numbers in ${item.id}`);
    }

    for (const media of mediaEntries) {
      ok(Array.isArray(media.sources) && media.sources.length > 0, `No video source for ${media.label}`);
      for (const source of media.sources || []) {
        ok(typeof source.url === "string" && (/^https:\/\//.test(source.url) || /^assets\//.test(source.url)), `Unsafe video URL in ${media.label}`);
      }
    }
  }

  for (const featuredId of data.featured || []) {
    ok(ids.includes(featuredId), `Featured content does not exist: ${featuredId}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(webRoot, "manifest.webmanifest"), "utf8"));
ok(manifest.name?.includes("CINARO"), "Manifest name must include CINARO");
ok(manifest.display === "standalone", "Manifest display must be standalone");
ok(manifest.start_url?.startsWith("./"), "Manifest start_url must be relative for GitHub Pages");

for (const icon of manifest.icons || []) {
  ok(fs.existsSync(path.join(webRoot, icon.src)), `Manifest icon missing: ${icon.src}`);
}

const html = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);
ok(duplicateIds.length === 0, `Duplicate HTML IDs: ${[...new Set(duplicateIds)].join(", ")}`);
ok(html.includes('dir="rtl"'), "HTML must use RTL direction");
ok(html.includes('rel="manifest"'), "HTML must link the web manifest");
ok(html.includes(`src="firebase.js?v=${expectedVersion}" type="module"`), "HTML must cache-bust Firebase with the current version");
ok(html.includes('id="authView"'), "HTML must include the authentication view");
ok(html.includes('id="serviceGate"'), "User app must include the maintenance/update gate");
ok(html.includes('id="reportForm"'), "User app must include playback reports");
ok(html.includes('id="requestSheet"'), "User app must include the content request sheet");
ok(html.includes('id="requestForm"'), "User app must include the content request form");
ok(html.includes('id="requestContentButton"'), "User settings must expose the content request flow");
ok(html.includes('id="previousEpisodeButton"'), "Player must include a previous-episode control");
ok(html.includes('hls.js@1.7.3/dist/hls.min.js'), "Player must load the pinned HLS.js runtime");
ok(html.includes("worker-src 'self' blob:"), "CSP must allow the HLS.js worker blob");

const adminHtml = fs.readFileSync(path.join(adminRoot, "index.html"), "utf8");
const adminIds = [...adminHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateAdminIds = adminIds.filter((id, index) => adminIds.indexOf(id) !== index);
ok(duplicateAdminIds.length === 0, `Duplicate admin HTML IDs: ${[...new Set(duplicateAdminIds)].join(", ")}`);
ok(adminHtml.includes('dir="rtl"'), "Admin HTML must use RTL direction");
ok(adminHtml.includes(`src="firebase.js?v=${expectedVersion}" type="module"`), "Admin HTML must cache-bust Firebase with the current version");
ok(adminHtml.includes('id="adminLoginForm"'), "Admin HTML must include the admin login form");
ok(adminHtml.includes('id="mobileNav"'), "Admin HTML must include mobile navigation");
ok(adminHtml.includes('id="seasonBuilder"'), "Admin must include the visual season builder");
ok(adminHtml.includes('id="reportsTable"'), "Admin must include reports management");
ok(!adminHtml.includes('id="contentSeasons"'), "Admin must not require JSON season editing");
ok(adminHtml.includes('id="view-requests"'), "Admin must include the content request view");
ok(adminHtml.includes('id="requestStatusFilter"'), "Admin must include request status filtering");
ok(adminHtml.includes('id="requestsTable"'), "Admin must include the request management table");
ok(adminHtml.includes('hls.js@1.7.3/dist/hls.min.js'), "Admin must load the pinned HLS.js runtime");
ok(adminHtml.includes('id="tmdbImportPanel"'), "Admin editor must expose TMDb import");
ok(adminHtml.includes('id="tmdbSettingsForm"'), "Admin settings must expose TMDb token controls");
ok(adminHtml.includes('data-import-mode="manual"'), "Admin editor must preserve manual content entry");
ok(adminHtml.includes('data-import-mode="tmdb"'), "Admin editor must offer TMDb import mode");
ok(adminHtml.includes('id="tmdbTokenInput"'), "Admin settings must include the TMDb token input");
ok(adminHtml.includes('data-action="new-tmdb" data-kind="movie"'), "Admin content page must include a TMDb movie button");
ok(adminHtml.includes('data-action="new-tmdb" data-kind="series"'), "Admin content page must include a TMDb series button");
ok(adminHtml.includes('data-view="settings">إعداد TMDb</button>'), "TMDb importer must link directly to token settings");
ok(adminHtml.includes("This product uses the TMDB API but is not endorsed or certified by TMDB."), "Admin must include TMDb attribution");

const adminAppSource = fs.readFileSync(path.join(adminRoot, "app.js"), "utf8");
ok(adminAppSource.includes("function destroyPreviewHls("), "Admin must tear down HLS previews");
ok(adminAppSource.includes("HlsRuntime?.isSupported?.()"), "Admin must explicitly preview HLS sources");
ok(adminAppSource.includes("function renderRequests("), "Admin must render content requests");
ok(adminAppSource.includes('listen("contentRequests", "requests"'), "Admin must listen to content requests");
ok(adminAppSource.includes("function saveContentRequest("), "Admin must update request statuses");
ok(adminAppSource.includes('document.querySelectorAll("[data-request-select]")'), "Admin request status control must use a CSS selector query");
ok(adminAppSource.includes('document.querySelectorAll("[data-request-note]")'), "Admin request note control must use a CSS selector query");
ok(!adminAppSource.includes('const statusControl = $("[data-request-select]")'), "Admin must not pass CSS selectors to the ID helper");
ok(adminAppSource.includes("function inferMediaType("), "Admin must infer MP4/HLS media types");
ok(adminAppSource.includes("backupUrl"), "Admin episode editor must preserve backup sources");
ok(adminAppSource.includes("subtitleUrl"), "Admin episode editor must preserve subtitles");
ok(adminAppSource.includes("extraSources: sources.slice(2)"), "Admin must preserve additional episode sources");
ok(adminAppSource.includes("extraSubtitles: subtitles.slice(1)"), "Admin must preserve additional episode subtitles");
ok(adminAppSource.includes("existingMovieSources.slice(2)"), "Admin must preserve additional movie sources");
ok(adminAppSource.includes("existingMovieSubtitles.slice(1)"), "Admin must preserve additional movie subtitles");
ok(adminAppSource.includes("thumbnail: validMediaUrl(episode.thumbnail"), "Admin must preserve episode thumbnails");
ok(adminAppSource.includes("client.listenContentForSections("), "Supervisors must use the scoped content listener");
ok(adminAppSource.includes('TMDB_STORAGE_KEY = "cinaro:admin:tmdb-token:v1"'), "Admin must keep the TMDb token in admin-local storage");
ok(adminAppSource.includes('TMDB_API_ROOT = "https://api.themoviedb.org/3"'), "Admin TMDb client must target API v3");
ok(adminAppSource.includes('tmdbRequest("/configuration")'), "TMDb integration must load API configuration");
ok(adminAppSource.includes('"/search/movie"'), "TMDb integration must support movie search");
ok(adminAppSource.includes('"/search/tv"'), "TMDb integration must support TV search");
ok(adminAppSource.includes("Authorization:"), "TMDb integration must send Bearer authorization");
ok(adminAppSource.includes("function fetchTmdbSeriesSeasons("), "TMDb integration must import TV seasons and episodes");
ok(adminAppSource.includes("contentTmdbId"), "Admin must retain TMDb content IDs");
ok(adminAppSource.includes("const willPublish ="), "Admin must distinguish drafts from publish-time media requirements");
ok(adminAppSource.includes("window.CINARO_HANDLE_BACK = handleNativeBack"), "Admin must handle Android back navigation in-app");
ok(adminAppSource.includes("function bindCopyProtection("), "Admin must prevent casual content copying");
ok(adminAppSource.split('$("[data-import-mode]")').length >= 3, "Admin TMDb mode buttons must use the selector helper in both bindings");
ok(adminAppSource.includes('$("[data-import-mode]")'), "Admin TMDb mode buttons must use the selector helper");
ok(adminAppSource.includes('function openNewContent('), "Admin must expose a reliable new-content launcher");
ok(adminAppSource.includes('action === "new-tmdb"'), "Admin must support direct TMDb movie/series actions");
ok(adminAppSource.includes(`sw.js?v=${expectedVersion}`), "Admin must cache-bust service worker registration");
ok(adminAppSource.includes('if (!window.CinaroNative && "serviceWorker" in navigator'), "Admin Android wrapper must not register a PWA service worker");

const adminStyles = fs.readFileSync(path.join(adminRoot, "styles.css"), "utf8");
ok(adminStyles.includes('inset-inline-start: 0'), "Admin sidebar must use logical RTL positioning");
ok(!adminStyles.includes('inset: 0 auto 0 0'), "Admin mobile sidebar must not mix physical and logical positioning");
ok(adminStyles.includes('visibility: hidden'), "Closed admin sidebar must be visually hidden on mobile");
ok(adminStyles.includes('@media (max-width: 520px)'), "Admin dashboard must include a narrow-phone layout");
ok(adminStyles.includes(".tmdb-results"), "Admin styles must include TMDb result cards");
ok(adminStyles.includes("user-select: none"), "Admin must disable casual text selection outside form fields");
ok(adminStyles.includes("touch-action: manipulation"), "Admin interactive controls must use reliable mobile tap behavior");

const adminManifest = JSON.parse(fs.readFileSync(path.join(adminRoot, "manifest.webmanifest"), "utf8"));
for (const icon of adminManifest.icons || []) {
  ok(fs.existsSync(path.join(adminRoot, icon.src)), `Admin manifest icon missing: ${icon.src}`);
}
ok(adminHtml.includes('assets/icons/icon-192.png'), "Admin interface must use its dedicated icon");

const androidActivity = fs.readFileSync(path.join(root, "android-app", "app", "src", "main", "java", "com", "cinaro", "app", "MainActivity.java"), "utf8");
ok(androidActivity.includes('settings.setLoadWithOverviewMode(false)'), "Android WebView must not shrink the app into a wide overview");
ok(androidActivity.includes('WindowManager.LayoutParams.FLAG_SECURE'), "Android user edition must support secure-screen protection");
ok(androidActivity.includes(`CINARO/${expectedVersion} AndroidApp`), "Android user agent must match the package version");
ok(androidActivity.includes('addJavascriptInterface(new NativeBridge(), "CinaroNative")'), "Android must expose the CINARO native bridge");
ok(androidActivity.includes("enterPictureInPictureMode"), "Android must support native picture-in-picture");
ok(androidActivity.includes("CINARO_HANDLE_BACK"), "Android back must delegate to the web app first");
ok(androidActivity.includes("SCREEN_ORIENTATION_PORTRAIT"), "Android must restore portrait outside fullscreen playback");
ok(androidActivity.includes('getSharedPreferences("cinaro_runtime"'), "Android must track installed version for fresh-shell upgrades");
ok(androidActivity.includes("webView.clearCache(true)"), "Android must clear HTTP/WebView cache after app version upgrades");
ok(androidActivity.includes("lastVersionCode != BuildConfig.VERSION_CODE"), "Android cache clearing must only run when the app version changes");
ok(androidActivity.includes("navigator.serviceWorker.getRegistrations()"), "Android upgrades must unregister stale service workers");
ok(androidActivity.includes("caches.keys()"), "Android upgrades must clear stale CacheStorage entries");
ok(androidActivity.includes("refreshAfterUpgrade"), "Android must reload once after upgrade cache cleanup");
const androidManifest = fs.readFileSync(path.join(root, "android-app", "app", "src", "main", "AndroidManifest.xml"), "utf8");
ok(androidManifest.includes('android:allowBackup="false"'), "Android app data backups must be disabled");
ok(androidManifest.includes('android:supportsPictureInPicture="true"'), "Android manifest must enable picture-in-picture");
ok(androidManifest.includes('android:screenOrientation="portrait"'), "Android app must default to portrait orientation");
const androidBuild = fs.readFileSync(path.join(root, "android-app", "app", "build.gradle"), "utf8");
ok(androidBuild.includes('buildConfigField "boolean", "BLOCK_SCREEN_CAPTURE", "true"'), "User Android flavor must block screen capture");
ok(androidBuild.includes('buildConfigField "boolean", "BLOCK_SCREEN_CAPTURE", "false"'), "Admin Android flavor must keep normal screen capture behavior");
ok(androidBuild.includes(`versionName "${expectedVersion}"`), "Android versionName must match package.json");
ok(androidBuild.includes('versionCode 9'), "Android versionCode must be 9 for CINARO 2.3.2");
ok(fs.existsSync(path.join(root, "android-app", "app", "src", "admin", "res", "mipmap-xxxhdpi", "ic_launcher.png")), "Admin Android flavor must have a dedicated launcher icon");

const firebaseSource = fs.readFileSync(path.join(webRoot, "firebase.js"), "utf8");
ok(firebaseSource.includes('projectId: "cinaro"'), "Firebase project ID must be cinaro");
ok(firebaseSource.includes('authDomain: "cinaro.firebaseapp.com"'), "Firebase auth domain is missing");
ok(!firebaseSource.includes("\\\\_"), "Firebase config contains an escaped underscore");
ok(!firebaseSource.includes("\\\\:"), "Firebase config contains an escaped colon");
ok(fs.existsSync(path.join(root, "firestore.rules")), "Missing Firestore security rules");
ok(fs.existsSync(path.join(root, "firebase.json")), "Missing Firebase deployment config");
const firestoreRules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
ok(firestoreRules.includes("function activeUser()"), "Firestore rules must define blocked-account enforcement");
ok(firestoreRules.includes("data.get('status', 'active')"), "Blocked-account rules must safely handle users without a status field");
ok(firestoreRules.includes("uniqueViewIncrement"), "Firestore rules must protect unique view increments");
ok(firestoreRules.includes("supervisorCanPublish"), "Firestore rules must enforce supervisor publishing permissions");
ok(firestoreRules.includes("supervisorCanReadContent"), "Firestore rules must scope supervisor content reads");
ok(firestoreRules.includes("data.sectionIds.hasAny(currentAssignment().data.sectionIds)"), "Supervisor reads must intersect assigned section IDs");
ok(!firestoreRules.includes("|| supervisor();"), "Firestore content reads must not grant supervisors blanket access");
ok(firestoreRules.includes("supervisorCanCreateContent"), "Firestore rules must constrain supervisor content creation");
ok(firestoreRules.includes("supervisorCanUpdateContent"), "Firestore rules must constrain supervisor content updates");
ok(firestoreRules.includes("data.views == 0"), "Supervisor-created content must start with zero views");
ok(firestoreRules.includes("data.get('published', false) == false"), "Supervisor content creation must honor publish permission");
ok(firestoreRules.includes("allow write: if admin() || (owner(userId) && activeUser())"), "Blocked users must not write private synced state");
ok(firestoreRules.includes("request.resource.data.get('views', 0) == resource.data.get('views', 0)"), "Supervisors must not change view counters");
ok(firestoreRules.includes("match /contentRequests/{requestId}"), "Firestore rules must protect content requests");
ok(firestoreRules.includes("request.resource.data.status == 'new'"), "Users must only create requests in the new state");
ok(firestoreRules.includes("allow update, delete: if admin()"), "Only admins may update or delete content requests");
ok(firestoreRules.includes("match /reports/{reportId}"), "Firestore rules must protect user reports");
ok(firestoreRules.includes("request.resource.data.details.size() <= 600"), "Firestore rules must bound report detail size");
ok(firestoreRules.includes("request.resource.data.sourceUrl.size() <= 2048"), "Firestore rules must bound report source URLs");
ok(!firestoreRules.includes("allow read, write: if true"), "Firestore rules must never allow unrestricted global read/write");
ok(
  firestoreRules.includes("match /{document=**}") && firestoreRules.includes("allow read, write: if false"),
  "Firestore rules must keep a default-deny fallback"
);

const appSource = fs.readFileSync(path.join(webRoot, "app.js"), "utf8");
ok(appSource.includes(`const APP_VERSION = "${expectedVersion}"`), "Web app version must match package.json");
ok(appSource.includes("function previousEpisode("), "Player must resolve previous episodes");
ok(appSource.includes("function renderRequestList("), "User app must render request history");
ok(appSource.includes("state.firebase.submitContentRequest"), "User app must submit content requests through Firebase");
ok(appSource.includes("state.firebase.listenMyRequests"), "User app must listen to the signed-in user's requests");
ok(appSource.includes("function releasePlayerMedia("), "Player must release video resources when leaving playback");
ok(appSource.includes("player.video.querySelectorAll('track[data-cinaro-track=\"true\"]').forEach"), "Player teardown must remove all dynamic subtitle tracks");
ok(appSource.includes("function isHlsSource("), "Player must detect HLS sources");
ok(appSource.includes("HlsRuntime?.isSupported?.()"), "Player must use HLS.js when MediaSource playback is available");
ok(appSource.includes("hls.recoverMediaError()"), "Player must attempt HLS media recovery");
ok(
  /if \(replace\) \{\s*window\.history\.replaceState\([^;]+;\s*renderRoute\(\);/m.test(appSource),
  "Route replacement must immediately render the new route"
);
ok(appSource.includes("clearInterval(player.endedTimer)"), "Autoplay countdown must be cleared as an interval");
ok(appSource.includes("function requestPortraitMode("), "Player must restore portrait after playback");
ok(appSource.includes("window.CinaroNative?.requestPortrait?.()"), "Web player must request native portrait restore");
ok(appSource.includes("window.CinaroNative.enterPictureInPicture()"), "Web player must use native Android PiP when available");
ok(appSource.includes("window.CINARO_HANDLE_BACK = handleBackNavigation"), "User app must expose in-app Android back handling");
ok(appSource.includes("function bindCopyProtection("), "User app must prevent casual content copying");
ok(appSource.includes(`sw.js?v=${expectedVersion}`), "User app must cache-bust service worker registration");
ok(appSource.includes("if (window.CinaroNative) return;"), "User Android wrapper must not register a PWA service worker");
ok(!appSource.includes('["pointermove", "pointerdown"]'), "Player must not reveal controls on every pointerdown");
ok(appSource.includes('event.pointerType === "mouse"'), "Player must only auto-reveal controls on mouse movement");
ok(appSource.includes('storage.get(STORAGE.authChoice, "") === "account"'), "Saved accounts must not be replaced with guest mode while auth restores");
ok(html.includes("This product uses the TMDB API but is not endorsed or certified by TMDB."), "User app must include TMDb attribution");
const webStyles = fs.readFileSync(path.join(webRoot, "styles.css"), "utf8");
ok(webStyles.includes("user-select: none"), "User app must disable casual content selection");
ok(webStyles.includes("-webkit-touch-callout: none"), "User app must disable long-press content callouts");
ok(webStyles.includes("touch-action: manipulation"), "User interactive controls must use reliable mobile tap behavior");

const userFirebaseSource = fs.readFileSync(path.join(webRoot, "firebase.js"), "utf8");
ok(userFirebaseSource.includes("submitContentRequest: async function"), "Firebase client must support request submission");
ok(userFirebaseSource.includes("listenMyRequests: function"), "Firebase client must support request history");
ok(userFirebaseSource.includes(`app_version: "${expectedVersion}"`), "Firebase analytics version must match package.json");
ok(userFirebaseSource.includes(`minimumVersion: textValue(data.minimumVersion, "${expectedVersion}"`), "Firebase minimum-version fallback must match package.json");
ok(userFirebaseSource.includes('where("userId", "==", user.uid)'), "Request history must be scoped to the signed-in user");
ok(userFirebaseSource.includes("browserLocalPersistence"), "Firebase Auth must persist signed-in accounts across app restarts");

const adminFirebaseSource = fs.readFileSync(path.join(adminRoot, "firebase.js"), "utf8");
ok(adminFirebaseSource.includes('projectId: "cinaro"'), "Admin Firebase project ID must be cinaro");
ok(adminFirebaseSource.includes('adminEmail: ADMIN_EMAIL'), "Admin Firebase client must expose the allowlisted email");
ok(!adminFirebaseSource.match(/password\s*:\s*["']/i), "Admin Firebase client must not contain a password");
ok(adminFirebaseSource.includes('role = "supervisor"'), "Admin Firebase must support assigned supervisors");
ok(adminFirebaseSource.includes("listenContentForSections: function"), "Admin Firebase must expose a scoped supervisor listener");
ok(adminFirebaseSource.includes('where("sectionIds", "array-contains-any", safeSections)'), "Supervisor content listener must query assigned sections");

const androidWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "android-apk.yml"), "utf8");
ok(androidWorkflow.includes("CINARO_KEYSTORE_BASE64"), "Android workflow must support the stable signing keystore");
ok(androidWorkflow.includes("apksigner\" verify --verbose --print-certs"), "Android workflow must verify and print APK certificates");
ok(androidWorkflow.includes(`CINARO-User-v${expectedVersion}.apk`), "Android workflow user APK name must match package.json");
ok(androidWorkflow.includes(`CINARO-Admin-v${expectedVersion}.apk`), "Android workflow admin APK name must match package.json");
ok(androidWorkflow.includes(`TAG="v${expectedVersion}"`), "Android workflow release tag must match package.json");
ok(!androidWorkflow.includes("v2.1.0"), "Android workflow must not publish stale 2.1.0 artifacts");

const firebaseRulesWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "firebase-rules.yml"), "utf8");
ok(firebaseRulesWorkflow.includes("firebase-tools@latest deploy --only firestore:rules"), "Firebase rules workflow must deploy Firestore rules");
ok(firebaseRulesWorkflow.includes("FIREBASE_SERVICE_ACCOUNT_CINARO"), "Firebase rules workflow must support a service-account secret");
ok(firebaseRulesWorkflow.includes("FIREBASE_TOKEN"), "Firebase rules workflow must support a Firebase token fallback");

const serviceWorker = fs.readFileSync(path.join(webRoot, "sw.js"), "utf8");
const adminServiceWorker = fs.readFileSync(path.join(adminRoot, "sw.js"), "utf8");
ok(serviceWorker.includes(`cinaro-v${expectedVersion}`), "User service worker cache version must match package version");
ok(serviceWorker.includes("networkFirstAsset"), "User service worker must fetch scripts/styles network-first");
ok(adminServiceWorker.includes(`cinaro-admin-v${expectedVersion}`), "Admin service worker cache version must match package version");
ok(adminServiceWorker.includes('fetch(request, { cache: "no-store" })'), "Admin service worker must bypass cache for navigation and core assets");
ok(html.includes(`styles.css?v=${expectedVersion}`) && html.includes(`app.js?v=${expectedVersion}`), "User shell must cache-bust CSS and app JS");
ok(adminHtml.includes(`styles.css?v=${expectedVersion}`) && adminHtml.includes(`app.js?v=${expectedVersion}`), "Admin shell must cache-bust CSS and app JS");
for (const requiredFile of requiredFiles.filter((file) => !["sw.js"].includes(file))) {
  if (["assets/images/poster-placeholder.webp", "assets/images/cinaro-hero.webp"].includes(requiredFile) || !requiredFile.startsWith("assets/")) {
    ok(serviceWorker.includes(requiredFile), `Service worker shell does not reference: ${requiredFile}`);
  }
}

if (errors.length) {
  console.error(`CINARO validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`CINARO validation passed: ${data.items.length} local titles, ${requiredFiles.length} web files and ${requiredAdminFiles.length} admin files.`);
