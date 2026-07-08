"""
scanner.py  —  WiFi Survey Pro
All scan modules.  Add a new class + register it in MODULES to extend the app.
"""

import re
import socket
import statistics
import subprocess
from abc import ABC, abstractmethod
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _run(args, timeout=25):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                           encoding='utf-8', errors='replace')
        return r.stdout
    except Exception:
        return ''


def _extract(pattern, text, default=None, flags=re.IGNORECASE | re.MULTILINE):
    m = re.search(pattern, text, flags)
    return m.group(1).strip() if m else default


def _pct_to_dbm(pct_str):
    try:
        pct = int(str(pct_str).replace('%', '').strip())
        return round((pct / 2) - 100, 1)
    except Exception:
        return None


def _dbm_quality(dbm):
    if dbm is None:        return 'Unknown', 'neutral'
    if dbm >= -50:         return 'Excellent', 'excellent'
    if dbm >= -60:         return 'Good',      'good'
    if dbm >= -70:         return 'Fair',       'fair'
    if dbm >= -80:         return 'Poor',       'poor'
    return                        'Very Poor',  'critical'


def _latency_quality(avg_ms):
    if avg_ms is None:    return 'N/A',              'neutral'
    if avg_ms < 5:        return 'Excellent (<5 ms)', 'excellent'
    if avg_ms < 20:       return 'Good (<20 ms)',      'good'
    if avg_ms < 50:       return 'Fair (<50 ms)',       'fair'
    if avg_ms < 100:      return 'Poor (<100 ms)',      'poor'
    return                       'Very Poor',           'critical'


