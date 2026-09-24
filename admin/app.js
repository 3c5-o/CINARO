(function () {
  "use strict";

  const ADMIN_EMAIL = "ffkyyr@gmail.com";
  const TMDB_STORAGE_KEY = "cinaro:admin:tmdb-token:v1";
  const TMDB_API_ROOT = "https://api.themoviedb.org/3";
  const state = {
    firebase: null,
    authUser: null,
    authResolved: false,
    role: "none",
    assignment: null,
    view: "dashboard",
    editingContentId: "",
    editingSupervisorUid: "",
    editingSectionId: "",
    pendingRequestId: "",
    pendingRequestTitle: "",
    content: [],
    users: [],
    supervisors: [],
    sections: [],
    logs: [],
    reports: [],
    requests: [],
    seasonDraft: [],
    config: {},
    unsubscribers: [],
    dataListenersStarted: false,
    previewHls: null,
    tmdb: { importMode: "manual", results: [], configuration: null, busy: false },
    filters: { contentSearch: "", contentKind: "all", contentStatus: "all", userSearch: "", userStatus: "all", reportStatus: "open", requestStatus: "pending" }
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const views = ["dashboard", "content", "editor", "reports", "requests", "users", "supervisors", "sections", "settings", "activity"];

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asString(value, fallback = "") {
    const text = String(value == null ? "" : value).trim();
    return text || fallback;
  }

  function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ar-IQ").format(Math.max(0, Math.round(asNumber(value))));
  }

  function formatDate(value) {
    const number = typeof value === "number" ? value : Date.parse(value || "");
    if (!Number.isFinite(number)) return "—";
    return new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(number));
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function errorMessage(error) {
    const code = String(error && error.code || "");
    const messages = {
      "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة.",
      "auth/invalid-login-credentials": "البريد أو كلمة المرور غير صحيحة.",
      "auth/user-disabled": "هذا الحساب معطّل من Firebase.",
      "auth/too-many-requests": "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.",
      "auth/network-request-failed": "تعذّر الاتصال بالشبكة.",
      "permission-denied": "ليس لديك صلاحية لهذه العملية.",
      "failed-precondition": "تأكد من إعداد Firestore قبل المتابعة."
    };
    return messages[code] || asString(error && error.message, "حدث خطأ غير متوقع.");
  }

  function setMessage(id, message, type = "") {
    const element = $(id);
    if (!element) return;
    element.textContent = message || "";
    element.className = "form-message" + (type ? " " + type : "");
  }

  function toast(message, type = "") {
    const region = $("toastRegion");
    if (!region) return;
    const item = document.createElement("div");
    item.className = "admin-toast " + (type || "success");
    item.textContent = message;
    region.appendChild(item);
    window.setTimeout(() => item.classList.add("show"), 20);
    window.setTimeout(() => {
      item.classList.remove("show");
      window.setTimeout(() => item.remove(), 300);
    }, 4200);
  }

  function setConnection(status, message) {
    const dot = $("adminConnectionDot");
    const text = $("adminConnectionText");
    if (dot) dot.className = "connection-dot " + status;
    if (text) text.textContent = message;
  }

  function showNotice(message, type = "error") {
    const notice = $("adminNotice");
    if (!notice) return;
    notice.hidden = !message;
    notice.className = "admin-notice " + type;
    notice.textContent = message || "";
  }

  function isAdmin() {
    return state.role === "admin";
  }

  function hasPermission(name) {
    if (isAdmin()) return true;
    return state.role === "supervisor" && state.assignment?.permissions?.[name] === true;
  }

  function assignedSectionIds() {
    return isAdmin() ? state.sections.map((section) => section.id) : toArray(state.assignment?.sectionIds);
  }

  function canManageContent(item) {
    if (isAdmin()) return true;
    const allowed = assignedSectionIds();
    const ids = toArray(item?.sectionIds);
    return ids.length > 0 && ids.every((id) => allowed.includes(id));
  }

  function allowedView(view) {
    if (isAdmin()) return views.includes(view);
    return ["dashboard", "content", "editor"].includes(view);
  }

  function applyAccessControl() {
    const admin = isAdmin();
    document.body.classList.toggle("supervisor-mode", !admin);
    $$('[data-admin-only]').forEach((element) => { element.hidden = !admin; });
    if ($("newContentButton")) $("newContentButton").hidden = !hasPermission("createContent");
    if ($("contentPublished")) $("contentPublished").disabled = !hasPermission("publishContent");
    if ($("contentSections")) {
      const allowed = assignedSectionIds();
      $("contentSections").placeholder = admin ? "action, featured" : allowed.join(", ");
    }
  }

  function sectionName(id) {
    const section = state.sections.find((item) => item.id === id);
    return section ? section.name : id;
  }

  function contentStatus(item) {
    return item.published === true
      ? '<span class="status-chip published">منشور</span>'
      : '<span class="status-chip draft">مسودة</span>';
  }

  function emptyTable(message, action) {
    return `<div class="table-empty"><span class="empty-mark">∅</span><b>${escapeHTML(message)}</b>${action ? `<small>${escapeHTML(action)}</small>` : ""}</div>`;
  }

  function parseCsv(value) {
    return [...new Set(String(value || "").split(/[,،]/).map((entry) => entry.trim()).filter(Boolean))].slice(0, 30);
  }

  function parseJsonField(id, fallback, label) {
    const raw = String($(id)?.value || "").trim();
    if (!raw) return fallback;
    try {
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) throw new Error(label + " يجب أن يكون مصفوفة JSON.");
      return value;
    } catch (error) {
      throw new Error(error.message || `صيغة ${label} غير صحيحة.`);
    }
  }

  function validMediaUrl(value) {
    const input = asString(value);
    if (/^assets\/[a-z0-9_./-]+$/i.test(input)) return input;
    try {
      const url = new URL(input);
      return url.protocol === "https:" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function inferMediaType(url, fallback = "video/mp4") {
    const input = asString(url).toLowerCase();
    try {
      const pathname = new URL(input).pathname.toLowerCase();
      if (pathname.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
      if (pathname.endsWith(".mp4")) return "video/mp4";
    } catch (_) {}
    if (/\.m3u8(?:$|[?#])/i.test(input)) return "application/vnd.apple.mpegurl";
    if (/\.mp4(?:$|[?#])/i.test(input)) return "video/mp4";
    return asString(fallback, "video/mp4").slice(0, 80);
  }

  function normalizeSources(value) {
    return toArray(value).slice(0, 8).map((source, index) => {
      const url = validMediaUrl(source && source.url);
      if (!url) throw new Error(`رابط المصدر رقم ${index + 1} يجب أن يكون HTTPS.`);
      return {
        label: asString(source.label, `المصدر ${index + 1}`).slice(0, 40),
        url,
        type: asString(source.type, "video/mp4").slice(0, 80)
      };
    });
  }

  function normalizeSubtitles(value) {
    return toArray(value).slice(0, 12).map((track, index) => {
      const src = validMediaUrl(track && (track.src || track.url));
      if (!src) throw new Error(`رابط الترجمة رقم ${index + 1} يجب أن يكون HTTPS.`);
      return {
        label: asString(track.label, "العربية").slice(0, 40),
        srclang: asString(track.srclang, "ar").toLowerCase().slice(0, 12),
        src
      };
    });
  }

  function normalizeSeasons(value, requireSources = true) {
    return toArray(value).slice(0, 100).map((season, seasonIndex) => {
      const number = Math.max(1, Math.round(asNumber(season.number, seasonIndex + 1)));
      const episodes = toArray(season.episodes).slice(0, 500).map((episode, episodeIndex) => ({
        id: asString(episode.id, `e${episode.number || episodeIndex + 1}`).slice(0, 80),
        number: Math.max(1, Math.round(asNumber(episode.number, episodeIndex + 1))),
        title: asString(episode.title, `الحلقة ${episode.number || episodeIndex + 1}`).slice(0, 150),
        duration: Math.max(0, Math.round(asNumber(episode.duration, 0))),
        thumbnail: validMediaUrl(episode.thumbnail || ""),
        sources: normalizeSources(episode.sources),
        subtitles: normalizeSubtitles(episode.subtitles)
      }));
      if (!episodes.length) throw new Error(`الموسم ${number} لا يحتوي حلقات.`);
      if (requireSources && episodes.some((episode) => !episode.sources.length)) throw new Error(`كل حلقة في الموسم ${number} تحتاج مصدراً واحداً على الأقل قبل النشر.`);
      return { number, title: asString(season.title, `الموسم ${number}`).slice(0, 120), episodes };
    });
  }

  function setBusy(form, busy) {
    if (!form) return;
    form.classList.toggle("is-busy", busy);
    $$('button[type="submit"]', form).forEach((button) => {
      button.disabled = busy;
      button.setAttribute("aria-busy", String(busy));
    });
  }

  function updateUserLabels() {
    const user = state.authUser;
    const email = user && user.email || ADMIN_EMAIL;
    const name = user && user.displayName || (isAdmin() ? "مدير CINARO" : "مشرف CINARO");
    $("adminUserName").textContent = name;
    $("adminUserEmail").textContent = email;
    $("adminEmail").value = email || ADMIN_EMAIL;
    $("adminUserAvatar").textContent = (name.trim()[0] || "A").toUpperCase();
  }

  function setMobileNavigation(open) {
    const sidebar = $("adminSidebar");
    const menuButton = $("menuButton");
    const shouldOpen = Boolean(open);
    sidebar?.classList.toggle("open", shouldOpen);
    document.body.classList.toggle("nav-open", shouldOpen);
    menuButton?.setAttribute("aria-expanded", String(shouldOpen));
  }

  function setView(view) {
    const requested = views.includes(view) ? view : "dashboard";
    const next = allowedView(requested) ? requested : "dashboard";
    if (next === "editor" && !state.editingContentId && !hasPermission("createContent")) {
      toast("لا تملك صلاحية إضافة محتوى", "error");
      return setView("content");
    }
    state.view = next;
    views.forEach((name) => $("view-" + name)?.classList.toggle("active", name === next));
    $$('[data-view]').forEach((button) => button.classList.toggle("active", button.dataset.view === next));
    const activeView = $("view-" + next);
    $("viewTitle").textContent = activeView?.dataset.title || "نظرة عامة";
    setMobileNavigation(false);
    if (next === "content") renderContent();
    if (next === "reports") renderReports();
    if (next === "requests") renderRequests();
    if (next === "users") renderUsers();
    if (next === "supervisors") renderSupervisors();
    if (next === "sections") renderSections();
    if (next === "activity") renderActivity();
  }

  function renderDashboard() {
    const published = state.content.filter((item) => item.published === true).length;
    const activeUsers = state.users.filter((item) => item.status !== "blocked").length;
    const views = state.content.reduce((sum, item) => sum + Math.max(0, asNumber(item.views)), 0);
    $("statContent").textContent = formatNumber(state.content.length);
    $("statPublished").textContent = `${formatNumber(published)} منشور`;
    $("statUsers").textContent = formatNumber(state.users.length);
    $("statActiveUsers").textContent = `${formatNumber(activeUsers)} نشط`;
    $("statViews").textContent = formatNumber(views);
    $("statSupervisors").textContent = formatNumber(state.supervisors.filter((item) => item.active !== false).length);
    if ($("statRequests")) $("statRequests").textContent = formatNumber(state.requests.filter((item) => ["new", "reviewing"].includes(item.status)).length);
    if ($("statReports")) $("statReports").textContent = formatNumber(state.reports.filter((item) => item.status !== "resolved").length);
    $("navContentCount").textContent = formatNumber(state.content.length);
    $("navUsersCount").textContent = formatNumber(state.users.length);
    if ($("navReportsCount")) $("navReportsCount").textContent = formatNumber(state.reports.filter((item) => item.status !== "resolved").length);
    if ($("navRequestsCount")) $("navRequestsCount").textContent = formatNumber(state.requests.filter((item) => ["new", "reviewing"].includes(item.status)).length);
    if ($("mobileRequestsCount")) {
      const requestCount = state.requests.filter((item) => ["new", "reviewing"].includes(item.status)).length;
      $("mobileRequestsCount").textContent = requestCount ? formatNumber(requestCount) : "";
      $("mobileRequestsCount").hidden = requestCount === 0;
    }

    const recent = [...state.content].sort((a, b) => asNumber(b.updatedAt || b.createdAt) - asNumber(a.updatedAt || a.createdAt)).slice(0, 5);
    $("recentContent").innerHTML = recent.length ? recent.map((item) => `
      <button class="mini-row" type="button" data-action="edit-content" data-id="${escapeHTML(item.id)}">
        <span class="mini-cover" style="background-image:url('${escapeHTML(item.poster || "../web/assets/images/poster-placeholder.webp")}')"></span>
        <span><b>${escapeHTML(item.title)}</b><small>${item.kind === "series" ? "مسلسل" : "فيلم"} · ${contentStatus(item)}</small></span><svg><use href="#i-arrow-left"></use></svg>
      </button>`).join("") : emptyTable("لا يوجد محتوى بعد", "أضف أول فيلم أو مسلسل من محرر المحتوى.");
    const recentLogs = [...state.logs].sort((a, b) => asNumber(b.createdAt) - asNumber(a.createdAt)).slice(0, 5);
    $("recentActivity").innerHTML = recentLogs.length ? recentLogs.map((log) => `
      <div class="mini-row log-row"><span class="log-dot"></span><span><b>${escapeHTML(log.action || "عملية")}</b><small>${escapeHTML(log.target || "—")} · ${escapeHTML(formatDate(log.createdAt))}</small></span></div>`).join("") : emptyTable("لا توجد عمليات مسجلة", "تظهر هنا عمليات الإدارة بعد أول تعديل.");
  }

  function renderContent() {
    const search = state.filters.contentSearch.toLocaleLowerCase("ar");
    const rows = state.content.filter((item) => {
      if (!canManageContent(item)) return false;
      const matchesSearch = !search || [item.id, item.title, item.englishTitle].some((value) => asString(value).toLocaleLowerCase("ar").includes(search));
      const matchesKind = state.filters.contentKind === "all" || item.kind === state.filters.contentKind;
      const matchesStatus = state.filters.contentStatus === "all" || (state.filters.contentStatus === "published" ? item.published === true : item.published !== true);
      return matchesSearch && matchesKind && matchesStatus;
    }).sort((a, b) => asNumber(b.order) - asNumber(a.order) || asNumber(b.updatedAt) - asNumber(a.updatedAt));
    if (!rows.length) {
      $("contentTable").innerHTML = emptyTable(state.content.length ? "لا توجد نتائج مطابقة" : "لا يوجد محتوى حقيقي بعد", state.content.length ? "غيّر خيارات البحث أو التصفية." : "استخدم زر إضافة محتوى لإنشاء أول عنصر.");
      return;
    }
    $("contentTable").innerHTML = `<div class="data-table content-data-table"><div class="data-head"><span>العنوان</span><span>النوع</span><span>الأقسام</span><span>الحالة</span><span>إجراءات</span></div>${rows.map((item) => {
      const editButton = hasPermission("editContent") ? `<button class="table-action" type="button" data-action="edit-content" data-id="${escapeHTML(item.id)}" title="تعديل"><svg><use href="#i-edit"></use></svg></button>` : "";
      const publishButton = hasPermission("publishContent") ? `<button class="table-action" type="button" data-action="toggle-published" data-id="${escapeHTML(item.id)}" title="${item.published ? "إلغاء النشر" : "نشر"}"><svg><use href="#i-${item.published ? "x" : "check"}"></use></svg></button>` : "";
      const deleteButton = hasPermission("deleteContent") ? `<button class="table-action danger" type="button" data-action="delete-content" data-id="${escapeHTML(item.id)}" title="حذف"><svg><use href="#i-trash"></use></svg></button>` : "";
      return `<div class="data-row"><div class="title-cell"><span class="table-cover" style="background-image:url('${escapeHTML(item.poster || "../web/assets/images/poster-placeholder.webp")}')"></span><span><b>${escapeHTML(item.title)}</b><small>${escapeHTML(item.id)} · ${escapeHTML(String(item.year || "—"))}</small></span></div><span class="kind-chip">${item.kind === "series" ? "مسلسل" : "فيلم"}</span><span class="tag-list">${toArray(item.sectionIds).length ? item.sectionIds.slice(0, 3).map((id) => `<em>${escapeHTML(sectionName(id))}</em>`).join("") : "<em>عام</em>"}</span><span>${contentStatus(item)}</span><span class="row-actions">${editButton}${publishButton}${deleteButton || (!editButton && !publishButton ? '<small class="protected-label">عرض فقط</small>' : "")}</span></div>`;
    }).join("")}</div>`;
  }

  function renderUsers() {
    const search = state.filters.userSearch.toLocaleLowerCase("ar");
    const rows = state.users.filter((user) => {
      const matchesSearch = !search || [user.email, user.displayName, user.id].some((value) => asString(value).toLocaleLowerCase("ar").includes(search));
      const matchesStatus = state.filters.userStatus === "all" || (state.filters.userStatus === "blocked" ? user.status === "blocked" : user.status !== "blocked");
      return matchesSearch && matchesStatus;
    }).sort((a, b) => asNumber(b.updatedAt || b.createdAt) - asNumber(a.updatedAt || a.createdAt));
    if (!rows.length) {
      $("usersTable").innerHTML = emptyTable(state.users.length ? "لا توجد نتائج مطابقة" : "لا يوجد مستخدمون بعد", "سيظهر المستخدمون بعد التسجيل من تطبيق CINARO.");
      return;
    }
    $("usersTable").innerHTML = `<div class="data-table users-data-table"><div class="data-head"><span>المستخدم</span><span>النوع</span><span>آخر تحديث</span><span>الحالة</span><span>إجراء</span></div>${rows.map((user) => {
      const blocked = user.status === "blocked";
      const isAdmin = asString(user.email).toLowerCase() === ADMIN_EMAIL;
      return `<div class="data-row"><div class="title-cell user-cell"><span class="user-table-avatar">${escapeHTML((asString(user.displayName || user.email, "؟")[0] || "؟").toUpperCase())}</span><span><b>${escapeHTML(user.displayName || "بدون اسم")}</b><small>${escapeHTML(user.email || "ضيف بدون بريد")} · <code>${escapeHTML(user.id)}</code></small></span></div><span class="kind-chip">${user.isAnonymous ? "ضيف" : isAdmin ? "مدير" : "حساب"}</span><span>${escapeHTML(formatDate(user.updatedAt || user.createdAt))}</span><span>${blocked ? '<span class="status-chip blocked">محظور</span>' : '<span class="status-chip published">نشط</span>'}</span><span class="row-actions">${isAdmin ? '<small class="protected-label">محمي</small>' : `<button class="table-action ${blocked ? "success-action" : "danger"}" type="button" data-action="toggle-user" data-id="${escapeHTML(user.id)}" data-status="${blocked ? "active" : "blocked"}" title="${blocked ? "تفعيل" : "حظر"}"><svg><use href="#i-${blocked ? "check" : "shield"}"></use></svg></button>`}</span></div>`;
    }).join("")}</div>`;
  }

  function renderSupervisors() {
    const rows = [...state.supervisors].sort((a, b) => asNumber(b.updatedAt) - asNumber(a.updatedAt));
    $("supervisorsTable").innerHTML = rows.length ? `<div class="data-table supervisors-data-table"><div class="data-head"><span>المشرف</span><span>الأقسام</span><span>الصلاحيات</span><span>الحالة</span><span>إجراءات</span></div>${rows.map((item) => `<div class="data-row"><div class="title-cell user-cell"><span class="user-table-avatar accent">${escapeHTML((asString(item.displayName || item.email, "م")[0] || "م").toUpperCase())}</span><span><b>${escapeHTML(item.displayName || "مشرف")}</b><small>${escapeHTML(item.email || "—")} · <code>${escapeHTML(item.uid || item.id)}</code></small></span></div><span class="tag-list">${toArray(item.sectionIds).map((id) => `<em>${escapeHTML(sectionName(id))}</em>`).join("") || "<em>غير محدد</em>"}</span><span class="permission-summary">${item.permissions?.createContent ? "إضافة " : ""}${item.permissions?.editContent ? "تعديل " : ""}${item.permissions?.deleteContent ? "حذف " : ""}${item.permissions?.publishContent ? "نشر" : ""}</span><span>${item.active === false ? '<span class="status-chip blocked">متوقف</span>' : '<span class="status-chip published">فعال</span>'}</span><span class="row-actions"><button class="table-action" type="button" data-action="edit-supervisor" data-id="${escapeHTML(item.uid || item.id)}" title="تعديل"><svg><use href="#i-edit"></use></svg></button><button class="table-action danger" type="button" data-action="delete-supervisor" data-id="${escapeHTML(item.uid || item.id)}" title="حذف"><svg><use href="#i-trash"></use></svg></button></span></div>`).join("")}</div>` : emptyTable("لا يوجد مشرفون معينون", "أنشئ تعييناً واربطه بقسم واحد أو أكثر.");
  }

  function renderSections() {
    const rows = [...state.sections].sort((a, b) => asString(a.name).localeCompare(asString(b.name), "ar"));
    $("sectionsTable").innerHTML = rows.length ? `<div class="data-table sections-data-table"><div class="data-head"><span>القسم</span><span>المعرّف</span><span>المحتوى</span><span>الحالة</span><span>إجراءات</span></div>${rows.map((item) => `<div class="data-row"><div class="title-cell"><span class="section-mark"><svg><use href="#i-layers"></use></svg></span><span><b>${escapeHTML(item.name)}</b><small>${escapeHTML(item.description || "بدون وصف")}</small></span></div><code>${escapeHTML(item.id)}</code><span>${formatNumber(state.content.filter((content) => toArray(content.sectionIds).includes(item.id)).length)}</span><span>${item.active === false ? '<span class="status-chip blocked">متوقف</span>' : '<span class="status-chip published">فعال</span>'}</span><span class="row-actions"><button class="table-action" type="button" data-action="edit-section" data-id="${escapeHTML(item.id)}" title="تعديل"><svg><use href="#i-edit"></use></svg></button><button class="table-action danger" type="button" data-action="delete-section" data-id="${escapeHTML(item.id)}" title="حذف"><svg><use href="#i-trash"></use></svg></button></span></div>`).join("")}</div>` : emptyTable("لا توجد أقسام بعد", "أنشئ قسماً لاستخدامه في المحتوى وتعيينات المشرفين.");
  }

  function renderReports() {
    const categoryNames = {
      playback: "الفيديو لا يعمل",
      "wrong-content": "محتوى غير صحيح",
      audio: "مشكلة صوت",
      subtitles: "مشكلة ترجمة",
      other: "أخرى"
    };
    const rows = [...state.reports].filter((report) => (
      state.filters.reportStatus === "all" ||
      (state.filters.reportStatus === "resolved" ? report.status === "resolved" : report.status !== "resolved")
    )).sort((a, b) => asNumber(b.createdAt) - asNumber(a.createdAt));
    if (!rows.length) {
      $("reportsTable").innerHTML = emptyTable("لا توجد بلاغات ضمن هذه الحالة", "ستظهر هنا بلاغات المستخدمين من مشغل الفيديو.");
      return;
    }
    $("reportsTable").innerHTML = `<div class="data-table reports-data-table"><div class="data-head"><span>المحتوى</span><span>المشكلة</span><span>التفاصيل والمستخدم</span><span>الحالة</span><span>إجراءات</span></div>${rows.map((report) => {
      const resolved = report.status === "resolved";
      const episode = report.kind === "series" ? ` · م${asNumber(report.season)} ح${asNumber(report.episode)}` : "";
      const preview = report.sourceUrl ? `<button class="table-action" type="button" data-action="preview-url" data-url="${escapeHTML(report.sourceUrl)}" title="معاينة المصدر"><svg><use href="#i-eye"></use></svg></button>` : "";
      return `<div class="data-row"><span class="report-content"><b>${escapeHTML(report.contentTitle || report.contentId || "محتوى محذوف")}</b><small>${escapeHTML(report.contentId || "—")}${escapeHTML(episode)}</small></span><span class="kind-chip">${escapeHTML(categoryNames[report.category] || report.category || "أخرى")}</span><span class="report-details">${escapeHTML(report.details || "بلا تفاصيل")}<small>${escapeHTML(report.userEmail || report.userId || "مستخدم")}</small></span><span>${resolved ? '<span class="status-chip published">تمت المعالجة</span>' : '<span class="status-chip blocked">مفتوح</span>'}</span><span class="row-actions">${preview}<button class="table-action ${resolved ? "" : "success-action"}" type="button" data-action="toggle-report" data-id="${escapeHTML(report.id)}" data-status="${resolved ? "open" : "resolved"}" title="${resolved ? "إعادة فتح" : "وضع كمعالج"}"><svg><use href="#i-${resolved ? "activity" : "check"}"></use></svg></button></span></div>`;
    }).join("")}</div>`;
  }

  function renderRequests() {
    const statusLabels = {
      new: "جديد",
      reviewing: "قيد المراجعة",
      added: "تمت الإضافة",
      rejected: "مرفوض"
    };
    const requestedStatus = state.filters.requestStatus;
    const rows = [...state.requests].filter((request) => {
      if (requestedStatus === "all") return true;
      if (requestedStatus === "pending") return ["new", "reviewing"].includes(request.status);
      return request.status === requestedStatus;
    }).sort((a, b) => asNumber(b.createdAt) - asNumber(a.createdAt));

    if (!rows.length) {
      $("requestsTable").innerHTML = emptyTable("لا توجد طلبات ضمن هذه الحالة", "طلبات الأفلام والمسلسلات الجديدة ستظهر هنا.");
      return;
    }

    $("requestsTable").innerHTML = `<div class="data-table requests-data-table"><div class="data-head"><span>الطلب</span><span>المستخدم</span><span>الحالة</span><span>ملاحظة الإدارة</span><span>حفظ</span></div>${rows.map((request) => {
      const status = ["new", "reviewing", "added", "rejected"].includes(request.status) ? request.status : "new";
      const options = Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${value === status ? "selected" : ""}>${label}</option>`).join("");
      return `<div class="data-row">
        <span class="request-title-cell"><b>${escapeHTML(request.title || "طلب محتوى")}</b><small>${request.kind === "series" ? "مسلسل" : "فيلم"} · ${escapeHTML(request.notes || "بدون ملاحظات")}</small></span>
        <span class="request-user-cell"><b>${escapeHTML(request.userEmail || "—")}</b><small>${escapeHTML(formatDate(request.createdAt))}</small></span>
        <select class="request-status-control" data-request-select="${escapeHTML(request.id)}">${options}</select>
        <input class="request-note-control" data-request-note="${escapeHTML(request.id)}" maxlength="600" value="${escapeHTML(request.adminNote || "")}" placeholder="ملاحظة اختيارية للمستخدم">
        <span class="row-actions"><button class="table-action success-action" type="button" data-action="save-request" data-id="${escapeHTML(request.id)}" title="حفظ الحالة"><svg><use href="#i-save"></use></svg></button></span>
      </div>`;
    }).join("")}</div>`;
  }

  async function saveContentRequest(id) {
    if (!isAdmin() || !state.firebase) return;
    const statusControl = Array.from(document.querySelectorAll("[data-request-select]")).find((element) => element.dataset.requestSelect === id);
    const noteControl = Array.from(document.querySelectorAll("[data-request-note]")).find((element) => element.dataset.requestNote === id);
    const status = ["new", "reviewing", "added", "rejected"].includes(statusControl?.value) ? statusControl.value : "new";
    const adminNote = asString(noteControl?.value).slice(0, 600);

    try {
      await state.firebase.saveDocument("contentRequests", id, {
        status,
        adminNote,
        handledBy: state.authUser.uid
      });
      await state.firebase.logAudit("تحديث طلب محتوى", id, `${status} · ${adminNote || "بدون ملاحظة"}`, state.authUser);
      toast("تم تحديث حالة الطلب");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  function renderActivity() {
    const rows = [...state.logs].sort((a, b) => asNumber(b.createdAt) - asNumber(a.createdAt));
    $("activityTable").innerHTML = rows.length ? `<div class="data-table activity-data-table"><div class="data-head"><span>العملية</span><span>الهدف</span><span>المنفذ</span><span>التفاصيل</span><span>الوقت</span></div>${rows.map((item) => `<div class="data-row"><span class="activity-action"><span class="log-dot"></span><b>${escapeHTML(item.action || "عملية")}</b></span><code>${escapeHTML(item.target || "—")}</code><span>${escapeHTML(item.actorEmail || item.actorUid || "—")}</span><span>${escapeHTML(item.details || "—")}</span><span>${escapeHTML(formatDate(item.createdAt))}</span></div>`).join("")}</div>` : emptyTable("سجل العمليات فارغ", "تُحفظ هنا عمليات المحتوى والأقسام والحسابات.");
  }

  function readTmdbToken() {
    try { return String(localStorage.getItem(TMDB_STORAGE_KEY) || "").trim(); }
    catch (_) { return ""; }
  }

  function writeTmdbToken(token) {
    const value = asString(token);
    try {
      if (value) localStorage.setItem(TMDB_STORAGE_KEY, value);
      else localStorage.removeItem(TMDB_STORAGE_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  function setTmdbMessage(message = "", type = "") {
    setMessage("tmdbImportMessage", message, type);
  }

  function fillTmdbSettings() {
    const input = $("tmdbTokenInput");
    if (!input) return;
    const token = readTmdbToken();
    input.value = token;
    setMessage("tmdbSettingsMessage", token ? "التوكن محفوظ محلياً داخل تطبيق الإدارة." : "لم تتم إضافة TMDb Token بعد.", token ? "success" : "");
  }

  function setImportMode(mode) {
    const next = mode === "tmdb" && isAdmin() ? "tmdb" : "manual";
    state.tmdb.importMode = next;
    $$("[data-import-mode]").forEach((button) => button.classList.toggle("active", button.dataset.importMode === next));
    $("tmdbImportPanel")?.classList.toggle("is-hidden", next !== "tmdb");
    if (next === "tmdb" && !readTmdbToken()) {
      setTmdbMessage("أضف TMDb Read Access Token من إعدادات التطبيق أولاً.", "error");
    } else if (next === "tmdb") {
      setTmdbMessage("ابحث عن الفيلم أو المسلسل ثم اختر النتيجة الصحيحة.");
    } else {
      setTmdbMessage("");
    }
  }

  async function tmdbRequest(pathname, query = {}) {
    const token = readTmdbToken();
    if (!token) throw new Error("أضف TMDb Read Access Token من إعدادات التطبيق أولاً.");
    const url = new URL(TMDB_API_ROOT + pathname);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store"
    });
    if (response.status === 401) throw new Error("TMDb Token غير صالح أو انتهت صلاحيته.");
    if (response.status === 429) throw new Error("TMDb طلبات كثيرة حالياً. حاول بعد قليل.");
    if (!response.ok) throw new Error(`تعذّر الاتصال بـTMDb (HTTP ${response.status}).`);
    return response.json();
  }

  async function ensureTmdbConfiguration(force = false) {
    if (state.tmdb.configuration && !force) return state.tmdb.configuration;
    const configuration = await tmdbRequest("/configuration");
    if (!configuration?.images?.secure_base_url) throw new Error("تعذّر قراءة إعدادات صور TMDb.");
    state.tmdb.configuration = configuration;
    return configuration;
  }

  function tmdbImage(filePath, preferredSize = "w500") {
    if (!filePath) return "";
    const images = state.tmdb.configuration?.images;
    const base = asString(images?.secure_base_url, "https://image.tmdb.org/t/p/");
    const sizes = [...toArray(images?.poster_sizes), ...toArray(images?.backdrop_sizes), ...toArray(images?.still_sizes)];
    const size = sizes.includes(preferredSize) ? preferredSize : (sizes.includes("original") ? "original" : preferredSize);
    return `${base}${size}${filePath}`;
  }

  function tmdbDateYear(value) {
    const match = String(value || "").match(/^(\d{4})/);
    return match ? Number(match[1]) : new Date().getFullYear();
  }

  function tmdbCertification(details, kind) {
    if (kind === "movie") {
      const rows = toArray(details?.release_dates?.results);
      for (const country of ["IQ", "US", "GB"]) {
        const certification = toArray(rows.find((row) => row.iso_3166_1 === country)?.release_dates)
          .map((item) => asString(item.certification))
          .find(Boolean);
        if (certification) return certification;
      }
    } else {
      const rows = toArray(details?.content_ratings?.results);
      for (const country of ["IQ", "US", "GB"]) {
        const rating = asString(rows.find((row) => row.iso_3166_1 === country)?.rating);
        if (rating) return rating;
      }
    }
    return "عام";
  }

  function renderTmdbResults(kind, rows) {
    state.tmdb.results = rows;
    const root = $("tmdbSearchResults");
    if (!root) return;
    if (!rows.length) {
      root.innerHTML = '<div class="tmdb-empty">لا توجد نتائج مطابقة. جرّب اسماً آخر.</div>';
      return;
    }
    root.innerHTML = rows.slice(0, 20).map((item) => {
      const title = kind === "movie" ? item.title : item.name;
      const original = kind === "movie" ? item.original_title : item.original_name;
      const date = kind === "movie" ? item.release_date : item.first_air_date;
      const poster = tmdbImage(item.poster_path, "w342") || "../web/assets/images/poster-placeholder.webp";
      return `<button class="tmdb-result-card" type="button" data-action="tmdb-select" data-tmdb-id="${escapeHTML(item.id)}" data-tmdb-kind="${escapeHTML(kind)}">
        <img src="${escapeHTML(poster)}" alt="">
        <span><b>${escapeHTML(title || original || "بدون عنوان")}</b><small>${escapeHTML(original && original !== title ? original : "")}</small><em>${escapeHTML(date ? String(date).slice(0, 4) : "—")} · TMDb ${escapeHTML(asNumber(item.vote_average).toFixed(1))}</em></span>
      </button>`;
    }).join("");
  }

  async function searchTmdb() {
    if (!isAdmin() || state.tmdb.busy) return;
    const query = asString($("tmdbSearchInput")?.value);
    if (query.length < 2) {
      setTmdbMessage("اكتب حرفين على الأقل للبحث.", "error");
      return;
    }
    const kind = $("contentKind").value === "series" ? "series" : "movie";
    state.tmdb.busy = true;
    $("tmdbSearchButton").disabled = true;
    setTmdbMessage("جاري البحث في TMDb…", "pending");
    try {
      await ensureTmdbConfiguration();
      const payload = await tmdbRequest(kind === "movie" ? "/search/movie" : "/search/tv", {
        query,
        language: "ar-IQ",
        include_adult: "false",
        page: 1
      });
      const rows = toArray(payload?.results);
      renderTmdbResults(kind, rows);
      setTmdbMessage(rows.length ? `تم العثور على ${Math.min(rows.length, 20)} نتيجة. اختر النتيجة الصحيحة.` : "لم يتم العثور على نتائج.", rows.length ? "success" : "");
    } catch (error) {
      renderTmdbResults(kind, []);
      setTmdbMessage(errorMessage(error), "error");
    } finally {
      state.tmdb.busy = false;
      $("tmdbSearchButton").disabled = false;
    }
  }

  async function fetchTmdbSeriesSeasons(seriesId, seasons) {
    const source = toArray(seasons).filter((season) => asNumber(season.season_number) > 0 && asNumber(season.episode_count) > 0).slice(0, 100);
    const output = [];
    for (let offset = 0; offset < source.length; offset += 4) {
      const batch = source.slice(offset, offset + 4);
      const rows = await Promise.all(batch.map(async (season) => {
        try {
          const details = await tmdbRequest(`/tv/${seriesId}/season/${season.season_number}`, { language: "ar-IQ" });
          return {
            number: Math.max(1, asNumber(details.season_number, season.season_number)),
            title: asString(details.name, `الموسم ${season.season_number}`),
            episodes: toArray(details.episodes).map((episode) => ({
              id: `e${Math.max(1, asNumber(episode.episode_number, 1))}`,
              number: Math.max(1, asNumber(episode.episode_number, 1)),
              title: asString(episode.name, `الحلقة ${episode.episode_number}`),
              duration: Math.max(0, asNumber(episode.runtime, 0)),
              thumbnail: tmdbImage(episode.still_path, "w780"),
              url: "",
              backupUrl: "",
              subtitleUrl: "",
              primarySource: null,
              backupSource: null,
              extraSources: [],
              primarySubtitle: null,
              extraSubtitles: []
            }))
          };
        } catch (error) {
          console.warn("CINARO TMDb season import failed", season.season_number, error);
          return null;
        }
      }));
      output.push(...rows.filter(Boolean));
      setTmdbMessage(`جاري استيراد المواسم… ${Math.min(offset + batch.length, source.length)}/${source.length}`, "pending");
    }
    return output;
  }

  async function importTmdbItem(id, kind) {
    if (!isAdmin() || state.tmdb.busy) return;
    const tmdbId = Math.max(1, Math.round(asNumber(id, 0)));
    const normalizedKind = kind === "series" ? "series" : "movie";
    state.tmdb.busy = true;
    setTmdbMessage("جاري تحميل تفاصيل TMDb…", "pending");
    try {
      await ensureTmdbConfiguration();
      const namespace = normalizedKind === "movie" ? "movie" : "tv";
      const append = normalizedKind === "movie" ? "release_dates" : "content_ratings";
      const [detailsAr, detailsEn] = await Promise.all([
        tmdbRequest(`/${namespace}/${tmdbId}`, { language: "ar-IQ", append_to_response: append }),
        tmdbRequest(`/${namespace}/${tmdbId}`, { language: "en-US" })
      ]);
      $("contentKind").value = normalizedKind;
      $("contentTmdbId").value = String(tmdbId);

      const titleAr = normalizedKind === "movie" ? detailsAr.title : detailsAr.name;
      const titleEn = normalizedKind === "movie" ? detailsEn.title : detailsEn.name;
      const original = normalizedKind === "movie" ? detailsAr.original_title : detailsAr.original_name;
      const releaseDate = normalizedKind === "movie" ? detailsAr.release_date : detailsAr.first_air_date;

      if ($("tmdbImportBasic").checked) {
        $("contentTitle").value = asString(titleAr, asString(titleEn, original));
        $("contentEnglishTitle").value = asString(titleEn, original);
        $("contentYear").value = tmdbDateYear(releaseDate);
        $("contentRating").value = Math.max(0, Math.min(10, asNumber(detailsAr.vote_average, 0))).toFixed(1);
        $("contentDuration").value = normalizedKind === "movie"
          ? Math.max(0, Math.round(asNumber(detailsAr.runtime, 0)))
          : Math.max(0, Math.round(asNumber(toArray(detailsAr.episode_run_time)[0], 0)));
        if (!$("contentId").value.trim()) $("contentId").value = `tmdb-${normalizedKind}-${tmdbId}`;
      }
      if ($("tmdbImportDescription").checked) {
        $("contentDescription").value = asString(detailsAr.overview, asString(detailsEn.overview));
      }
      if ($("tmdbImportImages").checked) {
        const poster = tmdbImage(detailsAr.poster_path || detailsEn.poster_path, "w500");
        const backdrop = tmdbImage(detailsAr.backdrop_path || detailsEn.backdrop_path, "w1280");
        if (poster) $("contentPoster").value = poster;
        if (backdrop) $("contentBackdrop").value = backdrop;
        $("posterPreview").src = poster || "../web/assets/images/poster-placeholder.webp";
        $("backdropPreview").src = backdrop || poster || "../web/assets/images/poster-placeholder.webp";
      }
      if ($("tmdbImportGenres").checked) {
        $("contentGenres").value = toArray(detailsAr.genres).map((genre) => asString(genre.name)).filter(Boolean).join(", ");
        $("contentAgeRating").value = tmdbCertification(detailsAr, normalizedKind);
      }
      if (normalizedKind === "series" && $("tmdbImportEpisodes").checked) {
        state.seasonDraft = await fetchTmdbSeriesSeasons(tmdbId, detailsAr.seasons);
        renderSeasonBuilder();
      }
      toggleKindFields();
      setTmdbMessage("تم استيراد البيانات. راجع الحقول وأضف روابط التشغيل قبل النشر.", "success");
      $("contentTitle")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      setTmdbMessage(errorMessage(error), "error");
    } finally {
      state.tmdb.busy = false;
    }
  }

  async function testTmdbToken() {
    const candidate = asString($("tmdbTokenInput")?.value);
    if (!candidate) {
      setMessage("tmdbSettingsMessage", "ألصق TMDb Token أولاً.", "error");
      return;
    }
    const previous = readTmdbToken();
    if (!writeTmdbToken(candidate)) {
      setMessage("tmdbSettingsMessage", "تعذّر حفظ التوكن على هذا الجهاز.", "error");
      return;
    }
    state.tmdb.configuration = null;
    setMessage("tmdbSettingsMessage", "جاري اختبار الاتصال…", "pending");
    try {
      await ensureTmdbConfiguration(true);
      setMessage("tmdbSettingsMessage", "الاتصال بـTMDb ناجح والتوكن صالح.", "success");
    } catch (error) {
      if (previous) writeTmdbToken(previous); else writeTmdbToken("");
      state.tmdb.configuration = null;
      setMessage("tmdbSettingsMessage", errorMessage(error), "error");
    }
  }

  function bindCopyProtection() {
    const isEditable = (target) => Boolean(target?.closest?.("input, textarea, select, [contenteditable='true'], .allow-select"));
    ["copy", "cut", "contextmenu"].forEach((eventName) => {
      document.addEventListener(eventName, (event) => {
        if (isEditable(event.target)) return;
        event.preventDefault();
      });
    });
    document.addEventListener("dragstart", (event) => {
      if (event.target instanceof HTMLImageElement) event.preventDefault();
    });
  }

  function fillSettings() {
    $("settingFeatured").value = toArray(state.config.featured).join(", ");
    $("settingAnnouncement").value = asString(state.config.announcement);
    $("settingLatestVersion").value = asString(state.config.latestVersion, "2.4.0");
    $("settingMinVersion").value = asString(state.config.minimumVersion, "2.4.0");
    $("settingUpdateUrl").value = asString(state.config.updateUrl, "https://github.com/3c5-o/CINARO/releases");
    $("settingUpdateNotes").value = asString(state.config.updateNotes);
    $("settingMaintenance").checked = state.config.maintenance === true;
    $("settingForceUpdate").checked = state.config.forceUpdate === true;
    fillTmdbSettings();
  }

  function newEpisode(number = 1) {
    return {
      id: `e${number}`,
      number,
      title: `الحلقة ${number}`,
      duration: 0,
      thumbnail: "",
      url: "",
      backupUrl: "",
      subtitleUrl: "",
      primarySource: null,
      backupSource: null,
      extraSources: [],
      primarySubtitle: null,
      extraSubtitles: []
    };
  }

  function newSeason(number = 1) {
    return { number, title: `الموسم ${number}`, episodes: [newEpisode(1)] };
  }

  function renderSeasonBuilder() {
    const root = $("seasonBuilder");
    if (!root) return;
    if (!state.seasonDraft.length) {
      root.innerHTML = '<div class="season-builder-empty">لا توجد مواسم بعد. اضغط «إضافة موسم» للبدء.</div>';
      return;
    }
    root.innerHTML = state.seasonDraft.map((season, seasonIndex) => `
      <article class="season-card">
        <div class="season-card-head">
          <label><span>رقم الموسم</span><input type="number" min="1" value="${escapeHTML(season.number)}" data-season-index="${seasonIndex}" data-season-field="number"></label>
          <label><span>اسم الموسم</span><input value="${escapeHTML(season.title)}" maxlength="120" data-season-index="${seasonIndex}" data-season-field="title"></label>
          <button class="table-action danger" type="button" data-action="remove-season" data-season-index="${seasonIndex}" title="حذف الموسم"><svg><use href="#i-trash"></use></svg></button>
        </div>
        <div class="episode-builder-list">${season.episodes.map((episode, episodeIndex) => `
          <div class="episode-builder-row">
            <label><span>رقم الحلقة</span><input type="number" min="1" value="${escapeHTML(episode.number)}" data-season-index="${seasonIndex}" data-episode-index="${episodeIndex}" data-episode-field="number"></label>
            <label><span>اسم الحلقة</span><input value="${escapeHTML(episode.title)}" maxlength="150" data-season-index="${seasonIndex}" data-episode-index="${episodeIndex}" data-episode-field="title"></label>
            <label><span>رابط الحلقة الأساسي</span><input type="url" inputmode="url" value="${escapeHTML(episode.url || "")}" placeholder="https://…/video.mp4 أو stream.m3u8" data-season-index="${seasonIndex}" data-episode-index="${episodeIndex}" data-episode-field="url"></label>
            <label><span>رابط احتياطي</span><input type="url" inputmode="url" value="${escapeHTML(episode.backupUrl || "")}" placeholder="اختياري" data-season-index="${seasonIndex}" data-episode-index="${episodeIndex}" data-episode-field="backupUrl"></label>
            <label><span>صورة الحلقة</span><input type="url" inputmode="url" value="${escapeHTML(episode.thumbnail || "")}" placeholder="https://…/episode.webp" data-season-index="${seasonIndex}" data-episode-index="${episodeIndex}" data-episode-field="thumbnail"></label>
            <label><span>ترجمة عربية VTT</span><input type="url" inputmode="url" value="${escapeHTML(episode.subtitleUrl || "")}" placeholder="اختياري" data-season-index="${seasonIndex}" data-episode-index="${episodeIndex}" data-episode-field="subtitleUrl"></label>
            <label><span>المدة</span><input type="number" min="0" value="${escapeHTML(episode.duration)}" data-season-index="${seasonIndex}" data-episode-index="${episodeIndex}" data-episode-field="duration"></label>
            <button class="table-action danger" type="button" data-action="remove-episode" data-season-index="${seasonIndex}" data-episode-index="${episodeIndex}" title="حذف الحلقة"><svg><use href="#i-x"></use></svg></button>
          </div>`).join("")}</div>
        <div class="season-builder-actions"><button class="admin-button ghost" type="button" data-action="add-episode" data-season-index="${seasonIndex}"><svg><use href="#i-plus"></use></svg> إضافة حلقة</button></div>
      </article>`).join("");
  }

  function seasonsFromEditor() {
    return state.seasonDraft.map((season, seasonIndex) => ({
      number: Math.max(1, Math.round(asNumber(season.number, seasonIndex + 1))),
      title: asString(season.title, `الموسم ${seasonIndex + 1}`),
      episodes: toArray(season.episodes).map((episode, episodeIndex) => {
        const number = Math.max(1, Math.round(asNumber(episode.number, episodeIndex + 1)));
        const primaryUrl = asString(episode.url);
        const backupUrl = asString(episode.backupUrl);
        const sourceCandidates = [];
        if (primaryUrl) {
          sourceCandidates.push({
            label: asString(episode.primarySource?.label, "تلقائي"),
            url: primaryUrl,
            type: inferMediaType(primaryUrl, episode.primarySource?.type)
          });
        }
        if (backupUrl) {
          sourceCandidates.push({
            label: asString(episode.backupSource?.label, "احتياطي"),
            url: backupUrl,
            type: inferMediaType(backupUrl, episode.backupSource?.type)
          });
        }
        sourceCandidates.push(...toArray(episode.extraSources));

        const subtitleCandidates = [];
        const subtitleUrl = asString(episode.subtitleUrl);
        if (subtitleUrl) {
          subtitleCandidates.push({
            label: asString(episode.primarySubtitle?.label, "العربية"),
            srclang: asString(episode.primarySubtitle?.srclang, "ar"),
            src: subtitleUrl
          });
        }
        subtitleCandidates.push(...toArray(episode.extraSubtitles));

        return {
          id: asString(episode.id, `e${number}`).slice(0, 80),
          number,
          title: asString(episode.title, `الحلقة ${episodeIndex + 1}`),
          duration: Math.max(0, Math.round(asNumber(episode.duration))),
          thumbnail: validMediaUrl(episode.thumbnail || ""),
          sources: normalizeSources(sourceCandidates),
          subtitles: normalizeSubtitles(subtitleCandidates)
        };
      })
    }));
  }

  function toggleKindFields() {
    const series = $("contentKind").value === "series";
    $("movieMediaFields")?.classList.toggle("is-hidden", series);
    $("seriesMediaFields")?.classList.toggle("is-hidden", !series);
    if (series && !state.seasonDraft.length) {
      state.seasonDraft = [newSeason(1)];
      renderSeasonBuilder();
    }
  }

  function resetContentForm() {
    state.editingContentId = "";
    state.pendingRequestId = "";
    state.pendingRequestTitle = "";
    $("contentForm")?.reset();
    $("contentTmdbId").value = "";
    $("tmdbSearchInput").value = "";
    $("tmdbSearchResults").innerHTML = "";
    state.tmdb.results = [];
    setImportMode("manual");
    $("contentYear").value = new Date().getFullYear();
    $("contentAgeRating").value = "عام";
    $("contentKind").value = "movie";
    $("contentPublished").checked = false;
    $("posterPreview").src = "../web/assets/images/poster-placeholder.webp";
    $("backdropPreview").src = "../web/assets/images/poster-placeholder.webp";
    state.seasonDraft = [];
    $("editorKicker").textContent = "محتوى جديد";
    $("editorTitle").textContent = "إضافة محتوى";
    setMessage("contentFormMessage", "");
    toggleKindFields();
  }

  function openNewContent(kind = "movie", importMode = "manual") {
    if (!hasPermission("createContent")) {
      toast("لا تملك صلاحية إضافة محتوى", "error");
      return;
    }
    resetContentForm();
    $("contentKind").value = kind === "series" ? "series" : "movie";
    toggleKindFields();
    if (!isAdmin()) {
      $("contentSections").value = assignedSectionIds()[0] || "";
      setImportMode("manual");
    } else {
      setImportMode(importMode === "tmdb" ? "tmdb" : "manual");
    }
    setView("editor");
    if (importMode === "tmdb" && isAdmin()) {
      window.setTimeout(() => $("tmdbSearchInput")?.focus(), 60);
    }
  }

  function openContentEditor(id) {
    const item = state.content.find((entry) => entry.id === id);
    if (!item) {
      if (!hasPermission("createContent")) {
        toast("لا تملك صلاحية إضافة محتوى", "error");
        return;
      }
      resetContentForm();
      setView("editor");
      return;
    }
    if (!hasPermission("editContent") || !canManageContent(item)) {
      toast("لا تملك صلاحية تعديل هذا المحتوى", "error");
      return;
    }
    state.editingContentId = item.id;
    $("contentId").value = item.id;
    $("contentTmdbId").value = item.tmdbId ? String(item.tmdbId) : "";
    $("contentKind").value = item.kind;
    $("contentTitle").value = item.title || "";
    $("contentEnglishTitle").value = item.englishTitle || "";
    $("contentYear").value = item.year || new Date().getFullYear();
    $("contentRating").value = item.rating || 0;
    $("contentAgeRating").value = item.ageRating || "عام";
    $("contentDuration").value = item.duration || 0;
    $("contentGenres").value = toArray(item.genres).join(", ");
    $("contentSections").value = toArray(item.sectionIds).join(", ");
    $("contentDescription").value = item.description || "";
    $("contentPoster").value = item.poster || "";
    $("contentBackdrop").value = item.backdrop || "";
    $("posterPreview").src = item.poster || "../web/assets/images/poster-placeholder.webp";
    $("backdropPreview").src = item.backdrop || item.poster || "../web/assets/images/poster-placeholder.webp";
    $("movieSourceUrl").value = item.kind === "movie" ? asString(item.sources?.[0]?.url) : "";
    $("movieBackupUrl").value = item.kind === "movie" ? asString(item.sources?.[1]?.url) : "";
    $("movieSubtitleUrl").value = item.kind === "movie" ? asString(item.subtitles?.[0]?.src) : "";
    state.seasonDraft = item.kind === "series" ? toArray(item.seasons).map((season, seasonIndex) => ({
      number: asNumber(season.number, seasonIndex + 1),
      title: asString(season.title, `الموسم ${seasonIndex + 1}`),
      episodes: toArray(season.episodes).map((episode, episodeIndex) => {
        const sources = toArray(episode.sources);
        const subtitles = toArray(episode.subtitles);
        return {
          id: asString(episode.id, `e${episode.number || episodeIndex + 1}`),
          number: asNumber(episode.number, episodeIndex + 1),
          title: asString(episode.title, `الحلقة ${episodeIndex + 1}`),
          duration: asNumber(episode.duration),
          thumbnail: asString(episode.thumbnail),
          url: asString(sources[0]?.url),
          backupUrl: asString(sources[1]?.url),
          subtitleUrl: asString(subtitles[0]?.src),
          primarySource: sources[0] || null,
          backupSource: sources[1] || null,
          extraSources: sources.slice(2),
          primarySubtitle: subtitles[0] || null,
          extraSubtitles: subtitles.slice(1)
        };
      })
    })) : [];
    $("contentViews").value = item.views || 0;
    $("contentOrder").value = item.order || 0;
    $("contentFeatured").checked = item.featured === true;
    $("contentPublished").checked = item.published === true;
    $("editorKicker").textContent = "تعديل محتوى";
    $("editorTitle").textContent = item.title || "تعديل محتوى";
    setMessage("contentFormMessage", "");
    renderSeasonBuilder();
    toggleKindFields();
    setView("editor");
  }

  async function saveContent(event) {
    event.preventDefault();
    if (!state.firebase || !state.authUser) return;
    const form = $("contentForm");
    setBusy(form, true);
    setMessage("contentFormMessage", "جاري حفظ المحتوى…", "pending");
    try {
      const existing = state.content.find((item) => item.id === state.editingContentId);
      if (existing && (!hasPermission("editContent") || !canManageContent(existing))) throw new Error("لا تملك صلاحية تعديل هذا المحتوى.");
      if (!existing && !hasPermission("createContent")) throw new Error("لا تملك صلاحية إضافة محتوى.");
      const id = asString($("contentId").value).toLowerCase();
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error("المعرّف يجب أن يحتوي أحرفاً إنجليزية صغيرة وأرقاماً وشرطة فقط.");
      if (!isAdmin() && existing && id !== existing.id) throw new Error("لا يستطيع المشرف تغيير معرّف المحتوى.");
      const kind = $("contentKind").value === "series" ? "series" : "movie";
      const poster = validMediaUrl($("contentPoster").value);
      const backdrop = validMediaUrl($("contentBackdrop").value) || poster;
      if (!poster) throw new Error("رابط البوستر يجب أن يكون HTTPS.");
      const existingMovieSources = kind === "movie" ? toArray(existing?.sources) : [];
      const primaryMovieUrl = asString($("movieSourceUrl").value);
      const backupMovieUrl = asString($("movieBackupUrl").value);
      const movieSourceCandidates = [];
      if (primaryMovieUrl) {
        movieSourceCandidates.push({
          label: asString(existingMovieSources[0]?.label, "تلقائي"),
          url: primaryMovieUrl,
          type: inferMediaType(primaryMovieUrl, existingMovieSources[0]?.type)
        });
      }
      if (backupMovieUrl) {
        movieSourceCandidates.push({
          label: asString(existingMovieSources[1]?.label, "احتياطي"),
          url: backupMovieUrl,
          type: inferMediaType(backupMovieUrl, existingMovieSources[1]?.type)
        });
      }
      movieSourceCandidates.push(...existingMovieSources.slice(2));
      const sources = kind === "movie" ? normalizeSources(movieSourceCandidates) : [];

      const existingMovieSubtitles = kind === "movie" ? toArray(existing?.subtitles) : [];
      const subtitleUrl = asString($("movieSubtitleUrl").value);
      const movieSubtitleCandidates = [];
      if (subtitleUrl) {
        movieSubtitleCandidates.push({
          label: asString(existingMovieSubtitles[0]?.label, "العربية"),
          srclang: asString(existingMovieSubtitles[0]?.srclang, "ar"),
          src: subtitleUrl
        });
      }
      movieSubtitleCandidates.push(...existingMovieSubtitles.slice(1));
      const subtitles = kind === "movie" ? normalizeSubtitles(movieSubtitleCandidates) : [];
      const willPublish = hasPermission("publishContent") ? $("contentPublished").checked : existing?.published === true;
      const seasons = kind === "series" ? normalizeSeasons(seasonsFromEditor(), willPublish) : [];
      if (willPublish && kind === "movie" && !sources.length) throw new Error("أضف مصدراً واحداً على الأقل للفيلم قبل النشر.");
      if (kind === "series" && !seasons.length) throw new Error("أضف موسماً واحداً على الأقل للمسلسل.");
      if (willPublish && kind === "series" && seasons.some((season) => season.episodes.some((episode) => !episode.sources.length))) {
        throw new Error("لا يمكن نشر المسلسل قبل إضافة رابط تشغيل لكل حلقة.");
      }
      const sectionIds = parseCsv($("contentSections").value);
      if (!isAdmin()) {
        const allowed = assignedSectionIds();
        if (!sectionIds.length || sectionIds.some((sectionId) => !allowed.includes(sectionId))) {
          throw new Error(`اختر فقط من أقسامك المسموحة: ${allowed.join("، ")}`);
        }
      }
      const payload = {
        id,
        kind,
        title: asString($("contentTitle").value).slice(0, 180),
        englishTitle: asString($("contentEnglishTitle").value).slice(0, 180),
        year: Math.max(1888, Math.min(2200, Math.round(asNumber($("contentYear").value, new Date().getFullYear())))),
        rating: Math.max(0, Math.min(10, asNumber($("contentRating").value))),
        ageRating: asString($("contentAgeRating").value, "عام").slice(0, 20),
        duration: Math.max(0, Math.round(asNumber($("contentDuration").value))),
        genres: parseCsv($("contentGenres").value),
        sectionIds,
        description: asString($("contentDescription").value).slice(0, 3000),
        poster,
        backdrop,
        sources: kind === "movie" ? sources : [],
        subtitles: kind === "movie" ? subtitles : [],
        seasons,
        views: isAdmin() ? Math.max(0, Math.round(asNumber($("contentViews").value))) : Math.max(0, Math.round(asNumber(existing?.views, 0))),
        order: asNumber($("contentOrder").value),
        featured: $("contentFeatured").checked,
        published: willPublish,
        tmdbId: Math.max(0, Math.round(asNumber($("contentTmdbId").value, asNumber(existing?.tmdbId, 0)))),
        tmdbType: Math.max(0, Math.round(asNumber($("contentTmdbId").value, 0))) ? kind : asString(existing?.tmdbType),
        tmdbImportedAt: Math.max(0, Math.round(asNumber($("contentTmdbId").value, 0))) ? Date.now() : asNumber(existing?.tmdbImportedAt, 0),
        addedAt: existing?.addedAt || today(),
        updatedBy: state.authUser.uid
      };
      if (!payload.title || !payload.description || !payload.genres.length) throw new Error("العنوان والوصف والتصنيف حقول مطلوبة.");
      await state.firebase.saveDocument("content", id, payload);
      if (state.editingContentId && state.editingContentId !== id) await state.firebase.deleteDocument("content", state.editingContentId);
      await state.firebase.logAudit(state.editingContentId ? "تعديل محتوى" : "إضافة محتوى", id, `${payload.title} · ${payload.kind}`, state.authUser);
      toast("تم حفظ المحتوى الحقيقي بنجاح");
      resetContentForm();
      setView("content");
    } catch (error) {
      console.error(error);
      setMessage("contentFormMessage", errorMessage(error), "error");
    } finally {
      setBusy(form, false);
    }
  }

  async function togglePublished(id) {
    const item = state.content.find((entry) => entry.id === id);
    if (!item || !state.firebase) return;
    if (!hasPermission("publishContent") || !canManageContent(item)) {
      toast("لا تملك صلاحية النشر لهذا المحتوى", "error");
      return;
    }
    try {
      await state.firebase.saveDocument("content", id, { published: item.published !== true, updatedBy: state.authUser.uid });
      await state.firebase.logAudit(item.published ? "إلغاء نشر" : "نشر محتوى", id, item.title, state.authUser);
      toast(item.published ? "تم إلغاء النشر" : "تم نشر المحتوى للمستخدمين");
    } catch (error) { toast(errorMessage(error), "error"); }
  }

  async function deleteContent(id) {
    const item = state.content.find((entry) => entry.id === id);
    if (!item || !state.firebase) return;
    if (!hasPermission("deleteContent") || !canManageContent(item)) {
      toast("لا تملك صلاحية حذف هذا المحتوى", "error");
      return;
    }
    if (!window.confirm(`حذف «${item.title}» نهائياً؟`)) return;
    try {
      await state.firebase.deleteDocument("content", id);
      await state.firebase.logAudit("حذف محتوى", id, item.title, state.authUser);
      toast("تم حذف المحتوى");
    } catch (error) { toast(errorMessage(error), "error"); }
  }

  function resetSupervisorForm() {
    state.editingSupervisorUid = "";
    $("supervisorForm")?.reset();
    $("permissionCreate").checked = true;
    $("permissionEdit").checked = true;
    $("permissionDelete").checked = false;
    $("permissionPublish").checked = false;
    $("supervisorFormTitle").textContent = "مشرف جديد";
    setMessage("supervisorMessage", "");
  }

  function editSupervisor(id) {
    const item = state.supervisors.find((entry) => (entry.uid || entry.id) === id);
    if (!item) return;
    state.editingSupervisorUid = item.uid || item.id;
    $("supervisorOriginalUid").value = state.editingSupervisorUid;
    $("supervisorUid").value = item.uid || item.id;
    $("supervisorEmail").value = item.email || "";
    $("supervisorName").value = item.displayName || "";
    $("supervisorSections").value = toArray(item.sectionIds).join(", ");
    $("permissionCreate").checked = item.permissions?.createContent === true;
    $("permissionEdit").checked = item.permissions?.editContent === true;
    $("permissionDelete").checked = item.permissions?.deleteContent === true;
    $("permissionPublish").checked = item.permissions?.publishContent === true;
    $("supervisorFormTitle").textContent = "تعديل مشرف";
    setMessage("supervisorMessage", "");
  }

  async function saveSupervisor(event) {
    event.preventDefault();
    if (!state.firebase) return;
    const form = $("supervisorForm");
    setBusy(form, true);
    try {
      const uid = asString($("supervisorUid").value);
      const email = asString($("supervisorEmail").value).toLowerCase();
      const name = asString($("supervisorName").value);
      const sectionIds = parseCsv($("supervisorSections").value);
      if (!/^[A-Za-z0-9_-]{8,150}$/.test(uid)) throw new Error("UID حساب Firebase غير صحيح.");
      if (!email || !name || !sectionIds.length) throw new Error("UID والبريد والاسم وقسم واحد على الأقل حقول مطلوبة.");
      const payload = {
        uid, email, displayName: name.slice(0, 100), sectionIds, active: true,
        permissions: {
          createContent: $("permissionCreate").checked,
          editContent: $("permissionEdit").checked,
          deleteContent: $("permissionDelete").checked,
          publishContent: $("permissionPublish").checked
        },
        updatedBy: state.authUser.uid
      };
      await state.firebase.saveDocument("supervisorAssignments", uid, payload);
      if (state.editingSupervisorUid && state.editingSupervisorUid !== uid) await state.firebase.deleteDocument("supervisorAssignments", state.editingSupervisorUid);
      await state.firebase.logAudit(state.editingSupervisorUid ? "تعديل مشرف" : "إضافة مشرف", uid, `${name} · ${sectionIds.join(", ")}`, state.authUser);
      toast("تم حفظ صلاحيات المشرف");
      resetSupervisorForm();
    } catch (error) {
      setMessage("supervisorMessage", errorMessage(error), "error");
    } finally { setBusy(form, false); }
  }

  async function deleteSupervisor(id) {
    if (!state.firebase || !window.confirm("حذف تعيين هذا المشرف؟")) return;
    const item = state.supervisors.find((entry) => (entry.uid || entry.id) === id);
    try {
      await state.firebase.deleteDocument("supervisorAssignments", id);
      await state.firebase.logAudit("حذف مشرف", id, item?.displayName || "", state.authUser);
      toast("تم حذف تعيين المشرف");
      resetSupervisorForm();
    } catch (error) { toast(errorMessage(error), "error"); }
  }

  function resetSectionForm() {
    state.editingSectionId = "";
    $("sectionForm")?.reset();
    $("sectionFormTitle").textContent = "قسم جديد";
    setMessage("sectionMessage", "");
  }

  function editSection(id) {
    const item = state.sections.find((entry) => entry.id === id);
    if (!item) return;
    state.editingSectionId = id;
    $("sectionOriginalId").value = id;
    $("sectionId").value = item.id;
    $("sectionName").value = item.name || "";
    $("sectionDescription").value = item.description || "";
    $("sectionFormTitle").textContent = "تعديل قسم";
  }

  async function saveSection(event) {
    event.preventDefault();
    if (!state.firebase) return;
    const form = $("sectionForm");
    setBusy(form, true);
    try {
      const id = asString($("sectionId").value).toLowerCase();
      const name = asString($("sectionName").value);
      if (!/^[a-z0-9-]+$/.test(id) || !name) throw new Error("المعرّف والاسم مطلوبان، والمعرّف إنجليزي صغير.");
      await state.firebase.saveDocument("sections", id, { id, name: name.slice(0, 100), description: asString($("sectionDescription").value).slice(0, 600), active: true, updatedBy: state.authUser.uid });
      if (state.editingSectionId && state.editingSectionId !== id) await state.firebase.deleteDocument("sections", state.editingSectionId);
      await state.firebase.logAudit(state.editingSectionId ? "تعديل قسم" : "إضافة قسم", id, name, state.authUser);
      toast("تم حفظ القسم");
      resetSectionForm();
    } catch (error) { setMessage("sectionMessage", errorMessage(error), "error"); }
    finally { setBusy(form, false); }
  }

  async function deleteSection(id) {
    if (!state.firebase || !window.confirm("حذف هذا القسم؟ المحتوى المرتبط به سيبقى بلا قسم.")) return;
    try {
      await state.firebase.deleteDocument("sections", id);
      await state.firebase.logAudit("حذف قسم", id, sectionName(id), state.authUser);
      toast("تم حذف القسم");
    } catch (error) { toast(errorMessage(error), "error"); }
  }

  async function toggleUser(id, status) {
    if (!state.firebase || !id) return;
    try {
      await state.firebase.saveDocument("users", id, { status, statusChangedBy: state.authUser.uid });
      await state.firebase.logAudit(status === "blocked" ? "حظر مستخدم" : "تفعيل مستخدم", id, "", state.authUser);
      toast(status === "blocked" ? "تم حظر المستخدم" : "تم تفعيل المستخدم");
    } catch (error) { toast(errorMessage(error), "error"); }
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!state.firebase) return;
    const form = $("settingsForm");
    setBusy(form, true);
    try {
      const payload = {
        featured: parseCsv($("settingFeatured").value),
        announcement: asString($("settingAnnouncement").value).slice(0, 500),
        minimumVersion: asString($("settingMinVersion").value, "2.3.2").slice(0, 20),
        updateUrl: validMediaUrl($("settingUpdateUrl").value) || "https://github.com/3c5-o/CINARO/releases",
        maintenance: $("settingMaintenance").checked,
        forceUpdate: $("settingForceUpdate").checked,
        updatedBy: state.authUser.uid
      };
      await state.firebase.saveDocument("appConfig", "public", payload);
      await state.firebase.logAudit("تعديل إعدادات التطبيق", "appConfig/public", payload.maintenance ? "وضع الصيانة مفعل" : "", state.authUser);
      toast("تم حفظ إعدادات التطبيق");
    } catch (error) { setMessage("settingsMessage", errorMessage(error), "error"); }
    finally { setBusy(form, false); }
  }

  function destroyPreviewHls() {
    if (!state.previewHls) return;
    try { state.previewHls.destroy(); } catch (_) {}
    state.previewHls = null;
  }

  function openMediaPreview(url, title = "معاينة الفيديو") {
    const safeUrl = validMediaUrl(url);
    if (!safeUrl) {
      toast("أدخل رابط فيديو HTTPS صالحاً أولاً", "error");
      return;
    }
    const dialog = $("mediaPreviewDialog");
    const video = $("mediaPreviewVideo");
    $("mediaPreviewTitle").textContent = title;
    $("mediaPreviewMessage").textContent = "إذا لم يبدأ الفيديو، فتحقق أن الرابط مباشر ويسمح بالتشغيل من التطبيق.";
    $("mediaPreviewMessage").className = "form-message";
    dialog.hidden = false;
    video.pause();
    destroyPreviewHls();
    video.removeAttribute("src");
    video.load();

    if (inferMediaType(safeUrl) === "application/vnd.apple.mpegurl") {
      const HlsRuntime = window.Hls;
      if (HlsRuntime?.isSupported?.()) {
        const hls = new HlsRuntime({ enableWorker: true, backBufferLength: 60 });
        state.previewHls = hls;
        hls.on(HlsRuntime.Events.MEDIA_ATTACHED, () => {
          if (state.previewHls === hls) hls.loadSource(safeUrl);
        });
        hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
          if (!data?.fatal || state.previewHls !== hls) return;
          $("mediaPreviewMessage").textContent = "تعذّر تشغيل مصدر HLS. تحقق من CORS وصلاحية الرابط.";
          $("mediaPreviewMessage").className = "form-message error";
        });
        hls.attachMedia(video);
        video.play().catch(() => {});
        return;
      }
      if (!video.canPlayType("application/vnd.apple.mpegurl")) {
        $("mediaPreviewMessage").textContent = "هذا الجهاز لا يدعم معاينة HLS.";
        $("mediaPreviewMessage").className = "form-message error";
        return;
      }
    }

    video.src = safeUrl;
    video.load();
    video.play().catch(() => {});
  }

  function closeMediaPreview() {
    const video = $("mediaPreviewVideo");
    video.pause();
    destroyPreviewHls();
    video.removeAttribute("src");
    video.load();
    $("mediaPreviewDialog").hidden = true;
  }

  async function toggleReport(id, status) {
    if (!isAdmin() || !state.firebase || !id) return;
    try {
      await state.firebase.saveDocument("reports", id, {
        status: status === "resolved" ? "resolved" : "open",
        resolvedBy: status === "resolved" ? state.authUser.uid : ""
      });
      await state.firebase.logAudit(status === "resolved" ? "معالجة بلاغ" : "إعادة فتح بلاغ", id, "", state.authUser);
      toast(status === "resolved" ? "تمت معالجة البلاغ" : "تمت إعادة فتح البلاغ");
    } catch (error) { toast(errorMessage(error), "error"); }
  }

  function handleAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === "edit-content") openContentEditor(id);
    else if (action === "delete-content") deleteContent(id);
    else if (action === "toggle-published") togglePublished(id);
    else if (action === "toggle-user") toggleUser(id, button.dataset.status);
    else if (action === "edit-supervisor") editSupervisor(id);
    else if (action === "delete-supervisor") deleteSupervisor(id);
    else if (action === "edit-section") editSection(id);
    else if (action === "delete-section") deleteSection(id);
    else if (action === "toggle-report") toggleReport(id, button.dataset.status);
    else if (action === "save-request") saveContentRequest(id);
    else if (action === "preview-url") openMediaPreview(button.dataset.url, "معاينة مصدر البلاغ");
    else if (action === "preview-movie") openMediaPreview($("movieSourceUrl").value, "معاينة الفيلم");
    else if (action === "new-tmdb") openNewContent(button.dataset.kind, "tmdb");
    else if (action === "tmdb-select") importTmdbItem(button.dataset.tmdbId, button.dataset.tmdbKind);
    else if (action === "add-episode") {
      const seasonIndex = asNumber(button.dataset.seasonIndex, -1);
      const season = state.seasonDraft[seasonIndex];
      if (!season) return;
      season.episodes.push(newEpisode(season.episodes.length + 1));
      renderSeasonBuilder();
    } else if (action === "remove-episode") {
      const season = state.seasonDraft[asNumber(button.dataset.seasonIndex, -1)];
      if (!season) return;
      season.episodes.splice(asNumber(button.dataset.episodeIndex, -1), 1);
      renderSeasonBuilder();
    } else if (action === "remove-season") {
      state.seasonDraft.splice(asNumber(button.dataset.seasonIndex, -1), 1);
      renderSeasonBuilder();
    }
  }

  function stopDataListeners() {
    state.unsubscribers.splice(0).forEach((stop) => {
      try { stop?.(); } catch (_) {}
    });
    state.dataListenersStarted = false;
  }

  function startDataListeners(client) {
    stopDataListeners();
    const refresh = () => {
      renderDashboard();
      if (state.view === "content") renderContent();
      if (state.view === "reports") renderReports();
      if (state.view === "requests") renderRequests();
      if (state.view === "users") renderUsers();
      if (state.view === "supervisors") renderSupervisors();
      if (state.view === "sections") renderSections();
      if (state.view === "activity") renderActivity();
    };
    const listen = (name, setter, label) => {
      const stop = client.listenCollection(name, (rows) => {
        state[setter] = setter === "content" && !isAdmin() ? rows.filter(canManageContent) : rows;
        setConnection("connected", "متصل بـ Firestore المباشر");
        refresh();
      }, (error) => {
        console.warn("CINARO admin listener failed", label, error);
        setConnection("error", "توجد مشكلة في صلاحيات Firestore");
        showNotice(`تعذّر تحميل ${label}. راجع قواعد Firestore وصلاحيات الحساب.`, "error");
      });
      state.unsubscribers.push(stop);
    };

    if (isAdmin()) {
      listen("content", "content", "المحتوى");
    } else {
      const stopScopedContent = client.listenContentForSections(
        assignedSectionIds(),
        (rows) => {
          state.content = rows.filter(canManageContent);
          setConnection("connected", "متصل بمحتوى الأقسام المسموحة");
          refresh();
        },
        (error) => {
          console.warn("CINARO supervisor content listener failed", error);
          setConnection("error", "تعذّر تحميل محتوى الأقسام المسموحة");
          showNotice("تعذّر تحميل محتوى الأقسام المسموحة. تحقق من تعيين المشرف وقواعد Firestore.", "error");
        }
      );
      state.unsubscribers.push(stopScopedContent);
    }

    listen("sections", "sections", "الأقسام");
    if (isAdmin()) {
      listen("users", "users", "المستخدمين");
      listen("supervisorAssignments", "supervisors", "تعيينات المشرفين");
      listen("reports", "reports", "البلاغات");
      listen("contentRequests", "requests", "طلبات المحتوى");
      listen("auditLogs", "logs", "سجل العمليات");
    } else {
      state.users = [];
      state.supervisors = [];
      state.reports = [];
      state.requests = [];
      state.logs = [];
    }
    state.unsubscribers.push(client.listenDoc("appConfig", "public", (config) => {
      state.config = config || {};
      fillSettings();
    }, (error) => console.warn("CINARO admin config listener failed", error)));
    state.dataListenersStarted = true;
  }

  function connectFirebase(client) {
    if (!client || state.firebase === client) return;
    state.firebase = client;
    setConnection("pending", "جاري الاتصال…");
    state.authUnsubscribe = client.onAuth((user) => {
      state.authResolved = true;
      if (!user) {
        stopDataListeners();
        state.authUser = null;
        state.role = "none";
        state.assignment = null;
        $("loginView").hidden = false;
        $("adminApp").hidden = true;
        document.body.classList.add("admin-booting");
        return;
      }
      if (!user.canAccessAdmin) {
        state.authUser = null;
        setMessage("loginMessage", "هذا الحساب ليس مديراً ولا يملك تعيين مشرف فعالاً.", "error");
        client.logout().catch(() => {});
        return;
      }
      state.authUser = user;
      state.role = user.role;
      state.assignment = user.assignment || null;
      $("loginView").hidden = true;
      $("adminApp").hidden = false;
      document.body.classList.remove("admin-booting");
      showNotice("");
      applyAccessControl();
      updateUserLabels();
      startDataListeners(client);
      renderDashboard();
      setView(state.view);
    });
  }

  function handleNativeBack() {
    if (!$("mediaPreviewDialog")?.hidden) {
      closeMediaPreview();
      return true;
    }
    if (document.body.classList.contains("nav-open")) {
      setMobileNavigation(false);
      return true;
    }
    if (!$("adminApp")?.hidden && state.view !== "dashboard") {
      setView(state.view === "editor" ? "content" : "dashboard");
      return true;
    }
    return false;
  }

  window.CINARO_HANDLE_BACK = handleNativeBack;

  function bindEvents() {
    $("adminLoginForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setBusy(form, true);
      setMessage("loginMessage", "جاري التحقق من Firebase…", "pending");
      try {
        await state.firebase.login($("adminEmail").value, $("adminPassword").value);
        $("adminPassword").value = "";
        setMessage("loginMessage", "");
      } catch (error) {
        setMessage("loginMessage", errorMessage(error), "error");
      } finally { setBusy(form, false); }
    });
    $("logoutButton")?.addEventListener("click", () => state.firebase?.logout().catch((error) => toast(errorMessage(error), "error")));
    $("menuButton")?.addEventListener("click", () => setMobileNavigation(!$("adminSidebar")?.classList.contains("open")));
    $("newContentButton")?.addEventListener("click", () => openNewContent("movie", "manual"));
    $("contentKind")?.addEventListener("change", () => {
      toggleKindFields();
      if (state.tmdb.importMode === "tmdb") {
        $("tmdbSearchResults").innerHTML = "";
        state.tmdb.results = [];
        setTmdbMessage("نوع البحث تغيّر. نفّذ البحث من جديد.");
      }
    });
    $$("[data-import-mode]").forEach((button) => button.addEventListener("click", () => setImportMode(button.dataset.importMode)));
    $("tmdbSearchButton")?.addEventListener("click", searchTmdb);
    $("tmdbSearchInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchTmdb();
      }
    });
    $("tmdbSettingsForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const token = asString($("tmdbTokenInput").value);
      if (!token) {
        setMessage("tmdbSettingsMessage", "ألصق TMDb Token أولاً.", "error");
        return;
      }
      if (!writeTmdbToken(token)) {
        setMessage("tmdbSettingsMessage", "تعذّر حفظ التوكن على هذا الجهاز.", "error");
        return;
      }
      state.tmdb.configuration = null;
      setMessage("tmdbSettingsMessage", "تم حفظ TMDb Token داخل تطبيق الإدارة.", "success");
      toast("تم حفظ TMDb Token");
    });
    $("tmdbTestButton")?.addEventListener("click", testTmdbToken);
    $("tmdbToggleTokenButton")?.addEventListener("click", () => {
      const input = $("tmdbTokenInput");
      input.type = input.type === "password" ? "text" : "password";
    });
    $("tmdbDeleteTokenButton")?.addEventListener("click", () => {
      writeTmdbToken("");
      state.tmdb.configuration = null;
      $("tmdbTokenInput").value = "";
      $("tmdbSearchResults").innerHTML = "";
      setImportMode("manual");
      setMessage("tmdbSettingsMessage", "تم حذف TMDb Token من هذا الجهاز.", "success");
      toast("تم حذف TMDb Token");
    });
    $("addSeasonButton")?.addEventListener("click", () => {
      state.seasonDraft.push(newSeason(state.seasonDraft.length + 1));
      renderSeasonBuilder();
    });
    $("contentForm")?.addEventListener("submit", saveContent);
    $("supervisorForm")?.addEventListener("submit", saveSupervisor);
    $("sectionForm")?.addEventListener("submit", saveSection);
    $("settingsForm")?.addEventListener("submit", saveSettings);
    $("resetSupervisorButton")?.addEventListener("click", resetSupervisorForm);
    $("resetSectionButton")?.addEventListener("click", resetSectionForm);
    $("contentSearch")?.addEventListener("input", (event) => { state.filters.contentSearch = event.target.value; renderContent(); });
    $("contentKindFilter")?.addEventListener("change", (event) => { state.filters.contentKind = event.target.value; renderContent(); });
    $("contentStatusFilter")?.addEventListener("change", (event) => { state.filters.contentStatus = event.target.value; renderContent(); });
    $("userSearch")?.addEventListener("input", (event) => { state.filters.userSearch = event.target.value; renderUsers(); });
    $("userStatusFilter")?.addEventListener("change", (event) => { state.filters.userStatus = event.target.value; renderUsers(); });
    $("reportStatusFilter")?.addEventListener("change", (event) => { state.filters.reportStatus = event.target.value; renderReports(); });
    $("requestStatusFilter")?.addEventListener("change", (event) => { state.filters.requestStatus = event.target.value; renderRequests(); });
    $("closeMediaPreview")?.addEventListener("click", closeMediaPreview);
    $("mediaPreviewDialog")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeMediaPreview();
    });
    $("mediaPreviewVideo")?.addEventListener("error", () => {
      $("mediaPreviewMessage").textContent = "تعذّر تشغيل الرابط. تأكد أنه رابط مباشر وأن الخادم يسمح بالتشغيل الخارجي.";
      $("mediaPreviewMessage").className = "form-message error";
    });
    ["contentPoster", "contentBackdrop"].forEach((id) => $(id)?.addEventListener("input", () => {
      const poster = validMediaUrl($("contentPoster").value) || "../web/assets/images/poster-placeholder.webp";
      $("posterPreview").src = poster;
      $("backdropPreview").src = validMediaUrl($("contentBackdrop").value) || poster;
    }));
    document.addEventListener("input", (event) => {
      const target = event.target;
      if (target.dataset.seasonField) {
        const season = state.seasonDraft[asNumber(target.dataset.seasonIndex, -1)];
        if (season) season[target.dataset.seasonField] = target.dataset.seasonField === "number" ? asNumber(target.value, 1) : target.value;
      }
      if (target.dataset.episodeField) {
        const episode = state.seasonDraft[asNumber(target.dataset.seasonIndex, -1)]?.episodes?.[asNumber(target.dataset.episodeIndex, -1)];
        if (episode) episode[target.dataset.episodeField] = ["number", "duration"].includes(target.dataset.episodeField) ? asNumber(target.value, 0) : target.value;
      }
    });
    document.addEventListener("click", (event) => {
      if (document.body.classList.contains("nav-open") && !event.target.closest?.("#adminSidebar, #menuButton")) {
        setMobileNavigation(false);
      }
      const action = event.target.closest?.("[data-action]");
      if (action) { event.preventDefault(); handleAction(action); return; }
      const view = event.target.closest?.("[data-view]");
      if (view) { event.preventDefault(); setView(view.dataset.view); }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setMobileNavigation(false);
        if (!$("mediaPreviewDialog").hidden) closeMediaPreview();
      }
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 760) setMobileNavigation(false);
    });
  }

  window.addEventListener("cinaro:admin-firebase-ready", (event) => connectFirebase(event.detail && event.detail.client));
  window.addEventListener("cinaro:admin-firebase-error", (event) => {
    setConnection("error", "Firebase غير متاح");
    setMessage("loginMessage", "تعذّر تحميل Firebase. تحقق من الاتصال وإعداد المشروع.", "error");
    console.error(event.detail || {});
  });
  bindCopyProtection();
  bindEvents();
  fillSettings();
  renderDashboard();
  if (window.CINARO_ADMIN_FIREBASE) connectFirebase(window.CINARO_ADMIN_FIREBASE);
  if (!window.CinaroNative && "serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js?v=2.3.2", { scope: "./", updateViaCache: "none" }).catch((error) => console.warn("CINARO admin service worker unavailable", error));
  }
})();
