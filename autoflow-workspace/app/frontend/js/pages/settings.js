// ── Settings Page ─────────────────────────────────────

import { $ } from '../utils/helpers.js';
import state from '../state.js';
import { appendLog } from '../components/console-panel.js';

const { invoke } = window.__TAURI__.core;

export function init() {}

export function render() {
  const panel = $('#page-settings');
  const c = state.config;

  panel.innerHTML = `
    <div class="p-5 max-w-xl space-y-6">

      <!-- Upload Delays -->
      <section class="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Delay Upload</h3>
        <p class="text-[10px] text-slate-500 mb-3">Jeda waktu antara setiap upload (dalam detik)</p>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-[10px] text-slate-500 font-medium block mb-1">Minimum</label>
            <input type="number" id="set-delay-min" value="${c.delay_min ?? 5}" min="1" max="300"
              class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors" />
          </div>
          <div>
            <label class="text-[10px] text-slate-500 font-medium block mb-1">Maximum</label>
            <input type="number" id="set-delay-max" value="${c.delay_max ?? 15}" min="1" max="300"
              class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors" />
          </div>
        </div>
      </section>

      <!-- Safety Limits -->
      <section class="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Safety Limits</h3>
        <div>
          <label class="text-[10px] text-slate-500 font-medium block mb-1">Max upload per hari</label>
          <input type="number" id="set-max-uploads" value="${c.max_uploads_per_day ?? 50}" min="1" max="1000"
            class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors" />
          <p class="text-[10px] text-slate-600 mt-1">Otomasi akan berhenti setelah mencapai batas ini</p>
        </div>
      </section>

      <!-- Setup Wizard -->
      <section class="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Setup</h3>
        <button id="btn-replay-wizard" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg transition-colors cursor-pointer">
          Replay Setup Wizard
        </button>
      </section>

      <!-- About -->
      <section class="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">About</h3>
        <div class="space-y-1 text-xs text-slate-500">
          <p><span class="text-slate-400">App:</span> AutoFlow Engine</p>
          <p><span class="text-slate-400">Version:</span> 0.1.0</p>
          <p><span class="text-slate-400">Platform:</span> Tauri 2 + Python Engine</p>
        </div>
      </section>

      <!-- Save Button -->
      <button id="btn-save-settings" class="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-all cursor-pointer">
        Simpan Settings
      </button>
    </div>
  `;

  // Event handlers
  panel.querySelector('#btn-save-settings')?.addEventListener('click', saveSettings);
  panel.querySelector('#btn-replay-wizard')?.addEventListener('click', () => {
    if (typeof onboarding !== 'undefined') onboarding.init(() => {});
  });
}

async function saveSettings() {
  const delayMin = parseInt($('#set-delay-min')?.value) || 5;
  const delayMax = parseInt($('#set-delay-max')?.value) || 15;
  const maxUploads = parseInt($('#set-max-uploads')?.value) || 50;

  const config = {
    ...state.config,
    delay_min: delayMin,
    delay_max: delayMax,
    max_uploads_per_day: maxUploads,
  };

  try {
    await invoke('save_config', { config });
    state.config = config;
    appendLog('[SYSTEM] Settings saved');
  } catch (err) {
    appendLog('[ERROR] Failed to save settings: ' + err);
  }
}
