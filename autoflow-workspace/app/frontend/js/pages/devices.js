// ── Devices Page ──────────────────────────────────────

import { $, esc } from '../utils/helpers.js';
import state, { set, on } from '../state.js';
import { appendLog } from '../components/console-panel.js';

const { invoke } = window.__TAURI__.core;

export function init() {
  const panel = $('#page-devices');
  panel.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox' || !e.target.dataset.deviceId) return;
    if (e.target.checked) state.selectedDevices.add(e.target.dataset.deviceId);
    else state.selectedDevices.delete(e.target.dataset.deviceId);
    render();
  });

  on('devices', render);
}

export function renderActions(container) {
  container.innerHTML = `
    <button id="btn-hp-guide" class="text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 transition-colors font-medium cursor-pointer flex items-center gap-1.5">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      Panduan Setup HP
    </button>
    <button id="btn-scan-devices" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-md transition-colors font-medium cursor-pointer flex items-center gap-1.5">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
      Scan Devices
    </button>
  `;

  container.querySelector('#btn-scan-devices')?.addEventListener('click', refreshDevices);
  container.querySelector('#btn-hp-guide')?.addEventListener('click', () => {
    if (typeof hpGuide !== 'undefined') hpGuide.show();
  });
}

export async function refreshDevices() {
  try {
    const devices = await invoke('list_devices');
    set('devices', devices);
    if (devices.length) {
      devices.forEach(([id]) => state.selectedDevices.add(id));
      appendLog(`[SYSTEM] Found ${devices.length} device(s)`);
    } else {
      appendLog('[SYSTEM] No devices found — connect via USB and enable debugging');
      if (typeof hpGuide !== 'undefined') hpGuide.show();
    }
  } catch (err) {
    appendLog('[ERROR] ' + err);
    set('devices', []);
  }
}

export function render() {
  const panel = $('#page-devices');
  const devices = state.devices;

  if (!devices.length) {
    panel.innerHTML = `
      <div class="p-5">
        <div class="text-center py-12">
          <svg class="w-12 h-12 text-slate-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <p class="text-sm text-slate-500 mb-1">No devices detected</p>
          <p class="text-xs text-slate-600">Connect phones via USB, enable debugging, then click "Scan Devices"</p>
        </div>
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="p-5">
      <p class="text-[10px] text-slate-500 mb-3 font-medium uppercase tracking-wider">
        ${state.selectedDevices.size} of ${devices.length} selected for automation
      </p>
      <div class="space-y-2">
        ${devices.map(([id, model]) => {
          const checked = state.selectedDevices.has(id);
          const health = state.deviceHealth[id];
          const batteryText = health?.battery != null ? `${health.battery}%` : '';
          return `
            <label class="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-lg p-3 cursor-pointer hover:border-slate-700 transition-colors">
              <input type="checkbox" data-device-id="${esc(id)}" ${checked ? 'checked' : ''} class="w-4 h-4 accent-indigo-500 rounded cursor-pointer shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium text-slate-200">${esc(model)}</div>
                <div class="text-[10px] text-slate-500 font-mono">${esc(id)}</div>
              </div>
              ${batteryText ? `<span class="text-[10px] text-slate-500 mr-2">${batteryText}</span>` : ''}
              <span class="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">connected</span>
            </label>
          `;
        }).join('')}
      </div>
    </div>
  `;
}
