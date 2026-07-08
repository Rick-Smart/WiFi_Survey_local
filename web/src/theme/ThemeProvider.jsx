import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
} from "react";
import { themes, structural, defaultThemeId } from "./themes.js";

const ThemeContext = createContext(null);

// Flattens structural tokens + the active theme's palette into one style
// object of CSS custom properties, applied to a wrapper element. Because
// everything is a CSS variable, switching themes is instant and every
// component that reads var(--…) updates with zero re-render cost.
function buildVars(themeId) {
  const theme = themes[themeId] || themes[defaultThemeId];
  return { ...structural, ...theme.vars };
}

export function ThemeProvider({ children, initialTheme = defaultThemeId }) {
  const [themeId, setThemeId] = useState(initialTheme);

  const setTheme = useCallback((id) => {
    if (themes[id]) setThemeId(id);
  }, []);

  const value = useMemo(
    () => ({
      themeId,
      theme: themes[themeId] || themes[defaultThemeId],
      themes,
      setTheme,
    }),
    [themeId, setTheme],
  );

  const styleVars = useMemo(() => buildVars(themeId), [themeId]);

  return (
    <ThemeContext.Provider value={value}>
      <div
        className="app-theme-root"
        data-theme={themeId}
        data-scheme={value.theme.scheme}
        style={styleVars}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
