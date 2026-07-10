import { useState } from "react";
import { useWalkStore } from "../../store/useWalkStore.js";
import styles from "./StoragePanel.module.css";

function ArtifactSelect({ items, emptyText, onChange }) {
  if (!items?.length) {
    return <span className={styles.empty}>{emptyText}</span>;
  }
  return (
    <select
      className={styles.select}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {items.map((a) => {
        const kb = Math.max(1, Math.round((a.size_bytes || 0) / 1024));
        return (
          <option key={a.filename} value={a.filename}>
            {a.filename} · {kb} KB · {a.modified_at || ""}
          </option>
        );
      })}
    </select>
  );
}

export function StoragePanel() {
  const store = useWalkStore();
  const storage = store.storage || {};
  const [bundleName, setBundleName] = useState("");
  const [selectedBundle, setSelectedBundle] = useState("");
  const [selectedWalk, setSelectedWalk] = useState("");

  return (
    <div className={styles.panel}>
      <div className={styles.sectionTitle}>Persistence / Backup</div>

      {/* Save bundle */}
      <div className={styles.group}>
        <label className={styles.label}>Save bundle (walk + references)</label>
        <div className={styles.row}>
          <input
            className={styles.input}
            placeholder="Bundle name…"
            value={bundleName}
            onChange={(e) => setBundleName(e.target.value)}
          />
          <button
            className={styles.btnGhost}
            onClick={() => {
              store.saveBundle(bundleName);
              setBundleName("");
            }}
          >
            Save
          </button>
        </div>
      </div>

      {/* Load bundle */}
      <div className={styles.group}>
        <label className={styles.label}>Load bundle</label>
        <div className={styles.row}>
          <ArtifactSelect
            items={storage.bundles}
            emptyText="No saved bundles"
            onChange={setSelectedBundle}
          />
          <button
            className={styles.btnGhost}
            disabled={!selectedBundle}
            onClick={() => store.loadBundle(selectedBundle)}
          >
            Load
          </button>
        </div>
      </div>

      {/* Load walk */}
      <div className={styles.group}>
        <label className={styles.label}>Load walk session</label>
        <div className={styles.row}>
          <ArtifactSelect
            items={storage.walks}
            emptyText="No saved walks"
            onChange={setSelectedWalk}
          />
          <button
            className={styles.btnGhost}
            disabled={!selectedWalk}
            onClick={() => store.loadWalk(selectedWalk)}
          >
            Load
          </button>
        </div>
      </div>

      {/* Reset */}
      <div className={styles.group}>
        <button
          className={styles.btnDanger}
          onClick={() => {
            if (window.confirm("Reset all walk and localization data?")) {
              store.resetWalk();
            }
          }}
        >
          Reset Session
        </button>
      </div>
    </div>
  );
}
