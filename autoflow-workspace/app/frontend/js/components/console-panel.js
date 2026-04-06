// ── Console Panel (toggle-able) ───────────────────────

import { $, esc } from '../utils/helpers.js';
import state, { set, on } from '../state.js';

export function renderConsole() {
  const el = $('#console-output');
  if (!el) return;

  const logs = state.logs;
  if (!logs.length) {
    el.innerHTML = '<p class="text-slate-600 italic">Waiting for engine output...</p>';
    return;
  }

  el.innerHTML = logs.map((line, i) => {
    let c = 'text-emerald-400';
    if (line.includes('[ERROR]')) c = 'text-red-400';
    else if (line.includes('[SYSTEM]')) c = 'text-indigo-400';
    else if (line.includes('[MOCK]')) c = 'text-amber-400';
    else if (line.includes('ADB:')) c = 'text-slate-500';
    return `<div class="py-px ${c}"><span class="text-slate-700 select-none mr-2">${String(i+1).padStart(3,' ')}</span>${esc(line)}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

export function appendLog(line) {
  state.logs.push(line);
  renderConsole();
}

export function clearLogs() {
  state.logs = [];
  renderConsole();
}

export function initConsole() {
  const panel = $('#console-panel');
  if (!panel) return;

  // Toggle button
  $('#btn-toggle-console')?.addEventListener('click', () => {
    set('consoleVisible', !state.consoleVisible);
  });

  // Clear button
  $('#btn-clear-logs')?.addEventListener('click', clearLogs);

  // React to visibility toggle
  on('consoleVisible', () => {
    panel.style.height = state.consoleVisible ? '200px' : '32px';
    const output = $('#console-output');
    if (output) output.classList.toggle('hidden', !state.consoleVisible);
    const chevron = $('#console-chevron');
    if (chevron) chevron.style.transform = state.consoleVisible ? '' : 'rotate(180deg)';
  });

  // Initial state
  panel.style.height = state.consoleVisible ? '200px' : '32px';
}
