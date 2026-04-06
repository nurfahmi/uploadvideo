// ── Tauri API via global ───────────────────────────────
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ── State ──────────────────────────────────────────────
let platform = 'tiktok_upload';
let flow = null;
let queue = [];
let logs = [];
let isRunning = false;
let activeTab = 'queue';
let expandedStep = -1;
let flowDirty = false;
let devices = [];       // [[id, model], ...]
let selectedDevices = new Set();
let finishedCount = 0;
let totalEngines = 0;

const ACTIONS = [
  'click', 'wait', 'open_app', 'kill_app', 'push_file',
  'media_scan', 'type_text', 'swipe', 'back', 'key_event',
  'tap', 'find_and_tap', 'assert_exists', 'screenshot',
];

const ACTION_PROPS = {
  click:         ['target', 'timeout', 'threshold', 'optional'],
  wait:          ['duration'],
  open_app:      ['package'],
  kill_app:      ['package'],
  push_file:     ['local_path', 'remote_path', 'stop_on_fail'],
  media_scan:    ['path'],
  type_text:     ['text', 'use_clipboard', 'optional'],
  swipe:         ['direction', 'duration'],
  back:          [],
  key_event:     ['keycode'],
  tap:           ['x', 'y'],
  find_and_tap:  ['target', 'timeout', 'threshold'],
  assert_exists: ['target', 'timeout'],
  screenshot:    ['output'],
};

const ACTION_COLORS = {
  click:      'bg-blue-500/15 text-blue-400',
  wait:       'bg-slate-500/15 text-slate-400',
  open_app:   'bg-emerald-500/15 text-emerald-400',
  kill_app:   'bg-red-500/15 text-red-400',
  push_file:  'bg-amber-500/15 text-amber-400',
  media_scan: 'bg-cyan-500/15 text-cyan-400',
  type_text:  'bg-violet-500/15 text-violet-400',
  swipe:      'bg-orange-500/15 text-orange-400',
  back:       'bg-slate-500/15 text-slate-400',
  key_event:  'bg-slate-500/15 text-slate-400',
};

// ── DOM Helpers ────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Init ───────────────────────────────────────────────
async function initApp(config) {
  const defaultPlatform = (config?.selected_platforms && config.selected_platforms[0]) || 'tiktok_upload';
  bindEvents();
  setupListener();
  await refreshDevices();
  await switchPlatform(defaultPlatform);
}

document.addEventListener('DOMContentLoaded', async () => {
  let config = {};
  try { config = await invoke('get_config'); } catch (e) { console.warn('get_config failed:', e); }

  if (!config.onboarding_completed) {
    onboarding.init(() => initApp(config));
    return;
  }
  initApp(config);
});

