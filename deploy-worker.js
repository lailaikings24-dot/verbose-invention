 
/**
 * Static host for the built app.
 *
 * Every request is a file under ./dist, except the app routes below, which all
 * get the same shell. Three behaviours are added on top of the plain asset
 * server:
 *   - Routing: each screen has one canonical path. A trailing slash
 *     ("/codes/") is redirected to it, so the app never runs on two URLs.
 *     /, /index.html and any unknown page path return the shell, so a bookmark
 *     or a stale link can never produce a 404 page.
 *   - Assets: a missing .js/.css/.png is a real 404. Returning the HTML shell
 *     with 200 instead would surface as a confusing MIME-type error in the
 *     console after a stale deploy.
 *   - Freshness: the shell, manifest and service worker must not be cached, or
 *     a redeploy would keep serving the previous version.
 *
 * The shell is read from "/" and never from "/index.html": the asset layer
 * answers a direct index.html request with 307 → "/", so using it here would
 * bounce the browser back to the URL it came from, forever.
 */

/**
 * Every screen route, mirrored from src/lib/routes.ts — Worker modules are
 * uploaded without the app bundle, so the list cannot be imported.
 * `npm run check:host` fails if the two lists drift apart.
 */
export const APP_ROUTES = ['/', '/live', '/codes', '/repair', '/vehicle', '/tools', '/connect'];

const NO_STORE = ['/', '/index.html', '/sw.js', '/manifest.webmanifest'];

/** Anything with a file extension, or in a build directory, is a file — not a page. */
const FILE_EXT =
  /\.(js|mjs|css|map|json|webmanifest|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|txt|xml|wasm|pdf|csv)$/i;

function isAssetPath(pathname) {
  return pathname.startsWith('/assets/') || pathname.startsWith('/icons/') || FILE_EXT.test(pathname);
}

/** "/codes/" and "/codes///" are the same route as "/codes". */
function canonicalPath(pathname) {
  if (!pathname || pathname === '/') return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

/** Serve the app shell. Must stay async: the asset response has to be awaited
 *  before its headers are rewritten, or the body is dropped. */
async function shell(env, url, request) {
  let response = await env.ASSETS.fetch(new Request(new URL('/', url), request));

  // If the edge answers "/" with a redirect, follow it once by path so the
  // client never receives a Location pointing back at itself.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) {
      const next = new URL(location, url);
      if (next.pathname !== url.pathname) {
        response = await env.ASSETS.fetch(new Request(next, request));
      }
    }
  }

  return withHeaders(response, '/index.html');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const page = (method === 'GET' || method === 'HEAD') && !isAssetPath(url.pathname);

    if (page) {
      const canonical = canonicalPath(url.pathname);
      if (canonical !== url.pathname) {
        const target = new URL(url);
        target.pathname = canonical;
        return new Response(null, {
          status: 308,
          headers: { location: target.toString(), 'cache-control': 'no-store' },
        });
      }
      return shell(env, url, request);
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status === 404 || response.status === 301 || response.status === 307) {
      if (isAssetPath(url.pathname)) {
        return new Response('Not found', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    }

    return withHeaders(response, url.pathname);
  },
};

function withHeaders(response, pathname) {
  if (!NO_STORE.includes(pathname) && !pathname.endsWith('.webmanifest')) return response;

  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-cache, must-revalidate');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
