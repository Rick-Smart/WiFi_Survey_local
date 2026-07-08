import { Card } from "../../components/Card.jsx";
import { Badge } from "../../components/Badge.jsx";
import { ModuleBody } from "./moduleBodies.jsx";
import styles from "./ModuleCard.module.css";

const MODULE_ICONS = {
  interface: "IF",
  ipconfig: "IP",
  security: "SEC",
  channel_survey: "RF",
  latency: "LAT",
  dns: "DNS",
  statistics: "PKT",
  driver: "DRV",
  phy_rate: "PHY",
};

function Skeleton() {
  return (
    <div className={styles.skeleton}>
      <span style={{ width: "70%" }} />
      <span style={{ width: "50%" }} />
      <span style={{ width: "85%" }} />
    </div>
  );
}

function Warnings({ items }) {
  if (!items?.length) return null;
  return (
    <div className={styles.warnings}>
      {items.map((w, i) => (
        <div className={styles.warn} key={i}>
          {w}
        </div>
      ))}
    </div>
  );
}

function Recommendations({ items }) {
  if (!items?.length) return null;
  return (
    <div className={styles.recs}>
      {items.map((r, i) => {
        const ci = r.indexOf(":");
        const tag = ci > 0 ? r.slice(0, ci) : "";
        const rest = ci > 0 ? r.slice(ci + 1).trim() : r;
        return (
          <div className={styles.rec} key={i}>
            {tag && <span className={styles.recTag}>{tag}</span>}
            {rest}
          </div>
        );
      })}
    </div>
  );
}

export function ModuleCard({ id, name, result, duration }) {
  const icon = MODULE_ICONS[id] || "MOD";

  // Still scanning
  if (!result) {
    return (
      <Card>
        <Card.Head
          icon={icon}
          title={name}
          badge={<Badge running>SCANNING…</Badge>}
        />
        <Card.Body>
          <Skeleton />
        </Card.Body>
      </Card>
    );
  }

  const status = result.status || "ok";
  const durStr = duration ? `${(duration / 1000).toFixed(1)}s` : undefined;

  return (
    <Card collapsible expandable>
      <Card.Head
        icon={icon}
        title={name}
        meta={durStr}
        badge={<Badge status={status}>{status.toUpperCase()}</Badge>}
      />
      <Card.Body>
        {status === "error" ? (
          <div className={styles.error}>{result.error || "Unknown error"}</div>
        ) : (
          <>
            <Warnings items={result.warnings} />
            <ModuleBody id={id} data={result.data} />
            <Recommendations items={result.recommendations} />
          </>
        )}
      </Card.Body>
    </Card>
  );
}
