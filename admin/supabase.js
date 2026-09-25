import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

"use strict";

const SUPABASE_URL = "https://zmkkoggsqvwvwkanlyux.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_yYSX8h3eAkbP3_Xg6ZNpoA_E1CwAvJJ";
const OWNER_EMAIL = "ffkyyr@gmail.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "cinaro:admin:supabase:auth:v1"
  },
  realtime: { params: { eventsPerSecond: 8 } }
});

const clean = (value, fallback = "", maximum = 500) =>
  String(value == null ? "" : value).trim().slice(0, maximum) || fallback;

const numberValue = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const dateMillis = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const throwIf = (error) => {
  if (error) throw error;
};

const contentFromRow = (row) => {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    ...payload,
    id: row?.id || payload.id || "",
    kind: row?.kind || payload.kind || "movie",
    title: row?.title || payload.title || "",
    published: row?.published === true,
    featured: row?.featured === true,
    managementSectionId: row?.management_section_id || payload.managementSectionId || "",
    views: numberValue(row?.views, numberValue(payload.views, 0)),
    addedAt: row?.added_at || payload.addedAt || "",
    order: numberValue(row?.sort_order, numberValue(payload.order, 0)),
    updatedAt: dateMillis(row?.updated_at)
  };
};

const sectionFromRow = (row) => ({
  id: row?.id || "",
  name: row?.name || row?.id || "",
  description: row?.description || "",
  active: row?.active !== false,
  order: numberValue(row?.sort_order, 0),
  updatedAt: dateMillis(row?.updated_at)
});

const configFromRow = (row) => ({
  id: row?.id || "public",
  featured: Array.isArray(row?.featured) ? row.featured : [],
  announcement: row?.announcement || "",
  latestVersion: row?.latest_version || "2.5.0",
  minimumVersion: row?.minimum_version || "2.5.0",
  updateNotes: row?.update_notes || "",
  updateUrl: row?.update_url || "https://github.com/3c5-o/CINARO/releases",
  maintenance: row?.maintenance === true,
  forceUpdate: row?.force_update !== false,
  updateReleasedAt: row?.update_released_at || "",
  oldVersionShutdownAt: row?.old_version_shutdown_at || "",
  settings: row?.settings && typeof row.settings === "object" ? row.settings : {},
  updatedAt: dateMillis(row?.updated_at)
});

const requestFromRow = (row) => ({
  id: String(row?.id || ""),
  userId: String(row?.user_id || ""),
  userEmail: row?.user_email || "",
  title: row?.title || "",
  kind: row?.kind === "series" ? "series" : "movie",
  notes: row?.notes || "",
  status: row?.status || "new",
  adminNote: row?.admin_note || "",
  contentId: row?.linked_content_id || "",
  createdAt: dateMillis(row?.created_at),
  updatedAt: dateMillis(row?.updated_at)
});

const reportFromRow = (row) => ({
  id: String(row?.id || ""),
  userId: String(row?.user_id || ""),
  userEmail: row?.user_email || "",
  contentId: row?.content_id || "",
  contentTitle: row?.content_title || "",
  kind: row?.kind === "series" ? "series" : "movie",
  season: numberValue(row?.season, 0),
  episode: numberValue(row?.episode, 0),
  category: row?.category || "playback",
  details: row?.details || "",
  sourceUrl: row?.source_url || "",
  status: row?.status || "open",
  adminNote: row?.admin_note || "",
  createdAt: dateMillis(row?.created_at),
  updatedAt: dateMillis(row?.updated_at)
});

const auditFromRow = (row) => ({
  id: String(row?.id || ""),
  action: row?.action || "",
  target: row?.target || "",
  details: row?.details || "",
  actorUid: row?.actor_uid || "",
  actorEmail: row?.actor_email || "",
  createdAt: dateMillis(row?.created_at)
});

function announce(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
}

function live(table, key, load, filter = "") {
  let stopped = false;
  let timer = 0;
  const refresh = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!stopped) load().catch((error) => console.warn("CINARO admin realtime refresh", table, error));
    }, 80);
  };
  const spec = { event: "*", schema: "public", table };
  if (filter) spec.filter = filter;
  const channel = supabase.channel("cinaro-admin-" + key + "-" + Math.random().toString(36).slice(2))
    .on("postgres_changes", spec, refresh)
    .subscribe();
  return () => {
    stopped = true;
    clearTimeout(timer);
    supabase.removeChannel(channel).catch(() => {});
  };
}

