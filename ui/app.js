"use strict";
// ── State ────────────────────────────────────────────────────
const state = {
  modules: [], // [{id,name,description,category,default_enabled,tags}]
  enabled: new Set(), // ids of enabled modules
  results: {}, // id → result object
  running: false,
  aborted: false,
  startTime: null,
  durations: {}, // id → ms
  walk: {
    active: false,
    started_at: null,
    sample_count: 0,
    checkpoints: [],
    latest_sample: null,
  },
  walkReport: null,
  liveScan: null,
  liveTimer: null,
  localization: {
    reference: { active: false, point_count: 0 },
    replay: { active: false, latest_estimate: null },
    reference_count: 0,
    last_error: null,
  },
  localizationReferences: [],
  storageArtifacts: {
    walks: [],
    references: [],
    bundles: [],
  },
  mobileAssist: {
    connected: false,
    age_ms: 0,
    running: false,
    sensor_enabled: false,
    auto_start: false,
    heading_deg: null,
    heading_jitter_deg: null,
    detected_steps: 0,
    sent_steps: 0,
    last_seen_at: null,
    last_sensor_at: null,
  },
  mobileUrl: "",
  activeTab: "scan",
  checkpointDrafts: {},
  floorplanImage: null,
  floorplanName: "",
  floorplanCalibration: {
    active: false,
    awaiting: 0,
    pointA: null,
    pointB: null,
    knownDistanceM: 10,
    metersPerPixel: null,
  },
};

// ── DOM refs ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Fetch helpers ────────────────────────────────────────────
async function api(path, body) {
  const opts = body
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    : { method: "GET" };
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  setStatus("Loading modules…", "running");
  try {
    await initMobileUrl();
    state.modules = await api("/api/modules");
    state.enabled = new Set(
      state.modules.filter((m) => m.default_enabled).map((m) => m.id),
    );
    renderSidebar();
    await refreshWalkState();
    await refreshWalkReport();
    await refreshLiveScan();
    await refreshLocalizationReferences();
    await refreshLocalizationState();
    await refreshMobileState();
    await refreshStorageArtifacts();
    startLiveRefresh();
    setActiveTab("scan");
    drawWalkMap();
    setStatus("Ready", "");
  } catch (e) {
    setStatus("Error loading modules", "error");
    console.error(e);
  }
}

async function initMobileUrl() {
  const current = new URL(window.location.href);
  const fallback = new URL("/mobile", current.origin).toString();
  try {
    const info = await api("/api/server/info");
    const firstLan = (info.mobile_urls || [])[0];
    state.mobileUrl = firstLan || fallback;
  } catch (_) {
    state.mobileUrl = fallback;
  }
  $("mobile-url").value = state.mobileUrl;
  renderMobileQr();
}

function renderMobileQr() {
  const img = $("mobile-qr");
  const caption = $("mobile-qr-caption");
  const url = (state.mobileUrl || $("mobile-url").value || "").trim();
  if (!img || !caption) return;
  if (!url) {
    img.removeAttribute("src");
    caption.textContent = "Mobile URL unavailable";
    return;
  }

  const encoded = encodeURIComponent(url);
  img.src = `https://quickchart.io/qr?size=220&margin=1&text=${encoded}`;
  img.onerror = () => {
    caption.textContent = "QR failed to load (offline). Use Copy/Open.";
  };
  caption.textContent = "Scan to open /mobile on phone";
}

function agoText(ms) {
  const sec = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (sec < 2) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return `${min}m ago`;
}

function renderMobileAssistStatus() {
  const st = state.mobileAssist || {};
  const statusEl = $("mobile-status");
  const detailEl = $("mobile-status-detail");
  if (!statusEl || !detailEl) return;

  if (!st.connected) {
    statusEl.innerHTML = 'Phone: <span class="off">not connected</span>';
    detailEl.textContent =
      "Pairing status: waiting for mobile heartbeat. Open the mobile URL and tap Enable Sensors.";
    return;
  }

  const heading = Number.isFinite(Number(st.heading_deg))
    ? `${Number(st.heading_deg).toFixed(0)} deg`
    : "n/a";
  const jitter = Number.isFinite(Number(st.heading_jitter_deg))
    ? `${Number(st.heading_jitter_deg).toFixed(1)} deg`
    : "n/a";
  const age = agoText(st.age_ms);
  const runningText = st.running ? "streaming" : "paired idle";
  const sensorText = st.sensor_enabled ? "sensors on" : "sensors off";
  const autoText = st.auto_start ? "auto-start on" : "auto-start off";
  const driftTone =
    Number(st.heading_jitter_deg || 0) >= 22
      ? "high"
      : Number(st.heading_jitter_deg || 0) >= 12
        ? "moderate"
        : "low";
  const sensorTs = st.last_sensor_at ? st.last_sensor_at : "n/a";

  statusEl.innerHTML = `Phone: <span class="on">${runningText}</span> · ${sensorText} · ${autoText}`;
  detailEl.textContent = `Heartbeat ${age} · heading ${heading} · jitter ${jitter} (${driftTone}) · steps sent ${Number(st.sent_steps || 0)} / detected ${Number(st.detected_steps || 0)} · last sensor ${sensorTs}`;
}

async function refreshMobileState() {
  try {
    const data = await api("/api/mobile/state");
    state.mobileAssist = data || state.mobileAssist;
    renderMobileAssistStatus();
  } catch (e) {
    console.error(e);
  }
}

function setActiveTab(tab) {
  state.activeTab = tab;
  $("tab-scan").classList.toggle("active", tab === "scan");
  $("tab-walk").classList.toggle("active", tab === "walk");
  $("tab-btn-scan").classList.toggle("active", tab === "scan");
  $("tab-btn-walk").classList.toggle("active", tab === "walk");
  if (tab === "walk") {
    drawWalkMap();
  }
}

function setCalibrationStatus(text, tone = "neutral") {
  const el = $("floorplan-cal-status");
  if (!el) return;
  const colors = {
    neutral: "var(--text2)",
    good: "var(--green)",
    warn: "var(--yellow)",
    bad: "var(--red)",
  };
  el.style.color = colors[tone] || colors.neutral;
  el.textContent = text;
}

function hasFiniteXY(point) {
  if (!point) return false;
  return (
    Number.isFinite(Number(point.x_m)) && Number.isFinite(Number(point.y_m))
  );
}

function cardinalFromHeading(headingDeg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const norm = ((Number(headingDeg) % 360) + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  return dirs[idx];
}

function computeReplayGuidance(currentPos, nextCheckpoint) {
  if (!hasFiniteXY(currentPos) || !hasFiniteXY(nextCheckpoint)) {
    return null;
  }

  const curX = Number(currentPos.x_m);
  const curY = Number(currentPos.y_m);
  const nextX = Number(nextCheckpoint.x_m);
  const nextY = Number(nextCheckpoint.y_m);

  const dx = nextX - curX;
  const dy = nextY - curY;
  const distanceM = Math.hypot(dx, dy);

  // 0 deg is North, clockwise positive (same convention as walk manager).
  const headingDeg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const cardinal = cardinalFromHeading(headingDeg);

  return {
    distanceM: Number(distanceM.toFixed(2)),
    headingDeg: Number(headingDeg.toFixed(0)),
    cardinal,
  };
}

function canvasPointFromEvent(evt) {
  const canvas = $("walk-map-canvas");
  const rect = canvas.getBoundingClientRect();
  const x = evt.clientX - rect.left;
  const y = evt.clientY - rect.top;
  return {
    x: Math.max(0, Math.min(rect.width, x)),
    y: Math.max(0, Math.min(rect.height, y)),
  };
}

function handleMapCanvasClick(evt) {
  const cal = state.floorplanCalibration;
  if (!cal.active) return;

  if (!state.floorplanImage) {
    setCalibrationStatus(
      "Load a floorplan image first, then calibrate.",
      "bad",
    );
    cal.active = false;
    cal.awaiting = 0;
    return;
  }

  const p = canvasPointFromEvent(evt);
  if (cal.awaiting === 1) {
    cal.pointA = p;
    cal.awaiting = 2;
    setCalibrationStatus(
      "Calibration step 2/2: click second known-distance point.",
      "warn",
    );
    drawWalkMap();
    return;
  }

  if (cal.awaiting === 2) {
    cal.pointB = p;
    const known = Number(
      $("floorplan-known-distance").value || cal.knownDistanceM || 10,
    );
    cal.knownDistanceM = Math.max(0.5, known);
    const dx = cal.pointB.x - cal.pointA.x;
    const dy = cal.pointB.y - cal.pointA.y;
    const pxDist = Math.hypot(dx, dy);

    if (pxDist < 5) {
      setCalibrationStatus(
        "Calibration failed: points are too close. Try again with farther points.",
        "bad",
      );
      cal.active = false;
      cal.awaiting = 0;
      cal.pointB = null;
      drawWalkMap();
      return;
    }

    cal.metersPerPixel = cal.knownDistanceM / pxDist;
    cal.active = false;
    cal.awaiting = 0;
    setCalibrationStatus(
      `Calibration set: ${cal.knownDistanceM.toFixed(1)} m over ${pxDist.toFixed(1)} px (${cal.metersPerPixel.toFixed(4)} m/px).`,
      "good",
    );
    drawWalkMap();
  }
}

// ── Sidebar ──────────────────────────────────────────────────
const CATEGORY_ORDER = ["connection", "rf", "security", "network", "advanced"];
const CATEGORY_LABELS = {
  connection: "Connection",
  rf: "RF & Radio",
  security: "Security",
  network: "Network",
  advanced: "Advanced",
};

function renderSidebar() {
  const list = $("module-list");
  list.innerHTML = "";

  const byCategory = {};
  for (const m of state.modules) {
    (byCategory[m.category] = byCategory[m.category] || []).push(m);
  }

  for (const cat of CATEGORY_ORDER) {
    const mods = byCategory[cat];
    if (!mods || !mods.length) continue;

    const hdr = document.createElement("div");
    hdr.className = "sidebar-section";
    hdr.style.marginTop = "6px";
    hdr.textContent = CATEGORY_LABELS[cat] || cat;
    list.appendChild(hdr);

    for (const m of mods) {
      const item = document.createElement("div");
      item.className = "module-item";
      item.dataset.id = m.id;

      const tagHtml = (m.tags || [])
        .map((t) => `<span class="tag ${t}">${t}</span>`)
        .join("");

      item.innerHTML = `
        <label class="toggle" onclick="event.stopPropagation()">
          <input type="checkbox" ${state.enabled.has(m.id) ? "checked" : ""} data-id="${m.id}">
          <span class="slider"></span>
        </label>
        <div class="m-info">
          <div class="m-name">${m.name}${tagHtml}</div>
          <div class="m-desc">${m.description}</div>
        </div>
        <div class="m-status" id="ms-${m.id}"></div>
      `;

      item.querySelector("input").addEventListener("change", (e) => {
        const id = e.target.dataset.id;
        e.target.checked ? state.enabled.add(id) : state.enabled.delete(id);
        updateRunButtons();
      });

      // Click on the item (not the toggle) scrolls to its result card
      item.addEventListener("click", () => scrollToCard(m.id));

      list.appendChild(item);
    }
  }
  updateRunButtons();
}

function scrollToCard(id) {
  const card = document.getElementById("card-" + id);
  if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Run logic ────────────────────────────────────────────────
function updateRunButtons() {
  $("btn-run-all").disabled = state.running;
  $("btn-run-selected").disabled = state.enabled.size === 0 || state.running;
  $("btn-stop").style.display = state.running ? "" : "none";
  $("btn-run-all").style.display = state.running ? "none" : "";
}

function updateWalkControls() {
  const on = !!state.walk.active;
  $("btn-walk-start").disabled = on;
  $("btn-walk-stop").disabled = !on;
  $("btn-walk-checkpoint").disabled = !on;
  $$("[data-dir]").forEach((btn) => {
    btn.disabled = !on;
  });

  const pos = state.walk.position || { x_m: 0, y_m: 0 };
  $("walk-pos").textContent =
    `Pos: x ${Number(pos.x_m || 0).toFixed(1)}m, y ${Number(pos.y_m || 0).toFixed(1)}m`;

  $("walk-status").innerHTML = on
    ? `Walk: <span class="on">recording</span> · samples ${state.walk.sample_count || 0}`
    : 'Walk: <span class="off">idle</span>';
}

function isEditingCheckpoint() {
  const active = document.activeElement;
  return !!(active && active.matches && active.matches("[data-cpedit]"));
}

function renderCheckpointList() {
  const el = $("checkpoint-list");
  const cps = state.walk.checkpoints || [];
  if (!cps.length) {
    el.innerHTML =
      '<div class="checkpoint-item" style="color:var(--text2)">No checkpoints yet</div>';
    return;
  }
  el.innerHTML = cps
    .map((cp) => {
      const liveLabel = cp.label || `Checkpoint ${cp.id}`;
      const draftLabel =
        state.checkpointDrafts[cp.id] != null
          ? state.checkpointDrafts[cp.id]
          : liveLabel;
      const label = escHtml(draftLabel);
      const sig =
        cp.signal_dbm != null ? `${cp.signal_dbm} dBm` : cp.signal_pct || "n/a";
      return `
      <div class="checkpoint-item" data-cpid="${cp.id}">
        <span style="color:var(--text2)">#${cp.id}</span>
        <input type="text" value="${label}" data-cpedit="${cp.id}">
        <button class="btn btn-ghost" style="padding:3px 7px;font-size:11px" data-cpsave="${cp.id}">Save</button>
        <span style="color:var(--yellow)">${sig}</span>
      </div>`;
    })
    .join("");

  $$("[data-cpedit]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const id = Number(e.target.dataset.cpedit);
      state.checkpointDrafts[id] = e.target.value;
    });
    inp.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const id = Number(e.target.dataset.cpedit);
      const label = (state.checkpointDrafts[id] ?? e.target.value).trim();
      try {
        await api("/api/walk/rename", { id, label });
        delete state.checkpointDrafts[id];
        await refreshWalkState();
        setStatus("Location label saved", "done");
      } catch (err) {
        console.error(err);
        setStatus("Failed to save label", "error");
      }
    });
  });

  $$("[data-cpsave]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = Number(e.target.dataset.cpsave);
      const input = document.querySelector(`[data-cpedit="${id}"]`);
      const label = (
        state.checkpointDrafts[id] ?? (input ? input.value : "")
      ).trim();
      try {
        await api("/api/walk/rename", { id, label });
        delete state.checkpointDrafts[id];
        await refreshWalkState();
        setStatus("Location label saved", "done");
      } catch (err) {
        console.error(err);
        setStatus("Failed to save label", "error");
      }
    });
  });
}

