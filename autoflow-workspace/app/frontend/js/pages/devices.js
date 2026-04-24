// ── Devices Page (IA v2 — master-detail accordion) ──

import { $, esc } from '../utils/helpers.js';
import state, {
  set, on, emit,
  getDeviceLabel, setDeviceLabel, setExpandedDevice,
  getTestStatus, getTestRecord, removeTestsForTemplate, renameTestsForTemplate,
  getActiveTemplate, setActiveTemplate, markTestPass,
} from '../state.js';
import { toast } from '../components/toast.js';
import { showInputDialog } from '../components/input-dialog.js';
import { appendLog } from '../components/console-panel.js';
import { navigate } from '../router.js';
import { scoreTemplate, labelForScore, chipClassForScore, platformIconTile, detectPlatformFromTemplate } from '../utils/templateMatch.js';
import { t } from '../i18n.js';

const { invoke } = window.__TAURI__.core;

export function init() {
  const panel = $('#page-devices');
  panel.addEventListener('click', onClick);
  on('devices', render);
  on('deviceHealth', render);
  on('deviceLabels', render);
  on('expandedDevice', render);
  on('templates', render);
  on('templatesData', render);
  on('templateTests', render);
  on('activeTemplates', render);
  on('lang', render);
  on('template-modified', () => { loadAllTemplates(); });
}

// ── Data loading ───────────────────────────────────

export async function refreshDevices() {
  try {
    const devices = await invoke('list_devices');
    set('devices', devices);
    if (devices.length) {
      devices.forEach(([id]) => state.selectedDevices.add(id));
      appendLog(`[SYSTEM] ${devices.length} HP ditemukan`);
      for (const [id] of devices) {
        try {
          const health = await invoke('check_device_health', { deviceId: id });
          state.deviceHealth[id] = health;
        } catch (e) {}
      }
      emit('deviceHealth', state.deviceHealth);
      // Auto-expand first device if none is expanded
      if (!state.expandedDevice && devices.length > 0) {
        setExpandedDevice(devices[0][0]);
      }
      // Auto-pick active device for wizard context
      if (!state.activeDevice) {
        set('activeDevice', devices[0][0]);
      }
    } else {
      appendLog('[SYSTEM] Tidak ada HP terhubung');
    }
    // Kick off template load (cached per session)
    loadAllTemplates();
  } catch (err) {
    appendLog('[ERROR] ' + err);
    set('devices', []);
  }
}

async function loadAllTemplates() {
  try {
    const names = await invoke('recorder_list_templates');
    set('templates', names);
    const data = { ...state.templatesData };
    for (const name of names) {
      if (!data[name]) {
        try { data[name] = await invoke('recorder_get_template', { name }); }
        catch (e) { /* skip broken */ }
      }
    }
    set('templatesData', data);
  } catch (e) {
    appendLog('[ERROR] Gagal memuat template: ' + e);
  }
}

// ── Event handling ─────────────────────────────────

function onClick(e) {
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    const action = actionBtn.dataset.action;
    const did = actionBtn.dataset.deviceId;
    const tpl = actionBtn.dataset.template;
    e.stopPropagation();
    switch (action) {
      case 'scan': return refreshDevices();
      case 'guide': return (window.hpGuide ? window.hpGuide.show() : appendLog('[SYSTEM] Setup guide not available'));
      case 'test-conn': return testDevice(did);
      case 'rename': return renameDevice(did);
      case 'record-new': return openRecorderFor(did);
      case 'test-template': return openTestDialog(did, tpl);
      case 'run-template': return runTemplate(did, tpl);
      case 'edit-template': return editTemplate(tpl);
      case 'rename-template': return renameTemplate(tpl);
      case 'delete-template': return deleteTemplate(tpl);
      case 'template-menu': return openTemplateMenu(actionBtn, tpl, actionBtn.dataset.deviceId);
      case 'switch-template': return openSwitchTemplateDialog(did, actionBtn.dataset.platform);
      case 'mark-tested': {
        const devId = actionBtn.dataset.deviceId;
        markTestPass(devId, tpl);
        toast.success(t('dev.status_updated_body', { name: tpl }), { title: t('dev.status_updated_title') });
        return;
      }
    }
    return;
  }

  const header = e.target.closest('[data-expand]');
  if (header) {
    const id = header.dataset.expand;
    setExpandedDevice(state.expandedDevice === id ? null : id);
    set('activeDevice', id);
  }
}

