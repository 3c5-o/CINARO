(function (global) {
  "use strict";

  const DEFAULT_API = "https://media-catalog-navy.vercel.app/api/v1";
  const MIME = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    ogg: "video/ogg",
    m3u8: "application/vnd.apple.mpegurl"
  };
  const ID_PATTERN = /^(?:movie|episode)_[a-z0-9_-]+$/i;

  function validatedApiBase(raw) {
    try {
      const input = String(raw || DEFAULT_API).trim();
      const url = new URL(input);
      if (url.protocol !== "https:" || url.username || url.password) return DEFAULT_API;
      const path = url.pathname.replace(/\/+$/, "");
      if (path !== "/api/v1" && path !== "/api/v1/anime") return DEFAULT_API;
      return url.origin + "/api/v1";
    } catch (_) {
      return DEFAULT_API;
    }
  }

  function requestPlan(media, native = false) {
    const item = media?.item;
    if (!item || !Array.isArray(media.sources)) return null;
    // An admin explicitly took control of playback: do not overwrite that
    // source with the old provider link during every play attempt.
    if (item.providerSourceMode === "manual") return null;
    // Manual CINARO Storage uploads are not controlled by Media Catalog.
    if (media.sources.some((source) => source?.storageId || source?.storage_id)) return null;

    let type = "";
    let providerId = "";
    if (media.kind === "movie" && item.provider === "media-catalog") {
      type = "movie";
      providerId = item.providerId;
    } else if (media.kind === "series" && item.provider === "media-catalog-anime") {
      const id = media.episode?.providerEpisodeId || "";
      if (!id) return null;
      // Media3 on Android may play MKV or TS, whereas web-only resolver
      // rightly reports them unsupported. Keep native episode playback.
      if (native && media.sources.some((source) => /\.(?:mkv|ts)(?:$|[?#])/i.test(source?.url || "")
        || /matroska|mp2t/i.test(source?.type || ""))) return null;
      type = "episode";
      providerId = id;
    } else {
      return null;
    }
    if (!ID_PATTERN.test(String(providerId || ""))) return null;
    return {
      type,
      id: String(providerId),
      apiBase: validatedApiBase(item.providerBaseUrl)
    };
  }

  function sourceFromSelection(selection) {
    if (!selection || !Object.prototype.hasOwnProperty.call(MIME, String(selection.format || "").toLowerCase())) return null;
    const format = String(selection.format).toLowerCase();
    try {
      const url = new URL(String(selection.url || ""));
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
      return {
        label: "Media Catalog · " + format.toUpperCase(),
        url: url.href,
        type: MIME[format],
        providerVerifiedAt: Date.now()
      };
    } catch (_) {
      return null;
    }
  }

  async function resolve(media, options = {}) {
    const plan = requestPlan(media, options.native === true);
    if (!plan) return { status: "skip" };
    const target = new URL(plan.apiBase + "/playback");
    target.searchParams.set("type", plan.type);
    target.searchParams.set("id", plan.id);
    target.searchParams.set("platform", "web");
    target.searchParams.set("fresh", "1");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 16000);
    try {
      const response = await (options.fetch || global.fetch.bind(global))(target.href, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) throw new Error("media_catalog_http_" + response.status);
      const data = await response.json();
      if (data?.ok !== true || data.id !== plan.id || data.type !== plan.type) {
        throw new Error("media_catalog_invalid_response");
      }
      if (data.available !== true) {
        return {
          status: "unavailable",
          issues: Array.isArray(data.candidates)
            ? data.candidates.flatMap((candidate) => candidate?.issues || []).slice(0, 8) : []
        };
      }
      const source = sourceFromSelection(data.selected);
      if (!source) throw new Error("media_catalog_invalid_source");
      return { status: "ready", sources: [source], verifiedFullPlayback: false };
    } finally {
      clearTimeout(timeout);
    }
  }

  global.CINARO_CATALOG_PLAYBACK = {
    requestPlan,
    sourceFromSelection,
    resolve
  };
})(window);