async function refreshWalkState() {
  try {
    const s = await api("/api/walk/state");
    state.walk = s || state.walk;
    updateWalkControls();
    if (!isEditingCheckpoint()) {
      renderCheckpointList();
    }
    if ((state.walk.sample_count || 0) > 0) {
      $("btn-export-pdf").disabled = false;
    }
  } catch (e) {
    console.error(e);
  }
}

async function refreshWalkReport() {
  try {
    state.walkReport = await api("/api/walk/report");
    renderWalkReportCard();
    if ((state.walkReport?.session?.sample_count || 0) > 0) {
      $("btn-export-pdf").disabled = false;
    }
  } catch (e) {
    console.error(e);
  }
}

function applyResetPayload(result) {
  state.walk = result?.walk_state || {
    active: false,
    started_at: null,
    sample_count: 0,
    checkpoints: [],
    latest_sample: null,
  };
  state.walkReport = result?.walk_report || {
    session: { active: false, sample_count: 0 },
    samples: [],
    location_summary: [],
    active_scan: [],
  };
  state.localization = result?.localize_state || {
    reference: { active: false, point_count: 0 },
    replay: { active: false, latest_estimate: null },
    reference_count: 0,
    last_error: null,
  };
  state.localizationReferences = result?.references || [];
  state.checkpointDrafts = {};

  updateWalkControls();
  renderCheckpointList();
  renderWalkReportCard();
  renderLocalizationReferences();
  renderLocalizationStatus();
  drawWalkMap();
}

async function refreshLiveScan() {
  try {
    state.liveScan = await api("/api/live/ssids");
    renderLiveScanCard();
  } catch (e) {
    console.error(e);
  }
}

function renderLocalizationStatus() {
  const ref = state.localization.reference || {};
  const replay = state.localization.replay || {};
  const hasReference = !!state.localizationReferences.length;

  const refActive = !!ref.active;
  const replayActive = !!replay.active;

  $("btn-loc-ref-start").disabled = refActive || replayActive;
  $("btn-loc-ref-stop").disabled = !refActive;
  $("btn-loc-replay-start").disabled =
    replayActive || refActive || !state.localizationReferences.length;
  $("btn-loc-replay-stop").disabled = !replayActive;
  $("btn-loc-ref-delete").disabled =
    refActive || replayActive || !$("loc-reference-select").value;

  const est = replay.latest_estimate;
  const guide = $("loc-confidence-guide");

  updateWalkWorkflowState({
    hasReference,
    refActive,
    replayActive,
    confidence: est ? Number(est.confidence || 0) : null,
  });

  if (refActive) {
    $("loc-status").innerHTML =
      `Localization: <span class="on">recording reference</span> \u00b7 points ${ref.point_count || 0}`;
  } else if (replayActive) {
    const matchedLabel = est?.matched_checkpoint?.label || "?";
    const nextLabel = est?.next_checkpoint?.label || "(end)";
    $("loc-status").innerHTML =
      `Localization: <span class="on">replay estimating</span> \u00b7 samples ${replay.sample_count || 0} \u00b7 matched ${escHtml(matchedLabel)} \u2192 ${escHtml(nextLabel)}`;
  } else {
    $("loc-status").innerHTML = 'Localization: <span class="off">idle</span>';
  }

  if (est) {
    const conf = Number(est.confidence || 0);
    const tone = conf >= 70 ? "good" : conf >= 45 ? "warn" : "bad";
    const pos = est.position || {};
    const posText =
      Number.isFinite(Number(pos.x_m)) && Number.isFinite(Number(pos.y_m))
        ? `x ${Number(pos.x_m).toFixed(1)}m, y ${Number(pos.y_m).toFixed(1)}m`
        : "no XY anchor";

    let riskText = "stable";
    if (conf < 45) riskText = "high drift risk";
    else if (conf < 70) riskText = "moderate drift risk";

    const guidance = computeReplayGuidance(est.position, est.next_checkpoint);
    const guidanceText = guidance
      ? ` \u00b7 move ${guidance.distanceM.toFixed(1)}m ${guidance.cardinal} (${guidance.headingDeg}\u00b0)`
      : est.next_checkpoint
        ? " \u00b7 next target has no XY"
        : " \u00b7 end of reference path";

    $("loc-estimate").className = `walk-help loc-note ${tone}`;
    $("loc-estimate").textContent =
      `Match #${est.matched_seq || "?"} / ${est.reference_point_count || "?"} ` +
      `(${Math.round((est.progress || 0) * 100)}%) \u00b7 confidence ${est.confidence || 0}% \u00b7 ${riskText} \u00b7 ${posText}${guidanceText}`;

    if (guide) {
      guide.className = `walk-help loc-note ${tone}`;
      const moveHint = guidance
        ? ` Move ${guidance.distanceM.toFixed(1)}m toward ${guidance.cardinal} (${guidance.headingDeg}\u00b0).`
        : "";
      if (conf >= 70) {
        guide.textContent = `Confidence guidance: stable.${moveHint} Continue normal walking pace.`;
      } else if (conf >= 45) {
        guide.textContent = `Confidence guidance: moderate drift risk.${moveHint} Reduce speed and keep heading steady for several samples.`;
      } else {
        guide.textContent = `Confidence guidance: high drift risk.${moveHint} Pause for 3-5 seconds, then resume slowly or return to a known segment.`;
      }
    }
  } else {
    $("loc-estimate").className = "walk-help loc-note";
    $("loc-estimate").textContent = state.localization.last_error
      ? `Last localization error: ${state.localization.last_error}`
      : "No replay estimate yet.";

    if (guide) {
      guide.className = "walk-help loc-note";
      guide.textContent =
        "Confidence guidance: when confidence is low, pause briefly, keep facing a consistent direction, and slow movement until confidence recovers.";
    }
  }
}

function updateWalkWorkflowState({
  hasReference,
  refActive,
  replayActive,
  confidence,
}) {
  const stepEl = $("walk-workflow-step");
  const nextEl = $("walk-workflow-next");
  const setupEl = $("wf-setup");
  const referenceEl = $("wf-reference");
  const replayEl = $("wf-replay");
  const reviewEl = $("wf-review");
  const referencePanel = $("walk-reference-panel");
  const replayPanel = $("walk-replay-panel");

  if (stepEl) {
    if (refActive) stepEl.textContent = "Step 2 of 4: Recording Reference Walk";
    else if (replayActive)
      stepEl.textContent = "Step 3 of 4: Replay / Estimate";
    else if (hasReference) stepEl.textContent = "Step 3 of 4: Ready for Replay";
    else stepEl.textContent = "Step 1 of 4: Build Reference Walk";
  }

  if (nextEl) {
    if (refActive)
      nextEl.textContent =
        "Next action: keep walking the reference route until the fingerprint set is complete.";
    else if (replayActive)
      nextEl.textContent =
        confidence !== null && confidence >= 70
          ? "Next action: review the estimate and export the survey when ready."
          : "Next action: slow down or pause to improve replay confidence.";
    else if (hasReference)
      nextEl.textContent =
        "Next action: start replay mode to estimate position from the reference set.";
    else
      nextEl.textContent =
        "Next action: record a reference walk so replay mode has something to match against.";
  }

  if (setupEl)
    setupEl.classList.toggle(
      "is-current",
      !hasReference && !refActive && !replayActive,
    );
  if (referenceEl)
    referenceEl.classList.toggle("is-current", refActive || !hasReference);
  if (replayEl) {
    replayEl.classList.toggle("is-current", replayActive);
    replayEl.classList.toggle("is-muted", !hasReference && !replayActive);
  }
  if (reviewEl)
    reviewEl.classList.toggle(
      "is-current",
      hasReference && !refActive && !replayActive,
    );
  if (referencePanel)
    referencePanel.classList.toggle(
      "panel-emphasis",
      refActive || !hasReference,
    );
  if (replayPanel) {
    replayPanel.classList.toggle("panel-muted", !hasReference && !replayActive);
    replayPanel.classList.toggle("panel-emphasis", replayActive);
  }

  const replayStart = $("btn-loc-replay-start");
  const replayStop = $("btn-loc-replay-stop");
  const refStart = $("btn-loc-ref-start");
  const refStop = $("btn-loc-ref-stop");

  if (replayStart)
    replayStart.classList.toggle("btn-primary", hasReference && !replayActive);
  if (refStart)
    refStart.classList.toggle(
      "btn-primary",
      !refActive && !replayActive && !hasReference,
    );
  if (replayStop) replayStop.classList.toggle("btn-secondary", true);
  if (refStop) refStop.classList.toggle("btn-secondary", true);
}

