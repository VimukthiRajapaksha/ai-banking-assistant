/** The path prefix the portal is served under, e.g. `/apex-consent-portal-web`
 * on the WSO2 Developer Platform, where a service shares its host with others
 * and is told apart by path. Empty when served from the root.
 *
 * Fixed at build time (next.config.ts `basePath`). Next.js adds it to links,
 * router navigation and its own assets; these are the places it does not:
 * plain fetch() and window.location calls, and <img> / icon URLs.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const withBase = (path: string) => `${BASE_PATH}${path}`;

/** A path as the app sees it: the browser's pathname without the prefix. */
export const withoutBase = (pathname: string) =>
  BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) || '/' : pathname;
