// ── Backend API client ───────────────────────────────────────────────────
// Thin wrapper over fetch. All calls hit the Python backend (proxied by Vite
// in dev, same-origin in the packaged app).

async function request(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

export function getModules() {
  return request("/api/modules");
}

// Runs a single module and returns its result object.
export function runModule(id) {
  return request(`/api/scan/${id}`);
}

// Server info (mobile helper URLs, etc.)
export function getServerInfo() {
  return request("/api/server/info");
}
