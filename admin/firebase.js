"use strict";

const FIREBASE_SDK_VERSION = "12.19.0";
const ADMIN_EMAIL = "ffkyyr@gmail.com";
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

function clean(value, fallback, maximum) {
  const result = String(value == null ? "" : value).trim();
  return (result || fallback || "").slice(0, maximum || 500);
}

function asUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    isAnonymous: Boolean(user.isAnonymous),
    emailVerified: Boolean(user.emailVerified),
    isAdmin: false
  };
}

async function boot() {
  const root = "https://www.gstatic.com/firebasejs/" + FIREBASE_SDK_VERSION + "/";
  const modules = await Promise.all([
    import(root + "firebase-app.js"),
    import(root + "firebase-auth.js"),
    import(root + "firebase-firestore.js")
  ]);
  const appSdk = modules[0];
  const authSdk = modules[1];
  const firestoreSdk = modules[2];
  const app = appSdk.initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);

  await authSdk.setPersistence(auth, authSdk.browserLocalPersistence).catch(function (error) {
    console.warn("CINARO admin auth persistence unavailable", error);
  });

  function getCollection(name) {
    return firestoreSdk.collection(db, name);
  }

  const client = {
    projectId: firebaseConfig.projectId,
    adminEmail: ADMIN_EMAIL,

    onAuth: function (callback) {
      return authSdk.onAuthStateChanged(auth, async function (user) {
        if (!user) {
          callback(null);
          return;
        }
        const current = asUser(user);
        try {
          const token = await authSdk.getIdTokenResult(user, true);
          current.isAdmin = token.claims && token.claims.admin === true ||
            current.email.toLowerCase() === ADMIN_EMAIL;
        } catch (error) {
          console.warn("CINARO admin token inspection failed", error);
          current.isAdmin = current.email.toLowerCase() === ADMIN_EMAIL;
        }
        callback(current);
      });
    },

    login: async function (email, password) {
      const credential = await authSdk.signInWithEmailAndPassword(
        auth,
        clean(email, "", 180).toLowerCase(),
        String(password || "")
      );
      return credential.user;
    },

    logout: function () {
      return authSdk.signOut(auth);
    },

    listenCollection: function (name, callback, onError) {
      return firestoreSdk.onSnapshot(
        getCollection(name),
        function (snapshot) {
          const rows = snapshot.docs.map(function (snapshotDoc) {
            return Object.assign({ id: snapshotDoc.id }, plainValue(snapshotDoc.data() || {}));
          });
          callback(rows, { fromCache: snapshot.metadata.fromCache });
        },
        function (error) {
          if (typeof onError === "function") onError(error);
        }
      );
    },

    listenDoc: function (name, id, callback, onError) {
      return firestoreSdk.onSnapshot(
        firestoreSdk.doc(db, name, id),
        function (snapshot) {
          callback(snapshot.exists() ? Object.assign({ id: snapshot.id }, plainValue(snapshot.data() || {})) : null);
        },
        function (error) {
          if (typeof onError === "function") onError(error);
        }
      );
    },

    saveDocument: function (name, id, payload) {
      const safeId = clean(id, "", 150);
      if (!safeId) return Promise.reject(new Error("cinaro/invalid-document-id"));
      return firestoreSdk.setDoc(
        firestoreSdk.doc(db, name, safeId),
        Object.assign({}, payload || {}, { updatedAt: firestoreSdk.serverTimestamp() }),
        { merge: true }
      );
    },

    deleteDocument: function (name, id) {
      return firestoreSdk.deleteDoc(firestoreSdk.doc(db, name, clean(id, "", 150)));
    },

    logAudit: function (action, target, details, actor) {
      return firestoreSdk.addDoc(getCollection("auditLogs"), {
        action: clean(action, "operation", 80),
        target: clean(target, "", 180),
        details: clean(details, "", 600),
        actorUid: actor && actor.uid || "",
        actorEmail: actor && actor.email || ADMIN_EMAIL,
        createdAt: firestoreSdk.serverTimestamp()
      });
    }
  };

  window.CINARO_ADMIN_FIREBASE = client;
  announce("cinaro:admin-firebase-ready", { client: client });
}

boot().catch(function (error) {
  console.error("CINARO admin Firebase initialization failed", error);
  announce("cinaro:admin-firebase-error", {
    code: error && error.code || "firebase/unavailable",
    message: error && error.message || "Firebase unavailable"
  });
});
