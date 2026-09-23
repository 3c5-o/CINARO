import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(root, "web");
const adminRoot = path.join(root, "admin");
const errors = [];
const ok = (condition, message) => { if (!condition) errors.push(message); };

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
ok(html.includes('src="firebase.js" type="module"'), "HTML must load Firebase as a module");
ok(html.includes('id="authView"'), "HTML must include the authentication view");
ok(html.includes('id="serviceGate"'), "User app must include the maintenance/update gate");
ok(html.includes('id="reportForm"'), "User app must include playback reports");
ok(html.includes('id="previousEpisodeButton"'), "Player must include a previous-episode control");
ok(html.includes('hls.js@1.7.3/dist/hls.min.js'), "Player must load the pinned HLS.js runtime");
ok(html.includes("worker-src 'self' blob:"), "CSP must allow the HLS.js worker blob");

const adminHtml = fs.readFileSync(path.join(adminRoot, "index.html"), "utf8");
const adminIds = [...adminHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateAdminIds = adminIds.filter((id, index) => adminIds.indexOf(id) !== index);
ok(duplicateAdminIds.length === 0, `Duplicate admin HTML IDs: ${[...new Set(duplicateAdminIds)].join(", ")}`);
ok(adminHtml.includes('dir="rtl"'), "Admin HTML must use RTL direction");
ok(adminHtml.includes('src="firebase.js" type="module"'), "Admin HTML must load Firebase as a module");
ok(adminHtml.includes('id="adminLoginForm"'), "Admin HTML must include the admin login form");
ok(adminHtml.includes('id="mobileNav"'), "Admin HTML must include mobile navigation");
ok(adminHtml.includes('id="seasonBuilder"'), "Admin must include the visual season builder");
ok(adminHtml.includes('id="reportsTable"'), "Admin must include reports management");
ok(!adminHtml.includes('id="contentSeasons"'), "Admin must not require JSON season editing");

const adminAppSource = fs.readFileSync(path.join(adminRoot, "app.js"), "utf8");
ok(adminAppSource.includes("function inferMediaType("), "Admin must infer MP4/HLS media types");
ok(adminAppSource.includes("backupUrl"), "Admin episode editor must preserve backup sources");
ok(adminAppSource.includes("subtitleUrl"), "Admin episode editor must preserve subtitles");
ok(adminAppSource.includes("extraSources: sources.slice(2)"), "Admin must preserve additional episode sources");
ok(adminAppSource.includes("extraSubtitles: subtitles.slice(1)"), "Admin must preserve additional episode subtitles");
ok(adminAppSource.includes("thumbnail: validMediaUrl(episode.thumbnail"), "Admin must preserve episode thumbnails");

const adminStyles = fs.readFileSync(path.join(adminRoot, "styles.css"), "utf8");
ok(adminStyles.includes('inset-inline-start: 0'), "Admin sidebar must use logical RTL positioning");
ok(!adminStyles.includes('inset: 0 auto 0 0'), "Admin mobile sidebar must not mix physical and logical positioning");
ok(adminStyles.includes('visibility: hidden'), "Closed admin sidebar must be visually hidden on mobile");
ok(adminStyles.includes('@media (max-width: 520px)'), "Admin dashboard must include a narrow-phone layout");

const adminManifest = JSON.parse(fs.readFileSync(path.join(adminRoot, "manifest.webmanifest"), "utf8"));
for (const icon of adminManifest.icons || []) {
  ok(fs.existsSync(path.join(adminRoot, icon.src)), `Admin manifest icon missing: ${icon.src}`);
}
ok(adminHtml.includes('assets/icons/icon-192.png'), "Admin interface must use its dedicated icon");

const androidActivity = fs.readFileSync(path.join(root, "android-app", "app", "src", "main", "java", "com", "cinaro", "app", "MainActivity.java"), "utf8");
ok(androidActivity.includes('settings.setLoadWithOverviewMode(false)'), "Android WebView must not shrink the app into a wide overview");
ok(androidActivity.includes('WindowManager.LayoutParams.FLAG_SECURE'), "Android user edition must support secure-screen protection");
const androidManifest = fs.readFileSync(path.join(root, "android-app", "app", "src", "main", "AndroidManifest.xml"), "utf8");
ok(androidManifest.includes('android:allowBackup="false"'), "Android app data backups must be disabled");
const androidBuild = fs.readFileSync(path.join(root, "android-app", "app", "build.gradle"), "utf8");
ok(androidBuild.includes('buildConfigField "boolean", "BLOCK_SCREEN_CAPTURE", "true"'), "User Android flavor must block screen capture");
ok(androidBuild.includes('buildConfigField "boolean", "BLOCK_SCREEN_CAPTURE", "false"'), "Admin Android flavor must keep normal screen capture behavior");
ok(fs.existsSync(path.join(root, "android-app", "app", "src", "admin", "res", "mipmap-xxxhdpi", "ic_launcher.png")), "Admin Android flavor must have a dedicated launcher icon");

const firebaseSource = fs.readFileSync(path.join(webRoot, "firebase.js"), "utf8");
ok(firebaseSource.includes('projectId: "cinaro"'), "Firebase project ID must be cinaro");
ok(firebaseSource.includes('authDomain: "cinaro.firebaseapp.com"'), "Firebase auth domain is missing");
ok(!firebaseSource.includes("\\\\_"), "Firebase config contains an escaped underscore");
ok(!firebaseSource.includes("\\\\:"), "Firebase config contains an escaped colon");
ok(fs.existsSync(path.join(root, "firestore.rules")), "Missing Firestore security rules");
ok(fs.existsSync(path.join(root, "firebase.json")), "Missing Firebase deployment config");
const firestoreRules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
ok(firestoreRules.includes("uniqueViewIncrement"), "Firestore rules must protect unique view increments");
ok(firestoreRules.includes("supervisorCanPublish"), "Firestore rules must enforce supervisor publishing permissions");
ok(firestoreRules.includes("match /reports/{reportId}"), "Firestore rules must protect user reports");
ok(firestoreRules.includes("request.resource.data.details.size() <= 600"), "Firestore rules must bound report detail size");
ok(firestoreRules.includes("request.resource.data.sourceUrl.size() <= 2048"), "Firestore rules must bound report source URLs");
ok(!firestoreRules.includes("allow read, write: if true"), "Firestore rules must never allow unrestricted global read/write");
ok(
  firestoreRules.includes("match /{document=**}") && firestoreRules.includes("allow read, write: if false"),
  "Firestore rules must keep a default-deny fallback"
);

const appSource = fs.readFileSync(path.join(webRoot, "app.js"), "utf8");
ok(appSource.includes("function previousEpisode("), "Player must resolve previous episodes");
ok(appSource.includes("function releasePlayerMedia("), "Player must release video resources when leaving playback");
ok(appSource.includes("$('track[data-cinaro-track=\"true\"]', player.video).forEach"), "Player teardown must remove all dynamic subtitle tracks");
ok(appSource.includes("function isHlsSource("), "Player must detect HLS sources");
ok(appSource.includes("HlsRuntime?.isSupported?.()"), "Player must use HLS.js when MediaSource playback is available");
ok(appSource.includes("hls.recoverMediaError()"), "Player must attempt HLS media recovery");
ok(
  /if \(replace\) \{\s*window\.history\.replaceState\([^;]+;\s*renderRoute\(\);/m.test(appSource),
  "Route replacement must immediately render the new route"
);
ok(appSource.includes("clearInterval(player.endedTimer)"), "Autoplay countdown must be cleared as an interval");

const adminFirebaseSource = fs.readFileSync(path.join(adminRoot, "firebase.js"), "utf8");
ok(adminFirebaseSource.includes('projectId: "cinaro"'), "Admin Firebase project ID must be cinaro");
ok(adminFirebaseSource.includes('adminEmail: ADMIN_EMAIL'), "Admin Firebase client must expose the allowlisted email");
ok(!adminFirebaseSource.match(/password\s*:\s*["']/i), "Admin Firebase client must not contain a password");
ok(adminFirebaseSource.includes('role = "supervisor"'), "Admin Firebase must support assigned supervisors");

const androidWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "android-apk.yml"), "utf8");
ok(androidWorkflow.includes("CINARO_KEYSTORE_BASE64"), "Android workflow must support the stable signing keystore");
ok(androidWorkflow.includes("apksigner\" verify --verbose --print-certs"), "Android workflow must verify and print APK certificates");

const serviceWorker = fs.readFileSync(path.join(webRoot, "sw.js"), "utf8");
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
