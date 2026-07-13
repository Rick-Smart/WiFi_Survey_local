import { KVTable } from "../../components/KVTable.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { StatGrid } from "../../components/StatGrid.jsx";
import { SignalBar } from "../../components/SignalBar.jsx";
import { Gauge } from "../../components/Gauge.jsx";
import { Sparkline } from "../../components/Sparkline.jsx";
import { ChannelChart } from "../../components/ChannelChart.jsx";
import { qualityVar } from "../../theme/themes.js";
import styles from "./moduleBodies.module.css";

const fmt = (n) => (n != null ? Number(n).toLocaleString() : "—");
const stateQuality = (s) =>
  !s
    ? undefined
    : s.toLowerCase().includes("connected")
      ? "excellent"
      : "critical";

// ── Interface ────────────────────────────────────────────────────────────
function InterfaceBody({ d }) {
  const rows = [
    ["Status", d.state, { quality: stateQuality(d.state) }],
    ["SSID", d.ssid],
    ["BSSID (AP MAC)", d.bssid, { mono: true }],
    ["Adapter MAC", d.physical_address, { mono: true }],
    ["Interface Name", d.name],
    ["Radio Standard", d.radio_label || d.radio_type],
    ["Frequency Band", d.band],
    ["Channel", d.channel],
    ["Profile", d.profile],
    ["Network Type", d.network_type],
    ["Connection Mode", d.connection_mode],
    ["PHY RX Rate", d.receive_rate ? `${d.receive_rate} Mbps` : null],
    ["PHY TX Rate", d.transmit_rate ? `${d.transmit_rate} Mbps` : null],
    [
      "Signal",
      d.signal && d.signal_dbm != null
        ? `${d.signal} (~${d.signal_dbm} dBm)`
        : d.signal,
      { quality: d.signal_quality_level },
    ],
    ["Signal Quality", d.signal_quality, { quality: d.signal_quality_level }],
    ["GUID", d.guid, { mono: true }],
  ];
  return (
    <>
      <KVTable rows={rows} />
      {d.signal_dbm != null && (
        <SignalBar
          dbm={d.signal_dbm}
          label={`${d.signal} (${d.signal_dbm} dBm)`}
        />
      )}
    </>
  );
}

// ── IP Config ────────────────────────────────────────────────────────────
function IPConfigBody({ d }) {
  const rows = [
    ["IPv4 Address", d.ipv4],
    ["Subnet Mask", d.subnet_mask],
    [
      "Prefix Length",
      d.prefix_length != null
        ? `/${d.prefix_length} (${d.subnet_size?.toLocaleString()} hosts)`
        : null,
    ],
    ["Default Gateway", d.gateway_ip || d.default_gateway, { mono: true }],
    ["Gateway MAC", d.gateway_mac, { mono: true }],
    ["DHCP Enabled", d.dhcp_enabled],
    ["DHCP Server", d.dhcp_server, { mono: true }],
    ["Lease Obtained", d.lease_obtained],
    ["Lease Expires", d.lease_expires],
    ["DNS Servers", d.dns_list?.join(", ") || d.dns_servers, { mono: true }],
    ["IPv6 Link-Local", d.ipv6_link_local, { mono: true }],
  ];
  return <KVTable rows={rows} />;
}

// ── Security ─────────────────────────────────────────────────────────────
function SecurityBody({ d }) {
  const lvl = d.security_level || "Unknown";
  const quality = ["Excellent", "Good"].includes(lvl)
    ? "excellent"
    : lvl === "Fair"
      ? "fair"
      : ["Poor", "Critical", "None"].includes(lvl)
        ? "critical"
        : undefined;
  const rows = [
    ["Authentication", d.authentication],
    ["Cipher", d.cipher],
    ["Security Level", lvl, { quality }],
    ["802.11w MFP", d.mfp_80211w],
    ["FIPS 140-2 Mode", d.fips_140_2],
    [
      "Security Score",
      d.security_score != null ? `${d.security_score}/100` : null,
    ],
  ];
  return (
    <>
      <KVTable rows={rows} />
      {d.security_desc && <p className={styles.note}>{d.security_desc}</p>}
    </>
  );
}