function renderLocalizationReferences() {
  const select = $("loc-reference-select");
  const refs = state.localizationReferences || [];
  const selected = select.value;

  if (!refs.length) {
    select.innerHTML = '<option value="">No reference sets yet</option>';
    return;
  }

  select.innerHTML = refs
    .map((r) => {
      const avg = Number(r.avg_ap_count || 0).toFixed(1);
      const pfx = r.has_positions ? "XY" : "FP";
      return `<option value="${r.id}">#${r.id} ${escHtml(r.name)} \u00b7 ${r.point_count} pts \u00b7 ${avg} APs \u00b7 ${pfx}</option>`;
    })
    .join("");

  if (selected && refs.some((r) => String(r.id) === selected)) {
    select.value = selected;
  }
}

async function refreshLocalizationReferences() {
  try {
    const data = await api("/api/localize/references");
    state.localizationReferences = data.references || [];
    renderLocalizationReferences();
    renderLocalizationStatus();
  } catch (e) {
    console.error(e);
  }
}

async function refreshLocalizationState() {
  try {
    state.localization = await api("/api/localize/state");
    renderLocalizationStatus();
    if (state.activeTab === "walk") {
      drawWalkMap();
    }
  } catch (e) {
    console.error(e);
  }
}

function renderStorageSelect(selectId, items, emptyText) {
  const select = $(selectId);
  const selected = select.value;
  if (!items || !items.length) {
    select.innerHTML = `<option value="">${emptyText}</option>`;
    return;
  }

  select.innerHTML = items
    .map((item) => {
      const kb = Math.max(1, Math.round((item.size_bytes || 0) / 1024));
      return `<option value="${escHtml(item.filename)}">${escHtml(item.filename)} · ${kb} KB · ${escHtml(item.modified_at || "")}</option>`;
    })
    .join("");

  if (selected && items.some((item) => item.filename === selected)) {
    select.value = selected;
  }
}

function renderStorageArtifacts() {
  renderStorageSelect(
    "saved-walks-select",
    state.storageArtifacts.walks,
    "No saved walks",
  );
  renderStorageSelect(
    "saved-refs-select",
    state.storageArtifacts.references,
    "No saved reference sets",
  );
  renderStorageSelect(
    "saved-bundles-select",
    state.storageArtifacts.bundles,
    "No saved bundles",
  );
}

async function refreshStorageArtifacts() {
  try {
    state.storageArtifacts = await api("/api/storage/list");
    renderStorageArtifacts();
  } catch (e) {
    console.error(e);
  }
}

function startLiveRefresh() {
  if (state.liveTimer) clearInterval(state.liveTimer);
  state.liveTimer = setInterval(async () => {
    await refreshWalkState();
    await refreshLiveScan();
    await refreshLocalizationState();
    await refreshMobileState();
    if (state.walk.active) {
      await refreshWalkReport();
    } else if ((state.walk.sample_count || 0) > 0 && !state.walkReport) {
      await refreshWalkReport();
    }
  }, 4000);
}

async function runModules(ids) {
  if (state.running) return;
  state.running = true;
  state.aborted = false;
  state.startTime = Date.now();
  updateRunButtons();

  // Clear welcome screen, prep result area
  const results = $("results");
  $("welcome")?.remove();
  setProgress(0);
  setStatus(
    `Running ${ids.length} scan${ids.length > 1 ? "s" : ""}…`,
    "running",
  );
  $("toolbar-title").textContent = `Running — 0 / ${ids.length}`;

  // Create placeholder cards in order
  for (const id of ids) {
    const m = state.modules.find((m) => m.id === id);
    if (!m) continue;
    upsertCard(id, m.name, null);
    setModuleStatus(id, "running");
  }

  let done = 0;
  const errors = [];

  for (const id of ids) {
    if (state.aborted) break;

    const t0 = Date.now();
    try {
      const r = await api(`/api/scan/${id}`);
      state.results[id] = r;
      state.durations[id] = Date.now() - t0;
      const m = state.modules.find((m) => m.id === id);
      upsertCard(id, m?.name || id, r);
      setModuleStatus(id, r.status);
      if (r.status === "error") errors.push(id);
    } catch (e) {
      state.durations[id] = Date.now() - t0;
      const errResult = { id, status: "error", error: String(e), data: {} };
      state.results[id] = errResult;
      upsertCard(id, id, errResult);
      setModuleStatus(id, "error");
      errors.push(id);
    }

    done++;
    setProgress((done / ids.length) * 100);
    $("toolbar-title").textContent = `Running — ${done} / ${ids.length}`;
  }

  state.running = false;
  updateRunButtons();
  computeAndShowScore();
  $("btn-export").disabled = false;
  $("btn-export-pdf").disabled = false;

  if (state.aborted) {
    setStatus("Stopped", "error");
    $("toolbar-title").textContent = `Stopped at ${done} / ${ids.length}`;
  } else if (errors.length) {
    setStatus(`Done — ${errors.length} error(s)`, "error");
    $("toolbar-title").textContent =
      `Completed — ${errors.length} module(s) had errors`;
  } else {
    setStatus("All scans complete", "done");
    const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1);
    $("toolbar-title").textContent =
      `Completed ${ids.length} scans in ${elapsed}s`;
  }
}

function renderWalkReportCard() {
  if (!state.walkReport) {
    $("walk-report-content").innerHTML =
      '<div class="empty-msg">Start and stop a walk to generate a report.</div>';
    drawWalkMap();
    return;
  }
  const report = state.walkReport;
  const session = report.session || {};
  const sig = report.signal_dbm || {};
  const cov = report.coverage || {};
  const locs = report.location_summary || [];
  const samples = report.samples || [];
  const d = {
    _report: true,
    session,
    signal_dbm: sig,
    coverage: cov,
    location_summary: locs,
    samples,
  };
  $("walk-report-content").innerHTML = renderWalkReport(d);
  drawWalkMap();
}

function renderLiveScanCard() {
  if (!state.liveScan) {
    $("walk-live-content").innerHTML =
      '<div class="empty-msg">Waiting for scan data…</div>';
    return;
  }
  const d = {
    _live: true,
    timestamp: state.liveScan.timestamp,
    total_aps: state.liveScan.total_aps,
    channels: state.liveScan.channels,
    aps: state.liveScan.aps || [],
    error: state.liveScan.error,
  };
  $("walk-live-content").innerHTML = renderLiveSsidScan(d);
}

// ── Status helpers ───────────────────────────────────────────
function setStatus(text, level) {
  $("status-text").textContent = text;
  const dot = $("status-dot");
  dot.className = "dot" + (level ? " " + level : "");
}

function setProgress(pct) {
  $("progress-fill").style.width = pct + "%";
}

function setModuleStatus(id, status) {
  const el = $("ms-" + id);
  if (el) el.className = "m-status " + (status || "");
  const item = document.querySelector(`.module-item[data-id="${id}"]`);
  if (item) {
    item.classList.toggle("active", status === "running");
  }
}

// ── Score computation ─────────────────────────────────────────
function computeAndShowScore() {
  const parts = {};

  // Signal (40 pts)
  const iface = state.results["interface"];
  if (iface?.data?.signal_dbm != null) {
    const dbm = iface.data.signal_dbm;
    parts.Signal =
      dbm >= -50 ? 40 : dbm >= -60 ? 32 : dbm >= -70 ? 20 : dbm >= -80 ? 10 : 0;
    parts._Signal_max = 40;
  }

  // Latency / loss (30 pts)
  const lat = state.results["latency"];
  if (lat?.data?.targets) {
    const gw = lat.data.targets.find((t) => t.label === "Default Gateway");
    let pts = 30;
    if (gw && !gw.reachable) {
      pts = 0;
    } else if (gw) {
      const loss = gw.loss_pct || 0;
      const avg = gw.avg_ms || 0;
      if (loss > 10) pts -= 15;
      else if (loss > 5) pts -= 8;
      else if (loss > 0) pts -= 3;
      if (avg > 100) pts -= 15;
      else if (avg > 50) pts -= 8;
      else if (avg > 20) pts -= 3;
    }
    parts.Latency = Math.max(0, pts);
    parts._Latency_max = 30;
  }

  // Channel (15 pts)
  const ch = state.results["channel_survey"];
  if (ch?.data?.my_channel) {
    const myCh = ch.data.my_channel;
    const cnt = (myCh <= 14 ? ch.data.ch_24 : ch.data.ch_5)[myCh] || 0;
    parts.Channel =
      myCh <= 14 ? (cnt > 5 ? 2 : cnt > 3 ? 7 : cnt > 1 ? 11 : 15) : 15;
    parts._Channel_max = 15;
  }

  // Radio (15 pts)
  const phy = state.results["phy_rate"] || state.results["interface"];
  const radio = (phy?.data?.radio_type || "").toLowerCase();
  if (radio) {
    const r = radio.includes("be")
      ? 15
      : radio.includes("ax")
        ? 14
        : radio.includes("ac")
          ? 11
          : radio.includes("n")
            ? 7
            : radio.includes("g")
              ? 3
              : radio.includes("b")
                ? 1
                : 7;
    parts.Radio = r;
    parts._Radio_max = 15;
  }

  const scoreKeys = ["Signal", "Latency", "Channel", "Radio"];
  const defined = scoreKeys.filter((k) => parts[k] != null);
  if (!defined.length) return;

  const total = defined.reduce((s, k) => s + parts[k], 0);
  const max = defined.reduce((s, k) => s + (parts["_" + k + "_max"] || 0), 0);
  const score = max > 0 ? Math.round((total / max) * 100) : 0;
  const [grade, label, color] =
    score >= 85
      ? ["A", "Excellent", "#00e676"]
      : score >= 70
        ? ["B", "Good", "#69f0ae"]
        : score >= 55
          ? ["C", "Fair", "#ffd740"]
          : score >= 40
            ? ["D", "Poor", "#ff9100"]
            : ["F", "Very Poor", "#ff5252"];

  const widget = $("score-widget");
  widget.style.display = "";
  const ring = $("score-ring");
  ring.style.borderColor = color;
  $("sr-num").textContent = score;
  $("sr-num").style.color = color;
  $("sr-grade").textContent = grade;
  $("sr-grade").style.color = color;
  $("sr-label").textContent = label;

  const barsHtml = scoreKeys
    .filter((k) => parts[k] != null)
    .map((k) => {
      const val = parts[k];
      const maxv = parts["_" + k + "_max"] || 1;
      const pct = Math.round((val / maxv) * 100);
      const fc = pct >= 80 ? "#00e676" : pct >= 55 ? "#ffd740" : "#ff5252";
      return `
      <div class="score-bar-row">
        <span class="sbl">${k}</span>
        <div class="score-bar-track"><div class="score-bar-fill" style="width:${pct}%;background:${fc}"></div></div>
        <span class="sbv">${val}/${maxv}</span>
      </div>`;
    })
    .join("");
  $("score-bars").innerHTML = barsHtml;
}

