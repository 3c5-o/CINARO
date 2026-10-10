import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../admin/xtream-import.js", import.meta.url), "utf8");

async function simulateImport(ready) {
  const elements = new Map();
  const saved = [];
  const storage = new Map();
  const endpoints = [];
  const timers = new Set();
  const createElement = (id) => {
    if (elements.has(id)) return elements.get(id);
    const node = {
      id, value: "", hidden: false, disabled: false, textContent: "",
      dataset: {}, options: [], children: [],
      addEventListener(type, handler) { this["on" + type] = handler; },
      replaceChildren(...children) { this.children = children; this.options = children; },
      append(child) { this.children.push(child); this.options.push(child); }
    };
    elements.set(id, node);
    return node;
  };
  createElement("xtreamImportAccount").value = "x-demo";
  createElement("xtreamImportKind").value = "movie";
  createElement("xtreamImportProgress").value = 0;
  const fakeJson = (data) => ({ ok: true, status: 200, async json() { return data; } });
  const fetch = async (url) => {
    const parsed = new URL(url);
    endpoints.push(parsed.pathname);
    if (parsed.pathname === "/admin/xtream/catalog") {
      return fakeJson({ ok: true, total: 1, cursor: 0, items: [{
        accountId: "x-demo", kind: "movie", contentType: "movie",
        id: "42", title: "Test Movie", extension: "mp4", tmdbId: 123
      }], hasMore: false });
    }
    if (parsed.pathname === "/3/movie/123") {
      return fakeJson({ id: 123, title: "Test Movie", adult: false, genres: [] });
    }
    if (parsed.pathname === "/admin/xtream/detail") {
      return fakeJson({ ok: true, sources: [{
        label: "Xtream", type: "video/mp4",
        path: "/xtream/play/x-demo/movie/42.mp4?sig=fake-test-signature"
      }] });
    }
    if (parsed.pathname === "/admin/xtream/playback-check") {
      return fakeJson(ready
        ? { ok: true, reason: "media_bytes_received", detectedFormat: "mp4" }
        : { ok: false, reason: "provider_stream_header_timeout" });
    }
    throw new Error("Unexpected request: " + parsed.pathname);
  };
  const ui = {
    document: { getElementById: createElement, createElement: () => createElement("option" + elements.size) },
    window: { confirm: () => true },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    fetch, URL, console,
    setTimeout(fn, delay) {
      const token = setTimeout(() => { timers.delete(token); fn(); }, delay);
      timers.add(token);
      return token;
    }
  };
  vm.runInNewContext(source, ui, { filename: "admin/xtream-import.js" });
  ui.window.CINARO_XTREAM_IMPORT.configure({
    token: "test-session", gateway: "https://gateway.example", tmdbToken: "fake-tmdb",
    listContent: () => [], uid: "owner",
    save: async (payload) => saved.push(payload)
  });
  const callback = createElement("xtreamImportStart").onclick;
  assert.equal(typeof callback, "function");
  await callback();
  for (const timer of timers) clearTimeout(timer);
  return { saved, storage, endpoints, message: createElement("xtreamImportMessage").textContent };
}

const failed = await simulateImport(false);
assert.equal(failed.saved.length, 0, "failed media preflight must not publish a title");
assert.equal(failed.storage.size, 0, "failed media preflight must preserve batch cursor");
assert.match(failed.message, /إيقاف|إيقاف استيراد|تم إيقاف/, "owner sees explicit failure");
assert.ok(failed.endpoints.includes("/admin/xtream/playback-check"), "failed media probed through gateway");

const ready = await simulateImport(true);
assert.equal(ready.saved.length, 1, "successful media sample permits one import");
assert.equal(ready.saved[0].provider, "xtream");
assert.equal(ready.saved[0].published, true);
assert.equal([...ready.storage.values()][0], "1", "successful import advances cursor");
console.log("PASS: CINARO admin Xtream import preflight preserves data and cursor on playback failure");
