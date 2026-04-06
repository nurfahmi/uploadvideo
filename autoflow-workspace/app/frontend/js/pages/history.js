// ── History Page ──────────────────────────────────────

import { $, esc, formatDateFull } from '../utils/helpers.js';
import state, { on } from '../state.js';

const { invoke } = window.__TAURI__.core;

let filter = { status: 'all', platform: 'all', period: 'all' };
let loaded = false;

export function init() {
  on('history', () => { if (state.activeRoute === 'history') render(); });
}

export function renderActions(container) {
  container.innerHTML = `
    <button id="btn-export-csv" class="text-xs text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1 font-medium cursor-pointer">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      Export CSV
    </button>
  `;
  container.querySelector('#btn-export-csv')?.addEventListener('click', exportCSV);
}

export async function render() {
  const panel = $('#page-history');

  // Load on first render
  if (!loaded) {
    try {
      const data = await invoke('get_history');
      state.history = Array.isArray(data) ? data : [];
      loaded = true;
    } catch (e) { state.history = []; loaded = true; }
  }

  const filtered = applyFilters(state.history);

  panel.innerHTML = `
    <div class="flex flex-col h-full">
      <!-- Filters -->
      <div class="px-5 py-2.5 border-b border-slate-800 flex items-center gap-3 shrink-0">
        <select id="filter-period" class="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-300 focus:outline-none">
          <option value="all" ${filter.period==='all'?'selected':''}>Semua Waktu</option>
          <option value="today" ${filter.period==='today'?'selected':''}>Hari Ini</option>
          <option value="week" ${filter.period==='week'?'selected':''}>Minggu Ini</option>
          <option value="month" ${filter.period==='month'?'selected':''}>Bulan Ini</option>
        </select>
        <select id="filter-platform" class="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-300 focus:outline-none">
          <option value="all" ${filter.platform==='all'?'selected':''}>Semua Platform</option>
          <option value="tiktok_upload" ${filter.platform==='tiktok_upload'?'selected':''}>TikTok</option>
          <option value="shopee_upload" ${filter.platform==='shopee_upload'?'selected':''}>Shopee</option>
        </select>
        <select id="filter-status" class="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-300 focus:outline-none">
          <option value="all" ${filter.status==='all'?'selected':''}>Semua Status</option>
          <option value="success" ${filter.status==='success'?'selected':''}>Success</option>
          <option value="failed" ${filter.status==='failed'?'selected':''}>Failed</option>
        </select>
        <span class="text-[10px] text-slate-600 ml-auto">${filtered.length} records</span>
      </div>

      <!-- Table -->
      <div class="flex-1 overflow-auto">
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-slate-900 z-10">
            <tr class="border-b border-slate-800">
              <th class="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Waktu</th>
              <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Video</th>
              <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Platform</th>
              <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Devices</th>
              <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? `
              <tr><td colspan="5" class="px-5 py-12 text-center text-slate-600 text-xs italic">Belum ada riwayat upload</td></tr>
            ` : filtered.slice(0, 100).reverse().map(h => {
              const badge = h.status === 'success'
                ? '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">Success</span>'
                : '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">Failed</span>';
              const platLabel = h.platform === 'tiktok_upload' ? 'TikTok' : h.platform === 'shopee_upload' ? 'Shopee' : h.platform;
              return `
                <tr class="border-b border-slate-800/50 hover:bg-slate-900/50">
                  <td class="px-4 py-2 text-slate-500 font-mono text-[10px] whitespace-nowrap">${formatDateFull(h.timestamp)}</td>
                  <td class="px-3 py-2 text-slate-300 max-w-[200px] truncate">${esc(h.video_name || '-')}</td>
                  <td class="px-3 py-2 text-slate-500">${platLabel}</td>
                  <td class="px-3 py-2 text-slate-500">${h.device_count || 1}</td>
                  <td class="px-3 py-2">${badge}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Filter event handlers
  panel.querySelector('#filter-period')?.addEventListener('change', (e) => { filter.period = e.target.value; render(); });
  panel.querySelector('#filter-platform')?.addEventListener('change', (e) => { filter.platform = e.target.value; render(); });
  panel.querySelector('#filter-status')?.addEventListener('change', (e) => { filter.status = e.target.value; render(); });
}

function applyFilters(history) {
  let result = [...history];

  if (filter.status !== 'all') {
    result = result.filter(h => h.status === filter.status);
  }
  if (filter.platform !== 'all') {
    result = result.filter(h => h.platform === filter.platform);
  }
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

function exportCSV() {
  const filtered = applyFilters(state.history);
  if (!filtered.length) return;

  const headers = ['Timestamp', 'Video', 'Platform', 'Devices', 'Status'];
  const rows = filtered.map(h => [
    h.timestamp,
    h.video_name || '',
    h.platform === 'tiktok_upload' ? 'TikTok' : 'Shopee',
    h.device_count || 1,
    h.status,
  ]);

  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `autoflow-history-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
