const staticScreenPaths = new Set([
  "/",
  "/projects",
  "/tasks",
  "/tasks/new",
  "/runs",
  "/settings",
]);

const navigationBaseUrl = "https://clockhand.local";

type BrowserNavigation = Pick<Location, "assign" | "replace">;

export function toStaticScreenHref(href: string) {
  const url = new URL(href, navigationBaseUrl);
  const pathname =
    url.pathname.length > 1 && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;

  if (url.origin !== navigationBaseUrl || !staticScreenPaths.has(pathname)) {
    throw new Error(`Unknown Clockhand screen route: ${href}`);
  }

  const documentPath = pathname === "/" ? pathname : `${pathname}/`;
  return `${documentPath}${url.search}${url.hash}`;
}

export function navigateToScreen(
  href: string,
  navigation: BrowserNavigation = window.location,
) {
  navigation.assign(toStaticScreenHref(href));
}

export function replaceWithScreen(
  href: string,
  navigation: BrowserNavigation = window.location,
) {
  navigation.replace(toStaticScreenHref(href));
}
