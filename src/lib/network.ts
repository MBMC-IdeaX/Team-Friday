// Bound both fetching and reading the response without newer AbortSignal helpers.
export async function fetchJson<T = unknown>(url: string | URL, init: RequestInit = {}, timeoutMs = 8_000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, data: await response.json() as T };
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}
