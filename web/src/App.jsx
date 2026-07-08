import { useEffect } from "react";
import { ThemeProvider } from "./theme/ThemeProvider.jsx";
import { Header } from "./layout/Header.jsx";
import { ScanDashboard } from "./features/scan/ScanDashboard.jsx";
import { useAppStore } from "./store/useAppStore.js";

export default function App() {
  const loadModules = useAppStore((s) => s.loadModules);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  return (
    <ThemeProvider>
      <Header />
      <ScanDashboard />
    </ThemeProvider>
  );
}