// ── Channel Survey ───────────────────────────────────────────────────────
function ChannelSurveyBody({ d }) {
  const apColumns = [
    {
      key: "ssid",
      header: "SSID",
      render: (ap) => (
        <>
          {ap.ssid}
          {ap.is_mine && <span className={styles.mineTag}>◄ YOU</span>}
        </>
      ),
    },
    { key: "bssid", header: "BSSID", mono: true, nowrap: true },
    { key: "channel", header: "Ch", render: (ap) => ap.channel || "—" },
    { key: "band", header: "Band", render: (ap) => ap.band || "—" },
    {
      key: "signal",
      header: "Signal",
      nowrap: true,
      color: (ap) => qualityVar(ap.signal_quality_level),
      render: (ap) =>
        `${ap.signal || "—"}${ap.signal_dbm != null ? ` (${ap.signal_dbm} dBm)` : ""}`,
    },
    {
      key: "radio_type",
      header: "Radio",
      render: (ap) => ap.radio_type || "—",
    },
    {
      key: "authentication",
      header: "Auth",
      render: (ap) => ap.authentication || "—",
    },
  ];
  return (
    <>
      {d.ch_24 && Object.keys(d.ch_24).length > 0 && (
        <ChannelChart
          label="2.4 GHz"
          chMap={d.ch_24}
          myChannel={d.my_channel}
          nonOverlapping={d.non_overlapping_24 || [1, 6, 11]}
        />
      )}
      {d.ch_5 && Object.keys(d.ch_5).length > 0 && (
        <ChannelChart label="5 GHz" chMap={d.ch_5} myChannel={d.my_channel} />
      )}
      {d.my_channel != null &&
        (() => {
          const is24 = d.my_channel <= 14;
          const devices = is24 ? d.co_devices_24 : d.co_devices_5;
          const bssids = is24 ? d.co_channel_24 : d.co_channel_5;
          const sat = is24 ? 10 : 80;
          return (
            <div className={styles.note}>
              Ch{d.my_channel}:{" "}
              <strong>{devices ?? "—"} co-channel devices</strong>
              {bssids != null &&
                bssids !== devices &&
                ` (${bssids} BSSIDs — multi-SSID radios counted once)`}
              {" — "}scored on unique devices, log scale, saturates at {sat}.
            </div>
          );
        })()}
      {d.aps && d.aps.length > 0 && (
        <>
          <div className={styles.tableCaption}>
            {d.total_ssids} SSIDs · {d.total_aps} APs visible
          </div>
          <DataTable
            columns={apColumns}
            rows={d.aps}
            maxHeight="350px"
            rowKey={(ap, i) => ap.bssid || i}
            rowClass={(ap) => (ap.is_mine ? styles.mineRow : undefined)}
          />
        </>
      )}
    </>
  );
}

