import { statusVar, qualityVar } from "../theme/themes.js";
import styles from "./Badge.module.css";

/**
 * Badge — a small status/quality pill. Color comes from theme tokens via
 * either `status` (ok/warning/error/running) or `quality` (excellent…critical).
 */
export function Badge({ children, status, quality, running }) {
  const color = quality
    ? qualityVar(quality)
    : statusVar(running ? "running" : status);
  return (
    <span
      className={styles.badge}
      data-running={running || status === "running" || undefined}
      style={{ "--badge-color": color }}
    >
      {children}
    </span>
  );
}
