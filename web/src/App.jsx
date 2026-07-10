import { useState, useEffect } from "react";
import { ThemeProvider } from "./theme/ThemeProvider.jsx";
import { Header } from "./layout/Header.jsx";
import { ScanDashboard } from "./features/scan/ScanDashboard.jsx";
import { WalkDashboard } from "./features/walk/WalkDashboard.jsx";
import { useAppStore } from "./store/useAppStore.js";

export default function App() {
  const loadModules = useAppStore((s) => s.loadModules);
  const [activeTab, setActiveTab] = useState("scan");

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  return (
    <ThemeProvider>
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      {activeTab === "scan" ? <ScanDashboard /> : <WalkDashboard />}
    </ThemeProvider>
  );
}
