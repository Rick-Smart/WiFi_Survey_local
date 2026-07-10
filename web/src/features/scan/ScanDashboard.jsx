import { useAppStore } from "../../store/useAppStore.js";
import { ResultsGrid } from "../../components/ResultsGrid.jsx";
import { ModuleCard } from "./ModuleCard.jsx";
import { ModuleSidebar } from "./ModuleSidebar.jsx";
import styles from "./ScanDashboard.module.css";

function Welcome() {
  return (
    <div className={styles.welcome}>
      <div className={styles.wIcon}>RF</div>
      <h2>WiFi Engineer Survey</h2>
      <p>
        Select the scan modules you want to run using the toggles on the left,
        then click <b>Run All</b> or <b>Run Selected</b>.
      </p>
      <div className={styles.shortcut}>
        Results open automatically · Most scans run offline
      </div>
    </div>
  );
}

export function ScanDashboard() {
  const modules = useAppStore((s) => s.modules);
  const results = useAppStore((s) => s.results);
  const durations = useAppStore((s) => s.durations);
  const status = useAppStore((s) => s.status);
  const setAll = useAppStore((s) => s.setAll);

  // Preserve module order from the backend; only show those with a result slot.
  const shown = modules.filter((m) => m.id in results);
  const hasResults = shown.length > 0;

  return (
    <div className={styles.layout}>
      <ModuleSidebar />
      <main className={styles.main}>
        <div className={styles.toolbar}>
          <span className={styles.title}>{status.text}</span>
          <button className={styles.ghost} onClick={() => setAll(true)}>
            All
          </button>
          <button className={styles.ghost} onClick={() => setAll(false)}>
            None
          </button>
        </div>
        {hasResults ? (
          <ResultsGrid>
            {shown.map((m) => (
              <ModuleCard
                key={m.id}
                id={m.id}
                name={m.name}
                hint={m.hint}
                result={results[m.id]}
                duration={durations[m.id]}
              />
            ))}
          </ResultsGrid>
        ) : (
          <div className={styles.center}>
            <Welcome />
          </div>
        )}
      </main>
    </div>
  );
}
