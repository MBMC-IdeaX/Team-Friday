// Offline Next.js transitions need server component requests. Use saved page HTML instead.
export function navigateTo(path: string, router: { push(path: string): void }) {
  if (navigator.onLine === false) window.location.assign(path);
  else router.push(path);
}

export function offlineLink(event: MouseEvent) {
  if (navigator.onLine !== false || event.defaultPrevented || event.button !== 0 ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self")) return;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search && url.hash)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.location.assign(url.href);
}
