#!/usr/bin/env python3
"""
WiFi Engineer Survey Tool
=========================
Provides a comprehensive, engineer-level analysis of your current WiFi
connection using only built-in Windows commands (netsh, ipconfig, ping).

No internet connection or external packages required.

Usage:
    python wifi_survey.py               # Full survey + HTML report
    python wifi_survey.py --no-html     # Terminal output only
    python wifi_survey.py --no-internet # Skip internet-facing ping tests
    python wifi_survey.py --fast        # Skip all ping tests
    python wifi_survey.py --help        # Show this help
"""

import argparse
import os
import platform
import re
import socket
import statistics
import subprocess
import sys
import webbrowser
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

VERSION = "1.0.0"
REPORT_DIR = Path.home() / "WiFi_Survey_Reports"

SIGNAL_EXCELLENT = -50   # dBm
SIGNAL_GOOD      = -60
SIGNAL_FAIR      = -70
SIGNAL_POOR      = -80

NON_OVERLAPPING_24 = {1, 6, 11}

RADIO_GENERATIONS = {
    '802.11be':  'Wi-Fi 7  (802.11be) — Latest Generation',
    '802.11ax':  'Wi-Fi 6/6E (802.11ax) — Current Generation',
    '802.11ac':  'Wi-Fi 5  (802.11ac) — Previous Generation',
    '802.11n':   'Wi-Fi 4  (802.11n)  — Older Standard',
    '802.11g':   'Wi-Fi 3  (802.11g)  — Legacy',
    '802.11a':   'Wi-Fi 2  (802.11a)  — Legacy',
    '802.11b':   'Wi-Fi 1  (802.11b)  — Very Legacy / Slow',
}

# ─────────────────────────────────────────────────────────────────────────────
# TERMINAL COLOR SUPPORT
# ─────────────────────────────────────────────────────────────────────────────

_ANSI_ENABLED = False

def _enable_ansi():
    global _ANSI_ENABLED
    if os.name == 'nt':
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
            _ANSI_ENABLED = True
        except Exception:
            _ANSI_ENABLED = False
    else:
        _ANSI_ENABLED = sys.stdout.isatty()

_COLORS = {
    'green':   '\033[92m',
    'yellow':  '\033[93m',
    'orange':  '\033[38;5;208m',
    'red':     '\033[91m',
    'cyan':    '\033[96m',
    'blue':    '\033[94m',
    'magenta': '\033[95m',
    'gray':    '\033[90m',
    'bold':    '\033[1m',
    'reset':   '\033[0m',
}

def c(text, color):
    """Wrap text in ANSI color if supported."""
    if _ANSI_ENABLED:
        return f"{_COLORS.get(color, '')}{text}{_COLORS['reset']}"
    return text

# ─────────────────────────────────────────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────────────────────────────────────────

def run_cmd(args, timeout=20):
    """Run a subprocess command and return stdout as a string."""
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding='utf-8',
            errors='replace',
        )
        return result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return ""

def signal_pct_to_dbm(pct_str):
    """Convert Windows signal quality percentage (0-100) to approximate dBm."""
    try:
        pct = int(str(pct_str).replace('%', '').strip())
        return round((pct / 2) - 100, 1)
    except (ValueError, TypeError):
        return None

def dbm_quality(dbm):
    """Return (label, color) for a dBm signal value."""
    if dbm is None:
        return "Unknown", "gray"
    if dbm >= SIGNAL_EXCELLENT:
        return "Excellent", "green"
    elif dbm >= SIGNAL_GOOD:
        return "Good", "green"
    elif dbm >= SIGNAL_FAIR:
        return "Fair", "yellow"
    elif dbm >= SIGNAL_POOR:
        return "Poor", "orange"
    else:
        return "Very Poor", "red"

def latency_quality(avg_ms):
    """Return (label, color) for an average ping latency in ms."""
    if avg_ms is None:
        return "N/A", "gray"
    if avg_ms < 5:
        return "Excellent (<5 ms)", "green"
    elif avg_ms < 20:
        return "Good (<20 ms)", "green"
    elif avg_ms < 50:
        return "Fair (<50 ms)", "yellow"
    elif avg_ms < 100:
        return "Poor (<100 ms)", "orange"
    else:
        return "Very Poor (>100 ms)", "red"

def fmt(key, value, key_width=32):
    return f"  {key:<{key_width}}: {value}"

def hr(char='─', width=72):
    print(char * width)

def section(title, width=72):
    print()
    print(f"  > {title}")
    print('─' * width)

def header(title, width=72):
    print()
    print('═' * width)
    pad = (width - len(title) - 4) // 2
    print(f"{'═' * (pad + 2)}  {title}  {'═' * (width - pad - len(title) - 4)}")
    print('═' * width)

# ─────────────────────────────────────────────────────────────────────────────
# DATA COLLECTION
# ─────────────────────────────────────────────────────────────────────────────

def collect_interface():
    """Parse 'netsh wlan show interfaces'."""
    out = run_cmd(['netsh', 'wlan', 'show', 'interfaces'])
    d = {}
    patterns = {
        'name':            r'^\s+Name\s*:\s*(.+)',
        'description':     r'^\s+Description\s*:\s*(.+)',
        'guid':            r'^\s+GUID\s*:\s*(.+)',
        'physical_address':r'^\s+Physical address\s*:\s*(.+)',
        'state':           r'^\s+State\s*:\s*(.+)',
        'ssid':            r'^\s+SSID\s*:\s*(.+)',
        'bssid':           r'^\s+BSSID\s*:\s*(.+)',
        'network_type':    r'^\s+Network type\s*:\s*(.+)',
        'radio_type':      r'^\s+Radio type\s*:\s*(.+)',
        'authentication':  r'^\s+Authentication\s*:\s*(.+)',
        'cipher':          r'^\s+Cipher\s*:\s*(.+)',
        'connection_mode': r'^\s+Connection mode\s*:\s*(.+)',
        'channel':         r'^\s+Channel\s*:\s*(.+)',
        'receive_rate':    r'^\s+Receive rate \(Mbps\)\s*:\s*(.+)',
        'transmit_rate':   r'^\s+Transmit rate \(Mbps\)\s*:\s*(.+)',
        'signal':          r'^\s+Signal\s*:\s*(.+)',
        'profile':         r'^\s+Profile\s*:\s*(.+)',
    }
    for key, pat in patterns.items():
        m = re.search(pat, out, re.MULTILINE | re.IGNORECASE)
        if m:
            d[key] = m.group(1).strip()

    if 'signal' in d:
        d['signal_dbm'] = signal_pct_to_dbm(d['signal'])
    if 'channel' in d:
        try:
            d['band'] = '5 GHz' if int(d['channel']) > 14 else '2.4 GHz'
        except ValueError:
            d['band'] = 'Unknown'
    return d


def collect_networks():
    """Parse 'netsh wlan show networks mode=bssid' into a list of networks."""
    out = run_cmd(['netsh', 'wlan', 'show', 'networks', 'mode=bssid'])
    networks, current = [], {}

    for line in out.splitlines():
        line_s = line.strip()

        ssid_m = re.match(r'^SSID\s+\d+\s*:\s*(.*)', line_s, re.IGNORECASE)
        if ssid_m:
            if current:
                networks.append(current)
            current = {'ssid': ssid_m.group(1).strip(), 'bssids': []}
            continue

        if not current:
            continue

        checks = [
            (r'^Network type\s*:\s*(.+)',   'network_type',  current,         False),
            (r'^Authentication\s*:\s*(.+)', 'authentication', current,        False),
            (r'^Encryption\s*:\s*(.+)',     'encryption',    current,         False),
            (r'^BSSID\s+\d+\s*:\s*(.+)',   'bssid',         None,            True),
            (r'^Signal\s*:\s*(.+)',         'signal',        None,            False),
            (r'^Radio type\s*:\s*(.+)',     'radio_type',    None,            False),
            (r'^Channel\s*:\s*(.+)',        'channel',       None,            False),
        ]
        for pat, key, target, is_new_bssid in checks:
            m = re.match(pat, line_s, re.IGNORECASE)
            if m:
                val = m.group(1).strip()
                if is_new_bssid:
                    current['bssids'].append({'bssid': val})
                elif target is not None:
                    target[key] = val
                elif current['bssids']:
                    entry = current['bssids'][-1]
                    entry[key] = val
                    if key == 'signal':
                        entry['signal_dbm'] = signal_pct_to_dbm(val)
                    elif key == 'channel':
                        try:
                            entry['band'] = '5 GHz' if int(val) > 14 else '2.4 GHz'
                        except ValueError:
                            entry['band'] = 'Unknown'
                break

    if current:
        networks.append(current)
    return networks


