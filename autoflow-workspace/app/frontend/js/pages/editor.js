// ── Flow Editor Page ──────────────────────────────────

import { $, esc } from '../utils/helpers.js';
import state, { set, on } from '../state.js';
import { appendLog } from '../components/console-panel.js';

const { invoke } = window.__TAURI__.core;

const ACTIONS = [
  'click', 'wait', 'open_app', 'kill_app', 'push_file',
  'media_scan', 'type_text', 'swipe', 'back', 'key_event',
  'tap', 'find_and_tap', 'assert_exists', 'screenshot',
];

const ACTION_PROPS = {
  click: ['target', 'timeout', 'threshold', 'optional'],
  wait: ['duration'],
  open_app: ['package'],
  kill_app: ['package'],
  push_file: ['local_path', 'remote_path', 'stop_on_fail'],
  media_scan: ['path'],
  type_text: ['text', 'use_clipboard', 'optional'],
  swipe: ['direction', 'duration'],
  back: [],
  key_event: ['keycode'],
  tap: ['x', 'y'],
  find_and_tap: ['target', 'timeout', 'threshold'],
  assert_exists: ['target', 'timeout'],
  screenshot: ['output'],
};

const ACTION_COLORS = {
  click: 'bg-blue-500/15 text-blue-400',
  wait: 'bg-slate-500/15 text-slate-400',
  open_app: 'bg-emerald-500/15 text-emerald-400',
  kill_app: 'bg-red-500/15 text-red-400',
  push_file: 'bg-amber-500/15 text-amber-400',
  media_scan: 'bg-cyan-500/15 text-cyan-400',
  type_text: 'bg-violet-500/15 text-violet-400',
  swipe: 'bg-orange-500/15 text-orange-400',
  back: 'bg-slate-500/15 text-slate-400',
  key_event: 'bg-slate-500/15 text-slate-400',
};

let images = [];

export function init() {
  const panel = $('#page-editor');

  panel.addEventListener('click', (e) => {
    const card = e.target.closest('[data-si]');
    if (!card) return;
    const i = parseInt(card.dataset.si);
    const flow = state.flow;
    if (!flow) return;

    if (e.target.closest('[data-sa="toggle"]')) {
      state.expandedStep = state.expandedStep === i ? -1 : i;
      render();
    } else if (e.target.closest('[data-sa="delete"]')) {
      flow.steps.splice(i, 1);
      state.expandedStep = -1;
      state.flowDirty = true;
      render();
    } else if (e.target.closest('[data-sa="up"]') && i > 0) {
      [flow.steps[i-1], flow.steps[i]] = [flow.steps[i], flow.steps[i-1]];
      state.expandedStep = i-1;
      state.flowDirty = true;
      render();
    } else if (e.target.closest('[data-sa="down"]') && i < flow.steps.length-1) {
      [flow.steps[i], flow.steps[i+1]] = [flow.steps[i+1], flow.steps[i]];
      state.expandedStep = i+1;
      state.flowDirty = true;
      render();
    }
  });

  panel.addEventListener('input', (e) => {
    if (e.target.dataset.sp === undefined) return;
    const i = parseInt(e.target.dataset.si);
    const prop = e.target.dataset.sp;
    const flow = state.flow;
    if (!flow) return;

    if (['timeout','threshold','duration','x','y'].includes(prop)) {
      flow.steps[i][prop] = parseFloat(e.target.value) || 0;
    } else {
      flow.steps[i][prop] = e.target.value;
    }
    state.flowDirty = true;
  });

  panel.addEventListener('change', (e) => {
    if (!e.target.dataset.sp) return;
    const i = parseInt(e.target.dataset.si);
    const flow = state.flow;
    if (!flow) return;

    if (e.target.type === 'checkbox') {
      flow.steps[i][e.target.dataset.sp] = e.target.checked;
      state.flowDirty = true;
    }
    if (e.target.dataset.sp === 'action') {
      flow.steps[i].action = e.target.value;
      state.flowDirty = true;
      render();
    }
  });

  on('flow', render);
}

export function renderActions(container) {
  container.innerHTML = `
    <select id="device-select-editor" class="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-200 w-36 focus:outline-none focus:border-sky-500 transition-all">
      ${!state.devices.length ? '<option value="">No device</option>' : state.devices.map(([id, model]) => `<option value="${esc(id)}">${esc(model)} (${esc(id.slice(-6))})</option>`).join('')}
    </select>
    <button id="btn-capture-editor" class="text-xs bg-sky-600 hover:bg-sky-500 text-white px-3 py-1 rounded-md transition-colors font-medium cursor-pointer">Capture</button>
    <div class="w-px h-5 bg-slate-700"></div>
    <button id="btn-add-step-editor" class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 font-medium cursor-pointer">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
      Add Step
    </button>
    <button id="btn-save-flow-editor" class="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded-md transition-colors font-medium cursor-pointer">Save</button>
  `;

  container.querySelector('#btn-capture-editor')?.addEventListener('click', captureScreen);
  container.querySelector('#btn-add-step-editor')?.addEventListener('click', addStep);
  container.querySelector('#btn-save-flow-editor')?.addEventListener('click', saveFlow);
}

async function captureScreen() {
  const sel = document.getElementById('device-select-editor');
  const deviceId = sel?.value;
  if (!deviceId) { appendLog('[SYSTEM] Select a device first'); return; }
  appendLog('[SYSTEM] Capturing screen from ' + deviceId + '...');
  try {
    const filename = await invoke('capture_screen', { deviceId, flowName: state.platform });
    appendLog(`[SYSTEM] Screenshot saved: flows/${state.platform}/${filename}`);
    await loadImages();
  } catch (err) {
    appendLog('[ERROR] Capture failed: ' + err);
  }
}

