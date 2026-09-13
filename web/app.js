(function () {
  "use strict";

  const DATA = window.CINARO_DATA;
  const APP_VERSION = "1.0.0";
  const IMAGE_FALLBACK = "assets/images/poster-placeholder.webp";

  if (!DATA || !Array.isArray(DATA.items)) {
    document.body.innerHTML = '<div class="noscript">تعذّر تحميل بيانات CINARO. تأكد من وجود ملف data.js.</div>';
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const byId = (id) => document.getElementById(id);
  const itemMap = new Map(DATA.items.map((item) => [item.id, item]));
  const movies = DATA.items.filter((item) => item.kind === "movie");
  const series = DATA.items.filter((item) => item.kind === "series");

  const STORAGE = {
    favorites: "cinaro:favorites:v1",
    history: "cinaro:watch-history:v2",
    settings: "cinaro:settings:v1",
    splash: "cinaro:splash-seen:v1"
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
    reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  };

  let favorites = new Set(storage.get(STORAGE.favorites, []));
  let watchHistory = storage.get(STORAGE.history, {});
  let settings = { ...defaultSettings, ...storage.get(STORAGE.settings, {}) };

  const state = {
    route: null,
    heroIndex: 0,
    heroTimer: null,
    catalog: {
      movie: { genre: "الكل", sort: "latest" },
      series: { genre: "الكل", sort: "latest" }
    },
    searchQuery: "",
    searchType: "all",
    libraryTab: "favorites",
    selectedSeasons: {},
    installPrompt: null,
    activeSheet: null,
    lastFocus: null,
    lastNonPlayerHash: "#home"
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
    settingsButton: byId("settingsButton"),
    sheetBackdrop: byId("sheetBackdrop"),
    settingsSheet: byId("settingsSheet"),
    infoSheet: byId("infoSheet"),
    toastRegion: byId("toastRegion"),
    confirmDialog: byId("confirmDialog")
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

  function cssImage(value) {
    return String(value || IMAGE_FALLBACK).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
  }

  function saveHistory() {
    storage.set(STORAGE.history, watchHistory);
  }

  function saveSettings() {
    storage.set(STORAGE.settings, settings);
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
    return `<img class="${escapeAttribute(className)}" src="${escapeAttribute(url || IMAGE_FALLBACK)}" data-fallback="${IMAGE_FALLBACK}" alt="${escapeAttribute(alt || "")}" loading="${loading}">`;
  }

  function mediaCard(item) {
    const favorite = favorites.has(item.id);
    return `
      <article class="media-card" tabindex="0" role="link" data-route="details/${escapeAttribute(item.id)}" aria-label="تفاصيل ${escapeAttribute(item.title)}">
        <div class="poster-shell">
          ${imageMarkup(item.poster, `غلاف ${item.title}`)}
          <span class="kind-badge">${item.kind === "movie" ? "فيلم" : "مسلسل"}</span>
          <button class="favorite-button ${favorite ? "active" : ""}" type="button" data-action="toggle-favorite" data-item-id="${escapeAttribute(item.id)}" aria-label="${favorite ? "إزالة من قائمتي" : "إضافة إلى قائمتي"}">
            ${icon("heart")}
          </button>
          <span class="card-play">${icon("play")}</span>
        </div>
        <div class="card-copy">
          <h3 class="card-title">${escapeHTML(item.title)}</h3>
          <div class="card-meta"><span class="rating">${icon("star")} ${escapeHTML(item.rating)}</span><span>·</span><span>${escapeHTML(item.year)}</span></div>
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
    const featuredItems = DATA.featured.map((id) => itemMap.get(id)).filter(Boolean);
    const item = featuredItems[state.heroIndex % Math.max(1, featuredItems.length)] || DATA.items[0];
    const favorite = favorites.has(item.id);
    container.innerHTML = `
      <section class="hero" style="background-image:url('${cssImage(item.backdrop || item.poster)}')">
        <div class="hero-content">
          <div class="hero-copy">
            <span class="eyebrow">اختيار CINARO</span>
            <h1>${escapeHTML(item.title)}</h1>
            <p class="english-title">${escapeHTML(item.englishTitle || "")}</p>
            ${metaRow(item)}
            <p class="hero-description">${escapeHTML(item.description)}</p>
            <div class="button-row">
              <button class="button primary" type="button" data-route="${escapeAttribute(defaultWatchRoute(item))}">${icon("play")} مشاهدة الآن</button>
              <button class="button secondary" type="button" data-route="details/${escapeAttribute(item.id)}">${icon("info")} التفاصيل</button>
              <button class="button secondary ${favorite ? "is-favorite" : ""}" type="button" data-action="toggle-favorite" data-item-id="${escapeAttribute(item.id)}">${icon("heart")} ${favorite ? "في قائمتي" : "قائمتي"}</button>
            </div>
          </div>
        </div>
        <div class="hero-dots" aria-label="اختيارات الواجهة">
          ${featuredItems.map((_, index) => `<button class="hero-dot ${index === state.heroIndex ? "active" : ""}" type="button" data-action="hero-dot" data-index="${index}" aria-label="العرض ${index + 1}"></button>`).join("")}
        </div>
      </section>`;
  }

  function recentEntries() {
    return Object.values(watchHistory)
      .filter((entry) => itemMap.has(entry.contentId) && entry.percent > 0 && entry.percent < 98)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function renderHome() {
    const continueItems = recentEntries().slice(0, 8);
    const popular = sortItems(DATA.items, "popular").slice(0, 8);
    const latest = sortItems(DATA.items, "latest").slice(0, 10);
    const topRated = sortItems(DATA.items, "rating").slice(0, 8);
    const featuredSeries = sortItems(series, "popular").slice(0, 8);

    elements.home.innerHTML = `
      <div id="homeHero"></div>
      <div class="content-shell home-sections">
        ${continueItems.length ? `
          <section class="content-section">
            ${sectionHeading("أكمل من مكانك", "تابع المشاهدة", "library")}
            <div class="continue-rail">${continueItems.map(continueCard).join("")}</div>
          </section>` : ""}
        <section class="content-section">
          ${sectionHeading("يتصدر الآن", "الأكثر مشاهدة", "movies")}
          <div class="media-rail">${popular.map(mediaCard).join("")}</div>
        </section>
        <section class="content-section">
          ${sectionHeading("وصل حديثًا", "جديد CINARO", "movies")}
          <div class="media-rail">${latest.map(mediaCard).join("")}</div>
        </section>
        <section class="content-section">
          ${sectionHeading("اختيارات قوية", "الأعلى تقييمًا", "movies")}
          <div class="media-rail">${topRated.map(mediaCard).join("")}</div>
        </section>
        <section class="content-section">
          ${sectionHeading("حلقات ومواسم", "مسلسلات مميزة", "series")}
          <div class="media-rail">${featuredSeries.map(mediaCard).join("")}</div>
        </section>
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
    const title = kind === "movie" ? "الأفلام" : "المسلسلات";
    const kicker = kind === "movie" ? "شاشة كبيرة في جيبك" : "مواسم تستحق المتابعة";
    const description = kind === "movie" ? "اكتشف الأفلام ورتّبها حسب الجديد أو التقييم أو المشاهدة." : "تصفّح المسلسلات وانتقل بين المواسم والحلقات بسهولة.";

    return `
      <div class="content-shell page-shell">
        <div class="page-heading">
          <div><span>${kicker}</span><h1>${title}</h1><p>${description}</p></div>
        </div>
        <div class="filter-panel">
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
        <div class="result-count">${sorted.length} ${kind === "movie" ? "فيلم" : "مسلسل"}</div>
        <div class="media-grid">${mediaGrid(sorted, `لا يوجد ${title} ضمن هذا التصنيف.`)}</div>
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
    clearButton?.toggleAttribute("hidden", !state.searchQuery);
    if (!state.searchQuery.trim()) {
      countNode.textContent = "";
      resultsNode.innerHTML = emptyState("search", "ابحث داخل CINARO", "اكتب اسم فيلم أو مسلسل أو تصنيف للوصول إليه مباشرة.", "", "");
      return;
    }
    countNode.textContent = `${results.length} نتيجة`;
    resultsNode.innerHTML = mediaGrid(results, "جرّب كتابة اسم مختلف أو اختر نوعًا آخر.");
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

  function renderLibrary() {
    const favoriteItems = DATA.items.filter((item) => favorites.has(item.id));
    const content = state.libraryTab === "favorites"
      ? `<div class="media-grid">${favoriteItems.length ? favoriteItems.map(mediaCard).join("") : emptyState("heart", "قائمتك فارغة", "اضغط رمز القلب على أي فيلم أو مسلسل حتى تحفظه هنا.", "home", "استكشف المحتوى")}</div>`
      : renderHistoryList();

    elements.library.innerHTML = `
      <div class="content-shell page-shell">
        <div class="page-heading">
          <div><span>مساحتك الخاصة</span><h1>قائمتي</h1><p>المحتوى المحفوظ وسجل المشاهدة موجودان على هذا الجهاز.</p></div>
        </div>
        <div class="library-tabs" role="tablist">
          <button class="${state.libraryTab === "favorites" ? "active" : ""}" type="button" role="tab" data-action="library-tab" data-tab="favorites">${icon("heart")} المفضلة</button>
          <button class="${state.libraryTab === "history" ? "active" : ""}" type="button" role="tab" data-action="library-tab" data-tab="history">${icon("history")} سجل المشاهدة</button>
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
    if (replace) window.history.replaceState(null, "", nextHash);
    else if (location.hash === nextHash) renderRoute();
    else location.hash = nextHash;
  }

  function updateNavigation(route) {
    let active = route.name;
    if (route.name === "details") {
      const item = itemMap.get(route.parts[1]);
      active = item?.kind === "series" ? "series" : "movies";
    }
    $$('[data-route="home"], [data-route="movies"], [data-route="series"], [data-route="library"]')
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

    window.scrollTo({ top: 0, behavior: settings.reduceMotion ? "auto" : "smooth" });
    elements.main?.focus({ preventScroll: true });
  }

  function refreshCurrentView() {
    const scrollPosition = window.scrollY;
    const route = state.route || parseRoute();
    if (route.name === "home") renderHome();
    else if (route.name === "movies") renderCatalog("movie");
    else if (route.name === "series") renderCatalog("series");
    else if (route.name === "library") renderLibrary();
    else if (route.name === "search") renderSearchResultsOnly();
    else if (route.name === "details") renderDetails(route.parts[1]);
    window.scrollTo(0, scrollPosition);
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
    [elements.settingsSheet, elements.infoSheet].forEach((sheet) => {
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
    lastTap: { time: 0, x: 0 }
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
        nextRoute: null
      };
    }
    const resolved = getEpisode(item, route.parts[3], route.parts[4]);
    if (!resolved) return null;
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
      nextRoute: next ? `watch/series/${encodeURIComponent(item.id)}/${next.season.number}/${next.episode.number}` : null
    };
  }

  function nextEpisode(item, seasonNumber, episodeNumber) {
    const flat = item.seasons.flatMap((season) => season.episodes.map((episode) => ({ season, episode })));
    const index = flat.findIndex((entry) => Number(entry.season.number) === Number(seasonNumber) && Number(entry.episode.number) === Number(episodeNumber));
    return index >= 0 ? flat[index + 1] || null : null;
  }

  function openPlayerForRoute(route) {
    const media = playerMediaFromRoute(route);
    if (!media || !media.sources.length) {
      player.root.hidden = false;
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

    clearTimeout(player.endedTimer);
    player.media = media;
    player.sourceIndex = 0;
    player.restoreTime = Number(watchHistory[media.key]?.time || 0);
    player.restorePlaying = true;
    player.title.textContent = media.title;
    player.subtitle.textContent = media.subtitle;
    player.ambient.style.backgroundImage = `url('${cssImage(media.thumbnail)}')`;
    player.next.hidden = !media.nextRoute;
    player.ended.hidden = true;
    player.error.hidden = true;
    player.loading.hidden = false;
    player.stage.classList.remove("is-playing", "controls-hidden");
    player.speed.value = "1";
    player.video.playbackRate = 1;

    populateQualityOptions(media.sources);
    populateSubtitleTracks(media.subtitles);
    loadPlayerSource(0, player.restoreTime, true);
    updatePlayerInfo();

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: media.episode ? `${media.title} — ${media.episode.title}` : media.title,
          artist: media.subtitle,
          album: "CINARO",
          artwork: [{ src: new URL(media.item.poster, location.href).href, sizes: "512x768" }]
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
    $$('track[data-cinaro-track="true"]', player.video).forEach((track) => track.remove());
    tracks.forEach((trackData) => {
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = trackData.label || trackData.srclang || "ترجمة";
      track.srclang = trackData.srclang || "ar";
      track.src = trackData.src;
      track.dataset.cinaroTrack = "true";
      player.video.appendChild(track);
    });
    player.captions.hidden = tracks.length === 0;
    player.captions.classList.remove("active");
  }

  function loadPlayerSource(index, restoreTime = 0, shouldPlay = false) {
    const source = player.media?.sources[index];
    if (!source) return;
    player.sourceIndex = index;
    player.restoreTime = Number(restoreTime) || 0;
    player.restorePlaying = Boolean(shouldPlay);
    player.error.hidden = true;
    player.loading.hidden = false;
    player.video.pause();
    player.video.src = source.url;
    player.video.load();
  }

  function hidePlayer() {
    if (player.root.hidden) return;
    persistPlayerProgress(true);
    player.video.pause();
    player.root.hidden = true;
    player.stage.classList.remove("controls-hidden", "is-playing");
    clearTimeout(player.controlsTimer);
    clearTimeout(player.endedTimer);
  }

  function closePlayer() {
    persistPlayerProgress(true);
    const fallback = player.media ? `#details/${encodeURIComponent(player.media.item.id)}` : "#home";
    navigate((state.lastNonPlayerHash || fallback).slice(1));
  }

  function togglePlayback() {
    if (!player.media) return;
    if (player.video.paused || player.video.ended) {
      if (player.video.ended) player.video.currentTime = 0;
      player.video.play().catch(() => showPlayerControls());
    } else {
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
      if (!document.pictureInPictureEnabled || player.video.disablePictureInPicture) throw new Error("unsupported");
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await player.video.requestPictureInPicture();
    } catch (_) {
      toast("وضع الصورة داخل صورة غير متاح", "error");
    }
  }

  function toggleCaptions() {
    const tracks = Array.from(player.video.textTracks || []);
    if (!tracks.length) return;
    const enable = tracks.every((track) => track.mode !== "showing");
    tracks.forEach((track, index) => { track.mode = enable && index === 0 ? "showing" : "disabled"; });
    player.captions.classList.toggle("active", enable);
    toast(enable ? "تم تشغيل الترجمة" : "تم إيقاف الترجمة");
  }

  function goToNextEpisode() {
    if (!player.media?.nextRoute) return;
    clearTimeout(player.endedTimer);
    navigate(player.media.nextRoute, true);
  }

  function handleVideoEnded() {
    persistPlayerProgress(true);
    player.ended.hidden = false;
    player.endedTitle.textContent = player.media?.episode ? `انتهت الحلقة ${player.media.episode.number}` : "انتهى الفيلم";
    player.endedNext.hidden = !player.media?.nextRoute;
    showPlayerControls();
    if (settings.autoplayNext && player.media?.nextRoute) {
      let remaining = 5;
      player.endedNext.textContent = `الحلقة التالية (${remaining})`;
      player.endedTimer = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(player.endedTimer);
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

  function showPlayerError() {
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
    player.errorText.textContent = messages[code] || "تحقق من الرابط أو اتصال الإنترنت ثم أعد المحاولة.";
    showPlayerControls();
  }

  function bindPlayerEvents() {
    player.video.addEventListener("loadstart", () => {
      player.loading.hidden = false;
      player.error.hidden = true;
    });
    player.video.addEventListener("loadedmetadata", () => {
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
      updatePlaybackIcons();
      player.ended.hidden = true;
      showPlayerControls();
    });
    player.video.addEventListener("pause", () => {
      updatePlaybackIcons();
      persistPlayerProgress(true);
      showPlayerControls();
    });
    player.video.addEventListener("timeupdate", () => {
      updateTimeline();
      persistPlayerProgress(false);
    });
    player.video.addEventListener("durationchange", updateTimeline);
    player.video.addEventListener("ratechange", updatePlayerInfo);
    player.video.addEventListener("ended", handleVideoEnded);
    player.video.addEventListener("error", showPlayerError);

    player.centerPlay.addEventListener("click", (event) => { event.stopPropagation(); togglePlayback(); });
    player.playPause.addEventListener("click", togglePlayback);
    byId("backTenButton").addEventListener("click", () => seekBy(-10));
    byId("forwardTenButton").addEventListener("click", () => seekBy(10));
    byId("closePlayerButton").addEventListener("click", closePlayer);
    byId("retryVideoButton").addEventListener("click", () => loadPlayerSource(player.sourceIndex, player.video.currentTime || player.restoreTime, true));
    player.next.addEventListener("click", goToNextEpisode);
    player.endedNext.addEventListener("click", goToNextEpisode);
    byId("replayButton").addEventListener("click", () => {
      clearTimeout(player.endedTimer);
      player.ended.hidden = true;
      player.video.currentTime = 0;
      player.video.play().catch(() => showPlayerControls());
    });
    player.fullscreen.addEventListener("click", toggleFullscreen);
    player.pip.addEventListener("click", togglePictureInPicture);
    player.captions.addEventListener("click", toggleCaptions);
    byId("playerMoreButton").addEventListener("click", () => { updatePlayerInfo(); openSheet(elements.infoSheet); });

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
      toast(`سرعة التشغيل ${player.video.playbackRate}×`);
    });
    player.quality.addEventListener("change", () => {
      const wasPlaying = !player.video.paused;
      const time = player.video.currentTime;
      loadPlayerSource(Number(player.quality.value), time, wasPlaying);
      toast(`الجودة: ${player.media.sources[Number(player.quality.value)]?.label || "تلقائي"}`);
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
    ["pointermove", "pointerdown"].forEach((eventName) => player.stage.addEventListener(eventName, showPlayerControls, { passive: true }));

    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) {
        try { screen.orientation?.unlock?.(); } catch (_) {}
      }
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
        renderCatalog(kind);
      }
    } else if (action === "search-type") {
      state.searchType = button.dataset.type;
      renderSearch();
    } else if (action === "clear-search") {
      state.searchQuery = "";
      const input = byId("searchInput");
      if (input) input.value = "";
      renderSearchResultsOnly();
      input?.focus();
    } else if (action === "library-tab") {
      state.libraryTab = button.dataset.tab;
      renderLibrary();
    } else if (action === "remove-history") removeHistoryEntry(button.dataset.mediaKey);
    else if (action === "select-season") {
      state.selectedSeasons[button.dataset.itemId] = Number(button.dataset.season);
      renderDetails(button.dataset.itemId);
      window.setTimeout(() => $(".series-area")?.scrollIntoView({ behavior: settings.reduceMotion ? "auto" : "smooth", block: "start" }), 20);
    } else if (action === "share-item") shareItem(button.dataset.itemId);
    else if (action === "go-back") {
      if (window.history.length > 1) window.history.back();
      else navigate("home");
    }
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
        renderSearchResultsOnly();
      }
    });

    document.addEventListener("change", (event) => {
      const sortKind = event.target.dataset.catalogSort;
      if (sortKind && state.catalog[sortKind]) {
        state.catalog[sortKind].sort = event.target.value;
        renderCatalog(sortKind);
      }
    });

    document.addEventListener("error", (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || image.dataset.fallbackApplied === "true") return;
      image.dataset.fallbackApplied = "true";
      image.src = image.dataset.fallback || IMAGE_FALLBACK;
    }, true);

    window.addEventListener("hashchange", renderRoute);
    window.addEventListener("scroll", () => elements.header.classList.toggle("is-scrolled", window.scrollY > 24), { passive: true });
    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
    window.addEventListener("pagehide", () => persistPlayerProgress(true));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) persistPlayerProgress(true);
    });

    elements.settingsButton.addEventListener("click", () => {
      syncSettingsControls();
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
    byId("clearHistoryButton").addEventListener("click", async () => {
      const accepted = await askConfirmation("سيتم حذف تقدم الأفلام والحلقات من هذا الجهاز فقط.");
      if (!accepted) return;
      watchHistory = {};
      saveHistory();
      closeSheets();
      if (state.route?.name === "library") renderLibrary();
      toast("تم مسح سجل المشاهدة");
    });
    byId("installButton").addEventListener("click", installApp);

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
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
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
    const delay = settings.reduceMotion ? 120 : previouslySeen ? 650 : 1750;
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
      previoustrack: () => seekBy(-10),
      nexttrack: goToNextEpisode,
      stop: closePlayer
    };
    Object.entries(actions).forEach(([name, handler]) => {
      try { navigator.mediaSession.setActionHandler(name, handler); } catch (_) {}
    });
  }

  function initialize() {
    applySettings();
    bindGlobalEvents();
    bindPlayerEvents();
    setupMediaSessionActions();
    updateNetworkStatus();
    registerServiceWorker();
    if (!location.hash) navigate("home", true);
    renderRoute();
    finishSplash();
  }

  initialize();
})();