def collect_driver():
    """Parse 'netsh wlan show drivers'."""
    out = run_cmd(['netsh', 'wlan', 'show', 'drivers'])
    d = {}
    patterns = {
        'description':   r'^\s+Description\s*:\s*(.+)',
        'vendor':        r'^\s+Vendor\s*:\s*(.+)',
        'provider':      r'^\s+Provider\s*:\s*(.+)',
        'date':          r'^\s+Date\s*:\s*(.+)',
        'version':       r'^\s+Version\s*:\s*(.+)',
        'radio_types':   r'^\s+Radio types supported\s*:\s*(.+)',
        'fips_mode':     r'^\s+FIPS 140-2 mode\s*:\s*(.+)',
        'mfp_80211w':    r'^\s+802\.11w Management Frame Protection\s*:\s*(.+)',
        'hosted_net':    r'^\s+Hosted network supported\s*:\s*(.+)',
        'ihv_present':   r'^\s+IHV service present\s*:\s*(.+)',
    }
    for key, pat in patterns.items():
        m = re.search(pat, out, re.MULTILINE | re.IGNORECASE)
        if m:
            d[key] = m.group(1).strip()
    return d


def collect_statistics():
    """Parse 'netsh wlan show statistics' for frame/error counts."""
    out = run_cmd(['netsh', 'wlan', 'show', 'statistics'])
    d = {}
    patterns = {
        'frames_tx':         r'Frames transmitted\s*:\s*(\d+)',
        'frames_rx':         r'Frames received\s*:\s*(\d+)',
        'frames_dropped_tx': r'Frames dropped\s*:\s*(\d+)',
        'beacons_rx':        r'Beacons received\s*:\s*(\d+)',
        'multicast_rx':      r'Multicast received\s*:\s*(\d+)',
        'err_dup_frames':    r'Duplicate frames\s*:\s*(\d+)',
        'err_cts_timeout':   r'CTS timeout\s*:\s*(\d+)',
        'err_ack_timeout':   r'ACK timeout\s*:\s*(\d+)',
        'err_no_ack':        r'Incomplete transmissions due to no ACK\s*:\s*(\d+)',
        'err_failed_tx':     r'Transmissions with retries\s*:\s*(\d+)',
    }
    for key, pat in patterns.items():
        m = re.search(pat, out, re.IGNORECASE)
        if m:
            d[key] = int(m.group(1))
    return d


def collect_ip_config():
    """Parse 'ipconfig /all' and extract the WiFi adapter section."""
    out = run_cmd(['ipconfig', '/all'])

    # Split on adapter header lines (non-indented lines ending with ':')
    sections = re.split(r'\r?\n(?=\S)', out)

    wifi_section = None
    for sec in sections:
        if re.search(r'Wi-Fi|Wireless|WLAN|802\.11', sec, re.IGNORECASE):
            wifi_section = sec
            break
    if not wifi_section:
        for sec in sections:
            if 'IPv4' in sec and 'Ethernet' not in sec:
                wifi_section = sec
                break
    if not wifi_section:
        return {}

    d = {}
    patterns = {
        'adapter_name':    r'^(.+adapter .+):',
        'description':     r'Description\s*[.:]+\s*(.+)',
        'physical_address':r'Physical Address\s*[.:]+\s*(.+)',
        'dhcp_enabled':    r'DHCP Enabled\s*[.:]+\s*(.+)',
        'ipv4':            r'IPv4 Address\s*[.:]+\s*(.+)',
        'subnet_mask':     r'Subnet Mask\s*[.:]+\s*(.+)',
        'default_gateway': r'Default Gateway\s*[.:]+\s*(.+)',
        'dhcp_server':     r'DHCP Server\s*[.:]+\s*(.+)',
        'dns_servers':     r'DNS Servers\s*[.:]+\s*(.+)',
        'lease_obtained':  r'Lease Obtained\s*[.:]+\s*(.+)',
        'lease_expires':   r'Lease Expires\s*[.:]+\s*(.+)',
        'ipv6_link_local': r'Link-local IPv6 Address\s*[.:]+\s*(.+)',
    }
    for key, pat in patterns.items():
        m = re.search(pat, wifi_section, re.MULTILINE | re.IGNORECASE)
        if m:
            d[key] = m.group(1).strip().replace('(Preferred)', '').strip()

    # Collect all DNS IPs (may span multiple lines after the key)
    dns_block_m = re.search(
        r'DNS Servers\s*[.:]+\s*(.+?)(?=\r?\n\S|\Z)',
        wifi_section, re.DOTALL | re.IGNORECASE
    )
    if dns_block_m:
        raw = dns_block_m.group(1)
        d['dns_list'] = re.findall(r'[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}', raw)

    # Parse default gateway — first valid IP only
    if 'default_gateway' in d:
        gw_ips = re.findall(r'[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}', d['default_gateway'])
        d['gateway_ip'] = gw_ips[0] if gw_ips else None
    return d


def collect_arp_gateway(gateway_ip):
    """Return the MAC address of the default gateway from the ARP cache."""
    if not gateway_ip:
        return None
    out = run_cmd(['arp', '-a', gateway_ip])
    m = re.search(r'([\da-fA-F]{2}[-:]){5}[\da-fA-F]{2}', out)
    return m.group(0) if m else None


# ─────────────────────────────────────────────────────────────────────────────
# PING / CONNECTIVITY
# ─────────────────────────────────────────────────────────────────────────────

def ping_host(host, count=10, label=None):
    """Run a Windows ping and return parsed statistics."""
    label = label or host
    out = run_cmd(['ping', '-n', str(count), host], timeout=count * 4 + 5)
    if not out:
        return {'host': host, 'label': label, 'reachable': False, 'error': 'No response / timeout'}

    rtts = [int(x) for x in re.findall(r'time[=<](\d+)ms', out)]
    sent_m  = re.search(r'Sent = (\d+)',     out)
    recv_m  = re.search(r'Received = (\d+)', out)
    lost_m  = re.search(r'Lost = (\d+)',     out)

    sent = int(sent_m.group(1)) if sent_m else count
    recv = int(recv_m.group(1)) if recv_m else len(rtts)
    lost = int(lost_m.group(1)) if lost_m else (count - len(rtts))
    loss_pct = round((lost / sent * 100) if sent > 0 else 100.0, 1)

    if not rtts:
        return {'host': host, 'label': label, 'reachable': False,
                'sent': sent, 'lost': lost, 'loss_pct': 100.0, 'error': 'No replies'}

    return {
        'host':      host,
        'label':     label,
        'reachable': True,
        'sent':      sent,
        'received':  recv,
        'lost':      lost,
        'loss_pct':  loss_pct,
        'min_ms':    min(rtts),
        'avg_ms':    round(statistics.mean(rtts), 1),
        'max_ms':    max(rtts),
        'jitter_ms': round(statistics.stdev(rtts), 1) if len(rtts) > 1 else 0.0,
        'rtts':      rtts,
    }


def test_dns(domains=None):
    """Resolve a set of domains and measure response time."""
    domains = domains or ['google.com', 'cloudflare.com', 'microsoft.com']
    results = []
    for domain in domains:
        try:
            t0 = datetime.now()
            addr = socket.gethostbyname(domain)
            elapsed_ms = round((datetime.now() - t0).total_seconds() * 1000, 1)
            results.append({'domain': domain, 'ip': addr, 'ms': elapsed_ms, 'ok': True})
        except Exception as e:
            results.append({'domain': domain, 'ip': None, 'ms': None, 'ok': False, 'err': str(e)})
    return results


# ─────────────────────────────────────────────────────────────────────────────
# ANALYSIS
# ─────────────────────────────────────────────────────────────────────────────

