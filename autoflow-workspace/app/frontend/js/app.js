// ── AutoFlow App Entry Point ──────────────────────────

import state, { set, on, emit } from './state.js';
import { registerPage, navigate, initRouter } from './router.js';
import { initSidebar } from './components/sidebar.js';
import { initConsole, appendLog, renderConsole } from './components/console-panel.js';
import { initHeader } from './components/header.js';

// Pages
import * as dashboard from './pages/dashboard.js';
import * as queue from './pages/queue.js';
import * as devices from './pages/devices.js';
import * as editor from './pages/editor.js';
import * as history from './pages/history.js';
import * as settings from './pages/settings.js';
import * as monitor from './pages/monitor.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ── Init ──────────────────────────────────────────────

async function initApp(config) {
  // Apply config
  state.config = { ...state.config, ...config };
  state.platform = config?.selected_platforms?.[0] || 'tiktok_upload';

  // Register pages
  registerPage('dashboard', dashboard);
  registerPage('queue', queue);
  registerPage('devices', devices);
  registerPage('editor', editor);
  registerPage('history', history);
  registerPage('settings', settings);
  registerPage('monitor', monitor);

  // Init components
  initSidebar();
  initHeader();
  initConsole();

  // Init router (calls init on all pages + navigates to default)
  initRouter();

  // Setup engine listener
  setupEngineListener();

  // Load flow + devices
  await loadFlow();
  await devices.refreshDevices();

  // React to platform changes
  on('platform', async () => {
    await loadFlow();
  });

  // Handle start/stop automation events from sidebar
  on('start-automation', startAutomation);
  on('stop-automation', stopAutomation);
}

// ── Flow Loading ──────────────────────────────────────

async function loadFlow() {
  try {
    const flow = await invoke('get_flow_details', { flowName: state.platform });
    set('flow', flow);
    state.expandedStep = -1;
    state.flowDirty = false;

    // Don't auto-create empty row — user can click "+ Add" or import CSV
  } catch (err) {
    appendLog('[ERROR] ' + err);
  }
}

// ── Start Automation ──────────────────────────────────

async function startAutomation() {
  const devIds = [...state.selectedDevices];
  if (!devIds.length) { appendLog('[SYSTEM] Select at least one device'); return; }

  const fields = state.flow?.batch_fields || [];
  const req = fields.filter(f => f.required);
  const validItems = state.queue.filter(item => item._status !== 'success' && req.every(f => (item[f.key]||'').trim()));
  if (!validItems.length) { appendLog('[SYSTEM] No valid items in queue'); return; }

  // ── Safety: check max uploads per day ──────────
  const maxPerDay = state.config.max_uploads_per_day || 50;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = state.history.filter(h => h.timestamp?.startsWith(today)).length;
  const remaining = maxPerDay - todayCount;

  if (remaining <= 0) {
    appendLog(`[SYSTEM] Daily upload limit reached (${maxPerDay}/day). Change limit in Settings.`);
    return;
  }

  // Trim items if would exceed daily limit
  const itemsToRun = validItems.slice(0, remaining);
  if (itemsToRun.length < validItems.length) {
    appendLog(`[SYSTEM] Limiting to ${itemsToRun.length} items (daily limit: ${maxPerDay}, already done today: ${todayCount})`);
  }

  // ── Delay settings ─────────────────────────────
  const delayMin = state.config.delay_min || 5;
  const delayMax = state.config.delay_max || 15;
  const distribution = state.config.distribution || 'uniform';

  appendLog(`[SYSTEM] Delay: ${delayMin}-${delayMax}s (${distribution}) | Limit: ${todayCount + itemsToRun.length}/${maxPerDay} today`);

  state.logs = [];
  set('isRunning', true);
  state.finishedCount = 0;
  state.totalEngines = devIds.length;
  state.deviceProgress = {};
  renderConsole();
  navigate('monitor');

  try {
    await invoke('start_automation', {
      deviceIds: devIds,
      flowName: state.platform,
      vars: JSON.stringify({
        items: itemsToRun,
        delay_between_items: delayMin,
        delay_min: delayMin,
        delay_max: delayMax,
        delay_distribution: distribution,
      }),
    });
  } catch (err) {
    appendLog('[ERROR] ' + err);
    set('isRunning', false);
  }
}

// ── Stop Automation ───────────────────────────────────

async function stopAutomation() {
  try {
    await invoke('stop_automation');
    set('isRunning', false);
    appendLog('[SYSTEM] Automation stopped by user');
  } catch (err) {
    appendLog('[ERROR] Stop failed: ' + err);
  }
}