async function currentAdminUser(user) {
  if (!user) return null;
  const [membershipResult, profileResult] = await Promise.all([
    supabase.from("admin_memberships").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle()
  ]);
  if (membershipResult.error) throw membershipResult.error;
  if (profileResult.error) throw profileResult.error;
  const membership = membershipResult.data;
  const profile = profileResult.data || {};
  const fullAdmin = membership?.active === true && ["owner", "admin"].includes(membership.role);
  const supervisor = membership?.active === true && membership.role === "supervisor";
  return {
    uid: user.id,
    email: user.email || profile.email || "",
    displayName: profile.display_name || user.user_metadata?.display_name || "",
    isAnonymous: user.is_anonymous === true,
    emailVerified: Boolean(user.email_confirmed_at),
    isAdmin: fullAdmin,
    canAccessAdmin: fullAdmin || supervisor,
    role: fullAdmin ? "admin" : supervisor ? "supervisor" : "none",
    assignment: supervisor ? {
      uid: user.id,
      email: user.email || profile.email || "",
      displayName: profile.display_name || user.user_metadata?.display_name || "",
      sectionIds: Array.isArray(membership.section_ids) ? membership.section_ids : [],
      active: membership.active === true,
      permissions: membership.permissions && typeof membership.permissions === "object" ? membership.permissions : {}
    } : null
  };
}

async function loadUsers() {
  const [profiles, statuses] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    supabase.from("account_status").select("*")
  ]);
  throwIf(profiles.error);
  throwIf(statuses.error);
  const statusMap = new Map((statuses.data || []).map((row) => [row.user_id, row]));
  return (profiles.data || []).map((profile) => {
    const status = statusMap.get(profile.id);
    return {
      id: profile.id,
      uid: profile.id,
      email: profile.email || "",
      displayName: profile.display_name || "",
      isAnonymous: profile.is_anonymous === true,
      status: status?.active === false ? "blocked" : "active",
      createdAt: dateMillis(profile.created_at),
      updatedAt: dateMillis(profile.updated_at)
    };
  });
}

async function loadSupervisors() {
  const [memberships, profiles] = await Promise.all([
    supabase.from("admin_memberships").select("*").eq("role", "supervisor"),
    supabase.from("profiles").select("*")
  ]);
  throwIf(memberships.error);
  throwIf(profiles.error);
  const profileMap = new Map((profiles.data || []).map((row) => [row.id, row]));
  return (memberships.data || []).map((membership) => {
    const profile = profileMap.get(membership.user_id) || {};
    return {
      id: membership.user_id,
      uid: membership.user_id,
      email: profile.email || "",
      displayName: profile.display_name || "",
      sectionIds: Array.isArray(membership.section_ids) ? membership.section_ids : [],
      active: membership.active === true,
      permissions: membership.permissions && typeof membership.permissions === "object" ? membership.permissions : {},
      createdAt: dateMillis(membership.created_at),
      updatedAt: dateMillis(membership.updated_at)
    };
  });
}

async function saveContent(id, patch) {
  const safeId = clean(id, "", 150).toLowerCase();
  if (!safeId) throw new Error("cinaro/invalid-document-id");
  const existingResult = await supabase.from("content").select("*").eq("id", safeId).maybeSingle();
  throwIf(existingResult.error);
  const existing = existingResult.data;
  const oldPayload = existing?.payload && typeof existing.payload === "object" ? existing.payload : {};
  const merged = { ...oldPayload, ...(patch || {}), id: safeId };
  const kind = merged.kind === "series" ? "series" : merged.kind === "movie" ? "movie" : existing?.kind;
  const title = clean(merged.title || existing?.title, "", 180);
  if (!kind || !title) throw new Error("نوع المحتوى وعنوانه مطلوبان.");
  const row = {
    id: safeId,
    kind,
    title,
    published: merged.published === true,
    featured: merged.featured === true,
    management_section_id: clean(merged.managementSectionId || existing?.management_section_id, "", 80) || null,
    views: Math.max(0, Math.round(numberValue(merged.views, numberValue(existing?.views, 0)))),
    added_at: merged.addedAt || existing?.added_at || new Date().toISOString().slice(0, 10),
    sort_order: Math.round(numberValue(merged.order, numberValue(existing?.sort_order, 0))),
    payload: merged,
    updated_at: new Date().toISOString()
  };
  const result = await supabase.from("content").upsert(row, { onConflict: "id" });
  throwIf(result.error);
}

