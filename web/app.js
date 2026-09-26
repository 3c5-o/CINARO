(function () {
  "use strict";

  let DATA = window.CINARO_DATA;
  const WEB_APP_VERSION = "2.7.1";
  const URL_APP_VERSION = new URLSearchParams(location.search).get("v")?.match(/^\d+\.\d+\.\d+$/)?.[0] || "";
  const NATIVE_APP_VERSION = navigator.userAgent.match(/CINARO\/(\d+\.\d+\.\d+)/i)?.[1] || "";
  const APP_VERSION = URL_APP_VERSION || NATIVE_APP_VERSION || WEB_APP_VERSION;
  const IMAGE_FALLBACK = "assets/images/poster-placeholder.webp";

  if (!DATA || !Array.isArray(DATA.items)) {
    document.body.innerHTML = '<div class="noscript">تعذّر تحميل بيانات CINARO. تأكد من وجود ملف data.js.</div>';
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const byId = (id) => document.getElementById(id);
  let itemMap = new Map(DATA.items.map((item) => [item.id, item]));
  let movies = DATA.items.filter((item) => item.kind === "movie");
  let series = DATA.items.filter((item) => item.kind === "series");

  const STORAGE = {
    favorites: "cinaro:favorites:v1",
    history: "cinaro:watch-history:v2",
    settings: "cinaro:settings:v1",
    splash: "cinaro:splash-seen:v2",
    authChoice: "cinaro:auth-choice:v1",
    cloudOwner: "cinaro:cloud-owner:v1"
  };

  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (error) {
        console.warn("CINARO storage read failed", error);
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        console.warn("CINARO storage write failed", error);
        toast("تعذّر حفظ التغيير على هذا الجهاز", "error");
        return false;
      }
    }
  };

  const defaultSettings = {
    oled: false,
    autoplayNext: true,
    reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    playbackRate: 1,
    captionsEnabled: false,
    notificationsEnabled: true
  };

  let favorites = new Set(storage.get(STORAGE.favorites, []));
  let watchHistory = storage.get(STORAGE.history, {});
  let settings = { ...defaultSettings, ...storage.get(STORAGE.settings, {}) };

  const state = {
    route: null,
    heroIndex: 0,
    heroTimer: null,
    catalog: {
      movie: { genre: "الكل", sort: "latest", visible: 60 },
      series: { genre: "الكل", sort: "latest", visible: 60 }
    },
    searchQuery: "",
    searchType: "all",
    searchLimit: 60,
    libraryTab: "favorites",
    requestFilter: "all",
    selectedSeasons: {},
    installPrompt: null,
    activeSheet: null,
    lastFocus: null,
    lastNonPlayerHash: "#home",
    firebase: null,
    firebaseStatus: "pending",
    authUser: null,
    authResolved: false,
    localGuest: storage.get(STORAGE.authChoice, "") === "guest",
    firebaseContentUnsubscribe: null,
    firebaseAuthUnsubscribe: null,
    userStateUnsubscribe: null,
    userProfileUnsubscribe: null,
    requestUnsubscribe: null,
    requests: [],
    requestNotificationsReady: false,
    runtimeErrorShown: false,
    remoteConfig: {},
    sections: [],
    serviceLocked: false,
    cloudHydrated: false,
    cloudSyncTimer: 0,
    cloudWritePromise: Promise.resolve(),
    cloudRevision: 0,
    cloudSavedRevision: 0,
    authBusy: false
  };

  const elements = {
    splash: byId("splash"),
    header: byId("appHeader"),
    main: byId("appMain"),
    bottomNav: byId("bottomNav"),
    home: byId("homeView"),
    movies: byId("moviesView"),
    series: byId("seriesView"),
    library: byId("libraryView"),
    search: byId("searchView"),
    details: byId("detailsView"),
    offlineBanner: byId("offlineBanner"),
    remoteNotice: byId("remoteNotice"),
    serviceGate: byId("serviceGate"),
    settingsButton: byId("settingsButton"),
    sheetBackdrop: byId("sheetBackdrop"),
    settingsSheet: byId("settingsSheet"),
    infoSheet: byId("infoSheet"),
    reportSheet: byId("reportSheet"),
    requestSheet: byId("requestSheet"),
    toastRegion: byId("toastRegion"),
    confirmDialog: byId("confirmDialog"),
    authView: byId("authView"),
    authForms: byId("authForms"),
    accountPanel: byId("accountPanel"),
    authMessage: byId("authMessage"),
    firebaseStatusText: byId("firebaseStatusText"),
    firebaseStatusDot: byId("firebaseStatusDot"),
    accountButtonLabel: byId("accountButtonLabel"),
    accountButtonMeta: byId("accountButtonMeta"),
    accountSyncText: byId("accountSyncText"),
    accountSyncDot: byId("accountSyncDot")
  };

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#96;");
  }

  function safeMediaUrl(value, fallback = IMAGE_FALLBACK) {
    const input = String(value || "").trim();
    if (/^assets\/[a-z0-9_./-]+$/i.test(input)) return input;
    try {
      const parsed = new URL(input, location.href);
      if (parsed.protocol === "https:" || (parsed.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(parsed.hostname))) {
        return parsed.href;
      }
    } catch (_) {}
    return fallback;
  }

  function cssImage(value) {
    return escapeAttribute(safeMediaUrl(value)).replace(/[()]/g, (character) => encodeURIComponent(character));
  }

  function icon(name, className = "") {
    return `<svg class="${escapeAttribute(className)}" aria-hidden="true"><use href="#i-${escapeAttribute(name)}"></use></svg>`;
  }

  function formatViews(value) {
    const number = Number(value) || 0;
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)} مليون`;
    if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 100_000 ? 0 : 1)} ألف`;
    return new Intl.NumberFormat("ar-IQ").format(number);
  }

  function formatMinutes(minutes) {
    const total = Number(minutes) || 0;
    if (total < 60) return `${total} دقيقة`;
    const hours = Math.floor(total / 60);
    const remainder = total % 60;
    return remainder ? `${hours} س ${remainder} د` : `${hours} ساعة`;
  }

  function formatClock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = total % 60;
    return hours
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  function relativeDate(timestamp) {
    const difference = Date.now() - Number(timestamp || 0);
    const minutes = Math.max(0, Math.floor(difference / 60000));
    if (minutes < 1) return "الآن";
    if (minutes < 60) return `قبل ${minutes} د`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `قبل ${hours} س`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `قبل ${days} يوم`;
    return new Intl.DateTimeFormat("ar-IQ", { day: "numeric", month: "short" }).format(new Date(timestamp));
  }

  function normalizeArabic(value) {
    return String(value || "")
      .toLocaleLowerCase("ar")
      .normalize("NFKD")
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[إأآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ة/g, "ه")
      .trim();
  }

  function safePercent(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function compareVersions(first, second) {
    const a = String(first || "0").split(".").map((part) => Number(part) || 0);
    const b = String(second || "0").split(".").map((part) => Number(part) || 0);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
    }
    return 0;
  }

  function mediaKey(item, seasonNumber, episodeNumber) {
    return item.kind === "movie"
      ? item.id
      : `${item.id}:s${Number(seasonNumber)}:e${Number(episodeNumber)}`;
  }

  function getEpisode(item, seasonNumber, episodeNumber) {
    if (!item || item.kind !== "series") return null;
    const season = item.seasons.find((entry) => Number(entry.number) === Number(seasonNumber));
    if (!season) return null;
    const episode = season.episodes.find((entry) => Number(entry.number) === Number(episodeNumber));
    return episode ? { season, episode } : null;
  }

  function firstEpisode(item) {
    const season = item?.seasons?.[0];
    const episode = season?.episodes?.[0];
    return season && episode ? { season, episode } : null;
  }

  function latestHistoryForItem(itemId) {
    return Object.values(watchHistory)
      .filter((entry) => entry.contentId === itemId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
  }

  function historyRoute(entry) {
    if (!entry) return "home";
    return entry.kind === "movie"
      ? `watch/movie/${encodeURIComponent(entry.contentId)}`
      : `watch/series/${encodeURIComponent(entry.contentId)}/${entry.season}/${entry.episode}`;
  }

  function defaultWatchRoute(item) {
    if (!item) return "home";
    if (item.kind === "movie") return `watch/movie/${encodeURIComponent(item.id)}`;
    const recent = latestHistoryForItem(item.id);
    if (recent && recent.percent < 98) return historyRoute(recent);
    const first = firstEpisode(item);
    return first ? `watch/series/${encodeURIComponent(item.id)}/${first.season.number}/${first.episode.number}` : `details/${encodeURIComponent(item.id)}`;
  }

  function saveFavorites() {
    storage.set(STORAGE.favorites, Array.from(favorites));
    scheduleCloudSync(700);
  }

  function saveHistory() {
    storage.set(STORAGE.history, watchHistory);
    scheduleCloudSync(2500);
  }

  function saveSettings() {
    storage.set(STORAGE.settings, settings);
    scheduleCloudSync(1000);
  }

  function nativeNotificationsAvailable() {
    try {
      return Boolean(window.CinaroNative?.notificationsAvailable?.());
    } catch (_) {
      return false;
    }
  }

  function syncNativePushIdentity(user = state.authUser) {
    if (!nativeNotificationsAvailable()) return;
    try {
      if (user && !user.isAnonymous && user.uid) window.CinaroNative.setNotificationUser(String(user.uid));
      else window.CinaroNative.clearNotificationUser();
    } catch (error) {
      console.warn("CINARO push identity sync failed", error);
    }
  }

  function syncNativePushPreference() {
    if (!nativeNotificationsAvailable()) return;
    try {
      if (settings.notificationsEnabled === false) window.CinaroNative.setPushEnabled(false);
    } catch (error) {
      console.warn("CINARO push preference sync failed", error);
    }
  }

  function setSupabaseStatus(status, message) {
    state.firebaseStatus = status;
    const className = status === "connected" ? "sync-dot" : status === "error" ? "sync-dot error" : "sync-dot pending";
    if (elements.firebaseStatusText) elements.firebaseStatusText.textContent = message;
    if (elements.accountSyncText) elements.accountSyncText.textContent = message;
    if (elements.firebaseStatusDot) elements.firebaseStatusDot.className = className;
    if (elements.accountSyncDot) elements.accountSyncDot.className = className;
  }

  function authErrorMessage(error) {
    const code = String(error?.code || error?.message || "");
    const messages = {
      "auth/invalid-email": "صيغة البريد الإلكتروني غير صحيحة.",
      "auth/missing-password": "اكتب كلمة المرور.",
      "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
      "auth/invalid-login-credentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
      "auth/user-not-found": "لا يوجد حساب بهذا البريد الإلكتروني.",
      "auth/wrong-password": "كلمة المرور غير صحيحة.",
      "auth/user-disabled": "تم تعطيل هذا الحساب.",
      "auth/email-already-in-use": "يوجد حساب مسجل بهذا البريد.",
      "auth/weak-password": "كلمة المرور يجب أن تكون 6 أحرف على الأقل.",
      "auth/too-many-requests": "محاولات كثيرة. انتظر قليلاً ثم حاول مجددًا.",
      "auth/network-request-failed": "تعذّر الاتصال بالخدمة. تحقق من الإنترنت.",
      "auth/unauthorized-domain": "تعذّر تسجيل الدخول من هذا النطاق.",
      "auth/web-storage-unsupported": "هذا الجهاز يمنع التخزين المطلوب لتسجيل الدخول.",
      "auth/operation-not-allowed": "طريقة الدخول غير متاحة حالياً.",
      "auth/requires-login": "سجّل الدخول بحسابك لإكمال هذه العملية.",
      "auth/requires-recent-login": "لحماية حسابك، سجّل الخروج ثم ادخل مجددًا وأعد المحاولة.",
      "cinaro/name-too-short": "الاسم يجب أن يحتوي حرفين على الأقل.",
      "cinaro/request-duplicate": "عندك طلب مشابه ما زال جديداً أو قيد المراجعة.",
      "cinaro/request-exists": "هذا المحتوى موجود بالفعل داخل CINARO.",
      "cinaro/request-title-too-short": "اكتب اسم الفيلم أو المسلسل بصورة أوضح.",
      "cinaro/email-unchanged": "اكتب بريداً جديداً مختلفاً عن بريد حسابك الحالي."
    };
    return messages[code] || "تعذّر إكمال العملية. تحقق من البيانات والاتصال.";
  }

  function setAuthMessage(message = "", type = "") {
    if (!elements.authMessage) return;
    elements.authMessage.textContent = message;
    elements.authMessage.className = "auth-message" + (type ? " " + type : "");
  }

  function setAuthBusy(busy) {
    state.authBusy = Boolean(busy);
    const card = elements.authView?.querySelector(".auth-card");
    card?.classList.toggle("is-busy", state.authBusy);
    elements.authView?.querySelectorAll("button, input").forEach((control) => {
      control.disabled = state.authBusy;
    });
  }

  function setAuthTab(tab) {
    const selected = tab === "register" ? "register" : "login";
    $$("[data-auth-tab]", elements.authView).forEach((button) => {
      const active = button.dataset.authTab === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    byId("loginForm").hidden = selected !== "login";
    byId("registerForm").hidden = selected !== "register";
    byId("authTitle").textContent = selected === "register" ? "اصنع حسابك" : "مرحباً بعودتك";
    setAuthMessage("");
  }

  function showAuth(panel = "login") {
    closeSheets();
    const accountMode = panel === "account";
    elements.authForms.hidden = accountMode;
    elements.accountPanel.hidden = !accountMode;
    elements.authView.hidden = false;
    document.body.classList.add("auth-open");
    if (!accountMode) setAuthTab(panel);
    updateAccountUI();
    window.setTimeout(() => {
      const focusTarget = accountMode ? byId("logoutButton") : byId(panel === "register" ? "registerName" : "loginEmail");
      focusTarget?.focus();
    }, 40);
  }

  function hideAuth() {
    elements.authView.hidden = true;
    document.body.classList.remove("auth-open");
    setAuthBusy(false);
    setAuthMessage("");
  }

  function updateAccountUI() {
    const user = state.authUser;
    const isGuest = state.localGuest || user?.isAnonymous;
    const name = user?.displayName || (isGuest ? "ضيف CINARO" : "حساب CINARO");
    const email = user?.email || "";

    if (elements.accountButtonLabel) elements.accountButtonLabel.textContent = name;
    if (elements.accountButtonMeta) {
      elements.accountButtonMeta.textContent = user && !user.isAnonymous
        ? (state.firebaseStatus === "connected" ? "متصل وتتم مزامنة بياناتك" : "الحساب محفوظ — المزامنة بانتظار الاتصال")
        : isGuest ? "وضع الضيف — يمكنك تسجيل حساب" : "تسجيل الدخول والمزامنة";
    }
    if (byId("accountPanelName")) byId("accountPanelName").textContent = name;
    if (byId("accountPanelEmail")) byId("accountPanelEmail").textContent = email || (isGuest ? "بياناتك محفوظة على هذا الجهاز" : "");
    if (byId("profileName") && document.activeElement !== byId("profileName")) byId("profileName").value = user?.displayName || "";
    if (byId("profileEmail") && document.activeElement !== byId("profileEmail")) byId("profileEmail").value = email;
    const verification = byId("emailVerificationStatus")?.closest(".account-verification");
    if (byId("emailVerificationStatus")) {
      byId("emailVerificationStatus").textContent = user?.emailVerified ? "البريد الإلكتروني موثّق" : "البريد الإلكتروني غير موثّق";
    }
    verification?.classList.toggle("verified", Boolean(user?.emailVerified));
    if (byId("verifyEmailButton")) byId("verifyEmailButton").hidden = Boolean(user?.emailVerified || !user || user.isAnonymous);
  }

  function mergeHistory(localHistory, remoteHistory) {
    const merged = { ...(remoteHistory && typeof remoteHistory === "object" ? remoteHistory : {}) };
    Object.entries(localHistory && typeof localHistory === "object" ? localHistory : {}).forEach(([key, entry]) => {
      if (!merged[key] || Number(entry?.updatedAt || 0) >= Number(merged[key]?.updatedAt || 0)) merged[key] = entry;
    });
    return merged;
  }

  function cloudPayload() {
    return {
      favorites: Array.from(favorites),
      history: watchHistory,
      settings
    };
  }

  function scheduleCloudSync(delay = 1500, markDirty = true) {
    if (!state.firebase || !state.authUser || !state.cloudHydrated) return;
    if (markDirty) state.cloudRevision += 1;
    window.clearTimeout(state.cloudSyncTimer);
    setSupabaseStatus("pending", "جاري حفظ تغييراتك…");
    state.cloudSyncTimer = window.setTimeout(flushCloudState, delay);
  }

  function flushCloudState() {
    window.clearTimeout(state.cloudSyncTimer);
    if (!state.firebase || !state.authUser || !state.cloudHydrated) return Promise.resolve();
    const userId = state.authUser.uid;
    const payload = cloudPayload();
    const revision = state.cloudRevision;
    state.cloudWritePromise = state.cloudWritePromise
      .catch(() => {})
      .then(() => state.firebase.saveUserState(userId, payload))
      .then(() => {
        if (state.authUser?.uid !== userId) return;
        state.cloudSavedRevision = Math.max(state.cloudSavedRevision, revision);
        storage.set(STORAGE.cloudOwner, userId);
        if (state.cloudSavedRevision < state.cloudRevision) {
          setSupabaseStatus("pending", "توجد تغييرات بانتظار المزامنة…");
        } else {
          setSupabaseStatus("connected", "تمت مزامنة بياناتك");
        }
        updateAccountUI();
      })
      .catch((error) => {
        if (state.authUser?.uid !== userId) return;
        console.warn("CINARO cloud sync failed", error);
        setSupabaseStatus("error", "تعذّرت المزامنة — بياناتك محفوظة محلياً");
        updateAccountUI();
      });
    return state.cloudWritePromise;
  }

  function hydrateCloudState(payload) {
    const userId = state.authUser?.uid || "";
    const shouldMigrateLocalData = Boolean(userId) && storage.get(STORAGE.cloudOwner, "") !== userId;
    const hasUnsavedLocalChanges = state.cloudSavedRevision < state.cloudRevision;

    if (!hasUnsavedLocalChanges) {
      if (shouldMigrateLocalData) {
        favorites = new Set([...(payload?.favorites || []), ...favorites]);
        watchHistory = mergeHistory(watchHistory, payload?.history);
        settings = { ...defaultSettings, ...(payload?.settings || {}), ...settings };
      } else {
        favorites = new Set(payload?.favorites || []);
        watchHistory = payload?.history && typeof payload.history === "object" ? payload.history : {};
        settings = { ...defaultSettings, ...(payload?.settings || {}) };
      }
      storage.set(STORAGE.favorites, Array.from(favorites));
      storage.set(STORAGE.history, watchHistory);
      storage.set(STORAGE.settings, settings);
      applySettings();
      syncSettingsControls();
      syncNativePushPreference();
      refreshCurrentView();
    }
    state.cloudHydrated = true;
    setSupabaseStatus(hasUnsavedLocalChanges ? "pending" : "connected", hasUnsavedLocalChanges ? "توجد تغييرات بانتظار المزامنة…" : "تمت مزامنة بياناتك");
    updateAccountUI();
    if (!hasUnsavedLocalChanges && (shouldMigrateLocalData || !payload)) scheduleCloudSync(100);
  }

  function subscribeUserState(user) {
    state.userStateUnsubscribe?.();
    state.userStateUnsubscribe = null;
    state.userProfileUnsubscribe?.();
    state.userProfileUnsubscribe = null;
    state.requestUnsubscribe?.();
    state.requestUnsubscribe = null;
    state.requests = [];
    state.requestNotificationsReady = false;
    state.cloudHydrated = false;
    state.cloudRevision = 0;
    state.cloudSavedRevision = 0;
    if (!user || !state.firebase) return;
    state.userStateUnsubscribe = state.firebase.listenUserState(
      user.uid,
      hydrateCloudState,
      (error) => {
        console.warn("CINARO user state listener failed", error);
        state.cloudHydrated = true;
        setSupabaseStatus("error", "الحساب متصل لكن تعذّرت قراءة المزامنة");
      }
    );
    state.userProfileUnsubscribe = state.firebase.listenUserProfile(
      user.uid,
      (profile) => {
        if (profile?.status !== "blocked") return;
        toast("تم إيقاف هذا الحساب من الإدارة", "error");
        state.firebase.logout().catch(() => {});
      },
      (error) => console.warn("CINARO user profile listener failed", error)
    );

    if (!user.isAnonymous && state.firebase.listenMyRequests) {
      state.requestUnsubscribe = state.firebase.listenMyRequests(
        (rows) => {
          const nextRows = Array.isArray(rows) ? rows : [];
          if (state.requestNotificationsReady) {
            nextRows.forEach((request) => {
              const previous = state.requests.find((item) => item.id === request.id);
              if (!previous || previous.status === request.status) return;
              const info = requestStatusInfo(request.status);
              toast(`طلب «${request.title || "محتوى"}» أصبح: ${info.label}`);
            });
          }
          state.requests = nextRows;
          state.requestNotificationsReady = true;
          if (state.route?.name === "library" && state.libraryTab === "requests") renderLibrary();
        },
        (error) => console.warn("CINARO request listener failed", error)
      );
    }
  }

  function updateServiceGate() {
    const minimumVersion = String(state.remoteConfig.minimumVersion || "").trim();
    const latestVersion = String(state.remoteConfig.latestVersion || minimumVersion || "").trim();
    const belowMinimum = Boolean(minimumVersion && compareVersions(APP_VERSION, minimumVersion) < 0);
    const updateAvailable = Boolean(latestVersion && compareVersions(APP_VERSION, latestVersion) < 0);
    const maintenance = state.remoteConfig.maintenance === true;
    const forcedUpdate = state.remoteConfig.forceUpdate !== false && (belowMinimum || updateAvailable);
    state.serviceLocked = maintenance || forcedUpdate;

    if (!elements.serviceGate) return;
    elements.serviceGate.hidden = !state.serviceLocked;
    document.body.classList.toggle("service-locked", state.serviceLocked);
    if (!state.serviceLocked) return;

    if (maintenance) {
      byId("serviceGateKicker").textContent = "صيانة مجدولة";
      byId("serviceGateTitle").textContent = "CINARO تحت الصيانة";
      byId("serviceGateText").textContent = String(state.remoteConfig.announcement || "نعمل الآن على تحسين الخدمة. أعد فتح التطبيق بعد قليل.").trim();
      byId("serviceGateAction").hidden = true;
    } else {
      byId("serviceGateKicker").textContent = "تحديث ضروري";
      byId("serviceGateTitle").textContent = `حدّث CINARO إلى ${latestVersion || minimumVersion}`;
      byId("serviceGateText").textContent = String(state.remoteConfig.updateNotes || "هذه النسخة لم تعد مدعومة. نزّل الإصدار الجديد حتى تواصل المشاهدة بأمان.").trim();
      byId("serviceGateAction").href = safeMediaUrl(state.remoteConfig.updateUrl, "https://github.com/3c5-o/CINARO/releases");
      byId("serviceGateAction").hidden = false;
    }
    if (!player.root.hidden) hidePlayer();
  }

  function updateUpdateControl() {
    const label = byId("updateStatusText");
    if (!label) return;
    const latest = String(state.remoteConfig.latestVersion || state.remoteConfig.minimumVersion || APP_VERSION).trim();
    const hasUpdate = latest && compareVersions(APP_VERSION, latest) < 0;
    label.textContent = hasUpdate ? `يتوفر الإصدار ${latest}` : `أنت على أحدث إصدار (${APP_VERSION})`;
  }

  function openAvailableUpdate() {
    const latest = String(state.remoteConfig.latestVersion || state.remoteConfig.minimumVersion || APP_VERSION).trim();
    if (!latest || compareVersions(APP_VERSION, latest) >= 0) {
      toast("أنت تستخدم أحدث إصدار من CINARO");
      return;
    }
    const url = safeMediaUrl(state.remoteConfig.updateUrl, "https://github.com/3c5-o/CINARO/releases");
    window.location.href = url;
  }

  function replaceCatalog(payload) {
    state.remoteConfig = payload?.config && typeof payload.config === "object" ? payload.config : {};
    state.sections = Array.isArray(payload?.sections) ? payload.sections : [];
    if (elements.remoteNotice) {
      const minimumVersion = String(state.remoteConfig.minimumVersion || "").trim();
      const latestVersion = String(state.remoteConfig.latestVersion || minimumVersion || "").trim();
      const belowMinimum = minimumVersion && compareVersions(APP_VERSION, minimumVersion) < 0;
      const updateAvailable = latestVersion && compareVersions(APP_VERSION, latestVersion) < 0;
      const updateMessage = (belowMinimum || updateAvailable)
        ? `يتوفر تحديث إجباري لـ CINARO (${latestVersion || minimumVersion}). ${String(state.remoteConfig.updateNotes || "يجب تحديث التطبيق للاستمرار.").trim()}`
        : "";
      const message = state.remoteConfig.maintenance
        ? "CINARO تحت الصيانة حالياً. سيعود العرض قريباً."
        : updateMessage || String(state.remoteConfig.announcement || "").trim();
      elements.remoteNotice.hidden = !message;
      elements.remoteNotice.textContent = message;
      const forcedUpdateNotice = Boolean((belowMinimum || updateAvailable) && state.remoteConfig.forceUpdate !== false);
      elements.remoteNotice.classList.toggle("maintenance", Boolean(state.remoteConfig.maintenance || forcedUpdateNotice));
    }
    updateServiceGate();
    updateUpdateControl();
    if (state.remoteConfig.maintenance) setSupabaseStatus("connected", "وضع الصيانة مفعل من الإدارة");
    const incomingItems = Array.isArray(payload?.items) ? payload.items : [];
    DATA = {
      ...DATA,
      items: incomingItems,
      featured: Array.isArray(payload?.featured) && payload.featured.length
        ? payload.featured
        : incomingItems.slice(0, 5).map((item) => item.id)
    };
    itemMap = new Map(DATA.items.map((item) => [item.id, item]));
    movies = DATA.items.filter((item) => item.kind === "movie");
    series = DATA.items.filter((item) => item.kind === "series");
    state.heroIndex = 0;
    if (!DATA.items.length) {
      setSupabaseStatus("connected", state.remoteConfig.maintenance ? "وضع الصيانة مفعل من الإدارة" : "الخدمة جاهزة — لم يُنشر محتوى بعد");
      if (state.route?.name !== "watch") refreshCurrentView();
      return;
    }
    setSupabaseStatus(payload.fromCache ? "pending" : "connected", payload.fromCache ? "عرض آخر محتوى محفوظ" : "متصل بالمحتوى المباشر");
    if (state.route?.name !== "watch") refreshCurrentView();
  }

  function connectSupabase(client = window.CINARO_SUPABASE) {
    if (!client || state.firebase === client) return;
    state.firebase = client;
    setSupabaseStatus("pending", "جاري تحديث المحتوى…");

    state.firebaseContentUnsubscribe = client.listenContent(
      replaceCatalog,
      (error) => {
        console.warn("CINARO content listener failed", error);
        setSupabaseStatus("error", "تعذّر تحديث المحتوى — يعرض التطبيق آخر محتوى متاح");
      }
    );

    state.firebaseAuthUnsubscribe = client.onAuth((user) => {
      state.authResolved = true;
      state.authUser = user;
      syncNativePushIdentity(user);
      if (user) {
        state.localGuest = Boolean(user.isAnonymous);
        storage.set(STORAGE.authChoice, user.isAnonymous ? "guest" : "account");
        hideAuth();
        subscribeUserState(user);
      } else {
        state.userStateUnsubscribe?.();
        state.userStateUnsubscribe = null;
        state.userProfileUnsubscribe?.();
        state.userProfileUnsubscribe = null;
        state.requestUnsubscribe?.();
        state.requestUnsubscribe = null;
        state.requests = [];
        state.cloudHydrated = false;
        if (!state.localGuest) showAuth("login");
      }
      updateAccountUI();
    });
  }

  async function continueAsGuest() {
    if (state.authBusy) return;
    if (!state.authResolved && storage.get(STORAGE.authChoice, "") === "account") {
      setAuthMessage("جاري استعادة حسابك. انتظر قليلاً أو أعد فتح التطبيق.", "success");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("جاري تجهيز وضع الضيف…");
    try {
      if (state.firebase) {
        await state.firebase.guest();
      } else {
        throw new Error("supabase/unavailable");
      }
      state.localGuest = true;
      storage.set(STORAGE.authChoice, "guest");
      hideAuth();
      toast("أهلاً بك في CINARO");
    } catch (error) {
      console.warn("CINARO anonymous Supabase auth unavailable", error);
      state.localGuest = true;
      state.authUser = null;
      storage.set(STORAGE.authChoice, "guest");
      hideAuth();
      updateAccountUI();
      toast("تعمل الآن كضيف على هذا الجهاز");
    }
  }

  function bindAuthEvents() {
    $$("[data-auth-tab]", elements.authView).forEach((button) => {
      button.addEventListener("click", () => setAuthTab(button.dataset.authTab));
    });

    byId("loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.firebase || state.authBusy) {
        setAuthMessage("الخدمة غير متاحة الآن؛ يمكنك المتابعة كضيف.", "error");
        return;
      }
      setAuthBusy(true);
      setAuthMessage("جاري تسجيل الدخول…");
      try {
        const user = await state.firebase.login(byId("loginEmail").value, byId("loginPassword").value);
        state.authUser = user;
        updateAccountUI();
        toast("تم تسجيل الدخول بنجاح");
      } catch (error) {
        setAuthMessage(authErrorMessage(error), "error");
      } finally {
        setAuthBusy(false);
      }
    });

    byId("registerForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = byId("registerPassword").value;
      if (password !== byId("registerPasswordConfirm").value) {
        setAuthMessage("كلمتا المرور غير متطابقتين.", "error");
        return;
      }
      if (!state.firebase || state.authBusy) {
        setAuthMessage("الخدمة غير متاحة الآن؛ يمكنك المتابعة كضيف.", "error");
        return;
      }
      setAuthBusy(true);
      setAuthMessage("جاري إنشاء حسابك…");
      try {
        const user = await state.firebase.register({
          name: byId("registerName").value,
          email: byId("registerEmail").value,
          password
        });
        state.authUser = user;
        updateAccountUI();
        toast("تم إنشاء حساب CINARO");
      } catch (error) {
        setAuthMessage(authErrorMessage(error), "error");
      } finally {
        setAuthBusy(false);
      }
    });

    byId("resetPasswordButton").addEventListener("click", async () => {
      const email = byId("loginEmail").value.trim();
      if (!email) {
        setAuthMessage("اكتب بريدك الإلكتروني أولاً.", "error");
        byId("loginEmail").focus();
        return;
      }
      if (!state.firebase || state.authBusy) {
        setAuthMessage("الخدمة غير متاحة الآن.", "error");
        return;
      }
      setAuthBusy(true);
      try {
        await state.firebase.resetPassword(email);
        setAuthMessage("أرسلنا رابط إعادة تعيين كلمة المرور إلى بريدك.", "success");
      } catch (error) {
        setAuthMessage(authErrorMessage(error), "error");
      } finally {
        setAuthBusy(false);
      }
    });

    byId("guestButton").addEventListener("click", continueAsGuest);
    byId("closeAuthButton").addEventListener("click", () => {
      if (storage.get(STORAGE.authChoice, "") === "account") {
        hideAuth();
        toast("الحساب محفوظ على هذا الجهاز وسيُستعاد عند توفر الاتصال");
        return;
      }
      continueAsGuest();
    });
    byId("accountButton").addEventListener("click", () => {
      if (state.authUser && !state.authUser.isAnonymous) showAuth("account");
      else {
        showAuth("login");
        setAuthMessage("أنت تستخدم وضع الضيف. سجّل دخولك لتفعيل المزامنة.");
      }
    });
    byId("profileForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.firebase || state.authBusy) return;
      setAuthBusy(true);
      setAuthMessage("جاري حفظ الاسم…");
      try {
        state.authUser = await state.firebase.updateAccount(byId("profileName").value);
        updateAccountUI();
        setAuthMessage("تم تحديث الاسم بنجاح.", "success");
        toast("تم حفظ معلومات الحساب");
      } catch (error) {
        setAuthMessage(authErrorMessage(error), "error");
      } finally {
        setAuthBusy(false);
      }
    });
    byId("verifyEmailButton").addEventListener("click", async () => {
      if (!state.firebase || state.authBusy) return;
      setAuthBusy(true);
      try {
        await state.firebase.sendVerification();
        setAuthMessage("تم إرسال رابط التحقق. افتح بريدك ثم أعد تشغيل التطبيق.", "success");
      } catch (error) {
        setAuthMessage(authErrorMessage(error), "error");
      } finally {
        setAuthBusy(false);
      }
    });
    byId("accountEmailButton")?.addEventListener("click", async () => {
      const nextEmail = byId("profileEmail")?.value.trim() || "";
      if (!nextEmail || !state.firebase || !state.authUser || state.authUser.isAnonymous || state.authBusy) return;
      setAuthBusy(true);
      setAuthMessage("جاري إرسال تأكيد تغيير البريد…");
      try {
        await state.firebase.requestEmailChange(nextEmail);
        setAuthMessage("تم إرسال رابط تأكيد إلى البريد الجديد. أكمل التحقق من الرسالة.", "success");
      } catch (error) {
        setAuthMessage(authErrorMessage(error), "error");
      } finally {
        setAuthBusy(false);
      }
    });

    byId("accountPasswordResetButton").addEventListener("click", async () => {
      const email = state.authUser?.email || "";
      if (!email || !state.firebase || state.authBusy) return;
      setAuthBusy(true);
      try {
        await state.firebase.resetPassword(email);
        setAuthMessage("تم إرسال رابط تغيير كلمة المرور إلى بريدك.", "success");
      } catch (error) {
        setAuthMessage(authErrorMessage(error), "error");
      } finally {
        setAuthBusy(false);
      }
    });
    byId("logoutButton").addEventListener("click", async () => {
      if (state.authBusy) return;
      setAuthBusy(true);
      await flushCloudState();
      try {
        await state.firebase?.logout();
      } catch (error) {
        setAuthMessage(authErrorMessage(error), "error");
        setAuthBusy(false);
        return;
      }
      state.authUser = null;
      state.localGuest = false;
      state.cloudHydrated = false;
      favorites = new Set();
      watchHistory = {};
      storage.set(STORAGE.authChoice, "");
      storage.set(STORAGE.cloudOwner, "");
      storage.set(STORAGE.favorites, []);
      storage.set(STORAGE.history, {});
      refreshCurrentView();
      setAuthBusy(false);
      showAuth("login");
      toast("تم تسجيل الخروج");
    });
  }

  function toast(message, type = "success") {
    if (!elements.toastRegion) return;
    const node = document.createElement("div");
    node.className = `toast ${type === "error" ? "error" : ""}`;
    node.innerHTML = `${icon(type === "error" ? "alert" : "check")}<span>${escapeHTML(message)}</span>`;
    elements.toastRegion.appendChild(node);
    window.setTimeout(() => {
      node.classList.add("leaving");
      window.setTimeout(() => node.remove(), 230);
    }, 2600);
  }

  function setDocumentTitle(title) {
    document.title = title ? `${title} · CINARO` : "CINARO — كل قصة تبدأ هنا";
  }

  function imageMarkup(url, alt, className = "", loading = "lazy") {
    return `<img class="${escapeAttribute(className)}" src="${escapeAttribute(safeMediaUrl(url))}" data-fallback="${IMAGE_FALLBACK}" alt="${escapeAttribute(alt || "")}" loading="${loading}">`;
  }

  function mediaCard(item) {
    const favorite = favorites.has(item.id);
    const genre = Array.isArray(item.genres) && item.genres.length ? item.genres[0] : (item.kind === "movie" ? "فيلم" : "مسلسل");
    return `
      <article class="media-card" tabindex="0" role="link" data-route="details/${escapeAttribute(item.id)}" aria-label="تفاصيل ${escapeAttribute(item.title)}">
        <div class="poster-shell">
          ${imageMarkup(item.poster, `غلاف ${item.title}`)}
          <div class="card-topline">
            <span class="kind-badge">${item.kind === "movie" ? "فيلم" : "مسلسل"}</span>
            <span class="card-rating-pill">${icon("star")} ${escapeHTML(item.rating)}</span>
          </div>
          <button class="favorite-button ${favorite ? "active" : ""}" type="button" data-action="toggle-favorite" data-item-id="${escapeAttribute(item.id)}" aria-label="${favorite ? "إزالة من قائمتي" : "إضافة إلى قائمتي"}">
            ${icon("heart")}
          </button>
          <span class="card-play">${icon("play")}</span>
          <div class="poster-gradient"></div>
        </div>
        <div class="card-copy">
          <h3 class="card-title">${escapeHTML(item.title)}</h3>
          <div class="card-meta"><span>${escapeHTML(genre)}</span><span>•</span><span>${escapeHTML(item.year)}</span></div>
        </div>
      </article>`;
  }

  function mediaGrid(items, emptyMessage = "لا يوجد محتوى مطابق") {
    if (!items.length) {
      return emptyState("film", "لا توجد نتائج", emptyMessage, "home", "العودة للرئيسية");
    }
    return items.map(mediaCard).join("");
  }

  function emptyState(iconName, title, text, route, buttonLabel) {
    return `
      <div class="empty-state">
        <div class="empty-icon">${icon(iconName)}</div>
        <h2>${escapeHTML(title)}</h2>
        <p>${escapeHTML(text)}</p>
        ${route ? `<button class="button ghost" type="button" data-route="${escapeAttribute(route)}">${escapeHTML(buttonLabel || "العودة")}</button>` : ""}
      </div>`;
  }

  function sectionHeading(kicker, title, route) {
    return `
      <div class="section-heading">
        <div><span>${escapeHTML(kicker)}</span><h2>${escapeHTML(title)}</h2></div>
        ${route ? `<button class="text-button" type="button" data-route="${escapeAttribute(route)}">عرض الكل ${icon("chevron-left")}</button>` : ""}
      </div>`;
  }

  function sortItems(items, mode) {
    const result = [...items];
    if (mode === "rating") result.sort((a, b) => b.rating - a.rating);
    else if (mode === "popular") result.sort((a, b) => b.views - a.views);
    else if (mode === "oldest") result.sort((a, b) => a.year - b.year || String(a.addedAt).localeCompare(String(b.addedAt)));
    else result.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)) || b.year - a.year);
    return result;
  }

  function metaRow(item, includeDuration = true) {
    const duration = item.kind === "movie" && includeDuration ? `<span>${icon("clock")} ${escapeHTML(formatMinutes(item.duration))}</span>` : "";
    return `
      <div class="meta-row">
        <span class="rating">${icon("star")} ${escapeHTML(item.rating)}</span>
        <span>${escapeHTML(item.year)}</span>
        ${duration}
        <span>${icon("eye")} ${escapeHTML(formatViews(item.views))}</span>
        <span class="age-badge">${escapeHTML(item.ageRating)}</span>
        <span class="quality-badge">HD</span>
      </div>`;
  }

  function continueCard(entry) {
    const item = itemMap.get(entry.contentId);
    if (!item) return "";
    const subtitle = entry.kind === "series"
      ? `الموسم ${entry.season} · الحلقة ${entry.episode} · ${entry.episodeTitle || ""}`
      : "فيلم";
    const image = entry.thumbnail || item.backdrop || item.poster;
    return `
      <article class="continue-card" tabindex="0" role="link" data-route="${escapeAttribute(historyRoute(entry))}">
        ${imageMarkup(image, "", "continue-thumb")}
        <div class="continue-copy">
          <small>${escapeHTML(subtitle)}</small>
          <b>${escapeHTML(item.title)}</b>
          <div class="progress-bar"><span style="width:${safePercent(entry.percent)}%"></span></div>
          <div class="progress-label"><span>${safePercent(entry.percent)}%</span><span>${escapeHTML(formatClock(entry.time))}</span></div>
        </div>
      </article>`;
  }

  function renderHero() {
    const container = byId("homeHero");
    if (!container) return;
    if (!DATA.items.length) {
      container.innerHTML = `<div class="content-shell page-shell"><div class="empty-state remote-empty">${icon("cloud")}<h2>لا يوجد محتوى منشور بعد</h2><p>ستظهر الأفلام والمسلسلات هنا بعد إضافتها ونشرها من لوحة الإدارة.</p></div></div>`;
      return;
    }
    const featuredItems = DATA.featured.map((id) => itemMap.get(id)).filter(Boolean);
    const item = featuredItems[state.heroIndex % Math.max(1, featuredItems.length)] || DATA.items[0];
    const favorite = favorites.has(item.id);
    const genreLine = (item.genres || []).slice(0, 3).join(" • ");
    container.innerHTML = `
      <section class="hero" style="background-image:url('${cssImage(item.backdrop || item.poster)}')">
        <div class="hero-noise" aria-hidden="true"></div>
        <div class="hero-content content-shell">
          <div class="hero-copy">
            <div class="hero-kickers">
              <span class="eyebrow">CINARO PREMIERE</span>
              <span class="hero-genre">${escapeHTML(genreLine || (item.kind === "movie" ? "فيلم" : "مسلسل"))}</span>
            </div>
            <h1>${escapeHTML(item.title)}</h1>
            <p class="english-title">${escapeHTML(item.englishTitle || "")}</p>
            ${metaRow(item)}
            <p class="hero-description">${escapeHTML(item.description)}</p>
            <div class="button-row hero-actions">
              <button class="button primary hero-watch" type="button" data-route="${escapeAttribute(defaultWatchRoute(item))}">${icon("play")} مشاهدة الآن</button>
              <button class="button secondary" type="button" data-route="details/${escapeAttribute(item.id)}">${icon("info")} التفاصيل</button>
              <button class="button icon-only secondary ${favorite ? "is-favorite" : ""}" type="button" data-action="toggle-favorite" data-item-id="${escapeAttribute(item.id)}" aria-label="${favorite ? "إزالة من قائمتي" : "إضافة إلى قائمتي"}">${icon("heart")}</button>
            </div>
          </div>
          <button class="hero-poster-card" type="button" data-route="details/${escapeAttribute(item.id)}" aria-label="فتح تفاصيل ${escapeAttribute(item.title)}">
            ${imageMarkup(item.poster, `غلاف ${item.title}`, "hero-poster", "eager")}
            <span><b>${escapeHTML(item.title)}</b><small>${item.kind === "movie" ? "فيلم" : "مسلسل"} • ${escapeHTML(item.year)}</small></span>
          </button>
        </div>
        <div class="hero-footer content-shell">
          <div class="hero-dots" aria-label="اختيارات الواجهة">
            ${featuredItems.map((_, index) => `<button class="hero-dot ${index === state.heroIndex ? "active" : ""}" type="button" data-action="hero-dot" data-index="${index}" aria-label="العرض ${index + 1}"></button>`).join("")}
          </div>
          <span class="hero-index">${String((state.heroIndex % Math.max(1, featuredItems.length)) + 1).padStart(2, "0")} / ${String(Math.max(1, featuredItems.length)).padStart(2, "0")}</span>
        </div>
      </section>`;
  }

  function recentEntries() {
    return Object.values(watchHistory)
      .filter((entry) => itemMap.has(entry.contentId) && entry.percent > 0 && entry.percent < 98)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function renderHome() {
    if (!DATA.items.length) {
      elements.home.innerHTML = `<div class="content-shell page-shell"><div class="page-heading"><div><span>المكتبة قيد التجهيز</span><h1>أهلاً بك في CINARO</h1><p>لا يوجد محتوى منشور حالياً. سيظهر المحتوى الحقيقي هنا بعد نشره من لوحة الإدارة.</p></div></div><div id="homeHero"></div></div>`;
      renderHero();
      return;
    }
    const continueItems = recentEntries().slice(0, 8);
    const popular = sortItems(DATA.items, "popular").slice(0, 10);
    const latest = sortItems(DATA.items, "latest").slice(0, 12);
    const topRated = sortItems(DATA.items, "rating").slice(0, 10);
    const featuredSeries = sortItems(series, "popular").slice(0, 10);
    const customSections = state.sections.map((section) => ({
      ...section,
      items: sortItems(DATA.items.filter((item) => item.sectionIds?.includes(section.id)), "latest").slice(0, 12)
    })).filter((section) => section.items.length);

    elements.home.innerHTML = `
      <div id="homeHero"></div>
      <div class="content-shell discovery-dock" aria-label="اختصارات CINARO">
        <button type="button" data-route="movies"><span class="dock-icon">${icon("film")}</span><span><b>الأفلام</b><small>${movies.length} عنوان</small></span>${icon("chevron-left")}</button>
        <button type="button" data-route="series"><span class="dock-icon">${icon("tv")}</span><span><b>المسلسلات</b><small>${series.length} مسلسل</small></span>${icon("chevron-left")}</button>
        <button type="button" data-route="search"><span class="dock-icon">${icon("search")}</span><span><b>اكتشف بسرعة</b><small>بحث مباشر</small></span>${icon("chevron-left")}</button>
        <button type="button" data-route="library"><span class="dock-icon">${icon("heart")}</span><span><b>مساحتك</b><small>المفضلة والمتابعة</small></span>${icon("chevron-left")}</button>
      </div>
      <div class="content-shell home-sections">
        ${continueItems.length ? `
          <section class="content-section continue-section">
            ${sectionHeading("استمر بدون ما تضيع مكانك", "أكمل المشاهدة", "library")}
            <div class="continue-rail">${continueItems.map(continueCard).join("")}</div>
          </section>` : ""}
        <section class="content-section spotlight-section">
          ${sectionHeading("يشاهده الجميع الآن", "الأكثر مشاهدة", "movies")}
          <div class="media-rail featured-rail">${popular.map(mediaCard).join("")}</div>
        </section>
        <section class="content-section">
          ${sectionHeading("وصل للتو إلى مكتبتك", "جديد CINARO", "movies")}
          <div class="media-rail">${latest.map(mediaCard).join("")}</div>
        </section>
        <section class="content-section">
          ${sectionHeading("تقييمات مرتفعة", "اختيارات مميزة", "movies")}
          <div class="media-rail">${topRated.map(mediaCard).join("")}</div>
        </section>
        <section class="content-section">
          ${sectionHeading("مواسم وحلقات تستحق الوقت", "مسلسلات مختارة", "series")}
          <div class="media-rail">${featuredSeries.map(mediaCard).join("")}</div>
        </section>
        ${customSections.map((section) => `
          <section class="content-section" data-section-id="${escapeAttribute(section.id)}">
            ${sectionHeading(section.description || "مختارات CINARO", section.name, "")}
            <div class="media-rail">${section.items.map(mediaCard).join("")}</div>
          </section>`).join("")}
      </div>`;
    renderHero();
    startHeroRotation();
  }

  function startHeroRotation() {
    window.clearInterval(state.heroTimer);
    if (settings.reduceMotion || DATA.featured.length < 2 || state.route?.name !== "home") return;
    state.heroTimer = window.setInterval(() => {
      if (document.hidden || state.route?.name !== "home") return;
      state.heroIndex = (state.heroIndex + 1) % DATA.featured.length;
      renderHero();
    }, 8000);
  }

  function catalogTemplate(kind) {
    const source = kind === "movie" ? movies : series;
    const config = state.catalog[kind];
    const genres = ["الكل", ...new Set(source.flatMap((item) => item.genres))];
    const filtered = source.filter((item) => config.genre === "الكل" || item.genres.includes(config.genre));
    const sorted = sortItems(filtered, config.sort);
    const visibleCount = Number.isFinite(Number(config.visible)) ? Number(config.visible) : 60;
    const visible = sorted.slice(0, Math.max(30, visibleCount));
    const title = kind === "movie" ? "الأفلام" : "المسلسلات";
    const kicker = kind === "movie" ? "CINEMA COLLECTION" : "SERIES COLLECTION";
    const description = kind === "movie" ? "كل أفلام CINARO في مكان واحد، بترتيب أسرع وفلاتر أوضح." : "المسلسلات والمواسم والحلقات مرتبة لتوصل للي تريده بأقل خطوات.";

    return `
      <div class="content-shell page-shell catalog-shell">
        <div class="catalog-hero">
          <div class="catalog-hero-icon">${icon(kind === "movie" ? "film" : "tv")}</div>
          <div><span>${kicker}</span><h1>${title}</h1><p>${description}</p></div>
          <div class="catalog-count"><b>${source.length}</b><small>${kind === "movie" ? "فيلم" : "مسلسل"}</small></div>
        </div>
        <div class="filter-panel premium-filter">
          <div class="chip-row" aria-label="التصنيفات">
            ${genres.map((genre) => `<button class="chip ${genre === config.genre ? "active" : ""}" type="button" data-action="catalog-genre" data-kind="${kind}" data-genre="${escapeAttribute(genre)}">${escapeHTML(genre)}</button>`).join("")}
          </div>
          <select class="sort-select" data-catalog-sort="${kind}" aria-label="ترتيب المحتوى">
            <option value="latest" ${config.sort === "latest" ? "selected" : ""}>الأحدث إضافة</option>
            <option value="popular" ${config.sort === "popular" ? "selected" : ""}>الأكثر مشاهدة</option>
            <option value="rating" ${config.sort === "rating" ? "selected" : ""}>الأعلى تقييمًا</option>
            <option value="oldest" ${config.sort === "oldest" ? "selected" : ""}>الأقدم</option>
          </select>
        </div>
        <div class="catalog-result-line"><span>النتائج</span><b>${sorted.length} ${kind === "movie" ? "فيلم" : "مسلسل"}</b></div>
        <div class="media-grid">${mediaGrid(visible, `لا يوجد ${title} ضمن هذا التصنيف.`)}</div>
        ${visible.length < sorted.length ? `<div class="load-more-wrap"><button class="button secondary" type="button" data-action="catalog-more" data-kind="${kind}">عرض المزيد (${sorted.length - visible.length})</button></div>` : ""}
      </div>`;
  }

  function renderCatalog(kind) {
    const target = kind === "movie" ? elements.movies : elements.series;
    target.innerHTML = catalogTemplate(kind);
  }

  function searchResults() {
    const query = normalizeArabic(state.searchQuery);
    if (!query) return [];
    return DATA.items.filter((item) => {
      const typeMatches = state.searchType === "all" || item.kind === state.searchType;
      const haystack = normalizeArabic([item.title, item.englishTitle, item.year, ...item.genres, item.description].join(" "));
      return typeMatches && haystack.includes(query);
    });
  }

  function renderSearchResultsOnly() {
    const resultsNode = byId("searchResults");
    const countNode = byId("searchCount");
    const clearButton = byId("clearSearchButton");
    if (!resultsNode || !countNode) return;
    const results = searchResults();
    const visibleResults = results.slice(0, Math.max(30, state.searchLimit || 60));
    clearButton?.toggleAttribute("hidden", !state.searchQuery);
    if (!state.searchQuery.trim()) {
      countNode.textContent = "";
      resultsNode.innerHTML = emptyState("search", "ابحث داخل CINARO", "اكتب اسم فيلم أو مسلسل أو تصنيف للوصول إليه مباشرة.", "", "");
      return;
    }
    countNode.textContent = `${results.length} نتيجة`;
    if (!results.length) {
      const requestKind = state.searchType === "series" ? "series" : "movie";
      resultsNode.innerHTML = `<div class="request-empty-card search-request-card">${icon("search")}<h2>ما لقينا هذا المحتوى</h2><p>تقدر ترسل الاسم مباشرة إلى الإدارة حتى تضيفه للمكتبة.</p><button class="button primary" type="button" data-action="request-search" data-kind="${requestKind}" data-title="${escapeAttribute(state.searchQuery)}">${icon("film")} طلب هذا المحتوى</button></div>`;
      return;
    }
    resultsNode.innerHTML = `${mediaGrid(visibleResults, "جرّب كتابة اسم مختلف أو اختر نوعًا آخر.")}${visibleResults.length < results.length ? `<div class="load-more-wrap"><button class="button secondary" type="button" data-action="search-more">عرض المزيد (${results.length - visibleResults.length})</button></div>` : ""}`;
  }

  function renderSearch() {
    elements.search.innerHTML = `
      <div class="content-shell page-shell search-shell">
        <div class="page-heading">
          <div><span>وصول سريع</span><h1>البحث</h1><p>ابحث بالعربية أو الإنجليزية أو باسم التصنيف.</p></div>
        </div>
        <div class="search-header">
          <label class="search-box">
            ${icon("search")}
            <input id="searchInput" type="search" inputmode="search" autocomplete="off" spellcheck="false" value="${escapeAttribute(state.searchQuery)}" placeholder="ابحث عن فيلم، مسلسل، أكشن..." aria-label="عبارة البحث">
            <button id="clearSearchButton" class="clear-search" type="button" data-action="clear-search" aria-label="مسح البحث" ${state.searchQuery ? "" : "hidden"}>${icon("x")}</button>
          </label>
          <div class="chip-row search-filters" aria-label="نوع نتيجة البحث">
            <button class="chip ${state.searchType === "all" ? "active" : ""}" type="button" data-action="search-type" data-type="all">الكل</button>
            <button class="chip ${state.searchType === "movie" ? "active" : ""}" type="button" data-action="search-type" data-type="movie">أفلام</button>
            <button class="chip ${state.searchType === "series" ? "active" : ""}" type="button" data-action="search-type" data-type="series">مسلسلات</button>
          </div>
        </div>
        <div id="searchCount" class="result-count"></div>
        <div id="searchResults" class="media-grid"></div>
      </div>`;
    renderSearchResultsOnly();
    window.setTimeout(() => byId("searchInput")?.focus({ preventScroll: true }), 80);
  }

  function renderHistoryList() {
    const entries = Object.values(watchHistory)
      .filter((entry) => itemMap.has(entry.contentId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (!entries.length) return emptyState("history", "سجل المشاهدة فارغ", "عندما تشاهد فيلمًا أو حلقة سيظهر تقدمك هنا تلقائيًا.", "home", "استكشف المحتوى");

    return `<div class="history-list">${entries.map((entry) => {
      const item = itemMap.get(entry.contentId);
      const subtitle = entry.kind === "series" ? `الموسم ${entry.season} · الحلقة ${entry.episode} · ${entry.episodeTitle || ""}` : "فيلم";
      return `
        <article class="history-row">
          <div class="history-thumb">
            ${imageMarkup(entry.thumbnail || item.backdrop || item.poster, "")}
            <span>${safePercent(entry.percent)}%</span>
          </div>
          <div class="history-copy">
            <h3>${escapeHTML(item.title)}</h3>
            <p>${escapeHTML(subtitle)} · ${escapeHTML(relativeDate(entry.updatedAt))}</p>
            <div class="progress-bar"><span style="width:${safePercent(entry.percent)}%"></span></div>
          </div>
          <div class="history-actions">
            <button class="button primary" type="button" data-route="${escapeAttribute(historyRoute(entry))}">${icon("play")} ${entry.percent >= 98 ? "إعادة" : "متابعة"}</button>
            <button class="icon-button" type="button" data-action="remove-history" data-media-key="${escapeAttribute(entry.key)}" aria-label="حذف من السجل">${icon("trash")}</button>
          </div>
        </article>`;
    }).join("")}</div>`;
  }

  function requestStatusInfo(status) {
    const map = {
      new: { label: "تم الإرسال", className: "new", step: 1, description: "وصل طلبك إلى الإدارة وينتظر المراجعة." },
      reviewing: { label: "قيد المراجعة", className: "reviewing", step: 2, description: "الإدارة تراجع الطلب وتجهز المحتوى إذا كان متاحاً." },
      added: { label: "تمت الإضافة", className: "added", step: 3, description: "المحتوى أصبح جاهزاً داخل مكتبة CINARO." },
      rejected: { label: "تعذّرت الإضافة", className: "rejected", step: 1, description: "تعذرت إضافة الطلب حالياً. راجع ملاحظة الإدارة إن وجدت." }
    };
    return map[status] || map.new;
  }

  function formatRequestDate(value) {
    const date = new Date(Number(value) || Date.parse(value || ""));
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium" }).format(date);
  }

  function renderRequestList() {
    if (!state.authUser || state.authUser.isAnonymous) {
      return `<div class="request-empty-card request-login-card"><span class="request-empty-icon">${icon("film")}</span><span class="request-eyebrow">REQUEST CENTER</span><h2>طلبات المحتوى تحتاج حساب</h2><p>سجّل دخولك حتى ترسل فيلم أو مسلسل وتتابع كل تحديث من الإدارة داخل التطبيق.</p><button class="button primary" type="button" data-action="request-login">تسجيل الدخول</button></div>`;
    }

    const allRows = [...state.requests].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const counts = {
      total: allRows.length,
      active: allRows.filter((request) => ["new", "reviewing"].includes(request.status)).length,
      added: allRows.filter((request) => request.status === "added").length,
      rejected: allRows.filter((request) => request.status === "rejected").length
    };
    const rows = allRows.filter((request) => {
      if (state.requestFilter === "active") return ["new", "reviewing"].includes(request.status);
      if (state.requestFilter === "added") return request.status === "added";
      if (state.requestFilter === "rejected") return request.status === "rejected";
      return true;
    });

    const filterButton = (value, label, count) => `<button class="request-filter ${state.requestFilter === value ? "active" : ""}" type="button" data-action="request-filter" data-filter="${value}"><span>${label}</span><em>${count}</em></button>`;

    return `
      <section class="request-center">
        <div class="request-hero">
          <div class="request-hero-mark">${icon("film")}</div>
          <div class="request-hero-copy"><span class="request-eyebrow">CINARO REQUEST CENTER</span><h2>اطلب اللي تريد تشوفه</h2><p>أرسل اسم الفيلم أو المسلسل، وتابع مرحلة الطلب لحظة بلحظة من نفس الصفحة.</p></div>
          <button class="button primary request-new-button" type="button" data-action="open-request-sheet">${icon("plus")} طلب جديد</button>
        </div>

        <div class="request-stats" aria-label="ملخص الطلبات">
          <article><span>${icon("film")}</span><div><small>كل الطلبات</small><strong>${counts.total}</strong></div></article>
          <article><span>${icon("clock")}</span><div><small>قيد المتابعة</small><strong>${counts.active}</strong></div></article>
          <article><span>${icon("check")}</span><div><small>تمت الإضافة</small><strong>${counts.added}</strong></div></article>
        </div>

        <div class="request-filterbar" role="tablist" aria-label="فلترة الطلبات">
          ${filterButton("all", "الكل", counts.total)}
          ${filterButton("active", "قيد المتابعة", counts.active)}
          ${filterButton("added", "تمت الإضافة", counts.added)}
          ${filterButton("rejected", "متعذرة", counts.rejected)}
        </div>

        <div class="request-list">
          ${rows.length ? rows.map((request) => {
            const status = requestStatusInfo(request.status);
            const note = String(request.adminNote || "").trim();
            const linkedContent = request.contentId && itemMap.get(request.contentId);
            const rejected = request.status === "rejected";
            const stepClass = (step) => status.step >= step && !rejected ? "done" : "";
            return `<article class="request-card request-card-${status.className}">
              <div class="request-card-head">
                <div class="request-type-icon">${icon(request.kind === "series" ? "tv" : "film")}</div>
                <div class="request-heading-copy">
                  <div class="request-heading-badges"><span class="request-kind">${request.kind === "series" ? "مسلسل" : "فيلم"}</span><span class="request-status ${status.className}">${status.label}</span></div>
                  <h3>${escapeHTML(request.title || "طلب محتوى")}</h3>
                  <small class="request-date">${icon("clock")} ${escapeHTML(formatRequestDate(request.createdAt))}</small>
                </div>
              </div>

              <p class="request-status-description">${escapeHTML(status.description)}</p>
              ${request.notes ? `<div class="request-user-note"><span>ملاحظتك</span><p>${escapeHTML(request.notes)}</p></div>` : ""}

              ${rejected ? `<div class="request-progress rejected-progress"><span class="request-progress-alert">${icon("alert")}</span><div><b>تعذّرت إضافة هذا الطلب</b><small>يمكنك إرسال طلب جديد لاحقاً أو تعديل الاسم عند المحاولة القادمة.</small></div></div>` : `
                <div class="request-progress" aria-label="تقدم الطلب">
                  <div class="request-step ${stepClass(1)}"><i>${icon("check")}</i><span>تم الإرسال</span></div>
                  <div class="request-step-line ${status.step >= 2 ? "done" : ""}"></div>
                  <div class="request-step ${stepClass(2)}"><i>${icon(status.step >= 2 ? "check" : "clock")}</i><span>قيد المراجعة</span></div>
                  <div class="request-step-line ${status.step >= 3 ? "done" : ""}"></div>
                  <div class="request-step ${stepClass(3)}"><i>${icon(status.step >= 3 ? "check" : "film")}</i><span>تمت الإضافة</span></div>
                </div>`}

              ${note ? `<div class="request-admin-note"><span class="request-note-icon">${icon("info")}</span><div><b>ملاحظة الإدارة</b><p>${escapeHTML(note)}</p></div></div>` : ""}

              <div class="request-card-footer">
                <small>رقم الطلب: ${escapeHTML(String(request.id || "").slice(0, 10).toUpperCase())}</small>
                <div class="request-card-actions">
                  ${linkedContent ? `<button class="button primary compact-button" type="button" data-route="details/${escapeAttribute(linkedContent.id)}">${icon("play")} فتح المحتوى</button>` : ""}
                  ${request.status === "new" ? `<button class="button secondary compact-button" type="button" data-action="cancel-request" data-request-id="${escapeAttribute(request.id)}">${icon("x")} إلغاء الطلب</button>` : ""}
                </div>
              </div>
            </article>`;
          }).join("") : `<div class="request-empty-card compact"><span class="request-empty-icon">${icon("film")}</span><h2>${allRows.length ? "لا توجد طلبات بهذه الحالة" : "ما عندك طلبات بعد"}</h2><p>${allRows.length ? "غيّر الفلتر حتى تشوف باقي طلباتك." : "أرسل أول طلب وسيظهر هنا مع حالة واضحة لكل مرحلة."}</p>${allRows.length ? "" : `<button class="button primary" type="button" data-action="open-request-sheet">إرسال أول طلب</button>`}</div>`}
        </div>
      </section>`;
  }

  function renderLibrary() {
    const favoriteItems = DATA.items.filter((item) => favorites.has(item.id));
    const libraryDescription = state.authUser && !state.authUser.isAnonymous
      ? "المحتوى المحفوظ وسجل المشاهدة متزامنان مع حسابك."
      : "المحتوى المحفوظ وسجل المشاهدة موجودان على هذا الجهاز.";
    const content = state.libraryTab === "favorites"
      ? `<div class="media-grid">${favoriteItems.length ? favoriteItems.map(mediaCard).join("") : emptyState("heart", "قائمتك فارغة", "اضغط رمز القلب على أي فيلم أو مسلسل حتى تحفظه هنا.", "home", "استكشف المحتوى")}</div>`
      : state.libraryTab === "history"
        ? renderHistoryList()
        : renderRequestList();

    const pageHeading = state.libraryTab === "requests"
      ? { kicker: "مركز الطلبات", title: "طلبات المحتوى", description: "اطلب أفلامك ومسلسلاتك وتابع حالة كل طلب من نفس المكان." }
      : { kicker: "مساحتك الخاصة", title: "قائمتي", description: libraryDescription };

    elements.library.innerHTML = `
      <div class="content-shell page-shell">
        <div class="page-heading">
          <div><span>${pageHeading.kicker}</span><h1>${pageHeading.title}</h1><p>${pageHeading.description}</p></div>
        </div>
        <div class="library-tabs" role="tablist">
          <button class="${state.libraryTab === "favorites" ? "active" : ""}" type="button" role="tab" data-action="library-tab" data-tab="favorites">${icon("heart")} المفضلة</button>
          <button class="${state.libraryTab === "history" ? "active" : ""}" type="button" role="tab" data-action="library-tab" data-tab="history">${icon("history")} سجل المشاهدة</button>
          <button class="${state.libraryTab === "requests" ? "active" : ""}" type="button" role="tab" data-action="library-tab" data-tab="requests">${icon("film")} الطلبات</button>
        </div>
        <div id="libraryContent">${content}</div>
      </div>`;
  }

  function selectedSeason(item) {
    const requested = Number(state.selectedSeasons[item.id]);
    return item.seasons.find((season) => Number(season.number) === requested) || item.seasons[0];
  }

  function episodeRow(item, season, episode) {
    const key = mediaKey(item, season.number, episode.number);
    const progress = watchHistory[key];
    return `
      <article class="episode-row" tabindex="0" role="link" data-route="watch/series/${escapeAttribute(item.id)}/${season.number}/${episode.number}">
        <div class="episode-thumb">
          ${imageMarkup(episode.thumbnail || item.backdrop || item.poster, `الحلقة ${episode.number}`)}
          <span class="mini-play">${icon("play")}</span>
        </div>
        <div class="episode-copy">
          <h3>الحلقة ${episode.number} · ${escapeHTML(episode.title)}</h3>
          <p>${escapeHTML(formatMinutes(episode.duration))}${progress ? ` · شوهد ${safePercent(progress.percent)}%` : ""}</p>
          ${progress ? `<div class="progress-bar"><span style="width:${safePercent(progress.percent)}%"></span></div>` : ""}
        </div>
        <div class="episode-number">${String(episode.number).padStart(2, "0")}</div>
      </article>`;
  }

  function renderDetails(itemId) {
    const item = itemMap.get(itemId);
    if (!item) {
      elements.details.innerHTML = `<div class="content-shell page-shell"><div class="media-grid">${emptyState("alert", "المحتوى غير موجود", "ربما تم حذف المحتوى أو أن الرابط غير صحيح.", "home", "العودة للرئيسية")}</div></div>`;
      setDocumentTitle("غير موجود");
      return;
    }

    const favorite = favorites.has(item.id);
    const season = item.kind === "series" ? selectedSeason(item) : null;
    const related = DATA.items.filter((candidate) => candidate.id !== item.id && candidate.genres.some((genre) => item.genres.includes(genre))).slice(0, 8);
    const seriesMarkup = item.kind === "series" ? `
      <section class="series-area">
        <div class="series-heading">
          <h2>المواسم والحلقات</h2>
          <div class="season-tabs" aria-label="اختيار الموسم">
            ${item.seasons.map((entry) => `<button class="season-tab ${entry.number === season.number ? "active" : ""}" type="button" data-action="select-season" data-item-id="${escapeAttribute(item.id)}" data-season="${entry.number}">الموسم ${entry.number}</button>`).join("")}
          </div>
        </div>
        <div class="episode-list">${season.episodes.map((episode) => episodeRow(item, season, episode)).join("")}</div>
      </section>` : "";

    elements.details.innerHTML = `
      <div class="details-view">
        <div class="details-backdrop" style="background-image:url('${cssImage(item.backdrop || item.poster)}')">
          <button class="icon-button back-button" type="button" data-action="go-back" aria-label="الرجوع">${icon("arrow-right")}</button>
        </div>
        <div class="content-shell details-body">
          ${imageMarkup(item.poster, `غلاف ${item.title}`, "details-poster", "eager")}
          <div class="details-copy">
            <span class="eyebrow">${item.kind === "movie" ? "فيلم" : `${item.seasons.length} موسم`}</span>
            <h1>${escapeHTML(item.title)}</h1>
            <p class="english-title">${escapeHTML(item.englishTitle || "")}</p>
            ${metaRow(item)}
            <div class="genre-tags">${item.genres.map((genre) => `<span class="genre-tag">${escapeHTML(genre)}</span>`).join("")}</div>
            <p class="details-description">${escapeHTML(item.description)}</p>
            <div class="button-row">
              <button class="button primary" type="button" data-route="${escapeAttribute(defaultWatchRoute(item))}">${icon("play")} ${latestHistoryForItem(item.id)?.percent < 98 ? "متابعة المشاهدة" : "مشاهدة الآن"}</button>
              <button class="button secondary ${favorite ? "is-favorite" : ""}" type="button" data-action="toggle-favorite" data-item-id="${escapeAttribute(item.id)}">${icon("heart")} ${favorite ? "إزالة من قائمتي" : "أضف إلى قائمتي"}</button>
              <button class="button secondary" type="button" data-action="share-item" data-item-id="${escapeAttribute(item.id)}">${icon("share")} مشاركة</button>
            </div>
          </div>
          ${seriesMarkup}
          ${related.length ? `<section class="series-area content-section">${sectionHeading("قد يعجبك أيضًا", "محتوى مشابه", "")}<div class="media-rail">${related.map(mediaCard).join("")}</div></section>` : ""}
        </div>
      </div>`;
    setDocumentTitle(item.title);
  }

  function parseRoute() {
    const value = decodeURIComponent((location.hash || "#home").slice(1));
    const parts = value.split("/").filter(Boolean);
    const name = parts[0] || "home";
    return { name, parts, raw: value };
  }

  function navigate(route, replace = false) {
    const nextHash = `#${String(route || "home").replace(/^#/, "")}`;
    if (nextHash.startsWith("#watch/") && !location.hash.startsWith("#watch/")) {
      state.lastNonPlayerHash = location.hash || "#home";
    }
    if (replace) {
      window.history.replaceState(null, "", nextHash);
      renderRoute();
    } else if (location.hash === nextHash) renderRoute();
    else location.hash = nextHash;
  }

  function updateNavigation(route) {
    let active = route.name;
    if (route.name === "details") {
      const item = itemMap.get(route.parts[1]);
      active = item?.kind === "series" ? "series" : "movies";
    }
    document.querySelectorAll('[data-route="home"], [data-route="movies"], [data-route="series"], [data-route="search"], [data-route="library"]')
      .forEach((button) => button.classList.toggle("active", button.dataset.route === active));
  }

  function renderRoute() {
    const route = parseRoute();
    const validViews = new Set(["home", "movies", "series", "library", "search", "details", "watch"]);
    if (!validViews.has(route.name)) {
      navigate("home", true);
      return;
    }

    window.clearInterval(state.heroTimer);
    state.route = route;
    closeSheets();
    state.firebase?.log("screen_view", {
      firebase_screen: route.name,
      firebase_screen_class: "CinaroWebView"
    });

    if (route.name === "watch") {
      document.body.classList.add("player-open");
      openPlayerForRoute(route);
      updateNavigation(route);
      return;
    }

    state.lastNonPlayerHash = location.hash || "#home";
    document.body.classList.remove("player-open");
    hidePlayer();
    $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === route.name));
    updateNavigation(route);

    try {
      if (route.name === "home") {
        renderHome();
        setDocumentTitle("");
      } else if (route.name === "movies") {
        renderCatalog("movie");
        setDocumentTitle("الأفلام");
      } else if (route.name === "series") {
        renderCatalog("series");
        setDocumentTitle("المسلسلات");
      } else if (route.name === "library") {
        renderLibrary();
        setDocumentTitle("قائمتي");
      } else if (route.name === "search") {
        renderSearch();
        setDocumentTitle("البحث");
      } else if (route.name === "details") {
        renderDetails(route.parts[1]);
      }
    } catch (error) {
      console.error("CINARO view render failed", route.name, error);
      const target = route.name === "home" ? elements.home
        : route.name === "movies" ? elements.movies
        : route.name === "series" ? elements.series
        : route.name === "library" ? elements.library
        : route.name === "search" ? elements.search
        : elements.details;
      if (target) {
        target.innerHTML = `<div class="content-shell page-shell"><div class="empty-state view-recovery">${icon("alert")}<h2>تعذّر عرض هذا القسم</h2><p>حدث خلل مؤقت في الواجهة، لكن بقية التطبيق ما زالت تعمل.</p><button class="button primary" type="button" data-route="home">العودة للرئيسية</button></div></div>`;
      }
      toast("تم عزل خطأ الواجهة حتى لا يتوقف التطبيق بالكامل.", "error");
    }

    window.scrollTo({ top: 0, behavior: settings.reduceMotion ? "auto" : "smooth" });
    elements.main?.focus({ preventScroll: true });
  }

  function refreshCurrentView() {
    const scrollPosition = window.scrollY;
    const route = state.route || parseRoute();
    try {
      if (route.name === "home") renderHome();
      else if (route.name === "movies") renderCatalog("movie");
      else if (route.name === "series") renderCatalog("series");
      else if (route.name === "library") renderLibrary();
      else if (route.name === "search") renderSearchResultsOnly();
      else if (route.name === "details") renderDetails(route.parts[1]);
    } catch (error) {
      console.error("CINARO realtime view refresh failed", route.name, error);
      toast("تعذّر تحديث هذا القسم الآن، لكن التطبيق سيبقى يعمل.", "error");
      return false;
    }
    window.scrollTo(0, scrollPosition);
    return true;
  }

  function toggleFavorite(itemId) {
    const item = itemMap.get(itemId);
    if (!item) return;
    if (favorites.has(itemId)) {
      favorites.delete(itemId);
      toast(`تمت إزالة ${item.title} من قائمتك`);
    } else {
      favorites.add(itemId);
      toast(`تمت إضافة ${item.title} إلى قائمتك`);
    }
    saveFavorites();
    refreshCurrentView();
  }

  async function shareItem(itemId) {
    const item = itemMap.get(itemId);
    if (!item) return;
    const url = new URL(location.href);
    url.hash = `details/${encodeURIComponent(item.id)}`;
    const payload = { title: `${item.title} · CINARO`, text: `شاهد ${item.title} على CINARO`, url: url.href };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await copyText(url.href);
    toast("تم نسخ رابط المحتوى");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  }

  function removeHistoryEntry(key) {
    if (!watchHistory[key]) return;
    delete watchHistory[key];
    saveHistory();
    renderLibrary();
    toast("تم حذف العنصر من سجل المشاهدة");
  }

  function openSheet(sheet) {
    if (!sheet) return;
    closeSheets();
    state.lastFocus = document.activeElement;
    state.activeSheet = sheet;
    elements.sheetBackdrop.hidden = false;
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => $("button, input, select", sheet)?.focus({ preventScroll: true }), 40);
  }

  function closeSheets() {
    if (elements.sheetBackdrop) elements.sheetBackdrop.hidden = true;
    [elements.settingsSheet, elements.infoSheet, elements.reportSheet, elements.requestSheet].forEach((sheet) => {
      if (sheet) sheet.hidden = true;
    });
    if (state.activeSheet) {
      document.body.style.overflow = "";
      state.lastFocus?.focus?.({ preventScroll: true });
    }
    state.activeSheet = null;
  }

  function syncSettingsControls() {
    byId("oledToggle").checked = Boolean(settings.oled);
    byId("autoplayToggle").checked = Boolean(settings.autoplayNext);
    byId("motionToggle").checked = Boolean(settings.reduceMotion);
    const notificationRow = byId("notificationSettingRow");
    const notificationsToggle = byId("notificationsToggle");
    const available = nativeNotificationsAvailable();
    if (notificationRow) notificationRow.hidden = !available;
    if (notificationsToggle) {
      notificationsToggle.disabled = !available;
      notificationsToggle.checked = settings.notificationsEnabled !== false;
    }
  }

  function applySettings() {
    document.documentElement.dataset.theme = settings.oled ? "oled" : "cinema";
    document.documentElement.classList.toggle("reduce-motion", Boolean(settings.reduceMotion));
    const themeColor = settings.oled ? "#000000" : "#08090d";
    $('meta[name="theme-color"]')?.setAttribute("content", themeColor);
  }

  function askConfirmation(text) {
    return new Promise((resolve) => {
      byId("confirmText").textContent = text;
      elements.confirmDialog.hidden = false;
      const finish = (result) => {
        elements.confirmDialog.hidden = true;
        byId("confirmAccept").onclick = null;
        byId("confirmCancel").onclick = null;
        resolve(result);
      };
      byId("confirmAccept").onclick = () => finish(true);
      byId("confirmCancel").onclick = () => finish(false);
    });
  }

  function openRequestSheet(options = {}) {
    if (!state.firebase || !state.authUser || state.authUser.isAnonymous) {
      closeSheets();
      showAuth("login");
      setAuthMessage("سجّل دخولك حتى ترسل طلب فيلم أو مسلسل.");
      return;
    }
    byId("requestForm")?.reset();
    if (options.kind && byId("requestKind")) byId("requestKind").value = options.kind === "series" ? "series" : "movie";
    if (options.title && byId("requestName")) byId("requestName").value = String(options.title).slice(0, 180);
    if (byId("requestMessage")) {
      byId("requestMessage").textContent = "";
      byId("requestMessage").className = "auth-message";
    }
    openSheet(elements.requestSheet);
  }

  const player = {
    root: byId("playerView"),
    stage: byId("playerStage"),
    video: byId("videoPlayer"),
    chrome: byId("playerChrome"),
    title: byId("playerTitle"),
    subtitle: byId("playerSubtitle"),
    ambient: byId("playerAmbient"),
    loading: byId("playerLoading"),
    error: byId("playerError"),
    errorText: byId("playerErrorText"),
    centerPlay: byId("centerPlayButton"),
    playPause: byId("playPauseButton"),
    timeline: byId("timeline"),
    currentTime: byId("currentTime"),
    durationTime: byId("durationTime"),
    speed: byId("speedSelect"),
    quality: byId("qualitySelect"),
    qualityControl: byId("qualityControl"),
    captions: byId("captionsButton"),
    pip: byId("pipButton"),
    fullscreen: byId("fullscreenButton"),
    previous: byId("previousEpisodeButton"),
    next: byId("nextEpisodeButton"),
    ended: byId("endedCard"),
    endedTitle: byId("endedTitle"),
    endedNext: byId("endedNextButton"),
    seekFeedback: byId("seekFeedback"),
    media: null,
    sourceIndex: 0,
    restoreTime: 0,
    restorePlaying: false,
    controlsTimer: 0,
    endedTimer: 0,
    saveTimer: 0,
    seeking: false,
    lastTap: { time: 0, x: 0 },
    failedSources: new Set(),
    requestedPlay: false,
    switchingSource: false,
    viewRecorded: false,
    hls: null,
    hlsRecoveryAttempts: 0
  };

  function playerMediaFromRoute(route) {
    const kind = route.parts[1];
    const item = itemMap.get(route.parts[2]);
    if (!item || item.kind !== kind) return null;
    if (kind === "movie") {
      return {
        key: mediaKey(item),
        kind,
        item,
        season: null,
        episode: null,
        title: item.title,
        subtitle: `${item.year} · ${item.genres.join("، ")}`,
        thumbnail: item.backdrop || item.poster,
        sources: item.sources || [],
        subtitles: item.subtitles || [],
        previousRoute: null,
        nextRoute: null
      };
    }
    const resolved = getEpisode(item, route.parts[3], route.parts[4]);
    if (!resolved) return null;
    const previous = previousEpisode(item, resolved.season.number, resolved.episode.number);
    const next = nextEpisode(item, resolved.season.number, resolved.episode.number);
    return {
      key: mediaKey(item, resolved.season.number, resolved.episode.number),
      kind,
      item,
      season: resolved.season,
      episode: resolved.episode,
      title: item.title,
      subtitle: `الموسم ${resolved.season.number} · الحلقة ${resolved.episode.number} · ${resolved.episode.title}`,
      thumbnail: resolved.episode.thumbnail || item.backdrop || item.poster,
      sources: resolved.episode.sources || [],
      subtitles: resolved.episode.subtitles || [],
      previousRoute: previous ? `watch/series/${encodeURIComponent(item.id)}/${previous.season.number}/${previous.episode.number}` : null,
      nextRoute: next ? `watch/series/${encodeURIComponent(item.id)}/${next.season.number}/${next.episode.number}` : null
    };
  }

  function previousEpisode(item, seasonNumber, episodeNumber) {
    const flat = item.seasons.flatMap((season) => season.episodes.map((episode) => ({ season, episode })));
    const index = flat.findIndex((entry) => Number(entry.season.number) === Number(seasonNumber) && Number(entry.episode.number) === Number(episodeNumber));
    return index > 0 ? flat[index - 1] : null;
  }

  function nextEpisode(item, seasonNumber, episodeNumber) {
    const flat = item.seasons.flatMap((season) => season.episodes.map((episode) => ({ season, episode })));
    const index = flat.findIndex((entry) => Number(entry.season.number) === Number(seasonNumber) && Number(entry.episode.number) === Number(episodeNumber));
    return index >= 0 ? flat[index + 1] || null : null;
  }

  function openPlayerForRoute(route) {
    const media = playerMediaFromRoute(route);
    if (!media || !media.sources.length) {
      destroyHls();
      clearInterval(player.endedTimer);
      player.endedTimer = 0;
      player.video.pause();
      player.video.removeAttribute("src");
      player.video.load();
      player.video.querySelectorAll('track[data-cinaro-track="true"]').forEach((track) => track.remove());
      player.media = media;
      player.requestedPlay = false;
      player.restorePlaying = false;
      player.switchingSource = false;
      player.failedSources.clear();
      player.root.hidden = false;
      player.previous.hidden = !media?.previousRoute;
      player.next.hidden = !media?.nextRoute;
      player.ended.hidden = true;
      player.error.hidden = false;
      player.loading.hidden = true;
      player.errorText.textContent = "لا يوجد رابط فيديو صالح لهذا المحتوى.";
      return;
    }

    player.root.hidden = false;
    if (player.media?.key === media.key && player.video.src) {
      showPlayerControls();
      return;
    }

    clearInterval(player.endedTimer);
    player.endedTimer = 0;
    player.media = media;
    player.sourceIndex = 0;
    player.failedSources.clear();
    player.viewRecorded = false;
    player.requestedPlay = true;
    player.restoreTime = Number(watchHistory[media.key]?.time || 0);
    player.restorePlaying = true;
    player.title.textContent = media.title;
    player.subtitle.textContent = media.subtitle;
    player.ambient.style.backgroundImage = `url('${cssImage(media.thumbnail)}')`;
    player.previous.hidden = !media.previousRoute;
    player.next.hidden = !media.nextRoute;
    player.ended.hidden = true;
    player.error.hidden = true;
    player.loading.hidden = false;
    player.stage.classList.remove("is-playing", "controls-hidden");
    const savedRate = Math.max(.5, Math.min(2, Number(settings.playbackRate) || 1));
    player.speed.value = String(savedRate);
    player.video.playbackRate = savedRate;

    populateQualityOptions(media.sources);
    populateSubtitleTracks(media.subtitles);
    loadPlayerSource(0, player.restoreTime, true);
    state.firebase?.log("select_content", {
      content_type: media.kind,
      item_id: media.item.id
    });
    updatePlayerInfo();

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: media.episode ? `${media.title} — ${media.episode.title}` : media.title,
          artist: media.subtitle,
          album: "CINARO",
          artwork: [{ src: safeMediaUrl(media.item.poster), sizes: "512x768" }]
        });
      } catch (_) {}
    }
  }

  function populateQualityOptions(sources) {
    player.quality.innerHTML = sources.map((source, index) => `<option value="${index}">${escapeHTML(source.label || `المصدر ${index + 1}`)}</option>`).join("");
    player.quality.value = "0";
    player.qualityControl.hidden = !sources.length;
  }

  function populateSubtitleTracks(tracks) {
    player.video.querySelectorAll('track[data-cinaro-track="true"]').forEach((track) => track.remove());
    tracks.forEach((trackData, index) => {
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = trackData.label || trackData.srclang || "ترجمة";
      track.srclang = trackData.srclang || "ar";
      const trackUrl = safeMediaUrl(trackData.src, "");
      if (!trackUrl) return;
      track.src = trackUrl;
      track.default = Boolean(settings.captionsEnabled && index === 0);
      track.dataset.cinaroTrack = "true";
      player.video.appendChild(track);
    });
    player.captions.hidden = tracks.length === 0;
    player.captions.classList.toggle("active", Boolean(settings.captionsEnabled && tracks.length));
  }

  function destroyHls() {
    if (!player.hls) return;
    try { player.hls.destroy(); } catch (_) {}
    player.hls = null;
    player.hlsRecoveryAttempts = 0;
  }

  function isHlsSource(source, sourceUrl) {
    const type = String(source?.type || "").toLowerCase();
    if (type.includes("mpegurl") || type.includes("hls")) return true;
    try {
      return new URL(sourceUrl, location.href).pathname.toLowerCase().endsWith(".m3u8");
    } catch (_) {
      return /\.m3u8(?:$|[?#])/i.test(sourceUrl);
    }
  }

  function loadPlayerSource(index, restoreTime = 0, shouldPlay = false) {
    const source = player.media?.sources[index];
    player.sourceIndex = index;
    if (!source) {
      showPlayerError("لا يوجد مصدر فيديو صالح لهذا المحتوى.");
      return;
    }
    const sourceUrl = safeMediaUrl(source.url, "");
    if (!sourceUrl) {
      player.failedSources.add(index);
      handlePlayerError();
      return;
    }
    player.restoreTime = Number(restoreTime) || 0;
    player.restorePlaying = Boolean(shouldPlay);
    player.requestedPlay = Boolean(shouldPlay);
    player.switchingSource = true;
    player.error.hidden = true;
    player.loading.hidden = false;
    player.video.pause();
    destroyHls();
    player.video.removeAttribute("src");
    player.video.load();
    player.quality.value = String(index);

    if (isHlsSource(source, sourceUrl)) {
      const HlsRuntime = window.Hls;
      if (HlsRuntime?.isSupported?.()) {
        const hls = new HlsRuntime({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90
        });
        player.hls = hls;
        player.hlsRecoveryAttempts = 0;

        hls.on(HlsRuntime.Events.MEDIA_ATTACHED, () => {
          if (player.hls === hls) hls.loadSource(sourceUrl);
        });
        hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
          if (player.hls !== hls || !data?.fatal) return;

          if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR && player.hlsRecoveryAttempts < 1) {
            player.hlsRecoveryAttempts += 1;
            hls.startLoad();
            return;
          }
          if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR && player.hlsRecoveryAttempts < 2) {
            player.hlsRecoveryAttempts += 1;
            hls.recoverMediaError();
            return;
          }

          destroyHls();
          handlePlayerError();
        });
        hls.attachMedia(player.video);
        return;
      }

      if (player.video.canPlayType("application/vnd.apple.mpegurl")) {
        player.video.src = sourceUrl;
        player.video.load();
        return;
      }

      player.failedSources.add(index);
      handlePlayerError();
      return;
    }

    player.video.src = sourceUrl;
    player.video.load();
  }

  function releasePlayerMedia() {
    player.video.pause();
    destroyHls();
    player.requestedPlay = false;
    player.restorePlaying = false;
    player.switchingSource = false;
    player.failedSources.clear();
    clearTimeout(player.controlsTimer);
    clearInterval(player.endedTimer);
    player.controlsTimer = 0;
    player.endedTimer = 0;

    if (document.pictureInPictureElement === player.video) {
      document.exitPictureInPicture().catch(() => {});
    }
    if (document.fullscreenElement && player.stage.contains(document.fullscreenElement)) {
      document.exitFullscreen().catch(() => {});
    }
    requestPortraitMode();

    player.video.removeAttribute("src");
    player.video.load();
    player.video.querySelectorAll('track[data-cinaro-track="true"]').forEach((track) => track.remove());
    player.media = null;
    player.sourceIndex = 0;
    player.restoreTime = 0;
    player.ended.hidden = true;
    player.error.hidden = true;
    player.loading.hidden = true;
    player.stage.classList.remove("controls-hidden", "is-playing");
  }

  function hidePlayer() {
    if (!player.root.hidden) persistPlayerProgress(true);
    player.root.hidden = true;
    releasePlayerMedia();
  }

  function closePlayer() {
    persistPlayerProgress(true);
    requestPortraitMode();
    const fallback = player.media ? `#details/${encodeURIComponent(player.media.item.id)}` : "#home";
    navigate((state.lastNonPlayerHash || fallback).slice(1));
  }

  function togglePlayback() {
    if (!player.media) return;
    if (player.video.paused || player.video.ended) {
      if (player.video.ended) player.video.currentTime = 0;
      player.requestedPlay = true;
      player.video.play().catch(() => showPlayerControls());
    } else {
      player.requestedPlay = false;
      player.video.pause();
    }
  }

  function updatePlaybackIcons() {
    const playing = !player.video.paused && !player.video.ended;
    const name = playing ? "pause" : "play";
    player.playPause.innerHTML = icon(name);
    player.playPause.setAttribute("aria-label", playing ? "إيقاف مؤقت" : "تشغيل");
    player.centerPlay.innerHTML = icon(name);
    player.stage.classList.toggle("is-playing", playing);
  }

  function updateTimeline() {
    const duration = Number(player.video.duration) || 0;
    const current = Number(player.video.currentTime) || 0;
    const ratio = duration ? current / duration : 0;
    if (!player.seeking) player.timeline.value = String(Math.round(ratio * 1000));
    player.timeline.style.setProperty("--played", `${Math.max(0, Math.min(100, ratio * 100))}%`);
    player.currentTime.textContent = formatClock(current);
    player.durationTime.textContent = formatClock(duration);
  }

  function persistPlayerProgress(force = false) {
    const media = player.media;
    const duration = Number(player.video.duration);
    const currentTime = Number(player.video.currentTime);
    if (!media || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return;
    const now = Date.now();
    if (!force && now - player.saveTimer < 3000) return;
    player.saveTimer = now;
    const percent = safePercent((currentTime / duration) * 100);
    watchHistory[media.key] = {
      key: media.key,
      contentId: media.item.id,
      kind: media.kind,
      season: media.season?.number || null,
      episode: media.episode?.number || null,
      episodeTitle: media.episode?.title || "",
      thumbnail: media.thumbnail,
      time: currentTime,
      duration,
      percent,
      updatedAt: now
    };
    saveHistory();
  }

  function seekBy(seconds) {
    if (!Number.isFinite(player.video.duration)) return;
    player.video.currentTime = Math.max(0, Math.min(player.video.duration, player.video.currentTime + seconds));
    showSeekFeedback(seconds > 0 ? `+${seconds} ث` : `${seconds} ث`);
    updateTimeline();
  }

  function showSeekFeedback(text) {
    player.seekFeedback.textContent = text;
    player.seekFeedback.classList.add("show");
    window.clearTimeout(player.seekFeedback._timer);
    player.seekFeedback._timer = window.setTimeout(() => player.seekFeedback.classList.remove("show"), 650);
  }

  function requestPortraitMode() {
    try { screen.orientation?.unlock?.(); } catch (_) {}
    try { window.CinaroNative?.requestPortrait?.(); } catch (_) {}
  }

  function showPlayerControls() {
    player.stage.classList.remove("controls-hidden");
    clearTimeout(player.controlsTimer);
    if (!player.video.paused && !player.video.ended) {
      player.controlsTimer = window.setTimeout(() => {
        if (!player.seeking && !state.activeSheet) player.stage.classList.add("controls-hidden");
      }, 3200);
    }
  }

  function togglePlayerControls() {
    if (player.stage.classList.contains("controls-hidden")) showPlayerControls();
    else if (!player.video.paused) player.stage.classList.add("controls-hidden");
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        const request = player.stage.requestFullscreen || player.stage.webkitRequestFullscreen;
        await request?.call(player.stage);
        try { await screen.orientation?.lock?.("landscape"); } catch (_) {}
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        await exit?.call(document);
      }
    } catch (_) {
      toast("ملء الشاشة غير مدعوم في هذا المتصفح", "error");
    }
  }

  async function togglePictureInPicture() {
    try {
      const nativeSupported = Boolean(window.CinaroNative?.isPictureInPictureSupported?.());
      if (nativeSupported) {
        window.CinaroNative.enterPictureInPicture();
        showPlayerControls();
        return;
      }
      if (!document.pictureInPictureEnabled || player.video.disablePictureInPicture) throw new Error("unsupported");
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await player.video.requestPictureInPicture();
    } catch (_) {
      toast("وضع الصورة داخل صورة غير متاح على هذا الجهاز", "error");
    }
  }

  function toggleCaptions() {
    const tracks = Array.from(player.video.textTracks || []);
    if (!tracks.length) return;
    const enable = tracks.every((track) => track.mode !== "showing");
    tracks.forEach((track, index) => { track.mode = enable && index === 0 ? "showing" : "disabled"; });
    settings.captionsEnabled = enable;
    saveSettings();
    player.captions.classList.toggle("active", enable);
    toast(enable ? "تم تشغيل الترجمة" : "تم إيقاف الترجمة");
  }

  function goToPreviousEpisode() {
    if (!player.media?.previousRoute) return;
    clearInterval(player.endedTimer);
    player.endedTimer = 0;
    navigate(player.media.previousRoute, true);
  }

  function goToNextEpisode() {
    if (!player.media?.nextRoute) return;
    clearInterval(player.endedTimer);
    player.endedTimer = 0;
    navigate(player.media.nextRoute, true);
  }

  function handleVideoEnded() {
    persistPlayerProgress(true);
    player.requestedPlay = false;
    player.ended.hidden = false;
    player.endedTitle.textContent = player.media?.episode ? `انتهت الحلقة ${player.media.episode.number}` : "انتهى الفيلم";
    player.endedNext.hidden = !player.media?.nextRoute;
    showPlayerControls();
    clearInterval(player.endedTimer);
    player.endedTimer = 0;
    if (settings.autoplayNext && player.media?.nextRoute) {
      let remaining = 5;
      player.endedNext.textContent = `الحلقة التالية (${remaining})`;
      player.endedTimer = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(player.endedTimer);
          player.endedTimer = 0;
          goToNextEpisode();
        } else {
          player.endedNext.textContent = `الحلقة التالية (${remaining})`;
        }
      }, 1000);
    }
  }

  function updatePlayerInfo() {
    const media = player.media;
    if (!media) return;
    byId("playerInfoContent").innerHTML = `
      <div class="info-grid">
        <div class="info-cell"><small>العنوان</small><b>${escapeHTML(media.title)}</b></div>
        <div class="info-cell"><small>المحتوى</small><b>${escapeHTML(media.subtitle)}</b></div>
        <div class="info-cell"><small>المصدر</small><b>${escapeHTML(media.sources[player.sourceIndex]?.label || "تلقائي")}</b></div>
        <div class="info-cell"><small>السرعة</small><b>${escapeHTML(player.video.playbackRate)}×</b></div>
        <div class="info-cell"><small>المدة</small><b>${formatClock(player.video.duration)}</b></div>
        <div class="info-cell"><small>الإصدار</small><b>CINARO ${APP_VERSION}</b></div>
      </div>`;
  }

  function showPlayerError(customMessage = "") {
    player.switchingSource = false;
    player.loading.hidden = true;
    player.error.hidden = false;
    player.stage.classList.remove("is-playing");
    const code = player.video.error?.code;
    const messages = {
      1: "تم إيقاف تحميل الفيديو.",
      2: "حدث خطأ في الشبكة أثناء تحميل الفيديو.",
      3: "تعذّر فك ترميز ملف الفيديو.",
      4: "الرابط أو صيغة الفيديو غير مدعومين. تأكد أن الرابط مباشر ويدعم التشغيل."
    };
    player.errorText.textContent = customMessage || messages[code] || "تحقق من الرابط أو اتصال الإنترنت ثم أعد المحاولة.";
    showPlayerControls();
  }

  function handlePlayerError() {
    if (!player.media) {
      showPlayerError();
      return;
    }

    player.failedSources.add(player.sourceIndex);
    const nextIndex = player.media.sources.findIndex((source, index) => (
      !player.failedSources.has(index) && Boolean(safeMediaUrl(source?.url, ""))
    ));

    if (nextIndex >= 0) {
      const resumeTime = Math.max(Number(player.video.currentTime) || 0, Number(player.restoreTime) || 0);
      const nextLabel = player.media.sources[nextIndex]?.label || `المصدر ${nextIndex + 1}`;
      toast(`تعذّر المصدر الحالي — الانتقال إلى ${nextLabel}`);
      state.firebase?.log("video_source_fallback", {
        item_id: player.media.item.id,
        source_index: nextIndex
      });
      loadPlayerSource(nextIndex, resumeTime, player.requestedPlay);
      return;
    }

    showPlayerError("تعذّر تشغيل جميع المصادر المتاحة. تحقق من الإنترنت أو حدّث روابط الفيديو.");
  }

  function bindPlayerEvents() {
    player.video.addEventListener("loadstart", () => {
      player.loading.hidden = false;
      player.error.hidden = true;
    });
    player.video.addEventListener("loadedmetadata", () => {
      player.switchingSource = false;
      const resumeTime = Math.min(player.restoreTime || 0, Math.max(0, player.video.duration - 2));
      if (resumeTime > 3) {
        player.video.currentTime = resumeTime;
        toast(`تمت المتابعة من ${formatClock(resumeTime)}`);
      }
      player.restoreTime = 0;
      updateTimeline();
      updatePlayerInfo();
      if (player.restorePlaying) {
        player.restorePlaying = false;
        player.video.play().catch(() => showPlayerControls());
      }
    });
    ["canplay", "playing"].forEach((eventName) => player.video.addEventListener(eventName, () => {
      player.loading.hidden = true;
      player.error.hidden = true;
    }));
    player.video.addEventListener("waiting", () => { if (!player.video.paused) player.loading.hidden = false; });
    player.video.addEventListener("playing", () => {
      player.switchingSource = false;
      player.requestedPlay = true;
      updatePlaybackIcons();
      player.ended.hidden = true;
      showPlayerControls();
    });
    player.video.addEventListener("pause", () => {
      if (!player.switchingSource) player.requestedPlay = false;
      updatePlaybackIcons();
      persistPlayerProgress(true);
      showPlayerControls();
    });
    player.video.addEventListener("timeupdate", () => {
      updateTimeline();
      persistPlayerProgress(false);
      if (!player.viewRecorded && player.media && player.video.currentTime >= 10 && state.firebase && state.authUser) {
        player.viewRecorded = true;
        state.firebase.recordView(player.media.item.id).catch((error) => {
          console.warn("CINARO view counter failed", error);
          window.setTimeout(() => { player.viewRecorded = false; }, 30000);
        });
      }
    });
    player.video.addEventListener("durationchange", updateTimeline);
    player.video.addEventListener("ratechange", updatePlayerInfo);
    player.video.addEventListener("ended", handleVideoEnded);
    player.video.addEventListener("error", handlePlayerError);

    player.centerPlay.addEventListener("click", (event) => { event.stopPropagation(); togglePlayback(); });
    player.playPause.addEventListener("click", togglePlayback);
    byId("backTenButton").addEventListener("click", () => seekBy(-10));
    byId("forwardTenButton").addEventListener("click", () => seekBy(10));
    byId("closePlayerButton").addEventListener("click", closePlayer);
    byId("retryVideoButton").addEventListener("click", () => {
      player.failedSources.clear();
      loadPlayerSource(player.sourceIndex, player.video.currentTime || player.restoreTime, true);
    });
    player.previous.addEventListener("click", goToPreviousEpisode);
    player.next.addEventListener("click", goToNextEpisode);
    player.endedNext.addEventListener("click", goToNextEpisode);
    byId("replayButton").addEventListener("click", () => {
      clearInterval(player.endedTimer);
      player.endedTimer = 0;
      player.ended.hidden = true;
      player.video.currentTime = 0;
      player.requestedPlay = true;
      player.video.play().catch(() => showPlayerControls());
    });
    player.fullscreen.addEventListener("click", toggleFullscreen);
    player.pip.addEventListener("click", togglePictureInPicture);
    player.captions.addEventListener("click", toggleCaptions);
    byId("requestContentButton")?.addEventListener("click", openRequestSheet);
    byId("requestForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.firebase || !state.authUser || state.authUser.isAnonymous) return openRequestSheet();
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      submit.disabled = true;
      byId("requestMessage").textContent = "جاري إرسال الطلب…";
      byId("requestMessage").className = "auth-message";
      try {
        const requestedKind = byId("requestKind").value === "series" ? "series" : "movie";
        const requestedTitle = byId("requestName").value.trim();
        const normalizedTitle = normalizeArabic(requestedTitle);
        const existingContent = DATA.items.find((item) => item.kind === requestedKind && [item.title, item.englishTitle].some((title) => normalizeArabic(title || "") === normalizedTitle));
        if (existingContent) throw Object.assign(new Error("cinaro/request-exists"), { code: "cinaro/request-exists" });
        const duplicate = state.requests.find((request) =>
          request.kind === requestedKind &&
          ["new", "reviewing"].includes(request.status) &&
          normalizeArabic(request.title || "") === normalizedTitle
        );
        if (duplicate) throw Object.assign(new Error("cinaro/request-duplicate"), { code: "cinaro/request-duplicate" });
        await state.firebase.submitContentRequest({
          kind: requestedKind,
          title: requestedTitle,
          notes: byId("requestNotes").value
        });
        closeSheets();
        state.libraryTab = "requests";
        navigate("library");
        toast("تم إرسال طلبك إلى الإدارة");
      } catch (error) {
        byId("requestMessage").textContent = authErrorMessage(error);
        byId("requestMessage").className = "auth-message error";
      } finally {
        submit.disabled = false;
      }
    });

    byId("playerMoreButton").addEventListener("click", () => { updatePlayerInfo(); openSheet(elements.infoSheet); });
    byId("openReportButton").addEventListener("click", () => {
      if (!player.media) return;
      if (!state.firebase || !state.authUser) {
        closeSheets();
        toast("اتصل بالإنترنت وسجّل الدخول لإرسال البلاغ", "error");
        return;
      }
      byId("reportForm").reset();
      byId("reportMessage").textContent = "";
      byId("reportMessage").className = "auth-message";
      openSheet(elements.reportSheet);
    });
    byId("reportForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!player.media || !state.firebase || !state.authUser) return;
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      submit.disabled = true;
      byId("reportMessage").textContent = "جاري إرسال البلاغ…";
      byId("reportMessage").className = "auth-message";
      try {
        await state.firebase.submitReport({
          contentId: player.media.item.id,
          contentTitle: player.media.item.title,
          kind: player.media.kind,
          season: player.media.season?.number || 0,
          episode: player.media.episode?.number || 0,
          category: byId("reportCategory").value,
          details: byId("reportDetails").value,
          sourceUrl: player.media.sources[player.sourceIndex]?.url || ""
        });
        closeSheets();
        toast("وصل البلاغ إلى الإدارة — شكراً لك");
      } catch (error) {
        byId("reportMessage").textContent = authErrorMessage(error);
        byId("reportMessage").className = "auth-message error";
      } finally {
        submit.disabled = false;
      }
    });

    player.timeline.addEventListener("input", () => {
      player.seeking = true;
      const duration = Number(player.video.duration) || 0;
      const nextTime = duration * (Number(player.timeline.value) / 1000);
      player.currentTime.textContent = formatClock(nextTime);
      player.timeline.style.setProperty("--played", `${Number(player.timeline.value) / 10}%`);
      showPlayerControls();
    });
    player.timeline.addEventListener("change", () => {
      const duration = Number(player.video.duration) || 0;
      player.video.currentTime = duration * (Number(player.timeline.value) / 1000);
      player.seeking = false;
      persistPlayerProgress(true);
      showPlayerControls();
    });
    player.speed.addEventListener("change", () => {
      player.video.playbackRate = Number(player.speed.value) || 1;
      settings.playbackRate = player.video.playbackRate;
      saveSettings();
      toast(`سرعة التشغيل ${player.video.playbackRate}×`);
    });
    player.quality.addEventListener("change", () => {
      const wasPlaying = !player.video.paused;
      const time = player.video.currentTime;
      const selectedIndex = Number(player.quality.value);
      player.failedSources.delete(selectedIndex);
      loadPlayerSource(selectedIndex, time, wasPlaying);
      toast(`الجودة: ${player.media.sources[selectedIndex]?.label || "تلقائي"}`);
    });

    player.stage.addEventListener("click", (event) => {
      if (event.target.closest("button, input, select, .select-control, .ended-card, .player-error")) return;
      togglePlayerControls();
    });
    player.stage.addEventListener("dblclick", (event) => {
      if (event.target.closest(".player-chrome, button, input, select")) return;
      const ratio = event.clientX / window.innerWidth;
      seekBy(ratio < .4 ? -10 : ratio > .6 ? 10 : 0);
    });
    player.stage.addEventListener("pointermove", (event) => {
      if (event.pointerType === "mouse") showPlayerControls();
    }, { passive: true });

    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) requestPortraitMode();
      showPlayerControls();
    });
  }

  function handleAction(button) {
    const action = button.dataset.action;
    if (action === "toggle-favorite") toggleFavorite(button.dataset.itemId);
    else if (action === "hero-dot") {
      state.heroIndex = Number(button.dataset.index) || 0;
      renderHero();
      startHeroRotation();
    } else if (action === "catalog-genre") {
      const kind = button.dataset.kind;
      if (state.catalog[kind]) {
        state.catalog[kind].genre = button.dataset.genre;
        state.catalog[kind].visible = 60;
        renderCatalog(kind);
      }
    } else if (action === "catalog-more") {
      const kind = button.dataset.kind;
      if (state.catalog[kind]) {
        state.catalog[kind].visible = (state.catalog[kind].visible || 60) + 60;
        renderCatalog(kind);
      }
    } else if (action === "search-type") {
      state.searchType = button.dataset.type;
      state.searchLimit = 60;
      renderSearch();
    } else if (action === "search-more") {
      state.searchLimit += 60;
      renderSearchResultsOnly();
    } else if (action === "clear-search") {
      state.searchQuery = "";
      state.searchLimit = 60;
      const input = byId("searchInput");
      if (input) input.value = "";
      renderSearchResultsOnly();
      input?.focus();
    } else if (action === "library-tab") {
      state.libraryTab = ["favorites", "history", "requests"].includes(button.dataset.tab) ? button.dataset.tab : "favorites";
      renderLibrary();
    } else if (action === "request-filter") {
      state.requestFilter = ["all", "active", "added", "rejected"].includes(button.dataset.filter) ? button.dataset.filter : "all";
      renderLibrary();
    } else if (action === "open-request-sheet") {
      openRequestSheet();
    } else if (action === "request-search") {
      openRequestSheet({ kind: button.dataset.kind, title: button.dataset.title });
    } else if (action === "cancel-request") {
      const requestId = button.dataset.requestId;
      const request = state.requests.find((item) => item.id === requestId);
      if (!request || request.status !== "new") return;
      askConfirmation(`إلغاء طلب «${request.title}»؟`).then((accepted) => {
        if (!accepted) return;
        state.firebase?.cancelContentRequest?.(requestId)
          .then(() => toast("تم إلغاء الطلب"))
          .catch((error) => toast(authErrorMessage(error), "error"));
      });
    } else if (action === "request-login") {
      showAuth("login");
      setAuthMessage("سجّل دخولك حتى ترسل طلب محتوى وتتابع حالته.");
    } else if (action === "remove-history") removeHistoryEntry(button.dataset.mediaKey);
    else if (action === "select-season") {
      state.selectedSeasons[button.dataset.itemId] = Number(button.dataset.season);
      renderDetails(button.dataset.itemId);
      window.setTimeout(() => $(".series-area")?.scrollIntoView({ behavior: settings.reduceMotion ? "auto" : "smooth", block: "start" }), 20);
    } else if (action === "share-item") shareItem(button.dataset.itemId);
    else if (action === "go-back") {
      handleBackNavigation();
    }
  }

  function handleBackNavigation() {
    if (state.activeSheet) {
      closeSheets();
      return true;
    }
    if (!elements.authView.hidden) {
      if (state.authUser || state.localGuest || storage.get(STORAGE.authChoice, "") === "account") {
        hideAuth();
        return true;
      }
      return false;
    }
    if (state.route?.name === "watch") {
      closePlayer();
      return true;
    }
    if (state.route?.name && state.route.name !== "home") {
      if (window.history.length > 1) window.history.back();
      else navigate("home");
      return true;
    }
    return false;
  }

  window.CINARO_HANDLE_BACK = handleBackNavigation;

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

  function bindGlobalEvents() {
    document.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        event.preventDefault();
        event.stopPropagation();
        handleAction(actionButton);
        return;
      }
      const routeTarget = event.target.closest("[data-route]");
      if (routeTarget) {
        event.preventDefault();
        navigate(routeTarget.dataset.route);
      }
    });

    document.addEventListener("keydown", (event) => {
      const routeTarget = event.target.closest?.("[data-route][tabindex]");
      if (routeTarget && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        navigate(routeTarget.dataset.route);
        return;
      }
      if (state.route?.name !== "watch" || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
      if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
      else if (event.key === "ArrowLeft") seekBy(-10);
      else if (event.key === "ArrowRight") seekBy(10);
      else if (event.key.toLowerCase() === "f") toggleFullscreen();
      else if (event.key.toLowerCase() === "m") player.video.muted = !player.video.muted;
      else if (event.key.toLowerCase() === "c") toggleCaptions();
      else if (event.key === "Escape" && state.activeSheet) closeSheets();
    });

    document.addEventListener("input", (event) => {
      if (event.target.id === "searchInput") {
        state.searchQuery = event.target.value;
        state.searchLimit = 60;
        renderSearchResultsOnly();
      }
    });

    document.addEventListener("change", (event) => {
      const sortKind = event.target.dataset.catalogSort;
      if (sortKind && state.catalog[sortKind]) {
        state.catalog[sortKind].sort = event.target.value;
        state.catalog[sortKind].visible = 60;
        renderCatalog(sortKind);
      }
    });

    document.addEventListener("error", (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || image.dataset.fallbackApplied === "true") return;
      image.dataset.fallbackApplied = "true";
      image.src = image.dataset.fallback || IMAGE_FALLBACK;
    }, true);

    window.addEventListener("error", (event) => {
      if (!event?.error || state.runtimeErrorShown) return;
      state.runtimeErrorShown = true;
      console.error("CINARO runtime error", event.error);
      toast("تعذّر تنفيذ جزء من الواجهة، وتم إبقاء التطبيق يعمل.", "error");
      window.setTimeout(() => { state.runtimeErrorShown = false; }, 2200);
    });
    window.addEventListener("unhandledrejection", (event) => {
      if (state.runtimeErrorShown) return;
      state.runtimeErrorShown = true;
      console.error("CINARO unhandled promise", event.reason);
      toast("تعذّرت عملية مؤقتة. يمكنك متابعة استخدام التطبيق.", "error");
      window.setTimeout(() => { state.runtimeErrorShown = false; }, 2200);
    });

    window.addEventListener("hashchange", renderRoute);
    window.addEventListener("scroll", () => elements.header.classList.toggle("is-scrolled", window.scrollY > 24), { passive: true });
    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
    window.addEventListener("pagehide", () => {
      persistPlayerProgress(true);
      flushCloudState();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        persistPlayerProgress(true);
        flushCloudState();
      }
    });

    elements.settingsButton.addEventListener("click", () => {
      syncSettingsControls();
      updateUpdateControl();
      openSheet(elements.settingsSheet);
    });
    elements.sheetBackdrop.addEventListener("click", closeSheets);
    $$('[data-close-sheet]').forEach((button) => button.addEventListener("click", closeSheets));

    byId("oledToggle").addEventListener("change", (event) => {
      settings.oled = event.target.checked;
      saveSettings();
      applySettings();
    });
    byId("autoplayToggle").addEventListener("change", (event) => {
      settings.autoplayNext = event.target.checked;
      saveSettings();
    });
    byId("motionToggle").addEventListener("change", (event) => {
      settings.reduceMotion = event.target.checked;
      saveSettings();
      applySettings();
      startHeroRotation();
    });
    byId("notificationsToggle")?.addEventListener("change", (event) => {
      settings.notificationsEnabled = event.target.checked;
      saveSettings();
      if (nativeNotificationsAvailable()) {
        try { window.CinaroNative.setPushEnabled(Boolean(event.target.checked)); }
        catch (error) { console.warn("CINARO push preference update failed", error); }
      }
      toast(event.target.checked ? "تم تفعيل إشعارات CINARO" : "تم إيقاف إشعارات CINARO");
    });
    byId("clearHistoryButton").addEventListener("click", async () => {
      const accepted = await askConfirmation(state.authUser && !state.authUser.isAnonymous
        ? "سيتم حذف تقدم الأفلام والحلقات من هذا الحساب وجميع أجهزته."
        : "سيتم حذف تقدم الأفلام والحلقات من هذا الجهاز.");
      if (!accepted) return;
      watchHistory = {};
      saveHistory();
      flushCloudState();
      closeSheets();
      if (state.route?.name === "library") renderLibrary();
      toast("تم مسح سجل المشاهدة");
    });
    byId("installButton").addEventListener("click", installApp);
    byId("checkUpdateButton")?.addEventListener("click", openAvailableUpdate);

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      byId("installButton").hidden = false;
    });
    window.addEventListener("appinstalled", () => {
      state.installPrompt = null;
      toast("تم تثبيت CINARO بنجاح");
    });
  }

  async function installApp() {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      closeSheets();
      return;
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    toast(isIOS ? "من زر المشاركة اختر «إضافة إلى الشاشة الرئيسية»" : "من قائمة المتصفح اختر «تثبيت التطبيق»");
  }

  function updateNetworkStatus() {
    elements.offlineBanner.hidden = navigator.onLine;
    if (navigator.onLine && state.cloudHydrated && state.cloudSavedRevision < state.cloudRevision) {
      scheduleCloudSync(300, false);
    }
  }

  function registerServiceWorker() {
    if (window.CinaroNative) return;
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(WEB_APP_VERSION)}`, { scope: "./", updateViaCache: "none" });
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              toast("يتوفر تحديث جديد وسيُطبّق عند إعادة الفتح");
            }
          });
        });
      } catch (error) {
        console.warn("CINARO service worker registration failed", error);
      }
    });
  }

  function finishSplash() {
    const previouslySeen = storage.get(STORAGE.splash, false);
    const delay = settings.reduceMotion ? 120 : previouslySeen ? 520 : 1500;
    window.setTimeout(() => {
      elements.splash.classList.add("is-done");
      document.body.classList.remove("booting");
      storage.set(STORAGE.splash, true);
      window.setTimeout(() => elements.splash.remove(), 500);
    }, delay);
  }

  function setupMediaSessionActions() {
    if (!("mediaSession" in navigator)) return;
    const actions = {
      play: () => player.video.play(),
      pause: () => player.video.pause(),
      seekbackward: (details) => seekBy(-(details.seekOffset || 10)),
      seekforward: (details) => seekBy(details.seekOffset || 10),
      previoustrack: () => player.media?.previousRoute ? goToPreviousEpisode() : seekBy(-10),
      nexttrack: goToNextEpisode,
      stop: closePlayer
    };
    Object.entries(actions).forEach(([name, handler]) => {
      try { navigator.mediaSession.setActionHandler(name, handler); } catch (_) {}
    });
  }

  function runBootStep(name, task) {
    try {
      task();
      return true;
    } catch (error) {
      console.error(`CINARO boot step failed: ${name}`, error);
      return false;
    }
  }

  function initialize() {
    runBootStep("settings", () => {
      applySettings();
      syncSettingsControls();
      syncNativePushPreference();
    });
    runBootStep("global-events", bindGlobalEvents);
    runBootStep("auth-events", bindAuthEvents);
    runBootStep("copy-protection", bindCopyProtection);
    runBootStep("player-events", bindPlayerEvents);
    runBootStep("media-session", setupMediaSessionActions);
    runBootStep("network-status", updateNetworkStatus);
    runBootStep("service-worker", registerServiceWorker);
    runBootStep("pip-events", () => {
      window.addEventListener("cinaro:pip-exit", () => {
        requestPortraitMode();
        showPlayerControls();
      });
    });

    runBootStep("initial-route", () => {
      if (!location.hash) navigate("home", true);
      else renderRoute();
    });
    runBootStep("account-ui", updateAccountUI);

    runBootStep("supabase-events", () => {
      window.addEventListener("cinaro:supabase-ready", (event) => connectSupabase(event.detail?.client));
      window.addEventListener("cinaro:supabase-error", (event) => {
        console.warn("CINARO Supabase unavailable", event.detail);
        state.authResolved = true;
        setSupabaseStatus("error", "تعذّر الاتصال مؤقتاً — التطبيق يعمل بآخر بيانات متاحة");
        updateAccountUI();
        if (!state.localGuest && !state.authUser && storage.get(STORAGE.authChoice, "") !== "account") showAuth("login");
      });
    });

    runBootStep("supabase-connect", () => {
      if (window.CINARO_SUPABASE) connectSupabase(window.CINARO_SUPABASE);
    });

    window.setTimeout(() => {
      if (state.firebase || state.authResolved) return;
      state.authResolved = true;
      setSupabaseStatus("error", "تعذّر الاتصال مؤقتاً — يمكنك المتابعة كضيف");
      runBootStep("delayed-account-ui", updateAccountUI);
      if (!state.localGuest && storage.get(STORAGE.authChoice, "") !== "account") showAuth("login");
    }, 7000);

    finishSplash();
  }

  initialize();
})();