// ── Card rendering ────────────────────────────────────────────
const MODULE_ICONS = {
  interface: "IF",
  ipconfig: "IP",
  security: "SEC",
  channel_survey: "RF",
  latency: "LAT",
  dns: "DNS",
  statistics: "PKT",
  driver: "DRV",
  phy_rate: "PHY",
  walk_report: "WALK",
  live_ssid_scan: "LIVE",
};

function upsertCard(id, name, result) {
  if (id === "walk_report" || id === "live_ssid_scan") {
    // Walk report and live scan are rendered in the dedicated Site Walk tab.
    return;
  }

  let card = $("card-" + id);
  if (!card) {
    card = document.createElement("div");
    card.className = "card";
    card.id = "card-" + id;
    $("results").appendChild(card);
  }

  if (!result) {
    // Loading skeleton
    card.innerHTML = `
      <div class="card-head">
        <span class="ch-icon">${MODULE_ICONS[id] || "MOD"}</span>
        <span class="ch-title">${name}</span>
        <span class="ch-badge badge-running">SCANNING...</span>
      </div>
      <div class="card-body"><div class="card-body-inner">
        <div class="skel-row skeleton" style="width:70%"></div>
        <div class="skel-row skeleton" style="width:50%;margin-top:4px"></div>
        <div class="skel-row skeleton" style="width:85%;margin-top:4px;margin-bottom:12px"></div>
      </div></div>`;
    return;
  }

  const dur = state.durations[id];
  const durStr = dur ? `${(dur / 1000).toFixed(1)}s` : "";
  const status = result.status || "ok";
  const statusLabel = status.toUpperCase();
  const badgeClass = `badge-${status}`;

  const headHtml = `
    <div class="card-head" onclick="toggleCard('${id}')">
      <span class="ch-icon">${MODULE_ICONS[id] || "🔧"}</span>
      <span class="ch-title">${name}</span>
      <span class="ch-badge ${badgeClass}">${statusLabel}</span>
      ${durStr ? `<span class="ch-dur">${durStr}</span>` : ""}
      <span class="ch-chevron">▾</span>
    </div>`;

  let bodyHtml = "";
  if (status === "error") {
    bodyHtml = `<div class="card-error"><span class="e-icon">ERR</span>${escHtml(result.error || "Unknown error")}</div>`;
  } else {
    const warnings = result.warnings || [];
    const recs = result.recommendations || [];
    bodyHtml += renderWarnings(warnings);
    bodyHtml += renderBody(id, result.data || {});
    bodyHtml += renderRecs(recs);
  }

  card.innerHTML =
    headHtml +
    `<div class="card-body"><div class="card-body-inner">${bodyHtml}</div></div>`;
}

function toggleCard(id) {
  const card = $("card-" + id);
  if (card) card.classList.toggle("collapsed");
}

// ── Per-module body renderers ────────────────────────────────
function renderBody(id, data) {
  if (data && data._report) return renderWalkReport(data);
  if (data && data._live) return renderLiveSsidScan(data);

  const renderers = {
    interface: renderInterface,
    ipconfig: renderIPConfig,
    security: renderSecurity,
    channel_survey: renderChannelSurvey,
    latency: renderLatency,
    dns: renderDNS,
    statistics: renderStatistics,
    driver: renderDriver,
    phy_rate: renderPhyRate,
  };
  const fn = renderers[id];
  return fn ? fn(data) : renderGenericKV(data);
}

function renderWalkReport(d) {
  const sess = d.session || {};
  const sig = d.signal_dbm || {};
  const cov = d.coverage || {};
  const samples = d.samples || [];
  const locs = d.location_summary || [];
  const checkpoints = samples.filter((s) => s && s.is_checkpoint);

  const metrics = `
    <div class="metric-grid">
      <div class="metric-item"><div class="mk">Samples</div><div class="mv">${sess.sample_count || 0}</div></div>
      <div class="metric-item"><div class="mk">Min dBm</div><div class="mv">${sig.min ?? "—"}</div></div>
      <div class="metric-item"><div class="mk">Max dBm</div><div class="mv">${sig.max ?? "—"}</div></div>
      <div class="metric-item"><div class="mk">Avg dBm</div><div class="mv">${sig.avg ?? "—"}</div></div>
      <div class="metric-item"><div class="mk">Below -67 dBm</div><div class="mv">${cov.below_minus_67_pct ?? 0}%</div></div>
      <div class="metric-item"><div class="mk">Below -70 dBm</div><div class="mv">${cov.below_minus_70_pct ?? 0}%</div></div>
    </div>`;

  let locTable = '<div class="empty-msg">No tagged locations yet</div>';
  if (locs.length) {
    locTable = `
      <div class="overflow-wrap" style="max-height:220px">
        <table class="ap-tbl">
          <tr><th>Location Tag</th><th>Samples</th><th>Min dBm</th><th>Avg dBm</th><th>Max dBm</th></tr>
          ${locs
            .map(
              (l) => `<tr>
            <td>${escHtml(l.label)}</td>
            <td>${l.count}</td>
            <td>${l.min_dbm}</td>
            <td>${l.avg_dbm}</td>
            <td>${l.max_dbm}</td>
          </tr>`,
            )
            .join("")}
        </table>
      </div>`;
  }

  let distanceTable =
    '<div class="empty-msg">No checkpoint distances yet</div>';
  if (checkpoints.length > 1) {
    let cumulative = 0;
    const rows = checkpoints
      .map((cp, idx) => {
        let seg = 0;
        if (idx > 0) {
          const prev = checkpoints[idx - 1];
          const x1 = Number(prev.map_x_m || 0);
          const y1 = Number(prev.map_y_m || 0);
          const x2 = Number(cp.map_x_m || 0);
          const y2 = Number(cp.map_y_m || 0);
          seg = Math.hypot(x2 - x1, y2 - y1);
        }
        cumulative += seg;
        return `<tr>
        <td>#${idx + 1}</td>
        <td>${escHtml(cp.location_label || cp.label || `Checkpoint ${cp.id}`)}</td>
        <td>${cp.signal_dbm != null ? `${cp.signal_dbm} dBm` : cp.signal_pct || "n/a"}</td>
        <td>${idx === 0 ? "0.0 m" : `${seg.toFixed(1)} m`}</td>
        <td>${cumulative.toFixed(1)} m</td>
      </tr>`;
      })
      .join("");

    distanceTable = `
      <div class="distance-table">
        <table class="ap-tbl">
          <tr><th>#</th><th>Location</th><th>Signal</th><th>Segment</th><th>Cumulative</th></tr>
          ${rows}
        </table>
      </div>`;
  }

  return `
    ${metrics}
    ${renderTimeline(samples)}
    ${renderRouteView(samples)}
    <div style="padding:4px 16px 8px;font-size:12px;color:var(--text2)">Distance between tagged locations</div>
    ${distanceTable}
    <div style="padding:4px 16px 8px;font-size:12px;color:var(--text2)">Location-tag summary</div>
    ${locTable}`;
}

function routeNodeColor(dbm) {
  if (dbm == null || Number.isNaN(Number(dbm))) return "#7b8db0";
  const v = Number(dbm);
  if (v >= -60) return "#00e676";
  if (v >= -67) return "#aeea00";
  if (v >= -70) return "#ffd740";
  if (v >= -75) return "#ff9100";
  return "#ff5252";
}

function renderRouteView(samples) {
  const checkpoints = (samples || []).filter((s) => s && s.is_checkpoint);
  if (!checkpoints.length) {
    return '<div class="empty-msg">No checkpoints yet for route view. Add tags during your walk to build a pseudo-map.</div>';
  }

  const w = 980;
  const h = 210;
  const padX = 52;
  const padY = 30;

  const hasCoords = checkpoints.some(
    (cp) =>
      Number.isFinite(Number(cp.map_x_m)) ||
      Number.isFinite(Number(cp.map_y_m)),
  );
  let nodes = [];

  if (hasCoords) {
    const xs = checkpoints
      .map((cp) => Number(cp.map_x_m))
      .filter((v) => Number.isFinite(v));
    const ys = checkpoints
      .map((cp) => Number(cp.map_y_m))
      .filter((v) => Number.isFinite(v));
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 1;
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxY = ys.length ? Math.max(...ys) : 1;

    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;

    nodes = checkpoints.map((cp, i) => {
      const rawX = Number.isFinite(Number(cp.map_x_m)) ? Number(cp.map_x_m) : 0;
      const rawY = Number.isFinite(Number(cp.map_y_m)) ? Number(cp.map_y_m) : 0;
      const x = padX + ((rawX - minX) / dx) * (w - padX * 2);
      const y = padY + ((rawY - minY) / dy) * (h - padY * 2);
      return { ...cp, idx: i + 1, x, y };
    });
  } else {
    const cols = Math.min(
      6,
      Math.max(3, Math.ceil(Math.sqrt(checkpoints.length))),
    );
    const rows = Math.max(1, Math.ceil(checkpoints.length / cols));
    const stepX = cols > 1 ? (w - padX * 2) / (cols - 1) : 0;
    const stepY = rows > 1 ? (h - padY * 2) / (rows - 1) : 0;

    nodes = checkpoints.map((cp, i) => {
      const row = Math.floor(i / cols);
      const colRaw = i % cols;
      const col = row % 2 === 0 ? colRaw : cols - 1 - colRaw;
      const x = padX + col * stepX;
      const y = padY + row * stepY;
      return { ...cp, idx: i + 1, x, y };
    });
  }

  const path = nodes.map((n) => `${n.x},${n.y}`).join(" ");

  const nodeSvg = nodes
    .map((n) => {
      const color = routeNodeColor(n.signal_dbm);
      const tag = (n.location_label || `Checkpoint ${n.id}`).slice(0, 20);
      const dbm =
        n.signal_dbm != null ? `${n.signal_dbm} dBm` : n.signal_pct || "n/a";
      return `
      <g>
        <circle class="route-node" cx="${n.x}" cy="${n.y}" r="8" fill="${color}">
          <title>#${n.idx} ${escHtml(tag)} · ${dbm}</title>
        </circle>
        <text class="route-node-label" x="${n.x + 11}" y="${n.y - 2}">#${n.idx}</text>
        <text class="route-node-tag" x="${n.x + 11}" y="${n.y + 10}">${escHtml(tag)}</text>
      </g>`;
    })
    .join("");

  return `
    <div class="route-wrap">
      <div style="font-size:12px;color:var(--text2);margin-bottom:6px">No-floorplan Route View (${hasCoords ? "manual direction hints" : "checkpoint order"})</div>
      <div class="route-legend">
        <span><span class="sw" style="background:#00e676"></span> strong (>= -60 dBm)</span>
        <span><span class="sw" style="background:#ffd740"></span> fair (-67 to -70)</span>
        <span><span class="sw" style="background:#ff5252"></span> weak (< -75)</span>
      </div>
      <div class="route-chart">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          <polyline class="route-line" points="${path}"></polyline>
          ${nodeSvg}
        </svg>
      </div>
    </div>`;
}