async function loadImages() {
  try {
    images = await invoke('list_flow_images', { flowName: state.platform });
    render();
  } catch (err) {
    console.error('loadImages:', err);
  }
}

function addStep() {
  if (!state.flow) return;
  state.flow.steps.push({ action: 'click', description: 'New step', target: '', timeout: 10 });
  state.expandedStep = state.flow.steps.length - 1;
  state.flowDirty = true;
  render();
}

async function saveFlow() {
  if (!state.flow || !state.flowDirty) return;
  try {
    await invoke('save_flow', { flowName: state.platform, content: JSON.stringify(state.flow, null, 2) });
    state.flowDirty = false;
    render();
    appendLog('[SYSTEM] Flow saved');
  } catch (err) {
    appendLog('[ERROR] Save failed: ' + err);
  }
}

function stepFields(step, i) {
  const props = ACTION_PROPS[step.action] || [];
  const allProps = ['description', ...props];
  const extra = Object.keys(step).filter(k => !['action','description','delay_after'].includes(k) && !props.includes(k));
  const fields = [...allProps, ...extra];

  return `<div class="px-3 py-2 space-y-1.5 bg-slate-900/30 border-t border-slate-800">
    <div class="flex items-center gap-2">
      <label class="text-[10px] text-slate-500 w-24 shrink-0 font-medium">action</label>
      <select data-si="${i}" data-sp="action" class="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500">
        ${ACTIONS.map(a => `<option value="${a}" ${a===step.action?'selected':''}>${a}</option>`).join('')}
      </select>
    </div>
    ${fields.map(f => {
      const v = step[f];
      const isBool = typeof v === 'boolean' || ['optional','stop_on_fail','use_clipboard'].includes(f);
      if (isBool) return `<div class="flex items-center gap-2"><label class="text-[10px] text-slate-500 w-24 shrink-0 font-medium">${f}</label><input type="checkbox" data-si="${i}" data-sp="${f}" ${v?'checked':''} class="rounded border-slate-600 bg-slate-800 accent-indigo-500"/></div>`;
      return `<div class="flex items-center gap-2"><label class="text-[10px] text-slate-500 w-24 shrink-0 font-medium">${f}</label><input type="text" value="${esc(String(v??''))}" data-si="${i}" data-sp="${f}" class="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50"/></div>`;
    }).join('')}
  </div>`;
}

export function render() {
  const panel = $('#page-editor');
  const flow = state.flow;
  if (!flow) {
    panel.innerHTML = '<div class="p-5 text-sm text-slate-600 italic">No flow loaded</div>';
    return;
  }

  loadImages();

  panel.innerHTML = `
    <div class="p-5 space-y-3">
      <div class="flex items-center justify-between mb-2">
        <div>
          <h3 class="text-sm font-semibold text-slate-200">${esc(flow.name || state.platform)}</h3>
          <p class="text-[10px] text-slate-500 mt-0.5">${flow.steps.length} steps · ${state.flowDirty ? 'unsaved' : 'saved'}</p>
        </div>
      </div>

      <!-- Template Images -->
      <div class="bg-slate-900/50 border border-slate-800 rounded-lg p-3">
        <span class="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Template Images</span>
        <div class="flex flex-wrap gap-1.5 text-[10px] mt-2">
          ${images.length ? images.map(name => {
            const isScreenshot = name.startsWith('screenshot_');
            return `<span class="px-1.5 py-0.5 rounded ${isScreenshot ? 'bg-sky-500/10 text-sky-400' : 'bg-emerald-500/10 text-emerald-400'}">${name}</span>`;
          }).join('') : '<span class="text-slate-600 italic">No images yet</span>'}
        </div>
      </div>

      <!-- Steps -->
      <div class="space-y-2">
        ${flow.steps.map((step, i) => {
          const open = state.expandedStep === i;
          const col = ACTION_COLORS[step.action] || 'bg-slate-500/15 text-slate-400';
          return `
            <div data-si="${i}" class="border border-slate-800 rounded-lg overflow-hidden ${open ? 'ring-1 ring-indigo-500/30' : ''} transition-all">
              <div class="flex items-center gap-2 px-3 py-2 bg-slate-900/70 cursor-pointer hover:bg-slate-800/50 transition-colors" data-sa="toggle">
                <span class="text-[10px] font-mono text-slate-600 w-5">${i+1}</span>
                <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${col}">${step.action}</span>
                <span class="text-xs text-slate-400 flex-1 truncate">${esc(step.description||'')}</span>
                ${step.optional ? '<span class="text-[9px] text-amber-500/70 bg-amber-500/10 px-1.5 py-0.5 rounded">opt</span>' : ''}
                <div class="flex gap-0.5 ml-2">
                  <button data-sa="up" class="p-0.5 text-slate-600 hover:text-slate-300 rounded ${i===0?'opacity-20':''} cursor-pointer"><svg class="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg></button>
                  <button data-sa="down" class="p-0.5 text-slate-600 hover:text-slate-300 rounded ${i===flow.steps.length-1?'opacity-20':''} cursor-pointer"><svg class="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg></button>
                  <button data-sa="delete" class="p-0.5 text-slate-600 hover:text-red-400 rounded ml-1 cursor-pointer"><svg class="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
                </div>
              </div>
              ${open ? stepFields(step, i) : ''}
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}
