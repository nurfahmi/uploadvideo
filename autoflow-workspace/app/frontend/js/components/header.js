// ── Header Bar (Start/Stop + Device Status) ──────────

import { $ } from '../utils/helpers.js';
import state, { on, emit } from '../state.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';

const PAGE_TITLE_KEYS = {
  dashboard: 'header.dashboard',
  queue: 'header.queue',
  devices: 'header.devices',
  editor: 'header.editor',
  history: 'header.history',
  settings: 'header.settings',
  monitor: 'header.monitor',
};

export function renderHeader() {
  const title = $('#header-page-title');
  const deviceStatus = $('#header-device-status');
  const actionBtn = $('#header-action-btn');
  if (!title || !deviceStatus || !actionBtn) return;

  title.textContent = t(PAGE_TITLE_KEYS[state.activeRoute]) || '';

  const isEditor = state.activeRoute === 'editor';
  const isQueue = state.activeRoute === 'queue';
  const isMonitor = state.activeRoute === 'monitor';

  // Device status — only on editor
  if (isEditor) {
    const devCount = state.devices.length;
    deviceStatus.innerHTML = `
      <span class="${devCount > 0 ? 'pulse' : ''}" style="width:6px;height:6px;border-radius:50%;background:${devCount > 0 ? 'var(--c-green)' : 'var(--c-fg-3)'}"></span>
      <span style="font-size:10px;color:var(--c-fg-3);font-weight:500">${devCount > 0 ? devCount + ' ' + t(devCount > 1 ? 'header.phones' : 'header.phone') : t('header.no_phones')}</span>
    `;
  } else {
    deviceStatus.innerHTML = '';
  }

  // Stop button only on Monitor page while running (Queue has its own in toolbar)
  if (state.isRunning && isMonitor) {
    actionBtn.innerHTML = `
      <button id="btn-stop-header" class="btn btn-danger" style="display:flex;align-items:center;gap:6px">
        <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
        <span>${t('header.stop_all')}</span>
      </button>
    `;
  } else if (state.isRunning && !isMonitor) {
    // Running elsewhere → persistent pill that navigates back to Monitor
    const done = state.finishedCount || 0;
    const total = state.totalEngines || 0;
    actionBtn.innerHTML = `
      <button id="btn-to-monitor" class="btn btn-sm" style="display:flex;align-items:center;gap:6px;background:var(--c-amber-a12);color:var(--c-amber);border:1px solid var(--c-amber-a20)">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--c-amber);animation:pulse 1s infinite"></span>
        <span>Monitor · ${done}/${total}</span>
        <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    `;
  } else if (isEditor && !state.isRunning) {
    // Editor page still has a Run Flow button (legacy pre-template flow)
    actionBtn.innerHTML = `
      <button id="btn-start-header" class="btn" style="display:flex;align-items:center;gap:6px;background:#238636;color:#fff">
        <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        <span>${t('header.run_flow')}</span>
      </button>
    `;
  } else {
    actionBtn.innerHTML = '';
  }
}

export function initHeader() {
  const header = $('#app-header');
  if (!header) return;

  header.addEventListener('click', (e) => {
    if (e.target.closest('#btn-start-header')) {
      emit('start-automation');
    }
    if (e.target.closest('#btn-stop-header')) {
      emit('stop-automation');
    }
    if (e.target.closest('#btn-to-monitor')) {
      navigate('monitor');
    }
  });

  on('activeRoute', renderHeader);
  on('isRunning', renderHeader);
  on('devices', renderHeader);
  on('progress', renderHeader);

  renderHeader();
}
