// Only browser geolocation fixes enter this state; map centers never do.
export type DeviceLocation = { lat: number; lng: number; accuracy: number; at: number };
export const MAX_LOCATION_AGE_MS = 30_000;
export const MAX_LOCATION_ACCURACY_M = 150;
let latest: DeviceLocation | null = null;

export function deviceLocation(position: GeolocationPosition, now = Date.now()): DeviceLocation | null {
  const { latitude: lat, longitude: lng, accuracy } = position.coords;
  const at = position.timestamp;
  if (![lat, lng, accuracy, at].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
      accuracy < 0 || accuracy > MAX_LOCATION_ACCURACY_M || now - at > MAX_LOCATION_AGE_MS || at > now + 5_000) return null;
  return { lat, lng, accuracy, at };
}

export function currentDeviceLocation(now = Date.now()): DeviceLocation | null {
  return latest && now - latest.at <= MAX_LOCATION_AGE_MS ? latest : null;
}

export function watchDeviceLocation(onPosition: (position: DeviceLocation) => void,
  onUnavailable: (message: string) => void): () => void {
  if (!window.isSecureContext || !navigator.geolocation) {
    latest = null;
    onUnavailable("Location unavailable. Open the HTTPS app in a browser with location support.");
    return () => {};
  }
  let active = true;
  const accept = (position: GeolocationPosition) => {
    if (!active) return;
    const fix = deviceLocation(position);
    if (!fix) {
      latest = null;
      onUnavailable("Location unavailable: the device fix is too old or inaccurate. Move outdoors and retry.");
      return;
    }
    latest = fix;
    onPosition(fix);
  };
  const unavailable = (error: GeolocationPositionError) => {
    if (!active) return;
    latest = null;
    onUnavailable(error.code === 1 ? "Location permission denied. Enable location in your browser settings."
      : error.code === 3 ? "Location timed out. Move outdoors and retry."
      : "Location unavailable. Check that device location is enabled.");
  };
  const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 };
  let watch: number;
  try { watch = navigator.geolocation.watchPosition(accept, unavailable, options); }
  catch {
    latest = null;
    onUnavailable("Location unavailable. Check browser location settings and retry.");
    return () => {};
  }
  let refreshing = false;
  const refresh = () => {
    if (!active || refreshing || currentDeviceLocation() || !navigator.geolocation.getCurrentPosition) return;
    refreshing = true;
    try {
      navigator.geolocation.getCurrentPosition(position => { refreshing = false; accept(position); },
        error => { refreshing = false; unavailable(error); }, options);
    } catch {
      refreshing = false;
      latest = null;
      onUnavailable("Location unavailable. Check browser location settings and retry.");
    }
  };
  // Expire the displayed fix even if the browser stops invoking its watcher.
  const expire = setInterval(() => {
    if (latest && !currentDeviceLocation()) {
      latest = null;
      onUnavailable("Location unavailable: waiting for a fresh device fix.");
    }
    refresh();
  }, 5_000);
  return () => { active = false; clearInterval(expire); navigator.geolocation.clearWatch(watch); };
}

export function sosSeed(id: string) {
  const fix = currentDeviceLocation();
  return { id, triggered_by: "tap", lat: fix?.lat ?? null, lng: fix?.lng ?? null };
}

export function routingOrigin(manual: { lat: number; lng: number } | null, fix: DeviceLocation | null) {
  const point = manual ?? (fix && Date.now() - fix.at <= MAX_LOCATION_AGE_MS ? fix : null);
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return null;
  return point ? { lat: +point.lat.toFixed(4), lng: +point.lng.toFixed(4) } : null;
}