def _driver_age(date_str):
    for fmt in ('%m/%d/%Y', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            d = datetime.strptime(date_str.strip(), fmt)
            return round((datetime.now() - d).days / 365.25, 1)
        except ValueError:
            continue
    return None


NON_OVERLAPPING_24 = {1, 6, 11}

RADIO_GENERATIONS = {
    '802.11be': 'Wi-Fi 7  (802.11be)',
    '802.11ax': 'Wi-Fi 6/6E (802.11ax)',
    '802.11ac': 'Wi-Fi 5  (802.11ac)',
    '802.11n':  'Wi-Fi 4  (802.11n)',
    '802.11g':  'Wi-Fi 3  (802.11g)',
    '802.11a':  'Wi-Fi 2  (802.11a)',
    '802.11b':  'Wi-Fi 1  (802.11b)',
}


# ─────────────────────────────────────────────────────────────────────────────
# Base class
# ─────────────────────────────────────────────────────────────────────────────

class ScanModule(ABC):
    id              = ''
    name            = ''
    description     = ''
    category        = ''       # 'connection' | 'rf' | 'security' | 'network' | 'advanced'
    default_enabled = True
    tags            = []       # e.g. ['slow', 'internet']

    def meta(self):
        return {
            'id':              self.id,
            'name':            self.name,
            'description':     self.description,
            'category':        self.category,
            'default_enabled': self.default_enabled,
            'tags':            self.tags,
        }

    @abstractmethod
    def run(self) -> dict:
        """Return dict: {id, status, data, score?, recommendations?}"""

    def _ok(self, data, score=None, recs=None, warnings=None):
        result = {'id': self.id, 'status': 'ok', 'data': data}
        if score      is not None: result['score']           = score
        if recs       is not None: result['recommendations'] = recs
        if warnings   is not None: result['warnings']        = warnings
        return result

    def _error(self, msg):
        return {'id': self.id, 'status': 'error', 'error': msg, 'data': {}}

    def _warn(self, data, msg):
        return {'id': self.id, 'status': 'warning', 'warning': msg, 'data': data}


# ─────────────────────────────────────────────────────────────────────────────
# Module 1 — Interface
# ─────────────────────────────────────────────────────────────────────────────

class InterfaceScan(ScanModule):
    id          = 'interface'
    name        = 'Interface Info'
    description = 'Active WiFi connection — SSID, BSSID, channel, PHY rates'
    category    = 'connection'
    tags        = []

    def run(self):
        raw = _run(['netsh', 'wlan', 'show', 'interfaces'])
        if not raw:
            return self._error('netsh wlan show interfaces returned no output')

        keys = {
            'name':             r'^\s+Name\s*:\s*(.+)',
            'description':      r'^\s+Description\s*:\s*(.+)',
            'guid':             r'^\s+GUID\s*:\s*(.+)',
            'physical_address': r'^\s+Physical address\s*:\s*(.+)',
            'state':            r'^\s+State\s*:\s*(.+)',
            'ssid':             r'^\s+SSID\s*:\s*(.+)',
            'bssid':            r'^\s+BSSID\s*:\s*(.+)',
            'network_type':     r'^\s+Network type\s*:\s*(.+)',
            'radio_type':       r'^\s+Radio type\s*:\s*(.+)',
            'authentication':   r'^\s+Authentication\s*:\s*(.+)',
            'cipher':           r'^\s+Cipher\s*:\s*(.+)',
            'connection_mode':  r'^\s+Connection mode\s*:\s*(.+)',
            'channel':          r'^\s+Channel\s*:\s*(.+)',
            'receive_rate':     r'^\s+Receive rate \(Mbps\)\s*:\s*(.+)',
            'transmit_rate':    r'^\s+Transmit rate \(Mbps\)\s*:\s*(.+)',
            'signal':           r'^\s+Signal\s*:\s*(.+)',
            'profile':          r'^\s+Profile\s*:\s*(.+)',
        }
        d = {k: _extract(pat, raw) for k, pat in keys.items()}

        if d.get('signal'):
            d['signal_dbm'] = _pct_to_dbm(d['signal'])
            d['signal_quality'], d['signal_quality_level'] = _dbm_quality(d['signal_dbm'])
        if d.get('radio_type'):
            d['radio_label'] = RADIO_GENERATIONS.get(d['radio_type'], d['radio_type'])
        if d.get('channel'):
            try:
                d['band'] = '5 GHz' if int(d['channel']) > 14 else '2.4 GHz'
            except ValueError:
                d['band'] = 'Unknown'

        connected = 'connected' in (d.get('state') or '').lower()
        status = 'ok' if connected else 'warning'
        recs = []
        if not connected:
            recs.append('No active WiFi connection — connect to a network to get full results.')
        return {'id': self.id, 'status': status, 'data': d, 'recommendations': recs}


# ─────────────────────────────────────────────────────────────────────────────
# Module 2 — IP Configuration
# ─────────────────────────────────────────────────────────────────────────────

class IPConfigScan(ScanModule):
    id          = 'ipconfig'
    name        = 'IP Configuration'
    description = 'IPv4/IPv6, gateway, DHCP server, DNS servers, lease times'
    category    = 'network'
    tags        = []

    def run(self):
        raw = _run(['ipconfig', '/all'])
        if not raw:
            return self._error('ipconfig /all returned no output')

        sections = re.split(r'\r?\n(?=\S)', raw)
        wifi_sec = None
        for sec in sections:
            if re.search(r'Wi-Fi|Wireless|WLAN|802\.11', sec, re.IGNORECASE):
                wifi_sec = sec
                break
        if not wifi_sec:
            return self._warn({}, 'Could not find WiFi adapter section in ipconfig output')

        keys = {
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
        d = {k: (_extract(pat, wifi_sec) or '').replace('(Preferred)', '').strip()
             for k, pat in keys.items()}

        gw_ips = re.findall(r'(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', d.get('default_gateway', ''))
        d['gateway_ip'] = gw_ips[0] if gw_ips else None

        dns_block = re.search(r'DNS Servers\s*[.:]+\s*(.+?)(?=\r?\n\S|\Z)', wifi_sec, re.DOTALL | re.IGNORECASE)
        d['dns_list'] = re.findall(r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', dns_block.group(1)) if dns_block else []

        # Gateway MAC from ARP
        if d['gateway_ip']:
            arp = _run(['arp', '-a', d['gateway_ip']], timeout=5)
            m = re.search(r'([\da-fA-F]{2}[-:]){5}[\da-fA-F]{2}', arp)
            d['gateway_mac'] = m.group(0) if m else None
        else:
            d['gateway_mac'] = None

        # Compute subnet size
        if d.get('subnet_mask'):
            try:
                octets = [int(o) for o in d['subnet_mask'].split('.')]
                bits = sum(bin(o).count('1') for o in octets)
                d['prefix_length'] = bits
                d['subnet_size'] = 2 ** (32 - bits) - 2
            except Exception:
                pass

        recs = []
        if d.get('dhcp_enabled', '').lower() == 'no':
            recs.append('Static IP assigned — ensure subnet and gateway are correct.')
        if len(d.get('dns_list', [])) < 2:
            recs.append('Only one DNS server configured — adding a secondary improves reliability.')

        return self._ok(d, recs=recs)


# ─────────────────────────────────────────────────────────────────────────────
# Module 3 — Security
# ─────────────────────────────────────────────────────────────────────────────

class SecurityScan(ScanModule):
    id          = 'security'
    name        = 'Security Assessment'
    description = 'Authentication, cipher strength, 802.11w MFP, FIPS status'
    category    = 'security'
    tags        = []

    def run(self):
        iface_raw = _run(['netsh', 'wlan', 'show', 'interfaces'])
        drv_raw   = _run(['netsh', 'wlan', 'show', 'drivers'])

        auth   = _extract(r'^\s+Authentication\s*:\s*(.+)', iface_raw) or ''
        cipher = _extract(r'^\s+Cipher\s*:\s*(.+)',         iface_raw) or ''
        mfp    = _extract(r'802\.11w Management Frame Protection\s*:\s*(.+)', drv_raw) or 'Unknown'
        fips   = _extract(r'FIPS 140-2 mode\s*:\s*(.+)',    drv_raw) or 'Unknown'

        a  = auth.lower()
        ci = cipher.lower()
        if   'wpa3' in a and 'sae' in a: level, desc = 'Excellent', 'WPA3-Personal (SAE) — strongest consumer WiFi security'
        elif 'wpa3' in a:                level, desc = 'Excellent', 'WPA3 — modern, strong security'
        elif 'wpa2' in a and ('ccmp' in ci or 'aes' in ci): level, desc = 'Good', 'WPA2 with AES-CCMP — solid and current'
        elif 'wpa2' in a and 'tkip' in ci: level, desc = 'Fair',    'WPA2-TKIP is deprecated; change cipher to AES/CCMP in router settings'
        elif 'wpa2' in a:                level, desc = 'Good',      'WPA2 — adequate; ensure AES/CCMP cipher is configured'
        elif 'wpa' in a:                 level, desc = 'Poor',      'WPA (original) has known vulnerabilities — upgrade to WPA2/WPA3'
        elif 'wep' in a:                 level, desc = 'Critical',  'WEP is completely broken — change to WPA2/WPA3 immediately'
        elif 'open' in a or not a:       level, desc = 'None',      'Open/unencrypted network — all traffic visible to nearby devices'
        else:                            level, desc = 'Unknown',   f'Auth: {auth}  Cipher: {cipher}'

        score_map = {'Excellent': 100, 'Good': 80, 'Fair': 55, 'Poor': 25, 'Critical': 0, 'None': 0, 'Unknown': 50}

        recs = []
        if level == 'Critical': recs.append('CRITICAL: WEP is completely broken. Update your router to WPA2-AES or WPA3 immediately.')
        elif level == 'None':   recs.append('Open network — use a VPN and avoid transmitting sensitive data.')
        elif level == 'Poor':   recs.append('Upgrade router/AP firmware and change WiFi security to WPA2 or WPA3.')
        elif level == 'Fair':   recs.append('Change the cipher in your router wireless settings from TKIP to AES/CCMP.')
        elif level in ('Good', 'Excellent') and mfp.lower() == 'not supported':
            recs.append('Consider upgrading to a router that supports 802.11w Management Frame Protection.')

        d = {
            'authentication':   auth,
            'cipher':           cipher,
            'security_level':   level,
            'security_desc':    desc,
            'mfp_80211w':       mfp,
            'fips_140_2':       fips,
            'security_score':   score_map.get(level, 50),
        }
        return self._ok(d, score=score_map.get(level, 50), recs=recs)


# ─────────────────────────────────────────────────────────────────────────────
# Module 4 — Channel Survey
# ─────────────────────────────────────────────────────────────────────────────

class ChannelSurveyScan(ScanModule):
    id          = 'channel_survey'
    name        = 'Channel Survey'
    description = 'All visible APs, channel utilization map, congestion analysis'
    category    = 'rf'
    tags        = []

    def run(self):
        raw = _run(['netsh', 'wlan', 'show', 'networks', 'mode=bssid'])
        iface_raw = _run(['netsh', 'wlan', 'show', 'interfaces'])
        my_bssid = (_extract(r'^\s+BSSID\s*:\s*(.+)', iface_raw) or '').lower()
        my_ch_s  = _extract(r'^\s+Channel\s*:\s*(.+)', iface_raw)
        try:    my_ch = int(my_ch_s)
        except: my_ch = None

        networks, current = [], {}
        for line in raw.splitlines():
            s = line.strip()
            m = re.match(r'^SSID\s+\d+\s*:\s*(.*)', s, re.IGNORECASE)
            if m:
                if current: networks.append(current)
                current = {'ssid': m.group(1).strip(), 'bssids': [],
                           'authentication': '', 'encryption': ''}
                continue
            if not current: continue
            for pat, key, is_bssid in [
                (r'^Network type\s*:\s*(.+)',   'network_type',   False),
                (r'^Authentication\s*:\s*(.+)', 'authentication', False),
                (r'^Encryption\s*:\s*(.+)',     'encryption',     False),
                (r'^BSSID\s+\d+\s*:\s*(.+)',   'bssid',          True),
                (r'^Signal\s*:\s*(.+)',         'signal',         False),
                (r'^Radio type\s*:\s*(.+)',     'radio_type',     False),
                (r'^Channel\s*:\s*(.+)',        'channel',        False),
            ]:
                mv = re.match(pat, s, re.IGNORECASE)
                if mv:
                    val = mv.group(1).strip()
                    if is_bssid:
                        current['bssids'].append({'bssid': val})
                    elif key in ('authentication', 'encryption', 'network_type'):
                        current[key] = val
                    elif current['bssids']:
                        entry = current['bssids'][-1]
                        entry[key] = val
                        if key == 'signal':
                            entry['signal_dbm'] = _pct_to_dbm(val)
                            entry['signal_quality'], entry['signal_quality_level'] = _dbm_quality(entry['signal_dbm'])
                        elif key == 'channel':
                            try: entry['band'] = '5 GHz' if int(val) > 14 else '2.4 GHz'
                            except: entry['band'] = 'Unknown'
                    break
        if current: networks.append(current)

        # Flatten to AP list
        aps = []
        for net in networks:
            for b in net['bssids']:
                aps.append({
                    'ssid':          net['ssid'],
                    'bssid':         b.get('bssid', ''),
                    'signal':        b.get('signal', ''),
                    'signal_dbm':    b.get('signal_dbm'),
                    'signal_quality':b.get('signal_quality', 'Unknown'),
                    'signal_quality_level': b.get('signal_quality_level', 'neutral'),
                    'channel':       b.get('channel', ''),
                    'band':          b.get('band', 'Unknown'),
                    'radio_type':    b.get('radio_type', ''),
                    'authentication':net.get('authentication', ''),
                    'encryption':    net.get('encryption', ''),
                    'is_mine':       b.get('bssid', '').lower() == my_bssid,
                })
        aps.sort(key=lambda x: x.get('signal_dbm') or -100, reverse=True)

        # Channel maps
        ch_24, ch_5 = {}, {}
        for ap in aps:
            try:
                ch = int(ap['channel'])
                if ch <= 14: ch_24[ch] = ch_24.get(ch, 0) + 1
                else:        ch_5[ch]  = ch_5.get(ch,  0) + 1
            except (ValueError, TypeError):
                pass

        # Congestion score
        recs, warnings = [], []
        cong_score = 100
        if my_ch and my_ch <= 14:
            cnt = ch_24.get(my_ch, 0)
            if cnt > 5:
                cong_score = 20
                warnings.append(f'Severe congestion: {cnt} APs on your channel {my_ch}')
                best = min(NON_OVERLAPPING_24, key=lambda c: ch_24.get(c, 0))
                recs.append(f'Change your router channel to {best} (fewest competing APs on 2.4 GHz non-overlapping set).')
            elif cnt > 2:
                cong_score = 60
                warnings.append(f'Moderate congestion: {cnt} APs on channel {my_ch}')
            if my_ch not in NON_OVERLAPPING_24:
                recs.append(f'Channel {my_ch} overlaps neighbors — use channels 1, 6, or 11 on 2.4 GHz.')

        d = {
            'aps':            aps,
            'total_aps':      len(aps),
            'total_ssids':    len(networks),
            'ch_24':          ch_24,
            'ch_5':           ch_5,
            'my_channel':     my_ch,
            'non_overlapping_24': sorted(NON_OVERLAPPING_24),
        }
        return self._ok(d, score=cong_score, recs=recs, warnings=warnings)


# ─────────────────────────────────────────────────────────────────────────────
# Module 5 — Latency Tests
# ─────────────────────────────────────────────────────────────────────────────

class LatencyScan(ScanModule):
    id          = 'latency'
    name        = 'Latency Tests'
    description = 'Ping gateway, DNS servers, and optional internet targets (10 pings each)'
    category    = 'network'
    tags        = ['slow']

    def __init__(self, ping_internet=True):
        self.ping_internet = ping_internet

    def _ping(self, host, count=10, label=None):
        label = label or host
        out = _run(['ping', '-n', str(count), host], timeout=count * 4 + 8)
        if not out:
            return {'host': host, 'label': label, 'reachable': False, 'error': 'No response'}

        rtts = [int(x) for x in re.findall(r'time[=<](\d+)ms', out)]
        sent_m = re.search(r'Sent = (\d+)',     out)
        recv_m = re.search(r'Received = (\d+)', out)
        lost_m = re.search(r'Lost = (\d+)',     out)
        sent  = int(sent_m.group(1)) if sent_m else count
        lost  = int(lost_m.group(1)) if lost_m else (count - len(rtts))
        loss  = round(lost / sent * 100, 1) if sent else 100.0

        if not rtts:
            return {'host': host, 'label': label, 'reachable': False,
                    'sent': sent, 'lost': lost, 'loss_pct': 100.0}

        avg    = round(statistics.mean(rtts), 1)
        jitter = round(statistics.stdev(rtts), 1) if len(rtts) > 1 else 0.0
        ql, qc = _latency_quality(avg)
        return {
            'host': host, 'label': label, 'reachable': True,
            'sent': sent, 'received': int(recv_m.group(1)) if recv_m else len(rtts),
            'lost': lost, 'loss_pct': loss,
            'min_ms': min(rtts), 'avg_ms': avg, 'max_ms': max(rtts),
            'jitter_ms': jitter, 'rtts': rtts,
            'quality': ql, 'quality_level': qc,
        }

    def run(self):
        ip_raw = _run(['ipconfig', '/all'])
        # Get gateway
        sections = re.split(r'\r?\n(?=\S)', ip_raw)
        wifi_sec = ''
        for sec in sections:
            if re.search(r'Wi-Fi|Wireless|WLAN', sec, re.IGNORECASE):
                wifi_sec = sec; break

        gw_raw = _extract(r'Default Gateway\s*[.:]+\s*(.+)', wifi_sec) or ''
        gw_ips = re.findall(r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', gw_raw)
        gw_ip  = gw_ips[0] if gw_ips else None

        dns_block = re.search(r'DNS Servers\s*[.:]+\s*(.+?)(?=\r?\n\S|\Z)', wifi_sec, re.DOTALL | re.IGNORECASE)
        dns_ips = re.findall(r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', dns_block.group(1)) if dns_block else []

        targets = []
        if gw_ip:
            targets.append((gw_ip, 10, 'Default Gateway'))
        for ip in dns_ips[:2]:
            if ':' not in ip:
                targets.append((ip, 5, f'DNS ({ip})'))
        if self.ping_internet:
            targets += [('8.8.8.8', 10, 'Google DNS (8.8.8.8)'),
                        ('1.1.1.1',  5, 'Cloudflare (1.1.1.1)')]

        results = [self._ping(host, count, label) for host, count, label in targets]

        recs, warnings = [], []
        gw_result = next((r for r in results if r.get('label') == 'Default Gateway'), None)
        if gw_result:
            if not gw_result.get('reachable'):
                warnings.append('Cannot reach the default gateway')
                recs.append('Verify the router is powered on and your IP configuration is correct.')
            else:
                loss = gw_result.get('loss_pct', 0)
                avg  = gw_result.get('avg_ms')
                if loss > 5:
                    warnings.append(f'{loss}% packet loss to gateway — RF interference or overloaded AP')
                    recs.append('Packet loss to the gateway indicates RF interference, driver issues, or AP overload. Move closer or switch band.')
                if avg and avg > 50:
                    warnings.append(f'High gateway RTT: {avg} ms')
                    recs.append(f'Gateway RTT of {avg} ms is unusually high for a local hop. Check for AP overload or severe interference.')

        score = 100
        if gw_result:
            loss = gw_result.get('loss_pct', 0)
            avg  = gw_result.get('avg_ms', 0) or 0
            if not gw_result.get('reachable'): score = 0
            elif loss > 10: score -= 40
            elif loss > 5:  score -= 20
            elif loss > 0:  score -= 10
            if avg > 100:   score -= 30
            elif avg > 50:  score -= 15
            elif avg > 20:  score -= 5

        return self._ok({'targets': results}, score=max(0, score), recs=recs, warnings=warnings)


# ─────────────────────────────────────────────────────────────────────────────
# Module 6 — DNS Tests
# ─────────────────────────────────────────────────────────────────────────────

class DNSScan(ScanModule):
    id          = 'dns'
    name        = 'DNS Resolution'
    description = 'Resolve public domains and measure lookup latency'
    category    = 'network'
    tags        = ['internet']

    DOMAINS = ['google.com', 'cloudflare.com', 'microsoft.com', 'amazon.com']

    def run(self):
        results = []
        for domain in self.DOMAINS:
            try:
                t0 = datetime.now()
                addr = socket.gethostbyname(domain)
                ms = round((datetime.now() - t0).total_seconds() * 1000, 1)
                results.append({'domain': domain, 'ip': addr, 'ms': ms, 'ok': True})
            except Exception as e:
                results.append({'domain': domain, 'ip': None, 'ms': None, 'ok': False, 'error': str(e)})

        ok_count = sum(1 for r in results if r['ok'])
        avg_ok_ms = round(statistics.mean(r['ms'] for r in results if r['ok'] and r['ms']), 1) if ok_count else None
        score = int(ok_count / len(self.DOMAINS) * 100)

        recs, warnings = [], []
        if ok_count == 0:
            warnings.append('All DNS lookups failed — no internet connectivity or DNS misconfiguration')
            recs.append('Check internet connection. If LAN is fine, try changing DNS to 8.8.8.8 (Google) or 1.1.1.1 (Cloudflare).')
        elif ok_count < len(self.DOMAINS):
            warnings.append(f'Only {ok_count}/{len(self.DOMAINS)} DNS lookups succeeded')
        if avg_ok_ms and avg_ok_ms > 200:
            warnings.append(f'DNS resolution is slow ({avg_ok_ms} ms average)')
            recs.append('Consider switching to a faster DNS provider: 1.1.1.1 (Cloudflare) or 8.8.8.8 (Google).')

        return self._ok({
            'results':    results,
            'ok_count':   ok_count,
            'total':      len(self.DOMAINS),
            'avg_ms':     avg_ok_ms,
        }, score=score, recs=recs, warnings=warnings)


# ─────────────────────────────────────────────────────────────────────────────
# Module 7 — 802.11 Frame Statistics
# ─────────────────────────────────────────────────────────────────────────────

class StatisticsScan(ScanModule):
    id          = 'statistics'
    name        = '802.11 Frame Statistics'
    description = 'TX/RX frame counts, retries, ACK/CTS timeouts since last association'
    category    = 'advanced'
    tags        = []

    def run(self):
        raw = _run(['netsh', 'wlan', 'show', 'statistics'])
        if not raw:
            return self._error('netsh wlan show statistics returned no output')

        pats = {
            'frames_tx':         r'Frames transmitted\s*:\s*(\d+)',
            'frames_rx':         r'Frames received\s*:\s*(\d+)',
            'frames_dropped_tx': r'Frames dropped\s*:\s*(\d+)',
            'beacons_rx':        r'Beacons received\s*:\s*(\d+)',
            'multicast_rx':      r'Multicast received\s*:\s*(\d+)',
            'dup_frames':        r'Duplicate frames\s*:\s*(\d+)',
            'cts_timeout':       r'CTS timeout\s*:\s*(\d+)',
            'ack_timeout':       r'ACK timeout\s*:\s*(\d+)',
            'tx_retries':        r'Transmissions with retries\s*:\s*(\d+)',
        }
        d = {}
        for key, pat in pats.items():
            m = re.search(pat, raw, re.IGNORECASE)
            d[key] = int(m.group(1)) if m else None

        tx    = d.get('frames_tx') or 0
        retry = d.get('tx_retries') or 0
        d['retry_rate_pct'] = round(retry / tx * 100, 2) if tx else None

        recs, warnings = [], []
        rr = d.get('retry_rate_pct')
        if rr is not None:
            if rr > 20:
                warnings.append(f'High TX retry rate: {rr}% — significant RF interference or congestion')
                recs.append('High retry rate indicates interference. Try changing channel, moving closer to AP, or switching bands.')
            elif rr > 10:
                warnings.append(f'Elevated TX retry rate: {rr}%')
                recs.append('Elevated retry rate — consider changing to a less congested channel.')

        ack = d.get('ack_timeout') or 0
        if ack > 100:
            warnings.append(f'High ACK timeout count: {ack}')

        score = 100
        if rr is not None:
            if rr > 20: score -= 40
            elif rr > 10: score -= 20
            elif rr > 5:  score -= 10

        return self._ok(d, score=max(0, score), recs=recs, warnings=warnings)


# ─────────────────────────────────────────────────────────────────────────────
# Module 8 — Driver Info
# ─────────────────────────────────────────────────────────────────────────────

class DriverScan(ScanModule):
    id          = 'driver'
    name        = 'Adapter & Driver'
    description = 'WiFi adapter hardware, driver version, supported radio types'
    category    = 'advanced'
    tags        = []

    def run(self):
        raw = _run(['netsh', 'wlan', 'show', 'drivers'])
        if not raw:
            return self._error('netsh wlan show drivers returned no output')

        pats = {
            'description':  r'^\s+Description\s*:\s*(.+)',
            'vendor':       r'^\s+Vendor\s*:\s*(.+)',
            'provider':     r'^\s+Provider\s*:\s*(.+)',
            'date':         r'^\s+Date\s*:\s*(.+)',
            'version':      r'^\s+Version\s*:\s*(.+)',
            'radio_types':  r'^\s+Radio types supported\s*:\s*(.+)',
            'fips_mode':    r'^\s+FIPS 140-2 mode\s*:\s*(.+)',
            'mfp_80211w':   r'^\s+802\.11w Management Frame Protection\s*:\s*(.+)',
            'hosted_net':   r'^\s+Hosted network supported\s*:\s*(.+)',
            'ihv_present':  r'^\s+IHV service present\s*:\s*(.+)',
        }
        d = {k: _extract(pat, raw) for k, pat in pats.items()}

        if d.get('date'):
            age = _driver_age(d['date'])
            d['driver_age_years'] = age
            if age:
                d['driver_age_label'] = f'{age:.0f} year{"s" if age != 1 else ""} old'

        recs, warnings = [], []
        age = d.get('driver_age_years')
        if age and age > 2:
            warnings.append(f'Driver is {age:.0f} years old')
            recs.append(f'Driver is ~{age:.0f} years old. Update from your adapter vendor\'s website for improved performance and security.')

        radio = (d.get('radio_types') or '').lower()
        if not any(x in radio for x in ['802.11ac', '802.11ax', '802.11be']):
            recs.append('Adapter does not support 802.11ac/ax. Upgrading hardware would significantly increase maximum throughput.')

        return self._ok(d, recs=recs, warnings=warnings)


# ─────────────────────────────────────────────────────────────────────────────
# Module 9 — PHY Rate Analysis (offline throughput estimate)
# ─────────────────────────────────────────────────────────────────────────────

class PhyRateScan(ScanModule):
    id          = 'phy_rate'
    name        = 'PHY Rate Analysis'
    description = 'Analyze negotiated PHY rates vs. theoretical maximums and signal conditions'
    category    = 'rf'
    tags        = []

    # Approximate theoretical maxes (single spatial stream, short GI where applicable)
    THEORETICAL = {
        '802.11b':  11,
        '802.11a':  54,
        '802.11g':  54,
        '802.11n':  150,    # 1ss 40MHz
        '802.11ac': 433,    # 1ss 80MHz
        '802.11ax': 600,    # 1ss 80MHz
        '802.11be': 1200,   # 1ss 320MHz estimate
    }

    def run(self):
        raw = _run(['netsh', 'wlan', 'show', 'interfaces'])
        radio    = _extract(r'^\s+Radio type\s*:\s*(.+)',           raw) or ''
        rx_str   = _extract(r'^\s+Receive rate \(Mbps\)\s*:\s*(.+)', raw) or '0'
        tx_str   = _extract(r'^\s+Transmit rate \(Mbps\)\s*:\s*(.+)', raw) or '0'
        sig_pct  = _extract(r'^\s+Signal\s*:\s*(.+)',               raw) or '0'
        ch_str   = _extract(r'^\s+Channel\s*:\s*(.+)',              raw)

        try: rx = float(rx_str)
        except: rx = 0.0
        try: tx = float(tx_str)
        except: tx = 0.0
        try: ch = int(ch_str); band = '5 GHz' if ch > 14 else '2.4 GHz'
        except: band = 'Unknown'

        dbm = _pct_to_dbm(sig_pct)
        theoretical = None
        for std, maxr in self.THEORETICAL.items():
            if std in radio.lower():
                theoretical = maxr
                break

        efficiency = None
        if theoretical and rx > 0:
            efficiency = round(rx / theoretical * 100, 1)

        recs, warnings = [], []
        if theoretical and rx > 0 and efficiency is not None and efficiency < 30:
            warnings.append(f'PHY rate ({rx} Mbps) is only {efficiency}% of theoretical max ({theoretical} Mbps)')
            recs.append(
                f'Low PHY rate efficiency ({efficiency}%). Likely causes: weak signal, interference, '
                'distance from AP, or channel congestion. Move closer to the AP or switch to 5 GHz.'
            )
        if band == '2.4 GHz' and rx < 54:
            warnings.append(f'Low PHY rate on 2.4 GHz: {rx} Mbps')
        if band == '5 GHz' and rx < 100:
            warnings.append(f'Low PHY rate on 5 GHz: {rx} Mbps — signal may be weak')
            recs.append('Low 5 GHz PHY rate suggests weak signal. Move closer to the AP or check for obstacles.')

        d = {
            'radio_type':        radio,
            'radio_label':       RADIO_GENERATIONS.get(radio, radio),
            'receive_rate_mbps': rx,
            'transmit_rate_mbps': tx,
            'theoretical_max_mbps': theoretical,
            'efficiency_pct':    efficiency,
            'signal_pct':        sig_pct,
            'signal_dbm':        dbm,
            'band':              band,
            'channel':           ch_str,
        }
        score = min(100, int(efficiency)) if efficiency is not None else 50
        return self._ok(d, score=score, recs=recs, warnings=warnings)


# ─────────────────────────────────────────────────────────────────────────────
# Module registry — add new modules here
# ─────────────────────────────────────────────────────────────────────────────

MODULES: list[ScanModule] = [
    InterfaceScan(),
    IPConfigScan(),
    SecurityScan(),
    ChannelSurveyScan(),
    LatencyScan(ping_internet=True),
    DNSScan(),
    StatisticsScan(),
    DriverScan(),
    PhyRateScan(),
]


def get_module(module_id: str) -> ScanModule | None:
    return next((m for m in MODULES if m.id == module_id), None)


def run_module(module_id: str) -> dict:
    mod = get_module(module_id)
    if not mod:
        return {'id': module_id, 'status': 'error', 'error': 'Module not found', 'data': {}}
    try:
        return mod.run()
    except Exception as exc:
        return {'id': module_id, 'status': 'error', 'error': str(exc), 'data': {}}
