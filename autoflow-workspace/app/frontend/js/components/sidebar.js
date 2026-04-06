// ── Collapsible Sidebar ───────────────────────────────

import { $, $$ } from '../utils/helpers.js';
import state, { set, on } from '../state.js';
import { navigate } from '../router.js';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />' },
  { id: 'queue', label: 'Upload Queue', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />' },
  { id: 'devices', label: 'Devices', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />' },
  { id: 'editor', label: 'Flow Editor', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />' },
  { id: 'history', label: 'History', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />' },
  { id: 'settings', label: 'Settings', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />' },
];

export function renderSidebar() {
  const sidebar = $('#sidebar');
  if (!sidebar) return;

  const collapsed = state.sidebarCollapsed;

  sidebar.innerHTML = `
    <!-- Logo + Collapse -->
    <div class="px-3 py-3 flex items-center ${collapsed ? 'justify-center' : 'justify-between'} border-b border-slate-800">
      <div class="flex items-center gap-2 ${collapsed ? '' : ''}">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shrink-0">
          <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        ${collapsed ? '' : '<span class="text-sm font-bold tracking-tight text-white">AutoFlow</span>'}
      </div>
      <button id="btn-collapse-sidebar" class="p-1 text-slate-500 hover:text-slate-300 rounded hover:bg-slate-800 transition-colors cursor-pointer ${collapsed ? 'hidden' : ''}">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>
      </button>
      ${collapsed ? `<button id="btn-expand-sidebar" class="hidden"></button>` : ''}
    </div>

    <!-- Platform Switcher -->
    <div class="px-3 py-2 border-b border-slate-800">
      ${collapsed ? `
        <div class="flex flex-col gap-1">
          <button data-platform="tiktok_upload" class="platform-btn w-full p-1.5 rounded-lg text-center text-xs cursor-pointer transition-all ${state.platform === 'tiktok_upload' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-800'}">TT</button>
          <button data-platform="shopee_upload" class="platform-btn w-full p-1.5 rounded-lg text-center text-xs cursor-pointer transition-all ${state.platform === 'shopee_upload' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-800'}">SP</button>
        </div>
      ` : `
        <div class="flex bg-slate-800 rounded-lg p-0.5 gap-0.5">
          <button data-platform="tiktok_upload" class="platform-btn flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer ${state.platform === 'tiktok_upload' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}">TikTok</button>
          <button data-platform="shopee_upload" class="platform-btn flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer ${state.platform === 'shopee_upload' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}">Shopee</button>
        </div>
      `}
    </div>

    <!-- Navigation -->
    <nav class="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
      ${NAV_ITEMS.map(item => {
        const active = state.activeRoute === item.id;
        return `
          <button data-nav="${item.id}" class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer border-l-2
            ${active ? 'bg-slate-800/60 text-indigo-400 border-l-indigo-500' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border-l-transparent'}
            ${collapsed ? 'justify-center' : ''}">
            <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">${item.icon}</svg>
            ${collapsed ? '' : `<span>${item.label}</span>`}
          </button>
        `;
      }).join('')}
    </nav>

    <!-- Bottom: Status + Start -->
    <div class="px-3 py-3 border-t border-slate-800 space-y-2">
      <div class="flex items-center ${collapsed ? 'justify-center' : 'gap-2'}">
        <span id="status-dot" class="w-2 h-2 rounded-full ${state.isRunning ? 'bg-amber-500 animate-pulse' : 'bg-slate-600'} shrink-0"></span>
        ${collapsed ? '' : `<span id="status-label" class="text-[10px] text-slate-500 font-medium">${state.isRunning ? 'Running' : 'Idle'}</span>`}
      </div>
      <button id="btn-start" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold ${collapsed ? 'p-2' : 'px-3 py-2'} rounded-lg transition-all hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        ${state.isRunning ? 'disabled' : ''}>
        ${collapsed ? '<svg class="w-4 h-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>' : `▶ Start`}
      </button>
    </div>
  `;
}

export function initSidebar() {
  const sidebar = $('#sidebar');

  // Delegated click handler
  sidebar.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { navigate(nav.dataset.nav); return; }

    const plat = e.target.closest('[data-platform]');
    if (plat) {
      set('platform', plat.dataset.platform);
      return;
    }

    if (e.target.closest('#btn-collapse-sidebar')) {
      set('sidebarCollapsed', true);
      return;
    }

    if (e.target.closest('#btn-start')) {
      // Emit start event — app.js handles the logic
      import('../state.js').then(m => m.emit('start-automation'));
      return;
    }
  });

  // Double-click collapsed sidebar to expand
  sidebar.addEventListener('dblclick', () => {
    if (state.sidebarCollapsed) set('sidebarCollapsed', false);
  });

  // Re-render on state changes
  on('sidebarCollapsed', () => {
    sidebar.style.width = state.sidebarCollapsed ? '56px' : '200px';
    renderSidebar();
  });
  on('platform', renderSidebar);
  on('activeRoute', renderSidebar);
  on('isRunning', renderSidebar);

  // Initial render
  sidebar.style.width = state.sidebarCollapsed ? '56px' : '200px';
  renderSidebar();
}
