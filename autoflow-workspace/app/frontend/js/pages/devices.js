// ── Devices Page (mockup v4.3) ────────────────────────

import { $, esc } from '../utils/helpers.js';
import state, { set, on } from '../state.js';
import { appendLog } from '../components/console-panel.js';

const { invoke } = window.__TAURI__.core;

export function init() {
  const panel = $('#page-devices');
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'scan') refreshDevices();
    if (btn.dataset.action === 'guide') { if (window.hpGuide) window.hpGuide.show(); else appendLog('[SYSTEM] Setup guide not available'); }
    if (btn.dataset.action === 'test') testDevice(btn.dataset.deviceId);
  });
  on('devices', render);
}

export async function refreshDevices() {
  try {
    const devices = await invoke('list_devices');
    set('devices', devices);
    if (devices.length) {
      devices.forEach(([id]) => state.selectedDevices.add(id));
      appendLog(`[SYSTEM] Found ${devices.length} device(s)`);
      // Check health for each
      for (const [id] of devices) {
        try {
          const health = await invoke('check_device_health', { deviceId: id });
          state.deviceHealth[id] = health;
        } catch (e) {}
      }
      render();
    } else {
      appendLog('[SYSTEM] No devices found');
      if (window.hpGuide) window.hpGuide.show();
    }
  } catch (err) {
    appendLog('[ERROR] ' + err);
    set('devices', []);
  }
}

async function testDevice(deviceId) {
  try {
    const health = await invoke('check_device_health', { deviceId });
    state.deviceHealth[deviceId] = health;
    render();
    appendLog(`[SYSTEM] ${deviceId.slice(-6)}: ${health.connected ? 'Connected' : 'Disconnected'}, Battery: ${health.battery ?? 'N/A'}%`);
  } catch (err) {
    appendLog(`[ERROR] Test failed: ${err}`);
  }
}

