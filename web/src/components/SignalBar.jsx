import styles from "./SignalBar.module.css";

// Maps dBm (~ -100…-50) to a 0–100% fill and a quality color token.
function dbmToPct(dbm) {
  return Math.max(0, Math.min(100, Math.round(((dbm + 100) / 50) * 100)));
}
function dbmColor(dbm) {
  if (dbm >= -60) return "var(--quality-excellent)";
  if (dbm >= -70) return "var(--quality-fair)";
  if (dbm >= -80) return "var(--quality-poor)";
  return "var(--quality-critical)";
}

/** SignalBar — full-width fluid signal strength meter. */
export function SignalBar({ dbm, label }) {
  if (dbm == null) return null;
  const pct = dbmToPct(dbm);
  return (
    <div className={styles.wrap}>
      <span className={styles.cap}>Signal</span>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{ width: `${pct}%`, background: dbmColor(dbm) }}
        />
      </div>
      <span className={styles.val}>{label ?? `${dbm} dBm`}</span>
    </div>
  );
}
