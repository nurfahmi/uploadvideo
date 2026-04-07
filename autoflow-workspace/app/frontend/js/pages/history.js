// ── History Page ──────────────────────────────────────

import { $, esc } from '../utils/helpers.js';
import state, { on } from '../state.js';

const { invoke } = window.__TAURI__.core;

let filter = { status: 'all', platform: 'all', period: 'all' };
let loaded = false;

export function init() {
  on('history', () => { if (state.activeRoute === 'history') render(); });
}

export async function render() {
  const panel = $('#page-history');

  if (!loaded) {
    try { const data = await invoke('get_history'); state.history = Array.isArray(data) ? data : []; loaded = true; } catch (e) { state.history = []; loaded = true; }
  }

  const all = state.history;
  const filtered = applyFilters(all);
  const successCount = filtered.filter(h => h.status === 'success').length;
  const failedCount = filtered.filter(h => h.status === 'failed').length;
  const totalRate = filtered.length ? (successCount / filtered.length * 100).toFixed(1) : 0;

  // Today stats
  const today = new Date().toISOString().slice(0, 10);
  const todayAll = all.filter(h => h.timestamp?.startsWith(today));
  const todaySuccess = todayAll.filter(h => h.status === 'success').length;

  panel.innerHTML = `
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div>
        <h2 style="font-size:15px;font-weight:700;color:#f0f6fc">Upload History</h2>
        <p style="font-size:10px;color:#484f58;margin-top:2px">${all.length} total records</p>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <select id="filter-period">
          <option value="all" ${filter.period==='all'?'selected':''}>All time</option>
          <option value="today" ${filter.period==='today'?'selected':''}>Today</option>
          <option value="week" ${filter.period==='week'?'selected':''}>This week</option>
          <option value="month" ${filter.period==='month'?'selected':''}>This month</option>
        </select>
        <select id="filter-platform">
          <option value="all" ${filter.platform==='all'?'selected':''}>All platforms</option>
          <option value="tiktok_upload" ${filter.platform==='tiktok_upload'?'selected':''}>TikTok</option>
          <option value="shopee_upload" ${filter.platform==='shopee_upload'?'selected':''}>Shopee</option>
        </select>
        <select id="filter-status">
          <option value="all" ${filter.status==='all'?'selected':''}>All status</option>
          <option value="success" ${filter.status==='success'?'selected':''}>Success</option>
          <option value="failed" ${filter.status==='failed'?'selected':''}>Failed</option>
        </select>
        <button class="btn" id="btn-export">Export CSV</button>
        ${all.length ? '<button class="btn btn-danger" id="btn-clear-history">Clear</button>' : ''}
      </div>
    </div>

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Filtered</p>
        <p style="font-size:22px;font-weight:700;color:#58a6ff">${filtered.length}</p>
      </div>
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Successful</p>
        <p style="font-size:22px;font-weight:700;color:#3fb950">${successCount}</p>
        <p style="font-size:9px;color:#484f58;margin-top:2px">${totalRate}% rate</p>
      </div>
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Failed</p>
        <p style="font-size:22px;font-weight:700;color:#f85149">${failedCount}</p>
      </div>
      <div class="stat">
        <p style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Today</p>
        <p style="font-size:22px;font-weight:700;color:#39d2c0">${todayAll.length}</p>
        <p style="font-size:9px;color:#484f58;margin-top:2px">${todaySuccess} success</p>
      </div>
    </div>

    <!-- Table -->
    <div class="card" style="overflow:hidden">
      <table class="tbl">
        <thead><tr>
          <th style="width:28px">#</th>
          <th>Time</th>
          <th>Video</th>
          <th>Platform</th>
          <th>Devices</th>
          <th>Status</th>
        </tr></thead>
        <tbody>
          ${filtered.length === 0 ? `
            <tr><td colspan="6" style="padding:40px;text-align:center">
              <svg width="32" height="32" fill="none" stroke="#21262d" stroke-width="1" viewBox="0 0 24 24" style="margin:0 auto 8px;display:block"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <p style="color:#484f58;font-size:12px">No upload history yet</p>
              <p style="color:#30363d;font-size:10px;margin-top:2px">Records will appear here after running automation</p>
            </td></tr>
          ` : filtered.slice(0, 200).reverse().map((h, idx) => {
            const platLabel = h.platform === 'tiktok_upload' ? 'TikTok' : h.platform === 'shopee_upload' ? 'Shopee' : h.platform || '–';
            const platC = platLabel === 'TikTok' ? 'purple' : 'blue';
            const isSuccess = h.status === 'success';
            const d = new Date(h.timestamp);
            const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            const fileName = (h.video_name || '–').split('/').pop().split('\\').pop();
            const devCount = h.device_count || 1;

            return `<tr>
              <td style="color:#30363d;font-size:10px;font-family:'IBM Plex Mono',monospace">${filtered.length - idx}</td>
              <td>
                <div>
                  <p style="font-size:10px;color:#c9d1d9">${dateStr}</p>
                  <p style="font-size:9px;color:#484f58;font-family:'IBM Plex Mono',monospace">${timeStr}</p>
                </div>
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:6px">
                  <div style="width:24px;height:16px;background:#21262d;border-radius:3px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                    <svg width="8" height="8" fill="none" stroke="#484f58" stroke-width="2" viewBox="0 0 24 24"><path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/></svg>
                  </div>
                  <span style="font-size:10px;color:#c9d1d9;font-family:'IBM Plex Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px" title="${esc(h.video_name || '')}">${esc(fileName)}</span>
                </div>
              </td>
              <td><span class="badge b-${platC}">${platLabel}</span></td>
              <td>
                <div style="display:flex;align-items:center;gap:4px">
                  <svg width="10" height="10" fill="none" stroke="#484f58" stroke-width="1.5" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/></svg>
                  <span style="font-size:10px;color:#8b949e">${devCount}</span>
                </div>
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:4px">
                  ${isSuccess
                    ? '<svg width="12" height="12" fill="none" stroke="#3fb950" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span class="badge b-green">Success</span>'
                    : '<svg width="12" height="12" fill="none" stroke="#f85149" stroke-width="2" viewBox="0 0 24 24"><path d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span class="badge b-red">Failed</span>'
                  }
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    ${filtered.length > 200 ? `<p style="text-align:center;font-size:10px;color:#484f58;margin-top:8px">Showing 200 of ${filtered.length} records</p>` : ''}
  `;

  panel.querySelector('#filter-status')?.addEventListener('change', (e) => { filter.status = e.target.value; render(); });
  panel.querySelector('#filter-platform')?.addEventListener('change', (e) => { filter.platform = e.target.value; render(); });
  panel.querySelector('#filter-period')?.addEventListener('change', (e) => { filter.period = e.target.value; render(); });
  panel.querySelector('#btn-export')?.addEventListener('click', exportCSV);
  panel.querySelector('#btn-clear-history')?.addEventListener('click', clearHistory);
}

function applyFilters(history) {
  let result = [...history];
  if (filter.status !== 'all') result = result.filter(h => h.status === filter.status);
  if (filter.platform !== 'all') result = result.filter(h => h.platform === filter.platform);
  if (filter.period !== 'all') {
    const now = new Date();
    let cutoff;
    if (filter.period === 'today') cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (filter.period === 'week') { cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 7); }
    else if (filter.period === 'month') { cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 1); }
    if (cutoff) result = result.filter(h => new Date(h.timestamp) >= cutoff);
  }
  return result;
}

async function clearHistory() {
  state.history = [];
  try { await invoke('append_history', { records: [] }); } catch (e) {}
  loaded = false;
  render();
}

function exportCSV() {
  const filtered = applyFilters(state.history);
  if (!filtered.length) return;
  const headers = ['#', 'Timestamp', 'Date', 'Time', 'Video', 'Platform', 'Devices', 'Status'];
  const rows = filtered.map((h, i) => {
    const d = new Date(h.timestamp);
    return [
      i + 1,
      h.timestamp,
      d.toLocaleDateString('en-US'),
      d.toLocaleTimeString('en-US', { hour12: false }),
      h.video_name || '',
      h.platform === 'tiktok_upload' ? 'TikTok' : 'Shopee',
      h.device_count || 1,
      h.status,
    ];
  });
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `autoflow-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