// ── Events ─────────────────────────────────────────────
function bindEvents() {
  // Platform
  $('#platform-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-platform]');
    if (btn) switchPlatform(btn.dataset.platform);
  });

  // Content tabs
  $('#tab-queue').addEventListener('click', () => switchTab('queue'));
  $('#tab-devices').addEventListener('click', () => switchTab('devices'));
  $('#tab-editor').addEventListener('click', () => switchTab('editor'));

  // Devices
  $('#btn-refresh-devices').addEventListener('click', refreshDevices);
  $('#device-list').addEventListener('change', onDeviceToggle);

  // Queue
  $('#btn-add-row').addEventListener('click', addRow);
  $('#btn-import-csv').addEventListener('click', () => $('#csv-file-input').click());
  $('#csv-file-input').addEventListener('change', handleCSVImport);
  $('#btn-start').addEventListener('click', startAutomation);
  $('#btn-clear-logs').addEventListener('click', () => { logs = []; renderConsole(); });

  // Queue table delegation
  $('#queue-body').addEventListener('input', (e) => {
    if (e.target.dataset.field !== undefined) {
      queue[parseInt(e.target.dataset.row)][e.target.dataset.field] = e.target.value;
      renderQueueCount();
    }
  });
  $('#queue-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const i = parseInt(btn.dataset.row);
    if (btn.dataset.action === 'delete') { queue.splice(i, 1); renderQueue(); }
    if (btn.dataset.action === 'duplicate') { queue.splice(i + 1, 0, { ...queue[i] }); renderQueue(); }
  });

  // Editor
  $('#btn-add-step').addEventListener('click', addStep);
  $('#btn-save-flow').addEventListener('click', saveFlow);
  $('#btn-capture').addEventListener('click', captureScreen);
  $('#btn-refresh-images').addEventListener('click', loadImages);

  $('#editor-steps').addEventListener('click', (e) => {
    const card = e.target.closest('[data-si]');
    if (!card) return;
    const i = parseInt(card.dataset.si);
    if (e.target.closest('[data-sa="toggle"]')) { expandedStep = expandedStep === i ? -1 : i; renderEditor(); }
    else if (e.target.closest('[data-sa="delete"]')) { flow.steps.splice(i, 1); expandedStep = -1; flowDirty = true; renderEditor(); }
    else if (e.target.closest('[data-sa="up"]') && i > 0) { [flow.steps[i-1], flow.steps[i]] = [flow.steps[i], flow.steps[i-1]]; expandedStep = i-1; flowDirty = true; renderEditor(); }
    else if (e.target.closest('[data-sa="down"]') && i < flow.steps.length-1) { [flow.steps[i], flow.steps[i+1]] = [flow.steps[i+1], flow.steps[i]]; expandedStep = i+1; flowDirty = true; renderEditor(); }
  });

  $('#editor-steps').addEventListener('input', (e) => {
    if (e.target.dataset.sp === undefined) return;
    const i = parseInt(e.target.dataset.si);
    const prop = e.target.dataset.sp;
    if (['timeout','threshold','duration','x','y'].includes(prop)) {
      flow.steps[i][prop] = parseFloat(e.target.value) || 0;
    } else {
      flow.steps[i][prop] = e.target.value;
    }
    flowDirty = true;
  });

  $('#editor-steps').addEventListener('change', (e) => {
    if (!e.target.dataset.sp) return;
    const i = parseInt(e.target.dataset.si);
    if (e.target.type === 'checkbox') {
      flow.steps[i][e.target.dataset.sp] = e.target.checked;
      flowDirty = true;
    }
    if (e.target.dataset.sp === 'action') {
      flow.steps[i].action = e.target.value;
      flowDirty = true;
      renderEditor();
    }
  });
}

// ── Platform ───────────────────────────────────────────
async function switchPlatform(p) {
  platform = p;
  $$('.platform-tab').forEach(btn => {
    const on = btn.dataset.platform === p;
    btn.className = `platform-tab px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${on ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`;
  });
  await loadFlow();
}

// ── Tabs ───────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  const set = (id, on) => {
    $(id).className = `content-tab px-4 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer ${on ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`;
  };
  set('#tab-queue', tab === 'queue');
  set('#tab-devices', tab === 'devices');
  set('#tab-editor', tab === 'editor');
  $('#panel-queue').classList.toggle('hidden', tab !== 'queue');
  $('#panel-devices').classList.toggle('hidden', tab !== 'devices');
  $('#panel-editor').classList.toggle('hidden', tab !== 'editor');
}

// ── Load Flow ──────────────────────────────────────────
async function loadFlow() {
  try {
    flow = await invoke('get_flow_details', { flowName: platform });
    expandedStep = -1;
    flowDirty = false;
    if (flow.batch && flow.batch_fields) {
      const empty = {};
      flow.batch_fields.forEach(f => empty[f.key] = '');
      queue = [{ ...empty }];
    }
    renderQueue();
    renderEditor();
    loadImages();
    switchTab('queue');
  } catch (err) {
    appendLog('[ERROR] ' + err);
  }
}

// ── Queue ──────────────────────────────────────────────
function addRow() {
  if (!flow?.batch_fields) return;
  const empty = {};
  flow.batch_fields.forEach(f => empty[f.key] = '');
  queue.push(empty);
  renderQueue();
}

function handleCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset so same file can be re-imported

  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    const rows = parseCSV(text);
    if (rows.length < 2) { appendLog('[SYSTEM] CSV is empty or has no data rows'); return; }

    const headers = rows[0];
    const fields = flow?.batch_fields || [];
    const fieldKeys = fields.map(f => f.key);

    // Map CSV columns to field keys (match by key or label, case-insensitive)
    const colMap = headers.map(h => {
      const clean = h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      // Try exact key match
      const exact = fieldKeys.find(k => k === clean);
      if (exact) return exact;
      // Try label match
      const byLabel = fields.find(f => f.label.toLowerCase().replace(/[^a-z0-9_]/g, '_') === clean);
      if (byLabel) return byLabel.key;
      // Try partial match
      const partial = fieldKeys.find(k => clean.includes(k) || k.includes(clean));
      return partial || null;
    });

    let imported = 0;
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      if (cells.every(c => !c.trim())) continue; // skip empty rows
      const row = {};
      fieldKeys.forEach(k => row[k] = '');
      colMap.forEach((key, ci) => {
        if (key && ci < cells.length) row[key] = cells[ci].trim();
      });
      queue.push(row);
      imported++;
    }

    renderQueue();
    appendLog(`[SYSTEM] Imported ${imported} rows from ${file.name}`);

    // Show unmapped columns as warning
    const unmapped = headers.filter((h, i) => !colMap[i]).map(h => h.trim());
    if (unmapped.length) {
      appendLog(`[SYSTEM] Skipped columns: ${unmapped.join(', ')}`);
    }
  };
  reader.readAsText(file);
}

function parseCSV(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',' || ch === '\t') {
        current.push(field);
        field = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        current.push(field);
        field = '';
        rows.push(current);
        current = [];
        if (ch === '\r') i++; // skip \n
      } else {
        field += ch;
      }
    }
  }
  // Last field/row
  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}

function renderQueue() {
  const fields = flow?.batch_fields || [];

  // Header
  $('#queue-header').innerHTML =
    '<th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>' +
    fields.map(f =>
      `<th class="px-2 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">${f.label}${f.required ? '<span class="text-red-400 ml-0.5">*</span>' : ''}</th>`
    ).join('') +
    '<th class="px-2 py-2 w-16"></th>';

  // Body
  const body = $('#queue-body');
  if (!queue.length) {
    body.innerHTML = `<tr><td colspan="${fields.length+2}" class="px-5 py-8 text-center text-slate-600 text-xs italic">No items. Click "Add Row" to start.</td></tr>`;
  } else {
    body.innerHTML = queue.map((item, i) =>
      `<tr class="border-b border-slate-800/50 hover:bg-slate-900/50 group">
        <td class="px-3 py-1.5 text-slate-600 font-mono text-[10px]">${i+1}</td>
        ${fields.map(f => `<td class="px-2 py-1"><input type="text" value="${esc(item[f.key]||'')}" placeholder="${f.placeholder||''}" data-row="${i}" data-field="${f.key}" class="w-full bg-slate-800/50 border border-slate-700/50 rounded px-2 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"/></td>`).join('')}
        <td class="px-2 py-1.5">
          <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button data-action="duplicate" data-row="${i}" title="Duplicate" class="p-1 text-slate-600 hover:text-slate-300 rounded hover:bg-slate-800 cursor-pointer">
              <svg class="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            </button>
            <button data-action="delete" data-row="${i}" title="Delete" class="p-1 text-slate-600 hover:text-red-400 rounded hover:bg-slate-800 cursor-pointer">
              <svg class="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </td>
      </tr>`
    ).join('');
  }
  renderQueueCount();
}

function renderQueueCount() {
  const fields = flow?.batch_fields || [];
  const req = fields.filter(f => f.required);
  const valid = queue.filter(item => req.every(f => (item[f.key] || '').trim())).length;
  const devCount = selectedDevices.size;
  $('#queue-count').textContent = `${queue.length} item${queue.length!==1?'s':''} · ${valid} ready · ${devCount} device${devCount!==1?'s':''}`;
  $('#btn-start').textContent = isRunning ? `⏳ Running on ${totalEngines} device(s)...` : `▶ Start (${valid} × ${devCount})`;
  $('#btn-start').disabled = isRunning;
}