async function testDevice(deviceId) {
  const btn = document.querySelector(`[data-action="test-conn"][data-device-id="${deviceId}"]`);
  const originalHtml = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="margin-right:6px;animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 11-6.2-8.55" stroke-linecap="round"/></svg>${t('dev.checking')}`;
  }
  try {
    const health = await invoke('check_device_health', { deviceId });
    state.deviceHealth[deviceId] = health;
    emit('deviceHealth', state.deviceHealth);
    const short = deviceId.slice(-6);
    if (health.connected) {
      toast.success(t('dev.conn_ok_body', { battery: health.battery ?? '?', net: health.wifi_ssid || health.network_type || 'offline' }), { title: t('dev.conn_ok_title', { short }) });
    } else {
      toast.warn(t('dev.conn_disconnected_body'), { title: t('dev.conn_disconnected_title', { short }) });
    }
    appendLog(`[SYSTEM] ${short}: ${health.connected ? 'Terhubung' : 'Terputus'}, Baterai: ${health.battery ?? 'N/A'}%`);
  } catch (err) {
    toast.error(String(err), { title: t('dev.conn_fail_title') });
    appendLog(`[ERROR] Tes gagal: ${err}`);
  } finally {
    // Re-render will replace the button anyway via deviceHealth listener; restore
    // is only needed if render didn't fire (e.g. error before state update).
    if (btn && document.body.contains(btn) && btn.innerHTML.includes(t('dev.checking'))) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

async function renameDevice(deviceId) {
  const current = state.deviceLabels[deviceId] || '';
  const next = await showInputDialog({
    title: t('dev.rename_title'),
    message: t('dev.rename_hint'),
    defaultValue: current,
    placeholder: t('dev.rename_placeholder'),
  });
  if (next === null) return;
  setDeviceLabel(deviceId, next.trim());
}

async function openRecorderFor(deviceId) {
  set('activeDevice', deviceId);
  navigate('recorder');
  // Small delay so recorder render() has run + DOM is ready
  setTimeout(async () => {
    try {
      const mod = await import('./recorder.js');
      if (mod.autoAttach) await mod.autoAttach(deviceId);
    } catch (e) { appendLog('[ERROR] Auto-attach failed: ' + e); }
  }, 120);
}

async function openTestDialog(deviceId, templateName) {
  const tpl = state.templatesData?.[templateName];
  const { openTestDialog: showDialog } = await import('../components/test-dialog.js');
  const result = await showDialog({ deviceId, templateName, template: tpl });
  if (!result) return;  // cancelled
  const { runTemplateTest } = await import('../runner.js');
  await runTemplateTest({
    deviceId,
    templateName,
    videoPath: result.videoPath,
    caption: result.caption,
    url: result.url,
  });
}

async function runTemplate(deviceId, templateName) {
  const test = getTestRecord(deviceId, templateName);
  if (!test || test.status !== 'TESTED_OK') {
    if (!confirm(t('dev.run_untested_confirm'))) return;
  }
  try {
    const flowName = `_run_${templateName}`;
    await invoke('recorder_convert_template_to_flow', {
      templateName,
      flowName,
      deviceId,
    });
    set('selectedTemplate', templateName);
    set('platform', flowName);
    appendLog(`[SYSTEM] Template "${templateName}" dikonversi → ${flowName}`);
    navigate('queue');
  } catch (e) {
    appendLog(`[ERROR] Konversi gagal: ${e}`);
    alert(t('dev.run_convert_fail') + e);
  }
}

function editTemplate(templateName) {
  closeAnyTemplateMenu();
  set('selectedTemplate', templateName);
  navigate('recorder');
  // Delay so recorder page renders before we load the template into its session
  setTimeout(async () => {
    try {
      const mod = await import('./recorder.js');
      if (mod.loadTemplateIntoSession) {
        await mod.loadTemplateIntoSession(templateName);
      }
    } catch (e) { appendLog('[ERROR] Edit step: ' + e); }
  }, 120);
}

function openSwitchTemplateDialog(deviceId, platform) {
  const health = state.deviceHealth[deviceId] || {};
  const deviceLabel = getDeviceLabel(deviceId, deviceId.slice(-6));
  // Collect all templates of this platform, ranked like the section render
  const candidates = (state.templates || [])
    .map(name => {
      const tpl = state.templatesData[name];
      const detected = tpl ? detectPlatformFromTemplate(tpl) : 'other';
      if (detected !== platform) return null;
      const score = tpl ? scoreTemplate(tpl, health) : -1;
      const test = getTestRecord(deviceId, name);
      return { name, tpl, score, test };
    })
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));

  const currentActive = getActiveTemplate(deviceId, platform);
  const autoPickName = candidates[0]?.name;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
  overlay.innerHTML = `
    <div class="ui-card" style="width:440px;max-width:92vw;padding:0;max-height:80vh;display:flex;flex-direction:column">
      <div style="padding:var(--sp-4);border-bottom:1px solid var(--c-bg-2)">
        <h3 class="t-lg t-strong" style="margin:0 0 var(--sp-1)">${esc(t('dev.switch_title', { platform }))}</h3>
        <p class="t-xs t-muted" style="margin:0">${esc(t('dev.switch_subtitle', { device: deviceLabel }))}</p>
      </div>
      <div style="flex:1;overflow-y:auto;padding:var(--sp-2)">
        <button class="sw-item" data-name="__auto__" style="width:100%;display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3);background:none;border:none;border-radius:var(--r-md);cursor:pointer;text-align:left;font-family:inherit;${!currentActive ? 'background:var(--c-accent-a08);border:1px solid var(--c-accent-a20)' : ''}">
          <div style="width:32px;height:32px;border-radius:var(--r-md);background:var(--c-accent-a12);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="16" height="16" fill="none" stroke="var(--c-accent)" stroke-width="2" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <div style="flex:1">
            <div class="t-sm t-strong">${t('dev.switch_auto')}</div>
            <div class="t-xs t-muted" style="margin-top:2px">${esc(t('dev.switch_auto_hint', { name: autoPickName || '—' }))}</div>
          </div>
          ${!currentActive ? `<span class="t-xs" style="color:var(--c-accent)">${t('dev.switch_active')}</span>` : ''}
        </button>
        <div style="height:1px;background:var(--c-bg-2);margin:var(--sp-1) var(--sp-2)"></div>
        ${candidates.map(c => {
          const isActive = currentActive === c.name;
          const matchLabel = labelForScore(c.score);
          const matchClass = chipClassForScore(c.score);
          const testStatus = c.test?.status || 'NEW';
          const testLabel = testStatus === 'TESTED_OK' ? `✓ ${t('dev.already_tested', { n: c.test?.successCount || 1 })}`
                          : testStatus === 'TESTED_FAIL' ? `✗ ${t('dev.last_failed')}`
                          : testStatus === 'NEEDS_RETEST' ? `⚠ ${t('dev.retest')}`
                          : t('dev.not_tested');
          return `
            <button class="sw-item" data-name="${esc(c.name)}" style="width:100%;display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3);background:none;border:none;border-radius:var(--r-md);cursor:pointer;text-align:left;font-family:inherit;${isActive ? 'background:var(--c-accent-a08);border:1px solid var(--c-accent-a20)' : ''}">
              ${platformIconTile(c.tpl || platform, 32)}
              <div style="flex:1;min-width:0">
                <div class="t-sm t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>
                <div style="display:flex;gap:var(--sp-2);margin-top:3px;flex-wrap:wrap">
                  <span class="ui-chip ${matchClass} t-xs" style="padding:2px var(--sp-2)">${matchLabel}</span>
                  <span class="t-xs t-muted">${testLabel}</span>
                </div>
              </div>
              ${isActive ? `<span class="t-xs" style="color:var(--c-accent)">${t('dev.switch_active')}</span>` : ''}
            </button>`;
        }).join('')}
      </div>
      <div style="padding:var(--sp-3);border-top:1px solid var(--c-bg-2);display:flex;justify-content:flex-end">
        <button id="sw-cancel" class="btn btn-ghost btn-sm">${t('dev.switch_close')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#sw-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('.sw-item').forEach(btn => {
    btn.addEventListener('mouseenter', () => { if (!btn.style.background.includes('accent')) btn.style.background = 'var(--c-bg-2)'; });
    btn.addEventListener('mouseleave', () => {
      const name = btn.dataset.name;
      const isActive = name === '__auto__' ? !currentActive : currentActive === name;
      btn.style.background = isActive ? 'var(--c-accent-a08)' : 'none';
    });
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      setActiveTemplate(deviceId, platform, name === '__auto__' ? null : name);
      toast.success(name === '__auto__' ? t('dev.switch_auto_done') : t('dev.switch_manual_done', { name }), {
        title: t('dev.switch_reverted_title', { platform, device: deviceLabel }),
      });
      close();
    });
  });
}

