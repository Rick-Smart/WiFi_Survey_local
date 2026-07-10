// ── Backend API client ───────────────────────────────────────────────────
// Thin wrapper over fetch. All calls hit the Python backend (proxied by Vite
// in dev, same-origin in the packaged app).

async function request(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

function post(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

// ── Scan ──────────────────────────────────────────────────────────────────
export function getModules() {
  return request("/api/modules");
}
export function runModule(id) {
  return request(`/api/scan/${id}`);
}
export function getServerInfo() {
  return request("/api/server/info");
}

// ── Walk ──────────────────────────────────────────────────────────────────
export function getWalkState() {
  return request("/api/walk/state");
}
export function getWalkReport() {
  return request("/api/walk/report");
}
export function getLiveSsids() {
  return request("/api/live/ssids");
}
export function startWalk(interval_sec) {
  return post("/api/walk/start", { interval_sec });
}
export function stopWalk() {
  return post("/api/walk/stop");
}
export function addCheckpoint(label) {
  return post("/api/walk/checkpoint", { label });
}
export function renameCheckpoint(id, label) {
  return post("/api/walk/rename", { id, label });
}
export function walkAutoStep(heading_deg, step_m, label) {
  return post("/api/walk/auto-step", { heading_deg, step_m, label });
}

// ── Localization ──────────────────────────────────────────────────────────
export function getLocalizeState() {
  return request("/api/localize/state");
}
export function getReferences() {
  return request("/api/localize/references");
}
export function startReference(name, interval_sec) {
  return post("/api/localize/reference/start", { name, interval_sec });
}
export function stopReference() {
  return post("/api/localize/reference/stop");
}
export function startReplay(reference_id, interval_sec) {
  return post("/api/localize/replay/start", { reference_id, interval_sec });
}
export function stopReplay() {
  return post("/api/localize/replay/stop");
}
export function deleteReference(reference_id) {
  return post("/api/localize/reference/delete", { reference_id });
}

// ── Mobile ────────────────────────────────────────────────────────────────
export function getMobileState() {
  return request("/api/mobile/state");
}

// ── Storage ───────────────────────────────────────────────────────────────
export function getStorageList() {
  return request("/api/storage/list");
}
export function saveBundle(name, reset_after_export = false) {
  return post("/api/storage/save-bundle", { name, reset_after_export });
}
export function loadBundle(filename, replace_references = false) {
  return post("/api/storage/load-bundle", { filename, replace_references });
}
export function saveWalk(name) {
  return post("/api/storage/save-walk", { name });
}
export function loadWalk(filename) {
  return post("/api/storage/load-walk", { filename });
}
export function resetSiteWalk() {
  return post("/api/storage/reset-site-walk");
}
