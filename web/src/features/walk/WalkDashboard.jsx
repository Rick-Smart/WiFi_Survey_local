import { useEffect, useState, useCallback } from "react";
import { useWalkStore } from "../../store/useWalkStore.js";
import { WalkSidebar } from "./WalkSidebar.jsx";
import { WalkMap } from "./WalkMap.jsx";
import { CheckpointList } from "./CheckpointList.jsx";
import { StoragePanel } from "./StoragePanel.jsx";
import styles from "./WalkDashboard.module.css";

const POLL_MS = 2500;

export function WalkDashboard() {
  const refreshAll = useWalkStore((s) => s.refreshAll);
  const fetchMobile = useWalkStore((s) => s.fetchMobile);
  const fetchLocalize = useWalkStore((s) => s.fetchLocalize);
  const fetchLive = useWalkStore((s) => s.fetchLive);
  const setFloorplan = useWalkStore((s) => s.setFloorplan);
  const setCalPt = useWalkStore((s) => s.setCalibrationPoint);
  const walkActive = useWalkStore((s) => !!s.walk?.active);

  // Which calibration point to place on next canvas click: null | "A" | "B"
  const [calibratingPoint, setCalibratingPoint] = useState(null);

  // Boot: fetch everything once
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Poll server state while on this tab
  useEffect(() => {
    const tick = async () => {
      await Promise.allSettled([
        fetchLocalize(),
        fetchMobile(),
        walkActive ? fetchLive() : Promise.resolve(),
      ]);
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [fetchLocalize, fetchMobile, fetchLive, walkActive]);

  // Re-fetch walk state after each walk action
  const fetchWalk = useWalkStore((s) => s.fetchWalk);
  const fetchReport = useWalkStore((s) => s.fetchReport);
  useEffect(() => {
    if (walkActive) {
      const id = setInterval(() => {
        fetchWalk();
        fetchReport();
      }, POLL_MS);
      return () => clearInterval(id);
    }
  }, [walkActive, fetchWalk, fetchReport]);

  const handleFloorplanLoad = useCallback(
    (img, name) => {
      setFloorplan(img, name);
    },
    [setFloorplan],
  );

  const handleCalibrateToggle = useCallback((point) => {
    setCalibratingPoint((p) => (p === point ? null : point));
  }, []);

  const handleCalibrationClick = useCallback(
    (coords) => {
      if (!calibratingPoint) return;
      setCalPt(calibratingPoint === "A" ? "pointA" : "pointB", coords);
      setCalibratingPoint(null);
    },
    [calibratingPoint, setCalPt],
  );

  return (
    <div className={styles.layout}>
      <WalkSidebar
        onFloorplanLoad={handleFloorplanLoad}
        calibratingPoint={calibratingPoint}
        onCalibrateToggle={handleCalibrateToggle}
      />
      <main className={styles.main}>
        {/* Map */}
        <div className={styles.mapWrap}>
          <WalkMap
            onCalibrationClick={
              calibratingPoint ? handleCalibrationClick : null
            }
          />
          {calibratingPoint && (
            <div className={styles.calBanner}>
              Click on the map to place calibration point{" "}
              <strong>{calibratingPoint}</strong>
              <button
                className={styles.calCancel}
                onClick={() => setCalibratingPoint(null)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Checkpoint list + Storage */}
        <div className={styles.lower}>
          <div className={styles.checkpointCard}>
            <div className={styles.cardHead}>Checkpoints</div>
            <CheckpointList />
          </div>
          <div className={styles.storageCard}>
            <StoragePanel />
          </div>
        </div>
      </main>
    </div>
  );
}