async function renameTemplate(templateName) {
  closeAnyTemplateMenu();
  const newName = await showInputDialog({
    title: t('dev.rename_dialog_title'),
    message: t('dev.rename_dialog_from', { name: templateName }),
    defaultValue: templateName,
    placeholder: t('dev.rename_placeholder2'),
  });
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === templateName) return;
  try {
    await invoke('recorder_rename_template', { oldName: templateName, newName: trimmed });
    // Migrate test records, template cache, and selection
    renameTestsForTemplate(templateName, trimmed);
    const safeName = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (state.templatesData[templateName]) {
      state.templatesData[safeName] = { ...state.templatesData[templateName], name: safeName };
      delete state.templatesData[templateName];
    }
    set('templates', state.templates.map(n => n === templateName ? safeName : n));
    emit('templatesData', state.templatesData);
    if (state.selectedTemplate === templateName) set('selectedTemplate', safeName);
    toast.success(t('dev.rename_done', { name: safeName }));
  } catch (e) {
    toast.error(t('dev.rename_fail') + e);
  }
}

async function deleteTemplate(templateName) {
  closeAnyTemplateMenu();
  if (!confirm(t('dev.delete_confirm', { name: templateName }))) return;
  try {
    await invoke('recorder_delete_template', { name: templateName });
    removeTestsForTemplate(templateName);
    // Remove from local cache
    delete state.templatesData[templateName];
    set('templates', state.templates.filter(n => n !== templateName));
    emit('templatesData', state.templatesData);
    toast.success(t('dev.delete_done', { name: templateName }));
  } catch (e) {
    toast.error(t('dev.delete_fail') + e);
  }
}

