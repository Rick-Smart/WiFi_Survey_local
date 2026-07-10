import { useRef, useEffect, useCallback } from "react";
import { useWalkStore } from "../../store/useWalkStore.js";
import styles from "./WalkMap.module.css";

// Signal dBm → RGB heat colour (matches legacy palette)
function heatRgb(dbm) {
  const v = Number(dbm);
  if (v >= -60) return [0, 230, 118];
  if (v >= -67) return [174, 234, 0];
  if (v >= -70) return [255, 215, 64];
  if (v >= -75) return [255, 145, 0];
  return [255, 82, 82];
}

function routeNodeColor(dbm) {
  const [r, g, b] = heatRgb(dbm);
  return `rgb(${r},${g},${b})`;
}

export function WalkMap({ onCalibrationClick }) {
  const canvasRef = useRef(null);
  const report = useWalkStore((s) => s.report);
  const localize = useWalkStore((s) => s.localize);
  const floorplan = useWalkStore((s) => s.floorplan);
  const cal = useWalkStore((s) => s.calibration);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(600, Math.floor(rect.width));
    const h = Math.max(360, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const samples = (report?.samples || []).filter(
      (s) => s && Number.isFinite(Number(s.signal_dbm)),
    );
    const checkpoints = (report?.samples || []).filter((s) => s?.is_checkpoint);

    // ── Background ───────────────────────────────────────────────────────
    if (floorplan) {
      ctx.drawImage(floorplan, 0, 0, w, h);
      ctx.fillStyle = "rgba(11,13,26,0.25)";
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "#101326";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#252a4a";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }

    // ── Calibration markers ───────────────────────────────────────────────
    const drawCalPt = (pt, label) => {
      if (!pt) return;
      ctx.fillStyle = "#00d4ff";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#dde2f0";
      ctx.font = "11px Segoe UI";
      ctx.fillText(label, pt.x + 7, pt.y - 7);
    };
    drawCalPt(cal.pointA, "A");
    drawCalPt(cal.pointB, "B");
    if (cal.pointA && cal.pointB) {
      ctx.strokeStyle = "rgba(0,212,255,0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cal.pointA.x, cal.pointA.y);
      ctx.lineTo(cal.pointB.x, cal.pointB.y);
      ctx.stroke();
    }

    if (!samples.length) {
      ctx.fillStyle = "#7b8db0";
      ctx.font = "14px Segoe UI";
      ctx.fillText(
        "No walk samples yet. Start a walk to build heatmap.",
        20,
        32,
      );
      const est = localize?.replay?.latest_estimate;
      if (est) {
        const conf = Number(est.confidence || 0);
        const pct = Math.round(Number(est.progress || 0) * 100);
        ctx.fillStyle =
          conf >= 70 ? "#00e676" : conf >= 45 ? "#ffd740" : "#ff5252";
        ctx.font = "12px Segoe UI";
        ctx.fillText(
          `Replay: ${pct}% route · confidence ${conf.toFixed(0)}% · point #${est.matched_seq || "?"}`,
          20,
          54,
        );
      }
      return;
    }

    // ── Coordinate mapping ────────────────────────────────────────────────
    const hasCal = !!(floorplan && cal.pointA && cal.metersPerPixel);
    let toXY;
    const pad = 24;

    if (hasCal) {
      const base = checkpoints[0] || samples[0] || { map_x_m: 0, map_y_m: 0 };
      const bx = Number(base.map_x_m || 0);
      const by = Number(base.map_y_m || 0);
      toXY = (sx, sy) => ({
        x: cal.pointA.x + (Number(sx || 0) - bx) / cal.metersPerPixel,
        y: cal.pointA.y + (Number(sy || 0) - by) / cal.metersPerPixel,
      });
    } else {
      const allX = samples.map((s) => Number(s.map_x_m || 0));
      const allY = samples.map((s) => Number(s.map_y_m || 0));
      const [minX, maxX] = [Math.min(...allX), Math.max(...allX)];
      const [minY, maxY] = [Math.min(...allY), Math.max(...allY)];
      const rx = maxX - minX || 1,
        ry = maxY - minY || 1;
      toXY = (sx, sy) => ({
        x: pad + ((Number(sx || 0) - minX) / rx) * (w - pad * 2),
        y: pad + ((Number(sy || 0) - minY) / ry) * (h - pad * 2),
      });
    }

    // ── Heatmap glow ──────────────────────────────────────────────────────
    for (const s of samples) {
      const { x, y } = toXY(s.map_x_m, s.map_y_m);
      const [r, g, b] = heatRgb(s.signal_dbm);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, 18);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Route line ────────────────────────────────────────────────────────
    if (samples.length > 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const first = toXY(samples[0].map_x_m, samples[0].map_y_m);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < samples.length; i++) {
        const p = toXY(samples[i].map_x_m, samples[i].map_y_m);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Sample nodes ──────────────────────────────────────────────────────
    for (const s of samples) {
      const { x, y } = toXY(s.map_x_m, s.map_y_m);
      ctx.fillStyle = routeNodeColor(s.signal_dbm);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Checkpoint labels ─────────────────────────────────────────────────
    for (const cp of checkpoints) {
      const { x, y } = toXY(cp.map_x_m, cp.map_y_m);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#101326";
      ctx.font = "bold 9px Segoe UI";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("CP", x, y);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      if (cp.label) {
        ctx.fillStyle = "#fff";
        ctx.font = "11px Segoe UI";
        ctx.fillText(cp.label, x + 10, y - 6);
      }
    }

    // ── Replay estimate position ──────────────────────────────────────────
    const est = localize?.replay?.latest_estimate;
    if (est?.position) {
      const { x, y } = toXY(est.position.x_m, est.position.y_m);
      const conf = Number(est.confidence || 0);
      const col = conf >= 70 ? "#00e676" : conf >= 45 ? "#ffd740" : "#ff5252";
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = col + "33";
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [report, localize, floorplan, cal]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Resize observer to redraw when the container resizes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas.parentElement || canvas);
    return () => ro.disconnect();
  }, [draw]);

  const handleClick = useCallback(
    (e) => {
      if (!onCalibrationClick) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      onCalibrationClick({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [onCalibrationClick],
  );

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      onClick={handleClick}
      title={onCalibrationClick ? "Click to set calibration point" : undefined}
    />
  );
}
