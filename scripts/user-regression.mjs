import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const backend = fs.readFileSync(new URL("../web/supabase.js", import.meta.url), "utf8");

function extract(source, signature) {
  const start = source.indexOf("  " + signature);
  assert.ok(start >= 0, "missing implementation: " + signature);
  const end = source.indexOf("\n  }", start);
  assert.ok(end > start, "unterminated implementation: " + signature);
  return source.slice(start, end + 4).trim();
}

function evaluateFunction(source, signature, context) {
  return vm.runInNewContext("(" + extract(source, signature) + ")", context);
}

const validLocation = { hash: "#watch/series/test-title/2/4" };
let parse = evaluateFunction(app, "function parseRoute() {", { location: validLocation });
assert.equal(parse().name, "watch");
assert.equal(parse().parts[4], "4");
parse = evaluateFunction(app, "function parseRoute() {", { location: { hash: "#details/%E0%A4%A" } });
assert.equal(parse().name, "home", "malformed deep link should not crash navigation");
console.log("PASS user navigation handles valid and malformed deep links");

{
  const player = {
    media: { item: { id: "movie-1" }, sources: [
      { storageId: "CIN-M-ABCDEFGHIJ", label: "Telegram Storage" },
      { url: "https://invalid.example/video.mp4", label: "Direct" }
    ] },
    sourceIndex: 1,
    failedSources: new Set(),
    video: { currentTime: 34 },
    restoreTime: 12,
    requestedPlay: true
  };
  let changedSource = null;
  const retry = evaluateFunction(app, "function handlePlayerError() {", {
    player,
    sourcePlaybackUrl: (source) => source.storageId ? "https://media.example/stream/" + source.storageId : source.url || "",
    toast: () => {},
    state: { firebase: null },
    loadPlayerSource: (...args) => { changedSource = args; },
    showPlayerError: (error) => { throw new Error(error || "Unexpected player error"); }
  });
  retry();
  assert.equal(changedSource[0], 0, "failed direct playback should try Telegram alternative");
  assert.equal(changedSource[1], 34, "source failover should resume at current time");
  console.log("PASS user player fails over to a Telegram Storage source");
}

{
  const registration = vm.runInNewContext("({ " + extract(backend, "async register(details) {") + " }).register", {
    textValue: (value) => String(value ?? "").trim(),
    throwIf: (error) => { if (error) throw error; },
    supabase: { auth: { signUp: async () => ({
      data: { user: { id: "registered-user" }, session: null },
      error: null
    }) } },
    publicUser: (user) => ({ uid: user.id })
  });
  const result = await registration({
    name: "Tester", email: "TEST@example.com", password: "securepassword"
  });
  assert.equal(result.pendingVerification, true);
  assert.equal(result.email, "test@example.com");
  console.log("PASS signup without a session requires email verification");
}

{
  const rows = Array.from({ length: 1120 }, (_, i) => ({ id: "movie-" + i, kind: "movie", title: "Film " + i }));
  const offsets = [];
  const supabase = {
    from(table) {
      const builder = {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        range(a, b) {
          offsets.push(a);
          return Promise.resolve({ data: rows.slice(a, b + 1), error: null });
        },
        maybeSingle() { return Promise.resolve({ data: { id: "public", featured: [] }, error: null }); },
        then(resolve, reject) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        }
      };
      return builder;
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() { return Promise.resolve(); }
  };
  const context = {
    supabase,
    normalizeContentRow: (row) => row,
    mapConfig: (row) => row,
    mapSection: (row) => row,
    throwIf: (error) => { if (error) throw error; },
    window: { setTimeout },
    clearTimeout,
    console
  };
  const listenContent = vm.runInNewContext("({ " + extract(backend, "listenContent(callback, onError) {") + " }).listenContent", context);
  const loaded = await new Promise((resolve, reject) => {
    const stop = listenContent((snapshot) => { stop(); resolve(snapshot); }, reject);
  });
  assert.equal(loaded.items.length, 1120);
  assert.deepEqual(offsets, [0, 500, 1000]);
  console.log("PASS published catalog loads all 1120 mock items in three pages");
}
