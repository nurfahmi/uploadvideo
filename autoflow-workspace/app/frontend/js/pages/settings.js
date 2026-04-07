// ── Settings Page ─────────────────────────────────────

import { $ } from '../utils/helpers.js';
import state from '../state.js';
import { appendLog } from '../components/console-panel.js';

const { invoke } = window.__TAURI__.core;

export function init() {}

export function render() {
  const panel = $('#page-settings');
  const c = state.config;
  const devCount = state.devices.length;
  const historyCount = state.history.length;

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div>
        <h2 style="font-size:15px;font-weight:700;color:#f0f6fc">Settings</h2>
        <p style="font-size:10px;color:#484f58;margin-top:2px">Configure automation behavior and preferences</p>
      </div>
      <button class="btn btn-primary" id="btn-save-top">Save settings</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:720px">

      <!-- Delay & Safety -->
      <div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
          <svg width="14" height="14" fill="none" stroke="#58a6ff" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span style="font-size:10px;font-weight:600;color:#c9d1d9;text-transform:uppercase;letter-spacing:.5px">Delay & Safety</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:3px">Min delay (sec)</label>
            <input type="number" id="set-delay-min" value="${c.delay_min ?? 30}" min="1" max="600" class="inp" style="width:100%">
          </div>
          <div>
            <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:3px">Max delay (sec)</label>
            <input type="number" id="set-delay-max" value="${c.delay_max ?? 120}" min="1" max="600" class="inp" style="width:100%">
          </div>
        </div>
        <p style="font-size:9px;color:#30363d;margin-top:6px">Random pause between each upload to avoid detection</p>

        <div style="margin-top:10px">
          <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:3px">Distribution</label>
          <select id="set-distribution" style="width:100%">
            <option value="uniform" ${c.distribution !== 'gaussian' ? 'selected' : ''}>Uniform (evenly random)</option>
            <option value="gaussian" ${c.distribution === 'gaussian' ? 'selected' : ''}>Gaussian (bell curve, more natural)</option>
          </select>
        </div>

        <div style="margin-top:10px">
          <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:3px">Max uploads per phone per day</label>
          <input type="number" id="set-max-uploads" value="${c.max_uploads_per_day ?? 30}" min="1" max="1000" class="inp" style="width:100%">
          <p style="font-size:9px;color:#30363d;margin-top:4px">Automation stops after reaching this limit</p>
        </div>
      </div>

      <!-- License -->
      <div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
          <svg width="14" height="14" fill="none" stroke="#d29922" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
          <span style="font-size:10px;font-weight:600;color:#c9d1d9;text-transform:uppercase;letter-spacing:.5px">License</span>
        </div>
        <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:3px">License key</label>
        <div style="display:flex;gap:6px">
          <input type="text" id="set-license" value="${c.license_key || ''}" class="inp" style="flex:1;font-family:'IBM Plex Mono',monospace;font-size:10px" placeholder="XXXX-XXXX-XXXX-XXXX">
          <button class="btn btn-accent" id="btn-validate-license">Validate</button>
        </div>
        ${c.license_key ? `
          <div style="margin-top:8px;padding:8px 10px;background:rgba(63,185,80,.06);border:1px solid rgba(63,185,80,.2);border-radius:5px">
            <div style="display:flex;align-items:center;gap:6px">
              <svg width="12" height="12" fill="none" stroke="#3fb950" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <span style="font-size:10px;color:#3fb950;font-weight:600">Pro License Active</span>
            </div>
            <p style="font-size:9px;color:#484f58;margin-top:3px">10 phones, 300 videos/day, all templates</p>
          </div>
        ` : `
          <div style="margin-top:8px;padding:8px 10px;background:rgba(139,148,158,.06);border:1px solid #21262d;border-radius:5px">
            <span style="font-size:10px;color:#8b949e">Free Plan</span>
            <p style="font-size:9px;color:#484f58;margin-top:2px">2 phones, 50 videos/day, basic templates</p>
          </div>
        `}
      </div>

      <!-- Application -->
      <div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
          <svg width="14" height="14" fill="none" stroke="#bc8cff" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          <span style="font-size:10px;font-weight:600;color:#c9d1d9;text-transform:uppercase;letter-spacing:.5px">Application</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:3px">Language</label>
            <select id="set-lang" style="width:100%">
              <option value="en" ${c.language !== 'id' ? 'selected' : ''}>English</option>
              <option value="id" ${c.language === 'id' ? 'selected' : ''}>Bahasa Indonesia</option>
            </select>
          </div>
          <div>
            <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:3px">Theme</label>
            <select id="set-theme" style="width:100%">
              <option value="dark">Dark</option>
              <option value="light" disabled>Light (coming soon)</option>
            </select>
          </div>
          <div>
            <label style="font-size:10px;color:#8b949e;display:block;margin-bottom:3px">Auto-update</label>
            <select id="set-updates" style="width:100%">
              <option value="auto">Auto-check on startup</option>
              <option value="manual">Manual only</option>
            </select>
          </div>
          <div style="display:flex;align-items:flex-end">
            <button id="btn-replay-wizard" class="btn" style="width:100%">Setup Wizard</button>
          </div>
        </div>
      </div>

      <!-- Data & Storage -->
      <div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
          <svg width="14" height="14" fill="none" stroke="#39d2c0" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/></svg>
          <span style="font-size:10px;font-weight:600;color:#c9d1d9;text-transform:uppercase;letter-spacing:.5px">Data & Storage</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #21262d">
            <span style="font-size:10px;color:#8b949e">Upload history</span>
            <span style="font-size:10px;color:#c9d1d9;font-family:'IBM Plex Mono',monospace">${historyCount} records</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #21262d">
            <span style="font-size:10px;color:#8b949e">Connected devices</span>
            <span style="font-size:10px;color:#c9d1d9;font-family:'IBM Plex Mono',monospace">${devCount} phones</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #21262d">
            <span style="font-size:10px;color:#8b949e">Queue items</span>
            <span style="font-size:10px;color:#c9d1d9;font-family:'IBM Plex Mono',monospace">${state.queue.length} videos</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn btn-danger" id="btn-clear-history" style="font-size:10px">Clear history</button>
          <button class="btn btn-danger" id="btn-clear-queue" style="font-size:10px">Clear queue</button>
        </div>
      </div>

      <!-- About (full width) -->
      <div class="card" style="padding:16px;grid-column:1/3">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
          <svg width="14" height="14" fill="none" stroke="#484f58" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span style="font-size:10px;font-weight:600;color:#c9d1d9;text-transform:uppercase;letter-spacing:.5px">About</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <p style="font-size:9px;color:#484f58;margin-bottom:2px">APPLICATION</p>
            <p style="font-size:11px;color:#c9d1d9;font-weight:500">AUV - AutoFlow Uploader Video</p>
          </div>
          <div>
            <p style="font-size:9px;color:#484f58;margin-bottom:2px">VERSION</p>
            <p style="font-size:11px;color:#c9d1d9;font-weight:500;font-family:'IBM Plex Mono',monospace">v1.0.0</p>
          </div>
        </div>
        <p style="font-size:9px;color:#30363d;margin-top:8px">Built by wrk-project</p>
      </div>
    </div>

    <!-- Save status -->
    <div id="save-status" style="margin-top:12px;display:none"></div>
  `;

  panel.querySelector('#btn-save-top')?.addEventListener('click', saveSettings);
  panel.querySelector('#btn-replay-wizard')?.addEventListener('click', () => {
    if (typeof onboarding !== 'undefined') onboarding.init(() => {});
  });
  panel.querySelector('#btn-clear-history')?.addEventListener('click', async () => {
    if (state.history.length === 0) return;
    state.history = [];
    try { await invoke('save_config', { config: state.config }); } catch (e) {}
    // Clear history file by appending empty
    try {
      await invoke('append_history', { records: [] });
      appendLog('[SYSTEM] History cleared');
    } catch (e) {}
    render();
  });
  panel.querySelector('#btn-clear-queue')?.addEventListener('click', () => {
    state.queue = [];
    appendLog('[SYSTEM] Queue cleared');
    render();
  });
}

async function saveSettings() {
  const config = {
    ...state.config,
    delay_min: parseInt($('#set-delay-min')?.value) || 30,
    delay_max: parseInt($('#set-delay-max')?.value) || 120,
    max_uploads_per_day: parseInt($('#set-max-uploads')?.value) || 30,
    distribution: $('#set-distribution')?.value || 'uniform',
    license_key: $('#set-license')?.value || '',
    language: $('#set-lang')?.value || 'en',
  };
  const status = $('#save-status');
  try {
    await invoke('save_config', { config });
    state.config = config;
    appendLog('[SYSTEM] Settings saved');
    if (status) {
      status.style.display = 'block';
      status.innerHTML = '<div style="padding:8px 12px;background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.2);border-radius:5px;display:flex;align-items:center;gap:6px"><svg width="12" height="12" fill="none" stroke="#3fb950" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4"/></svg><span style="font-size:10px;color:#3fb950">Settings saved successfully</span></div>';
      setTimeout(() => { if (status) status.style.display = 'none'; }, 3000);
    }
  } catch (err) {
    appendLog('[ERROR] Save failed: ' + err);
    if (status) {
      status.style.display = 'block';
      status.innerHTML = '<div style="padding:8px 12px;background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.2);border-radius:5px;display:flex;align-items:center;gap:6px"><svg width="12" height="12" fill="none" stroke="#f85149" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg><span style="font-size:10px;color:#f85149">Failed to save: ${err}</span></div>';
    }
  }
}
