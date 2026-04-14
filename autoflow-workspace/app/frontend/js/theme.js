// ── Theme Manager (Dark/Light mode) ──────────────────

import state, { set, on } from './state.js';

const STORAGE_KEY = 'auv-theme';

export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || 'dark';
}

export function setTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
  set('theme', theme);
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  const saved = getTheme();
  document.documentElement.setAttribute('data-theme', saved);
  state.theme = saved;
}
