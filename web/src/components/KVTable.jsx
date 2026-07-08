import { qualityVar } from "../theme/themes.js";
import styles from "./KVTable.module.css";

/**
 * KVTable — key/value rows. Accepts `rows` as [key, value, opts?] tuples.
 * Null/empty values are skipped automatically. The value column is fluid and
 * wraps/breaks long strings (MACs, GUIDs) so nothing is clipped.
 *
 * opts: { mono?: boolean, quality?: 'excellent'|'good'|'fair'|'poor'|'critical' }
 */
export function KVTable({ rows }) {
  const visible = rows.filter(
    ([, v]) => v != null && v !== "" && v !== "null" && v !== "undefined",
  );
  if (!visible.length) return null;
  return (
    <table className={styles.table}>
      <tbody>
        {visible.map(([key, value, opts = {}], i) => (
          <tr key={i}>
            <td className={styles.key}>{key}</td>
            <td
              className={`${styles.val} ${opts.mono ? styles.mono : ""}`}
              style={
                opts.quality ? { color: qualityVar(opts.quality) } : undefined
              }
            >
              {String(value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
