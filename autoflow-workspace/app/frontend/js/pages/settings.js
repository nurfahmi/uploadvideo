// ── Settings Page ─────────────────────────────────────

import { $ } from '../utils/helpers.js';
import state from '../state.js';
import { appendLog } from '../components/console-panel.js';

const { invoke } = window.__TAURI__.core;

let saveTimer = null;

function autoSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const config = {
      ...state.config,
      delay_min: parseInt($('#set-delay-min')?.value) || 30,
      delay_max: parseInt($('#set-delay-max')?.value) || 120,
      max_uploads_per_day: parseInt($('#set-max-uploads')?.value) || 30,
      distribution: $('#set-distribution')?.value || 'uniform',
      license_key: $('#set-license')?.value || '',
      language: $('#set-lang')?.value || 'en',
    };
    try {
      await invoke('save_config', { config });
      state.config = config;
    } catch (err) {
      appendLog('[ERROR] Auto-save failed: ' + err);
    }
  }, 600);
}

export function init() {}

export function render() {
  const panel = $('#page-settings');
  const c = state.config;
  const devCount = state.devices.length;
  const historyCount = state.history.length;

  panel.innerHTML = `
    <div style="margin-bottom:16px">
      <h2 style="font-size:15px;font-weight:700;color:#f0f6fc">Settings</h2>
      <p style="font-size:10px;color:#484f58;margin-top:2px">Changes are saved automatically</p>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px">

      <!-- Delay & Safety -->
      <div>
        <p style="font-size:9px;font-weight:600;color:#484f58;text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">Delay & Safety</p>
        <div class="card" style="padding:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:4px">Min delay (sec)</label>
              <input type="number" id="set-delay-min" value="${c.delay_min ?? 30}" min="1" max="600" class="inp" style="width:100%">
            </div>
            <div>
              <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:4px">Max delay (sec)</label>
              <input type="number" id="set-delay-max" value="${c.delay_max ?? 120}" min="1" max="600" class="inp" style="width:100%">
            </div>
            <div>
              <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:4px">Distribution</label>
              <select id="set-distribution" style="width:100%">
                <option value="uniform" ${c.distribution !== 'gaussian' ? 'selected' : ''}>Uniform (evenly random)</option>
                <option value="gaussian" ${c.distribution === 'gaussian' ? 'selected' : ''}>Gaussian (bell curve)</option>
              </select>
            </div>
            <div>
              <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:4px">Max uploads / phone / day</label>
              <input type="number" id="set-max-uploads" value="${c.max_uploads_per_day ?? 30}" min="1" max="1000" class="inp" style="width:100%">
            </div>
          </div>
          <p style="font-size:9px;color:#30363d;margin-top:8px">Random pause between each upload to avoid detection</p>
        </div>
      </div>

      <!-- License -->
      <div>
        <p style="font-size:9px;font-weight:600;color:#484f58;text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">License</p>
        <div class="card" style="padding:16px">
          <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:4px">License key</label>
          <div style="display:flex;gap:6px">
            <input type="text" id="set-license" value="${c.license_key || ''}" class="inp" style="flex:1;font-family:'IBM Plex Mono',monospace;font-size:10px" placeholder="XXXX-XXXX-XXXX-XXXX">
            <button class="btn" id="btn-validate-license">Validate</button>
          </div>
          ${c.license_key ? `
            <div style="margin-top:10px;padding:10px 12px;background:rgba(63,185,80,.06);border-radius:8px">
              <div style="display:flex;align-items:center;gap:6px">
                <svg width="12" height="12" fill="none" stroke="#3fb950" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <span style="font-size:10px;color:#3fb950;font-weight:600">Pro License Active</span>
              </div>
              <p style="font-size:9px;color:#484f58;margin-top:3px">10 phones, 300 videos/day, all templates</p>
            </div>
          ` : `
            <div style="margin-top:10px;padding:10px 12px;background:rgba(139,148,158,.04);border-radius:8px">
              <span style="font-size:10px;color:#8b949e">Free Plan</span>
              <p style="font-size:9px;color:#484f58;margin-top:2px">2 phones, 50 videos/day, basic templates</p>
            </div>
          `}
        </div>
      </div>

      <!-- Application -->
      <div>
        <p style="font-size:9px;font-weight:600;color:#484f58;text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">Application</p>
        <div class="card" style="padding:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:4px">Language</label>
              <select id="set-lang" style="width:100%">
                <option value="en" ${c.language !== 'id' ? 'selected' : ''}>English</option>
                <option value="id" ${c.language === 'id' ? 'selected' : ''}>Bahasa Indonesia</option>
              </select>
            </div>
            <div>
              <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:4px">Theme</label>
              <select id="set-theme" style="width:100%">
                <option value="dark">Dark</option>
                <option value="light" disabled>Light (coming soon)</option>
              </select>
            </div>
          </div>
          <div style="margin-top:10px">
            <button class="btn" id="btn-replay-wizard" style="width:100%">Replay Setup Wizard</button>
          </div>
        </div>
      </div>

      <!-- Data & Storage -->
      <div>
        <p style="font-size:9px;font-weight:600;color:#484f58;text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">Data & Storage</p>
        <div class="card" style="padding:16px">
          <div style="display:flex;flex-direction:column;gap:0">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(33,38,45,.3)">
              <span style="font-size:11px;color:#c9d1d9">Upload history</span>
              <span style="font-size:11px;color:#8b949e;font-family:'IBM Plex Mono',monospace">${historyCount} records</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(33,38,45,.3)">
              <span style="font-size:11px;color:#c9d1d9">Connected devices</span>
              <span style="font-size:11px;color:#8b949e;font-family:'IBM Plex Mono',monospace">${devCount} phones</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0">
              <span style="font-size:11px;color:#c9d1d9">Queue items</span>
              <span style="font-size:11px;color:#8b949e;font-family:'IBM Plex Mono',monospace">${state.queue.length} videos</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;margin-top:12px">
            <button class="btn btn-danger" id="btn-clear-history">Clear History</button>
            <button class="btn btn-danger" id="btn-clear-queue">Clear Queue</button>
          </div>
        </div>
      </div>

      <!-- About -->
      <div>
        <p style="font-size:9px;font-weight:600;color:#484f58;text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">About</p>
        <div class="card" style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(33,38,45,.3)">
            <span style="font-size:11px;color:#c9d1d9">Application</span>
            <span style="font-size:11px;color:#8b949e">AUV - AutoFlow Uploader Video</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
            <span style="font-size:11px;color:#c9d1d9">Version</span>
            <span style="font-size:11px;color:#8b949e;font-family:'IBM Plex Mono',monospace">v1.0.0</span>
          </div>
          <p style="font-size:9px;color:#30363d;margin-top:8px">Built by wrk-project</p>
        </div>
      </div>

    </div>
  `;

  // Auto-save on any input/change
  panel.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', autoSave);
    el.addEventListener('change', autoSave);
  });

  panel.querySelector('#btn-replay-wizard')?.addEventListener('click', () => {
    if (window.onboarding) window.onboarding.init(() => {});
    else appendLog('[SYSTEM] Onboarding wizard not available');
  });
  panel.querySelector('#btn-validate-license')?.addEventListener('click', async () => {
    const key = $('#set-license')?.value?.trim();
    if (!key) { appendLog('[SYSTEM] Enter a license key first'); return; }
    state.config.license_key = key;
    try {
      await invoke('save_config', { config: state.config });
      appendLog('[SYSTEM] License key saved');
      render();
    } catch (e) {
      appendLog('[ERROR] Failed to save license: ' + e);
    }
  });
  panel.querySelector('#btn-clear-history')?.addEventListener('click', async () => {
    if (state.history.length === 0) return;
    if (!confirm(`Clear all ${state.history.length} history records? This cannot be undone.`)) return;
    try {
      await invoke('clear_history');
      state.history = [];
      appendLog('[SYSTEM] History cleared');
    } catch (e) {
      appendLog('[ERROR] Failed to clear history: ' + e);
    }
    render();
  });
  panel.querySelector('#btn-clear-queue')?.addEventListener('click', () => {
    if (state.queue.length === 0) return;
    if (!confirm(`Clear all ${state.queue.length} items in queue?`)) return;
    state.queue = [];
    appendLog('[SYSTEM] Queue cleared');
    render();
  });
}
