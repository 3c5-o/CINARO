"use strict";

const FIREBASE_SDK_VERSION = "12.19.0";
const firebaseConfig = Object.freeze({
  apiKey: "AIzaSyBPsJ2Yxopcs3FZ8L_5Gctjts1o2r2AKAk",
  authDomain: "cinaro.firebaseapp.com",
  projectId: "cinaro",
  storageBucket: "cinaro.firebasestorage.app",
  messagingSenderId: "839712809752",
  appId: "1:839712809752:web:ea0c2d525a0a485351346d",
  measurementId: "G-WTYQCHP427"
});

function announce(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
}

function plainValue(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(plainValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(function (entry) {
      return [entry[0], plainValue(entry[1])];
    }));
  }
  return value;
}

function textValue(value, fallback, maximum) {
  const result = String(value == null ? "" : value).trim();
  return (result || fallback || "").slice(0, maximum || 500);
}

function numberValue(value, fallback, minimum, maximum) {
  const result = Number(value);
  if (!Number.isFinite(result)) return fallback || 0;
  return Math.max(minimum == null ? -Infinity : minimum, Math.min(maximum == null ? Infinity : maximum, result));
}

function dateValue(value) {
  const plain = plainValue(value);
  if (typeof plain === "number") return new Date(plain).toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(plain || ""))) return String(plain);
  return new Date().toISOString().slice(0, 10);
}

function mediaUrl(value, fallback) {
  const input = String(value || "").trim();
  if (/^assets\/[a-z0-9_./-]+$/i.test(input)) return input;
  try {
    const parsed = new URL(input);
    if (parsed.protocol === "https:") return parsed.href;
  } catch (_) {}
  return fallback || "";
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, 8).map(function (source, index) {
    const url = mediaUrl(source && source.url);
    if (!url) return null;
    return {
      label: textValue(source.label, "المصدر " + (index + 1), 40),
      url: url,
      type: textValue(source.type, "video/mp4", 80)
    };
  }).filter(Boolean);
}

function normalizeSubtitles(subtitles) {
  if (!Array.isArray(subtitles)) return [];
  return subtitles.slice(0, 12).map(function (track) {
    const src = mediaUrl(track && track.src);
    if (!src) return null;
    return {
      label: textValue(track.label, "العربية", 40),
      srclang: textValue(track.srclang, "ar", 12).toLowerCase(),
      src: src
    };
  }).filter(Boolean);
}

function normalizeEpisode(raw, index, itemPoster) {
  if (!raw || typeof raw !== "object") return null;
  const number = Math.max(1, Math.round(numberValue(raw.number, index + 1, 1, 10000)));
  return {
    id: textValue(raw.id, "e" + number, 80),
    number: number,
    title: textValue(raw.title, "الحلقة " + number, 150),
    duration: Math.round(numberValue(raw.duration, 0, 0, 10000)),
    thumbnail: mediaUrl(raw.thumbnail, itemPoster),
    sources: normalizeSources(raw.sources),
    subtitles: normalizeSubtitles(raw.subtitles)
  };
}

function normalizeSeason(raw, index, itemPoster) {
  if (!raw || typeof raw !== "object") return null;
  const number = Math.max(1, Math.round(numberValue(raw.number, index + 1, 1, 1000)));
  const episodes = (Array.isArray(raw.episodes) ? raw.episodes : [])
    .map(function (episode, episodeIndex) { return normalizeEpisode(episode, episodeIndex, itemPoster); })
    .filter(Boolean)
    .sort(function (a, b) { return a.number - b.number; });
  return {
    number: number,
    title: textValue(raw.title, "الموسم " + number, 120),
    episodes: episodes
  };
}

