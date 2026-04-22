// ── Sidebar (macOS Settings style) ────────────────────

import { $, $$ } from '../utils/helpers.js';
import state, { set, on, emit } from '../state.js';
import { navigate } from '../router.js';
import { t } from '../i18n.js';

// IA v2: simplified to 3 top-level items — Perangkat (merges Device+Template)
// Job (queue+run+monitor), Pengaturan (includes Editor under Lanjutan).
// Console remains toggleable via bottom button, not a top-level nav item.
const NAV_GROUPS = [
  {
    labelKey: 'nav.workspace',
    items: [
      { id: 'devices', labelKey: 'nav.devices', color: 'var(--c-cyan)', icon: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/>' },
      { id: 'queue', labelKey: 'nav.jobs', color: 'var(--c-amber)', icon: '<path d="M8 3v2M16 3v2M4 7h16M4 7v12a2 2 0 002 2h12a2 2 0 002-2V7M9 12h6M9 16h6"/>' },
      { id: 'settings', labelKey: 'nav.settings', color: 'var(--c-fg-2)', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>' },
    ],
  },
];

function iconBox(icon, color, size = 22, iconSize = 13) {
  return `<div style="width:${size}px;height:${size}px;border-radius:5px;background:${color};display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <svg width="${iconSize}" height="${iconSize}" fill="none" stroke="#fff" stroke-width="1.6" viewBox="0 0 24 24">${icon}</svg>
  </div>`;
}

export function renderSidebar() {
  const sb = $('#sidebar-content') || $('#sidebar');
  if (!sb) return;
  const c = state.sidebarCollapsed;

  sb.innerHTML = `
    <!-- Brand -->
    <div style="display:flex;${c ? 'flex-direction:column;align-items:center;gap:4px' : 'align-items:center;gap:7px'};padding:10px 10px 6px">
      <div style="width:${c ? '30' : '26'}px;height:${c ? '30' : '26'}px;border-radius:6px;background:linear-gradient(135deg,var(--c-accent),var(--c-purple));display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="${c ? '15' : '13'}" height="${c ? '15' : '13'}" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
      </div>
      ${c ? '' : '<span style="font-size:13px;font-weight:700;color:var(--c-fg-0)">AUV</span>'}
      <button id="btn-collapse" title="${c ? t('nav.expand') : t('nav.collapse')}" style="${c ? '' : 'margin-left:auto;'}background:none;border:none;cursor:pointer;color:var(--c-fg-2);padding:4px;line-height:0;border-radius:4px;transition:all .15s" onmouseover="this.style.color='var(--c-fg-0)';this.style.background='var(--c-bg-2)'" onmouseout="this.style.color='var(--c-fg-2)';this.style.background='none'">
        <svg width="${c ? '20' : '16'}" height="${c ? '20' : '16'}" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          ${c
            ? '<path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7"/>'
            : '<path stroke-linecap="round" stroke-linejoin="round" d="M18 19l-7-7 7-7M11 19l-7-7 7-7"/>'
          }
        </svg>
      </button>
    </div>

    <!-- Nav groups -->
    <nav style="flex:1;padding:8px 6px;display:flex;flex-direction:column;gap:12px;overflow-y:auto">
      ${NAV_GROUPS.map(group => {
        if (c) {
          return `
            <div style="display:flex;flex-direction:column;gap:2px">
              ${group.items.map(n => {
                const isActive = state.activeRoute === n.id;
                return `
                  <div class="sb-item ${isActive ? 'sb-active' : ''}" data-nav="${n.id}" style="display:flex;align-items:center;justify-content:center;padding:7px;border-radius:6px;cursor:pointer;position:relative;transition:background .1s">
                    ${iconBox(n.icon, n.color, 24, 13)}
                    <span class="nav-tooltip">${t(n.labelKey)}</span>
                  </div>`;
              }).join('')}
            </div>`;
        }

        return `
          <div>
            <p style="font-size:9px;font-weight:600;color:var(--c-fg-3);text-transform:uppercase;letter-spacing:.5px;padding:0 8px;margin-bottom:4px">${t(group.labelKey)}</p>
            <div style="display:flex;flex-direction:column;gap:1px">
              ${group.items.map(n => {
                const isActive = state.activeRoute === n.id;
                return `
                  <div class="sb-item ${isActive ? 'sb-active' : ''}" data-nav="${n.id}" style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:6px;cursor:pointer;transition:background .1s">
                    ${iconBox(n.icon, n.color, 22, 13)}
                    <span style="font-size:12px;font-weight:${isActive ? '600' : '500'};color:${isActive ? 'var(--c-fg-0)' : 'var(--c-fg-2)'};transition:color .1s">${t(n.labelKey)}</span>
                  </div>`;
              }).join('')}
            </div>
          </div>`;
      }).join('')}
    </nav>

    <!-- Bottom: console toggle -->
    <div style="border-top:1px solid var(--c-bg-2);padding:6px">
      <div class="sb-item" data-nav="console" title="${t('nav.console')}" style="display:flex;align-items:center;${c ? 'justify-content:center;padding:7px' : 'gap:10px;padding:7px 10px'};border-radius:6px;cursor:pointer;transition:background .1s">
        ${iconBox('<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"/>', 'var(--c-bg-3)', c ? 24 : 22, 13)}
        ${c ? `<span class="nav-tooltip">${t('nav.console')}</span>` : `<span style="font-size:12px;font-weight:500;color:var(--c-fg-2)">${t('nav.console')}</span>`}
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
    if (nav) {
      if (nav.dataset.nav === 'console') {
        import('../components/console-panel.js').then(m => m.toggleConsole());
      } else {
        navigate(nav.dataset.nav);
      }
      return;
    }

    if (e.target.closest('#btn-collapse')) {
      set('sidebarCollapsed', !state.sidebarCollapsed);
      return;
    }
  });

  on('sidebarCollapsed', () => {
    sb.style.width = state.sidebarCollapsed ? '55px' : '250px';
    renderSidebar();
  });
  on('platform', renderSidebar);
  on('activeRoute', renderSidebar);
  on('devices', renderSidebar);

  sb.style.width = state.sidebarCollapsed ? '55px' : '250px';
  renderSidebar();
}
