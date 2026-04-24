// ── Test / Run Orchestrator ────────────────────────────
// Orchestrates template test runs: converts template → flow for target device,
// spawns engine with a single-item batch, and flags state.testMode so the
// completion handler in app.js updates templateTests.

import state, { set, emit, markTestRunning, markTestPass, markTestFail, setActiveTemplate } from './state.js';
import { appendLog } from './components/console-panel.js';
import { navigate } from './router.js';
import { toast } from './components/toast.js';
import { detectPlatformFromTemplate } from './utils/templateMatch.js';

const { invoke } = window.__TAURI__.core;

function shortName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
}

// Build the 1-item payload for a test run. We pass values for common batch
// fields (video_path, caption, url/affiliate_link). Converter-generated flows
// ignore fields the template doesn't use, so over-specifying is safe.
function buildTestItem({ videoPath, caption, url }) {
  return {
    video_path: videoPath || '',
    caption: caption || 'Test caption from AUV',
    hashtags: '',
    affiliate_link: url || '',
    url: url || '',
    link: url || '',
  };
}

export async function runTemplateTest({ deviceId, templateName, videoPath, caption, url }) {
  if (!deviceId || !templateName) {
    toast.error('Device atau template tidak valid');
    return;
  }

  markTestRunning(deviceId, templateName);
  set('testMode', true);
  set('testContext', { deviceId, templateName, startedAt: Date.now() });

  const flowName = `_test_${shortName(templateName)}_${Date.now().toString(36)}`;

  let convertResult;
  try {
    appendLog(`[TEST] Converting "${templateName}" → ${flowName} for ${deviceId.slice(-6)}...`);
    convertResult = await invoke('recorder_convert_template_to_flow', {
      templateName,
      flowName,
      deviceId,
    });
    appendLog(`[TEST] Flow ready: ${convertResult.step_count} langkah`);
  } catch (e) {
    appendLog(`[TEST] Konversi gagal: ${e}`);
    toast.error('Gagal menyiapkan flow untuk test', { title: 'Test dibatalkan' });
    set('testMode', false);
    set('testContext', null);
    return;
  }

  // Set up state as if user pressed Run in Queue with 1 item, 1 device
  const item = buildTestItem({ videoPath, caption, url });
  state.queue = [item];
  state.selectedDevices = new Set([deviceId]);
  set('platform', flowName);   // triggers loadFlow in app.js
  set('isRunning', true);
  state.finishedCount = 0;
  state.totalEngines = 1;
  state.deviceProgress = {};

  navigate('monitor');

  try {
    await invoke('start_automation', {
      deviceIds: [deviceId],
      flowName,
      vars: JSON.stringify({
        items: [item],
        delay_between_items: 0,
        delay_min: 0,
        delay_max: 1,
        delay_distribution: 'uniform',
      }),
    });
    appendLog(`[TEST] Engine started for ${deviceId.slice(-6)}`);
  } catch (e) {
    appendLog(`[TEST] Spawn failed: ${e}`);
    toast.error('Engine gagal dijalankan: ' + e, { title: 'Test gagal' });
    set('isRunning', false);
    set('testMode', false);
    set('testContext', null);
  }
}

// Called by app.js engine-log listener when a test run reaches terminal state.
// Decides pass/fail, updates state.templateTests, shows toast.
export function handleTestCompletion({ success, failStep, failReason }) {
  const ctx = state.testContext;
  if (!ctx) return;
  const { deviceId, templateName } = ctx;

  if (success) {
    markTestPass(deviceId, templateName);
    // Auto-promote: a just-passed test signals user's intent to use this
    // template. Three things happen together so batch run is 1-click away:
    //   1. Mark as active for (device, platform) — queue HP column updates
    //   2. Set as global selectedTemplate — queue guard clears, Jobs accessible
    //   3. Add this device to selectedDevices — batch defaults include it
    const tpl = state.templatesData?.[templateName];
    const platform = tpl ? detectPlatformFromTemplate(tpl) : 'other';
    setActiveTemplate(deviceId, platform, templateName);
    set('selectedTemplate', templateName);
    state.selectedDevices.add(deviceId);
    toast.success(`Aktif untuk HP ini (${platform}). Tinggal ke Job.`, {
      title: 'Test berhasil',
      action: {
        label: 'Ke Job →',
        onClick: () => navigate('queue'),
      },
    });
  } else {
    markTestFail(deviceId, templateName, failStep, failReason);
    toast.error(
      failReason
        ? `Gagal di step ${failStep || '?'}: ${failReason}`
        : 'Test tidak selesai. Cek konsol untuk detail.',
      { title: 'Test gagal', duration: 15000 }
    );
  }

  set('testMode', false);
  set('testContext', null);
}
