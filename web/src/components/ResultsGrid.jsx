import styles from "./ResultsGrid.module.css";

/**
 * ResultsGrid — a fluid, responsive card grid.
 *
 * Columns auto-fit to the available width (1 → N) with no breakpoints, and
 * `grid-auto-rows: max-content` guarantees each row is exactly as tall as its
 * card's content — so cards never stretch-and-clip or overlap regardless of
 * how much data they contain. The whole grid scrolls internally.
 */
export function ResultsGrid({ children, min = 460 }) {
  return (
    <div className={styles.scroll}>
      <div className={styles.cols} style={{ "--card-min": `${min}px` }}>
        {children}
      </div>
    </div>
  );
}
