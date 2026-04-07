// ── Page Router ───────────────────────────────────────

import { $, $$ } from './utils/helpers.js';
import state, { set } from './state.js';

const pages = {};

export function registerPage(name, module) {
  pages[name] = module;
}

export function navigate(route) {
  set('activeRoute', route);

  // Hide all page panels
  $$('.page-panel').forEach(el => {
    el.style.display = 'none';
  });

  // Show target with correct display mode
  const panel = $(`#page-${route}`);
  if (panel) {
    // Queue needs flex column layout, others are block/auto
    if (route === 'queue') {
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.style.minHeight = '0';
    } else {
      panel.style.display = 'block';
    }
    panel.style.flex = '1';
  }

  // Render page
  if (pages[route]?.render) pages[route].render();
}

export function initRouter() {
  for (const [name, mod] of Object.entries(pages)) {
    if (mod.init) mod.init();
  }
  navigate(state.activeRoute);
}
