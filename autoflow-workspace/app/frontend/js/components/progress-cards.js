// ── Upload Progress Cards ─────────────────────────────
// Shows per-device progress during automation

import { $, esc } from '../utils/helpers.js';
import state, { on } from '../state.js';

let container = null;

export function initProgressCards() {
  on('isRunning', (running) => {
    if (running) show();
    else hide();
  });
}

function show() {
  if (container) return;
  const main = $('#page-content');
  if (!main) return;

  container = document.createElement('div');
  container.id = 'progress-cards';
  container.className = 'shrink-0 border-t border-slate-800 bg-slate-900/70 px-5 py-3';
  main.appendChild(container);

  render();

  // Poll render while running
  container._interval = setInterval(() => {
    if (state.isRunning) render();
    else hide();
  }, 1000);
}

function hide() {
  if (!container) return;
  if (container._interval) clearInterval(container._interval);
  container.remove();
  container = null;
}

function render() {
  if (!container) return;

  const devices = [...state.selectedDevices];
  const progress = state.deviceProgress;
  const total = state.totalEngines;
  const finished = state.finishedCount;

  container.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <span class="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Upload Progress</span>
      <span class="text-[10px] text-slate-600">${finished}/${total} devices complete</span>
    </div>
    <div class="grid grid-cols-${Math.min(devices.length, 3)} gap-2">
      ${devices.map(devId => {
        const short = devId.length > 8 ? devId.slice(-6) : devId;
        const model = state.devices.find(d => d[0] === devId)?.[1] || short;
        const p = progress[short] || { step: 'Starting...', percent: 0, status: 'running' };
        const isDone = p.status === 'done' || p.status === 'error';
        const barColor = p.status === 'error' ? 'bg-red-500' : isDone ? 'bg-emerald-500' : 'bg-indigo-500';

        return `
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-lg p-2.5">
            <div class="flex items-center gap-2 mb-1.5">
              <span class="w-1.5 h-1.5 rounded-full ${isDone ? (p.status === 'error' ? 'bg-red-400' : 'bg-emerald-400') : 'bg-amber-400 animate-pulse'} shrink-0"></span>
              <span class="text-[11px] font-medium text-slate-300 truncate">${esc(model)}</span>
            </div>
            <div class="w-full bg-slate-700/50 rounded-full h-1 mb-1">
              <div class="${barColor} h-1 rounded-full transition-all duration-500" style="width:${p.percent}%"></div>
            </div>
            <span class="text-[9px] text-slate-500">${esc(p.step)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export default { initProgressCards };