function closeAnyTemplateMenu() {
  document.querySelectorAll('.tpl-row-menu').forEach(m => m.remove());
}

function openTemplateMenu(anchorBtn, templateName, deviceId) {
  closeAnyTemplateMenu();
  const rect = anchorBtn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'tpl-row-menu ui-card';
  menu.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 4}px;
    left: ${rect.right - 180}px;
    width: 180px;
    padding: var(--sp-1);
    z-index: 5000;
    box-shadow: var(--elev-2);
  `;
  const currentStatus = deviceId ? getTestStatus(deviceId, templateName) : null;
  const showMarkOk = deviceId && currentStatus && currentStatus !== 'TESTED_OK' && currentStatus !== 'TESTING';
  menu.innerHTML = `
    ${showMarkOk ? `
      <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;color:var(--c-green)" data-action="mark-tested" data-template="${esc(templateName)}" data-device-id="${esc(deviceId)}">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="margin-right:6px"><path d="M20 6L9 17l-5-5"/></svg>
        ${t('dev.mark_tested')}
      </button>
      <div style="height:1px;background:var(--c-bg-2);margin:var(--sp-1) 0"></div>
    ` : ''}
    <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start" data-action="edit-template" data-template="${esc(templateName)}">
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:6px"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      ${t('dev.menu_edit')}
    </button>
    <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start" data-action="rename-template" data-template="${esc(templateName)}">
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:6px"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
      ${t('dev.menu_rename')}
    </button>
    <button class="btn btn-danger btn-sm" style="width:100%;justify-content:flex-start" data-action="delete-template" data-template="${esc(templateName)}">
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:6px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      ${t('dev.menu_delete')}
    </button>
  `;
  document.body.appendChild(menu);

  // Attach click handler directly on the menu — it lives outside the Devices
  // panel so clicks would never bubble up to the page-level listener.
  menu.addEventListener('click', (e) => {
    const act = e.target.closest('[data-action]');
    if (!act) return;
    e.stopPropagation();
    const action = act.dataset.action;
    const name = act.dataset.template;
    const devId = act.dataset.deviceId;
    closeAnyTemplateMenu();
    switch (action) {
      case 'edit-template': editTemplate(name); break;
      case 'rename-template': renameTemplate(name); break;
      case 'delete-template': deleteTemplate(name); break;
      case 'mark-tested':
        if (devId) {
          markTestPass(devId, name);
          toast.success(t('dev.status_updated_body', { name }), { title: t('dev.status_updated_title') });
        }
        break;
    }
  });

  // Close on outside click
  setTimeout(() => {
    const close = (e) => {
      if (!menu.contains(e.target)) {
        closeAnyTemplateMenu();
        document.removeEventListener('click', close);
      }
    };
    document.addEventListener('click', close);
  }, 50);
}

// ── Rendering ─────────────────────────────────────

export function render() {
  const panel = $('#page-devices');
  if (!panel) return;
  const devices = state.devices;

  panel.innerHTML = `
    <div style="max-width:860px;margin:0 auto;padding:var(--sp-4) 0">
      ${renderHeader(devices)}
      ${devices.length ? renderDeviceList(devices) : renderEmptyState()}
    </div>
  `;
}

function renderHeader(devices) {
  const count = devices.length;
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:var(--sp-4)">
      <div>
        <h2 class="t-lg t-strong" style="margin:0">${t('dev.title')}</h2>
        <p class="t-sm t-muted" style="margin-top:var(--sp-1)">${count ? t('dev.subtitle_n', { n: count }) : t('dev.subtitle_none')}</p>
      </div>
      <div style="display:flex;gap:var(--sp-2)">
        <button class="btn btn-secondary btn-sm" data-action="guide">${t('dev.guide_btn')}</button>
        <button class="btn btn-primary btn-sm" data-action="scan">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="margin-right:4px"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M20.49 9A9 9 0 005.64 5.64L4 4m16 16l-1.64-1.64A9 9 0 013.51 15"/></svg>
          ${t('dev.scan_btn')}
        </button>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="ui-card" style="text-align:center;padding:var(--sp-8) var(--sp-4)">
      <div style="width:64px;height:64px;background:var(--c-bg-2);border-radius:var(--r-lg);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-4)">
        <svg width="32" height="32" fill="none" stroke="var(--c-fg-3)" stroke-width="1.3" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/></svg>
      </div>
      <h3 class="t-lg t-strong" style="margin-bottom:var(--sp-2)">${t('dev.empty_title')}</h3>
      <p class="t-sm t-muted" style="margin-bottom:var(--sp-4);max-width:400px;margin-left:auto;margin-right:auto">${t('dev.empty_hint')}</p>
      <div style="display:flex;gap:var(--sp-2);justify-content:center">
        <button class="btn btn-secondary" data-action="guide">${t('dev.empty_see_guide')}</button>
        <button class="btn btn-primary" data-action="scan">${t('dev.empty_scan_now')}</button>
      </div>
    </div>
  `;
}