// ── Editor ─────────────────────────────────────────────
function renderEditor() {
  if (!flow) return;
  $('#editor-flow-name').textContent = flow.name || platform;
  $('#editor-step-count').textContent = `${flow.steps.length} steps · ${flowDirty ? '⚠ unsaved' : 'saved'}`;

  $('#editor-steps').innerHTML = flow.steps.map((step, i) => {
    const open = expandedStep === i;
    const col = ACTION_COLORS[step.action] || 'bg-slate-500/15 text-slate-400';
    return `
    <div data-si="${i}" class="border border-slate-800 rounded-lg overflow-hidden ${open?'ring-1 ring-indigo-500/30':''} transition-all">
      <div class="flex items-center gap-2 px-3 py-2 bg-slate-900/70 cursor-pointer hover:bg-slate-800/50 transition-colors" data-sa="toggle">
        <span class="text-[10px] font-mono text-slate-600 w-5">${i+1}</span>
        <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${col}">${step.action}</span>
        <span class="text-xs text-slate-400 flex-1 truncate">${esc(step.description||'')}</span>
        ${step.optional?'<span class="text-[9px] text-amber-500/70 bg-amber-500/10 px-1.5 py-0.5 rounded">opt</span>':''}
        <div class="flex gap-0.5 ml-2">
          <button data-sa="up" class="p-0.5 text-slate-600 hover:text-slate-300 rounded ${i===0?'opacity-20':''} cursor-pointer"><svg class="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg></button>
          <button data-sa="down" class="p-0.5 text-slate-600 hover:text-slate-300 rounded ${i===flow.steps.length-1?'opacity-20':''} cursor-pointer"><svg class="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg></button>
          <button data-sa="delete" class="p-0.5 text-slate-600 hover:text-red-400 rounded ml-1 cursor-pointer"><svg class="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
        </div>
      </div>
      ${open ? stepFields(step, i) : ''}
    </div>`;
  }).join('');
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
        ${ACTIONS.map(a=>`<option value="${a}" ${a===step.action?'selected':''}>${a}</option>`).join('')}
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

function addStep() {
  if (!flow) return;
  flow.steps.push({ action: 'click', description: 'New step', target: '', timeout: 10 });
  expandedStep = flow.steps.length - 1;
  flowDirty = true;
  renderEditor();
  $('#panel-editor').scrollTop = $('#panel-editor').scrollHeight;
}

async function saveFlow() {
  if (!flow || !flowDirty) return;
  try {
    await invoke('save_flow', { flowName: platform, content: JSON.stringify(flow, null, 2) });
    flowDirty = false;
    renderEditor();
    appendLog('[SYSTEM] Flow saved');
  } catch (err) {
    appendLog('[ERROR] Save failed: ' + err);
  }
}

// ── Screenshot & Images ────────────────────────────────
async function captureScreen() {
  const deviceId = $('#device-select').value;
  if (!deviceId) { appendLog('[SYSTEM] Select a device first (click ↻ to scan)'); return; }
  appendLog('[SYSTEM] Capturing screen from ' + deviceId + '...');
  try {
    const filename = await invoke('capture_screen', { deviceId, flowName: platform });
    appendLog(`[SYSTEM] Screenshot saved: flows/${platform}/${filename}`);
    appendLog(`[SYSTEM] Open it in Preview → select button area → Cmd+K to crop → Save As "btn_name.png"`);
    await loadImages();
  } catch (err) {
    appendLog('[ERROR] Capture failed: ' + err);
  }
}

async function loadImages() {
  try {
    const images = await invoke('list_flow_images', { flowName: platform });
    renderImages(images);
  } catch (err) {
    console.error('loadImages:', err);
  }
}

function renderImages(images) {
  const el = $('#image-list');
  if (!images.length) {
    el.innerHTML = '<span class="text-slate-600 italic">No images yet — capture a screen first</span>';
    return;
  }
  el.innerHTML = images.map(name => {
    const isScreenshot = name.startsWith('screenshot_');
    return `<span class="px-1.5 py-0.5 rounded ${isScreenshot ? 'bg-sky-500/10 text-sky-400' : 'bg-emerald-500/10 text-emerald-400'}">${name}</span>`;
  }).join('');
}

// ── Devices ────────────────────────────────────────────
async function refreshDevices() {
  try {
    devices = await invoke('list_devices');
    renderDevices();
    if (devices.length) appendLog(`[SYSTEM] Found ${devices.length} device(s)`);
    else {
      appendLog('[SYSTEM] No devices found — connect via USB and enable debugging');
      if (typeof hpGuide !== 'undefined') hpGuide.show();
    }
  } catch (err) {
    appendLog('[ERROR] ' + err);
    devices = [];
    renderDevices();
  }
}

function renderDevices() {
  // Screenshot dropdown in editor
  const sel = $('#device-select');
  if (!devices.length) {
    sel.innerHTML = '<option value="">No device</option>';
  } else {
    sel.innerHTML = devices.map(([id, model]) =>
      `<option value="${esc(id)}">${esc(model)} (${esc(id.slice(-6))})</option>`
    ).join('');
  }

  // Devices tab list
  const list = $('#device-list');
  if (!devices.length) {
    list.innerHTML = '<div class="text-xs text-slate-600 italic py-8 text-center">No devices detected. Connect phones via USB, enable debugging, then click "Scan Devices".</div>';
    selectedDevices.clear();
  } else {
    // Auto-select all new devices
    devices.forEach(([id]) => selectedDevices.add(id));
    list.innerHTML = devices.map(([id, model]) => {
      const checked = selectedDevices.has(id) ? 'checked' : '';
      const short = id.length > 8 ? id.slice(-6) : id;
      return `<label class="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-lg p-3 cursor-pointer hover:border-slate-700 transition-colors">
        <input type="checkbox" value="${esc(id)}" ${checked} class="w-4 h-4 accent-indigo-500 rounded cursor-pointer shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium text-slate-200">${esc(model)}</div>
          <div class="text-[10px] text-slate-500 font-mono">${esc(id)}</div>
        </div>
        <span class="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">connected</span>
      </label>`;
    }).join('');
  }

  // Update subtitle
  $('#devices-subtitle').textContent = devices.length
    ? `${selectedDevices.size} of ${devices.length} selected for automation`
    : 'Select devices to run automation on';

  renderQueueCount();
}

function onDeviceToggle(e) {
  if (e.target.type !== 'checkbox') return;
  if (e.target.checked) selectedDevices.add(e.target.value);
  else selectedDevices.delete(e.target.value);
  $('#devices-subtitle').textContent = `${selectedDevices.size} of ${devices.length} selected for automation`;
  renderQueueCount();
}

// ── Start ──────────────────────────────────────────────
async function startAutomation() {
  const devIds = [...selectedDevices];
  if (!devIds.length) { appendLog('[SYSTEM] Select at least one device'); return; }

  const fields = flow?.batch_fields || [];
  const req = fields.filter(f => f.required);
  const validItems = queue.filter(item => req.every(f => (item[f.key]||'').trim()));
  if (!validItems.length) { appendLog('[SYSTEM] No valid items in queue'); return; }

  logs = [];
  isRunning = true;
  finishedCount = 0;
  totalEngines = devIds.length;
  setStatus('running');
  renderQueueCount();
  renderConsole();

  try {
    await invoke('start_automation', {
      deviceIds: devIds,
      flowName: platform,
      vars: JSON.stringify({ items: validItems }),
    });
  } catch (err) {
    appendLog('[ERROR] ' + err);
    isRunning = false;
    setStatus('error');
    renderQueueCount();
  }
}

// ── Console ────────────────────────────────────────────
function appendLog(line) {
  logs.push(line);
  renderConsole();
}

function renderConsole() {
  const el = $('#console-output');
  if (!logs.length) { el.innerHTML = '<p class="text-slate-600 italic">Waiting for engine output...</p>'; return; }

  el.innerHTML = logs.map((line, i) => {
    let c = 'text-emerald-400';
    if (line.includes('[ERROR]')) c = 'text-red-400';
    else if (line.includes('[SYSTEM]')) c = 'text-indigo-400';
    else if (line.includes('[MOCK]')) c = 'text-amber-400';
    else if ('═║╔╚'.split('').some(ch => line.includes(ch))) c = 'text-purple-400';
    else if (line.includes('===')) c = 'text-emerald-400 font-semibold';
    else if (line.includes('ADB:')) c = 'text-slate-500';
    return `<div class="py-px ${c}"><span class="text-slate-700 select-none mr-2">${String(i+1).padStart(3,' ')}</span>${esc(line)}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function setStatus(s) {
  const map = { idle: ['bg-slate-600','Idle'], running: ['bg-amber-500 animate-pulse','Running'], done: ['bg-emerald-500','Done'], error: ['bg-red-500','Error'] };
  const [cls, txt] = map[s] || map.idle;
  $('#status-dot').className = 'w-2 h-2 rounded-full ' + cls;
  $('#status-label').textContent = txt;
}

// ── Tauri listener ─────────────────────────────────────
function setupListener() {
  listen('engine-log', (e) => {
    appendLog(e.payload);
    // Track per-device completion
    if (e.payload.includes('finished successfully') || e.payload.includes('Batch complete')) {
      finishedCount++;
      if (finishedCount >= totalEngines) {
        isRunning = false; setStatus('done'); renderQueueCount();
      }
    } else if (e.payload.includes('exited with code') || e.payload.includes('Spawn failed')) {
      finishedCount++;
      if (finishedCount >= totalEngines) {
        isRunning = false; setStatus('error'); renderQueueCount();
      }
    }
  });
}
