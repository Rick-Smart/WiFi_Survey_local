import { create } from "zustand";
import { getModules, runModule } from "../api/client.js";

// ── Global app state ─────────────────────────────────────────────────────
// A single lean store mirroring the old vanilla `state` object, minus the
// manual DOM syncing. Components subscribe to just the slices they use.

export const useAppStore = create((set, get) => ({
  modules: [], // [{ id, name, description, category, default_enabled, tags }]
  enabled: new Set(), // ids of enabled modules
  results: {}, // id -> result object (or null while scanning)
  durations: {}, // id -> ms
  running: false,
  aborted: false,
  status: { text: "Loading modules…", tone: "running" },

  async loadModules() {
    try {
      const modules = await getModules();
      const enabled = new Set(
        modules.filter((m) => m.default_enabled).map((m) => m.id),
      );
      set({ modules, enabled, status: { text: "Ready", tone: "idle" } });
    } catch (e) {
      set({
        status: { text: `Failed to load modules: ${e.message}`, tone: "error" },
      });
    }
  },

  toggleModule(id) {
    const enabled = new Set(get().enabled);
    enabled.has(id) ? enabled.delete(id) : enabled.add(id);
    set({ enabled });
  },

  setAll(on) {
    set({ enabled: on ? new Set(get().modules.map((m) => m.id)) : new Set() });
  },

  // Runs the given ids sequentially so the backend (and the UI) update one
  // module at a time — matches how the scanner is meant to be driven.
  async runIds(ids) {
    if (!ids.length || get().running) return;
    // Seed loading placeholders so cards render skeletons immediately.
    const seeded = {};
    ids.forEach((id) => (seeded[id] = null));
    set({
      running: true,
      aborted: false,
      results: seeded,
      durations: {},
      status: { text: `Running ${ids.length} scans…`, tone: "running" },
    });

    let done = 0;
    for (const id of ids) {
      if (get().aborted) break;
      const t0 = performance.now();
      try {
        const result = await runModule(id);
        const ms = performance.now() - t0;
        set((s) => ({
          results: { ...s.results, [id]: result },
          durations: { ...s.durations, [id]: ms },
          status: {
            text: `Running — ${++done} / ${ids.length}`,
            tone: "running",
          },
        }));
      } catch (e) {
        set((s) => ({
          results: {
            ...s.results,
            [id]: { status: "error", error: e.message },
          },
          status: {
            text: `Running — ${++done} / ${ids.length}`,
            tone: "running",
          },
        }));
      }
    }

    const aborted = get().aborted;
    set({
      running: false,
      status: aborted
        ? { text: "Stopped", tone: "idle" }
        : { text: "All scans complete", tone: "done" },
    });
  },

  runAll() {
    return get().runIds(get().modules.map((m) => m.id));
  },

  runSelected() {
    const enabled = get().enabled;
    return get().runIds(
      get()
        .modules.filter((m) => enabled.has(m.id))
        .map((m) => m.id),
    );
  },

  stop() {
    set({ aborted: true });
  },
}));
