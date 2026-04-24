// ── AutoFlow App Entry Point ──────────────────────────

import state, { set, on, emit } from './state.js';
import { registerPage, navigate, initRouter } from './router.js';
import { initSidebar } from './components/sidebar.js';
import { initConsole, appendLog, renderConsole } from './components/console-panel.js';
import { initHeader } from './components/header.js';
import { initTheme } from './theme.js';
import { initI18n } from './i18n.js';

// Pages
import * as dashboard from './pages/dashboard.js';
import * as queue from './pages/queue.js';
import * as devices from './pages/devices.js';
import * as editor from './pages/editor.js';
import * as history from './pages/history.js';
import * as settings from './pages/settings.js';
import * as monitor from './pages/monitor.js';
import * as recorder from './pages/recorder.js';

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
  registerPage('recorder', recorder);

  // Init components
  initSidebar();
  initHeader();
  initConsole();

  // Init router (calls init on all pages + navigates to default)
  initRouter();

  // Setup engine listener
  setupEngineListener();

  // Native menu bar events (macOS File/Edit/View/Help menu items)
  setupMenuBarListener();

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
  if (!devIds.length) { appendLog('[SYSTEM] Pilih minimal satu HP'); return; }

  const fields = state.flow?.batch_fields || [];
  const req = fields.filter(f => f.required);
  const validItems = state.queue.filter(item => item._status !== 'success' && req.every(f => (item[f.key]||'').trim()));
  if (!validItems.length) { appendLog('[SYSTEM] Tidak ada item valid di antrian'); return; }

  // ── Safety: check max uploads per day ──────────
  const maxPerDay = state.config.max_uploads_per_day || 50;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = state.history.filter(h => h.timestamp?.startsWith(today)).length;
  const remaining = maxPerDay - todayCount;

  if (remaining <= 0) {
    appendLog(`[SYSTEM] Limit harian tercapai (${maxPerDay}/hari). Ubah di Pengaturan.`);
    return;
  }

  const itemsToRun = validItems.slice(0, remaining);
  if (itemsToRun.length < validItems.length) {
    appendLog(`[SYSTEM] Dibatasi ${itemsToRun.length} item (limit: ${maxPerDay}, hari ini: ${todayCount})`);
  }

  // ── Auto-distribute items without _phone across selected devices ──
  const unassigned = itemsToRun.filter(it => !it._phone);
  if (unassigned.length) {
    unassigned.forEach((it, i) => { it._phone = devIds[i % devIds.length]; });
    appendLog(`[SYSTEM] ${unassigned.length} item tanpa HP di-distribusi otomatis`);
  }

  // ── Resolve template per item (HP's active override OR global) ──
  const { resolveTemplateForItem } = await import('./pages/queue.js');
  const groups = {};  // key: deviceId|templateName → { deviceId, templateName, items: [] }
  let missingTemplate = 0;
  for (const item of itemsToRun) {
    const phone = item._phone;
    const resolved = resolveTemplateForItem(phone);
    if (!resolved.name) { missingTemplate++; continue; }
    const key = `${phone}|${resolved.name}`;
    if (!groups[key]) groups[key] = { deviceId: phone, templateName: resolved.name, items: [] };
    groups[key].items.push(item);
  }
  if (missingTemplate > 0) {
    appendLog(`[SYSTEM] ${missingTemplate} item di-skip: tidak ada template aktif untuk HP-nya`);
  }
  const groupList = Object.values(groups);
  if (!groupList.length) {
    appendLog('[SYSTEM] Tidak ada group yang bisa dijalankan');
    return;
  }

  // ── Delay settings ─────────────────────────────
  const delayMin = state.config.delay_min || 5;
  const delayMax = state.config.delay_max || 15;
  const distribution = state.config.distribution || 'uniform';

  const hpMode = state.config.hp_mode || 'parallel';
  appendLog(`[SYSTEM] Jalanin ${itemsToRun.length} item di ${groupList.length} group (device × template) · mode=${hpMode} · delay ${delayMin}-${delayMax}s`);

  state.logs = [];
  set('isRunning', true);
  state.finishedCount = 0;
  state.totalEngines = groupList.length;
  state.deviceProgress = {};
  // Map each device's shortId → its batch items (same refs as queue), so the
  // engine-log parser can mark _status only for items belonging to that engine.
  state.engineItems = {};
  // Also remember which (device, template) pair each engine is running so that
  // the terminal handler can auto-update test status on clean finish.
  state.engineContext = {};
  for (const g of groupList) {
    const short = g.deviceId.slice(-6);
    state.engineItems[short] = g.items;
    state.engineContext[short] = { deviceId: g.deviceId, templateName: g.templateName };
  }
  renderConsole();
  navigate('monitor');

  // Helper: wait until this device's engine reports done/error (via progress event)
  const waitForGroupFinish = (shortId) => new Promise(resolve => {
    const check = () => {
      const dp = state.deviceProgress[shortId];
      if (!state.isRunning) return true;
      if (dp && (dp.status === 'done' || dp.status === 'error')) return true;
      return false;
    };
    if (check()) return resolve();
    const unsub = on('progress', () => {
      if (check()) { unsub(); resolve(); }
    });
  });

  const runOneGroup = async (g) => {
    const flowName = `_run_${g.templateName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${g.deviceId.slice(-6)}`;
    try {
      const conv = await invoke('recorder_convert_template_to_flow', {
        templateName: g.templateName,
        flowName,
        deviceId: g.deviceId,
      });
      appendLog(`[SYSTEM] ${g.deviceId.slice(-6)} → template "${g.templateName}" (${conv.step_count} langkah) · ${g.items.length} item`);
      const batchFieldKeys = Array.isArray(conv.batch_fields) ? conv.batch_fields : [];
      if (batchFieldKeys.length) {
        try {
          const { healItemKeys } = await import('./pages/queue.js');
          if (healItemKeys) g.items.forEach(it => healItemKeys(it, batchFieldKeys));
        } catch {}
      }
      g.items.forEach((it, i) => {
        const emptyKeys = batchFieldKeys.filter(k => it[k] == null || it[k] === '');
        if (emptyKeys.length) {
          appendLog(`[SYSTEM]   item ${i + 1}: kosong → ${emptyKeys.join(', ')}`);
        }
      });
      await invoke('start_automation', {
        deviceIds: [g.deviceId],
        flowName: conv.flow_name || flowName,
        vars: JSON.stringify({
          items: g.items,
          delay_between_items: delayMin,
          delay_min: delayMin,
          delay_max: delayMax,
          delay_distribution: distribution,
        }),
      });
    } catch (err) {
      appendLog(`[ERROR] Group ${g.deviceId.slice(-6)}/${g.templateName}: ${err}`);
      state.finishedCount++;
    }
  };

  if (hpMode === 'serial') {
    // Bergiliran: tunggu tiap group selesai sebelum mulai berikutnya
    for (let i = 0; i < groupList.length; i++) {
      if (!state.isRunning) break;
      const g = groupList[i];
      appendLog(`[SYSTEM] Group ${i + 1}/${groupList.length} mulai (bergiliran)…`);
      await runOneGroup(g);
      await waitForGroupFinish(g.deviceId.slice(-6));
      if (!state.isRunning) break;
    }
  } else {
    // Paralel: spawn semua bareng
    for (const g of groupList) await runOneGroup(g);
  }

  if (state.finishedCount >= state.totalEngines) {
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

// Wire native menu bar (File/Edit/View/Help) → in-app navigation
function setupMenuBarListener() {
  listen('menu-event', (ev) => {
    const id = ev.payload;
    switch (id) {
      case 'menu_settings':
      case 'menu_view_settings':     navigate('settings'); break;
      case 'menu_view_devices':      navigate('devices'); break;
      case 'menu_view_queue':        navigate('queue'); break;
      case 'menu_new_template':
        navigate('recorder');
        setTimeout(() => document.getElementById('tpl-btn-new')?.click(), 150);
        break;
      case 'menu_import_csv':
        navigate('queue');
        setTimeout(() => document.querySelector('[data-action="csv-menu"]')?.click(), 150);
        break;
      case 'menu_export_csv':
        navigate('queue');
        setTimeout(() => {
          const btn = document.querySelector('[data-action="csv-menu"]');
          btn?.click();
          setTimeout(() => document.querySelector('[data-csv-action="download"]')?.click(), 120);
        }, 150);
        break;
      case 'menu_toggle_console':
        import('./components/console-panel.js').then(m => m.toggleConsole());
        break;
      case 'menu_reload':
        location.reload();
        break;
      case 'menu_help_guide':
        if (window.hpGuide) window.hpGuide.show();
        break;
      case 'menu_help_github':
        window.__TAURI__?.opener?.openUrl?.('https://github.com/').catch(() => {});
        break;
      default:
        break;
    }
  });
}

// Test-mode progress tracking (used by runner.js handleTestCompletion)
let testFailStep = null;
let testFailReason = null;

// Debounced save-queue so rapid _status flips during a run don't hammer disk
let _queueSaveTimer = null;
function persistQueueAsync() {
  if (_queueSaveTimer) clearTimeout(_queueSaveTimer);
  _queueSaveTimer = setTimeout(async () => {
    try { await invoke('save_queue', { items: state.queue }); } catch {}
  }, 400);
}

function setupEngineListener() {
  listen('engine-stopped', () => {
    set('isRunning', false);
  });

  listen('engine-log', (e) => {
    appendLog(e.payload);
    const line = e.payload;

    // ── Test-mode: capture last-seen step & first fatal message ───
    if (state.testMode) {
      const stepMatch = line.match(/\[Step (\d+)\/(\d+)\]\s*(.*)/);
      if (stepMatch) {
        testFailStep = `${stepMatch[1]}/${stepMatch[2]}`;
      }
      const fatalMatch = line.match(/FATAL:\s*(.+)/);
      if (fatalMatch && !testFailReason) testFailReason = fatalMatch[1].trim();
      const errMatch = line.match(/->\s*ERROR:\s*(.+)/);
      if (errMatch && !testFailReason) testFailReason = errMatch[1].trim();
    }

    // Parse progress from log lines: [DEVICE_SHORT] [ENGINE] message
    const match = line.match(/^\[(\w+)\]\s*(.*)/);
    let shortId = null;
    if (match) {
      shortId = match[1];
      const msg = match[2];
      if (shortId !== 'SYSTEM' && shortId !== 'ENGINE') {
        // Resolve item refs for THIS device (populated at spawn time in startAutomation)
        const devItems = state.engineItems?.[shortId] || state.queue;

        // Track current item within this device's batch
        const itemMatch = msg.match(/ITEM (\d+)\/(\d+)/);
        if (itemMatch) {
          const [, current, total] = itemMatch;
          const idx = parseInt(current) - 1;
          // Mark previous item as success (only for THIS device's batch)
          if (idx > 0 && devItems[idx - 1]) devItems[idx - 1]._status = 'success';
          if (devItems[idx]) devItems[idx]._status = 'uploading';
          state.deviceProgress[shortId] = {
            ...(state.deviceProgress[shortId] || {}),
            step: `Item ${current}/${total}`,
            percent: Math.round((parseInt(current) / parseInt(total)) * 100),
            status: 'running',
          };
          persistQueueAsync();
        }

        // Track current step
        const stepMatch = msg.match(/\[Step (\d+)\/(\d+)\]\s*(.*)/);
        if (stepMatch) {
          const [, stepNum, stepTotal, desc] = stepMatch;
          // Video name: find uploading item within THIS device's batch only
          const uploading = devItems.find(it => it._status === 'uploading');
          const videoName = uploading?.video_path?.split('/').pop()?.split('\\').pop() || '';
          state.deviceProgress[shortId] = {
            ...(state.deviceProgress[shortId] || {}),
            step: `Step ${stepNum}/${stepTotal}`,
            stepDesc: desc,
            videoName,
            percent: Math.round((parseInt(stepNum) / parseInt(stepTotal)) * 100),
            status: 'running',
          };
        }

        // Track item completion (scoped to this device's batch)
        if (msg.includes('Completed successfully')) {
          const doneMatch = msg.match(/ITEM (\d+)/);
          if (doneMatch) {
            const idx = parseInt(doneMatch[1]) - 1;
            if (devItems[idx]) devItems[idx]._status = 'success';
            persistQueueAsync();
          }
        }
        if (msg.includes('failed steps')) {
          const failMatch = msg.match(/ITEM (\d+)/);
          if (failMatch) {
            const idx = parseInt(failMatch[1]) - 1;
            if (devItems[idx]) devItems[idx]._status = 'failed';
            persistQueueAsync();
          }
        }

        emit('progress');
      }
    }

    // ── Terminal detection (scoped to shortId so only THIS device's items flip) ─
    let terminalStatus = null;
    if (line.includes('finished successfully') || line.includes('Batch complete')) {
      const devItems = shortId ? (state.engineItems?.[shortId] || state.queue) : state.queue;
      devItems.forEach(q => { if (q._status === 'uploading') q._status = 'success'; });
      if (shortId) {
        state.deviceProgress[shortId] = {
          ...(state.deviceProgress[shortId] || {}),
          step: 'Selesai',
          percent: 100,
          status: 'done',
        };
        // Auto-mark test status OK: a clean batch run effectively proves this
        // (device, template) pair works, so Device page no longer says "Belum diuji".
        const ctx = state.engineContext?.[shortId];
        if (ctx && !state.testMode) {
          import('./state.js').then(m => m.markTestPass(ctx.deviceId, ctx.templateName));
        }
      }
      state.finishedCount++;
      terminalStatus = 'success';
      persistQueueAsync();
      emit('progress');
    } else if (line.includes('exited with code') || line.includes('Spawn failed')) {
      const isUserStop = line.includes('signal: 15') || line.includes('SIGTERM');
      const devItems = shortId ? (state.engineItems?.[shortId] || state.queue) : state.queue;
      devItems.forEach(q => { if (q._status === 'uploading') q._status = 'failed'; });
      if (shortId) {
        state.deviceProgress[shortId] = {
          ...(state.deviceProgress[shortId] || {}),
          step: isUserStop ? 'Dihentikan' : 'Gagal',
          status: 'error',
        };
        // Only record fail status when it's a genuine engine failure, not a
        // user-initiated stop — otherwise the template health metric skews.
        if (!isUserStop && !state.testMode) {
          const ctx = state.engineContext?.[shortId];
          if (ctx) import('./state.js').then(m => m.markTestFail(ctx.deviceId, ctx.templateName, null, 'Batch run gagal'));
        }
      }
      state.finishedCount++;
      terminalStatus = 'failed';
      persistQueueAsync();
      emit('progress');
    }

    if (terminalStatus && state.finishedCount >= state.totalEngines) {
      set('isRunning', false);
      if (state.testMode) {
        // Determine test pass/fail from queue status (more reliable than log parsing)
        const item = state.queue[0];
        const passed = item && item._status === 'success' && terminalStatus === 'success';
        import('./runner.js').then(m => {
          m.handleTestCompletion({
            success: passed,
            failStep: passed ? null : testFailStep,
            failReason: passed ? null : testFailReason,
          });
          testFailStep = null;
          testFailReason = null;
        });
      } else {
        recordHistory(terminalStatus);
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
  initTheme();
  initI18n();
  let config = {};
  try { config = await invoke('get_config'); } catch (e) { console.warn('get_config:', e); }

  if (!config.onboarding_completed && typeof onboarding !== 'undefined') {
    onboarding.init(() => initApp(config));
    return;
  }
  initApp(config);
});
