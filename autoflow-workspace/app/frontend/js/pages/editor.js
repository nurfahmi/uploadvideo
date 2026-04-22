// ── Flow Editor Page (mockup v4.3) ────────────────────

import { $, esc } from '../utils/helpers.js';
import state, { set, on } from '../state.js';
import { appendLog } from '../components/console-panel.js';

const { invoke } = window.__TAURI__.core;

const ACTIONS = [
  'click', 'find_and_tap', 'assert_exists', 'sleep_until',
  'tap', 'tap_pct', 'long_press', 'swipe', 'select_gallery_item',
  'type_text', 'type_multiline', 'clear_field',
  'u2_click', 'u2_type',
  'back', 'key_event',
  'open_app', 'kill_app', 'launch_intent',
  'push_file', 'media_scan',
  'wait', 'screenshot',
  'scroll_to', 'skip_if_empty', 'check_activity', 'dismiss_popup', 'shell_cmd',
];

const ACTION_PROPS = {
  click:              ['target', 'timeout', 'threshold', 'optional'],
  find_and_tap:       ['target', 'timeout', 'threshold'],
  assert_exists:      ['target', 'timeout', 'threshold', 'optional'],
  sleep_until:        ['target', 'timeout', 'interval', 'optional'],
  tap:                ['x', 'y'],
  tap_pct:            ['x_pct', 'y_pct'],
  long_press:         ['x', 'y', 'duration'],
  swipe:              ['direction', 'x1', 'y1', 'x2', 'y2', 'duration'],
  select_gallery_item:['index', 'cols', 'grid_top', 'cell_width', 'cell_height'],
  type_text:          ['text', 'use_clipboard', 'optional'],
  type_multiline:     ['lines'],
  clear_field:        [],
  u2_click:           ['resourceId', 'text', 'textContains', 'contentDescription', 'timeout', 'optional'],
  u2_type:            ['resourceId', 'className', 'text', 'clear', 'timeout'],
  back:               [],
  key_event:          ['keycode'],
  open_app:           ['package'],
  kill_app:           ['package'],
  launch_intent:      ['intent'],
  push_file:          ['local_path', 'remote_path', 'stop_on_fail'],
  media_scan:         ['path'],
  wait:               ['duration'],
  screenshot:         ['output'],
  scroll_to:          ['direction', 'times', 'duration'],
  skip_if_empty:      ['field', 'skip_to_phase'],
  check_activity:     ['expected', 'optional'],
  dismiss_popup:      ['x', 'y', 'retries'],
  shell_cmd:          ['command'],
};

const ACTION_COLORS = {
  click: 'blue', find_and_tap: 'blue', assert_exists: 'blue', sleep_until: 'blue',
  tap: 'amber', tap_pct: 'amber', long_press: 'amber', swipe: 'amber', select_gallery_item: 'amber',
  type_text: 'purple', type_multiline: 'purple', clear_field: 'purple',
  u2_click: 'cyan', u2_type: 'cyan',
  back: 'gray', key_event: 'gray',
  open_app: 'green', kill_app: 'red', launch_intent: 'green',
  push_file: 'amber', media_scan: 'cyan',
  wait: 'gray', screenshot: 'blue',
  scroll_to: 'amber', skip_if_empty: 'gray', check_activity: 'blue',
  dismiss_popup: 'gray', shell_cmd: 'gray',
};

const ACTION_GROUPS = [
  { label: 'Find & Tap Image', actions: ['click', 'find_and_tap', 'assert_exists', 'sleep_until'] },
  { label: 'Touch Screen', actions: ['tap', 'tap_pct', 'long_press', 'swipe', 'select_gallery_item'] },
  { label: 'Type Text', actions: ['type_text', 'type_multiline', 'clear_field'] },
  { label: 'Smart UI (u2)', actions: ['u2_click', 'u2_type'] },
  { label: 'Navigate', actions: ['back', 'key_event', 'scroll_to'] },
  { label: 'App Control', actions: ['open_app', 'kill_app', 'launch_intent'] },
  { label: 'Transfer Files', actions: ['push_file', 'media_scan'] },
  { label: 'Wait & Capture', actions: ['wait', 'screenshot'] },
  { label: 'Flow Control', actions: ['skip_if_empty', 'check_activity', 'dismiss_popup', 'shell_cmd'] },
];

// User-friendly labels + emoji icons per action
const ACTION_LABEL = {
  click:               { icon: '🖱️', label: 'Find & Tap' },
  find_and_tap:        { icon: '🔍', label: 'Search & Tap' },
  assert_exists:       { icon: '👁️', label: 'Wait for Image' },
  sleep_until:         { icon: '⏳', label: 'Wait Until Found' },
  tap:                 { icon: '👆', label: 'Tap Position' },
  tap_pct:             { icon: '📐', label: 'Tap % Position' },
  long_press:          { icon: '👇', label: 'Long Press' },
  swipe:               { icon: '👉', label: 'Swipe' },
  select_gallery_item: { icon: '🖼️', label: 'Pick from Gallery' },
  type_text:           { icon: '⌨️', label: 'Type Text' },
  type_multiline:      { icon: '📝', label: 'Type Lines' },
  clear_field:         { icon: '🧹', label: 'Clear Text' },
  u2_click:            { icon: '🎯', label: 'Smart Tap (u2)' },
  u2_type:             { icon: '✏️', label: 'Smart Type (u2)' },
  back:                { icon: '⬅️', label: 'Back Button' },
  key_event:           { icon: '🔘', label: 'Press Key' },
  open_app:            { icon: '📱', label: 'Open App' },
  kill_app:            { icon: '⛔', label: 'Close App' },
  launch_intent:       { icon: '🚀', label: 'Launch Intent' },
  push_file:           { icon: '📤', label: 'Send File to Phone' },
  media_scan:          { icon: '🔄', label: 'Refresh Gallery' },
  wait:                { icon: '⏸️', label: 'Wait' },
  screenshot:          { icon: '📸', label: 'Screenshot' },
  scroll_to:           { icon: '📜', label: 'Scroll' },
  skip_if_empty:       { icon: '⏭️', label: 'Skip If Empty' },
  check_activity:      { icon: '🔎', label: 'Check Screen' },
  dismiss_popup:       { icon: '❌', label: 'Dismiss Popup' },
  shell_cmd:           { icon: '💻', label: 'Shell Command' },
};