def analyze_channels(networks, interface):
    """Build per-channel AP counts from the scanned network list."""
    ch_24  = defaultdict(int)
    ch_5   = defaultdict(int)
    ch_aps = defaultdict(list)

    for net in networks:
        for b in net.get('bssids', []):
            ch_str = b.get('channel')
            if not ch_str:
                continue
            try:
                ch = int(ch_str)
            except ValueError:
                continue
            band = b.get('band', 'Unknown')
            ch_aps[ch].append({
                'ssid':   net.get('ssid', 'Hidden'),
                'bssid':  b.get('bssid', ''),
                'signal': b.get('signal', ''),
                'band':   band,
            })
            if band == '2.4 GHz':
                ch_24[ch] += 1
            elif band == '5 GHz':
                ch_5[ch] += 1

    my_ch = None
    if 'channel' in interface:
        try:
            my_ch = int(interface['channel'])
        except ValueError:
            pass

    return {
        'ch_24':     dict(ch_24),
        'ch_5':      dict(ch_5),
        'ch_aps':    dict(ch_aps),
        'my_ch':     my_ch,
        'total_aps': sum(len(n.get('bssids', [])) for n in networks),
        'total_nets': len(networks),
    }


def assess_security(auth, cipher):
    """Return (level, description) for the current connection's security."""
    a = (auth or '').lower()
    ci = (cipher or '').lower()

    if 'wpa3' in a and 'sae' in a:
        return 'Excellent', 'WPA3-Personal (SAE) — strongest consumer WiFi security available'
    if 'wpa3' in a:
        return 'Excellent', 'WPA3 authentication — modern, strong security'
    if 'wpa2' in a and ('ccmp' in ci or 'aes' in ci):
        return 'Good', 'WPA2-Personal/Enterprise with AES-CCMP — solid security'
    if 'wpa2' in a and 'tkip' in ci:
        return 'Fair', 'WPA2 with TKIP is deprecated — change cipher to AES/CCMP in router settings'
    if 'wpa2' in a:
        return 'Good', 'WPA2 — adequate security; ensure AES/CCMP cipher is used'
    if 'wpa' in a:
        return 'Poor', 'WPA (original) has known vulnerabilities — upgrade to WPA2 or WPA3'
    if 'wep' in a:
        return 'Critical', 'WEP is completely broken and provides zero real security — upgrade immediately'
    if 'open' in a or not a:
        return 'None', 'Open / unencrypted network — all traffic visible to nearby devices'
    return 'Unknown', f'Auth: {auth}  Cipher: {cipher}'


