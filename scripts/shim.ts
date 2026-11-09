// Minimal browser globals so the adapter stack can run under Node for testing.
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.self = globalThis;
// Node has no URL bar; the store reads location to pick a starting screen.
g.location = { pathname: '/', search: '', hash: '', origin: 'http://localhost' };
if (typeof g.performance === 'undefined') {
  g.performance = { now: () => Date.now() };
}
