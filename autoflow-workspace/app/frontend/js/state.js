// ── Shared State + Event Bus ──────────────────────────

const state = {
  // Navigation
  activeRoute: 'dashboard',
  sidebarCollapsed: false,
  consoleVisible: true,
  theme: 'dark',
  lang: 'en',

  // Platform & Flow
  platform: 'tiktok_upload',
  flow: null,
  flowDirty: false,
  expandedStep: -1,

  // Queue
  queue: [],
  selectedQueueItems: new Set(),

  // Devices
  devices: [],          // [[id, model], ...]
  selectedDevices: new Set(),
  deviceHealth: {},     // { deviceId: { battery, connected } }

  // Automation
  isRunning: false,
  finishedCount: 0,
  totalEngines: 0,
  deviceProgress: {},   // { shortId: { step: 'Uploading 3/10', percent: 30, status: 'running' } }

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

export default state;
