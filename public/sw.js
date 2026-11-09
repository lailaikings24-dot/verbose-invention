/install
 * TorqueMedic service worker — makes the app open with no network at all.
 * 
 * Strategy:
 *   install  → pre-cache the shell (icons, manifest) and the hashed bundle that
 *              the shell references, so the very first visit is enough.
 *   navigate → serve from cache immediately when the network is slow or gone,
 *              refresh the cached shell in the background when it is not.
 *   assets   → cache first; hashed filenames can never go stale.
 */
const VERSION = 'torquemedic-v4';
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
]; 

/** Wait no longer than this for the network before showing the cached app. */
const NAV_TIMEOUT = 3500;

async function precache() {
  const cache = await caches.open(VERSION);
  await Promise.all(
    SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch {
        /* one missing file must not void the whole install */
      }
    }),
  );

  // The hashed JS/CSS names are only known after a build, so read them out of
  // the shell instead of hard-coding them. This is what makes the app usable
  // offline after a single visit rather than after a browse around.
  //
  // The shell is taken from "/" and mirrored under "/index.html": the host
  // answers a direct /index.html request with a redirect to "/", and an
  // offline reload must not depend on that redirect resolving.
  try {
    const res = (await cache.match('/')) || (await fetch('/', { cache: 'reload' }));
    if (res && res.ok) {
      const html = await res.clone().text();
      await cache.put('/index.html', res.clone());
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await Promise.all(
        assets.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch {
            /* ignore individual asset failures */
          }
        }),
      );
    }
  } catch {
    /* offline during install — runtime caching still fills the gaps later */
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function cacheShell(res) {
  if (!res || !res.ok) return;
  const copy = res.clone();
  caches.open(VERSION).then((c) => c.put('/index.html', copy)).catch(() => undefined);
}

async function navigate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match('/index.html');

  const network = fetch(request).then((res) => {
    cacheShell(res);
    return res;
  });

  if (!cached) return network;

  // Race the network against a short timer: a car park with one bar of signal
  // should not leave the user staring at a blank screen.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT));
  try {
    const res = await Promise.race([network.catch(() => null), timeout]);
    return res || cached;
  } catch {
    return cached;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(navigate(req));
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      });
    }),
  );
});