function normalizeContent(snapshot) {
  const raw = plainValue(snapshot.data()) || {};
  const id = textValue(raw.id, snapshot.id, 120).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const kind = raw.kind === "series" ? "series" : raw.kind === "movie" ? "movie" : "";
  const title = textValue(raw.title, "", 180);
  if (!id || !kind || !title) return null;

  const poster = mediaUrl(raw.poster, "assets/images/poster-placeholder.webp");
  const item = {
    id: id,
    kind: kind,
    title: title,
    englishTitle: textValue(raw.englishTitle, "", 180),
    year: Math.round(numberValue(raw.year, new Date().getFullYear(), 1888, 2200)),
    rating: numberValue(raw.rating, 0, 0, 10),
    ageRating: textValue(raw.ageRating, "عام", 20),
    genres: (Array.isArray(raw.genres) ? raw.genres : []).map(function (genre) {
      return textValue(genre, "", 40);
    }).filter(Boolean).slice(0, 12),
    duration: Math.round(numberValue(raw.duration, 0, 0, 10000)),
    views: Math.round(numberValue(raw.views, 0, 0, Number.MAX_SAFE_INTEGER)),
    addedAt: dateValue(raw.addedAt || raw.createdAt),
    description: textValue(raw.description, "", 3000),
    poster: poster,
    backdrop: mediaUrl(raw.backdrop, poster),
    sectionIds: (Array.isArray(raw.sectionIds) ? raw.sectionIds : []).map(function (sectionId) {
      return textValue(sectionId, "", 80);
    }).filter(Boolean).slice(0, 30),
    featured: raw.featured === true,
    order: numberValue(raw.order, 0, -100000, 100000)
  };

  if (!item.genres.length) item.genres = ["عام"];
  if (kind === "movie") {
    item.sources = normalizeSources(raw.sources);
    item.subtitles = normalizeSubtitles(raw.subtitles);
  } else {
    item.seasons = (Array.isArray(raw.seasons) ? raw.seasons : [])
      .map(function (season, seasonIndex) { return normalizeSeason(season, seasonIndex, poster); })
      .filter(Boolean)
      .sort(function (a, b) { return a.number - b.number; });
  }
  return item;
}

function publicUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    displayName: user.displayName || "",
    email: user.email || "",
    isAnonymous: Boolean(user.isAnonymous),
    emailVerified: Boolean(user.emailVerified)
  };
}

