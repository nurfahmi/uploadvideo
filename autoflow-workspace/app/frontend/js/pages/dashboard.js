// ── Dashboard Page (mockup v4.3) ──────────────────────

import { $, esc, formatDate } from '../utils/helpers.js';
import state, { on } from '../state.js';
import { navigate } from '../router.js';

const { invoke } = window.__TAURI__.core;

export function init() {
  const panel = $('#page-dashboard');
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'upload') navigate('queue');
    if (a === 'import') navigate('queue');
    if (a === 'devices') navigate('devices');
  });
  on('history', render);
  on('devices', render);
  on('queue', render);
}

export async function render() {
  const panel = $('#page-dashboard');
  if (!state.history.length) {
    try { const data = await invoke('get_history'); state.history = Array.isArray(data) ? data : []; } catch (e) {}
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayH = state.history.filter(h => h.timestamp?.startsWith(today));
  const successCount = todayH.filter(h => h.status === 'success').length;
  const failedCount = todayH.filter(h => h.status === 'failed').length;
  const totalToday = todayH.length;
  const devCount = state.devices.length;
  const recentH = state.history.slice(-5).reverse();

  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div>
        <h1 style="font-size:15px;font-weight:700;color:#f0f6fc">Welcome back</h1>
        <p style="font-size:10px;color:#484f58;margin-top:1px">${dateStr}</p>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn" data-action="import">Import CSV</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Uploaded today</p>
        <p style="font-size:22px;font-weight:700;color:#58a6ff">${totalToday}</p>
        <p style="font-size:9px;color:#484f58;margin-top:2px">Target: ${state.config.max_uploads_per_day || 50}</p>
      </div>
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Successful</p>
        <p style="font-size:22px;font-weight:700;color:#3fb950">${successCount}</p>
        <p style="font-size:9px;color:#484f58;margin-top:2px">${totalToday ? (successCount/totalToday*100).toFixed(1) + '% rate' : 'N/A'}</p>
      </div>
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Failed</p>
        <p style="font-size:22px;font-weight:700;color:#f85149">${failedCount}</p>
        <p style="font-size:9px;color:#484f58;margin-top:2px">${failedCount > 0 ? failedCount + ' retryable' : 'None'}</p>
      </div>
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Connected</p>
        <p style="font-size:22px;font-weight:700;color:#39d2c0">${devCount}</p>
        <p style="font-size:9px;color:#484f58;margin-top:2px">${devCount > 0 ? 'All active' : 'None'}</p>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:5fr 3fr;gap:12px">
      <div>
        <p style="font-size:9px;font-weight:600;color:#484f58;text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">Recent activity</p>
        <div class="card" style="padding:6px">
        ${recentH.length ? recentH.map(h => {
          const sc = h.status === 'success' ? 'green' : h.status === 'failed' ? 'red' : 'amber';
          const sl = h.status === 'success' ? 'Success' : h.status === 'failed' ? 'Failed' : 'Uploading';
          const plat = h.platform === 'tiktok_upload' ? 'TikTok' : 'Shopee';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-radius:8px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='rgba(48,54,61,.25)'" onmouseout="this.style.background='transparent'">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:28px;height:28px;background:#30363d;border-radius:7px;display:flex;align-items:center;justify-content:center">
                <svg width="12" height="12" fill="none" stroke="#484f58" stroke-width="2" viewBox="0 0 24 24"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              </div>
              <div>
                <p style="font-size:11px;font-weight:500;color:#c9d1d9;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((h.video_name || 'Unknown').split('/').pop().split('\\').pop())}</p>
                <p style="font-size:9px;color:#484f58">${plat}</p>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="badge b-${sc}">${sl}</span>
              <span style="font-size:9px;color:#30363d;width:50px;text-align:right">${formatDate(h.timestamp)}</span>
            </div>
          </div>`;
        }).join('') : '<p style="font-size:11px;color:#484f58;padding:8px;text-align:center">No activity yet</p>'}
        </div>
      </div>

      <div>
        <p style="font-size:9px;font-weight:600;color:#484f58;text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">Connected phones</p>
        <div class="card" style="padding:8px">
        <div style="display:flex;flex-direction:column;gap:6px">
          ${state.devices.length ? state.devices.map(([id, model]) => {
            const h = state.deviceHealth[id] || {};
            const brand = h.brand ? h.brand.charAt(0).toUpperCase() + h.brand.slice(1).toLowerCase() : '';
            const displayName = brand || esc(model);
            const bat = h.battery != null ? h.battery + '%' : '–';
            const androidVer = h.android_version ? 'Android ' + h.android_version : '';
            return `
            <div style="background:#161b22;border:none;border-radius:8px;padding:8px 10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-size:11px;font-weight:500;color:#c9d1d9">${displayName}</span>
                <span class="badge b-green">Active</span>
              </div>
              <div style="display:flex;gap:10px;align-items:center">
                <span style="font-size:9px;color:#484f58">${bat !== '–' ? '🔋 ' + bat : ''}</span>
                ${androidVer ? `<span style="font-size:9px;color:#484f58">${androidVer}</span>` : ''}
                ${h.screen_resolution ? `<span style="font-size:9px;color:#30363d">${h.screen_resolution}</span>` : ''}
              </div>
            </div>`;
          }).join('') : '<p style="font-size:11px;color:#484f58;text-align:center;padding:8px">No devices connected</p>'}
          </div>
        </div>
      </div>
    </div>
  `;
}
