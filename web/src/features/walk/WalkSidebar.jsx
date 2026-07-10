import { useRef } from "react";
import { useWalkStore } from "../../store/useWalkStore.js";
import { getServerInfo } from "../../api/client.js";
import styles from "./WalkSidebar.module.css";

// ── Helpers ────────────────────────────────────────────────────────────────

function Section({ title, children, emphasis, muted }) {
  return (
    <div
      className={`${styles.section}
        ${emphasis ? styles.emphasis : ""}
        ${muted ? styles.muted : ""}`}
    >
      <div className={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }) {
  return <div className={styles.row}>{children}</div>;
}

function Help({ children }) {
  return <div className={styles.help}>{children}</div>;
}

// ── Workflow guide ─────────────────────────────────────────────────────────

function WorkflowGuide({ hasRef, refActive, replayActive, confidence }) {
  const steps = [
    { key: "setup", label: "1. Configure" },
    { key: "reference", label: "2. Build Reference" },
    { key: "replay", label: "3. Replay / Estimate" },
    { key: "review", label: "4. Review / Export" },
  ];

  let currentStep, nextText;
  if (refActive) {
    currentStep = "reference";
    nextText =
      "Keep walking the reference route until the fingerprint set is complete.";
  } else if (replayActive) {
    currentStep = "replay";
    nextText =
      confidence >= 70
        ? "Review the estimate and export the survey when ready."
        : "Slow down or pause to improve replay confidence.";
  } else if (hasRef) {
    currentStep = "replay";
    nextText = "Start replay mode to estimate position from the reference set.";
  } else {
    currentStep = "setup";
    nextText =
      "Record a reference walk so replay mode has something to match against.";
  }

  return (
    <div className={styles.workflow}>
      <div className={styles.workflowSteps}>
        {steps.map((s) => (
          <div
            key={s.key}
            className={`${styles.wfStep}
              ${s.key === currentStep ? styles.wfCurrent : ""}
              ${s.key === "replay" && !hasRef && !replayActive ? styles.wfMuted : ""}`}
          >
            {s.label}
          </div>
        ))}
      </div>
      <div className={styles.workflowNext}>{nextText}</div>
    </div>
  );
}

// ── Main sidebar ───────────────────────────────────────────────────────────

export function WalkSidebar({
  onFloorplanLoad,
  calibratingPoint,
  onCalibrateToggle,
}) {
  const store = useWalkStore();
  const fileRef = useRef(null);
  const mobileUrlRef = useRef(null);

  const walk = store.walk || {};
  const localize = store.localize || {};
  const references = store.references || [];
  const mobile = store.mobile || {};

  const walkActive = !!walk.active;
  const refActive = !!localize.reference?.active;
  const replayActive = !!localize.replay?.active;
  const hasRef = references.length > 0;
  const est = localize.replay?.latest_estimate;
  const confidence = est ? Number(est.confidence || 0) : null;

  async function handleCopyUrl() {
    const url = mobileUrlRef.current?.value || "";
    if (url) {
      try {
        await navigator.clipboard.writeText(url);
      } catch (_) {
        mobileUrlRef.current?.select();
      }
    }
  }

  async function handleLoadMobileUrl() {
    try {
      const info = await getServerInfo();
      const url =
        (info.mobile_urls || [])[0] || `${window.location.origin}/mobile`;
      if (mobileUrlRef.current) mobileUrlRef.current.value = url;
    } catch (_) {}
  }

  function handleFloorplanChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => onFloorplanLoad?.(img, file.name);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  return (
    <aside className={styles.sidebar}>
      {/* ── Workflow ── */}
      <WorkflowGuide
        hasRef={hasRef}
        refActive={refActive}
        replayActive={replayActive}
        confidence={confidence}
      />

      {/* ── Setup ── */}
      <Section title="Setup">
        <Row>
          <label>Sample every (s)</label>
          <input
            type="number"
            min="0.5"
            step="0.5"
            className={styles.numInput}
            value={store.walkInterval}
            onChange={(e) => store.setWalkInterval(Number(e.target.value))}
          />
        </Row>
        <Row>
          <label>Step length (m)</label>
          <input
            type="number"
            min="0.1"
            step="0.1"
            className={styles.numInput}
            value={store.stepLen}
            onChange={(e) => store.setStepLen(Number(e.target.value))}
          />
        </Row>

        {/* Mobile URL */}
        <Help>
          Open the mobile helper on your phone to stream heading &amp; steps.
        </Help>
        <Row>
          <input
            ref={mobileUrlRef}
            type="text"
            readOnly
            className={styles.urlInput}
            placeholder="Mobile helper URL…"
            onClick={handleLoadMobileUrl}
          />
        </Row>
        <Row>
          <button className={styles.btnGhost} onClick={handleLoadMobileUrl}>
            Load URL
          </button>
          <button className={styles.btnGhost} onClick={handleCopyUrl}>
            Copy
          </button>
          <button
            className={styles.btnGhost}
            onClick={() => window.open(mobileUrlRef.current?.value, "_blank")}
          >
            Open
          </button>
        </Row>
        <div className={styles.mobileStatus}>
          Phone:{" "}
          <span className={mobile.connected ? styles.on : styles.off}>
            {mobile.connected ? "connected" : "not connected"}
          </span>
        </div>

        {/* Floorplan */}
        <Help style={{ marginTop: 10 }}>
          Optional: load a floorplan image to overlay the route.
        </Help>
        <Row>
          <button
            className={styles.btnGhost}
            onClick={() => fileRef.current?.click()}
          >
            {store.floorplanName || "Load Floorplan…"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFloorplanChange}
          />
          {store.floorplan && (
            <button
              className={styles.btnGhost}
              onClick={() => store.setFloorplan(null, "")}
            >
              Clear
            </button>
          )}
        </Row>
        {store.floorplan && (
          <>
            <Row>
              <button
                className={
                  calibratingPoint === "A" ? styles.btnPrimary : styles.btnGhost
                }
                onClick={() => onCalibrateToggle?.("A")}
              >
                Set A
              </button>
              <button
                className={
                  calibratingPoint === "B" ? styles.btnPrimary : styles.btnGhost
                }
                onClick={() => onCalibrateToggle?.("B")}
              >
                Set B
              </button>
              <input
                type="number"
                min="1"
                step="1"
                className={styles.numInput}
                value={store.calibration.knownDistanceM}
                onChange={(e) =>
                  store.setCalibrationDistance(Number(e.target.value))
                }
                title="Known A→B distance in metres"
              />
              <span className={styles.unit}>m</span>
              <button
                className={styles.btnGhost}
                onClick={store.computeCalibration}
              >
                Calibrate
              </button>
            </Row>
            {store.calibration.metersPerPixel && (
              <div className={styles.calStatus}>
                ✓ {(1 / store.calibration.metersPerPixel).toFixed(1)} px/m
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── Reference Walk ── */}
      <Section title="Reference Walk" emphasis={refActive || !hasRef}>
        <Help>
          Record a reference fingerprint walk for localization replay.
        </Help>
        {hasRef && (
          <Row>
            <select className={styles.select} id="loc-ref-select">
              {references.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.id} {r.name} · {r.point_count} pts ·{" "}
                  {Number(r.avg_ap_count || 0).toFixed(1)} APs
                </option>
              ))}
            </select>
            <button
              className={styles.btnGhost}
              onClick={() => {
                const sel = document.getElementById("loc-ref-select");
                if (sel?.value) store.deleteReference(Number(sel.value));
              }}
            >
              Delete
            </button>
          </Row>
        )}
        <Row>
          {!refActive ? (
            <button
              className={`${styles.btnSecondary} ${!hasRef && !replayActive ? styles.btnPrimary : ""}`}
              onClick={() =>
                store.startReference(
                  "Reference " + new Date().toLocaleTimeString(),
                  store.walkInterval,
                )
              }
            >
              Start Reference
            </button>
          ) : (
            <button
              className={styles.btnSecondary}
              onClick={store.stopReference}
            >
              Stop Reference
            </button>
          )}
        </Row>
        {hasRef && (
          <Row>
            {!replayActive ? (
              <button
                className={`${styles.btnSecondary} ${hasRef && !refActive ? styles.btnPrimary : ""}`}
                onClick={() => {
                  const sel = document.getElementById("loc-ref-select");
                  store.startReplay(
                    Number(sel?.value || references[0]?.id),
                    store.walkInterval,
                  );
                }}
              >
                Start Replay
              </button>
            ) : (
              <button
                className={styles.btnSecondary}
                onClick={store.stopReplay}
              >
                Stop Replay
              </button>
            )}
          </Row>
        )}
        {est && (
          <div
            className={`${styles.locEstimate} ${
              confidence >= 70
                ? styles.estGood
                : confidence >= 45
                  ? styles.estFair
                  : styles.estPoor
            }`}
          >
            {Math.round(Number(est.progress || 0) * 100)}% route · confidence{" "}
            {confidence?.toFixed(0)}% · pt #{est.matched_seq || "?"}
            {est.matched_checkpoint?.label
              ? ` (${est.matched_checkpoint.label})`
              : ""}
          </div>
        )}
      </Section>

      {/* ── Walk Capture ── */}
      <Section title="Walk Capture">
        <Help>
          Start the walk, move through the site, then tag checkpoints.
        </Help>
        <Row>
          <button
            className={styles.btnSecondary}
            disabled={walkActive}
            onClick={store.startWalk}
          >
            Start Walk
          </button>
          <button
            className={styles.btnSecondary}
            disabled={!walkActive}
            onClick={store.stopWalk}
          >
            Stop Walk
          </button>
        </Row>
        <Row>
          <input
            type="text"
            className={styles.labelInput}
            placeholder="Location tag (e.g. Lobby)"
            value={store.walkLabel}
            onChange={(e) => store.setWalkLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && walkActive)
                store.tagCheckpoint(store.walkLabel);
            }}
          />
          <button
            className={styles.btnGhost}
            disabled={!walkActive}
            onClick={() => store.tagCheckpoint(store.walkLabel)}
          >
            Tag Point
          </button>
        </Row>
        <div className={styles.walkStatus}>
          Walk:{" "}
          <span className={walkActive ? styles.on : styles.off}>
            {walkActive
              ? `recording · ${walk.sample_count || 0} samples`
              : "idle"}
          </span>
        </div>
        {walk.position && (
          <div className={styles.walkPos}>
            Pos: x {Number(walk.position.x_m || 0).toFixed(1)}m, y{" "}
            {Number(walk.position.y_m || 0).toFixed(1)}m
          </div>
        )}
      </Section>
    </aside>
  );
}