function renderDeviceList(devices) {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--sp-3)">
      ${devices.map(([id, model]) => renderDeviceCard(id, model)).join('')}
    </div>
  `;
}

function renderDeviceCard(id, model) {
  const h = state.deviceHealth[id] || {};
  const expanded = state.expandedDevice === id;
  const brand = h.brand || '';
  const fullModel = h.model || model;
  const displayName = getDeviceLabel(id, brand ? (brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase() + (fullModel ? ' ' + fullModel : '')) : fullModel);
  const bat = h.battery;
  const batColor = bat == null ? 'var(--c-fg-3)' : bat < 20 ? 'var(--c-red)' : bat < 50 ? 'var(--c-amber)' : 'var(--c-green)';
  const batChipClass = bat == null ? 'ui-chip' : bat < 20 ? 'ui-chip ui-chip-err' : bat < 50 ? 'ui-chip ui-chip-warn' : 'ui-chip ui-chip-ok';
  const netType = h.network_type || '';
  const wifiSsid = h.wifi_ssid || '';
  const netLabel = wifiSsid || (netType || '–');
  const androidVer = h.android_version || '';
  const screenRes = h.screen_resolution || '';

  return `
    <div class="ui-card" style="padding:0;overflow:hidden;${expanded ? 'border-color:var(--c-accent)' : ''}">
      <!-- Card header (clickable) -->
      <div data-expand="${esc(id)}" style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);cursor:pointer;user-select:none">
        <div style="width:40px;height:40px;background:var(--c-cyan-a12);border-radius:var(--r-md);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="20" height="20" fill="none" stroke="var(--c-cyan)" stroke-width="1.6" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div class="t-md t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(displayName)}</div>
          <div class="t-xs t-muted" style="margin-top:2px">${androidVer ? 'Android ' + esc(androidVer) : ''}${androidVer && screenRes ? ' · ' : ''}${esc(screenRes)}</div>
        </div>
        <span class="${batChipClass} t-xs" style="padding:3px var(--sp-2);color:${batColor}">
          <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="7" width="16" height="10" rx="1"/><path d="M20 10v4"/></svg>
          ${bat != null ? bat + '%' : '–'}
        </span>
        <span class="ui-chip t-xs" style="padding:3px var(--sp-2)">
          ${wifiSsid
            ? '<svg width="10" height="10" fill="none" stroke="var(--c-green)" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0114.08 0m-11.24 3a7 7 0 018.4 0M12 20h.01"/></svg>'
            : '<svg width="10" height="10" fill="none" stroke="var(--c-amber)" stroke-width="2" viewBox="0 0 24 24"><path d="M2 20h.01M7 20v-4m5 4v-8m5 8V8m5 12V4"/></svg>'}
          <span style="max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(netLabel)}</span>
        </span>
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--c-fg-2);transform:rotate(${expanded ? '180' : '0'}deg);transition:transform .2s;flex-shrink:0">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </div>

      <!-- Expanded detail -->
      ${expanded ? renderDeviceDetail(id, h) : ''}
    </div>
  `;
}

function renderDeviceDetail(id, health) {
  return `
    <div style="border-top:1px solid var(--c-bg-2);padding:var(--sp-4)">
      ${renderDeviceInfo(id, health)}
      ${renderTemplateSection(id)}
    </div>
  `;
}

function renderDeviceInfo(id, h) {
  const rows = [
    [t('dev.info_id'), id, 'monospace'],
    [t('dev.info_brand_model'), `${h.brand || '?'} ${h.model || ''}`.trim()],
    [t('dev.info_android'), h.android_version || '–'],
    [t('dev.info_screen'), h.screen_resolution || '–'],
    [t('dev.info_network'), h.wifi_ssid ? `Wifi: ${h.wifi_ssid}` : (h.network_type || '–')],
    [t('dev.info_ip'), h.wifi_ip || '–', 'monospace'],
  ];

  return `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-2) var(--sp-4);margin-bottom:var(--sp-4)">
      ${rows.map(([label, val, font]) => `
        <div>
          <div class="t-xs t-muted" style="margin-bottom:2px">${label}</div>
          <div class="t-sm" style="color:var(--c-fg-1);${font === 'monospace' ? "font-family:'IBM Plex Mono',monospace;font-size:11px;word-break:break-all" : ''}">${esc(val)}</div>
        </div>
      `).join('')}
    </div>
    <div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-4);padding-bottom:var(--sp-4);border-bottom:1px dashed var(--c-bg-2)">
      <button class="btn btn-secondary btn-sm" data-action="test-conn" data-device-id="${esc(id)}">${t('dev.test_conn')}</button>
      <button class="btn btn-ghost btn-sm" data-action="rename" data-device-id="${esc(id)}">${t('dev.rename')}</button>
    </div>
  `;
}

function renderTemplateSection(deviceId) {
  const health = state.deviceHealth[deviceId] || {};
  const ranked = (state.templates || []).map(name => {
    const tpl = state.templatesData[name];
    const score = tpl ? scoreTemplate(tpl, health) : -1;
    const platform = tpl ? detectPlatformFromTemplate(tpl) : 'other';
    const test = getTestRecord(deviceId, name);
    const testRank = test?.status === 'TESTED_OK' ? 3
                   : test?.status === 'NEEDS_RETEST' ? 2
                   : test?.status === 'NEW' || !test ? 1
                   : 0;  // TESTED_FAIL
    return { name, tpl, score, platform, testRank, lastTestAt: test?.lastTestAt || 0 };
  });

  // Group templates by platform (so we know how many alternatives exist per slot)
  const groupsByPlatform = {};
  for (const r of ranked) {
    if (!groupsByPlatform[r.platform]) groupsByPlatform[r.platform] = [];
    groupsByPlatform[r.platform].push(r);
  }
  // Sort each group by ranking (best first) — used as auto-pick when no override
  for (const p in groupsByPlatform) {
    groupsByPlatform[p].sort((a, b) =>
      b.score - a.score
      || b.testRank - a.testRank
      || b.lastTestAt - a.lastTestAt
      || a.name.localeCompare(b.name)
    );
  }

  // Per platform: user override takes priority, otherwise auto-pick the top of group.
  const platformOrder = ['shopee', 'tiktok', 'instagram', 'youtube', 'lazada', 'other'];
  const visible = [];
  for (const p of platformOrder) {
    const group = groupsByPlatform[p];
    if (!group || group.length === 0) continue;
    const overrideName = getActiveTemplate(deviceId, p);
    let pick = overrideName ? group.find(x => x.name === overrideName) : null;
    if (!pick) pick = group[0];  // auto-pick best
    visible.push({
      ...pick,
      isOverride: !!overrideName && pick.name === overrideName,
      alternativesCount: group.length - 1,
    });
  }

  const totalCount = ranked.length;
  const hiddenCount = totalCount - visible.length;

  return `
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-3)">
        <h3 class="t-md t-strong" style="margin:0">${t('dev.templates_title')}</h3>
        <span class="t-xs t-muted">${t('dev.templates_active', { n: visible.length })}${hiddenCount > 0 ? ` · ${t('dev.templates_extra', { n: hiddenCount })}` : ''}</span>
      </div>
      ${visible.length ? `
        <div style="display:flex;flex-direction:column;gap:var(--sp-2);margin-bottom:var(--sp-3)">
          ${visible.map(x => renderTemplateRow(deviceId, x)).join('')}
        </div>
      ` : `
        <div class="t-sm t-muted" style="padding:var(--sp-4);text-align:center;background:var(--c-bg-1);border-radius:var(--r-md);margin-bottom:var(--sp-3)">
          ${t('dev.templates_empty')}
        </div>
      `}
      <button class="btn btn-primary" style="width:100%" data-action="record-new" data-device-id="${esc(deviceId)}">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
        ${t('dev.record_new')}
      </button>
    </div>
  `;
}

function renderTemplateRow(deviceId, { name, tpl, score, isOverride, alternativesCount = 0 }) {
  const testStatus = getTestStatus(deviceId, name);
  const testRec = getTestRecord(deviceId, name);
  const detected = detectPlatformFromTemplate(tpl);
  const platform = detected !== 'other' ? detected : (tpl?.platform || '?');
  const stepCount = tpl?.steps?.length || 0;

  const matchLabel = labelForScore(score);
  const matchClass = chipClassForScore(score);

  // Test status chip
  let testChip = '';
  let actionBtn = '';
  switch (testStatus) {
    case 'TESTED_OK':
      testChip = `<span class="ui-chip ui-chip-ok t-xs">✓ ${t('dev.already_tested', { n: testRec?.successCount || 1 })}</span>`;
      actionBtn = `<button class="btn btn-primary btn-sm" data-action="run-template" data-device-id="${esc(deviceId)}" data-template="${esc(name)}">${t('dev.use_batch')}</button>`;
      break;
    case 'TESTED_FAIL':
      testChip = `<span class="ui-chip ui-chip-err t-xs">✗ ${t('dev.last_failed')}</span>`;
      actionBtn = `<button class="btn btn-secondary btn-sm" data-action="test-template" data-device-id="${esc(deviceId)}" data-template="${esc(name)}">${t('dev.test_again')}</button>`;
      break;
    case 'TESTING':
      testChip = `<span class="ui-chip ui-chip-warn t-xs">🧪 ${t('dev.testing')}</span>`;
      actionBtn = `<button class="btn btn-ghost btn-sm" disabled>${t('dev.running')}</button>`;
      break;
    case 'NEEDS_RETEST':
      testChip = `<span class="ui-chip ui-chip-warn t-xs">⚠ ${t('dev.needs_retest')}</span>`;
      actionBtn = `<button class="btn btn-secondary btn-sm" data-action="test-template" data-device-id="${esc(deviceId)}" data-template="${esc(name)}">${t('dev.retest')}</button>`;
      break;
    default: // NEW
      testChip = `<span class="ui-chip t-xs" style="color:var(--c-fg-3)">${t('dev.not_tested')}</span>`;
      actionBtn = `<button class="btn btn-secondary btn-sm" data-action="test-template" data-device-id="${esc(deviceId)}" data-template="${esc(name)}">${t('dev.test_first')}</button>`;
  }

  const switcherBtn = alternativesCount > 0
    ? `<button class="btn btn-ghost btn-sm" data-action="switch-template" data-device-id="${esc(deviceId)}" data-platform="${esc(platform)}" title="${esc(t('dev.switch_title', { platform }))}" style="padding:0 var(--sp-2)">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:4px"><path d="M7 17l-4-4 4-4M17 7l4 4-4 4M3 13h18"/></svg>
        ${t('dev.switch_alt', { n: alternativesCount })}
       </button>`
    : '';

  return `
    <div style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3);background:var(--c-bg-1);border-radius:var(--r-md);transition:background var(--t-fast)"
         onmouseover="this.style.background='var(--c-bg-2)'" onmouseout="this.style.background='var(--c-bg-1)'">
      ${platformIconTile(tpl || platform, 32)}
      <div style="flex:1;min-width:0">
        <div class="t-sm t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc(name)}
          ${isOverride ? `<span class="t-xs" style="color:var(--c-accent);margin-left:6px">${t('dev.manual_tag')}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:var(--sp-2);margin-top:4px;flex-wrap:wrap">
          <span class="t-xs t-muted">${t('dev.step_count', { n: stepCount, platform: esc(platform) })}</span>
          <span class="ui-chip ${matchClass} t-xs" style="padding:2px var(--sp-2)">${matchLabel}</span>
          ${testChip}
        </div>
      </div>
      ${switcherBtn}
      ${actionBtn}
      <button class="btn btn-ghost btn-sm btn-icon" data-action="template-menu" data-template="${esc(name)}" data-device-id="${esc(deviceId)}" title="Menu">⋮</button>
    </div>
  `;
}
