import styles from "./Gauge.module.css";

/**
 * Gauge — a circular percentage ring (used for PHY efficiency, etc.).
 * Scales fluidly with the card via clamp()-based sizing in CSS.
 */
export function Gauge({ value, label, color }) {
  if (value == null) return null;
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = ((value / 100) * circ).toFixed(1);
  const stroke = color || "var(--accent)";
  return (
    <div className={styles.gauge}>
      <svg viewBox="0 0 80 80" className={styles.svg} aria-hidden>
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth="6"
        />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className={styles.center}>
        <div className={styles.val} style={{ color: stroke }}>
          {value}%
        </div>
        {label && <div className={styles.lbl}>{label}</div>}
      </div>
    </div>
  );
}
