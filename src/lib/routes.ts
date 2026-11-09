/**
 * One table for every screen and the URL that represents it.
 *
 * The shell (sidebar, top bar, tab bar) stays mounted; only the panel below it
 * changes. Because each screen has a real path, a screen can be bookmarked,
 * shared, restored by back/forward, and opened directly from a deep link.
 *
 * The deploy worker keeps its own copy of the path list — Worker modules are
 * uploaded without the app bundle — and `npm run check:host` fails if the two
 * ever drift apart.
 */
import type { Screen } from '../state/store';

export interface Route {
  screen: Screen;
  path: string;
  title: string;
}

export const ROUTES: Route[] = [
  { screen: 'dashboard', path: '/', title: 'Dashboard' },
  { screen: 'live', path: '/live', title: 'Live data' },
  { screen: 'codes', path: '/codes', title: 'Trouble codes' },
  { screen: 'repair', path: '/repair', title: 'Repair guide' },
  { screen: 'vehicle', path: '/vehicle', title: 'Vehicle' },
  { screen: 'tools', path: '/tools', title: 'Tools' },
  { screen: 'connect', path: '/connect', title: 'Connection' },
];

/** Every path the server must answer with the app shell. */
export const APP_PATHS: string[] = ROUTES.map((r) => r.path);

/** A trailing slash is not part of a route: "/codes/" redirects to "/codes". */
export function canonicalPath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

export function pathForScreen(screen: Screen): string {
  return ROUTES.find((r) => r.screen === screen)?.path ?? '/';
}

/** Null for a path that has no screen — the caller decides where to send it. */
export function screenForPath(pathname: string): Screen | null {
  const path = canonicalPath(pathname);
  return ROUTES.find((r) => r.path === path)?.screen ?? null;
}

export function titleForScreen(screen: Screen): string {
  const name = ROUTES.find((r) => r.screen === screen)?.title ?? 'Scanner';
  return `${name} — TorqueMedic`;
}