def driver_age_years(date_str):
    """Return driver age in years, or None if unparseable."""
    for fmt in ('%m/%d/%Y', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            d = datetime.strptime(date_str.strip(), fmt)
            return round((datetime.now() - d).days / 365.25, 1)
        except ValueError:
            continue
    return None


def compute_score(interface, ping_gw, ch_analysis):
    """Compute an overall WiFi health score (0–100) with a letter grade."""
    breakdown = {}
    reasons   = []

    # ── Signal (40 pts) ──────────────────────────────────────────
    dbm = interface.get('signal_dbm')
    if dbm is None:
        sig_pts = 20
    elif dbm >= -50:
        sig_pts = 40
    elif dbm >= -60:
        sig_pts = 32
    elif dbm >= -70:
        sig_pts = 20
        reasons.append(f"Weak signal ({dbm:.0f} dBm — only fair)")
    elif dbm >= -80:
        sig_pts = 10
        reasons.append(f"Poor signal ({dbm:.0f} dBm)")
    else:
        sig_pts = 0
        reasons.append(f"Very poor signal ({dbm:.0f} dBm — likely unusable)")
    breakdown['signal'] = sig_pts

    # ── Latency / packet loss (30 pts) ───────────────────────────
    lat_pts = 30
    if ping_gw and ping_gw.get('reachable'):
        avg = ping_gw.get('avg_ms') or 0
        loss = ping_gw.get('loss_pct', 0)
        if avg > 100:
            lat_pts -= 20
            reasons.append(f"High gateway latency ({avg} ms)")
        elif avg > 50:
            lat_pts -= 10
            reasons.append(f"Elevated gateway latency ({avg} ms)")
        elif avg > 20:
            lat_pts -= 5
        if loss > 10:
            lat_pts = max(0, lat_pts - 15)
            reasons.append(f"Significant packet loss to gateway ({loss}%)")
        elif loss > 0:
            lat_pts = max(0, lat_pts - 5)
            reasons.append(f"Some packet loss to gateway ({loss}%)")
    elif ping_gw and not ping_gw.get('reachable'):
        lat_pts = 0
        reasons.append("Cannot reach default gateway")
    breakdown['latency'] = max(0, lat_pts)

    # ── Channel congestion (15 pts) ──────────────────────────────
    cong_pts = 15
    my_ch = ch_analysis.get('my_ch')
    if my_ch and my_ch <= 14:
        count = ch_analysis['ch_24'].get(my_ch, 0)
        if count > 5:
            cong_pts = 2
            reasons.append(f"Severe 2.4 GHz congestion — {count} APs on channel {my_ch}")
        elif count > 3:
            cong_pts = 7
            reasons.append(f"Moderate channel congestion ({count} APs on ch{my_ch})")
        elif count > 1:
            cong_pts = 11
    breakdown['congestion'] = cong_pts

    # ── Radio generation (15 pts) ────────────────────────────────
    radio = (interface.get('radio_type') or '').lower()
    if '802.11be' in radio:
        radio_pts = 15
    elif '802.11ax' in radio:
        radio_pts = 14
    elif '802.11ac' in radio:
        radio_pts = 11
    elif '802.11n' in radio:
        radio_pts = 7
        reasons.append("Wi-Fi 4 (802.11n) — 5/6 GHz upgrade would improve throughput")
    elif '802.11g' in radio or '802.11a' in radio:
        radio_pts = 3
        reasons.append("Legacy WiFi standard (802.11a/g) — severely limits speeds")
    elif '802.11b' in radio:
        radio_pts = 1
        reasons.append("802.11b is extremely slow — hardware upgrade strongly recommended")
    else:
        radio_pts = 7
    breakdown['radio'] = radio_pts

    total = sum(breakdown.values())
    if   total >= 85: grade, label = 'A', 'Excellent'
    elif total >= 70: grade, label = 'B', 'Good'
    elif total >= 55: grade, label = 'C', 'Fair'
    elif total >= 40: grade, label = 'D', 'Poor'
    else:             grade, label = 'F', 'Very Poor'

    return {'score': total, 'grade': grade, 'label': label,
            'breakdown': breakdown, 'reasons': reasons}


def generate_recommendations(interface, ch_analysis, security_tuple, pings, dns, driver):
    """Return a list of actionable recommendation strings."""
    recs = []
    sec_level, _ = security_tuple

    # Signal
    dbm = (interface or {}).get('signal_dbm')
    if dbm is not None and dbm < -70:
        recs.append(
            f"SIGNAL: Signal is {dbm:.0f} dBm — below the reliable threshold. "
            "Move closer to the AP, remove obstructions, or add a mesh node/extender."
        )
    elif dbm is not None and dbm < -60:
        recs.append("SIGNAL: Signal is fair. Moving closer to the AP or repositioning the router would improve performance.")

    # Band steering
    band = (interface or {}).get('band', '')
    if band == '2.4 GHz':
        recs.append(
            "BAND: You are on 2.4 GHz. If your router supports 5 GHz or 6 GHz, "
            "connect to that band for higher throughput and less interference."
        )

    # Channel congestion (2.4 GHz)
    my_ch = ch_analysis.get('my_ch')
    if my_ch and my_ch <= 14:
        count = ch_analysis['ch_24'].get(my_ch, 0)
        if count > 3:
            best = min(NON_OVERLAPPING_24, key=lambda ch: ch_analysis['ch_24'].get(ch, 0))
            recs.append(
                f"CHANNEL: Channel {my_ch} is congested ({count} APs). "
                f"Change your router to channel {best} (least congested non-overlapping channel)."
            )
        elif my_ch not in NON_OVERLAPPING_24:
            recs.append(
                f"CHANNEL: Channel {my_ch} overlaps adjacent channels. "
                "Use channels 1, 6, or 11 on 2.4 GHz to avoid interference."
            )

    # Security
    if sec_level == 'Critical':
        recs.append("SECURITY: CRITICAL — WEP encryption is completely broken. Change your router to WPA3 or WPA2-AES immediately.")
    elif sec_level == 'None':
        recs.append("SECURITY: This is an open (unencrypted) network. All traffic is visible. Avoid using sensitive services.")
    elif sec_level == 'Poor':
        recs.append("SECURITY: WPA (original) has known vulnerabilities. Upgrade your router/AP to WPA2-AES or WPA3.")
    elif sec_level == 'Fair':
        recs.append("SECURITY: WPA2-TKIP is deprecated. Update your router cipher to AES/CCMP in wireless security settings.")
    elif sec_level in ('Good', 'Excellent'):
        recs.append("SECURITY: Security configuration is good. Ensure your router admin password is strong and firmware is current.")

    # Packet loss / latency
    for pr in pings:
        if pr.get('label') == 'Default Gateway':
            if not pr.get('reachable'):
                recs.append("GATEWAY: Cannot reach the default gateway. Verify the router is online and IP configuration is correct.")
            else:
                if pr.get('loss_pct', 0) > 5:
                    recs.append(
                        f"PACKET LOSS: {pr['loss_pct']}% packet loss to the gateway indicates RF interference, "
                        "driver issues, or a heavily loaded AP."
                    )
                if pr.get('avg_ms', 0) and pr['avg_ms'] > 50:
                    recs.append(
                        f"LATENCY: Gateway RTT averages {pr['avg_ms']} ms, which is high for a local connection. "
                        "Check for AP overload, interference, or distance."
                    )

    # Radio generation
    radio = (interface or {}).get('radio_type', '').lower()
    if '802.11b' in radio or '802.11g' in radio:
        recs.append("RADIO: 802.11b/g hardware is severely speed-limited. Replace adapter and router with at minimum Wi-Fi 5 (802.11ac).")
    elif '802.11n' in radio:
        recs.append("RADIO: Wi-Fi 4 (802.11n) is in use. Upgrading to Wi-Fi 5 (802.11ac) or Wi-Fi 6 (802.11ax) equipment offers much higher throughput.")

    # PHY rate sanity check
    try:
        rx = float((interface or {}).get('receive_rate', 0))
        if rx < 54 and band == '5 GHz':
            recs.append(
                f"PHY RATE: Receive rate is only {rx} Mbps on 5 GHz. "
                "This indicates poor signal, a legacy fallback mode, or interference. Move closer to the AP."
            )
    except (ValueError, TypeError):
        pass

    # DNS
    if dns and not any(r['ok'] for r in dns):
        recs.append("DNS: All external DNS lookups failed — no internet connectivity, or DNS server is misconfigured.")

    # Driver age
    age = driver_age_years(driver.get('date', ''))
    if age and age > 2:
        recs.append(
            f"DRIVER: WiFi driver is approximately {age:.0f} year(s) old. "
            "Updating to the latest vendor driver may improve stability, speed, and security."
        )

    if not recs:
        recs.append("All measured parameters are within healthy ranges. No significant issues detected.")

    return recs


# ─────────────────────────────────────────────────────────────────────────────
# TERMINAL REPORT
# ─────────────────────────────────────────────────────────────────────────────

def print_report(interface, networks, driver, stats, ip, pings, dns,
                 ch, security, score, arp_mac):

    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    grade_color = {'A': 'green', 'B': 'green', 'C': 'yellow', 'D': 'orange', 'F': 'red'}

    header(f"WiFi ENGINEER SURVEY  ·  {ts}")

    # ─── Overall Score ───────────────────────────────────────────
    g = score['grade']
    gc = grade_color.get(g, 'gray')
    print(f"\n  Overall Health Score: {c(str(score['score']) + '/100', gc + '')}  "
          f"{c('[' + g + ']', gc)}  {c(score['label'], gc)}")
    if score['reasons']:
        print(f"  {c('Issues:', 'yellow')}")
        for r in score['reasons']:
            print(f"    • {c(r, 'yellow')}")

    # ─── Current Connection ──────────────────────────────────────
    section("CURRENT CONNECTION")
    if not interface:
        print(c("  No active WiFi connection detected.", 'red'))
    else:
        state = interface.get('state', 'N/A')
        state_c = 'green' if 'connected' in state.lower() else 'red'
        print(fmt("Status",          c(state.upper(), state_c)))
        print(fmt("SSID",            interface.get('ssid', 'N/A')))
        print(fmt("BSSID (AP MAC)",  interface.get('bssid', 'N/A')))
        print(fmt("Interface Name",  interface.get('name', 'N/A')))
        print(fmt("Adapter MAC",     interface.get('physical_address', 'N/A')))
        print(fmt("Profile",         interface.get('profile', 'N/A')))
        print(fmt("Network Type",    interface.get('network_type', 'N/A')))
        print(fmt("Connection Mode", interface.get('connection_mode', 'N/A')))

    # ─── Radio & Signal ──────────────────────────────────────────
    section("RADIO & SIGNAL")
    if interface:
        rt = interface.get('radio_type', 'N/A')
        rt_label = RADIO_GENERATIONS.get(rt, rt)
        dbm = interface.get('signal_dbm')
        q_label, q_color = dbm_quality(dbm)
        sig_pct = interface.get('signal', 'N/A')
        dbm_str = f" (~{dbm:.1f} dBm)" if dbm is not None else ""

        print(fmt("Radio Standard",   rt_label))
        print(fmt("Frequency Band",   interface.get('band', 'N/A')))
        print(fmt("Channel",          interface.get('channel', 'N/A')))
        print(fmt("Signal Strength",  f"{sig_pct}{dbm_str}"))
        print(fmt("Signal Quality",   c(q_label, q_color)))
        print(fmt("PHY Receive Rate", f"{interface.get('receive_rate','N/A')} Mbps"))
        print(fmt("PHY Transmit Rate",f"{interface.get('transmit_rate','N/A')} Mbps"))

        # Visual signal bar
        if dbm is not None:
            filled = max(0, min(30, int((dbm + 100) / (50 / 30))))
            bar = c('█' * filled, q_color) + c('░' * (30 - filled), 'gray')
            print(f"\n  Signal:  [{bar}]  {sig_pct}{dbm_str}")

    # ─── Security ────────────────────────────────────────────────
    section("SECURITY ASSESSMENT")
    if interface:
        sec_level, sec_desc = security
        sec_colors = {'Excellent': 'green', 'Good': 'green', 'Fair': 'yellow',
                      'Poor': 'orange', 'Critical': 'red', 'None': 'red'}
        print(fmt("Authentication",  interface.get('authentication', 'N/A')))
        print(fmt("Cipher",          interface.get('cipher', 'N/A')))
        print(fmt("Security Level",  c(sec_level, sec_colors.get(sec_level, 'gray'))))
        print(f"  {c('↳ ' + sec_desc, 'gray')}")
        if driver.get('mfp_80211w'):
            print(fmt("802.11w MFP",     driver['mfp_80211w']))
        if driver.get('fips_mode'):
            print(fmt("FIPS 140-2 Mode", driver['fips_mode']))

    # ─── IP Configuration ────────────────────────────────────────
    section("IP CONFIGURATION")
    if ip:
        print(fmt("IPv4 Address",    ip.get('ipv4', 'N/A')))
        print(fmt("Subnet Mask",     ip.get('subnet_mask', 'N/A')))
        gw = ip.get('gateway_ip') or ip.get('default_gateway', 'N/A')
        gw_str = f"{gw}  (MAC: {arp_mac})" if arp_mac else gw
        print(fmt("Default Gateway", gw_str))
        print(fmt("DHCP Enabled",    ip.get('dhcp_enabled', 'N/A')))
        print(fmt("DHCP Server",     ip.get('dhcp_server', 'N/A')))
        print(fmt("Lease Obtained",  ip.get('lease_obtained', 'N/A')))
        print(fmt("Lease Expires",   ip.get('lease_expires', 'N/A')))
        dns_ips = ip.get('dns_list', [])
        print(fmt("DNS Servers",     ', '.join(dns_ips) if dns_ips else ip.get('dns_servers', 'N/A')))
        if ip.get('ipv6_link_local'):
            print(fmt("IPv6 Link-Local",ip['ipv6_link_local']))

    # ─── Latency ─────────────────────────────────────────────────
    section("LATENCY & PACKET LOSS")
    col = f"  {'Target':<28} {'Min':>6} {'Avg':>6} {'Max':>6} {'Jitter':>8} {'Loss':>6}  Quality"
    print(col)
    print(f"  {'─'*28} {'─'*6} {'─'*6} {'─'*6} {'─'*8} {'─'*6}  {'─'*20}")
    for pr in pings:
        if pr.get('reachable'):
            ql, qc = latency_quality(pr.get('avg_ms'))
            print(f"  {pr['label']:<28} "
                  f"{str(pr['min_ms'])+'ms':>6} "
                  f"{str(pr['avg_ms'])+'ms':>6} "
                  f"{str(pr['max_ms'])+'ms':>6} "
                  f"{'±'+str(pr['jitter_ms'])+'ms':>8} "
                  f"{str(pr['loss_pct'])+'%':>6}  "
                  f"{c(ql, qc)}")
        else:
            print(f"  {pr['label']:<28} {'—':>6} {'—':>6} {'—':>6} {'—':>8} {'—':>6}  "
                  f"{c('UNREACHABLE', 'red')}")

    # ─── DNS ─────────────────────────────────────────────────────
    section("DNS RESOLUTION (requires internet)")
    for dr in dns:
        if dr['ok']:
            print(f"  {c('✓', 'green')} {dr['domain']:<28}  → {dr['ip']:<18}  ({dr['ms']} ms)")
        else:
            print(f"  {c('✗', 'red')} {dr['domain']:<28}  {c('FAILED: ' + dr.get('err','?'), 'red')}")

    # ─── Nearby Networks ─────────────────────────────────────────
    section(f"NEARBY NETWORKS  ({ch['total_nets']} SSIDs  /  {ch['total_aps']} APs visible)")
    my_bssid = (interface or {}).get('bssid', '').lower()
    all_aps = []
    for net in networks:
        for b in net.get('bssids', []):
            all_aps.append({
                'ssid':    net.get('ssid', 'Hidden'),
                'bssid':   b.get('bssid', ''),
                'dbm':     b.get('signal_dbm'),
                'sig':     b.get('signal', ''),
                'ch':      b.get('channel', ''),
                'band':    b.get('band', ''),
                'radio':   b.get('radio_type', ''),
                'auth':    net.get('authentication', ''),
                'mine':    b.get('bssid', '').lower() == my_bssid,
            })
    all_aps.sort(key=lambda x: x['dbm'] or -100, reverse=True)

    hdr = f"  {'SSID':<30} {'BSSID':<20} {'Ch':>4} {'Band':<8} {'Signal':<14} {'Auth'}"
    print(hdr)
    print(f"  {'─'*30} {'─'*20} {'─'*4} {'─'*8} {'─'*14} {'─'*16}")
    for ap in all_aps[:40]:
        ql, qc = dbm_quality(ap['dbm'])
        dbm_str = f"({ap['dbm']:.0f}dBm)" if ap['dbm'] else ''
        sig_str = f"{ap['sig']} {dbm_str}"
        marker = c(' ◄ YOU', 'cyan') if ap['mine'] else ''
        print(f"  {ap['ssid'][:29]:<30} {ap['bssid']:<20} {ap['ch']:>4} "
              f"{ap['band']:<8} {c(sig_str[:13], qc):<14} {ap['auth'][:16]}{marker}")
    if len(all_aps) > 40:
        print(f"  {c(f'... and {len(all_aps) - 40} more APs not shown', 'gray')}")

    # ─── Channel Map ─────────────────────────────────────────────
    section("CHANNEL CONGESTION MAP")
    my_ch = ch.get('my_ch')

    if ch['ch_24']:
        print("  2.4 GHz  (★ = non-overlapping, ◄ = your channel):")
        for chn in sorted(ch['ch_24'].keys()):
            cnt = ch['ch_24'][chn]
            bar_c = 'red' if cnt > 4 else 'yellow' if cnt > 2 else 'green'
            bar = c('█' * cnt, bar_c)
            tag = (' ★' if chn in NON_OVERLAPPING_24 else '  ')
            marker = c(' ◄ YOUR CHANNEL', 'cyan') if chn == my_ch else ''
            print(f"    Ch {chn:>2}{tag}: {bar} ({cnt}){marker}")

    if ch['ch_5']:
        print("  5 GHz:")
        for chn in sorted(ch['ch_5'].keys()):
            cnt = ch['ch_5'][chn]
            bar_c = 'red' if cnt > 3 else 'yellow' if cnt > 1 else 'green'
            bar = c('█' * cnt, bar_c)
            marker = c(' ◄ YOUR CHANNEL', 'cyan') if chn == my_ch else ''
            print(f"    Ch {chn:>3}  : {bar} ({cnt}){marker}")

    # ─── 802.11 Statistics ───────────────────────────────────────
    if stats:
        section("802.11 FRAME STATISTICS (since last association)")
        print(fmt("Frames Transmitted",  f"{stats.get('frames_tx', 'N/A'):,}"))
        print(fmt("Frames Received",     f"{stats.get('frames_rx', 'N/A'):,}"))
        print(fmt("Frames Dropped (TX)", f"{stats.get('frames_dropped_tx', 'N/A'):,}"))
        print(fmt("Beacons Received",    f"{stats.get('beacons_rx', 'N/A'):,}"))
        print(fmt("ACK Timeouts",        f"{stats.get('err_ack_timeout', 'N/A'):,}"))
        print(fmt("CTS Timeouts",        f"{stats.get('err_cts_timeout', 'N/A'):,}"))
        print(fmt("TX Retries",          f"{stats.get('err_failed_tx', 'N/A'):,}"))
        # Compute retry rate
        tx = stats.get('frames_tx', 0)
        retry = stats.get('err_failed_tx', 0)
        if tx and retry is not None and tx > 0:
            retry_rate = round(retry / tx * 100, 2)
            retry_color = 'green' if retry_rate < 5 else 'yellow' if retry_rate < 15 else 'red'
            print(fmt("TX Retry Rate",   c(f"{retry_rate}%", retry_color)))

    # ─── Adapter & Driver ────────────────────────────────────────
    section("WIFI ADAPTER & DRIVER")
    if driver:
        print(fmt("Adapter",          driver.get('description', 'N/A')))
        print(fmt("Vendor",           driver.get('vendor', 'N/A')))
        print(fmt("Driver Version",   driver.get('version', 'N/A')))
        date_str = driver.get('date', 'N/A')
        age = driver_age_years(date_str)
        age_note = f"  ({age:.0f} year{'s' if age != 1 else ''} old — update recommended)" if age and age > 2 else ""
        age_color = 'yellow' if age and age > 2 else 'green'
        print(fmt("Driver Date",      f"{date_str}{c(age_note, age_color)}"))
        print(fmt("Radio Types",      driver.get('radio_types', 'N/A')))
        print(fmt("Hosted Network",   driver.get('hosted_net', 'N/A')))

    # ─── Recommendations ─────────────────────────────────────────
    section("ENGINEER RECOMMENDATIONS")
    recs = generate_recommendations(interface, ch, security, pings, dns, driver)
    for i, r in enumerate(recs, 1):
        first_colon = r.find(':')
        if first_colon > 0:
            tag = r[:first_colon]
            rest = r[first_colon:]
            print(f"  {i:>2}. {c(tag, 'cyan')}{rest}")
        else:
            print(f"  {i:>2}. {r}")

    print()
    hr('═')
    print(f"  Survey complete  ·  {ts}  ·  WiFi Survey Tool v{VERSION}")
    hr('═')
    print()


# ─────────────────────────────────────────────────────────────────────────────
# HTML REPORT
# ─────────────────────────────────────────────────────────────────────────────

def _html_color(color_name):
    return {'green': '#2ecc71', 'yellow': '#f1c40f', 'orange': '#e67e22',
            'red': '#e74c3c', 'gray': '#7f8c8d', 'cyan': '#00bcd4'}.get(color_name, '#ccc')


def generate_html(interface, networks, driver, stats, ip, pings, dns,
                  ch, security, score, arp_mac, output_path):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    sec_level, sec_desc = security

    grade_hex = {'A': '#2ecc71', 'B': '#27ae60', 'C': '#f1c40f',
                 'D': '#e67e22', 'F': '#e74c3c'}.get(score['grade'], '#7f8c8d')
    sec_hex = {'Excellent': '#2ecc71', 'Good': '#27ae60', 'Fair': '#f1c40f',
               'Poor': '#e67e22', 'Critical': '#e74c3c', 'None': '#e74c3c'}.get(sec_level, '#aaa')

    # ── Ping table rows ──
    ping_rows = ''
    for pr in pings:
        if pr.get('reachable'):
            ql, qc = latency_quality(pr.get('avg_ms'))
            qh = _html_color(qc)
            ping_rows += (
                f"<tr><td>{pr['label']}</td><td style='font-family:monospace'>{pr['host']}</td>"
                f"<td>{pr['min_ms']} ms</td><td>{pr['avg_ms']} ms</td><td>{pr['max_ms']} ms</td>"
                f"<td>±{pr['jitter_ms']} ms</td><td>{pr['loss_pct']}%</td>"
                f"<td><b style='color:{qh}'>{ql}</b></td></tr>\n"
            )
        else:
            ping_rows += (
                f"<tr><td>{pr['label']}</td><td style='font-family:monospace'>{pr['host']}</td>"
                f"<td colspan='5' style='color:#888'>—</td>"
                f"<td><b style='color:#e74c3c'>UNREACHABLE</b></td></tr>\n"
            )

    # ── DNS rows ──
    dns_rows = ''
    for dr in dns:
        if dr['ok']:
            dns_rows += (
                f"<tr><td style='color:#2ecc71'>✓</td><td>{dr['domain']}</td>"
                f"<td style='font-family:monospace'>{dr['ip']}</td><td>{dr['ms']} ms</td></tr>\n"
            )
        else:
            dns_rows += (
                f"<tr><td style='color:#e74c3c'>✗</td><td>{dr['domain']}</td>"
                f"<td colspan='2' style='color:#e74c3c'>FAILED — {dr.get('err','')}</td></tr>\n"
            )

    # ── Nearby AP rows ──
    my_bssid = (interface or {}).get('bssid', '').lower()
    all_aps = []
    for net in networks:
        for b in net.get('bssids', []):
            all_aps.append({
                'ssid': net.get('ssid', 'Hidden'),
                'bssid': b.get('bssid', ''),
                'dbm': b.get('signal_dbm'),
                'sig': b.get('signal', ''),
                'ch': b.get('channel', ''),
                'band': b.get('band', ''),
                'radio': b.get('radio_type', ''),
                'auth': net.get('authentication', ''),
                'mine': b.get('bssid', '').lower() == my_bssid,
            })
    all_aps.sort(key=lambda x: x['dbm'] or -100, reverse=True)
    ap_rows = ''
    for ap in all_aps:
        ql, qc = dbm_quality(ap['dbm'])
        qh = _html_color(qc)
        dbm_str = f" ({ap['dbm']:.0f} dBm)" if ap['dbm'] else ''
        row_bg = " style='background:#0e2a1a'" if ap['mine'] else ''
        mine = ' <span style="color:#00bcd4">◄ YOU</span>' if ap['mine'] else ''
        ap_rows += (
            f"<tr{row_bg}>"
            f"<td>{ap['ssid']}{mine}</td>"
            f"<td style='font-family:monospace;font-size:12px'>{ap['bssid']}</td>"
            f"<td>{ap['ch']}</td><td>{ap['band']}</td>"
            f"<td><span style='color:{qh}'>{ap['sig']}{dbm_str}</span></td>"
            f"<td>{ap['radio']}</td><td>{ap['auth']}</td>"
            f"</tr>\n"
        )

    # ── 2.4 GHz channel bar chart ──
    ch_24_bars = ''
    max_24 = max(ch['ch_24'].values(), default=1) or 1
    my_ch = ch.get('my_ch')
    for chn in range(1, 15):
        cnt = ch['ch_24'].get(chn, 0)
        h = max(int(cnt / max_24 * 80), 2 if cnt > 0 else 0)
        is_mine = chn == my_ch
        is_no = chn in NON_OVERLAPPING_24
        col = '#00bcd4' if is_mine else ('#e74c3c' if cnt > 4 else '#f1c40f' if cnt > 2 else '#2ecc71')
        border = '3px solid #fff' if is_mine else '1px solid #333'
        label = f"Ch{chn}" + ("★" if is_no else "")
        tooltip = f"{cnt} AP{'s' if cnt != 1 else ''} on ch{chn}"
        ch_24_bars += (
            f"<div style='display:inline-flex;flex-direction:column;align-items:center;"
            f"margin:2px;width:36px' title='{tooltip}'>"
            f"<span style='font-size:10px;color:#aaa'>{cnt if cnt else ''}</span>"
            f"<div style='width:28px;height:{h}px;background:{col};"
            f"border:{border};border-radius:3px 3px 0 0'></div>"
            f"<span style='font-size:9px;color:#888;margin-top:2px'>{label}</span>"
            f"</div>"
        )

    # ── 5 GHz channel bar chart ──
    ch_5_bars = ''
    if ch['ch_5']:
        max_5 = max(ch['ch_5'].values(), default=1) or 1
        for chn in sorted(ch['ch_5'].keys()):
            cnt = ch['ch_5'][chn]
            h = max(int(cnt / max_5 * 80), 2)
            is_mine = chn == my_ch
            col = '#00bcd4' if is_mine else ('#e74c3c' if cnt > 3 else '#f1c40f' if cnt > 1 else '#2ecc71')
            border = '3px solid #fff' if is_mine else '1px solid #333'
            tooltip = f"{cnt} AP{'s' if cnt != 1 else ''} on ch{chn}"
            ch_5_bars += (
                f"<div style='display:inline-flex;flex-direction:column;align-items:center;"
                f"margin:2px;width:44px' title='{tooltip}'>"
                f"<span style='font-size:10px;color:#aaa'>{cnt}</span>"
                f"<div style='width:36px;height:{h}px;background:{col};"
                f"border:{border};border-radius:3px 3px 0 0'></div>"
                f"<span style='font-size:9px;color:#888;margin-top:2px'>Ch{chn}</span>"
                f"</div>"
            )

    # ── Statistics section ──
    stats_html = ''
    if stats:
        tx = stats.get('frames_tx', 0)
        retry = stats.get('err_failed_tx', 0)
        retry_rate = round(retry / tx * 100, 2) if tx else 0
        rrc = '#2ecc71' if retry_rate < 5 else '#f1c40f' if retry_rate < 15 else '#e74c3c'
        stats_html = f"""
        <div class="card section">
          <h3>802.11 Frame Statistics</h3>
          <div class="grid2">
            <div>
              <div class="kv"><span>Frames TX</span><span>{stats.get('frames_tx',0):,}</span></div>
              <div class="kv"><span>Frames RX</span><span>{stats.get('frames_rx',0):,}</span></div>
              <div class="kv"><span>Frames Dropped (TX)</span><span>{stats.get('frames_dropped_tx',0):,}</span></div>
              <div class="kv"><span>Beacons Received</span><span>{stats.get('beacons_rx',0):,}</span></div>
            </div>
            <div>
              <div class="kv"><span>ACK Timeouts</span><span>{stats.get('err_ack_timeout',0):,}</span></div>
              <div class="kv"><span>CTS Timeouts</span><span>{stats.get('err_cts_timeout',0):,}</span></div>
              <div class="kv"><span>TX Retries</span><span>{stats.get('err_failed_tx',0):,}</span></div>
              <div class="kv"><span>TX Retry Rate</span>
                <span style="color:{rrc};font-weight:bold">{retry_rate}%</span></div>
            </div>
          </div>
        </div>"""

    # ── Recommendations ──
    recs = generate_recommendations(interface, ch, security, pings, dns, driver)
    rec_items = ''.join(f'<li>{r}</li>' for r in recs)

    # ── Score breakdown bars ──
    bd = score['breakdown']
    def score_bar(val, max_val, color):
        pct = int(val / max_val * 100)
        return (f"<div style='background:#1a1d2e;border-radius:4px;height:10px;margin-top:4px'>"
                f"<div style='background:{color};width:{pct}%;height:10px;border-radius:4px'></div></div>")

    dbm = (interface or {}).get('signal_dbm')
    sig_label, sig_c = dbm_quality(dbm)
    sig_hex = _html_color(sig_c)

    gw_ip = (ip or {}).get('gateway_ip') or (ip or {}).get('default_gateway', 'N/A')
    gw_str = f"{gw_ip} (MAC: {arp_mac})" if arp_mac else gw_ip

    # Driver age warning
    driver_age = driver_age_years(driver.get('date', ''))
    drv_date_note = ''
    if driver_age and driver_age > 2:
        drv_date_note = f' <span style="color:#f1c40f">(~{driver_age:.0f} yr old — update recommended)</span>'

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WiFi Survey — {ts}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #0d0f1a; color: #dde1f0; font-family: 'Segoe UI', system-ui, sans-serif;
            font-size: 14px; padding: 24px; line-height: 1.5; }}
    h1   {{ color: #fff; font-size: 22px; }}
    h3   {{ color: #7fdbff; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;
            margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #1e2235; }}
    .subtitle {{ color: #555; margin-bottom: 24px; font-size: 12px; }}
    .top-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 20px; }}
    .card  {{ background: #13162a; border: 1px solid #1e2348; border-radius: 10px; padding: 18px; }}
    .section {{ margin-bottom: 20px; }}
    table  {{ width: 100%; border-collapse: collapse; }}
    th {{ color: #555; font-size: 11px; text-align: left; padding: 5px 8px;
          border-bottom: 1px solid #1e2235; text-transform: uppercase; }}
    td {{ padding: 6px 8px; border-bottom: 1px solid #0f1120; font-size: 13px; vertical-align: top; }}
    tr:hover td {{ background: #191d35; }}
    .kv   {{ display: flex; justify-content: space-between; padding: 5px 0;
              border-bottom: 1px solid #0f1120; }}
    .kv span:first-child {{ color: #666; }}
    .kv span:last-child  {{ color: #e0e4ff; font-weight: 500; }}
    .grid2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
    .score-ring {{ width: 110px; height: 110px; border-radius: 50%;
                   border: 5px solid {grade_hex}; display: flex; flex-direction: column;
                   align-items: center; justify-content: center; margin: 0 auto 12px; }}
    .score-num   {{ font-size: 32px; font-weight: 700; color: {grade_hex}; line-height: 1; }}
    .score-grade {{ font-size: 18px; color: {grade_hex}; }}
    .score-lbl   {{ font-size: 11px; color: #555; margin-top: 2px; }}
    .issue-list  {{ list-style: none; padding: 0; margin-top: 8px; }}
    .issue-list li {{ color: #f1c40f; font-size: 12px; padding: 2px 0; }}
    .issue-list li::before {{ content: '• '; }}
    .recs {{ list-style: none; padding: 0; }}
    .recs li {{ padding: 7px 0; border-bottom: 1px solid #0f1120; font-size: 13px; }}
    .ch-chart {{ display: flex; align-items: flex-end; min-height: 110px;
                 padding: 8px; background: #0a0c18; border-radius: 6px;
                 overflow-x: auto; flex-wrap: nowrap; gap: 2px; }}
    .legend {{ font-size: 11px; color: #555; margin-bottom: 8px; }}
    @media (max-width: 600px) {{ .top-grid {{ grid-template-columns: 1fr; }} .grid2 {{ grid-template-columns: 1fr; }} }}
    @media print {{ body {{ background: #fff; color: #000; }}
                    .card {{ border: 1px solid #ccc; background: #f8f8f8; }} }}
  </style>
</head>
<body>
<h1>WiFi Engineer Survey Report</h1>
<p class="subtitle">
  Generated: {ts} &nbsp;·&nbsp;
  Host: {platform.node()} &nbsp;·&nbsp;
  OS: {platform.version()} &nbsp;·&nbsp;
  Tool v{VERSION}
</p>

<div class="top-grid">

  <!-- Overall Score -->
  <div class="card">
    <h3>Overall Health</h3>
    <div class="score-ring">
      <span class="score-num">{score['score']}</span>
      <span class="score-grade">{score['grade']}</span>
      <span class="score-lbl">{score['label']}</span>
    </div>
    <div class="kv"><span>Signal</span><span>{bd.get('signal',0)} / 40 pts</span></div>
    {score_bar(bd.get('signal',0), 40, grade_hex)}
    <div class="kv" style="margin-top:6px"><span>Latency / Loss</span><span>{bd.get('latency',0)} / 30 pts</span></div>
    {score_bar(bd.get('latency',0), 30, grade_hex)}
    <div class="kv" style="margin-top:6px"><span>Channel Congestion</span><span>{bd.get('congestion',0)} / 15 pts</span></div>
    {score_bar(bd.get('congestion',0), 15, grade_hex)}
    <div class="kv" style="margin-top:6px"><span>Radio Generation</span><span>{bd.get('radio',0)} / 15 pts</span></div>
    {score_bar(bd.get('radio',0), 15, grade_hex)}
    {"<ul class='issue-list' style='margin-top:10px'>" + ''.join(f'<li>{r}</li>' for r in score['reasons']) + '</ul>' if score['reasons'] else ''}
  </div>

  <!-- Connection Details -->
  <div class="card">
    <h3>Connection Details</h3>
    <div class="kv"><span>Status</span>
      <span style="color:{'#2ecc71' if 'connected' in str((interface or {}).get('state','')).lower() else '#e74c3c'};font-weight:bold">
        {str((interface or {}).get('state','N/A')).upper()}
      </span>
    </div>
    <div class="kv"><span>SSID</span><span>{(interface or {}).get('ssid','N/A')}</span></div>
    <div class="kv"><span>BSSID (AP MAC)</span><span style="font-family:monospace;font-size:12px">{(interface or {}).get('bssid','N/A')}</span></div>
    <div class="kv"><span>Adapter MAC</span><span style="font-family:monospace;font-size:12px">{(interface or {}).get('physical_address','N/A')}</span></div>
    <div class="kv"><span>Band</span><span>{(interface or {}).get('band','N/A')}</span></div>
    <div class="kv"><span>Channel</span><span>{(interface or {}).get('channel','N/A')}</span></div>
    <div class="kv"><span>Radio Standard</span><span>{RADIO_GENERATIONS.get((interface or {}).get('radio_type',''), (interface or {}).get('radio_type','N/A'))}</span></div>
    <div class="kv"><span>PHY RX Rate</span><span>{(interface or {}).get('receive_rate','N/A')} Mbps</span></div>
    <div class="kv"><span>PHY TX Rate</span><span>{(interface or {}).get('transmit_rate','N/A')} Mbps</span></div>
    <div class="kv"><span>Signal</span>
      <span style="color:{sig_hex};font-weight:bold">
        {(interface or {}).get('signal','N/A')}
        {'(~'+str(dbm)+' dBm)' if dbm else ''} — {sig_label}
      </span>
    </div>
    <div class="kv"><span>Profile</span><span>{(interface or {}).get('profile','N/A')}</span></div>
    <div class="kv"><span>Network Type</span><span>{(interface or {}).get('network_type','N/A')}</span></div>
    <div class="kv"><span>Connection Mode</span><span>{(interface or {}).get('connection_mode','N/A')}</span></div>
  </div>

  <!-- Security -->
  <div class="card">
    <h3>Security Assessment</h3>
    <div class="kv"><span>Authentication</span><span>{(interface or {}).get('authentication','N/A')}</span></div>
    <div class="kv"><span>Cipher</span><span>{(interface or {}).get('cipher','N/A')}</span></div>
    <div class="kv"><span>Security Level</span>
      <span style="color:{sec_hex};font-weight:bold">{sec_level}</span>
    </div>
    <p style="color:#555;font-size:12px;margin:10px 0">{sec_desc}</p>
    <div class="kv"><span>802.11w MFP</span><span>{driver.get('mfp_80211w','N/A')}</span></div>
    <div class="kv"><span>FIPS 140-2</span><span>{driver.get('fips_mode','N/A')}</span></div>
  </div>

  <!-- IP Configuration -->
  <div class="card">
    <h3>IP Configuration</h3>
    <div class="kv"><span>IPv4 Address</span><span>{(ip or {}).get('ipv4','N/A')}</span></div>
    <div class="kv"><span>Subnet Mask</span><span>{(ip or {}).get('subnet_mask','N/A')}</span></div>
    <div class="kv"><span>Default Gateway</span><span style="font-family:monospace;font-size:12px">{gw_str}</span></div>
    <div class="kv"><span>DHCP Enabled</span><span>{(ip or {}).get('dhcp_enabled','N/A')}</span></div>
    <div class="kv"><span>DHCP Server</span><span>{(ip or {}).get('dhcp_server','N/A')}</span></div>
    <div class="kv"><span>DNS Servers</span><span>{', '.join((ip or {}).get('dns_list', [(ip or {}).get('dns_servers','N/A')]))}</span></div>
    <div class="kv"><span>Lease Obtained</span><span>{(ip or {}).get('lease_obtained','N/A')}</span></div>
    <div class="kv"><span>Lease Expires</span><span>{(ip or {}).get('lease_expires','N/A')}</span></div>
    <div class="kv"><span>IPv6 Link-Local</span><span style="font-size:11px">{(ip or {}).get('ipv6_link_local','N/A')}</span></div>
  </div>

</div><!-- /top-grid -->

<!-- Latency -->
<div class="card section">
  <h3>Latency &amp; Packet Loss</h3>
  <table>
    <tr><th>Target</th><th>Host</th><th>Min</th><th>Avg</th><th>Max</th><th>Jitter</th><th>Loss</th><th>Quality</th></tr>
    {ping_rows}
  </table>
</div>

<!-- DNS -->
<div class="card section">
  <h3>DNS Resolution</h3>
  <table>
    <tr><th>Status</th><th>Domain</th><th>Resolved IP</th><th>Time</th></tr>
    {dns_rows}
  </table>
</div>

<!-- Channel Charts -->
<div class="card section">
  <h3>Channel Congestion — 2.4 GHz</h3>
  <p class="legend">★ = non-overlapping channel &nbsp;·&nbsp; ◄ = your channel (cyan) &nbsp;·&nbsp;
    <span style="color:#2ecc71">■ low</span> &nbsp;
    <span style="color:#f1c40f">■ moderate</span> &nbsp;
    <span style="color:#e74c3c">■ heavy</span>
  </p>
  <div class="ch-chart">{ch_24_bars}</div>
</div>

{"<div class='card section'><h3>Channel Congestion — 5 GHz</h3><div class='ch-chart'>" + ch_5_bars + "</div></div>" if ch_5_bars else ''}

<!-- Nearby Networks -->
<div class="card section">
  <h3>Nearby Networks &mdash; {ch['total_nets']} SSIDs / {ch['total_aps']} APs visible</h3>
  <div style="overflow-x:auto">
    <table>
      <tr><th>SSID</th><th>BSSID</th><th>Ch</th><th>Band</th><th>Signal</th><th>Radio</th><th>Auth</th></tr>
      {ap_rows}
    </table>
  </div>
</div>

{stats_html}

<!-- Driver -->
<div class="card section">
  <h3>WiFi Adapter &amp; Driver</h3>
  <div class="grid2">
    <div>
      <div class="kv"><span>Adapter</span><span>{driver.get('description','N/A')}</span></div>
      <div class="kv"><span>Vendor</span><span>{driver.get('vendor','N/A')}</span></div>
      <div class="kv"><span>Driver Version</span><span>{driver.get('version','N/A')}</span></div>
      <div class="kv"><span>Driver Date</span><span>{driver.get('date','N/A')}{drv_date_note}</span></div>
    </div>
    <div>
      <div class="kv"><span>Radio Types Supported</span><span>{driver.get('radio_types','N/A')}</span></div>
      <div class="kv"><span>Hosted Network</span><span>{driver.get('hosted_net','N/A')}</span></div>
      <div class="kv"><span>IHV Service</span><span>{driver.get('ihv_present','N/A')}</span></div>
      <div class="kv"><span>Provider</span><span>{driver.get('provider','N/A')}</span></div>
    </div>
  </div>
</div>

<!-- Recommendations -->
<div class="card section">
  <h3>Engineer Recommendations</h3>
  <ul class="recs">
    {rec_items}
  </ul>
</div>

<p style="color:#333;font-size:11px;text-align:center;margin-top:16px">
  WiFi Survey Tool v{VERSION} — generated entirely offline using Windows built-in diagnostics
</p>
</body>
</html>"""

    output_path.write_text(html, encoding='utf-8')


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='WiFi Engineer Survey Tool — offline, no external packages required',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('--no-html',     action='store_true', help='Skip HTML report generation')
    parser.add_argument('--no-internet', action='store_true', help='Skip internet-facing ping tests (8.8.8.8, 1.1.1.1)')
    parser.add_argument('--fast',        action='store_true', help='Skip all ping and DNS tests')
    parser.add_argument('--output-dir',  default=str(REPORT_DIR), help='Directory to save HTML reports')
    args = parser.parse_args()

    _enable_ansi()

    print()
    print(c("  WiFi Engineer Survey Tool", 'cyan') + c(f"  v{VERSION}", 'gray'))
    print(c("  ─────────────────────────────────────────────", 'gray'))

    steps = [
        "Reading WiFi interface info",
        "Scanning nearby networks",
        "Reading driver info",
        "Reading IP configuration",
        "Collecting 802.11 statistics",
        "Running latency tests",
        "Testing DNS resolution",
        "Analyzing results",
    ]
    total = len(steps)

    def step(n, msg):
        print(f"  [{n}/{total}] {msg}...")

    step(1, steps[0])
    interface = collect_interface()
    if not interface or 'connected' not in (interface.get('state') or '').lower():
        print(c("  WARNING: No active WiFi connection — some data may be missing.", 'yellow'))

    step(2, steps[1])
    networks = collect_networks()

    step(3, steps[2])
    driver = collect_driver()

    step(4, steps[3])
    ip = collect_ip_config()

    step(5, steps[4])
    stats = collect_statistics()

    gw = (ip or {}).get('gateway_ip')
    dns_servers = (ip or {}).get('dns_list', [])
    pings = []

    if not args.fast:
        step(6, steps[5])
        if gw:
            pings.append(ping_host(gw, count=10, label='Default Gateway'))
        for dns_ip in dns_servers[:2]:
            if dns_ip and ':' not in dns_ip:
                pings.append(ping_host(dns_ip, count=5, label=f'DNS ({dns_ip})'))
        if not args.no_internet and gw:
            pings.append(ping_host('8.8.8.8',  count=10, label='Google DNS (8.8.8.8)'))
            pings.append(ping_host('1.1.1.1',  count=5,  label='Cloudflare (1.1.1.1)'))

    dns_results = []
    if not args.fast:
        step(7, steps[6])
        dns_results = test_dns()

    step(8, steps[7])
    arp_mac = collect_arp_gateway(gw)
    ch = analyze_channels(networks, interface)
    security = assess_security(
        (interface or {}).get('authentication'),
        (interface or {}).get('cipher'),
    )
    gw_ping = next((p for p in pings if p.get('label') == 'Default Gateway'), None)
    score = compute_score(interface, gw_ping, ch)

    print()

    # ── Terminal report ──
    print_report(interface, networks, driver, stats, ip, pings, dns_results,
                 ch, security, score, arp_mac)

    # ── HTML report ──
    if not args.no_html:
        out_dir = Path(args.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        ts_file = datetime.now().strftime('%Y%m%d_%H%M%S')
        html_path = out_dir / f"wifi_survey_{ts_file}.html"

        print(f"  Generating HTML report → {html_path}")
        generate_html(interface, networks, driver, stats, ip, pings, dns_results,
                      ch, security, score, arp_mac, html_path)
        print(f"  {c('Opening in default browser...', 'gray')}")
        webbrowser.open(html_path.as_uri())
        print()

    print(c("  Survey complete.", 'green'))
    print()


if __name__ == '__main__':
    main()
