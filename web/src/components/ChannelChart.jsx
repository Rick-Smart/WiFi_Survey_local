import styles from "./ChannelChart.module.css";

/**
 * ChannelChart — bar chart of AP counts per channel. Bars scale to the
 * tallest column; the row scrolls horizontally when there are many channels,
 * so it fits any card width.
 *
 * chMap: { [channel]: count }
 */
export function ChannelChart({ label, chMap, myChannel, nonOverlapping = [] }) {
  const channels = Object.keys(chMap)
    .map(Number)
    .sort((a, b) => a - b);
  if (!channels.length) return null;
  const maxCnt = Math.max(...Object.values(chMap), 1);

  const barColor = (ch, cnt) => {
    if (ch === myChannel) return "var(--accent)";
    if (cnt > 4) return "var(--quality-critical)";
    if (cnt > 2) return "var(--quality-fair)";
    return "var(--quality-excellent)";
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.legend}>
        <span>{label} Channels</span>
        <span className={styles.key}>
          <i style={{ color: "var(--accent)" }}>■</i> yours
          <i style={{ color: "var(--quality-excellent)" }}>■</i> low
          <i style={{ color: "var(--quality-fair)" }}>■</i> moderate
          <i style={{ color: "var(--quality-critical)" }}>■</i> heavy
          {nonOverlapping.length ? (
            <span className={styles.star}>★ = non-overlapping</span>
          ) : null}
        </span>
      </div>
      <div className={styles.chart}>
        {channels.map((ch) => {
          const cnt = chMap[ch];
          const h = Math.max(Math.round((cnt / maxCnt) * 64), 4);
          const isNo = nonOverlapping.includes(ch);
          return (
            <div
              className={styles.barWrap}
              key={ch}
              title={`${cnt} AP${cnt !== 1 ? "s" : ""} on ch${ch}${isNo ? " (non-overlapping)" : ""}${
                ch === myChannel ? " — YOUR CHANNEL" : ""
              }`}
            >
              <span className={styles.cnt}>{cnt}</span>
              <div
                className={styles.bar}
                data-mine={ch === myChannel || undefined}
                style={{ height: `${h}px`, background: barColor(ch, cnt) }}
              />
              <span className={styles.lbl}>
                Ch{ch}
                {isNo ? "★" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