let images = [];
let editorView = 'list'; // 'list' or 'flow'
let editingStep = -1; // which step is open for editing (-1 = none)
let flowMenuOpen = false;
let showTemplateStore = false;

// Available template flows (add-on marketplace)
// SVG brand icons (inline)
const BRAND_SVG = {
  shopee: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C9.24 2 7 4.24 7 7h2c0-1.66 1.34-3 3-3s3 1.34 3 3h2c0-2.76-2.24-5-5-5zm-7 7c-.55 0-1 .45-1 1v1l1.53 8.55C5.7 20.38 6.4 21 7.23 21h9.54c.83 0 1.53-.62 1.7-1.45L20 11v-1c0-.55-.45-1-1-1H5zm7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.18 8.18 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.19a3.02 3.02 0 00-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 00.5 6.19 31.6 31.6 0 000 12a31.6 31.6 0 00.5 5.81 3.02 3.02 0 002.12 2.14c1.88.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 002.12-2.14A31.6 31.6 0 0024 12a31.6 31.6 0 00-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.97.24 2.44.41.61.24 1.05.52 1.51.98.46.46.74.9.98 1.51.17.47.36 1.27.41 2.44.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.24 1.97-.41 2.44-.24.61-.52 1.05-.98 1.51-.46.46-.9.74-1.51.98-.47.17-1.27.36-2.44.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.97-.24-2.44-.41a4.08 4.08 0 01-1.51-.98 4.08 4.08 0 01-.98-1.51c-.17-.47-.36-1.27-.41-2.44C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.24-1.97.41-2.44.24-.61.52-1.05.98-1.51.46-.46.9-.74 1.51-.98.47-.17 1.27-.36 2.44-.41C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.77 5.77 0 00-2.09 1.36A5.77 5.77 0 00.63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.47 1.36 2.09a5.77 5.77 0 002.09 1.36c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.77 5.77 0 002.09-1.36 5.77 5.77 0 001.36-2.09c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.77 5.77 0 00-1.36-2.09A5.77 5.77 0 0019.86.63C19.1.33 18.22.13 16.95.07 15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 100 12.32 6.16 6.16 0 000-12.32zM12 16a4 4 0 110-8 4 4 0 010 8zm7.85-10.4a1.44 1.44 0 11-2.88 0 1.44 1.44 0 012.88 0z"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07c0 6.02 4.39 11.02 10.13 11.93v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.79-4.7 4.53-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.33l-.53 3.49h-2.8v8.44C19.61 23.09 24 18.09 24 12.07z"/></svg>`,
  lazada: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
  tokopedia: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a5 5 0 00-5 5v1H5a2 2 0 00-2 2v8a4 4 0 004 4h10a4 4 0 004-4v-8a2 2 0 00-2-2h-2V7a5 5 0 00-5-5zm-3 5a3 3 0 016 0v1H9V7zm3 6a2 2 0 110 4 2 2 0 010-4z"/></svg>`,
  snackvideo: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>`,
};

const FLOW_TEMPLATES = [
  { id: 'shopee_upload', name: 'Shopee Video', brand: 'shopee', color: '#EE4D2D', desc: 'Upload product videos to Shopee with product links', steps: 29, status: 'installed' },
  { id: 'shopee_upload_u2', name: 'Shopee Video (u2, cross-device)', brand: 'shopee', color: '#EE4D2D', desc: 'Cross-device Shopee upload via uiautomator2 selectors', steps: 42, status: 'installed' },
  { id: 'tiktok_upload', name: 'TikTok Upload', brand: 'tiktok', color: '#ff0050', desc: 'Upload videos to TikTok with captions & hashtags', steps: 23, status: 'installed' },
  { id: 'youtube_shorts', name: 'YouTube Shorts', brand: 'youtube', color: '#FF0000', desc: 'Upload short videos to YouTube Shorts', steps: 0, status: 'available' },
  { id: 'instagram_reels', name: 'Instagram Reels', brand: 'instagram', color: '#E4405F', desc: 'Upload reels to Instagram with captions & tags', steps: 0, status: 'available' },
  { id: 'facebook_reels', name: 'Facebook Reels', brand: 'facebook', color: '#1877F2', desc: 'Upload reels to Facebook pages', steps: 0, status: 'available' },
  { id: 'lazada_upload', name: 'Lazada Video', brand: 'lazada', color: '#0F146D', desc: 'Upload product videos to Lazada seller center', steps: 0, status: 'available' },
  { id: 'tokopedia_upload', name: 'Tokopedia Video', brand: 'tokopedia', color: '#42B549', desc: 'Upload product videos to Tokopedia', steps: 0, status: 'available' },
  { id: 'snack_video', name: 'Snack Video', brand: 'snackvideo', color: '#FFFC00', desc: 'Upload short videos to Snack Video', steps: 0, status: 'available' },
];

function brandIcon(brand, size = 16) {
  const svg = BRAND_SVG[brand] || '';
  return `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>`;
}

export function init() {
  const panel = $('#page-editor');

  panel.addEventListener('click', (e) => {
    // Flow menu
    if (e.target.closest('#btn-flow-menu')) { flowMenuOpen = !flowMenuOpen; render(); return; }
    const flowBtn = e.target.closest('[data-select-flow]');
    if (flowBtn) { selectFlow(flowBtn.dataset.selectFlow); return; }

    // Template store
    if (e.target.closest('#btn-open-store')) { showTemplateStore = true; render(); return; }
    if (e.target.closest('#btn-close-store')) { showTemplateStore = false; render(); return; }
    const installBtn = e.target.closest('[data-install-template]');
    if (installBtn) { installTemplate(installBtn.dataset.installTemplate); return; }
    if (e.target.id === 'template-store-overlay') { showTemplateStore = false; render(); return; }

    // View toggle — always re-render to sync changes between views
    const viewBtn = e.target.closest('[data-view]');
    if (viewBtn) {
      if (_fcCleanup) { _fcCleanup(); _fcCleanup = null; }
      editorView = viewBtn.dataset.view;
      render();
      return;
    }

    // Step actions — check specific buttons BEFORE row click
    const delBtn = e.target.closest('[data-step-delete]');
    if (delBtn) { deleteStep(parseInt(delBtn.dataset.stepDelete)); return; }
    const upBtn = e.target.closest('[data-step-up]');
    if (upBtn) { moveStep(parseInt(upBtn.dataset.stepUp), -1); return; }
    const downBtn = e.target.closest('[data-step-down]');
    if (downBtn) { moveStep(parseInt(downBtn.dataset.stepDown), 1); return; }

    // Click on step row to edit
    const row = e.target.closest('[data-step-row]');
    if (row) {
      const i = parseInt(row.dataset.stepRow);
      editingStep = editingStep === i ? -1 : i;
      render();
      return;
    }

    // Add step / Save / Capture
    if (e.target.closest('#btn-add-step')) { addStep(); return; }
    if (e.target.closest('#btn-save-flow')) { saveFlow(); return; }
    if (e.target.closest('#btn-capture')) { captureScreen(); return; }

    // Close flow menu if clicking outside
    if (flowMenuOpen && !e.target.closest('#flow-menu-container')) { flowMenuOpen = false; render(); }
  });

  panel.addEventListener('input', (e) => {
    if (e.target.dataset.ep === undefined) return;
    const i = parseInt(e.target.dataset.ei);
    const prop = e.target.dataset.ep;
    const flow = state.flow;
    if (!flow) return;

    const numericProps = ['timeout','threshold','duration','delay_after','x','y','x1','y1','x2','y2','index','cols','grid_top','cell_width','cell_height','interval'];
    if (numericProps.includes(prop)) {
      flow.steps[i][prop] = parseFloat(e.target.value) || 0;
    } else if (prop === 'lines') {
      flow.steps[i][prop] = e.target.value.split('\n');
    } else {
      flow.steps[i][prop] = e.target.value;
    }
    state.flowDirty = true;
  });

  panel.addEventListener('change', (e) => {
    if (!e.target.dataset.ep) return;
    const i = parseInt(e.target.dataset.ei);
    const flow = state.flow;
    if (!flow) return;

    if (e.target.type === 'checkbox') {
      flow.steps[i][e.target.dataset.ep] = e.target.checked;
      state.flowDirty = true;
    }
    if (e.target.dataset.ep === 'action') {
      const newAction = e.target.value;
      const oldDesc = flow.steps[i].description || '';
      const newProps = {};
      (ACTION_PROPS[newAction] || []).forEach(p => { newProps[p] = ''; });
      flow.steps[i] = { action: newAction, description: oldDesc, ...newProps };
      state.flowDirty = true;
      render();
    }
  });

  on('flow', () => { editingStep = -1; render(); });
}

// ── Actions ──────────────────────────────────────────

function selectFlow(name) {
  flowMenuOpen = false;
  const installed = FLOW_TEMPLATES.filter(t => t.status === 'installed').map(t => t.id);
  if (installed.includes(name)) {
    set('platform', name);
  }
  render();
}

function installTemplate(id) {
  const tpl = FLOW_TEMPLATES.find(t => t.id === id);
  if (!tpl || tpl.status === 'installed') return;
  tpl.status = 'coming_soon';
  appendLog(`[SYSTEM] "${tpl.name}" template is coming soon as an add-on module`);
  render();
}

function deleteStep(i) {
  if (!state.flow) return;
  state.flow.steps.splice(i, 1);
  if (editingStep === i) editingStep = -1;
  else if (editingStep > i) editingStep--;
  state.flowDirty = true;
  render();
}

function moveStep(i, dir) {
  if (!state.flow) return;
  const j = i + dir;
  if (j < 0 || j >= state.flow.steps.length) return;
  [state.flow.steps[i], state.flow.steps[j]] = [state.flow.steps[j], state.flow.steps[i]];
  if (editingStep === i) editingStep = j;
  state.flowDirty = true;
  render();
}

function addStep() {
  if (!state.flow) return;
  state.flow.steps.push({ action: 'tap', description: '', x: 0, y: 0 });
  editingStep = state.flow.steps.length - 1;
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

async function captureScreen() {
  const sel = document.getElementById('ed-device-select');
  const deviceId = sel?.value;
  if (!deviceId) { appendLog('[SYSTEM] Select a device first'); return; }
  appendLog('[SYSTEM] Capturing screen...');
  try {
    const filename = await invoke('capture_screen', { deviceId, flowName: state.platform });
    appendLog(`[SYSTEM] Screenshot saved: ${filename}`);
    await loadImages();
  } catch (err) {
    appendLog('[ERROR] Capture failed: ' + err);
  }
}

async function loadImages() {
  try {
    images = await invoke('list_flow_images', { flowName: state.platform });
    const el = document.getElementById('ed-image-list');
    if (el) {
      el.innerHTML = images.length
        ? images.map(n => `<span class="badge ${n.startsWith('screenshot_') ? 'b-cyan' : 'b-green'}">${n}</span>`).join(' ')
        : '<span style="font-size:10px;color:var(--c-fg-3);font-style:italic">No images yet</span>';
    }
  } catch (err) {}
}

// ── Render ───────────────────────────────────────────

export function render() {
  const panel = $('#page-editor');
  const flow = state.flow;

  if (!flow) {
    panel.innerHTML = '<div style="padding:40px;text-align:center;color:var(--c-fg-3)">No flow loaded</div>';
    return;
  }

  const flowName = flow.name || (state.platform === 'shopee_upload' ? 'Shopee Video' : 'TikTok Upload');
  const installedFlows = FLOW_TEMPLATES.filter(t => t.status === 'installed');

  panel.innerHTML = `
    <!-- Flow tabs + toolbar -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:2px;overflow-x:auto;flex-shrink:1;min-width:0;scrollbar-width:none">
        ${installedFlows.map(t => `
          <button data-select-flow="${t.id}" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:5px 5px 0 0;border:1px solid ${state.platform === t.id ? 'var(--c-bg-3)' : 'transparent'};border-bottom:${state.platform === t.id ? '2px solid var(--c-accent)' : '1px solid transparent'};background:${state.platform === t.id ? 'var(--c-bg-1)' : 'transparent'};cursor:pointer;font-family:inherit;transition:all .1s;white-space:nowrap;flex-shrink:0" onmouseover="if('${state.platform}'!=='${t.id}')this.style.background='var(--c-bg-2)'" onmouseout="if('${state.platform}'!=='${t.id}')this.style.background='transparent'">
            <span style="color:${t.color}">${brandIcon(t.brand, 14)}</span>
            <span style="font-size:11px;font-weight:${state.platform === t.id ? '600' : '400'};color:${state.platform === t.id ? 'var(--c-fg-0)' : 'var(--c-fg-2)'}">${t.name}</span>
            ${state.platform === t.id ? `<span style="font-size:9px;color:var(--c-fg-3)">${t.steps}</span>` : ''}
          </button>
        `).join('')}
        <button id="btn-open-store" class="q-icon-btn" title="Get more templates">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m-7-7h14"/></svg>
        </button>
        <div style="width:1px;height:16px;background:var(--c-bg-2);margin:0 4px"></div>
        <span style="font-size:10px;color:var(--c-fg-3)">${flow.steps.length} steps${state.flowDirty ? ' · <span style="color:var(--c-amber)">unsaved</span>' : ''}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="view-tog">
          <button class="${editorView === 'list' ? 'on' : ''}" data-view="list">List</button>
          <button class="${editorView === 'flow' ? 'on' : ''}" data-view="flow">Flowchart</button>
        </div>
        <div style="width:1px;height:16px;background:var(--c-bg-3)"></div>
        <select id="ed-device-select" style="width:140px;font-size:10px">
          ${!state.devices.length ? '<option value="">No device</option>' : state.devices.map(([id, model]) => {
            const h = state.deviceHealth[id] || {};
            const brand = h.brand ? h.brand.charAt(0).toUpperCase() + h.brand.slice(1).toLowerCase() : '';
            const label = brand || model;
            const short = id.length > 6 ? id.slice(-4) : id;
            return `<option value="${esc(id)}">${esc(label)} (${short})</option>`;
          }).join('')}
        </select>
        <button id="btn-capture" class="q-icon-btn accent" title="Capture screen" style="border:1px solid var(--c-bg-3)">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>
        <div style="width:1px;height:16px;background:var(--c-bg-3)"></div>
        <button id="btn-add-step" class="q-icon-btn" title="Add step" style="border:1px solid var(--c-bg-3)">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14"/></svg>
        </button>
        <button id="btn-save-flow" class="q-icon-btn primary" title="Save flow" style="border:1px solid var(--c-bg-3)">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        </button>
      </div>
    </div>

    <!-- Template images (hidden) -->
    <span id="ed-image-list" style="display:none"></span>

    ${showTemplateStore ? renderTemplateStore() : ''}

    <!-- List view -->
    <div id="ed-list-view" style="display:${editorView === 'list' ? 'block' : 'none'}">
      ${flow.steps.map((step, i) => {
        // Phase markers (no action) → render as section header
        if (!step.action) {
          const title = (step._title || step._phase || '').replace(/^=+\s*|\s*=+$/g, '').trim();
          if (!title) return '';
          return `
          <div style="padding:6px 12px;margin-top:8px;display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:1px;background:var(--c-bg-2)"></div>
            <span style="font-size:9px;color:var(--c-accent);font-weight:600;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap">${esc(title)}</span>
            <div style="flex:1;height:1px;background:var(--c-bg-2)"></div>
          </div>`;
        }
        const c = ACTION_COLORS[step.action] || 'gray';
        const isEditing = editingStep === i;
        return `
          <div data-step-row="${i}" class="step-row" style="${isEditing ? 'background:var(--c-accent-a04);border-left:2px solid var(--c-accent);padding-left:10px' : ''}">
            <span style="font-size:10px;color:var(--c-bg-3);font-family:'IBM Plex Mono',monospace;width:18px;text-align:right">${i + 1}</span>
            <span style="font-size:13px;width:20px;text-align:center">${(ACTION_LABEL[step.action] || {}).icon || '⚡'}</span>
            <span class="badge b-${c}" style="min-width:72px;text-align:center">${(ACTION_LABEL[step.action] || {}).label || step.action}</span>
            <span style="color:var(--c-fg-1);flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(step.description || '')}</span>
            <div class="act" style="display:flex;gap:2px">
              <button data-step-up="${i}" style="background:none;border:none;color:var(--c-bg-3);cursor:pointer;padding:1px" ${i === 0 ? 'disabled' : ''}>
                <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg>
              </button>
              <button data-step-down="${i}" style="background:none;border:none;color:var(--c-bg-3);cursor:pointer;padding:1px" ${i === flow.steps.length - 1 ? 'disabled' : ''}>
                <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/></svg>
              </button>
              <button data-step-delete="${i}" style="background:none;border:none;color:var(--c-bg-3);cursor:pointer;padding:1px">
                <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
          ${isEditing ? renderEditPanel(step, i) : ''}
        `;
      }).join('')}
    </div>

    <!-- Flowchart view -->
    <div id="ed-flow-view" style="display:${editorView === 'flow' ? 'block' : 'none'}">
      <div class="card" style="position:relative;overflow:hidden;height:calc(100vh - 220px);min-height:400px">
        <!-- Zoom controls -->
        <div style="position:absolute;top:8px;left:8px;display:flex;gap:3px;z-index:10">
          <button class="q-icon-btn" id="fc-zoom-in" title="Zoom in" style="width:24px;height:24px">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14"/></svg>
          </button>
          <button class="q-icon-btn" id="fc-zoom-out" title="Zoom out" style="width:24px;height:24px">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>
          </button>
          <button class="q-icon-btn" id="fc-zoom-fit" title="Fit to view" style="width:24px;height:24px">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
          </button>
          <span id="fc-zoom-label" style="font-size:9px;color:var(--c-fg-3);padding:3px 6px"></span>
        </div>
        <!-- SVG container (scrollable) -->
        <div id="fc-container" style="width:100%;height:100%;overflow:auto;cursor:grab">
          <svg id="fc-svg" style="display:block"></svg>
        </div>
      </div>
    </div>
  `;

  // Load images (non-blocking, only updates #ed-image-list)
  loadImages();

  // Render flowchart if visible
  if (editorView === 'flow') renderFlowchart(flow);
}

// ── Edit Panel (inline below step row) ───────────────

function renderEditPanel(step, i) {
  const props = ACTION_PROPS[step.action] || [];
  const allProps = ['description', ...props];
  const extra = Object.keys(step).filter(k => !['action','description','delay_after','_status'].includes(k) && !props.includes(k));
  const fields = [...allProps, ...extra];

  const PLACEHOLDERS = {
    target: 'e.g. btn_upload.png', timeout: 'seconds', threshold: '0.0-1.0 (default 0.7)',
    duration: 'seconds or ms', package: 'e.g. com.shopee.id', intent: 'android intent string',
    keycode: 'e.g. enter, home, 66', direction: 'up/down/left/right', text: 'Text to type...',
    lines: 'Line 1\\nLine 2', local_path: '/path/to/file', remote_path: '/sdcard/DCIM/AutoFlow/',
    path: '/sdcard/DCIM/AutoFlow/', output: 'screenshot.png', index: '0 = first item',
    interval: 'poll interval (sec)', x: 'X', y: 'Y', x1: 'Start X', y1: 'Start Y', x2: 'End X', y2: 'End Y',
    description: 'Step description...',
  };

  return `
    <div style="padding:10px 12px 10px 32px;background:var(--c-accent-a04);border-bottom:1px solid var(--c-border-60)">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <span style="font-size:9px;color:var(--c-fg-3);font-weight:600;width:60px">ACTION</span>
        <select data-ei="${i}" data-ep="action" style="flex:1;font-size:10px;padding:3px 6px">
          ${ACTION_GROUPS.map(g => `<optgroup label="${g.label}">${g.actions.map(a => { const al = ACTION_LABEL[a] || {}; return `<option value="${a}" ${a === step.action ? 'selected' : ''}>${al.icon || '⚡'} ${al.label || a}</option>`; }).join('')}</optgroup>`).join('')}
        </select>
      </div>
      ${fields.map(f => {
        const v = step[f];
        const ph = PLACEHOLDERS[f] || '';
        const isBool = typeof v === 'boolean' || ['optional', 'stop_on_fail', 'use_clipboard'].includes(f);
        if (isBool) return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><span style="font-size:9px;color:var(--c-fg-3);font-weight:600;width:60px">${f.toUpperCase()}</span><input type="checkbox" data-ei="${i}" data-ep="${f}" ${v ? 'checked' : ''} style="accent-color:var(--c-accent)"></div>`;
        if (f === 'lines') return `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:4px"><span style="font-size:9px;color:var(--c-fg-3);font-weight:600;width:60px;padding-top:4px">${f.toUpperCase()}</span><textarea data-ei="${i}" data-ep="${f}" rows="3" placeholder="${ph}" class="inp" style="flex:1;resize:vertical;font-size:10px">${esc(Array.isArray(v) ? v.join('\n') : String(v ?? ''))}</textarea></div>`;
        return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><span style="font-size:9px;color:var(--c-fg-3);font-weight:600;width:60px">${f.toUpperCase()}</span><input type="text" value="${esc(String(v ?? ''))}" placeholder="${ph}" data-ei="${i}" data-ep="${f}" class="inp" style="flex:1;font-size:10px"></div>`;
      }).join('')}
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <span style="font-size:9px;color:var(--c-fg-3);font-weight:600;width:60px">DELAY</span>
        <input type="text" value="${esc(String(step.delay_after ?? 0.5))}" data-ei="${i}" data-ep="delay_after" placeholder="seconds (default 0.5)" class="inp" style="flex:1;font-size:10px">
      </div>
    </div>
  `;
}

// ── Flowchart SVG ────────────────────────────────────

let fcZoom = 1;
let nodePositions = []; // [{x, y}, ...] per step
let _fcCleanup = null; // cleanup function for event listeners

function initNodePositions(steps) {
  const nodeW = 180, nodeH = 44, gapY = 28, padX = 80, padY = 40;
  if (nodePositions.length !== steps.length) {
    nodePositions = steps.map((_, i) => ({
      x: padX,
      y: padY + i * (nodeH + gapY),
    }));
  }
}

function renderFlowchart(flow) {
  // Cleanup previous listeners
  if (_fcCleanup) { _fcCleanup(); _fcCleanup = null; }

  const svg = document.getElementById('fc-svg');
  const container = document.getElementById('fc-container');
  if (!svg || !container) return;

  // Clear SVG completely first
  svg.innerHTML = '';

  const steps = flow.steps;
  const nodeW = 180, nodeH = 44;
  initNodePositions(steps);

  // Calculate bounds
  let maxX = 0, maxY = 0;
  nodePositions.forEach(p => { maxX = Math.max(maxX, p.x + nodeW + 80); maxY = Math.max(maxY, p.y + nodeH + 60); });
  const totalW = Math.max(500, maxX);
  const totalH = Math.max(400, maxY);

  // SVG needs actual hex values for color+alpha suffixes (e.g. #6ab0ff50)
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  const colorMap = {
    blue: v('--c-accent'), red: v('--c-red'), green: v('--c-green'), amber: v('--c-amber'),
    purple: v('--c-purple'), cyan: v('--c-cyan'), gray: v('--c-fg-2'),
  };

  const bg0 = v('--c-bg-0'), bg1 = v('--c-bg-1'), bg2 = v('--c-bg-2'), bg3 = v('--c-bg-3');
  const fg0 = v('--c-fg-0'), fg2 = v('--c-fg-2'), fg3 = v('--c-fg-3');
  const accent = v('--c-accent');

  let html = `
    <defs>
      <marker id="arrowhead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0 0L10 5L0 10z" fill="${bg3}"/>
      </marker>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000" flood-opacity="0.3"/>
      </filter>
      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="${bg1}" stroke-width="0.5"/>
      </pattern>
    </defs>
    <rect width="${totalW}" height="${totalH}" fill="url(#grid)"/>
  `;

  // Connector lines (draw first, behind nodes)
  steps.forEach((_, i) => {
    if (i < steps.length - 1) {
      const from = nodePositions[i];
      const to = nodePositions[i + 1];
      const fx = from.x + nodeW / 2, fy = from.y + nodeH;
      const tx = to.x + nodeW / 2, ty = to.y;
      // Bezier curve connector
      const midY = (fy + ty) / 2;
      html += `<path d="M${fx},${fy} C${fx},${midY} ${tx},${midY} ${tx},${ty}" fill="none" stroke="${bg3}" stroke-width="1.5" marker-end="url(#arrowhead)"/>`;
    }
  });

  // Start indicator
  if (steps.length > 0) {
    const first = nodePositions[0];
    const cx = first.x + nodeW / 2;
    html += `
      <circle cx="${cx}" cy="${first.y - 16}" r="10" fill="${bg2}" stroke="${bg3}" stroke-width="1"/>
      <text x="${cx}" y="${first.y - 13}" text-anchor="middle" fill="${fg3}" font-size="7" font-weight="700" font-family="IBM Plex Sans">START</text>
      <line x1="${cx}" y1="${first.y - 6}" x2="${cx}" y2="${first.y}" stroke="${bg3}" stroke-width="1.5" marker-end="url(#arrowhead)"/>
    `;
  }

  // Nodes
  steps.forEach((step, i) => {
    const pos = nodePositions[i];
    const x = pos.x, y = pos.y;

    // Phase markers → render as label divider
    if (!step.action) {
      const title = (step._title || step._phase || '').replace(/^=+\s*|\s*=+$/g, '').trim();
      if (title) {
        html += `
          <g>
            <line x1="${x}" y1="${y + nodeH / 2}" x2="${x + nodeW}" y2="${y + nodeH / 2}" stroke="${bg3}" stroke-width="1" stroke-dasharray="4,3"/>
            <rect x="${x + nodeW / 2 - title.length * 3.5 - 8}" y="${y + nodeH / 2 - 9}" width="${title.length * 7 + 16}" height="18" rx="9" fill="${bg1}" stroke="${bg3}" stroke-width="1"/>
            <text x="${x + nodeW / 2}" y="${y + nodeH / 2 + 3.5}" text-anchor="middle" fill="${accent}" font-size="8" font-weight="600" font-family="IBM Plex Sans" letter-spacing=".5">${esc(title)}</text>
          </g>
        `;
      }
      return;
    }

    const c = colorMap[ACTION_COLORS[step.action] || 'gray'];
    const desc = (step.description || '').slice(0, 26) + ((step.description || '').length > 26 ? '...' : '');

    html += `
      <g class="fc-node" data-fc-node="${i}" style="cursor:grab">
        <rect class="fc-node-bg" x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="6" fill="${bg1}" stroke="${c}50" stroke-width="1.5" filter="url(#shadow)"/>
        <circle cx="${x + 16}" cy="${y + nodeH / 2}" r="10" fill="${c}20" stroke="${c}40" stroke-width="1"/>
        <text x="${x + 16}" y="${y + nodeH / 2 + 3.5}" text-anchor="middle" fill="${c}" font-size="9" font-weight="700" font-family="IBM Plex Mono">${i + 1}</text>
        <text x="${x + 32}" y="${y + 18}" font-size="12">${(ACTION_LABEL[step.action] || {}).icon || '⚡'}</text>
        <rect x="${x + 48}" y="${y + 7}" width="${Math.min(((ACTION_LABEL[step.action] || {}).label || step.action).length * 6.2 + 12, 110)}" height="15" rx="3" fill="${c}15"/>
        <text x="${x + 54}" y="${y + 17.5}" fill="${c}" font-size="9.5" font-weight="600" font-family="IBM Plex Sans">${(ACTION_LABEL[step.action] || {}).label || step.action}</text>
        <text x="${x + 34}" y="${y + 37}" fill="${fg2}" font-size="9" font-family="IBM Plex Sans">${esc(desc)}</text>
      </g>
    `;
  });

  // End indicator
  if (steps.length > 0) {
    const last = nodePositions[steps.length - 1];
    const cx = last.x + nodeW / 2;
    const ey = last.y + nodeH + 20;
    html += `
      <line x1="${cx}" y1="${last.y + nodeH}" x2="${cx}" y2="${ey}" stroke="${bg3}" stroke-width="1.5"/>
      <rect x="${cx - 14}" y="${ey}" width="28" height="16" rx="4" fill="${bg2}" stroke="${bg3}" stroke-width="1"/>
      <text x="${cx}" y="${ey + 11}" text-anchor="middle" fill="${fg3}" font-size="7" font-weight="700" font-family="IBM Plex Sans">END</text>
    `;
  }

  // Hint text
  html += `<text x="${totalW / 2}" y="${totalH - 10}" text-anchor="middle" fill="${bg2}" font-size="10" font-family="IBM Plex Sans">Drag nodes to reposition - Double-click to edit</text>`;

  const svgW = totalW * fcZoom;
  const svgH = totalH * fcZoom;
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
  svg.innerHTML = html;

  const label = document.getElementById('fc-zoom-label');
  if (label) label.textContent = Math.round(fcZoom * 100) + '%';

  // ── Drag nodes + double-click ──────────────────
  svg.querySelectorAll('[data-fc-node]').forEach(g => {
    const idx = parseInt(g.dataset.fcNode);

    g.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const startPt = svgPoint(svg, e);
      const origX = nodePositions[idx].x;
      const origY = nodePositions[idx].y;
      let dx = 0, dy = 0, moved = false;

      const onMove = (ev) => {
        const p = svgPoint(svg, ev);
        dx = p.x - startPt.x;
        dy = p.y - startPt.y;

        if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          moved = true;
          // Hide all connectors + start/end markers when drag starts
          svg.querySelectorAll('path[marker-end], line[marker-end], circle, text').forEach(el => {
            if (!el.closest('[data-fc-node]')) el.style.opacity = '0';
          });
          g.style.opacity = '0.9';
          g.style.cursor = 'grabbing';
          container.style.cursor = 'grabbing';
        }

        if (moved) {
          g.setAttribute('transform', `translate(${dx},${dy})`);
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        container.style.cursor = 'grab';

        if (moved) {
          nodePositions[idx].x = Math.max(10, origX + dx);
          nodePositions[idx].y = Math.max(10, origY + dy);
          renderFlowchart(flow);
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    g.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openStepPopup(idx);
    });
  });

  // ── Zoom controls ─────────────────────────────
  const zoomIn = document.getElementById('fc-zoom-in');
  const zoomOut = document.getElementById('fc-zoom-out');
  const zoomFit = document.getElementById('fc-zoom-fit');

  const onZoomIn = () => { fcZoom = Math.min(3, fcZoom + 0.2); renderFlowchart(flow); };
  const onZoomOut = () => { fcZoom = Math.max(0.3, fcZoom - 0.2); renderFlowchart(flow); };
  const onZoomFit = () => {
    const ch = container.clientHeight - 40, cw = container.clientWidth;
    fcZoom = Math.min(cw / totalW, ch / totalH, 2);
    fcZoom = Math.max(0.3, Math.round(fcZoom * 10) / 10);
    renderFlowchart(flow);
  };
  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      fcZoom = Math.max(0.3, Math.min(3, fcZoom + (e.deltaY > 0 ? -0.1 : 0.1)));
      renderFlowchart(flow);
    }
  };

  if (zoomIn) zoomIn.addEventListener('click', onZoomIn);
  if (zoomOut) zoomOut.addEventListener('click', onZoomOut);
  if (zoomFit) zoomFit.addEventListener('click', onZoomFit);
  container.addEventListener('wheel', onWheel);

  // Store cleanup for next render
  _fcCleanup = () => {
    if (zoomIn) zoomIn.removeEventListener('click', onZoomIn);
    if (zoomOut) zoomOut.removeEventListener('click', onZoomOut);
    if (zoomFit) zoomFit.removeEventListener('click', onZoomFit);
    container.removeEventListener('wheel', onWheel);
  };
}

function svgPoint(svg, evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// ── Step Edit Popup (flowchart double-click) ─────────

function openStepPopup(idx) {
  const flow = state.flow;
  if (!flow || !flow.steps[idx]) return;
  const step = flow.steps[idx];
  const props = ACTION_PROPS[step.action] || [];
  const fields = ['description', ...props];

  const PLACEHOLDERS = {
    target: 'e.g. btn_upload.png', timeout: 'seconds', threshold: '0.0-1.0',
    duration: 'seconds or ms', package: 'e.g. com.shopee.id', intent: 'android intent',
    keycode: 'e.g. enter, home, 66', direction: 'up/down/left/right', text: 'Text to type...',
    lines: 'Line 1\\nLine 2', local_path: '/path/to/file', remote_path: '/sdcard/DCIM/AutoFlow/',
    path: '/sdcard/DCIM/AutoFlow/', output: 'screenshot.png', index: '0 = first',
    interval: 'poll interval (sec)', x: 'X', y: 'Y', x1: 'Start X', y1: 'Start Y', x2: 'End X', y2: 'End Y',
    description: 'Step description...',
  };

  // Remove existing popup
  closeStepPopup();

  const overlay = document.createElement('div');
  overlay.id = 'fc-popup-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:var(--c-shadow-lg);z-index:200;display:flex;align-items:center;justify-content:center';

  overlay.innerHTML = `
    <div style="background:var(--c-bg-1);border:1px solid var(--c-bg-3);border-radius:8px;padding:16px;width:380px;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <p style="font-size:13px;font-weight:700;color:var(--c-fg-0)">Edit Step ${idx + 1}</p>
        <button id="fc-popup-close" style="background:none;border:none;color:var(--c-fg-3);cursor:pointer;font-size:16px;line-height:1">&times;</button>
      </div>

      <div style="margin-bottom:10px">
        <label style="font-size:9px;color:var(--c-fg-3);font-weight:600;display:block;margin-bottom:3px">ACTION</label>
        <select id="fc-popup-action" style="width:100%;padding:5px 8px">
          ${ACTION_GROUPS.map(g => `<optgroup label="${g.label}">${g.actions.map(a => { const al = ACTION_LABEL[a] || {}; return `<option value="${a}" ${a === step.action ? 'selected' : ''}>${al.icon || '⚡'} ${al.label || a}</option>`; }).join('')}</optgroup>`).join('')}
        </select>
      </div>

      <div id="fc-popup-fields">
        ${fields.map(f => {
          const v = step[f];
          const ph = PLACEHOLDERS[f] || '';
          const isBool = typeof v === 'boolean' || ['optional', 'stop_on_fail', 'use_clipboard'].includes(f);
          if (isBool) return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><label style="font-size:9px;color:var(--c-fg-3);font-weight:600;width:70px">${f.toUpperCase()}</label><input type="checkbox" data-pf="${f}" ${v ? 'checked' : ''} style="accent-color:var(--c-accent)"></div>`;
          if (f === 'lines') return `<div style="margin-bottom:6px"><label style="font-size:9px;color:var(--c-fg-3);font-weight:600;display:block;margin-bottom:2px">${f.toUpperCase()}</label><textarea data-pf="${f}" rows="3" placeholder="${ph}" class="inp" style="width:100%;resize:vertical;font-size:10px">${esc(Array.isArray(v) ? v.join('\n') : String(v ?? ''))}</textarea></div>`;
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><label style="font-size:9px;color:var(--c-fg-3);font-weight:600;width:70px">${f.toUpperCase()}</label><input type="text" value="${esc(String(v ?? ''))}" placeholder="${ph}" data-pf="${f}" class="inp" style="flex:1;font-size:10px"></div>`;
        }).join('')}
      </div>

      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:12px;padding-top:10px;border-top:1px solid var(--c-bg-2)">
        <button class="btn btn-danger" id="fc-popup-delete" style="margin-right:auto;font-size:10px">Delete step</button>
        <button class="btn" id="fc-popup-cancel" >Cancel</button>
        <button class="btn btn-primary" id="fc-popup-save" >Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeStepPopup(); });
  overlay.querySelector('#fc-popup-close').onclick = closeStepPopup;
  overlay.querySelector('#fc-popup-cancel').onclick = closeStepPopup;

  // Action change → refresh fields
  overlay.querySelector('#fc-popup-action').onchange = (e) => {
    step.action = e.target.value;
    const newProps = {};
    (ACTION_PROPS[step.action] || []).forEach(p => { if (!(p in step)) newProps[p] = ''; });
    Object.assign(step, newProps);
    state.flowDirty = true;
    closeStepPopup();
    openStepPopup(idx);
  };

  // Delete
  overlay.querySelector('#fc-popup-delete').onclick = () => {
    flow.steps.splice(idx, 1);
    nodePositions.splice(idx, 1);
    state.flowDirty = true;
    closeStepPopup();
    renderFlowchart(flow);
  };

  // Save
  overlay.querySelector('#fc-popup-save').onclick = () => {
    const numericProps = ['timeout','threshold','duration','delay_after','x','y','x1','y1','x2','y2','index','cols','grid_top','cell_width','cell_height','interval'];
    overlay.querySelectorAll('[data-pf]').forEach(el => {
      const f = el.dataset.pf;
      if (el.type === 'checkbox') { step[f] = el.checked; }
      else if (f === 'lines') { step[f] = el.value.split('\n'); }
      else if (numericProps.includes(f)) { step[f] = parseFloat(el.value) || 0; }
      else { step[f] = el.value; }
    });
    state.flowDirty = true;
    closeStepPopup();
    renderFlowchart(flow);
  };
}

function closeStepPopup() {
  const el = document.getElementById('fc-popup-overlay');
  if (el) el.remove();
}

// ── Template Store Modal ─────────────────────────────

function renderTemplateStore() {
  const available = FLOW_TEMPLATES.filter(t => t.status !== 'installed');

  return `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:var(--c-shadow-lg);z-index:200;display:flex;align-items:center;justify-content:center" id="template-store-overlay">
      <div style="background:var(--c-bg-0);border:1px solid var(--c-bg-3);border-radius:10px;width:560px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--c-bg-2)">
          <div>
            <p style="font-size:14px;font-weight:700;color:var(--c-fg-0)">Template Store</p>
            <p style="font-size:10px;color:var(--c-fg-3);margin-top:2px">Add-on flow templates for more platforms</p>
          </div>
          <button id="btn-close-store" style="background:none;border:none;color:var(--c-fg-3);cursor:pointer;font-size:18px;line-height:1">&times;</button>
        </div>

        <!-- Template grid -->
        <div style="flex:1;overflow-y:auto;padding:16px 20px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${FLOW_TEMPLATES.map(t => {
              const isInstalled = t.status === 'installed';
              const isComingSoon = t.status === 'coming_soon';
              return `
                <div style="background:var(--c-bg-1);border:1px solid ${isInstalled ? '#2ea04350' : 'var(--c-bg-2)'};border-radius:8px;padding:14px;transition:border-color .1s${!isInstalled ? ';cursor:pointer' : ''}" ${!isInstalled ? `onmouseover="this.style.borderColor='var(--c-bg-3)'" onmouseout="this.style.borderColor='var(--c-bg-2)'"` : ''}>
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                    <div style="width:36px;height:36px;border-radius:8px;background:${t.color}15;border:1px solid ${t.color}30;display:flex;align-items:center;justify-content:center;color:${t.color}">${brandIcon(t.brand, 20)}</div>
                    <div style="flex:1">
                      <p style="font-size:12px;font-weight:600;color:var(--c-fg-0)">${t.name}</p>
                      ${t.steps > 0 ? `<p style="font-size:9px;color:var(--c-fg-3)">${t.steps} steps</p>` : ''}
                    </div>
                  </div>
                  <p style="font-size:10px;color:var(--c-fg-2);margin-bottom:10px;line-height:1.4">${t.desc}</p>
                  ${isInstalled
                    ? '<span class="badge b-green">Installed</span>'
                    : isComingSoon
                      ? '<span class="badge b-amber">Coming Soon</span>'
                      : `<button data-install-template="${t.id}" class="btn btn-accent" style="width:100%">Get Template</button>`
                  }
                </div>
              `;
            }).join('')}
          </div>

          <div style="margin-top:16px;padding:12px;background:var(--c-bg-1);border:1px solid var(--c-bg-2);border-radius:8px">
            <p style="font-size:10px;color:var(--c-fg-3);text-align:center;line-height:1.5">
              More templates coming soon. Templates are add-on modules that can be installed to support additional platforms.
              <br>Each template includes pre-configured automation steps optimized for the target platform.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}
