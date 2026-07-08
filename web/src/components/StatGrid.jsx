import styles from "./StatGrid.module.css";

/**
 * StatGrid — responsive key/value stat cells.
 *
 * items: [{ label, value, color? }]
 *
 * Uses a container query on the card width: 1 column on narrow cards, 2 on
 * medium, 3 on wide — so the same grid reflows to whatever space it's given.
 */
export function StatGrid({ items }) {
  return (
    <div className={styles.grid}>
      {items.map((it, i) => (
        <div className={styles.item} key={i}>
          <div className={styles.label}>{it.label}</div>
          <div
            className={styles.value}
            style={it.color ? { color: it.color } : undefined}
          >
            {it.value ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}
