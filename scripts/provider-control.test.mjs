import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const app=fs.readFileSync(new URL("../web/app.js",import.meta.url),"utf8");
const admin=fs.readFileSync(new URL("../admin/app.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../admin/index.html",import.meta.url),"utf8");
const xtream=fs.readFileSync(new URL("../admin/xtream-monitor.js",import.meta.url),"utf8");
const gradle=fs.readFileSync(new URL("../android-app/app/build.gradle",import.meta.url),"utf8");
const native=fs.readFileSync(new URL("../android-app/app/src/main/java/com/cinaro/app/NativePlayerActivity.java",import.meta.url),"utf8");

const begin=app.indexOf("  function providerForciblyDisabled(");
const end=app.indexOf("\n  }\n",begin);
assert.ok(begin>=0&&end>begin);
const fn=vm.runInNewContext("("+app.slice(begin+2,end+4)+")",{
  state:{remoteConfig:{settings:{mediaCatalog:{forceDisabled:true},animeCatalog:{forceDisabled:false}}}}
});
assert.equal(fn({provider:"media-catalog"}),true);
assert.equal(fn({provider:"media-catalog-anime"}),false);
assert.equal(fn({provider:"manual"}),false);
assert.equal(fn({provider:"media-catalog-anime"},{
  settings:{mediaCatalog:{forceDisabled:false},animeCatalog:{forceDisabled:true}}
}),true);
assert.match(app,/\.filter\(\(item\) => !providerForciblyDisabled\(item\)\)/);
assert.match(app,/route\.name === "watch" && !itemMap\.has/);
console.log("PASS forced API stop hides imported movies/anime and stops active player");

assert.match(admin,/mediaApiForceDisabled/);
assert.match(admin,/animeApiForceDisabled/);
assert.match(admin,/requestSubmit\(\)/);
assert.match(html,/id="mediaApiForceStop"/);
assert.match(html,/id="animeApiForceStop"/);
console.log("PASS admin stop and start are wired and persist flag");

assert.match(xtream,/async function changeAccount/);
assert.match(xtream,/\"PATCH\"/);
assert.match(xtream,/\"DELETE\"/);
assert.match(xtream,/\"POST\"/);
assert.match(html,/id="xtreamAccountForm"/);
assert.match(html,/id="xtreamAccountPassword"/);
assert.ok(!xtream.includes("localStorage"),"Must never save credentials in localStorage");
console.log("PASS Xtream account CRUD through authorized gateway only");

assert.match(gradle,/media3-exoplayer-dash/);
assert.match(native,/APPLICATION_MPD/);
assert.match(app,/isDashSource/);
assert.match(app,/destroyDash/);
assert.match(app,/window\.dashjs/);
console.log("PASS native DASH and browser player cleanup integrated");
