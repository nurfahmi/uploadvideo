// ── Header Bar (Start/Stop + Device Status) ──────────

import { $ } from '../utils/helpers.js';
import state, { on, emit } from '../state.js';

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  queue: 'Upload Queue',
  devices: 'Devices',
  editor: 'Flow Editor',
  history: 'History',
  settings: 'Settings',
  monitor: 'Live Monitor',
};

export function renderHeader() {
  const title = $('#header-page-title');
  const deviceStatus = $('#header-device-status');
  const actionBtn = $('#header-action-btn');
  if (!title || !deviceStatus || !actionBtn) return;

  title.textContent = PAGE_TITLES[state.activeRoute] || '';

  const devCount = state.devices.length;
  deviceStatus.innerHTML = `
    <span class="${devCount > 0 ? 'pulse' : ''}" style="width:6px;height:6px;border-radius:50%;background:${devCount > 0 ? '#3fb950' : '#484f58'}"></span>
    <span style="font-size:10px;color:#484f58;font-weight:500">${devCount > 0 ? devCount + ' phone' + (devCount > 1 ? 's' : '') : 'No phones'}</span>
  `;

  if (state.isRunning) {
    actionBtn.innerHTML = `
      <button id="btn-stop-header" style="display:flex;align-items:center;gap:6px;background:#da3633;border:1px solid #f85149;color:#fff;padding:5px 14px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .1s" onmouseover="this.style.background='#f85149'" onmouseout="this.style.background='#da3633'">
        <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
        <span>Stop all</span>
      </button>
    `;
  } else {
    actionBtn.innerHTML = `
      <button id="btn-start-header" style="display:flex;align-items:center;gap:6px;background:#238636;border:1px solid #2ea043;color:#fff;padding:5px 14px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .1s" onmouseover="this.style.background='#2ea043'" onmouseout="this.style.background='#238636'">
        <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        <span>Start all</span>
      </button>
    `;
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
  });

  on('activeRoute', renderHeader);
  on('isRunning', renderHeader);
  on('devices', renderHeader);

  renderHeader();
}