function avgBattery(devices) {
  const vals = devices.map(([id]) => state.deviceHealth[id]?.battery).filter(b => b != null);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

export function render() {
  const panel = $('#page-devices');
  const devices = state.devices;
  const devCount = devices.length;
  const uploadingCount = devices.filter(([id]) => state.deviceProgress[id.slice(-6)]?.status === 'running').length;

  // Compute per-device stats from history
  const deviceStats = {};
  state.history.forEach(h => {
    const key = h.device_id || 'unknown';
    if (!deviceStats[key]) deviceStats[key] = { total: 0, success: 0 };
    deviceStats[key].total++;
    if (h.status === 'success') deviceStats[key].success++;
  });

  panel.innerHTML = `
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div>
        <h2 style="font-size:15px;font-weight:700;color:#f0f6fc">Devices</h2>
        <p style="font-size:10px;color:#484f58;margin-top:2px">${devCount} connected${uploadingCount ? ', ' + uploadingCount + ' uploading' : ''}</p>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn" data-action="guide">Setup Guide</button>
        <button class="btn btn-primary" data-action="scan">Scan Devices</button>
      </div>
    </div>

    <!-- Summary stats -->
    ${devCount ? `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Total Devices</p>
        <p style="font-size:22px;font-weight:700;color:#39d2c0">${devCount}</p>
      </div>
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Total Uploads</p>
        <p style="font-size:22px;font-weight:700;color:#58a6ff">${state.history.length}</p>
      </div>
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Avg Battery</p>
        <p style="font-size:22px;font-weight:700;color:${avgBattery(devices) < 30 ? '#f85149' : '#3fb950'}">${avgBattery(devices)}%</p>
      </div>
    </div>
    ` : ''}

    <!-- Device cards -->
    <div style="display:flex;flex-direction:column;gap:10px">
      ${devices.length ? devices.map(([id, model]) => {
        const h = state.deviceHealth[id] || {};
        const bat = h.battery != null ? h.battery : null;
        const brand = h.brand || '';
        const fullModel = h.model || model;
        const androidVer = h.android_version || '';
        const screenRes = h.screen_resolution || '';
        const displayName = brand ? (brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase()) : model;
        const ds = deviceStats[id] || { total: 0, success: 0 };
        const successRate = ds.total > 0 ? Math.round(ds.success / ds.total * 100) : 0;
        const batColor = bat == null ? '#484f58' : bat < 20 ? '#f85149' : bat < 50 ? '#d29922' : '#3fb950';
        const wifiSsid = h.wifi_ssid || '';
        const wifiIp = h.wifi_ip || '';
        const netType = h.network_type || '';
        const simOp = h.sim_operator || '';
        const netLabel = wifiSsid ? wifiSsid : (simOp ? `${simOp} ${netType}` : netType);
        const netIcon = wifiSsid ? 'wifi' : (netType ? 'cellular' : 'none');

        return `
          <div class="card" style="padding:16px;transition:background .15s" onmouseover="this.style.background='#232a33'" onmouseout="this.style.background='#1c2128'">
            <!-- Top: device info -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:42px;height:42px;background:#30363d;border-radius:10px;display:flex;align-items:center;justify-content:center">
                  <svg width="22" height="22" fill="none" stroke="#8b949e" stroke-width="1.3" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/></svg>
                </div>
                <div>
                  <p style="font-size:13px;font-weight:600;color:#f0f6fc">${esc(displayName)}</p>
                  <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
                    ${fullModel !== displayName ? `<span style="font-size:10px;color:#8b949e">${esc(fullModel)}</span>` : ''}
                    ${androidVer ? `<span style="font-size:10px;color:#484f58">Android ${androidVer}</span>` : ''}
                  </div>
                  <p style="font-size:9px;color:#30363d;font-family:'IBM Plex Mono',monospace;margin-top:2px">${esc(id)}</p>
                </div>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="badge b-green">Connected</span>
                <button class="q-icon-btn" data-action="test" data-device-id="${esc(id)}" title="Test connection">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="pointer-events:none"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5"/><path stroke-linecap="round" stroke-linejoin="round" d="M20.49 9A9 9 0 005.64 5.64L4 4m16 16l-1.64-1.64A9 9 0 013.51 15"/></svg>
                </button>
              </div>
            </div>

            <!-- Stats grid -->
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#30363d;border-radius:10px;overflow:hidden">
              <div style="background:#1c2128;padding:10px 12px;text-align:center">
                <p style="font-size:8px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Battery</p>
                <p style="font-size:16px;font-weight:700;color:${batColor}">${bat != null ? bat + '%' : '–'}</p>
              </div>
              <div style="background:#1c2128;padding:10px 12px;text-align:center">
                <p style="font-size:8px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Network</p>
                <div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-top:2px">
                  ${netIcon === 'wifi'
                    ? '<svg width="12" height="12" fill="none" stroke="#3fb950" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0114.08 0m-11.24 3a7 7 0 018.4 0M12 20h.01"/></svg>'
                    : netIcon === 'cellular'
                    ? '<svg width="12" height="12" fill="none" stroke="#d29922" stroke-width="2" viewBox="0 0 24 24"><path d="M2 20h.01M7 20v-4m5 4v-8m5 8V8m5 12V4"/></svg>'
                    : '<svg width="12" height="12" fill="none" stroke="#484f58" stroke-width="2" viewBox="0 0 24 24"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55m-5.26-1.48A7 7 0 0118.17 15m-10.34.03A7 7 0 0112 13.07M12 20h.01"/></svg>'
                  }
                  <span style="font-size:10px;color:${netIcon === 'wifi' ? '#3fb950' : netIcon === 'cellular' ? '#d29922' : '#484f58'};max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(netLabel)}">${esc(netLabel) || '–'}</span>
                </div>
                ${wifiIp ? `<p style="font-size:8px;color:#30363d;margin-top:2px;font-family:'IBM Plex Mono',monospace">${wifiIp}</p>` : ''}
              </div>
              <div style="background:#1c2128;padding:10px 12px;text-align:center">
                <p style="font-size:8px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Screen</p>
                <p style="font-size:11px;font-weight:500;color:#c9d1d9;margin-top:2px">${screenRes || '–'}</p>
              </div>
              <div style="background:#1c2128;padding:10px 12px;text-align:center">
                <p style="font-size:8px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Uploads</p>
                <p style="font-size:16px;font-weight:700;color:#58a6ff">${ds.total}</p>
              </div>
              <div style="background:#1c2128;padding:10px 12px;text-align:center">
                <p style="font-size:8px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Success</p>
                <p style="font-size:16px;font-weight:700;color:#3fb950">${ds.total > 0 ? successRate + '%' : '–'}</p>
              </div>
            </div>
          </div>`;
      }).join('') : `
        <div style="text-align:center;padding:60px 20px">
          <div style="width:56px;height:56px;background:#1c2128;border:none;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px">
            <svg width="28" height="28" fill="none" stroke="#30363d" stroke-width="1.3" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/></svg>
          </div>
          <p style="font-size:13px;color:#8b949e;margin-bottom:4px">No devices detected</p>
          <p style="font-size:11px;color:#484f58;margin-bottom:16px">Connect your Android phone via USB cable and enable USB Debugging</p>
          <div style="display:flex;gap:8px;justify-content:center">
            <button class="btn" data-action="guide">Setup Guide</button>
            <button class="btn btn-primary" data-action="scan">Scan Devices</button>
          </div>
        </div>
      `}
    </div>
  `;
}
