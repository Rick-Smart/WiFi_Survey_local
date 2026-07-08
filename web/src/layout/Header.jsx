import { useAppStore } from "../store/useAppStore.js";
import { useTheme } from "../theme/ThemeProvider.jsx";
import styles from "./Header.module.css";

export function Header() {
  const running = useAppStore((s) => s.running);
  const status = useAppStore((s) => s.status);
  const runAll = useAppStore((s) => s.runAll);
  const runSelected = useAppStore((s) => s.runSelected);
  const stop = useAppStore((s) => s.stop);
  const enabledCount = useAppStore((s) => s.enabled.size);
  const { themeId, themes, setTheme } = useTheme();

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <span className={styles.icon}>WS</span>
        WiFi Survey Pro
        <span className={styles.badge}>ENGINEER</span>
      </div>

      <div className={styles.sep} />

      <div className={styles.status}>
        <span className={styles.dot} data-tone={status.tone} />
        <span>{status.text}</span>
      </div>

      <select
        className={styles.theme}
        value={themeId}
        onChange={(e) => setTheme(e.target.value)}
        title="Theme"
      >
        {Object.values(themes).map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      {running ? (
        <button className={styles.secondary} onClick={stop}>
          Stop
        </button>
      ) : (
        <>
          <button
            className={styles.secondary}
            onClick={runSelected}
            disabled={enabledCount === 0}
          >
            Run Selected
          </button>
          <button className={styles.primary} onClick={runAll}>
            Run All
          </button>
        </>
      )}
    </header>
  );
}
