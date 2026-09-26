import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

"use strict";

const SUPABASE_URL = "https://zmkkoggsqvwvwkanlyux.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_yYSX8h3eAkbP3_Xg6ZNpoA_E1CwAvJJ";
const APP_VERSION = "2.8.0";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "cinaro:supabase:auth:v1"
  },
  realtime: { params: { eventsPerSecond: 8 } }
});

const textValue = (value, fallback = "", maximum = 500) =>
  String(value == null ? "" : value).trim().slice(0, maximum) || fallback;

const numberValue = (value, fallback = 0, minimum = -Infinity, maximum = Infinity) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const dateMillis = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const dateValue = (value) => {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
};

const mediaUrl = (value, fallback = "") => {
  const input = String(value || "").trim();
  if (/^assets\/[a-z0-9_./-]+$/i.test(input)) return input;
  try {
    const parsed = new URL(input, location.href);
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(parsed.hostname))) {
      return parsed.href;
    }
  } catch (_) {}
  return fallback;
};

const STORAGE_ID_RE = /^CIN-[MS]-[A-Z0-9]{10}$/i;

const normalizeSources = (sources) => (Array.isArray(sources) ? sources : [])
  .slice(0, 12)
  .map((source, index) => {
    const label = textValue(source?.label, "المصدر " + (index + 1), 40);
    const storageId = textValue(source?.storageId || source?.storage_id, "", 32).toUpperCase();
    if (STORAGE_ID_RE.test(storageId)) {
      return {
        label,
        storageId,
        provider: "telegram",
        type: "video/mp4"
      };
    }
    const url = mediaUrl(source?.url);
    if (!url) return null;
    return {
      label,
      url,
      type: textValue(source?.type, /\.m3u8(?:$|[?#])/i.test(url) ? "application/vnd.apple.mpegurl" : "video/mp4", 80)
    };
  })
  .filter(Boolean);

const normalizeSubtitles = (subtitles) => (Array.isArray(subtitles) ? subtitles : [])
  .slice(0, 12)
  .map((track) => {
    const src = mediaUrl(track?.src);
    if (!src) return null;
    return {
      label: textValue(track?.label, "ترجمة", 60),
      src,
      srclang: textValue(track?.srclang, "ar", 12),
      default: track?.default === true
    };
  })
  .filter(Boolean);

const normalizeSeason = (season, index, poster) => {
  const number = Math.max(1, Math.round(numberValue(season?.number, index + 1, 1, 999)));
  const episodes = (Array.isArray(season?.episodes) ? season.episodes : [])
    .map((episode, episodeIndex) => ({
      number: Math.max(1, Math.round(numberValue(episode?.number, episodeIndex + 1, 1, 10000))),
      title: textValue(episode?.title, "الحلقة " + (episodeIndex + 1), 180),
      description: textValue(episode?.description, "", 1200),
      duration: Math.max(0, Math.round(numberValue(episode?.duration, 0, 0, 10000))),
      poster: mediaUrl(episode?.poster, poster),
      sources: normalizeSources(episode?.sources),
      subtitles: normalizeSubtitles(episode?.subtitles)
    }))
    .sort((a, b) => a.number - b.number);
  return { number, title: textValue(season?.title, "الموسم " + number, 100), episodes };
};

const normalizeContentRow = (row) => {
  if (!row) return null;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const raw = {
    ...payload,
    id: row.id,
    kind: row.kind,
    title: row.title,
    published: row.published,
    featured: row.featured,
    managementSectionId: row.management_section_id || payload.managementSectionId || "",
    views: row.views,
    addedAt: row.added_at,
    order: row.sort_order
  };
  const id = textValue(raw.id, "", 120).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const kind = raw.kind === "series" ? "series" : raw.kind === "movie" ? "movie" : "";
  const title = textValue(raw.title, "", 180);
  if (!id || !kind || !title) return null;
  const poster = mediaUrl(raw.poster, "assets/images/poster-placeholder.webp");
  const item = {
    id,
    kind,
    title,
    englishTitle: textValue(raw.englishTitle, "", 180),
    year: Math.round(numberValue(raw.year, new Date().getFullYear(), 1888, 2200)),
    rating: numberValue(raw.rating, 0, 0, 10),
    ageRating: textValue(raw.ageRating, "عام", 20),
    genres: (Array.isArray(raw.genres) ? raw.genres : []).map((genre) => textValue(genre, "", 40)).filter(Boolean).slice(0, 12),
    duration: Math.round(numberValue(raw.duration, 0, 0, 10000)),
    views: Math.round(numberValue(raw.views, 0, 0, Number.MAX_SAFE_INTEGER)),
    addedAt: dateValue(raw.addedAt),
    description: textValue(raw.description, "", 3000),
    poster,
    backdrop: mediaUrl(raw.backdrop, poster),
    sectionIds: (Array.isArray(raw.sectionIds) ? raw.sectionIds : []).map((id) => textValue(id, "", 80)).filter(Boolean).slice(0, 30),
    managementSectionId: textValue(raw.managementSectionId, "", 80),
    featured: raw.featured === true,
    published: raw.published === true,
    order: numberValue(raw.order, 0, -100000, 100000)
  };
  if (!item.genres.length) item.genres = ["عام"];
  if (kind === "movie") {
    item.sources = normalizeSources(raw.sources);
    item.subtitles = normalizeSubtitles(raw.subtitles);
  } else {
    item.seasons = (Array.isArray(raw.seasons) ? raw.seasons : [])
      .map((season, index) => normalizeSeason(season, index, poster))
      .sort((a, b) => a.number - b.number);
  }
  return item;
};

const mapConfig = (row) => ({
  announcement: textValue(row?.announcement, "", 500),
  latestVersion: textValue(row?.latest_version, APP_VERSION, 20),
  minimumVersion: textValue(row?.minimum_version, APP_VERSION, 20),
  updateNotes: textValue(row?.update_notes, "", 1000),
  maintenance: row?.maintenance === true,
  forceUpdate: row?.force_update !== false,
  updateUrl: mediaUrl(row?.update_url, "https://github.com/3c5-o/CINARO/releases"),
  updateReleasedAt: row?.update_released_at || "",
  oldVersionShutdownAt: row?.old_version_shutdown_at || "",
  settings: row?.settings && typeof row.settings === "object" ? row.settings : {}
});

const mapSection = (row) => ({
  id: textValue(row?.id, "", 80),
  name: textValue(row?.name, row?.id || "", 100),
  description: textValue(row?.description, "", 300),
  active: row?.active !== false,
  order: numberValue(row?.sort_order, 0, -100000, 100000)
});

const mapRequest = (row) => ({
  id: String(row?.id || ""),
  userId: String(row?.user_id || ""),
  userEmail: textValue(row?.user_email, "", 180),
  title: textValue(row?.title, "", 180),
  kind: row?.kind === "series" ? "series" : "movie",
  notes: textValue(row?.notes, "", 600),
  status: textValue(row?.status, "new", 30),
  adminNote: textValue(row?.admin_note, "", 600),
  contentId: textValue(row?.linked_content_id, "", 120),
  createdAt: dateMillis(row?.created_at),
  updatedAt: dateMillis(row?.updated_at)
});

function publicUser(user) {
  if (!user) return null;
  const metadata = user.user_metadata || {};
  return {
    uid: user.id,
    displayName: textValue(metadata.display_name || metadata.name, "", 100),
    email: user.email || "",
    isAnonymous: user.is_anonymous === true,
    emailVerified: Boolean(user.email_confirmed_at)
  };
}

function announce(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
}

function throwIf(error) {
  if (error) throw error;
}

function createLiveQuery(name, table, load, filter) {
  let stopped = false;
  const channelName = "cinaro-" + name + "-" + Math.random().toString(36).slice(2);
  const refresh = () => {
    if (!stopped) load().catch((error) => console.warn("CINARO realtime refresh failed", table, error));
  };
  const config = { event: "*", schema: "public", table };
  if (filter) config.filter = filter;
  const channel = supabase.channel(channelName).on("postgres_changes", config, refresh).subscribe();
  return () => {
    stopped = true;
    supabase.removeChannel(channel).catch(() => {});
  };
}

const client = {
  projectId: "zmkkoggsqvwvwkanlyux",
  provider: "supabase",

  onAuth(callback) {
    let active = true;
    supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error && !String(error.message || "").toLowerCase().includes("session")) console.warn("CINARO auth restore", error);
      callback(publicUser(data?.user || null));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) callback(publicUser(session?.user || null));
    });
    return () => {
      active = false;
      data?.subscription?.unsubscribe();
    };
  },

  async register(details) {
    const name = textValue(details?.name, "", 30);
    const email = textValue(details?.email, "", 180).toLowerCase();
    const password = String(details?.password || "");
    if (name.length < 2) throw new Error("cinaro/name-too-short");
    if (password.length < 6) throw new Error("auth/weak-password");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } }
    });
    throwIf(error);
    if (!data?.user) throw new Error("auth/signup-failed");
    return publicUser(data.user);
  },

  async login(email, password) {
    const result = await supabase.auth.signInWithPassword({
      email: textValue(email, "", 180).toLowerCase(),
      password: String(password || "")
    });
    throwIf(result.error);
    return publicUser(result.data?.user);
  },

  async guest() {
    const result = await supabase.auth.signInAnonymously();
    throwIf(result.error);
    return publicUser(result.data?.user);
  },

  async logout() {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    throwIf(error);
  },

  async resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(textValue(email, "", 180).toLowerCase());
    throwIf(error);
    return true;
  },

  async updateAccount(displayName) {
    const name = textValue(displayName, "", 30);
    if (name.length < 2) throw new Error("cinaro/name-too-short");
    const { data, error } = await supabase.auth.updateUser({ data: { display_name: name } });
    throwIf(error);
    if (data?.user) {
      const { error: profileError } = await supabase.from("profiles")
        .update({ display_name: name, updated_at: new Date().toISOString() })
        .eq("id", data.user.id);
      throwIf(profileError);
    }
    return publicUser(data?.user);
  },

  async requestEmailChange(newEmail) {
    const { data: current } = await supabase.auth.getUser();
    if (!current?.user || current.user.is_anonymous) throw new Error("auth/requires-login");
    const email = textValue(newEmail, "", 180).toLowerCase();
    if (!email || email === String(current.user.email || "").toLowerCase()) throw new Error("cinaro/email-unchanged");
    const { error } = await supabase.auth.updateUser({ email });
    throwIf(error);
    return true;
  },

  async sendVerification() {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user || user.is_anonymous || !user.email) throw new Error("auth/requires-login");
    if (user.email_confirmed_at) return true;
    const result = await supabase.auth.resend({ type: "signup", email: user.email });
    throwIf(result.error);
    return true;
  },

  async recordView(contentId) {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    const id = textValue(contentId, "", 120).toLowerCase();
    if (!user || !id) return false;
    const { error } = await supabase.from("content_views")
      .upsert({ content_id: id, user_id: user.id }, { onConflict: "content_id,user_id", ignoreDuplicates: true });
    if (error && !String(error.code || "").includes("23505")) throw error;
    return !error;
  },

  async submitReport(payload) {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) throw new Error("auth/requires-login");
    const report = payload && typeof payload === "object" ? payload : {};
    const { data: row, error } = await supabase.from("reports").insert({
      user_id: user.id,
      user_email: textValue(user.email, "", 180),
      content_id: textValue(report.contentId, "", 120),
      content_title: textValue(report.contentTitle, "", 180),
      kind: report.kind === "series" ? "series" : "movie",
      season: Math.max(0, Math.round(numberValue(report.season, 0, 0, 1000))),
      episode: Math.max(0, Math.round(numberValue(report.episode, 0, 0, 10000))),
      category: textValue(report.category, "playback", 40),
      details: textValue(report.details, "", 600),
      source_url: mediaUrl(report.sourceUrl, ""),
      status: "open"
    }).select("id").single();
    throwIf(error);
    return row;
  },

  async submitContentRequest(payload) {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user || user.is_anonymous || !user.email) throw new Error("auth/requires-login");
    const request = payload && typeof payload === "object" ? payload : {};
    const title = textValue(request.title, "", 180);
    if (title.length < 2) throw new Error("cinaro/request-title-too-short");
    const { data: row, error } = await supabase.from("content_requests").insert({
      user_id: user.id,
      user_email: textValue(user.email, "", 180),
      title,
      kind: request.kind === "series" ? "series" : "movie",
      notes: textValue(request.notes, "", 600),
      status: "new"
    }).select("id").single();
    throwIf(error);
    return row;
  },

  async cancelContentRequest(requestId) {
    const { error } = await supabase.from("content_requests").delete().eq("id", String(requestId || ""));
    throwIf(error);
    return true;
  },

  listenMyRequests(callback, onError) {
    let userId = "";
    let stopLive = () => {};
    let stopped = false;
    const load = async () => {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user || user.is_anonymous) {
        callback([]);
        return;
      }
      if (userId !== user.id) {
        stopLive();
        userId = user.id;
        stopLive = createLiveQuery("my-requests", "content_requests", load, "user_id=eq." + userId);
      }
      const { data, error } = await supabase.from("content_requests")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      throwIf(error);
      if (!stopped) callback((data || []).map(mapRequest));
    };
    load().catch((error) => onError?.(error));
    return () => { stopped = true; stopLive(); };
  },

  listenContent(callback, onError) {
    let stopped = false;
    let refreshTimer = 0;
    let retryTimer = 0;
    let retryAttempt = 0;

    const load = async () => {
      const [contentResult, configResult, sectionsResult] = await Promise.all([
        supabase.from("content").select("*").eq("published", true).order("sort_order", { ascending: false }).order("added_at", { ascending: false }),
        supabase.from("app_config").select("*").eq("id", "public").maybeSingle(),
        supabase.from("sections").select("*").eq("active", true).order("sort_order", { ascending: false })
      ]);

      // Published content and release controls are mandatory; sections are decorative.
      throwIf(contentResult.error);
      throwIf(configResult.error);
      if (sectionsResult.error) console.warn("CINARO sections refresh skipped", sectionsResult.error);
      if (stopped) return;

      const items = (contentResult.data || []).map(normalizeContentRow).filter(Boolean);
      const configRow = configResult.data || {};
      const configured = Array.isArray(configRow.featured) ? configRow.featured.map(String).slice(0, 12) : [];
      const present = new Set(items.map((item) => item.id));
      const featured = configured.filter((id) => present.has(id));

      retryAttempt = 0;
      clearTimeout(retryTimer);
      callback({
        items,
        featured: featured.length ? featured : items.filter((item) => item.featured).map((item) => item.id).slice(0, 8),
        config: mapConfig(configRow),
        sections: sectionsResult.error ? [] : (sectionsResult.data || []).map(mapSection),
        fromCache: false
      });
    };

    const runLoad = () => load().catch((error) => {
      if (stopped) return;
      onError?.(error);
      clearTimeout(retryTimer);
      const delay = Math.min(30000, 1500 * (2 ** Math.min(retryAttempt, 4)));
      retryAttempt += 1;
      retryTimer = window.setTimeout(runLoad, delay);
    });

    const schedule = () => {
      clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(runLoad, 100);
    };

    const channels = [
      supabase.channel("cinaro-public-content").on("postgres_changes", { event: "*", schema: "public", table: "content" }, schedule).subscribe(),
      supabase.channel("cinaro-public-config").on("postgres_changes", { event: "*", schema: "public", table: "app_config" }, schedule).subscribe(),
      supabase.channel("cinaro-public-sections").on("postgres_changes", { event: "*", schema: "public", table: "sections" }, schedule).subscribe()
    ];

    runLoad();
    return () => {
      stopped = true;
      clearTimeout(refreshTimer);
      clearTimeout(retryTimer);
      channels.forEach((channel) => supabase.removeChannel(channel).catch(() => {}));
    };
  },

  listenUserState(uid, callback, onError) {
    let stopped = false;
    const load = async () => {
      const { data, error } = await supabase.from("user_states").select("*").eq("user_id", uid).maybeSingle();
      throwIf(error);
      if (!stopped) callback(data ? {
        favorites: Array.isArray(data.favorites) ? data.favorites : [],
        history: data.history && typeof data.history === "object" ? data.history : {},
        settings: data.settings && typeof data.settings === "object" ? data.settings : {},
        updatedAt: dateMillis(data.updated_at)
      } : null);
    };
    const stopLive = createLiveQuery("user-state", "user_states", load, "user_id=eq." + uid);
    load().catch((error) => onError?.(error));
    return () => { stopped = true; stopLive(); };
  },

  listenUserProfile(uid, callback, onError) {
    let stopped = false;
    const load = async () => {
      const [profileResult, statusResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
        supabase.from("account_status").select("*").eq("user_id", uid).maybeSingle()
      ]);
      throwIf(profileResult.error);
      throwIf(statusResult.error);
      if (!stopped) callback(profileResult.data ? {
        uid,
        email: profileResult.data.email || "",
        displayName: profileResult.data.display_name || "",
        isAnonymous: profileResult.data.is_anonymous === true,
        status: statusResult.data?.active === false ? "blocked" : "active",
        createdAt: dateMillis(profileResult.data.created_at),
        updatedAt: dateMillis(profileResult.data.updated_at)
      } : null);
    };
    const stopProfile = createLiveQuery("profile", "profiles", load, "id=eq." + uid);
    const stopStatus = createLiveQuery("status", "account_status", load, "user_id=eq." + uid);
    load().catch((error) => onError?.(error));
    return () => { stopped = true; stopProfile(); stopStatus(); };
  },

  async saveUserState(uid, payload) {
    const favorites = Array.from(new Set(Array.isArray(payload?.favorites) ? payload.favorites.map(String) : [])).slice(0, 1000);
    const historyEntries = Object.entries(payload?.history && typeof payload.history === "object" ? payload.history : {})
      .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
      .slice(0, 500);
    const settings = {
      oled: Boolean(payload?.settings?.oled),
      autoplayNext: payload?.settings?.autoplayNext !== false,
      reduceMotion: Boolean(payload?.settings?.reduceMotion),
      playbackRate: numberValue(payload?.settings?.playbackRate, 1, 0.5, 2),
      captionsEnabled: Boolean(payload?.settings?.captionsEnabled),
      notificationsEnabled: payload?.settings?.notificationsEnabled !== false
    };
    const { error } = await supabase.from("user_states").upsert({
      user_id: uid,
      favorites,
      history: Object.fromEntries(historyEntries),
      settings,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    throwIf(error);
  },

  log() {}
};

window.CINARO_SUPABASE = client;
window.CINARO_BACKEND = client;
announce("cinaro:supabase-ready", { client });
