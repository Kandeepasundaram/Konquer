const CACHE_NAME = "property-register-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./import-video.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Minimal IndexedDB access for the share-target handoff only — the full
   data layer lives in app.js, which runs in the page, not this worker. */
function swOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("PropertyRegisterDB", 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("properties")) db.createObjectStore("properties", { keyPath: "id" });
      if (!db.objectStoreNames.contains("contacts")) db.createObjectStore("contacts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sharedImports")) db.createObjectStore("sharedImports", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeSharedVideo(file) {
  const db = await swOpenDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("sharedImports", "readwrite");
    tx.objectStore("sharedImports").put({ id: "pending", blob: file, mime: file.type, createdAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("video");
    if (file && file.size > 0) {
      await storeSharedVideo(file);
      return Response.redirect("./?import=pending", 303);
    }
  } catch (e) {
    // fall through to plain redirect below
  }
  return Response.redirect("./", 303);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname.endsWith("/share-target/")) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
