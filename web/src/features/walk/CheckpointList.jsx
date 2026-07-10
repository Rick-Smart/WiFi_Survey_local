import { useState } from "react";
import { useWalkStore } from "../../store/useWalkStore.js";
import styles from "./CheckpointList.module.css";

export function CheckpointList() {
  const checkpoints = useWalkStore((s) => s.walk?.checkpoints || []);
  const drafts = useWalkStore((s) => s.checkpointDrafts);
  const setDraft = useWalkStore((s) => s.setCheckpointDraft);
  const clearDraft = useWalkStore((s) => s.clearCheckpointDraft);
  const renameCheckpoint = useWalkStore((s) => s.renameCheckpoint);

  if (!checkpoints.length) {
    return (
      <div className={styles.empty}>
        No checkpoints yet — tag a point while walking.
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {checkpoints.map((cp) => {
        const draft = drafts[cp.id];
        const display = draft != null ? draft : cp.label || "";
        return (
          <div key={cp.id} className={styles.item}>
            <span className={styles.id}>#{cp.id}</span>
            <input
              className={styles.input}
              value={display}
              onChange={(e) => setDraft(cp.id, e.target.value)}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val !== cp.label) renameCheckpoint(cp.id, val);
                else clearDraft(cp.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.target.blur();
                if (e.key === "Escape") {
                  clearDraft(cp.id);
                  e.target.blur();
                }
              }}
            />
            {cp.signal_dbm != null && (
              <span className={styles.signal}>{cp.signal_dbm} dBm</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
