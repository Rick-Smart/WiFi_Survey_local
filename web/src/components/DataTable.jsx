import styles from "./DataTable.module.css";

/**
 * DataTable — a generic, horizontally-scrollable table.
 *
 * columns: [{ key, header, align?, mono?, nowrap?, render?(row), color?(row) }]
 * rows:    array of row objects
 *
 * The wrapper scrolls on both axes so wide tables (AP lists, latency) stay
 * fully readable inside any card width, with an optional internal max height.
 */
export function DataTable({ columns, rows, rowKey, rowClass, maxHeight }) {
  return (
    <div className={styles.wrap} style={maxHeight ? { maxHeight } : undefined}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align || "left" }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : i}
              className={rowClass ? rowClass(row) : undefined}
            >
              {columns.map((c) => {
                const content = c.render ? c.render(row) : row[c.key];
                return (
                  <td
                    key={c.key}
                    className={`${c.mono ? styles.mono : ""} ${c.nowrap ? styles.nowrap : ""}`}
                    style={{
                      textAlign: c.align || "left",
                      color: c.color ? c.color(row) : undefined,
                    }}
                  >
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
