// ── Sidebar (mockup v4.3 style) ───────────────────────

import { $, $$ } from '../utils/helpers.js';
import state, { set, on, emit } from '../state.js';
import { navigate } from '../router.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '<path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/>' },
  { id: 'devices', label: 'Devices', icon: '<rect x="7" y="2" width="10" height="20" rx="2" /><path d="M12 18h.01"/>' },
  { id: 'queue', label: 'Upload Queue', icon: '<path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>' },
  { id: 'editor', label: 'Flow Editor', icon: '<path d="M9 3h6l2 2v4l-2 2H9L7 9V5l2-2zM7 13h4l2 2v4l-2 2H7l-2-2v-4l2-2zm6 0h4l2 2v4l-2 2h-4l-2-2v-4l2-2z"/><path d="M12 7v6m-2 4h-1m7-4h-1" stroke-dasharray="2 2"/>' },
  { id: 'history', label: 'History', icon: '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/><path d="M3 12h1m16 0h1M12 3v1m0 16v1"/>' },
  { id: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>' },
];

export function renderSidebar() {
  const sb = $('#sidebar-content') || $('#sidebar');
  if (!sb) return;
  const c = state.sidebarCollapsed;
  const devCount = state.devices.length;

  sb.innerHTML = `
    <div style="display:flex;${c ? 'flex-direction:column;align-items:center;gap:4px' : 'align-items:center;gap:7px'};padding:10px;border-bottom:1px solid #21262d">
      <div style="width:${c ? '30' : '26'}px;height:${c ? '30' : '26'}px;border-radius:5px;background:linear-gradient(135deg,#58a6ff,#bc8cff);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="${c ? '15' : '13'}" height="${c ? '15' : '13'}" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
      </div>
      ${c ? '' : '<span style="font-size:13px;font-weight:700;color:#f0f6fc">AUV</span>'}
      <button id="btn-collapse" title="${c ? 'Expand sidebar' : 'Collapse sidebar'}" style="${c ? '' : 'margin-left:auto;'}background:none;border:none;cursor:pointer;color:#8b949e;padding:4px;line-height:0;border-radius:4px;transition:all .15s" onmouseover="this.style.color='#f0f6fc';this.style.background='#21262d'" onmouseout="this.style.color='#8b949e';this.style.background='none'">
        <svg width="${c ? '20' : '16'}" height="${c ? '20' : '16'}" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          ${c
            ? '<path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7"/>'
            : '<path stroke-linecap="round" stroke-linejoin="round" d="M18 19l-7-7 7-7M11 19l-7-7 7-7"/>'
          }
        </svg>
      </button>
    </div>

    <nav style="flex:1;padding:8px 6px;display:flex;flex-direction:column;gap:1px">
      ${NAV.map(n => `
        <div class="nav-item ${state.activeRoute === n.id ? 'active' : ''}" data-nav="${n.id}" style="${c ? 'justify-content:center;padding:8px;position:relative' : ''}" ${c ? `title="${n.label}"` : ''}>
          <svg width="${c ? '26' : '20'}" height="${c ? '26' : '20'}" fill="none" stroke="currentColor" stroke-width="1.4" viewBox="0 0 24 24">${n.icon}</svg>
          ${c ? `<span class="nav-tooltip">${n.label}</span>` : `<span>${n.label}</span>`}
        </div>
      `).join('')}
    </nav>

    <div style="padding:${c ? '8px 6px' : '8px 14px'}">
      <div class="nav-item" id="btn-toggle-console-sidebar" style="${c ? 'justify-content:center;padding:8px;position:relative' : ''}">
        <svg width="${c ? '26' : '20'}" height="${c ? '26' : '20'}" fill="none" stroke="currentColor" stroke-width="1.4" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"/></svg>
        ${c ? '<span class="nav-tooltip">Console</span>' : '<span style="font-size:11px">Console</span>'}
      </div>
    </div>
  `;
}

export function initSidebar() {
  const sb = $('#sidebar');
  const sbContent = $('#sidebar-content') || sb;
  const dragHandle = $('#sidebar-drag');

  // Drag to resize
  if (dragHandle) {
    let startX, startW;
    dragHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = sb.offsetWidth;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      sb.style.transition = 'none';

      const onMove = (ev) => {
        const newW = Math.max(55, Math.min(350, startW + (ev.clientX - startX)));
        sb.style.width = newW + 'px';
        // Auto-collapse labels if too narrow
        const wasCollapsed = state.sidebarCollapsed;
        state.sidebarCollapsed = newW < 130;
        if (wasCollapsed !== state.sidebarCollapsed) renderSidebar();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        sb.style.transition = 'width .15s';
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  sbContent.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { navigate(nav.dataset.nav); return; }

    if (e.target.closest('#btn-collapse')) {
      set('sidebarCollapsed', !state.sidebarCollapsed);
      return;
    }
    if (e.target.closest('#btn-toggle-console-sidebar')) {
      import('../components/console-panel.js').then(m => m.toggleConsole());
      return;
    }
  });

  on('sidebarCollapsed', () => {
    sb.style.width = state.sidebarCollapsed ? '55px' : '200px';
    renderSidebar();
  });
  on('platform', renderSidebar);
  on('activeRoute', renderSidebar);
  on('devices', renderSidebar);

  sb.style.width = state.sidebarCollapsed ? '55px' : '200px';
  renderSidebar();
}
