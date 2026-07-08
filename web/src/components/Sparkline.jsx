import styles from "./Sparkline.module.css";

/** Sparkline — inline mini bar chart for a series of numbers (e.g. RTTs). */
export function Sparkline({ values }) {
  if (!values || !values.length) return null;
  const max = Math.max(...values, 1);
  return (
    <span className={styles.spark}>
      {values.map((v, i) => (
        <span
          key={i}
          style={{ height: `${Math.max(2, Math.round((v / max) * 18))}px` }}
        />
      ))}
    </span>
  );
}
