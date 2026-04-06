// ── Page Router ───────────────────────────────────────

import { $, $$ } from './utils/helpers.js';
import state, { set, on } from './state.js';

const pages = {};

export function registerPage(name, module) {
  pages[name] = module;
}

export function navigate(route) {
  set('activeRoute', route);

  // Hide all page panels
  $$('.page-panel').forEach(el => el.classList.add('hidden'));

  // Show target
  const panel = $(`#page-${route}`);
  if (panel) panel.classList.remove('hidden');

  // Render page
  if (pages[route]?.render) pages[route].render();

  // Update sidebar active state
  $$('#sidebar [data-nav]').forEach(el => {
    const isActive = el.dataset.nav === route;
    el.classList.toggle('bg-slate-800/60', isActive);
    el.classList.toggle('text-indigo-400', isActive);
    el.classList.toggle('border-l-indigo-500', isActive);
    el.classList.toggle('text-slate-400', !isActive);
    el.classList.toggle('border-l-transparent', !isActive);
  });

  // Update page header
  const titles = {
    dashboard: 'Dashboard',
    queue: 'Upload Queue',
    devices: 'Devices',
    editor: 'Flow Editor',
    history: 'History',
    settings: 'Settings',
  };
  const header = $('#page-title');
  if (header) header.textContent = titles[route] || route;

  // Render page-specific header actions
  const actions = $('#page-actions');
  if (actions) {
    actions.innerHTML = '';
    if (pages[route]?.renderActions) pages[route].renderActions(actions);
  }
}

export function initRouter() {
  // Initialize all registered pages
  for (const [name, mod] of Object.entries(pages)) {
    if (mod.init) mod.init();
  }

  // Navigate to default route
  navigate(state.activeRoute);
}
