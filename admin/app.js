(function () {
  "use strict";

  const ADMIN_EMAIL = "ffkyyr@gmail.com";
  const state = {
    firebase: null,
    authUser: null,
    authResolved: false,
    view: "dashboard",
    editingContentId: "",
    editingSupervisorUid: "",
    editingSectionId: "",
    content: [],
    users: [],
    supervisors: [],
    sections: [],
    logs: [],
    config: {},
    unsubscribers: [],
    filters: { contentSearch: "", contentKind: "all", contentStatus: "all", userSearch: "", userStatus: "all" }
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const views = ["dashboard", "content", "editor", "users", "supervisors", "sections", "settings", "activity"];

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
    return [...new Set(String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean))].slice(0, 30);
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

  function normalizeSeasons(value) {
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
      if (episodes.some((episode) => !episode.sources.length)) throw new Error(`كل حلقة في الموسم ${number} تحتاج مصدراً واحداً على الأقل.`);
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
    const name = user && user.displayName || "مدير CINARO";
    $("adminUserName").textContent = name;
    $("adminUserEmail").textContent = email;
    $("adminEmail").value = email;
    $("adminUserAvatar").textContent = (name.trim()[0] || "A").toUpperCase();
  }

  function setView(view) {
    const next = views.includes(view) ? view : "dashboard";
    state.view = next;
    views.forEach((name) => $("view-" + name)?.classList.toggle("active", name === next));
    $$('[data-view]').forEach((button) => button.classList.toggle("active", button.dataset.view === next));
    const activeView = $("view-" + next);
    $("viewTitle").textContent = activeView?.dataset.title || "نظرة عامة";
    $("adminSidebar")?.classList.remove("open");
    document.body.classList.remove("nav-open");
    if (next === "content") renderContent();
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
    $("navContentCount").textContent = formatNumber(state.content.length);
    $("navUsersCount").textContent = formatNumber(state.users.length);

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
      const matchesSearch = !search || [item.id, item.title, item.englishTitle].some((value) => asString(value).toLocaleLowerCase("ar").includes(search));
      const matchesKind = state.filters.contentKind === "all" || item.kind === state.filters.contentKind;
      const matchesStatus = state.filters.contentStatus === "all" || (state.filters.contentStatus === "published" ? item.published === true : item.published !== true);
      return matchesSearch && matchesKind && matchesStatus;
    }).sort((a, b) => asNumber(b.order) - asNumber(a.order) || asNumber(b.updatedAt) - asNumber(a.updatedAt));
    if (!rows.length) {
      $("contentTable").innerHTML = emptyTable(state.content.length ? "لا توجد نتائج مطابقة" : "لا يوجد محتوى حقيقي بعد", state.content.length ? "غيّر خيارات البحث أو التصفية." : "استخدم زر إضافة محتوى لإنشاء أول عنصر.");
      return;
    }
    $("contentTable").innerHTML = `<div class="data-table content-data-table"><div class="data-head"><span>العنوان</span><span>النوع</span><span>الأقسام</span><span>الحالة</span><span>إجراءات</span></div>${rows.map((item) => `
      <div class="data-row"><div class="title-cell"><span class="table-cover" style="background-image:url('${escapeHTML(item.poster || "../web/assets/images/poster-placeholder.webp")}')"></span><span><b>${escapeHTML(item.title)}</b><small>${escapeHTML(item.id)} · ${escapeHTML(String(item.year || "—"))}</small></span></div><span class="kind-chip">${item.kind === "series" ? "مسلسل" : "فيلم"}</span><span class="tag-list">${toArray(item.sectionIds).length ? item.sectionIds.slice(0, 3).map((id) => `<em>${escapeHTML(sectionName(id))}</em>`).join("") : "<em>عام</em>"}</span><span>${contentStatus(item)}</span><span class="row-actions"><button class="table-action" type="button" data-action="edit-content" data-id="${escapeHTML(item.id)}" title="تعديل"><svg><use href="#i-edit"></use></svg></button><button class="table-action" type="button" data-action="toggle-published" data-id="${escapeHTML(item.id)}" title="${item.published ? "إلغاء النشر" : "نشر"}"><svg><use href="#i-${item.published ? "x" : "check"}"></use></svg></button><button class="table-action danger" type="button" data-action="delete-content" data-id="${escapeHTML(item.id)}" title="حذف"><svg><use href="#i-trash"></use></svg></button></span></div>`).join("")}</div>`;
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

  function renderActivity() {
    const rows = [...state.logs].sort((a, b) => asNumber(b.createdAt) - asNumber(a.createdAt));
    $("activityTable").innerHTML = rows.length ? `<div class="data-table activity-data-table"><div class="data-head"><span>العملية</span><span>الهدف</span><span>المنفذ</span><span>التفاصيل</span><span>الوقت</span></div>${rows.map((item) => `<div class="data-row"><span class="activity-action"><span class="log-dot"></span><b>${escapeHTML(item.action || "عملية")}</b></span><code>${escapeHTML(item.target || "—")}</code><span>${escapeHTML(item.actorEmail || item.actorUid || "—")}</span><span>${escapeHTML(item.details || "—")}</span><span>${escapeHTML(formatDate(item.createdAt))}</span></div>`).join("")}</div>` : emptyTable("سجل العمليات فارغ", "تُحفظ هنا عمليات المحتوى والأقسام والحسابات.");
  }

  function fillSettings() {
    $("settingFeatured").value = toArray(state.config.featured).join(", ");
    $("settingAnnouncement").value = asString(state.config.announcement);
    $("settingMinVersion").value = asString(state.config.minimumVersion, "2.0.0");
    $("settingMaintenance").checked = state.config.maintenance === true;
    $("settingForceUpdate").checked = state.config.forceUpdate === true;
  }

  function toggleKindFields() {
    const series = $("contentKind").value === "series";
    $("seasonsField")?.classList.toggle("is-hidden", !series);
    $("contentSources").closest("label")?.classList.toggle("is-muted", series);
  }

  function resetContentForm() {
    state.editingContentId = "";
    $("contentForm")?.reset();
    $("contentYear").value = new Date().getFullYear();
    $("contentAgeRating").value = "عام";
    $("contentKind").value = "movie";
    $("contentPublished").checked = false;
    $("editorKicker").textContent = "محتوى جديد";
    $("editorTitle").textContent = "إضافة محتوى";
    setMessage("contentFormMessage", "");
    toggleKindFields();
  }

  function openContentEditor(id) {
    const item = state.content.find((entry) => entry.id === id);
    if (!item) {
      resetContentForm();
      setView("editor");
      return;
    }
    state.editingContentId = item.id;
    $("contentId").value = item.id;
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
    $("contentSources").value = item.kind === "movie" ? JSON.stringify(toArray(item.sources), null, 2) : "";
    $("contentSubtitles").value = item.kind === "movie" ? JSON.stringify(toArray(item.subtitles), null, 2) : "";
    $("contentSeasons").value = item.kind === "series" ? JSON.stringify(toArray(item.seasons), null, 2) : "";
    $("contentViews").value = item.views || 0;
    $("contentOrder").value = item.order || 0;
    $("contentFeatured").checked = item.featured === true;
    $("contentPublished").checked = item.published === true;
    $("editorKicker").textContent = "تعديل محتوى";
    $("editorTitle").textContent = item.title || "تعديل محتوى";
    setMessage("contentFormMessage", "");
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
      const id = asString($("contentId").value).toLowerCase();
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error("المعرّف يجب أن يحتوي أحرفاً إنجليزية صغيرة وأرقاماً وشرطة فقط.");
      const kind = $("contentKind").value === "series" ? "series" : "movie";
      const poster = validMediaUrl($("contentPoster").value);
      const backdrop = validMediaUrl($("contentBackdrop").value);
      if (!poster || !backdrop) throw new Error("روابط البوستر والخلفية يجب أن تكون HTTPS.");
      const sources = normalizeSources(parseJsonField("contentSources", [], "مصادر الفيديو"));
      const subtitles = normalizeSubtitles(parseJsonField("contentSubtitles", [], "الترجمات"));
      const seasons = kind === "series" ? normalizeSeasons(parseJsonField("contentSeasons", [], "المواسم")) : [];
      if (kind === "movie" && !sources.length) throw new Error("أضف مصدراً واحداً على الأقل للفيلم.");
      if (kind === "series" && !seasons.length) throw new Error("أضف موسماً واحداً على الأقل للمسلسل.");
      const existing = state.content.find((item) => item.id === state.editingContentId);
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
        sectionIds: parseCsv($("contentSections").value),
        description: asString($("contentDescription").value).slice(0, 3000),
        poster,
        backdrop,
        sources: kind === "movie" ? sources : [],
        subtitles: kind === "movie" ? subtitles : [],
        seasons,
        views: Math.max(0, Math.round(asNumber($("contentViews").value))),
        order: asNumber($("contentOrder").value),
        featured: $("contentFeatured").checked,
        published: $("contentPublished").checked,
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
    try {
      await state.firebase.saveDocument("content", id, { published: item.published !== true, updatedBy: state.authUser.uid });
      await state.firebase.logAudit(item.published ? "إلغاء نشر" : "نشر محتوى", id, item.title, state.authUser);
      toast(item.published ? "تم إلغاء النشر" : "تم نشر المحتوى للمستخدمين");
    } catch (error) { toast(errorMessage(error), "error"); }
  }

  async function deleteContent(id) {
    const item = state.content.find((entry) => entry.id === id);
    if (!item || !state.firebase || !window.confirm(`حذف «${item.title}» نهائياً؟`)) return;
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
        minimumVersion: asString($("settingMinVersion").value, "2.0.0").slice(0, 20),
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
  }

  function connectFirebase(client) {
    if (!client || state.firebase === client) return;
    state.firebase = client;
    setConnection("pending", "جاري الاتصال…");
    const listen = (name, setter, label) => {
      const stop = client.listenCollection(name, (rows) => {
        state[setter] = rows;
        setConnection("connected", "متصل بـ Firestore المباشر");
        renderDashboard();
        if (state.view === "content") renderContent();
        if (state.view === "users") renderUsers();
        if (state.view === "supervisors") renderSupervisors();
        if (state.view === "sections") renderSections();
        if (state.view === "activity") renderActivity();
      }, (error) => {
        console.warn("CINARO admin listener failed", label, error);
        setConnection("error", "توجد مشكلة في صلاحيات Firestore");
        showNotice(`تعذّر تحميل ${label}. راجع قواعد Firestore وتأكد من تسجيل الدخول بحساب الإدارة.`, "error");
      });
      state.unsubscribers.push(stop);
    };
    listen("content", "content", "المحتوى");
    listen("users", "users", "المستخدمين");
    listen("supervisorAssignments", "supervisors", "تعيينات المشرفين");
    listen("sections", "sections", "الأقسام");
    listen("auditLogs", "logs", "سجل العمليات");
    state.unsubscribers.push(client.listenDoc("appConfig", "public", (config) => {
      state.config = config || {};
      fillSettings();
    }, (error) => console.warn("CINARO admin config listener failed", error)));
    state.unsubscribers.push(client.onAuth((user) => {
      state.authResolved = true;
      if (!user) {
        state.authUser = null;
        $("loginView").hidden = false;
        $("adminApp").hidden = true;
        document.body.classList.add("admin-booting");
        return;
      }
      if (!user.isAdmin) {
        state.authUser = null;
        setMessage("loginMessage", "هذا الحساب ليس ضمن حسابات الإدارة المصرّح بها.", "error");
        client.logout().catch(() => {});
        return;
      }
      state.authUser = user;
      $("loginView").hidden = true;
      $("adminApp").hidden = false;
      document.body.classList.remove("admin-booting");
      showNotice("");
      updateUserLabels();
      renderDashboard();
      setView(state.view);
    }));
  }

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
    $("menuButton")?.addEventListener("click", () => {
      $("adminSidebar")?.classList.toggle("open");
      document.body.classList.toggle("nav-open");
    });
    $("newContentButton")?.addEventListener("click", () => { resetContentForm(); setView("editor"); });
    $("contentKind")?.addEventListener("change", toggleKindFields);
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
    document.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-action]");
      if (action) { event.preventDefault(); handleAction(action); return; }
      const view = event.target.closest?.("[data-view]");
      if (view) { event.preventDefault(); setView(view.dataset.view); }
    });
  }

  window.addEventListener("cinaro:admin-firebase-ready", (event) => connectFirebase(event.detail && event.detail.client));
  window.addEventListener("cinaro:admin-firebase-error", (event) => {
    setConnection("error", "Firebase غير متاح");
    setMessage("loginMessage", "تعذّر تحميل Firebase. تحقق من الاتصال وإعداد المشروع.", "error");
    console.error(event.detail || {});
  });
  bindEvents();
  fillSettings();
  renderDashboard();
  if (window.CINARO_ADMIN_FIREBASE) connectFirebase(window.CINARO_ADMIN_FIREBASE);
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch((error) => console.warn("CINARO admin service worker unavailable", error));
  }
})();