async function saveDocument(name, id, payload) {
  const safeId = clean(id, "", 150);
  const patch = payload && typeof payload === "object" ? payload : {};
  if (!safeId) throw new Error("cinaro/invalid-document-id");

  if (name === "content") return saveContent(safeId, patch);

  if (name === "sections") {
    const result = await supabase.from("sections").upsert({
      id: safeId,
      name: clean(patch.name, safeId, 100),
      description: clean(patch.description, "", 600),
      active: patch.active !== false,
      sort_order: Math.round(numberValue(patch.order, 0)),
      updated_at: new Date().toISOString()
    }, { onConflict: "id" });
    throwIf(result.error);
    return;
  }

  if (name === "appConfig") {
    const current = await supabase.from("app_config").select("*").eq("id", safeId).maybeSingle();
    throwIf(current.error);
    const old = current.data || {};
    const row = {
      id: safeId,
      announcement: patch.announcement !== undefined ? clean(patch.announcement, "", 500) : old.announcement || "",
      latest_version: patch.latestVersion !== undefined ? clean(patch.latestVersion, "2.5.0", 20) : old.latest_version || "2.5.0",
      minimum_version: patch.minimumVersion !== undefined ? clean(patch.minimumVersion, "2.5.0", 20) : old.minimum_version || "2.5.0",
      update_notes: patch.updateNotes !== undefined ? clean(patch.updateNotes, "", 1000) : old.update_notes || "",
      maintenance: patch.maintenance !== undefined ? patch.maintenance === true : old.maintenance === true,
      force_update: patch.forceUpdate !== undefined ? patch.forceUpdate === true : old.force_update !== false,
      update_url: patch.updateUrl !== undefined ? clean(patch.updateUrl, "https://github.com/3c5-o/CINARO/releases", 2048) : old.update_url || "https://github.com/3c5-o/CINARO/releases",
      featured: patch.featured !== undefined ? (Array.isArray(patch.featured) ? patch.featured.map(String).slice(0, 12) : []) : (old.featured || []),
      update_released_at: patch.updateReleasedAt !== undefined ? (patch.updateReleasedAt || null) : old.update_released_at,
      old_version_shutdown_at: patch.oldVersionShutdownAt !== undefined ? (patch.oldVersionShutdownAt || null) : old.old_version_shutdown_at,
      settings: { ...(old.settings || {}), ...(patch.settings && typeof patch.settings === "object" ? patch.settings : {}) },
      updated_at: new Date().toISOString()
    };
    const result = await supabase.from("app_config").upsert(row, { onConflict: "id" });
    throwIf(result.error);
    return;
  }

  if (name === "users") {
    const active = patch.status !== "blocked";
    const result = await supabase.from("account_status").upsert({
      user_id: safeId,
      active,
      reason: active ? "" : clean(patch.reason, "blocked_by_admin", 300),
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    throwIf(result.error);
    return;
  }

  if (name === "supervisorAssignments") {
    const result = await supabase.from("admin_memberships").upsert({
      user_id: safeId,
      role: "supervisor",
      active: patch.active !== false,
      permissions: patch.permissions && typeof patch.permissions === "object" ? patch.permissions : {},
      section_ids: Array.isArray(patch.sectionIds) ? patch.sectionIds.map(String).slice(0, 30) : [],
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    throwIf(result.error);
    return;
  }

  if (name === "contentRequests") {
    const update = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) update.status = clean(patch.status, "new", 30);
    if (patch.adminNote !== undefined) update.admin_note = clean(patch.adminNote, "", 600);
    if (patch.contentId !== undefined) update.linked_content_id = clean(patch.contentId, "", 120) || null;
    const result = await supabase.from("content_requests").update(update).eq("id", safeId);
    throwIf(result.error);
    return;
  }

  if (name === "reports") {
    const update = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) update.status = clean(patch.status, "open", 30);
    if (patch.adminNote !== undefined) update.admin_note = clean(patch.adminNote, "", 600);
    const result = await supabase.from("reports").update(update).eq("id", safeId);
    throwIf(result.error);
    return;
  }

  throw new Error("مجموعة غير مدعومة: " + name);
}

async function deleteDocument(name, id) {
  const safeId = clean(id, "", 150);
  if (name === "content") {
    const { error } = await supabase.from("content").delete().eq("id", safeId);
    throwIf(error);
    return;
  }
  if (name === "sections") {
    const { error } = await supabase.from("sections").delete().eq("id", safeId);
    throwIf(error);
    return;
  }
  if (name === "supervisorAssignments") {
    const { error } = await supabase.from("admin_memberships").delete().eq("user_id", safeId).eq("role", "supervisor");
    throwIf(error);
    return;
  }
  throw new Error("الحذف غير مدعوم لهذه المجموعة.");
}

const client = {
  projectId: "zmkkoggsqvwvwkanlyux",
  provider: "supabase",
  adminEmail: OWNER_EMAIL,

  onAuth(callback) {
    let active = true;
    const publish = async (user) => {
      if (!active) return;
      try {
        callback(await currentAdminUser(user));
      } catch (error) {
        console.warn("CINARO admin membership lookup failed", error);
        callback(null);
      }
    };
    supabase.auth.getUser().then(({ data }) => publish(data?.user || null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => publish(session?.user || null), 0);
    });
    return () => {
      active = false;
      data?.subscription?.unsubscribe();
    };
  },

  async login(email, password) {
    const result = await supabase.auth.signInWithPassword({
      email: clean(email, "", 180).toLowerCase(),
      password: String(password || "")
    });
    throwIf(result.error);
    return result.data?.user;
  },

  async logout() {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    throwIf(error);
  },

  listenCollection(name, callback, onError) {
    let stopped = false;
    let stops = [];
    const load = async () => {
      let rows = [];
      if (name === "content") {
        const result = await supabase.from("content").select("*").order("sort_order", { ascending: false }).order("updated_at", { ascending: false });
        throwIf(result.error);
        rows = (result.data || []).map(contentFromRow);
      } else if (name === "sections") {
        const result = await supabase.from("sections").select("*").order("sort_order", { ascending: false });
        throwIf(result.error);
        rows = (result.data || []).map(sectionFromRow);
      } else if (name === "reports") {
        const result = await supabase.from("reports").select("*").order("created_at", { ascending: false });
        throwIf(result.error);
        rows = (result.data || []).map(reportFromRow);
      } else if (name === "contentRequests") {
        const result = await supabase.from("content_requests").select("*").order("created_at", { ascending: false });
        throwIf(result.error);
        rows = (result.data || []).map(requestFromRow);
      } else if (name === "auditLogs") {
        const result = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(1500);
        throwIf(result.error);
        rows = (result.data || []).map(auditFromRow);
      } else if (name === "users") {
        rows = await loadUsers();
      } else if (name === "supervisorAssignments") {
        rows = await loadSupervisors();
      } else {
        throw new Error("مجموعة غير مدعومة: " + name);
      }
      if (!stopped) callback(rows, { fromCache: false });
    };

    const tables = name === "users" ? ["profiles", "account_status"]
      : name === "supervisorAssignments" ? ["admin_memberships", "profiles"]
      : [name === "contentRequests" ? "content_requests" : name === "auditLogs" ? "audit_logs" : name];

    stops = tables.map((table, index) => live(table, name + "-" + index, load));
    load().catch((error) => onError?.(error));
    return () => {
      stopped = true;
      stops.forEach((stop) => stop());
    };
  },

  listenContentForSections(sectionIds, callback, onError) {
    const ids = Array.from(new Set((Array.isArray(sectionIds) ? sectionIds : []).map(String).filter(Boolean))).slice(0, 30);
    let stopped = false;
    const load = async () => {
      if (!ids.length) {
        callback([], { fromCache: false });
        return;
      }
      const result = await supabase.from("content").select("*").in("management_section_id", ids).order("updated_at", { ascending: false });
      throwIf(result.error);
      if (!stopped) callback((result.data || []).map(contentFromRow), { fromCache: false });
    };
    const stopLive = live("content", "scoped-content", load);
    load().catch((error) => onError?.(error));
    return () => { stopped = true; stopLive(); };
  },

  listenDoc(name, id, callback, onError) {
    if (name !== "appConfig") {
      callback(null);
      return () => {};
    }
    let stopped = false;
    const load = async () => {
      const result = await supabase.from("app_config").select("*").eq("id", id).maybeSingle();
      throwIf(result.error);
      if (!stopped) callback(result.data ? configFromRow(result.data) : null);
    };
    const stopLive = live("app_config", "config", load, "id=eq." + id);
    load().catch((error) => onError?.(error));
    return () => { stopped = true; stopLive(); };
  },

  saveDocument,
  deleteDocument,

  async logAudit(action, target, details, actor) {
    const result = await supabase.from("audit_logs").insert({
      action: clean(action, "operation", 80),
      target: clean(target, "", 180),
      details: clean(details, "", 600),
      actor_uid: actor?.uid || null,
      actor_email: actor?.email || OWNER_EMAIL
    });
    throwIf(result.error);
  }
};

window.CINARO_ADMIN_SUPABASE = client;
window.CINARO_ADMIN_BACKEND = client;
announce("cinaro:admin-supabase-ready", { client });
