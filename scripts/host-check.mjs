/**
 * Checks the deploy worker against a stubbed ASSETS binding.
 *
 * The stub deliberately copies two behaviours of the real asset layer that
 * broke production once:
 *   - "/index.html" answers 307 → "/" (canonicalisation), so fetching it as the
 *     shell would redirect the visitor back to themselves.
 *   - unknown paths are 404, not the shell.
 * A routing bug here serves a blank page while every status code still looks
 * fine, which the HTTP smoke test alone cannot detect. Run: npm run check:host
 */
import { readFileSync } from 'node:fs';
import worker, { APP_ROUTES } from '../deploy-worker.js';

const SHELL_HTML =
  '<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';

const assets = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/') return new Response(SHELL_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (pathname === '/index.html') return new Response(null, { status: 307, headers: { location: '/' } });
    if (pathname === '/sw.js') return new Response('// sw', { headers: { 'content-type': 'text/javascript' } });
    if (pathname === '/manifest.webmanifest') {
      return new Response('{"name":"x"}', { headers: { 'content-type': 'application/manifest+json' } });
    }
    if (pathname === '/assets/app.js') return new Response('console.log(1)', { headers: { 'content-type': 'text/javascript' } });
    if (pathname === '/assets/app.css') return new Response('body{}', { headers: { 'content-type': 'text/css' } });
    if (pathname === '/icons/icon-192.png') return new Response('png', { headers: { 'content-type': 'image/png' } });
    return new Response('not found', { status: 404 });
  },
};

let failures = 0;

async function check(name, request, expect) {
  const res = await worker.fetch(request, { ASSETS: assets });
  const body = await res.text();
  const problems = [];
  if (res.status !== expect.status) problems.push(`status ${res.status} != ${expect.status}`);
  if (expect.body && !body.includes(expect.body)) problems.push(`body missing "${expect.body}" (${body.length} bytes)`);
  if (expect.type && !(res.headers.get('content-type') || '').startsWith(expect.type)) {
    problems.push(`content-type ${res.headers.get('content-type')} != ${expect.type}`);
  }
  if (expect.cacheControl && res.headers.get('cache-control') !== expect.cacheControl) {
    problems.push(`cache-control ${res.headers.get('cache-control')} != ${expect.cacheControl}`);
  }
  if (expect.noLocation && res.headers.get('location')) problems.push(`unexpected redirect to ${res.headers.get('location')}`);
  if (expect.location && res.headers.get('location') !== expect.location) {
    problems.push(`location ${res.headers.get('location')} != ${expect.location}`);
  }
  if (problems.length) {
    failures += 1;
    console.log(`  FAIL  ${name} — ${problems.join('; ')}`);
  } else {
    console.log(`  PASS  ${name}`);
  }
}

const get = (path, accept = 'text/html') => new Request(`https://example.test${path}`, { headers: { accept } });

await check('root serves the shell with a full body, no redirect', get('/'), {
  status: 200,
  body: 'id="root"',
  type: 'text/html',
  cacheControl: 'no-cache, must-revalidate',
  noLocation: true,
});

// Every screen is a real URL, and all of them get the same shell.
for (const path of APP_ROUTES) {
  await check(`route ${path} serves the shell`, get(path), {
    status: 200,
    body: 'id="root"',
    type: 'text/html',
    noLocation: true,
  });
}

await check('trailing slash redirects to the canonical route', get('/codes/'), {
  status: 308,
  location: 'https://example.test/codes',
});
await check('repeated trailing slashes collapse', get('/tools///'), {
  status: 308,
  location: 'https://example.test/tools',
});
await check('redirect keeps the query string', get('/codes/?code=P0420'), {
  status: 308,
  location: 'https://example.test/codes?code=P0420',
});
await check('/index.html serves the shell instead of redirecting', get('/index.html'), {
  status: 200,
  body: 'id="root"',
  noLocation: true,
});
await check('unknown page path falls back to the shell, not a 404', get('/no-such-screen'), {
  status: 200,
  body: 'id="root"',
  type: 'text/html',
});
await check('manifest is treated as a file, not a page', get('/manifest.webmanifest', '*/*'), {
  status: 200,
  type: 'application/manifest+json',
  cacheControl: 'no-cache, must-revalidate',
  noLocation: true,
});
await check('missing script is a real 404', get('/assets/gone.js', '*/*'), { status: 404, type: 'text/plain' });
await check('missing image is a real 404', get('/icons/gone.png', 'image/*'), { status: 404 });
await check('real script passes through untouched', get('/assets/app.js', '*/*'), { status: 200, type: 'text/javascript' });
await check('stylesheet passes through untouched', get('/assets/app.css', '*/*'), { status: 200, type: 'text/css' });
await check('icon passes through untouched', get('/icons/icon-192.png', 'image/*'), { status: 200, type: 'image/png' });
await check('service worker is never cached', get('/sw.js', '*/*'), {
  status: 200,
  cacheControl: 'no-cache, must-revalidate',
});

// The worker cannot import the app's route table, so guard the copy by hand.
const appRoutes = [
  ...readFileSync(new URL('../src/lib/routes.ts', import.meta.url), 'utf8').matchAll(/path:\s*'([^']+)'/g),
].map((m) => m[1]);

const missing = appRoutes.filter((p) => !APP_ROUTES.includes(p));
const extra = APP_ROUTES.filter((p) => !appRoutes.includes(p));
if (missing.length || extra.length) {
  failures += 1;
  console.log(
    `  FAIL  route map matches the app — missing [${missing.join(', ')}] extra [${extra.join(', ')}]`,
  );
} else {
  console.log(`  PASS  route map matches the app (${appRoutes.length} routes)`);
}

console.log(failures === 0 ? '\nALL HOST CHECKS PASSED' : `\n${failures} HOST CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
