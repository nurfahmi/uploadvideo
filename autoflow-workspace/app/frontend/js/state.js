// ── Shared State + Event Bus ──────────────────────────

const TEMPLATE_TESTS_KEY = 'auv-template-tests';
const DEVICE_LABELS_KEY = 'auv-device-labels';
const EXPANDED_DEVICE_KEY = 'auv-expanded-device';
const ACTIVE_TEMPLATES_KEY = 'auv-active-templates';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

const state = {
  // Navigation
  activeRoute: 'devices',
  sidebarCollapsed: false,
  consoleVisible: true,
  theme: 'dark',
  lang: 'id',

  // Platform & Flow
  platform: 'tiktok_upload',
  flow: null,
  flowDirty: false,
  expandedStep: -1,

  // Queue
  queue: [],
  selectedQueueItems: new Set(),

  // Devices
  devices: [],                   // [[id, model], ...]
  selectedDevices: new Set(),
  deviceHealth: {},              // { deviceId: { battery, connected, model, android_version, ... } }
  deviceLabels: loadJSON(DEVICE_LABELS_KEY, {}),  // { deviceId: 'My nickname' }
  activeDevice: null,            // currently focused device id (wizard context)
  expandedDevice: loadJSON(EXPANDED_DEVICE_KEY, null),  // accordion expansion in Perangkat page

  // Templates
  templates: [],                 // list of template names from backend
  templatesData: {},             // { name: fullTemplateJSON } — cached on demand
  selectedTemplate: null,        // current template for wizard/run flow
  templateTests: loadJSON(TEMPLATE_TESTS_KEY, {}),  // { deviceId: { templateName: TestRecord } }
  activeTemplates: loadJSON(ACTIVE_TEMPLATES_KEY, {}),  // { deviceId: { platform: templateName } } — user override of auto-pick

  // Automation
  isRunning: false,
  finishedCount: 0,
  totalEngines: 0,
  deviceProgress: {},   // { shortId: { step: 'Uploading 3/10', percent: 30, status: 'running' } }
  testMode: false,      // true while a template test is running

  // Console
  logs: [],

  // History
  history: [],

  // Settings / Config
  config: {
    onboarding_completed: false,
    selected_platforms: [],
    delay_min: 5,
    delay_max: 15,
    max_uploads_per_day: 50,
  },
};

// ── Event Bus ─────────────────────────────────────────

const _listeners = {};

export function on(key, fn) {
  if (!_listeners[key]) _listeners[key] = [];
  _listeners[key].push(fn);
  return () => {
    _listeners[key] = _listeners[key].filter(f => f !== fn);
  };
}

export function emit(key, value) {
  if (_listeners[key]) _listeners[key].forEach(fn => fn(value));
  if (key !== '*' && _listeners['*']) _listeners['*'].forEach(fn => fn(key, value));
}

export function set(key, value) {
  state[key] = value;
  emit(key, value);
}

export function get(key) {
  return state[key];
}

export function update(key, fn) {
  state[key] = fn(state[key]);
  emit(key, state[key]);
}

// ── Template Test Helpers ─────────────────────────────
// TestRecord = { status, lastTestAt, successCount, failCount, lastFailStep?, lastFailReason? }
// status: 'NEW' | 'TESTING' | 'TESTED_OK' | 'TESTED_FAIL' | 'NEEDS_RETEST'

export function getTestRecord(deviceId, templateName) {
  return state.templateTests?.[deviceId]?.[templateName] || null;
}

export function getTestStatus(deviceId, templateName) {
  return getTestRecord(deviceId, templateName)?.status || 'NEW';
}

function persistTests() {
  try { localStorage.setItem(TEMPLATE_TESTS_KEY, JSON.stringify(state.templateTests)); } catch {}
}

export function setTestRecord(deviceId, templateName, patch) {
  if (!state.templateTests[deviceId]) state.templateTests[deviceId] = {};
  const prev = state.templateTests[deviceId][templateName] || { successCount: 0, failCount: 0 };
  state.templateTests[deviceId][templateName] = { ...prev, ...patch };
  persistTests();
  emit('templateTests', state.templateTests);
}