// ── Engine Log Listener ───────────────────────────────

function setupEngineListener() {
  listen('engine-stopped', () => {
    set('isRunning', false);
  });

  listen('engine-log', (e) => {
    appendLog(e.payload);
    const line = e.payload;

    // Parse progress from log lines: [DEVICE_SHORT] [ENGINE] message
    const match = line.match(/^\[(\w+)\]\s*(.*)/);
    if (match) {
      const [, shortId, msg] = match;
      if (shortId !== 'SYSTEM' && shortId !== 'ENGINE') {
        // Track current item
        const itemMatch = msg.match(/ITEM (\d+)\/(\d+)/);
        if (itemMatch) {
          const [, current, total] = itemMatch;
          const idx = parseInt(current) - 1;
          // Mark previous item as done
          if (idx > 0 && state.queue[idx - 1]) {
            state.queue[idx - 1]._status = 'success';
          }
          // Mark current item as uploading
          if (state.queue[idx]) {
            state.queue[idx]._status = 'uploading';
          }
          state.deviceProgress[shortId] = {
            step: `Item ${current}/${total}`,
            percent: Math.round((parseInt(current) / parseInt(total)) * 100),
            status: 'running',
          };
        }

        // Track current step
        const stepMatch = msg.match(/\[Step (\d+)\/(\d+)\]\s*(.*)/);
        if (stepMatch) {
          const [, stepNum, stepTotal, desc] = stepMatch;
          const videoName = state.queue.find(q => q._status === 'uploading')?.video_path?.split('/').pop()?.split('\\').pop() || '';
          state.deviceProgress[shortId] = {
            ...state.deviceProgress[shortId],
            step: `Step ${stepNum}/${stepTotal}`,
            stepDesc: desc,
            videoName,
            percent: Math.round((parseInt(stepNum) / parseInt(stepTotal)) * 100),
            status: 'running',
          };
        }

        // Track item completion
        if (msg.includes('Completed successfully')) {
          const doneMatch = msg.match(/ITEM (\d+)/);
          if (doneMatch) {
            const idx = parseInt(doneMatch[1]) - 1;
            if (state.queue[idx]) state.queue[idx]._status = 'success';
          }
        }
        if (msg.includes('failed steps')) {
          const failMatch = msg.match(/ITEM (\d+)/);
          if (failMatch) {
            const idx = parseInt(failMatch[1]) - 1;
            if (state.queue[idx]) state.queue[idx]._status = 'failed';
          }
        }

        // Emit state change so monitor re-renders
        emit('progress');
      }
    }

    // Track completion
    if (line.includes('finished successfully') || line.includes('Batch complete')) {
      // Mark remaining uploading items as success
      state.queue.forEach(q => { if (q._status === 'uploading') q._status = 'success'; });
      state.finishedCount++;
      if (state.finishedCount >= state.totalEngines) {
        set('isRunning', false);
        recordHistory('success');
      }
    } else if (line.includes('exited with code') || line.includes('Spawn failed')) {
      state.queue.forEach(q => { if (q._status === 'uploading') q._status = 'failed'; });
      state.finishedCount++;
      if (state.finishedCount >= state.totalEngines) {
        set('isRunning', false);
        recordHistory('failed');
      }
    }
  });
}

// ── History Recording ─────────────────────────────────

async function recordHistory(status) {
  const records = state.queue
    .filter(item => {
      const fields = state.flow?.batch_fields || [];
      const req = fields.filter(f => f.required);
      return req.every(f => (item[f.key]||'').trim());
    })
    .map(item => ({
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      platform: state.platform,
      video_name: (item.video_path || item.caption || 'Unknown').split('/').pop().split('\\').pop(),
      device_count: state.selectedDevices.size,
      status,
    }));

  try {
    await invoke('append_history', { records });
    // Reload history if on that page
    if (state.activeRoute === 'history' && history.render) history.render();
    // Update dashboard
    if (state.activeRoute === 'dashboard' && dashboard.render) dashboard.render();
  } catch (err) {
    console.error('Failed to save history:', err);
  }
}

// ── Bootstrap ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  let config = {};
  try { config = await invoke('get_config'); } catch (e) { console.warn('get_config:', e); }

  if (!config.onboarding_completed && typeof onboarding !== 'undefined') {
    onboarding.init(() => initApp(config));
    return;
  }
  initApp(config);
});