function renderTimeline(samples) {
  if (!samples || !samples.length) {
    return '<div class="empty-msg">No walk samples collected yet</div>';
  }

  const vals = samples
    .map((s) => Number(s.signal_dbm))
    .filter((v) => Number.isFinite(v));
  if (!vals.length) {
    return '<div class="empty-msg">No valid dBm values in samples</div>';
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const w = 900;
  const h = 140;
  const pad = 26;
  const xStep = samples.length > 1 ? (w - pad * 2) / (samples.length - 1) : 0;
  const yScale = (v) => {
    if (max === min) return h / 2;
    return pad + ((max - v) / (max - min)) * (h - pad * 2);
  };

  const points = samples
    .map((s, i) => {
      const v = Number(s.signal_dbm);
      if (!Number.isFinite(v)) return null;
      return `${pad + i * xStep},${yScale(v)}`;
    })
    .filter(Boolean)
    .join(" ");

  const dots = samples
    .map((s, i) => {
      const v = Number(s.signal_dbm);
      if (!Number.isFinite(v)) return "";
      const x = pad + i * xStep;
      const y = yScale(v);
      const cls = s.is_checkpoint
        ? "timeline-point checkpoint"
        : "timeline-point";
      const tag = s.location_label ? ` @ ${escHtml(s.location_label)}` : "";
      return `<circle class="${cls}" cx="${x}" cy="${y}" r="${s.is_checkpoint ? 4 : 2.5}"><title>${s.timestamp}: ${v} dBm${tag}</title></circle>`;
    })
    .join("");

  return `
    <div class="timeline-wrap">
      <div style="font-size:12px;color:var(--text2);margin-bottom:6px">Signal timeline (dBm while moving)</div>
      <div class="timeline-chart">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          <line class="timeline-grid" x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}"></line>
          <line class="timeline-grid" x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}"></line>
          <polyline class="timeline-line" points="${points}"></polyline>
          ${dots}
          <text class="timeline-axis" x="4" y="${pad + 4}">${max.toFixed(0)} dBm</text>
          <text class="timeline-axis" x="4" y="${h - pad + 4}">${min.toFixed(0)} dBm</text>
        </svg>
      </div>
    </div>`;
}

function renderLiveSsidScan(d) {
  if (d.error) {
    return `<div class="card-error"><span class="e-icon">ERR</span>${escHtml(d.error)}</div>`;
  }

  const channelPairs = Object.entries(d.channels || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([ch, cnt]) => `Ch ${escHtml(ch)}: ${cnt}`)
    .join(" · ");

  return `
    <div class="ssid-live-head">
      <div class="left">${d.total_aps || 0} APs visible</div>
      <div class="right">${escHtml(d.timestamp || "")}</div>
    </div>
    <div style="padding:0 16px 8px;font-size:11px;color:var(--text2)">${escHtml(channelPairs || "No channel data")}</div>
    <div class="overflow-wrap" style="max-height:300px">
      <table class="ap-tbl">
        <tr><th>SSID</th><th>BSSID</th><th>Ch</th><th>Band</th><th>Signal</th></tr>
        ${(d.aps || [])
          .map(
            (ap) => `<tr class="${ap.is_mine ? "mine" : ""}">
          <td>${escHtml(ap.ssid || "")}${ap.is_mine ? '<span class="mine-tag">◄ YOU</span>' : ""}</td>
          <td>${escHtml(ap.bssid || "")}</td>
          <td>${escHtml(String(ap.channel || "—"))}</td>
          <td>${escHtml(ap.band || "—")}</td>
          <td>${escHtml(ap.signal || "")}${ap.signal_dbm != null ? ` (${ap.signal_dbm} dBm)` : ""}</td>
        </tr>`,
          )
          .join("")}
      </table>
    </div>`;
}

function drawWalkMap() {
  const canvas = $("walk-map-canvas");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(600, Math.floor(rect.width));
  const height = Math.max(360, Math.floor(rect.height));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const samples = (state.walkReport?.samples || []).filter(
    (s) => s && Number.isFinite(Number(s.signal_dbm)),
  );
  const checkpoints = (state.walkReport?.samples || []).filter(
    (s) => s && s.is_checkpoint,
  );
  const cal = state.floorplanCalibration;

  // Background: floorplan image if provided, otherwise grid.
  if (state.floorplanImage) {
    ctx.drawImage(state.floorplanImage, 0, 0, width, height);
    ctx.fillStyle = "rgba(11,13,26,0.25)";
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = "#101326";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#252a4a";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  // Draw calibration markers and baseline if present.
  if (cal.pointA) {
    ctx.fillStyle = "#00d4ff";
    ctx.beginPath();
    ctx.arc(cal.pointA.x, cal.pointA.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#dde2f0";
    ctx.font = "11px Segoe UI";
    ctx.fillText("A", cal.pointA.x + 7, cal.pointA.y - 7);
  }
  if (cal.pointB) {
    ctx.fillStyle = "#00d4ff";
    ctx.beginPath();
    ctx.arc(cal.pointB.x, cal.pointB.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#dde2f0";
    ctx.font = "11px Segoe UI";
    ctx.fillText("B", cal.pointB.x + 7, cal.pointB.y - 7);
    if (cal.pointA) {
      ctx.strokeStyle = "rgba(0,212,255,0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cal.pointA.x, cal.pointA.y);
      ctx.lineTo(cal.pointB.x, cal.pointB.y);
      ctx.stroke();
    }
  }

  if (!samples.length) {
    ctx.fillStyle = "#7b8db0";
    ctx.font = "14px Segoe UI";
    ctx.fillText("No walk samples yet. Start a walk to build heatmap.", 20, 32);

    const est = state.localization?.replay?.latest_estimate;
    if (est) {
      const conf = Number(est.confidence || 0);
      const progressPct = Math.round(Number(est.progress || 0) * 100);
      ctx.fillStyle =
        conf >= 70 ? "#00e676" : conf >= 45 ? "#ffd740" : "#ff5252";
      ctx.font = "12px Segoe UI";
      ctx.fillText(
        `Replay estimate: ${progressPct}% route · confidence ${conf.toFixed(0)}% · point #${est.matched_seq || "?"}`,
        20,
        54,
      );
    }
    return;
  }

  const pad = 24;
  const hasCalibratedMap = !!(
    state.floorplanImage &&
    cal.pointA &&
    cal.metersPerPixel
  );
  let toXY;

  if (hasCalibratedMap) {
    const base = checkpoints[0] || samples[0] || { map_x_m: 0, map_y_m: 0 };
    const baseX = Number(base.map_x_m || 0);
    const baseY = Number(base.map_y_m || 0);
    toXY = (sx, sy) => {
      const xM = Number(sx || 0) - baseX;
      const yM = Number(sy || 0) - baseY;
      return {
        x: cal.pointA.x + xM / cal.metersPerPixel,
        y: cal.pointA.y + yM / cal.metersPerPixel,
      };
    };
  } else {
    const allX = samples.map((s) => Number(s.map_x_m || 0));
    const allY = samples.map((s) => Number(s.map_y_m || 0));
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX);
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    toXY = (sx, sy) => ({
      x: pad + ((Number(sx || 0) - minX) / rangeX) * (width - pad * 2),
      y: pad + ((Number(sy || 0) - minY) / rangeY) * (height - pad * 2),
    });
  }

  const heatColor = (dbm) => {
    const v = Number(dbm);
    if (v >= -60) return [0, 230, 118];
    if (v >= -67) return [174, 234, 0];
    if (v >= -70) return [255, 215, 64];
    if (v >= -75) return [255, 145, 0];
    return [255, 82, 82];
  };

  // Heat blobs.
  for (const s of samples) {
    const p = toXY(s.map_x_m, s.map_y_m);
    const [r, g, b] = heatColor(s.signal_dbm);
    const grad = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 34);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 34, 0, Math.PI * 2);
    ctx.fill();
  }

  // Path through checkpoints.
  if (checkpoints.length > 1) {
    ctx.strokeStyle = "rgba(95,107,149,0.95)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    checkpoints.forEach((cp, i) => {
      const p = toXY(cp.map_x_m, cp.map_y_m);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }

  // Checkpoint markers + labels.
  checkpoints.forEach((cp, i) => {
    const p = toXY(cp.map_x_m, cp.map_y_m);
    const [r, g, b] = heatColor(cp.signal_dbm);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.strokeStyle = "#0b0d1a";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#dde2f0";
    ctx.font = "11px Segoe UI";
    const label = (cp.location_label || cp.label || `CP ${i + 1}`).slice(0, 20);
    ctx.fillText(`#${i + 1} ${label}`, p.x + 8, p.y - 8);
  });

  // Draw reference path if in replay mode
  const est = state.localization?.replay?.latest_estimate;
  if (
    est &&
    est.reference_checkpoints &&
    est.reference_checkpoints.length > 0
  ) {
    const refCps = est.reference_checkpoints;

    // Draw reference path polyline
    if (refCps.length > 1) {
      ctx.strokeStyle = "rgba(0,212,255,0.5)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      refCps.forEach((cp, i) => {
        const p = toXY(cp.map_x_m, cp.map_y_m);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Highlight matched checkpoint
    if (est.matched_checkpoint) {
      const mcp = est.matched_checkpoint;
      const p = toXY(mcp.map_x_m, mcp.map_y_m);
      ctx.strokeStyle = "#00e676";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#dde2f0";
      ctx.font = "bold 11px Segoe UI";
      ctx.fillText((mcp.label || "?").slice(0, 15), p.x + 14, p.y + 4);
    }

    // Draw line and arrow to next checkpoint
    if (est.matched_checkpoint && est.next_checkpoint && est.position) {
      const curP = toXY(est.position.x_m, est.position.y_m);
      const nextP = toXY(
        est.next_checkpoint.map_x_m,
        est.next_checkpoint.map_y_m,
      );

      ctx.strokeStyle = "rgba(255,215,64,0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(curP.x, curP.y);
      ctx.lineTo(nextP.x, nextP.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw next checkpoint circle
      ctx.strokeStyle = "#ffd740";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nextP.x, nextP.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Replay estimate marker with confidence color and progress text.
  if (
    est &&
    est.position &&
    Number.isFinite(Number(est.position.x_m)) &&
    Number.isFinite(Number(est.position.y_m))
  ) {
    const conf = Number(est.confidence || 0);
    const confColor =
      conf >= 70 ? "#00e676" : conf >= 45 ? "#ffd740" : "#ff5252";
    const p = toXY(est.position.x_m, est.position.y_m);

    ctx.strokeStyle = confColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = confColor;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#dde2f0";
    ctx.font = "11px Segoe UI";
    ctx.fillText(
      `Est ${Math.round(Number(est.progress || 0) * 100)}% · ${conf.toFixed(0)}% conf`,
      p.x + 14,
      p.y + 4,
    );
  }

  // Legend / mode banner
  ctx.fillStyle = "rgba(11,13,26,0.65)";
  ctx.fillRect(10, height - 44, Math.min(700, width - 20), 36);
  ctx.fillStyle = "#dde2f0";
  ctx.font = "11px Segoe UI";
  if (hasCalibratedMap) {
    ctx.fillText(
      `Calibrated floorplan (${cal.metersPerPixel.toFixed(4)} m/px). Route distances are to scale.`,
      16,
      height - 28,
    );
  } else if (state.floorplanImage) {
    ctx.fillText(
      "Floorplan loaded (not calibrated). Click Calibrate (2 pts) to set scale.",
      16,
      height - 28,
    );
  } else {
    ctx.fillText(
      "No floorplan loaded. Showing coordinate-grid heatmap.",
      16,
      height - 28,
    );
  }

  if (est) {
    const conf = Number(est.confidence || 0);
    const risk =
      conf < 45
        ? "high drift risk"
        : conf < 70
          ? "moderate drift risk"
          : "stable";
    ctx.fillStyle = conf >= 70 ? "#00e676" : conf >= 45 ? "#ffd740" : "#ff5252";
    const matchedLabel = est.matched_checkpoint
      ? est.matched_checkpoint.label
      : "?";
    const nextLabel = est.next_checkpoint ? est.next_checkpoint.label : "(end)";
    const guidance = computeReplayGuidance(est.position, est.next_checkpoint);
    const moveText = guidance
      ? ` · move ${guidance.distanceM.toFixed(1)}m ${guidance.cardinal} (${guidance.headingDeg}deg)`
      : "";
    ctx.fillText(
      `Replay: matched "${matchedLabel}" (${Math.round(Number(est.progress || 0) * 100)}%) · next "${nextLabel}"${moveText} · conf ${conf.toFixed(0)}% · ${risk}`,
      16,
      height - 14,
    );
  }
}

// ── Interface renderer ───────────────────────────────────────
function renderInterface(d) {
  const rows = [
    ["Status", d.state, stateColor(d.state)],
    ["SSID", d.ssid, ""],
    ["BSSID (AP MAC)", d.bssid, "mono"],
    ["Adapter MAC", d.physical_address, "mono"],
    ["Interface Name", d.name, ""],
    ["Radio Standard", d.radio_label || d.radio_type, ""],
    ["Frequency Band", d.band, ""],
    ["Channel", d.channel, ""],
    ["Profile", d.profile, ""],
    ["Network Type", d.network_type, ""],
    ["Connection Mode", d.connection_mode, ""],
    ["PHY RX Rate", d.receive_rate ? d.receive_rate + " Mbps" : null, ""],
    ["PHY TX Rate", d.transmit_rate ? d.transmit_rate + " Mbps" : null, ""],
    [
      "Signal",
      d.signal && d.signal_dbm != null
        ? `${d.signal} (~${d.signal_dbm} dBm)`
        : d.signal,
      `quality-${d.signal_quality_level}`,
    ],
    ["Signal Quality", d.signal_quality, `quality-${d.signal_quality_level}`],
    ["GUID", d.guid, "mono"],
  ];

  let html = '<table class="kv-table">' + kvRows(rows) + "</table>";

  // Signal bar
  if (d.signal_dbm != null) {
    const dbm = d.signal_dbm;
    const pct = Math.max(
      0,
      Math.min(100, Math.round(((dbm + 100) / 50) * 100)),
    );
    const col =
      dbm >= -60
        ? "#00e676"
        : dbm >= -70
          ? "#ffd740"
          : dbm >= -80
            ? "#ff9100"
            : "#ff5252";
    html += `
      <div class="signal-bar-wrap">
        <span style="font-size:11px;color:var(--text2);width:80px">Signal</span>
        <div class="signal-bar-track">
          <div class="signal-bar-fill" style="width:${pct}%;background:${col}"></div>
        </div>
        <span style="font-size:11px;color:var(--text2);width:55px;text-align:right">${d.signal} (${dbm} dBm)</span>
      </div>`;
  }
  return html;
}

function stateColor(s) {
  return !s
    ? ""
    : s.toLowerCase().includes("connected")
      ? "quality-excellent"
      : "quality-critical";
}

// ── IP Config renderer ───────────────────────────────────────
function renderIPConfig(d) {
  const rows = [
    ["IPv4 Address", d.ipv4, ""],
    ["Subnet Mask", d.subnet_mask, ""],
    [
      "Prefix Length",
      d.prefix_length != null
        ? `/${d.prefix_length} (${d.subnet_size?.toLocaleString()} hosts)`
        : null,
      "",
    ],
    ["Default Gateway", d.gateway_ip || d.default_gateway, "mono"],
    ["Gateway MAC", d.gateway_mac, "mono"],
    ["DHCP Enabled", d.dhcp_enabled, ""],
    ["DHCP Server", d.dhcp_server, "mono"],
    ["Lease Obtained", d.lease_obtained, ""],
    ["Lease Expires", d.lease_expires, ""],
    ["DNS Servers", d.dns_list?.join(", ") || d.dns_servers, "mono"],
    ["IPv6 Link-Local", d.ipv6_link_local, "mono"],
  ];
  return '<table class="kv-table">' + kvRows(rows) + "</table>";
}

// ── Security renderer ─────────────────────────────────────────
function renderSecurity(d) {
  const lvl = d.security_level || "Unknown";
  const lvlCls = ["Excellent", "Good"].includes(lvl)
    ? "quality-excellent"
    : lvl === "Fair"
      ? "quality-fair"
      : ["Poor", "Critical", "None"].includes(lvl)
        ? "quality-critical"
        : "";
  const rows = [
    ["Authentication", d.authentication, ""],
    ["Cipher", d.cipher, ""],
    ["Security Level", lvl, lvlCls],
    ["802.11w MFP", d.mfp_80211w, ""],
    ["FIPS 140-2 Mode", d.fips_140_2, ""],
    [
      "Security Score",
      d.security_score != null ? d.security_score + "/100" : null,
      "",
    ],
  ];
  let html = '<table class="kv-table">' + kvRows(rows) + "</table>";
  if (d.security_desc) {
    html += `<div style="padding:8px 16px 12px;font-size:12px;color:var(--text2);line-height:1.5">${escHtml(d.security_desc)}</div>`;
  }
  return html;
}

// ── Channel Survey renderer ────────────────────────────────────
function renderChannelSurvey(d) {
  let html = "";

  // 2.4 GHz channel chart
  if (d.ch_24 && Object.keys(d.ch_24).length) {
    html += renderChannelChart(
      "2.4 GHz",
      d.ch_24,
      d.my_channel,
      14,
      d.non_overlapping_24 || [1, 6, 11],
    );
  }
  // 5 GHz channel chart
  if (d.ch_5 && Object.keys(d.ch_5).length) {
    html += renderChannelChart("5 GHz", d.ch_5, d.my_channel, 999, []);
  }

  // AP table
  if (d.aps && d.aps.length) {
    html += `
      <div style="padding:8px 16px 4px;font-size:12px;color:var(--text2)">
        ${d.total_ssids} SSIDs · ${d.total_aps} APs visible
      </div>
      <div class="overflow-wrap">
        <table class="ap-tbl">
          <tr>
            <th>SSID</th><th>BSSID</th><th>Ch</th><th>Band</th>
            <th>Signal</th><th>Radio</th><th>Auth</th>
          </tr>
          ${d.aps
            .map((ap) => {
              const qcol = qualityColor(ap.signal_quality_level);
              const dbmStr =
                ap.signal_dbm != null ? ` (${ap.signal_dbm} dBm)` : "";
              return `<tr class="${ap.is_mine ? "mine" : ""}">
              <td>${escHtml(ap.ssid)}${ap.is_mine ? '<span class="mine-tag">◄ YOU</span>' : ""}</td>
              <td>${escHtml(ap.bssid)}</td>
              <td>${ap.channel || "—"}</td>
              <td>${ap.band || "—"}</td>
              <td style="color:${qcol}">${ap.signal || "—"}${dbmStr}</td>
              <td>${ap.radio_type || "—"}</td>
              <td>${ap.authentication || "—"}</td>
            </tr>`;
            })
            .join("")}
        </table>
      </div>`;
  }
  return html;
}

function renderChannelChart(label, chMap, myCh, limit, nonOverlap) {
  const channels = Object.keys(chMap)
    .map(Number)
    .sort((a, b) => a - b);
  const maxCnt = Math.max(...Object.values(chMap), 1);
  const HEIGHT = 64;

  const bars = channels
    .map((ch) => {
      const cnt = chMap[ch];
      const h = Math.max(Math.round((cnt / maxCnt) * HEIGHT), 4);
      const isMine = ch === myCh;
      const isNo = nonOverlap.includes(ch);
      const col = isMine
        ? "#00d4ff"
        : cnt > 4
          ? "#ff5252"
          : cnt > 2
            ? "#ffd740"
            : "#00e676";
      const mineClass = isMine ? " mine" : "";
      const noMark = isNo ? "★" : "";
      return `
      <div class="ch-bar-wrap" title="${cnt} AP${cnt !== 1 ? "s" : ""} on ch${ch}${isNo ? " (non-overlapping)" : ""}${isMine ? " — YOUR CHANNEL" : ""}">
        <span class="ch-bar-cnt">${cnt}</span>
        <div class="ch-bar${mineClass}" style="height:${h}px;background:${col}"></div>
        <span class="ch-bar-lbl">Ch${ch}${noMark}</span>
      </div>`;
    })
    .join("");

  return `
    <div class="ch-chart-wrap">
      <div class="ch-chart-label">${label} Channels
        <span style="margin-left:10px;font-size:10px">
          <span style="color:#00d4ff">■</span> yours
          <span style="color:#00e676;margin-left:6px">■</span> low
          <span style="color:#ffd740;margin-left:6px">■</span> moderate
          <span style="color:#ff5252;margin-left:6px">■</span> heavy
          ${nonOverlap.length ? '<span style="margin-left:6px;color:var(--text2)">★ = non-overlapping</span>' : ""}
        </span>
      </div>
      <div class="ch-chart">${bars}</div>
    </div>`;
}

// ── Latency renderer ──────────────────────────────────────────
function renderLatency(d) {
  if (!d.targets || !d.targets.length)
    return '<div class="empty-msg">No latency data</div>';

  const rows = d.targets
    .map((t) => {
      if (!t.reachable) {
        return `<tr>
        <td>${escHtml(t.label)}</td>
        <td style="font-family:var(--mono);font-size:11px">${escHtml(t.host)}</td>
        <td colspan="5" style="color:var(--gray)">—</td>
        <td style="color:var(--red);font-weight:600">UNREACHABLE</td>
        <td></td>
      </tr>`;
      }
      const qcol = qualityColor(t.quality_level);
      const spark = sparkline(t.rtts || []);
      return `<tr>
      <td>${escHtml(t.label)}</td>
      <td style="font-family:var(--mono);font-size:11px">${escHtml(t.host)}</td>
      <td>${t.min_ms} ms</td>
      <td style="font-weight:600">${t.avg_ms} ms</td>
      <td>${t.max_ms} ms</td>
      <td>±${t.jitter_ms} ms</td>
      <td>${t.loss_pct}%</td>
      <td style="color:${qcol};font-weight:600">${escHtml(t.quality)}</td>
      <td>${spark}</td>
    </tr>`;
    })
    .join("");

  return `
    <div class="overflow-wrap" style="max-height:none">
      <table class="latency-tbl">
        <tr><th>Target</th><th>Host</th><th>Min</th><th>Avg</th><th>Max</th><th>Jitter</th><th>Loss</th><th>Quality</th><th>RTT</th></tr>
        ${rows}
      </table>
    </div>`;
}

function sparkline(rtts) {
  if (!rtts || !rtts.length) return "";
  const maxV = Math.max(...rtts, 1);
  const bars = rtts
    .map((v) => {
      const h = Math.max(2, Math.round((v / maxV) * 18));
      return `<span style="height:${h}px"></span>`;
    })
    .join("");
  return `<div class="sparkline">${bars}</div>`;
}

// ── DNS renderer ──────────────────────────────────────────────
function renderDNS(d) {
  if (!d.results || !d.results.length)
    return '<div class="empty-msg">No DNS data</div>';

  const rows = d.results
    .map((r) => {
      if (r.ok) {
        return `<div class="dns-row">
        <span class="dns-icon" style="color:var(--green)">OK</span>
        <span class="dns-domain">${escHtml(r.domain)}</span>
        <span class="dns-ip">${escHtml(r.ip || "")}</span>
        <span class="dns-ms">${r.ms} ms</span>
      </div>`;
      }
      return `<div class="dns-row">
      <span class="dns-icon" style="color:var(--red)">FAIL</span>
      <span class="dns-domain">${escHtml(r.domain)}</span>
      <span class="dns-err">${escHtml(r.error || "Failed")}</span>
    </div>`;
    })
    .join("");

  const avg = d.avg_ms;
  const summary = `
    <div style="padding:8px 16px 4px;font-size:12px;color:var(--text2)">
      ${d.ok_count}/${d.total} domains resolved
      ${avg != null ? ` · avg ${avg} ms` : ""}
    </div>`;
  return summary + rows;
}

// ── Statistics renderer ───────────────────────────────────────
function renderStatistics(d) {
  const retry = d.retry_rate_pct;
  const rcol =
    retry == null
      ? ""
      : retry < 5
        ? "#00e676"
        : retry < 15
          ? "#ffd740"
          : "#ff5252";

  const items = [
    ["Frames TX", fmt(d.frames_tx), ""],
    ["Frames RX", fmt(d.frames_rx), ""],
    ["Frames Dropped", fmt(d.frames_dropped_tx), ""],
    ["Beacons RX", fmt(d.beacons_rx), ""],
    ["TX Retries", fmt(d.tx_retries), ""],
    ["TX Retry Rate", retry != null ? retry + "%" : "—", rcol],
    ["ACK Timeouts", fmt(d.ack_timeout), ""],
    ["CTS Timeouts", fmt(d.cts_timeout), ""],
    ["Duplicate Frames", fmt(d.dup_frames), ""],
    ["Multicast RX", fmt(d.multicast_rx), ""],
  ];

  const cells = items
    .map(
      ([k, v, col]) => `
    <div class="stat-item">
      <div class="si-key">${k}</div>
      <div class="si-val" style="${col ? "color:" + col : ""}">${v ?? "—"}</div>
    </div>`,
    )
    .join("");

  return `<div class="stat-grid">${cells}</div>`;
}

function fmt(n) {
  return n != null ? Number(n).toLocaleString() : "—";
}

// ── Driver renderer ───────────────────────────────────────────
function renderDriver(d) {
  const age = d.driver_age_years;
  const ageCol = age && age > 2 ? "#ffd740" : "";
  const rows = [
    ["Adapter", d.description, ""],
    ["Vendor", d.vendor, ""],
    ["Provider", d.provider, ""],
    ["Driver Version", d.version, "mono"],
    [
      "Driver Date",
      d.date + (d.driver_age_label ? ` (${d.driver_age_label})` : ""),
      ageCol ? "quality-fair" : "",
    ],
    ["Radio Types", d.radio_types, ""],
    ["Hosted Network", d.hosted_net, ""],
    ["802.11w MFP", d.mfp_80211w, ""],
    ["FIPS 140-2", d.fips_mode, ""],
    ["IHV Service", d.ihv_present, ""],
  ];
  return '<table class="kv-table">' + kvRows(rows) + "</table>";
}

// ── PHY Rate renderer ─────────────────────────────────────────
function renderPhyRate(d) {
  const eff = d.efficiency_pct;
  const effCol =
    eff == null
      ? "#7b8db0"
      : eff >= 60
        ? "#00e676"
        : eff >= 30
          ? "#ffd740"
          : "#ff5252";

  let ringHtml = "";
  if (eff != null) {
    const r = 36,
      circ = 2 * Math.PI * r;
    const dash = ((eff / 100) * circ).toFixed(1);
    ringHtml = `
      <div class="phy-ring">
        <svg viewBox="0 0 80 80" width="80" height="80">
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--border)" stroke-width="6"/>
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="${effCol}" stroke-width="6"
            stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/>
        </svg>
        <div>
          <div class="pr-val" style="color:${effCol}">${eff}%</div>
          <div class="pr-lbl">efficiency</div>
        </div>
      </div>`;
  }

  const rows = [
    ["Radio Standard", d.radio_label || d.radio_type, ""],
    ["Band", d.band, ""],
    ["Channel", d.channel, ""],
    [
      "PHY RX Rate",
      d.receive_rate_mbps != null ? d.receive_rate_mbps + " Mbps" : null,
      "",
    ],
    [
      "PHY TX Rate",
      d.transmit_rate_mbps != null ? d.transmit_rate_mbps + " Mbps" : null,
      "",
    ],
    [
      "Theoretical Max",
      d.theoretical_max_mbps != null ? d.theoretical_max_mbps + " Mbps" : null,
      "",
    ],
    [
      "Efficiency",
      eff != null ? eff + "%" : null,
      eff == null
        ? ""
        : eff >= 60
          ? "quality-excellent"
          : eff >= 30
            ? "quality-fair"
            : "quality-critical",
    ],
    [
      "Signal",
      d.signal_pct + (d.signal_dbm != null ? ` (~${d.signal_dbm} dBm)` : ""),
      "",
    ],
  ];

  return ringHtml + '<table class="kv-table">' + kvRows(rows) + "</table>";
}

// ── Generic KV fallback ───────────────────────────────────────
function renderGenericKV(d) {
  const rows = Object.entries(d)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => [
      k.replace(/_/g, " "),
      typeof v === "object" ? JSON.stringify(v) : String(v ?? ""),
      "",
    ]);
  return rows.length
    ? '<table class="kv-table">' + kvRows(rows) + "</table>"
    : '<div class="empty-msg">No data</div>';
}

// ── Shared sub-renderers ──────────────────────────────────────
function renderWarnings(warnings) {
  if (!warnings || !warnings.length) return "";
  return (
    '<div class="warnings-list">' +
    warnings.map((w) => `<div class="warn-item">${escHtml(w)}</div>`).join("") +
    "</div>"
  );
}

function renderRecs(recs) {
  if (!recs || !recs.length) return "";
  return (
    '<div class="recs-list">' +
    recs
      .map((r) => {
        const ci = r.indexOf(":");
        const tag = ci > 0 ? escHtml(r.slice(0, ci)) : "";
        const rest = ci > 0 ? escHtml(r.slice(ci + 1).trim()) : escHtml(r);
        return `<div class="rec-item">
        <span class="rec-icon">TIP</span>
        <span>${tag ? `<span class="rec-tag">${tag}</span> ` : ""}${rest}</span>
      </div>`;
      })
      .join("") +
    "</div>"
  );
}

function kvRows(rows) {
  return rows
    .filter(
      ([, v]) => v != null && v !== "" && v !== "null" && v !== "undefined",
    )
    .map(
      ([k, v, cls]) => `
      <tr>
        <td class="kv-key">${k}</td>
        <td class="kv-val ${cls || ""} mono">${escHtml(String(v))}</td>
      </tr>`,
    )
    .join("");
}

function qualityColor(level) {
  return level === "excellent" || level === "good"
    ? "var(--green)"
    : level === "fair"
      ? "var(--yellow)"
      : level === "poor"
        ? "var(--orange)"
        : level === "critical"
          ? "var(--red)"
          : "var(--text2)";
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Export ────────────────────────────────────────────────────
function exportReport() {
  const ts = new Date().toLocaleString();
  const content = document.documentElement.outerHTML
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(
      "</head>",
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head>`,
    );
  const blob = new Blob(
    [`<!-- WiFi Survey Pro — exported ${ts} -->\n`, content],
    { type: "text/html" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `wifi_survey_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "_")}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportPdfReport() {
  // Browser-native PDF generation keeps this fully offline with no external libraries.
  window.print();
}

// ── Toolbar controls ─────────────────────────────────────────
$("btn-select-all").addEventListener("click", () => {
  state.modules.forEach((m) => state.enabled.add(m.id));
  renderSidebar();
});
$("btn-deselect-all").addEventListener("click", () => {
  state.enabled.clear();
  renderSidebar();
});
$("btn-collapse-all").addEventListener("click", () =>
  $$(".card").forEach((c) => c.classList.add("collapsed")),
);
$("btn-expand-all").addEventListener("click", () =>
  $$(".card").forEach((c) => c.classList.remove("collapsed")),
);
$("btn-export").addEventListener("click", exportReport);
$("btn-export-pdf").addEventListener("click", exportPdfReport);

$("btn-mobile-copy").addEventListener("click", async () => {
  const text = $("mobile-url").value;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Mobile URL copied", "done");
  } catch (_) {
    setStatus("Could not copy URL; copy manually from field", "warn");
  }
});

$("btn-mobile-open").addEventListener("click", () => {
  const url = $("mobile-url").value;
  if (!url) {
    setStatus("Mobile URL unavailable", "warn");
    return;
  }
  window.open(url, "_blank");
});

$("tab-btn-scan").addEventListener("click", () => setActiveTab("scan"));
$("tab-btn-walk").addEventListener("click", () => setActiveTab("walk"));

$("floorplan-file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      state.floorplanImage = img;
      state.floorplanName = file.name;
      state.floorplanCalibration.active = false;
      state.floorplanCalibration.awaiting = 0;
      state.floorplanCalibration.pointA = null;
      state.floorplanCalibration.pointB = null;
      state.floorplanCalibration.metersPerPixel = null;
      setCalibrationStatus(
        "Floorplan loaded. Optional: set calibration with two known-distance points.",
        "neutral",
      );
      drawWalkMap();
      setStatus("Floorplan loaded", "done");
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

$("btn-floorplan-clear").addEventListener("click", () => {
  state.floorplanImage = null;
  state.floorplanName = "";
  state.floorplanCalibration.active = false;
  state.floorplanCalibration.awaiting = 0;
  state.floorplanCalibration.pointA = null;
  state.floorplanCalibration.pointB = null;
  state.floorplanCalibration.metersPerPixel = null;
  $("floorplan-file").value = "";
  drawWalkMap();
  setCalibrationStatus("Calibration: not set", "neutral");
  setStatus("Floorplan cleared", "");
});

$("btn-floorplan-calibrate").addEventListener("click", () => {
  const cal = state.floorplanCalibration;
  cal.knownDistanceM = Math.max(
    0.5,
    Number($("floorplan-known-distance").value || 10),
  );
  cal.active = true;
  cal.awaiting = 1;
  cal.pointA = null;
  cal.pointB = null;
  cal.metersPerPixel = null;
  setCalibrationStatus(
    "Calibration step 1/2: click first known-distance point.",
    "warn",
  );
  setActiveTab("walk");
  drawWalkMap();
});

$("btn-floorplan-reset-cal").addEventListener("click", () => {
  const cal = state.floorplanCalibration;
  cal.active = false;
  cal.awaiting = 0;
  cal.pointA = null;
  cal.pointB = null;
  cal.metersPerPixel = null;
  setCalibrationStatus(
    "Calibration reset. Map still usable without scale.",
    "neutral",
  );
  drawWalkMap();
});

$("walk-map-canvas").addEventListener("click", handleMapCanvasClick);

window.addEventListener("resize", () => {
  if (state.activeTab === "walk") {
    drawWalkMap();
  }
});

$("btn-walk-start").addEventListener("click", async () => {
  const interval = Number($("walk-interval").value || 2);
  try {
    await api("/api/walk/start", { interval_sec: interval });
    await refreshWalkState();
    await refreshWalkReport();
    setStatus("Walk survey running…", "running");
    setActiveTab("walk");
    $("btn-export-pdf").disabled = false;
  } catch (e) {
    console.error(e);
    setStatus("Failed to start walk survey", "error");
  }
});

$("btn-walk-stop").addEventListener("click", async () => {
  try {
    await api("/api/walk/stop", {});
    await refreshWalkState();
    await refreshWalkReport();
    setStatus("Walk survey stopped", "done");
    $("btn-export-pdf").disabled = false;
  } catch (e) {
    console.error(e);
    setStatus("Failed to stop walk survey", "error");
  }
});

$("btn-walk-checkpoint").addEventListener("click", async () => {
  const label = $("walk-label").value.trim() || "Checkpoint";
  try {
    await api("/api/walk/checkpoint", { label });
    $("walk-label").value = "";
    await refreshWalkState();
    await refreshWalkReport();
  } catch (e) {
    console.error(e);
  }
});

$$("[data-dir]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const direction = btn.dataset.dir;
    const step_m = Number($("walk-step").value || 2.0);
    const label = $("walk-label").value.trim();
    try {
      await api("/api/walk/move", { direction, step_m, label });
      $("walk-label").value = "";
      await refreshWalkState();
      await refreshWalkReport();
      setStatus(`Move ${direction} logged`, "running");
    } catch (e) {
      console.error(e);
      setStatus("Failed to log movement", "error");
    }
  });
});

$("loc-reference-select").addEventListener("change", () => {
  renderLocalizationStatus();
});

$("btn-loc-ref-start").addEventListener("click", async () => {
  const interval = Number($("loc-interval").value || 2);
  const name = $("loc-ref-name").value.trim();
  try {
    await api("/api/localize/reference/start", {
      name,
      interval_sec: interval,
    });
    await refreshLocalizationState();
    setStatus("Reference recording started", "running");
    setActiveTab("walk");
  } catch (e) {
    console.error(e);
    setStatus("Failed to start reference recording", "error");
  }
});

$("btn-loc-ref-stop").addEventListener("click", async () => {
  try {
    await api("/api/localize/reference/stop", {});
    await refreshLocalizationReferences();
    await refreshLocalizationState();
    setStatus("Reference recording saved", "done");
  } catch (e) {
    console.error(e);
    setStatus("Failed to stop reference recording", "error");
  }
});

$("btn-loc-replay-start").addEventListener("click", async () => {
  const interval = Number($("loc-interval").value || 2);
  const refId = Number($("loc-reference-select").value || 0);
  if (!refId) {
    setStatus("Pick a reference set first", "error");
    return;
  }
  try {
    await api("/api/localize/replay/start", {
      reference_id: refId,
      interval_sec: interval,
    });
    await refreshLocalizationState();
    setStatus("Replay estimation started", "running");
    setActiveTab("walk");
  } catch (e) {
    console.error(e);
    setStatus("Failed to start replay estimation", "error");
  }
});

$("btn-loc-replay-stop").addEventListener("click", async () => {
  try {
    await api("/api/localize/replay/stop", {});
    await refreshLocalizationState();
    setStatus("Replay estimation stopped", "done");
  } catch (e) {
    console.error(e);
    setStatus("Failed to stop replay estimation", "error");
  }
});

$("btn-loc-ref-delete").addEventListener("click", async () => {
  const refId = Number($("loc-reference-select").value || 0);
  if (!refId) return;
  try {
    await api("/api/localize/reference/delete", { reference_id: refId });
    await refreshLocalizationReferences();
    await refreshLocalizationState();
    setStatus("Reference deleted", "done");
  } catch (e) {
    console.error(e);
    setStatus("Failed to delete reference", "error");
  }
});

$("btn-save-walk").addEventListener("click", async () => {
  const name = $("storage-name").value.trim();
  try {
    await api("/api/storage/save-walk", { name });
    await refreshStorageArtifacts();
    $("storage-status").textContent = "Persistence status: walk session saved.";
    setStatus("Walk session saved", "done");
  } catch (e) {
    console.error(e);
    $("storage-status").textContent =
      "Persistence status: failed to save walk session.";
    setStatus("Failed to save walk session", "error");
  }
});

$("btn-save-refs").addEventListener("click", async () => {
  const name = $("storage-name").value.trim();
  try {
    await api("/api/storage/save-references", { name });
    await refreshStorageArtifacts();
    $("storage-status").textContent =
      "Persistence status: reference library saved.";
    setStatus("Reference library saved", "done");
  } catch (e) {
    console.error(e);
    $("storage-status").textContent =
      "Persistence status: failed to save reference library.";
    setStatus("Failed to save reference library", "error");
  }
});

$("btn-save-bundle").addEventListener("click", async () => {
  const name = $("storage-name").value.trim();
  const resetAfter = !!$("storage-reset-after-bundle").checked;
  try {
    const result = await api("/api/storage/save-bundle", {
      name,
      reset_after_export: resetAfter,
    });
    await refreshStorageArtifacts();
    if (result.reset_applied) {
      await refreshWalkState();
      await refreshWalkReport();
      await refreshLocalizationReferences();
      await refreshLocalizationState();
      drawWalkMap();
      $("storage-status").textContent =
        "Persistence status: backup bundle saved and session reset.";
      setStatus("Backup bundle saved and session reset", "done");
    } else {
      $("storage-status").textContent =
        "Persistence status: backup bundle saved.";
      setStatus("Backup bundle saved", "done");
    }
  } catch (e) {
    console.error(e);
    $("storage-status").textContent =
      "Persistence status: failed to save backup bundle.";
    setStatus("Failed to save backup bundle", "error");
  }
});

$("btn-reset-site-walk").addEventListener("click", async () => {
  const ok = window.confirm(
    "Reset current walk, checkpoints, replay state, and references? Saved artifacts on disk are not deleted.",
  );
  if (!ok) return;
  try {
    const result = await api("/api/storage/reset-site-walk", {});
    applyResetPayload(result);
    await refreshStorageArtifacts();
    $("storage-status").textContent =
      "Persistence status: current session reset.";
    setStatus("Current session reset", "done");
  } catch (e) {
    console.error(e);
    $("storage-status").textContent =
      "Persistence status: failed to reset session.";
    setStatus("Failed to reset session", "error");
  }
});

$("btn-reset-and-delete").addEventListener("click", async () => {
  const ok = window.confirm(
    "Delete all saved walks/references/bundles and reset current session? This cannot be undone.",
  );
  if (!ok) return;
  try {
    const result = await api("/api/storage/reset-and-delete", {});
    applyResetPayload(result);
    await refreshStorageArtifacts();
    const removed = result.removed || {};
    const totalRemoved =
      Number(removed.walks || 0) +
      Number(removed.references || 0) +
      Number(removed.bundles || 0);
    $("storage-status").textContent =
      `Persistence status: session reset and ${totalRemoved} saved artifact(s) deleted.`;
    setStatus("Session reset and saved artifacts deleted", "done");
  } catch (e) {
    console.error(e);
    $("storage-status").textContent =
      "Persistence status: failed to reset and delete saved artifacts.";
    setStatus("Failed to reset and delete saved artifacts", "error");
  }
});

$("btn-load-walk").addEventListener("click", async () => {
  const filename = $("saved-walks-select").value;
  if (!filename) return;
  try {
    await api("/api/storage/load-walk", { filename });
    await refreshWalkState();
    await refreshWalkReport();
    $("storage-status").textContent =
      `Persistence status: loaded walk ${filename}.`;
    setStatus("Walk session loaded", "done");
    setActiveTab("walk");
  } catch (e) {
    console.error(e);
    $("storage-status").textContent =
      "Persistence status: failed to load walk session.";
    setStatus("Failed to load walk session", "error");
  }
});

$("btn-load-refs").addEventListener("click", async () => {
  const filename = $("saved-refs-select").value;
  if (!filename) return;
  try {
    await api("/api/storage/load-references", { filename, replace: false });
    await refreshLocalizationReferences();
    await refreshLocalizationState();
    $("storage-status").textContent =
      `Persistence status: loaded references ${filename}.`;
    setStatus("Reference library loaded", "done");
  } catch (e) {
    console.error(e);
    $("storage-status").textContent =
      "Persistence status: failed to load reference library.";
    setStatus("Failed to load reference library", "error");
  }
});

$("btn-load-bundle").addEventListener("click", async () => {
  const filename = $("saved-bundles-select").value;
  if (!filename) return;
  try {
    await api("/api/storage/load-bundle", {
      filename,
      replace_references: false,
    });
    await refreshWalkState();
    await refreshWalkReport();
    await refreshLocalizationReferences();
    await refreshLocalizationState();
    $("storage-status").textContent =
      `Persistence status: loaded bundle ${filename}.`;
    setStatus("Backup bundle loaded", "done");
    setActiveTab("walk");
  } catch (e) {
    console.error(e);
    $("storage-status").textContent =
      "Persistence status: failed to load backup bundle.";
    setStatus("Failed to load backup bundle", "error");
  }
});

$("btn-run-all").addEventListener("click", () => {
  const ids = state.modules.map((m) => m.id);
  state.modules.forEach((m) => state.enabled.add(m.id));
  renderSidebar();
  runModules(ids);
});

$("btn-run-selected").addEventListener("click", () => {
  const ids = state.modules
    .filter((m) => state.enabled.has(m.id))
    .map((m) => m.id);
  if (ids.length) runModules(ids);
});

$("btn-stop").addEventListener("click", () => {
  state.aborted = true;
  state.running = false;
  updateRunButtons();
  setStatus("Stopping…", "error");
});

// ── Start ─────────────────────────────────────────────────────
init();