// ── Latency ──────────────────────────────────────────────────────────────
function LatencyBody({ d }) {
  if (!d.targets || !d.targets.length)
    return <div className={styles.empty}>No latency data</div>;
  const columns = [
    { key: "label", header: "Target", nowrap: true },
    { key: "host", header: "Host", mono: true, nowrap: true },
    {
      key: "min_ms",
      header: "Min",
      nowrap: true,
      render: (t) => (t.reachable ? `${t.min_ms} ms` : "—"),
    },
    {
      key: "avg_ms",
      header: "Avg",
      nowrap: true,
      render: (t) => (t.reachable ? `${t.avg_ms} ms` : "—"),
    },
    {
      key: "max_ms",
      header: "Max",
      nowrap: true,
      render: (t) => (t.reachable ? `${t.max_ms} ms` : "—"),
    },
    {
      key: "jitter_ms",
      header: "Jitter",
      nowrap: true,
      render: (t) => (t.reachable ? `±${t.jitter_ms} ms` : "—"),
    },
    {
      key: "loss_pct",
      header: "Loss",
      nowrap: true,
      render: (t) => (t.reachable ? `${t.loss_pct}%` : "—"),
    },
    {
      key: "quality",
      header: "Quality",
      nowrap: true,
      color: (t) => (t.reachable ? qualityVar(t.quality_level) : "var(--red)"),
      render: (t) => (t.reachable ? t.quality : "UNREACHABLE"),
    },
    {
      key: "rtt",
      header: "RTT",
      render: (t) => (t.reachable ? <Sparkline values={t.rtts || []} /> : null),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={d.targets}
      rowKey={(t, i) => t.host || i}
    />
  );
}

// ── DNS ──────────────────────────────────────────────────────────────────
function DnsBody({ d }) {
  if (!d.results || !d.results.length)
    return <div className={styles.empty}>No DNS data</div>;
  const columns = [
    {
      key: "ok",
      header: "",
      nowrap: true,
      color: (r) => (r.ok ? "var(--green)" : "var(--red)"),
      render: (r) => (r.ok ? "OK" : "FAIL"),
    },
    { key: "domain", header: "Domain", nowrap: true },
    {
      key: "ip",
      header: "Result",
      mono: true,
      color: (r) => (r.ok ? undefined : "var(--red)"),
      render: (r) => (r.ok ? r.ip || "" : r.error || "Failed"),
    },
    {
      key: "ms",
      header: "Time",
      align: "right",
      nowrap: true,
      render: (r) => (r.ok ? `${r.ms} ms` : ""),
    },
  ];
  return (
    <>
      <div className={styles.tableCaption}>
        {d.ok_count}/{d.total} domains resolved
        {d.avg_ms != null ? ` · avg ${d.avg_ms} ms` : ""}
      </div>
      <DataTable
        columns={columns}
        rows={d.results}
        rowKey={(r, i) => r.domain || i}
      />
    </>
  );
}

// ── Statistics ───────────────────────────────────────────────────────────
function StatisticsBody({ d }) {
  const isPs = d._source === "ps_adapter";
  const retry = d.retry_rate_pct;
  const retryColor =
    retry == null
      ? undefined
      : retry < 5
        ? "var(--green)"
        : retry < 15
          ? "var(--yellow)"
          : "var(--red)";

  // Only include rows where the backing value is not null — no dash placeholders.
  const items = [
    d.frames_tx != null && {
      label: isPs ? "Packets TX" : "Frames TX",
      value: fmt(d.frames_tx),
    },
    d.frames_rx != null && {
      label: isPs ? "Packets RX" : "Frames RX",
      value: fmt(d.frames_rx),
    },
    d.multicast_rx != null && {
      label: "Multicast RX",
      value: fmt(d.multicast_rx),
    },
    d.frames_dropped_tx != null && {
      label: isPs ? "TX Discarded" : "Frames Dropped",
      value: fmt(d.frames_dropped_tx),
    },
    d.rx_discarded != null && {
      label: "RX Discarded",
      value: fmt(d.rx_discarded),
    },
    d.beacons_rx != null && { label: "Beacons RX", value: fmt(d.beacons_rx) },
    d.tx_retries != null && { label: "TX Retries", value: fmt(d.tx_retries) },
    retry != null && {
      label: "TX Retry Rate",
      value: `${retry}%`,
      color: retryColor,
    },
    d.ack_timeout != null && {
      label: "ACK Timeouts",
      value: fmt(d.ack_timeout),
    },
    d.cts_timeout != null && {
      label: "CTS Timeouts",
      value: fmt(d.cts_timeout),
    },
    d.dup_frames != null && {
      label: "Duplicate Frames",
      value: fmt(d.dup_frames),
    },
    d.rx_errors != null && { label: "RX Errors", value: fmt(d.rx_errors) },
    d.tx_errors != null && { label: "TX Errors", value: fmt(d.tx_errors) },
  ].filter(Boolean);

  return (
    <>
      <StatGrid items={items} />
      {d.event_log?.length > 0 && (
        <EventLog
          events={d.event_log}
          connects={d.connects_recent ?? 0}
          disconnects={d.disconnects_recent ?? 0}
          failures={d.failures_recent ?? 0}
        />
      )}
    </>
  );
}

const EVT_LABEL = {
  connect: "CONNECTED",
  disconnect: "DISCONNECTED",
  fail: "FAILED",
};
const EVT_CLS = {
  connect: styles.evtConnect,
  disconnect: styles.evtDisconnect,
  fail: styles.evtFail,
};

function EventLog({ events, connects, disconnects, failures }) {
  return (
    <div className={styles.eventLog}>
      <div className={styles.evtHeader}>
        Connection History
        <span className={styles.evtCounts}>
          {connects} connected &middot; {disconnects} disconnected &middot;{" "}
          {failures} failed
        </span>
      </div>
      {[...events]
        .reverse()
        .slice(0, 12)
        .map((ev, i) => {
          const dt = new Date(ev.time);
          const timeStr = isNaN(dt)
            ? ev.time
            : dt.toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
          let detail = "";
          if (ev.type === "connect" && (ev.phy || ev.auth))
            detail = [ev.phy, ev.auth].filter(Boolean).join(" · ");
          else if (
            (ev.type === "disconnect" || ev.type === "fail") &&
            ev.reason
          )
            detail = ev.reason;
          return (
            <div key={i} className={styles.evtRow}>
              <span className={styles.evtTime}>{timeStr}</span>
              <span className={`${styles.evtBadge} ${EVT_CLS[ev.type] ?? ""}`}>
                {EVT_LABEL[ev.type] ?? ev.type.toUpperCase()}
              </span>
              <span className={styles.evtSsid}>{ev.ssid ?? "—"}</span>
              {detail && <span className={styles.evtDetail}>{detail}</span>}
            </div>
          );
        })}
    </div>
  );
}

// ── Driver ───────────────────────────────────────────────────────────────
function DriverBody({ d }) {
  const aged = d.driver_age_years && d.driver_age_years > 2;
  const rows = [
    ["Adapter", d.description],
    ["Vendor", d.vendor],
    ["Provider", d.provider],
    ["Driver Version", d.version, { mono: true }],
    [
      "Driver Date",
      d.date + (d.driver_age_label ? ` (${d.driver_age_label})` : ""),
      { quality: aged ? "fair" : undefined },
    ],
    ["Radio Types", d.radio_types],
    ["Hosted Network", d.hosted_net],
    ["802.11w MFP", d.mfp_80211w],
    ["FIPS 140-2", d.fips_mode],
    ["IHV Service", d.ihv_present],
  ];
  return <KVTable rows={rows} />;
}

// ── PHY Rate ─────────────────────────────────────────────────────────────
function PhyRateBody({ d }) {
  const eff = d.efficiency_pct;
  const effRaw = d.efficiency_raw_pct;
  const effColor =
    eff == null
      ? "var(--text-2)"
      : eff >= 80
        ? "var(--green)"
        : eff >= 50
          ? "var(--yellow)"
          : "var(--red)";

  // Config label derived from inferred NSS/BW
  const configLabel =
    d.rx_nss && d.rx_bw_mhz
      ? `${d.rx_nss}×${d.rx_nss} MIMO, ${d.rx_bw_mhz} MHz`
      : null;

  const ceilLabel =
    d.theoretical_max_mbps != null
      ? `${d.theoretical_max_mbps} Mbps${configLabel ? ` (${configLabel}, ${d.ceiling_mcs_name || "max MCS"})` : ""}`
      : null;

  const effLabel =
    eff != null
      ? `${eff}%${effRaw != null && effRaw > 100 ? ` (${effRaw}% vs ref)` : ""}`
      : null;

  const rows = [
    ["Radio Standard", d.radio_label || d.radio_type],
    ["Band", d.band],
    ["Channel", d.channel],
    [
      "PHY RX Rate",
      d.receive_rate_mbps != null ? `${d.receive_rate_mbps} Mbps` : null,
    ],
    [
      "PHY TX Rate",
      d.transmit_rate_mbps != null ? `${d.transmit_rate_mbps} Mbps` : null,
    ],
    [
      "RX Config",
      d.rx_nss && d.rx_mcs_name
        ? `${d.rx_nss}ss, ${d.rx_bw_mhz} MHz, ${d.rx_mcs_name}`
        : null,
    ],
    [
      "TX Config",
      d.tx_nss && d.tx_mcs != null
        ? `${d.tx_nss}ss, ${d.tx_bw_mhz} MHz, MCS${d.tx_mcs}`
        : null,
    ],
    ["Ceiling", ceilLabel],
    [
      "Efficiency",
      effLabel,
      {
        quality:
          eff == null
            ? undefined
            : eff >= 80
              ? "excellent"
              : eff >= 50
                ? "fair"
                : "critical",
      },
    ],
    [
      "Signal",
      d.signal_pct + (d.signal_dbm != null ? ` (~${d.signal_dbm} dBm)` : ""),
    ],
  ].filter(([, v]) => v != null);

  return (
    <>
      {eff != null && <Gauge value={eff} label="efficiency" color={effColor} />}
      <KVTable rows={rows} />
      {d.why?.length > 0 && <PhyWhySection lines={d.why} />}
    </>
  );
}

function PhyWhySection({ lines }) {
  return (
    <div className={styles.whySection}>
      <div className={styles.whyTitle}>How this was calculated</div>
      {lines.map((line, i) => (
        <div key={i} className={styles.whyLine}>
          {line}
        </div>
      ))}
    </div>
  );
}

// ── Generic fallback ─────────────────────────────────────────────────────
function GenericBody({ d }) {
  const rows = Object.entries(d)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => [
      k.replace(/_/g, " "),
      typeof v === "object" ? JSON.stringify(v) : String(v ?? ""),
    ]);
  return rows.length ? (
    <KVTable rows={rows} />
  ) : (
    <div className={styles.empty}>No data</div>
  );
}

const BODIES = {
  interface: InterfaceBody,
  ipconfig: IPConfigBody,
  security: SecurityBody,
  channel_survey: ChannelSurveyBody,
  latency: LatencyBody,
  dns: DnsBody,
  statistics: StatisticsBody,
  driver: DriverBody,
  phy_rate: PhyRateBody,
};

export function ModuleBody({ id, data }) {
  const Body = BODIES[id] || GenericBody;
  return <Body d={data || {}} />;
}