async function bootFirebase() {
  const root = "https://www.gstatic.com/firebasejs/" + FIREBASE_SDK_VERSION + "/";
  const modules = await Promise.all([
    import(root + "firebase-app.js"),
    import(root + "firebase-auth.js"),
    import(root + "firebase-firestore.js"),
    import(root + "firebase-analytics.js")
  ]);

  const appSdk = modules[0];
  const authSdk = modules[1];
  const firestoreSdk = modules[2];
  const analyticsSdk = modules[3];
  const app = appSdk.initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);
  let analytics = null;

  await authSdk.setPersistence(auth, authSdk.browserLocalPersistence).catch(function (error) {
    console.warn("CINARO Firebase auth persistence unavailable", error);
  });

  if (location.protocol === "https:") {
    analyticsSdk.isSupported().then(function (supported) {
      if (!supported) return;
      analytics = analyticsSdk.getAnalytics(app);
      analyticsSdk.logEvent(analytics, "app_open", { app_version: "2.4.0" });
    }).catch(function () {});
  }

  const client = {
    projectId: firebaseConfig.projectId,

    onAuth: function (callback) {
      return authSdk.onAuthStateChanged(auth, function (user) {
        callback(publicUser(user));
      });
    },

    register: async function (details) {
      const name = textValue(details && details.name, "", 30);
      const email = textValue(details && details.email, "", 180).toLowerCase();
      const password = String(details && details.password || "");
      if (name.length < 2) throw new Error("cinaro/name-too-short");
      if (password.length < 6) throw new Error("auth/weak-password");
      const credential = await authSdk.createUserWithEmailAndPassword(auth, email, password);
      await authSdk.updateProfile(credential.user, { displayName: name });
      await firestoreSdk.setDoc(firestoreSdk.doc(db, "users", credential.user.uid), {
        displayName: name,
        email: email,
        isAnonymous: false,
        createdAt: firestoreSdk.serverTimestamp(),
        updatedAt: firestoreSdk.serverTimestamp()
      }, { merge: true }).catch(function (error) {
        console.warn("CINARO profile sync unavailable", error);
      });
      if (analytics) analyticsSdk.logEvent(analytics, "sign_up", { method: "password" });
      return publicUser(credential.user);
    },

    login: async function (email, password) {
      const credential = await authSdk.signInWithEmailAndPassword(
        auth,
        textValue(email, "", 180).toLowerCase(),
        String(password || "")
      );
      await firestoreSdk.setDoc(firestoreSdk.doc(db, "users", credential.user.uid), {
        displayName: credential.user.displayName || "",
        email: credential.user.email || "",
        isAnonymous: false,
        updatedAt: firestoreSdk.serverTimestamp()
      }, { merge: true }).catch(function () {});
      if (analytics) analyticsSdk.logEvent(analytics, "login", { method: "password" });
      return publicUser(credential.user);
    },

    guest: async function () {
      const credential = await authSdk.signInAnonymously(auth);
      await firestoreSdk.setDoc(firestoreSdk.doc(db, "users", credential.user.uid), {
        displayName: "ضيف CINARO",
        email: "",
        isAnonymous: true,
        createdAt: firestoreSdk.serverTimestamp(),
        updatedAt: firestoreSdk.serverTimestamp()
      }, { merge: true }).catch(function () {});
      if (analytics) analyticsSdk.logEvent(analytics, "login", { method: "anonymous" });
      return publicUser(credential.user);
    },

    logout: function () {
      return authSdk.signOut(auth);
    },

    resetPassword: function (email) {
      return authSdk.sendPasswordResetEmail(auth, textValue(email, "", 180).toLowerCase());
    },

    updateAccount: async function (displayName) {
      const user = auth.currentUser;
      if (!user || user.isAnonymous) throw new Error("auth/requires-login");
      const name = textValue(displayName, "", 30);
      if (name.length < 2) throw new Error("cinaro/name-too-short");
      await authSdk.updateProfile(user, { displayName: name });
      await firestoreSdk.setDoc(firestoreSdk.doc(db, "users", user.uid), {
        displayName: name,
        email: user.email || "",
        isAnonymous: false,
        updatedAt: firestoreSdk.serverTimestamp()
      }, { merge: true });
      return publicUser(user);
    },

    sendVerification: async function () {
      const user = auth.currentUser;
      if (!user || user.isAnonymous) throw new Error("auth/requires-login");
      if (user.emailVerified) return true;
      await authSdk.sendEmailVerification(user);
      return true;
    },

    recordView: async function (contentId) {
      const user = auth.currentUser;
      const safeContentId = textValue(contentId, "", 120).toLowerCase();
      if (!user || !safeContentId) return false;
      const contentRef = firestoreSdk.doc(db, "content", safeContentId);
      const viewerRef = firestoreSdk.doc(db, "content", safeContentId, "viewers", user.uid);
      const batch = firestoreSdk.writeBatch(db);
      batch.set(viewerRef, {
        userId: user.uid,
        contentId: safeContentId,
        createdAt: firestoreSdk.serverTimestamp()
      });
      batch.update(contentRef, { views: firestoreSdk.increment(1) });
      try {
        await batch.commit();
        return true;
      } catch (error) {
        if (String(error && error.code || "").includes("permission-denied")) return false;
        throw error;
      }
    },

    submitReport: async function (payload) {
      const user = auth.currentUser;
      if (!user) throw new Error("auth/requires-login");
      const report = payload && typeof payload === "object" ? payload : {};
      return firestoreSdk.addDoc(firestoreSdk.collection(db, "reports"), {
        userId: user.uid,
        userEmail: textValue(user.email, "", 180),
        contentId: textValue(report.contentId, "", 120),
        contentTitle: textValue(report.contentTitle, "", 180),
        kind: report.kind === "series" ? "series" : "movie",
        season: Math.max(0, Math.round(numberValue(report.season, 0, 0, 1000))),
        episode: Math.max(0, Math.round(numberValue(report.episode, 0, 0, 10000))),
        category: textValue(report.category, "playback", 40),
        details: textValue(report.details, "", 600),
        sourceUrl: mediaUrl(report.sourceUrl, ""),
        status: "open",
        createdAt: firestoreSdk.serverTimestamp(),
        updatedAt: firestoreSdk.serverTimestamp()
      });
    },

    submitContentRequest: async function (payload) {
      const user = auth.currentUser;
      if (!user || user.isAnonymous || !user.email) throw new Error("auth/requires-login");
      const request = payload && typeof payload === "object" ? payload : {};
      const title = textValue(request.title, "", 180);
      if (title.length < 2) throw new Error("cinaro/request-title-too-short");
      return firestoreSdk.addDoc(firestoreSdk.collection(db, "contentRequests"), {
        userId: user.uid,
        userEmail: textValue(user.email, "", 180),
        title: title,
        kind: request.kind === "series" ? "series" : "movie",
        notes: textValue(request.notes, "", 600),
        status: "new",
        createdAt: firestoreSdk.serverTimestamp(),
        updatedAt: firestoreSdk.serverTimestamp()
      });
    },

    cancelContentRequest: async function (requestId) {
      const user = auth.currentUser;
      if (!user || user.isAnonymous) throw new Error("auth/requires-login");
      const safeId = textValue(requestId, "", 150);
      if (!safeId) throw new Error("cinaro/invalid-request");
      await firestoreSdk.deleteDoc(firestoreSdk.doc(db, "contentRequests", safeId));
      return true;
    },

    listenMyRequests: function (callback, onError) {
      const user = auth.currentUser;
      if (!user || user.isAnonymous) {
        callback([]);
        return function () {};
      }
      const requestQuery = firestoreSdk.query(
        firestoreSdk.collection(db, "contentRequests"),
        firestoreSdk.where("userId", "==", user.uid)
      );
      return firestoreSdk.onSnapshot(
        requestQuery,
        function (snapshot) {
          const rows = snapshot.docs.map(function (docSnapshot) {
            return Object.assign({ id: docSnapshot.id }, plainValue(docSnapshot.data() || {}));
          });
          callback(rows);
        },
        function (error) {
          if (typeof onError === "function") onError(error);
        }
      );
    },

    listenContent: function (callback, onError) {
      let items = [];
      let featured = [];
      let sections = [];
      let config = {};
      let fromCache = false;
      let contentReady = false;

      function emit() {
        if (!contentReady) return;
        const selectedFeatured = featured.filter(function (id) {
          return items.some(function (item) { return item.id === id; });
        });
        callback({
          items: items,
          featured: selectedFeatured.length
            ? selectedFeatured
            : items.filter(function (item) { return item.featured; }).map(function (item) { return item.id; }).slice(0, 8),
          config: config,
          sections: sections,
          fromCache: fromCache
        });
      }

      const contentQuery = firestoreSdk.query(
        firestoreSdk.collection(db, "content"),
        firestoreSdk.where("published", "==", true)
      );

      const stopContent = firestoreSdk.onSnapshot(contentQuery, function (snapshot) {
        items = snapshot.docs.map(normalizeContent).filter(Boolean).sort(function (a, b) {
          return (b.order - a.order) || String(b.addedAt).localeCompare(String(a.addedAt));
        });
        fromCache = snapshot.metadata.fromCache;
        contentReady = true;
        emit();
      }, function (error) {
        if (typeof onError === "function") onError(error);
      });

      const stopConfig = firestoreSdk.onSnapshot(
        firestoreSdk.doc(db, "appConfig", "public"),
        function (snapshot) {
          const data = snapshot.exists() ? plainValue(snapshot.data()) : {};
          featured = Array.isArray(data.featured) ? data.featured.map(String).slice(0, 12) : [];
          config = {
            announcement: textValue(data.announcement, "", 500),
            latestVersion: textValue(data.latestVersion, "2.4.0", 20),
            minimumVersion: textValue(data.minimumVersion, "2.4.0", 20),
            updateNotes: textValue(data.updateNotes, "", 1000),
            maintenance: data.maintenance === true,
            forceUpdate: data.forceUpdate === true,
            updateUrl: mediaUrl(data.updateUrl, "https://github.com/3c5-o/CINARO/releases")
          };
          emit();
        },
        function () { emit(); }
      );

      const stopSections = firestoreSdk.onSnapshot(
        firestoreSdk.collection(db, "sections"),
        function (snapshot) {
          sections = snapshot.docs.map(function (sectionSnapshot) {
            const data = plainValue(sectionSnapshot.data()) || {};
            return {
              id: textValue(data.id, sectionSnapshot.id, 80),
              name: textValue(data.name, sectionSnapshot.id, 100),
              description: textValue(data.description, "", 300),
              active: data.active !== false,
              order: numberValue(data.order, 0, -100000, 100000)
            };
          }).filter(function (section) { return section.active; }).sort(function (a, b) {
            return (b.order - a.order) || a.name.localeCompare(b.name, "ar");
          });
          emit();
        },
        function () { emit(); }
      );

      return function () {
        stopContent();
        stopConfig();
        stopSections();
      };
    },

    listenUserState: function (uid, callback, onError) {
      return firestoreSdk.onSnapshot(
        firestoreSdk.doc(db, "users", uid, "private", "state"),
        function (snapshot) {
          callback(snapshot.exists() ? plainValue(snapshot.data()) : null);
        },
        function (error) {
          if (typeof onError === "function") onError(error);
        }
      );
    },

    listenUserProfile: function (uid, callback, onError) {
      return firestoreSdk.onSnapshot(
        firestoreSdk.doc(db, "users", uid),
        function (snapshot) {
          callback(snapshot.exists() ? plainValue(snapshot.data()) : null);
        },
        function (error) {
          if (typeof onError === "function") onError(error);
        }
      );
    },

    saveUserState: function (uid, payload) {
      const favorites = Array.from(new Set(Array.isArray(payload.favorites) ? payload.favorites.map(String) : [])).slice(0, 1000);
      const historyEntries = Object.entries(payload.history && typeof payload.history === "object" ? payload.history : {})
        .sort(function (a, b) { return Number(b[1] && b[1].updatedAt || 0) - Number(a[1] && a[1].updatedAt || 0); })
        .slice(0, 500);
      return firestoreSdk.setDoc(
        firestoreSdk.doc(db, "users", uid, "private", "state"),
        {
          favorites: favorites,
          history: Object.fromEntries(historyEntries),
          settings: {
            oled: Boolean(payload.settings && payload.settings.oled),
            autoplayNext: payload.settings && payload.settings.autoplayNext !== false,
            reduceMotion: Boolean(payload.settings && payload.settings.reduceMotion),
            playbackRate: numberValue(payload.settings && payload.settings.playbackRate, 1, 0.5, 2),
            captionsEnabled: Boolean(payload.settings && payload.settings.captionsEnabled)
          },
          updatedAt: firestoreSdk.serverTimestamp()
        },
        { merge: true }
      );
    },

    log: function (name, parameters) {
      if (!analytics) return;
      analyticsSdk.logEvent(analytics, textValue(name, "event", 40), parameters || {});
    }
  };

  window.CINARO_FIREBASE = client;
  announce("cinaro:firebase-ready", { client: client });
}

bootFirebase().catch(function (error) {
  console.error("CINARO Firebase initialization failed", error);
  announce("cinaro:firebase-error", {
    code: error && error.code || "firebase/unavailable",
    message: error && error.message || "Firebase unavailable"
  });
});
