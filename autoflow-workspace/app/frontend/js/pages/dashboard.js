// ── Dashboard Page ────────────────────────────────────

import { $, esc, formatDate } from '../utils/helpers.js';
import state, { on } from '../state.js';
import { navigate } from '../router.js';

const { invoke } = window.__TAURI__.core;

export function init() {
  const panel = $('#page-dashboard');
  panel.addEventListener('click', (e) => {
    const action = e.target.closest('[data-quick]');
    if (!action) return;
    const a = action.dataset.quick;
    if (a === 'upload') navigate('queue');
    if (a === 'devices') navigate('devices');
    if (a === 'import') {
      navigate('queue');
      // Trigger CSV import after navigation renders
      setTimeout(() => document.getElementById('btn-import-csv-new')?.click(), 100);
    }
  });

  on('history', render);
  on('devices', render);
  on('queue', render);
}

export async function render() {
  const panel = $('#page-dashboard');

  // Load history if not loaded
  if (!state.history.length) {
    try {
      const data = await invoke('get_history');
      state.history = Array.isArray(data) ? data : [];
    } catch (e) { /* no history yet */ }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayHistory = state.history.filter(h => h.timestamp?.startsWith(today));
  const successCount = todayHistory.filter(h => h.status === 'success').length;
  const failedCount = todayHistory.filter(h => h.status === 'failed').length;
  const totalToday = todayHistory.length;
  const queueCount = state.queue.length;

  const devices = state.devices;
  const recentHistory = state.history.slice(-5).reverse();

  panel.innerHTML = `
    <div class="p-5 space-y-5">
      <!-- Stats -->
      <div class="grid grid-cols-4 gap-3">
        ${statCard('Upload Hari Ini', totalToday, 'text-indigo-400', statsIcon('upload'))}
        ${statCard('Berhasil', successCount, 'text-emerald-400', statsIcon('check'))}
        ${statCard('Gagal', failedCount, 'text-red-400', statsIcon('x'))}
        ${statCard('Antrian', queueCount, 'text-amber-400', statsIcon('queue'))}
      </div>

      <div class="grid grid-cols-2 gap-4">
        <!-- Connected Devices -->
        <div class="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-wider">Devices</h3>
            <span class="text-[10px] text-slate-600">${devices.length} connected</span>
          </div>
          ${devices.length ? `
            <div class="space-y-2">
              ${devices.slice(0, 4).map(([id, model]) => `
                <div class="flex items-center gap-2">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                  <span class="text-xs text-slate-300">${esc(model)}</span>
                  <span class="text-[10px] text-slate-600 font-mono">${esc(id.slice(-6))}</span>
                </div>
              `).join('')}
              ${devices.length > 4 ? `<p class="text-[10px] text-slate-600">+${devices.length - 4} more</p>` : ''}
            </div>
          ` : `
            <p class="text-xs text-slate-600 italic">Belum ada device terhubung</p>
          `}
        </div>

        <!-- Quick Actions -->
        <div class="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
          <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Quick Actions</h3>
          <div class="space-y-2">
            <button data-quick="upload" class="w-full flex items-center gap-2.5 px-3 py-2 bg-indigo-600/10 border border-indigo-500/20 rounded-lg text-xs text-indigo-400 hover:bg-indigo-600/20 transition-colors cursor-pointer">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
              Upload Video
            </button>
            <button data-quick="import" class="w-full flex items-center gap-2.5 px-3 py-2 bg-emerald-600/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400 hover:bg-emerald-600/20 transition-colors cursor-pointer">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
              Import CSV
            </button>
            <button data-quick="devices" class="w-full flex items-center gap-2.5 px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-xs text-slate-400 hover:bg-slate-800 transition-colors cursor-pointer">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              Scan Devices
            </button>
          </div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Aktivitas Terakhir</h3>
        ${recentHistory.length ? `
          <div class="space-y-2">
            ${recentHistory.map(h => {
              const badge = h.status === 'success'
                ? '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">Success</span>'
                : '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">Failed</span>';
              return `
                <div class="flex items-center gap-3 text-xs">
                  <span class="text-[10px] text-slate-600 font-mono w-20 shrink-0">${formatDate(h.timestamp)}</span>
                  <span class="text-slate-300 flex-1 truncate">${esc(h.video_name || 'Unknown')}</span>
                  <span class="text-[10px] text-slate-500">${h.platform === 'tiktok_upload' ? 'TikTok' : 'Shopee'}</span>
                  ${badge}
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <p class="text-xs text-slate-600 italic">Belum ada aktivitas</p>
        `}
      </div>
    </div>
  `;
}

function statCard(label, value, color, icon) {
  return `
    <div class="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-[10px] text-slate-500 font-medium uppercase tracking-wider">${label}</span>
        ${icon}
      </div>
      <span class="text-2xl font-bold ${color}">${value}</span>
    </div>
  `;
}

function statsIcon(type) {
  const icons = {
    upload: '<svg class="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>',
    check: '<svg class="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    x: '<svg class="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    queue: '<svg class="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>',
  };
  return icons[type] || '';
}
