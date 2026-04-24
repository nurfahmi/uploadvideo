// ── Settings Page ─────────────────────────────────────

import { $ } from '../utils/helpers.js';
import state, { on } from '../state.js';
import { appendLog } from '../components/console-panel.js';
import { setTheme, getTheme } from '../theme.js';
import { t, setLanguage, getLanguage } from '../i18n.js';
import { renderSidebar } from '../components/sidebar.js';
import { renderHeader } from '../components/header.js';
import { navigate } from '../router.js';

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
      hp_mode: $('#set-hp-mode')?.value || 'parallel',
      license_key: $('#set-license')?.value || '',
      language: getLanguage(),
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
    <div style="margin-bottom:var(--sp-4)">
      <h2 class="t-lg t-strong" style="margin:0">${t('settings.title')}</h2>
      <p class="t-sm t-muted" style="margin-top:2px">${t('settings.subtitle')}</p>
    </div>

    <div style="display:flex;flex-direction:column;gap:var(--sp-4)">

      <!-- Mode HP (Parallel vs Serial) -->
      <div>
        <p class="t-xs t-muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:0 var(--sp-1);margin-bottom:var(--sp-2)">${t('settings.hp_mode')}</p>
        <div class="card" style="padding:var(--sp-4)">
          <label class="t-xs t-muted" style="display:block;margin-bottom:var(--sp-2);font-weight:600">${t('settings.hp_mode_label')}</label>
          <select id="set-hp-mode" class="inp" style="width:100%">
            <option value="parallel" ${(c.hp_mode || 'parallel') === 'parallel' ? 'selected' : ''}>${t('settings.hp_mode_parallel')}</option>
            <option value="serial" ${c.hp_mode === 'serial' ? 'selected' : ''}>${t('settings.hp_mode_serial')}</option>
          </select>
          <p class="t-xs t-muted" style="margin-top:var(--sp-2);line-height:1.5">${t('settings.hp_mode_hint')}</p>
        </div>
      </div>

      <!-- Delay & Safety -->
      <div>
        <p class="t-xs t-muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:0 var(--sp-1);margin-bottom:var(--sp-2)">${t('settings.delay_safety')}</p>
        <div class="card" style="padding:var(--sp-4)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)">
            <div>
              <label class="t-xs t-muted" style="display:block;margin-bottom:var(--sp-2);font-weight:600">${t('settings.delay_min')}</label>
              <input type="number" id="set-delay-min" value="${c.delay_min ?? 30}" min="1" max="600" class="inp" style="width:100%">
            </div>
            <div>
              <label class="t-xs t-muted" style="display:block;margin-bottom:var(--sp-2);font-weight:600">${t('settings.delay_max')}</label>
              <input type="number" id="set-delay-max" value="${c.delay_max ?? 120}" min="1" max="600" class="inp" style="width:100%">
            </div>
            <div style="grid-column:1/-1">
              <label class="t-xs t-muted" style="display:block;margin-bottom:var(--sp-2);font-weight:600">${t('settings.dist_label')}</label>
              <select id="set-distribution" class="inp" style="width:100%">
                <option value="uniform" ${c.distribution !== 'gaussian' ? 'selected' : ''}>${t('settings.dist_uniform')}</option>
                <option value="gaussian" ${c.distribution === 'gaussian' ? 'selected' : ''}>${t('settings.dist_gaussian')}</option>
              </select>
              <p class="t-xs t-muted" style="margin-top:var(--sp-1);line-height:1.5">${t('settings.dist_hint')}</p>
            </div>
            <div style="grid-column:1/-1">
              <label class="t-xs t-muted" style="display:block;margin-bottom:var(--sp-2);font-weight:600">${t('settings.max_uploads')}</label>
              <input type="number" id="set-max-uploads" value="${c.max_uploads_per_day ?? 30}" min="1" max="1000" class="inp" style="width:100%">
            </div>
          </div>
          <p class="t-xs t-muted" style="margin-top:var(--sp-3);line-height:1.5">${t('settings.delay_hint')}</p>
        </div>
      </div>

      <!-- License -->
      <div>
        <p class="t-xs t-muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:0 var(--sp-1);margin-bottom:var(--sp-2)">${t('settings.license')}</p>
        <div class="card" style="padding:var(--sp-4)">
          <label class="t-xs t-muted" style="display:block;margin-bottom:var(--sp-2);font-weight:600">${t('settings.license_key')}</label>
          <div style="display:flex;gap:var(--sp-2)">
            <input type="text" id="set-license" value="${c.license_key || ''}" class="inp" style="flex:1;font-family:'IBM Plex Mono',monospace" placeholder="XXXX-XXXX-XXXX-XXXX">
            <button class="btn btn-secondary btn-sm" id="btn-validate-license">${t('settings.validate')}</button>
          </div>
          ${c.license_key ? `
            <div style="margin-top:var(--sp-3);padding:var(--sp-3);background:var(--c-green-a08);border:1px solid var(--c-green-a15);border-radius:var(--r-md)">
              <div style="display:flex;align-items:center;gap:var(--sp-2)">
                <svg width="14" height="14" fill="none" stroke="var(--c-green)" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <span class="t-sm t-strong" style="color:var(--c-green)">${t('settings.pro_active')}</span>
              </div>
              <p class="t-xs t-muted" style="margin-top:var(--sp-1)">${t('settings.pro_desc')}</p>
            </div>
          ` : `
            <div style="margin-top:var(--sp-3);padding:var(--sp-3);background:var(--c-bg-1);border-radius:var(--r-md)">
              <span class="t-sm">${t('settings.free_plan')}</span>
              <p class="t-xs t-muted" style="margin-top:2px">${t('settings.free_desc')}</p>
            </div>
          `}
        </div>
      </div>

      <!-- Application -->
      <div>
        <p class="t-xs t-muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:0 var(--sp-1);margin-bottom:var(--sp-2)">${t('settings.application')}</p>
        <div class="card" style="padding:var(--sp-4)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)">
            <div>
              <label class="t-xs t-muted" style="display:block;margin-bottom:var(--sp-2);font-weight:600">${t('settings.language')}</label>
              <select id="set-lang" class="inp" style="width:100%">
                <option value="id" ${lang === 'id' ? 'selected' : ''}>Bahasa Indonesia</option>
                <option value="en" ${lang !== 'id' ? 'selected' : ''}>English</option>
              </select>
            </div>
            <div>
              <label class="t-xs t-muted" style="display:block;margin-bottom:var(--sp-2);font-weight:600">${t('settings.theme')}</label>
              <select id="set-theme" class="inp" style="width:100%">
                <option value="dark" ${getTheme() === 'dark' ? 'selected' : ''}>${t('settings.theme_dark')}</option>
                <option value="light" ${getTheme() === 'light' ? 'selected' : ''}>${t('settings.theme_light')}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Data & Storage -->
      <div>
        <p class="t-xs t-muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:0 var(--sp-1);margin-bottom:var(--sp-2)">${t('settings.data_storage')}</p>
        <div class="card" style="padding:var(--sp-4)">
          <div style="display:flex;flex-direction:column">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-2) 0;border-bottom:1px solid var(--c-border-30)">
              <span class="t-sm">${t('settings.upload_history')}</span>
              <span class="t-sm t-muted" style="font-family:'IBM Plex Mono',monospace">${historyCount} ${t('settings.records')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-2) 0;border-bottom:1px solid var(--c-border-30)">
              <span class="t-sm">${t('settings.connected_devices')}</span>
              <span class="t-sm t-muted" style="font-family:'IBM Plex Mono',monospace">${devCount} ${t('settings.phones')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-2) 0">
              <span class="t-sm">${t('settings.queue_items')}</span>
              <span class="t-sm t-muted" style="font-family:'IBM Plex Mono',monospace">${state.queue.length} ${t('settings.videos')}</span>
            </div>
          </div>
          <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-3);justify-content:flex-end">
            <button class="btn btn-ghost btn-sm" id="btn-clear-history" style="color:var(--c-red)" ${historyCount === 0 ? 'disabled' : ''}>
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              ${t('settings.clear_history')}
            </button>
            <button class="btn btn-ghost btn-sm" id="btn-clear-queue" style="color:var(--c-red)" ${state.queue.length === 0 ? 'disabled' : ''}>
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              ${t('settings.clear_queue')}
            </button>
          </div>
        </div>
      </div>

      <!-- Lanjutan -->
      <div>
        <p class="t-xs t-muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:0 var(--sp-1);margin-bottom:var(--sp-2)">${t('settings.advanced')}</p>
        <div class="card" style="padding:0;overflow:hidden">
          <button class="set-advanced-row" data-nav-route="recorder" style="width:100%;display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);background:none;border:none;cursor:pointer;text-align:left;font-family:inherit" onmouseover="this.style.background='var(--c-hover-15)'" onmouseout="this.style.background='none'">
            <div style="width:32px;height:32px;border-radius:var(--r-sm);background:var(--c-red-a12);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg width="16" height="16" fill="none" stroke="var(--c-red)" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
            </div>
            <div style="flex:1;min-width:0">
              <div class="t-sm t-strong">${t('settings.adv_recorder_title')}</div>
              <div class="t-xs t-muted" style="margin-top:2px">${t('settings.adv_recorder_hint')}</div>
            </div>
            <svg width="14" height="14" fill="none" stroke="var(--c-fg-3)" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>

      <!-- About -->
      <div>
        <p class="t-xs t-muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:0 var(--sp-1);margin-bottom:var(--sp-2)">${t('settings.about')}</p>
        <div class="card" style="padding:var(--sp-4)">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-2) 0;border-bottom:1px solid var(--c-border-30)">
            <span class="t-sm">${t('settings.app_label')}</span>
            <span class="t-sm t-muted">${t('settings.app_name')}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-2) 0">
            <span class="t-sm">${t('settings.version')}</span>
            <span class="t-sm t-muted" style="font-family:'IBM Plex Mono',monospace">v1.0.0</span>
          </div>
          <p class="t-xs t-muted" style="margin-top:var(--sp-2)">${t('settings.built_by')}</p>
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
    // Re-render everything in the chosen language
    render();
    renderSidebar();
    renderHeader();
    // Emit so other pages can re-render if currently mounted
    import('../state.js').then(m => m.emit('lang', e.target.value));
  });
  panel.querySelectorAll('.set-advanced-row').forEach(row => {
    row.addEventListener('click', () => {
      const route = row.dataset.navRoute;
      if (route) navigate(route);
    });
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
