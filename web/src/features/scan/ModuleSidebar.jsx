import { useAppStore } from "../../store/useAppStore.js";
import styles from "./ModuleSidebar.module.css";

// Groups modules by their `category` field, preserving first-seen order.
function groupByCategory(modules) {
  const groups = [];
  const index = new Map();
  for (const m of modules) {
    const cat = m.category || "Other";
    if (!index.has(cat)) {
      index.set(cat, groups.length);
      groups.push([cat, []]);
    }
    groups[index.get(cat)][1].push(m);
  }
  return groups;
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
          <div className={styles.section}>{cat}</div>
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
    </aside>
  );
}
