// ── Overall health score ─────────────────────────────────────────────────
// Aggregates four scan modules into a 0-100 score + A–F grade. Mirrors the
// legacy computeAndShowScore() but uses continuous interpolation so distinct
// environments produce distinct scores (instead of everyone landing on 91).

// Piecewise-linear interpolation over (x, y) anchor points. Values outside
// the anchor range clamp to the nearest endpoint.
function interpolate(x, anchors) {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * @param {Record<string, any>} results  id -> scan result object
 * @returns {{score:number, grade:string, label:string, color:string,
 *            parts:Array<{key:string, val:number, max:number, pct:number}>}|null}
 */
export function computeHealthScore(results) {
  if (!results) return null;
  const parts = {};

  // Signal (40 pts) — continuous interpolation across realistic dBm anchors.
  const iface = results["interface"];
  if (iface?.data?.signal_dbm != null) {
    parts.Signal = Math.round(
      interpolate(iface.data.signal_dbm, [
        [-90, 0],
        [-80, 8],
        [-70, 20],
        [-67, 25],
        [-60, 33],
        [-50, 40],
        [-30, 40],
      ]),
    );
    parts._Signal_max = 40;
  }

  // Latency / loss (30 pts) — ping (0-20) + packet loss (0-10), both continuous.
  const lat = results["latency"];
  if (lat?.data?.targets) {
    const gw = lat.data.targets.find((t) => t.label === "Default Gateway");
    let pts = 30;
    if (gw && !gw.reachable) {
      pts = 0;
    } else if (gw) {
      const pingPts = interpolate(gw.avg_ms || 0, [
        [5, 20],
        [150, 0],
      ]);
      const lossPts = interpolate(gw.loss_pct || 0, [
        [0, 10],
        [15, 0],
      ]);
      pts = pingPts + lossPts;
    }
    parts.Latency = Math.round(Math.max(0, pts));
    parts._Latency_max = 30;
  }

  // Channel (15 pts) — scores on unique co-channel physical devices (grouped
  // by 5-byte BSSID prefix) so a mesh node broadcasting 7 SSIDs counts as one
  // interferer, not seven.  Falls back to raw BSSID count when device data is
  // unavailable.  Log curve so the score stays meaningful at extreme counts.
  //   2.4 GHz saturation: 10 devices   5 GHz saturation: 80 devices
  const ch = results["channel_survey"];
  if (ch?.data?.my_channel) {
    const myCh = ch.data.my_channel;
    const is24 = myCh <= 14;
    const saturation = is24 ? 10 : 80;

    // Prefer the pre-computed co_devices_* field (unique physical devices).
    // Fall back to raw BSSID map minus 1 for backwards compatibility.
    let coChannel;
    if (is24 && ch.data.co_devices_24 != null) {
      coChannel = ch.data.co_devices_24;
    } else if (!is24 && ch.data.co_devices_5 != null) {
      coChannel = ch.data.co_devices_5;
    } else {
      const map = (is24 ? ch.data.ch_24 : ch.data.ch_5) || {};
      coChannel = Math.max(0, (map[myCh] || 0) - 1);
    }

    const penalty =
      coChannel > 0 ? Math.log(coChannel + 1) / Math.log(saturation + 1) : 0;
    parts.Channel = Math.round(Math.max(0, 15 * (1 - penalty)));
    parts._Channel_max = 15;
  }

  // Radio (15 pts) — Wi-Fi generation is a discrete hardware property.
  const phy = results["phy_rate"] || results["interface"];
  const radio = (phy?.data?.radio_type || "").toLowerCase();
  if (radio) {
    parts.Radio = radio.includes("be")
      ? 15
      : radio.includes("ax")
        ? 13
        : radio.includes("ac")
          ? 10
          : radio.includes("n")
            ? 6
            : radio.includes("g")
              ? 3
              : radio.includes("b")
                ? 1
                : 7;
    parts._Radio_max = 15;
  }

  const keys = ["Signal", "Latency", "Channel", "Radio"];
  const defined = keys.filter((k) => parts[k] != null);
  if (!defined.length) return null;

  const total = defined.reduce((s, k) => s + parts[k], 0);
  const max = defined.reduce((s, k) => s + (parts["_" + k + "_max"] || 0), 0);
  const score = max > 0 ? Math.round((total / max) * 100) : 0;

  const [grade, label, color] =
    score >= 90
      ? ["A", "Excellent", "var(--green)"]
      : score >= 80
        ? ["B", "Good", "var(--green)"]
        : score >= 70
          ? ["C", "Fair", "var(--yellow)"]
          : score >= 60
            ? ["D", "Poor", "var(--orange)"]
            : ["F", "Very Poor", "var(--red)"];

  return {
    score,
    grade,
    label,
    color,
    parts: defined.map((k) => {
      const val = parts[k];
      const m = parts["_" + k + "_max"] || 1;
      return { key: k, val, max: m, pct: Math.round((val / m) * 100) };
    }),
  };
}
