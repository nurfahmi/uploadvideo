// ── Settings Page ─────────────────────────────────────

import { $ } from '../utils/helpers.js';
import state, { on } from '../state.js';
import { appendLog } from '../components/console-panel.js';
import { setTheme, getTheme } from '../theme.js';
import { t, setLanguage, getLanguage } from '../i18n.js';
import { renderSidebar } from '../components/sidebar.js';
import { renderHeader } from '../components/header.js';

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
  const lang = getLanguage();

  panel.innerHTML = `
    <div style="margin-bottom:16px">
      <h2 style="font-size:15px;font-weight:700;color:var(--c-fg-0)">${t('settings.title')}</h2>
      <p style="font-size:10px;color:var(--c-fg-3);margin-top:2px">${t('settings.subtitle')}</p>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px">

      <!-- Delay & Safety -->
      <div>
        <p style="font-size:9px;font-weight:600;color:var(--c-fg-3);text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">${t('settings.delay_safety')}</p>
        <div class="card" style="padding:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;color:var(--c-fg-2);display:block;margin-bottom:4px">${t('settings.delay_min')}</label>
              <input type="number" id="set-delay-min" value="${c.delay_min ?? 30}" min="1" max="600" class="inp" style="width:100%">
            </div>
            <div>
              <label style="font-size:10px;color:var(--c-fg-2);display:block;margin-bottom:4px">${t('settings.delay_max')}</label>
              <input type="number" id="set-delay-max" value="${c.delay_max ?? 120}" min="1" max="600" class="inp" style="width:100%">
            </div>
            <div>
              <label style="font-size:10px;color:var(--c-fg-2);display:block;margin-bottom:4px">${t('settings.distribution')}</label>
              <select id="set-distribution" style="width:100%">
                <option value="uniform" ${c.distribution !== 'gaussian' ? 'selected' : ''}>${t('settings.distribution_uniform')}</option>
                <option value="gaussian" ${c.distribution === 'gaussian' ? 'selected' : ''}>${t('settings.distribution_gaussian')}</option>
              </select>
            </div>
            <div>
              <label style="font-size:10px;color:var(--c-fg-2);display:block;margin-bottom:4px">${t('settings.max_uploads')}</label>
              <input type="number" id="set-max-uploads" value="${c.max_uploads_per_day ?? 30}" min="1" max="1000" class="inp" style="width:100%">
            </div>
          </div>
          <p style="font-size:9px;color:var(--c-fg-3);margin-top:8px">${t('settings.delay_hint')}</p>
        </div>
      </div>

      <!-- License -->
      <div>
        <p style="font-size:9px;font-weight:600;color:var(--c-fg-3);text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">${t('settings.license')}</p>
        <div class="card" style="padding:16px">
          <label style="font-size:10px;color:var(--c-fg-2);display:block;margin-bottom:4px">${t('settings.license_key')}</label>
          <div style="display:flex;gap:6px">
            <input type="text" id="set-license" value="${c.license_key || ''}" class="inp" style="flex:1;font-family:'IBM Plex Mono',monospace;font-size:10px" placeholder="XXXX-XXXX-XXXX-XXXX">
            <button class="btn" id="btn-validate-license">${t('settings.validate')}</button>
          </div>
          ${c.license_key ? `
            <div style="margin-top:10px;padding:10px 12px;background:var(--c-green-a06);border-radius:8px">
              <div style="display:flex;align-items:center;gap:6px">
                <svg width="12" height="12" fill="none" stroke="var(--c-green)" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <span style="font-size:10px;color:var(--c-green);font-weight:600">${t('settings.pro_active')}</span>
              </div>
              <p style="font-size:9px;color:var(--c-fg-3);margin-top:3px">${t('settings.pro_desc')}</p>
            </div>
          ` : `
            <div style="margin-top:10px;padding:10px 12px;background:var(--c-gray-a04);border-radius:8px">
              <span style="font-size:10px;color:var(--c-fg-2)">${t('settings.free_plan')}</span>
              <p style="font-size:9px;color:var(--c-fg-3);margin-top:2px">${t('settings.free_desc')}</p>
            </div>
          `}
        </div>
      </div>

      <!-- Application -->
      <div>
        <p style="font-size:9px;font-weight:600;color:var(--c-fg-3);text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">${t('settings.application')}</p>
        <div class="card" style="padding:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;color:var(--c-fg-2);display:block;margin-bottom:4px">${t('settings.language')}</label>
              <select id="set-lang" style="width:100%">
                <option value="en" ${lang !== 'id' ? 'selected' : ''}>English</option>
                <option value="id" ${lang === 'id' ? 'selected' : ''}>Bahasa Indonesia</option>
              </select>
            </div>
            <div>
              <label style="font-size:10px;color:var(--c-fg-2);display:block;margin-bottom:4px">${t('settings.theme')}</label>
              <select id="set-theme" style="width:100%">
                <option value="dark" ${getTheme() === 'dark' ? 'selected' : ''}>${t('settings.theme_dark')}</option>
                <option value="light" ${getTheme() === 'light' ? 'selected' : ''}>${t('settings.theme_light')}</option>
              </select>
            </div>
          </div>
          <div style="margin-top:10px">
            <button class="btn" id="btn-replay-wizard" style="width:100%">${t('settings.replay_wizard')}</button>
          </div>
        </div>
      </div>

      <!-- Data & Storage -->
      <div>
        <p style="font-size:9px;font-weight:600;color:var(--c-fg-3);text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">${t('settings.data_storage')}</p>
        <div class="card" style="padding:16px">
          <div style="display:flex;flex-direction:column;gap:0">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--c-border-30)">
              <span style="font-size:11px;color:var(--c-fg-1)">${t('settings.upload_history')}</span>
              <span style="font-size:11px;color:var(--c-fg-2);font-family:'IBM Plex Mono',monospace">${historyCount} ${t('settings.records')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--c-border-30)">
              <span style="font-size:11px;color:var(--c-fg-1)">${t('settings.connected_devices')}</span>
              <span style="font-size:11px;color:var(--c-fg-2);font-family:'IBM Plex Mono',monospace">${devCount} ${t('settings.phones')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0">
              <span style="font-size:11px;color:var(--c-fg-1)">${t('settings.queue_items')}</span>
              <span style="font-size:11px;color:var(--c-fg-2);font-family:'IBM Plex Mono',monospace">${state.queue.length} ${t('settings.videos')}</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;margin-top:12px">
            <button class="btn btn-danger" id="btn-clear-history">${t('settings.clear_history')}</button>
            <button class="btn btn-danger" id="btn-clear-queue">${t('settings.clear_queue')}</button>
          </div>
        </div>
      </div>

      <!-- About -->
      <div>
        <p style="font-size:9px;font-weight:600;color:var(--c-fg-3);text-transform:uppercase;letter-spacing:.5px;padding:0 4px;margin-bottom:6px">${t('settings.about')}</p>
        <div class="card" style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--c-border-30)">
            <span style="font-size:11px;color:var(--c-fg-1)">${t('settings.app_label')}</span>
            <span style="font-size:11px;color:var(--c-fg-2)">${t('settings.app_name')}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
            <span style="font-size:11px;color:var(--c-fg-1)">${t('settings.version')}</span>
            <span style="font-size:11px;color:var(--c-fg-2);font-family:'IBM Plex Mono',monospace">v1.0.0</span>
          </div>
          <p style="font-size:9px;color:var(--c-fg-3);margin-top:8px">${t('settings.built_by')}</p>
        </div>
      </div>

    </div>
  `;

  // Auto-save on any input/change
  panel.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', autoSave);
    el.addEventListener('change', autoSave);
  });

  panel.querySelector('#set-theme')?.addEventListener('change', (e) => {
    setTheme(e.target.value);
  });
  panel.querySelector('#set-lang')?.addEventListener('change', (e) => {
    setLanguage(e.target.value);
    // Re-render everything in new language
    render();
    renderSidebar();
    renderHeader();
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
    if (!confirm(t('settings.confirm_clear_history', { count: state.history.length }))) return;
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
    if (!confirm(t('settings.confirm_clear_queue', { count: state.queue.length }))) return;
    state.queue = [];
    appendLog('[SYSTEM] Queue cleared');
    render();
  });
}
