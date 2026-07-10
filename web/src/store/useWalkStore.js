import { create } from "zustand";
import * as api from "../api/client.js";

const EMPTY_WALK = {
  active: false,
  started_at: null,
  sample_count: 0,
  checkpoints: [],
  latest_sample: null,
  position: { x_m: 0, y_m: 0 },
};
const EMPTY_REPORT = {
  session: { active: false, sample_count: 0 },
  samples: [],
  location_summary: [],
  active_scan: [],
};
const EMPTY_LOC = {
  reference: { active: false, point_count: 0 },
  replay: { active: false, latest_estimate: null },
  reference_count: 0,
  last_error: null,
};

export const useWalkStore = create((set, get) => ({
  // ── server state ──────────────────────────────────────────────────────
  walk: { ...EMPTY_WALK },
  report: { ...EMPTY_REPORT },
  localize: { ...EMPTY_LOC },
  references: [],
  mobile: { connected: false },
  storage: { walks: [], references: [], bundles: [] },
  liveScan: [],

  // ── local UI state ────────────────────────────────────────────────────
  walkInterval: 2.0,
  stepLen: 2.0,
  walkLabel: "",
  checkpointDrafts: {},
  floorplan: null, // HTMLImageElement
  floorplanName: "",
  calibration: {
    pointA: null,
    pointB: null,
    knownDistanceM: 10,
    metersPerPixel: null,
  },

  // ── fetch actions ─────────────────────────────────────────────────────
  async fetchWalk() {
    try {
      set({ walk: await api.getWalkState() });
    } catch (_) {}
  },
  async fetchReport() {
    try {
      set({ report: await api.getWalkReport() });
    } catch (_) {}
  },
  async fetchLocalize() {
    try {
      set({ localize: await api.getLocalizeState() });
    } catch (_) {}
  },
  async fetchRefs() {
    try {
      const data = await api.getReferences();
      set({ references: data.references || [] });
    } catch (_) {}
  },
  async fetchMobile() {
    try {
      set({ mobile: await api.getMobileState() });
    } catch (_) {}
  },
  async fetchStorage() {
    try {
      set({ storage: await api.getStorageList() });
    } catch (_) {}
  },
  async fetchLive() {
    try {
      set({ liveScan: await api.getLiveSsids() });
    } catch (_) {}
  },

  // Refresh all server state at once (used on tab mount + after mutations).
  async refreshAll() {
    await Promise.allSettled([
      get().fetchWalk(),
      get().fetchReport(),
      get().fetchLocalize(),
      get().fetchRefs(),
      get().fetchMobile(),
      get().fetchStorage(),
    ]);
  },

  // ── walk actions ──────────────────────────────────────────────────────
  async startWalk() {
    const res = await api.startWalk(get().walkInterval);
    if (res) set({ walk: res });
  },
  async stopWalk() {
    const res = await api.stopWalk();
    if (res) set({ walk: res });
    await get().fetchReport();
  },
  async tagCheckpoint(label) {
    const res = await api.addCheckpoint(
      label || get().walkLabel || "Checkpoint",
    );
    if (res?.checkpoint) {
      set((s) => ({
        walk: {
          ...s.walk,
          checkpoints: [...(s.walk.checkpoints || []), res.checkpoint],
        },
        walkLabel: "",
      }));
    }
  },
  async renameCheckpoint(id, label) {
    try {
      await api.renameCheckpoint(id, label);
      set((s) => ({
        walk: {
          ...s.walk,
          checkpoints: s.walk.checkpoints.map((cp) =>
            cp.id === id ? { ...cp, label } : cp,
          ),
        },
        checkpointDrafts: Object.fromEntries(
          Object.entries(s.checkpointDrafts).filter(([k]) => k !== String(id)),
        ),
      }));
    } catch (_) {}
  },

  // ── localization actions ──────────────────────────────────────────────
  async startReference(name, interval) {
    const res = await api.startReference(name, interval ?? get().walkInterval);
    if (res?.state) set({ localize: res.state });
  },
  async stopReference() {
    const res = await api.stopReference();
    if (res?.state) set({ localize: res.state });
    if (res?.references) set({ references: res.references });
  },
  async startReplay(refId, interval) {
    const res = await api.startReplay(refId, interval ?? get().walkInterval);
    if (res?.state) set({ localize: res.state });
  },
  async stopReplay() {
    const res = await api.stopReplay();
    if (res?.state) set({ localize: res.state });
  },
  async deleteReference(refId) {
    const res = await api.deleteReference(refId);
    if (res?.references) set({ references: res.references });
    if (res?.state) set({ localize: res.state });
  },

  // ── storage actions ───────────────────────────────────────────────────
  async saveBundle(name) {
    const res = await api.saveBundle(name);
    if (res?.artifacts) set({ storage: res.artifacts });
  },
  async loadBundle(filename) {
    const res = await api.loadBundle(filename, true);
    _applyReset(set, res);
  },
  async saveWalk(name) {
    const res = await api.saveWalk(name);
    if (res?.artifacts) set({ storage: res.artifacts });
  },
  async loadWalk(filename) {
    const res = await api.loadWalk(filename);
    if (res?.state) set({ walk: res.state });
    if (res?.report) set({ report: res.report });
  },
  async resetWalk() {
    const res = await api.resetSiteWalk();
    _applyReset(set, res);
  },

  // ── floorplan & calibration ───────────────────────────────────────────
  setFloorplan(img, name) {
    set({ floorplan: img, floorplanName: name });
  },
  setCalibrationPoint(point, coords) {
    set((s) => ({
      calibration: { ...s.calibration, [point]: coords },
    }));
  },
  computeCalibration() {
    const { calibration } = get();
    const { pointA, pointB, knownDistanceM } = calibration;
    if (!pointA || !pointB) return;
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    if (pixelDist < 5) return;
    set((s) => ({
      calibration: {
        ...s.calibration,
        metersPerPixel: knownDistanceM / pixelDist,
      },
    }));
  },
  setCalibrationDistance(m) {
    set((s) => ({ calibration: { ...s.calibration, knownDistanceM: m } }));
  },
  clearCalibration() {
    set((s) => ({
      calibration: {
        ...s.calibration,
        pointA: null,
        pointB: null,
        metersPerPixel: null,
      },
    }));
  },

  // ── local UI setters ──────────────────────────────────────────────────
  setWalkInterval(v) {
    set({ walkInterval: v });
  },
  setStepLen(v) {
    set({ stepLen: v });
  },
  setWalkLabel(v) {
    set({ walkLabel: v });
  },
  setCheckpointDraft(id, val) {
    set((s) => ({ checkpointDrafts: { ...s.checkpointDrafts, [id]: val } }));
  },
  clearCheckpointDraft(id) {
    set((s) => {
      const d = { ...s.checkpointDrafts };
      delete d[id];
      return { checkpointDrafts: d };
    });
  },
}));

function _applyReset(set, res) {
  if (!res) return;
  if (res.walk_state) set({ walk: res.walk_state });
  if (res.walk_report) set({ report: res.walk_report });
  if (res.localize_state) set({ localize: res.localize_state });
  if (res.references) set({ references: res.references });
}
