import { useAppStore } from "../../store/useAppStore.js";
import { HealthScore } from "./HealthScore.jsx";
import styles from "./ModuleSidebar.module.css";

const CATEGORY_ORDER = ["connection", "rf", "security", "network", "advanced"];
const CATEGORY_LABELS = {
  connection: "Connection",
  rf: "RF & Radio",
  security: "Security",
  network: "Network",
  advanced: "Advanced",
};

// Groups modules in the canonical category order, falling back to first-seen.
function groupByCategory(modules) {
  const map = new Map();
  for (const m of modules) {
    const cat = m.category || "other";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(m);
  }
  const ordered = [];
  for (const cat of CATEGORY_ORDER) {
    if (map.has(cat)) {
      ordered.push([cat, map.get(cat)]);
      map.delete(cat);
    }
  }
  for (const [cat, mods] of map) ordered.push([cat, mods]);
  return ordered;
}

function Toggle({ checked, onChange }) {
  return (
    <label className={styles.toggle} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className={styles.slider} />
    </label>
  );
}

export function ModuleSidebar() {
  const modules = useAppStore((s) => s.modules);
  const enabled = useAppStore((s) => s.enabled);
  const results = useAppStore((s) => s.results);
  const toggleModule = useAppStore((s) => s.toggleModule);

  const groups = groupByCategory(modules);

  const statusOf = (id) => {
    const r = results[id];
    if (r === null) return "running";
    if (!r) return "";
    return r.status || "ok";
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>Scan Modules</div>
      {groups.map(([cat, mods]) => (
        <div key={cat}>
          <div className={styles.section}>{CATEGORY_LABELS[cat] ?? cat}</div>
          {mods.map((m) => (
            <div
              key={m.id}
              className={styles.item}
              onClick={() => toggleModule(m.id)}
              data-active={enabled.has(m.id) || undefined}
            >
              <Toggle
                checked={enabled.has(m.id)}
                onChange={() => toggleModule(m.id)}
              />
              <div className={styles.info}>
                <div className={styles.name}>{m.name}</div>
                <div className={styles.desc}>{m.description}</div>
              </div>
              <span
                className={styles.dot}
                data-status={statusOf(m.id) || undefined}
              />
            </div>
          ))}
        </div>
      ))}
      <HealthScore results={results} />
    </aside>
  );
}
