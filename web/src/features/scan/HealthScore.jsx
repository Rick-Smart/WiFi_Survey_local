import { computeHealthScore } from "./healthScore.js";
import styles from "./HealthScore.module.css";

/**
 * HealthScore — the "Overall Health" ring + per-factor bars. Renders nothing
 * until enough scan results exist to compute a score.
 */
export function HealthScore({ results }) {
  const health = computeHealthScore(results);
  if (!health) return null;

  const { score, grade, label, color, parts } = health;

  return (
    <div className={styles.widget}>
      <div className={styles.heading}>Overall Health</div>
      <div className={styles.ring} style={{ borderColor: color }}>
        <span className={styles.num} style={{ color }}>
          {score}
        </span>
        <span className={styles.grade} style={{ color }}>
          {grade}
        </span>
        <span className={styles.label}>{label}</span>
      </div>
      <div className={styles.bars}>
        {parts.map((p) => {
          const fill =
            p.pct >= 80
              ? "var(--green)"
              : p.pct >= 55
                ? "var(--yellow)"
                : "var(--red)";
          return (
            <div key={p.key} className={styles.barRow}>
              <span className={styles.barLabel}>{p.key}</span>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ width: `${p.pct}%`, background: fill }}
                />
              </div>
              <span className={styles.barVal}>
                {p.val}/{p.max}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