export function markTestPass(deviceId, templateName) {
  const prev = getTestRecord(deviceId, templateName) || { successCount: 0, failCount: 0 };
  setTestRecord(deviceId, templateName, {
    status: 'TESTED_OK',
    lastTestAt: Date.now(),
    successCount: (prev.successCount || 0) + 1,
    lastFailStep: null,
    lastFailReason: null,
  });
}

export function markTestFail(deviceId, templateName, failStep, reason) {
  const prev = getTestRecord(deviceId, templateName) || { successCount: 0, failCount: 0 };
  setTestRecord(deviceId, templateName, {
    status: 'TESTED_FAIL',
    lastTestAt: Date.now(),
    failCount: (prev.failCount || 0) + 1,
    lastFailStep: failStep || null,
    lastFailReason: reason || null,
  });
}

export function markTestRunning(deviceId, templateName) {
  setTestRecord(deviceId, templateName, { status: 'TESTING' });
}

// Called when a template is edited — reset all device pairs to NEEDS_RETEST
export function resetTestsForTemplate(templateName) {
  let changed = false;
  for (const devId of Object.keys(state.templateTests)) {
    const rec = state.templateTests[devId][templateName];
    if (rec && rec.status === 'TESTED_OK') {
      state.templateTests[devId][templateName] = { ...rec, status: 'NEEDS_RETEST' };
      changed = true;
    }
  }
  if (changed) { persistTests(); emit('templateTests', state.templateTests); }
}

export function removeTestsForTemplate(templateName) {
  let changed = false;
  for (const devId of Object.keys(state.templateTests)) {
    if (state.templateTests[devId][templateName]) {
      delete state.templateTests[devId][templateName];
      changed = true;
    }
  }
  if (changed) { persistTests(); emit('templateTests', state.templateTests); }
}

export function renameTestsForTemplate(oldName, newName) {
  if (oldName === newName) return;
  let changed = false;
  for (const devId of Object.keys(state.templateTests)) {
    const rec = state.templateTests[devId][oldName];
    if (rec) {
      state.templateTests[devId][newName] = rec;
      delete state.templateTests[devId][oldName];
      changed = true;
    }
  }
  if (changed) { persistTests(); emit('templateTests', state.templateTests); }
}

// ── Device Label Helpers ──────────────────────────────

export function setDeviceLabel(deviceId, label) {
  if (label) state.deviceLabels[deviceId] = label;
  else delete state.deviceLabels[deviceId];
  try { localStorage.setItem(DEVICE_LABELS_KEY, JSON.stringify(state.deviceLabels)); } catch {}
  emit('deviceLabels', state.deviceLabels);
}

export function getDeviceLabel(deviceId, fallback) {
  return state.deviceLabels[deviceId] || fallback || deviceId;
}

// ── Active Template Overrides ─────────────────────────
// User override: force a specific template as the "active" one for a given
// (device, platform) pair. If unset, Device page auto-picks the best match.

function persistActiveTemplates() {
  try { localStorage.setItem(ACTIVE_TEMPLATES_KEY, JSON.stringify(state.activeTemplates)); } catch {}
}

export function getActiveTemplate(deviceId, platform) {
  return state.activeTemplates?.[deviceId]?.[platform] || null;
}

export function setActiveTemplate(deviceId, platform, templateName) {
  if (!state.activeTemplates[deviceId]) state.activeTemplates[deviceId] = {};
  if (templateName) {
    state.activeTemplates[deviceId][platform] = templateName;
  } else {
    delete state.activeTemplates[deviceId][platform];
  }
  persistActiveTemplates();
  emit('activeTemplates', state.activeTemplates);
}

export function setExpandedDevice(deviceId) {
  state.expandedDevice = deviceId;
  try { localStorage.setItem(EXPANDED_DEVICE_KEY, JSON.stringify(deviceId)); } catch {}
  emit('expandedDevice', deviceId);
}

export default state;
