// ── Devices Page (IA v2 — master-detail accordion) ──

import { $, esc } from '../utils/helpers.js';
import state, {
  set, on, emit,
  getDeviceLabel, setDeviceLabel, setExpandedDevice,
  getTestStatus, getTestRecord, removeTestsForTemplate,
} from '../state.js';
import { toast } from '../components/toast.js';
import { appendLog } from '../components/console-panel.js';
import { navigate } from '../router.js';
import { scoreTemplate, labelForScore, chipClassForScore } from '../utils/templateMatch.js';

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
      case 'delete-template': return deleteTemplate(tpl);
      case 'template-menu': return openTemplateMenu(actionBtn, tpl);
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
  try {
    const health = await invoke('check_device_health', { deviceId });
    state.deviceHealth[deviceId] = health;
    emit('deviceHealth', state.deviceHealth);
    appendLog(`[SYSTEM] ${deviceId.slice(-6)}: ${health.connected ? 'Terhubung' : 'Terputus'}, Baterai: ${health.battery ?? 'N/A'}%`);
  } catch (err) {
    appendLog(`[ERROR] Tes gagal: ${err}`);
  }
}

function renameDevice(deviceId) {
  const current = state.deviceLabels[deviceId] || '';
  const next = prompt(`Nama untuk HP ini:`, current);
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
    if (!confirm('Template ini belum teruji di HP ini. Lanjut pakai? (risiko gagal massal)')) return;
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
    alert(`Gagal pakai template: ${e}`);
  }
}

function editTemplate(templateName) {
  set('selectedTemplate', templateName);
  navigate('editor');
  closeAnyTemplateMenu();
}

async function deleteTemplate(templateName) {
  closeAnyTemplateMenu();
  if (!confirm(`Hapus template "${templateName}"?\n\nSemua catatan hasil test di HP yang pernah pakai template ini juga akan dihapus.`)) return;
  try {
    await invoke('recorder_delete_template', { name: templateName });
    removeTestsForTemplate(templateName);
    // Remove from local cache
    delete state.templatesData[templateName];
    set('templates', state.templates.filter(n => n !== templateName));
    emit('templatesData', state.templatesData);
    toast.success(`Template "${templateName}" dihapus`);
  } catch (e) {
    toast.error('Gagal hapus: ' + e);
  }
}

function closeAnyTemplateMenu() {
  document.querySelectorAll('.tpl-row-menu').forEach(m => m.remove());
}

function openTemplateMenu(anchorBtn, templateName) {
  closeAnyTemplateMenu();
  const rect = anchorBtn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'tpl-row-menu ui-card';
  menu.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 4}px;
    left: ${rect.right - 160}px;
    width: 160px;
    padding: var(--sp-1);
    z-index: 5000;
    box-shadow: var(--elev-2);
  `;
  menu.innerHTML = `
    <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start" data-action="edit-template" data-template="${esc(templateName)}">
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:6px"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Edit
    </button>
    <button class="btn btn-danger btn-sm" style="width:100%;justify-content:flex-start" data-action="delete-template" data-template="${esc(templateName)}">
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:6px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      Hapus
    </button>
  `;
  document.body.appendChild(menu);
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
        <h2 class="t-lg t-strong" style="margin:0">Perangkat</h2>
        <p class="t-sm t-muted" style="margin-top:var(--sp-1)">${count ? `${count} HP terhubung · pilih HP untuk lihat kapabilitas` : 'Colok HP + aktifkan USB debugging untuk mulai'}</p>
      </div>
      <div style="display:flex;gap:var(--sp-2)">
        <button class="btn btn-secondary btn-sm" data-action="guide">Panduan</button>
        <button class="btn btn-primary btn-sm" data-action="scan">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="margin-right:4px"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M20.49 9A9 9 0 005.64 5.64L4 4m16 16l-1.64-1.64A9 9 0 013.51 15"/></svg>
          Pindai
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
      <h3 class="t-lg t-strong" style="margin-bottom:var(--sp-2)">Belum ada HP terhubung</h3>
      <p class="t-sm t-muted" style="margin-bottom:var(--sp-4);max-width:400px;margin-left:auto;margin-right:auto">Colok HP Android lewat kabel USB, aktifkan <strong>USB Debugging</strong> di Opsi Pengembang, lalu tap <strong>Izinkan</strong> saat prompt muncul.</p>
      <div style="display:flex;gap:var(--sp-2);justify-content:center">
        <button class="btn btn-secondary" data-action="guide">Lihat Panduan</button>
        <button class="btn btn-primary" data-action="scan">Pindai HP Sekarang</button>
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
    ['ID HP', id, 'monospace'],
    ['Merk / Model', `${h.brand || '?'} ${h.model || ''}`.trim()],
    ['Android', h.android_version || '–'],
    ['Layar', h.screen_resolution || '–'],
    ['Jaringan', h.wifi_ssid ? `Wifi: ${h.wifi_ssid}` : (h.network_type || '–')],
    ['IP', h.wifi_ip || '–', 'monospace'],
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
      <button class="btn btn-secondary btn-sm" data-action="test-conn" data-device-id="${esc(id)}">Tes koneksi</button>
      <button class="btn btn-ghost btn-sm" data-action="rename" data-device-id="${esc(id)}">Ganti nama</button>
    </div>
  `;
}

function renderTemplateSection(deviceId) {
  const health = state.deviceHealth[deviceId] || {};
  const all = (state.templates || []).map(name => {
    const tpl = state.templatesData[name];
    const score = tpl ? scoreTemplate(tpl, health) : -1;
    return { name, tpl, score };
  });

  all.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTest = getTestRecord(deviceId, a.name);
    const bTest = getTestRecord(deviceId, b.name);
    const aOk = aTest?.status === 'TESTED_OK' ? 1 : 0;
    const bOk = bTest?.status === 'TESTED_OK' ? 1 : 0;
    if (bOk !== aOk) return bOk - aOk;
    return a.name.localeCompare(b.name);
  });

  return `
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-3)">
        <h3 class="t-md t-strong" style="margin:0">Yang bisa dilakukan HP ini</h3>
        <span class="t-xs t-muted">${all.length} template</span>
      </div>
      ${all.length ? `
        <div style="display:flex;flex-direction:column;gap:var(--sp-2);margin-bottom:var(--sp-3)">
          ${all.map(x => renderTemplateRow(deviceId, x)).join('')}
        </div>
      ` : `
        <div class="t-sm t-muted" style="padding:var(--sp-4);text-align:center;background:var(--c-bg-1);border-radius:var(--r-md);margin-bottom:var(--sp-3)">
          HP ini belum diajarin apa-apa. Mulai dengan rekam flow pertama.
        </div>
      `}
      <button class="btn btn-primary" style="width:100%" data-action="record-new" data-device-id="${esc(deviceId)}">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
        Ajarin HP ini hal baru
      </button>
    </div>
  `;
}

function renderTemplateRow(deviceId, { name, tpl, score }) {
  const testStatus = getTestStatus(deviceId, name);
  const testRec = getTestRecord(deviceId, name);
  const platform = tpl?.platform || '?';
  const stepCount = tpl?.steps?.length || 0;
  const platformIcon = platform.includes('shopee') ? '📦' : platform.includes('tiktok') ? '🎵' : '📱';

  const matchLabel = labelForScore(score);
  const matchClass = chipClassForScore(score);

  // Test status chip
  let testChip = '';
  let actionBtn = '';
  switch (testStatus) {
    case 'TESTED_OK':
      testChip = `<span class="ui-chip ui-chip-ok t-xs">✓ Teruji · ${testRec?.successCount || 1}×</span>`;
      actionBtn = `<button class="btn btn-primary btn-sm" data-action="run-template" data-device-id="${esc(deviceId)}" data-template="${esc(name)}">Pakai →</button>`;
      break;
    case 'TESTED_FAIL':
      testChip = `<span class="ui-chip ui-chip-err t-xs">✗ Gagal terakhir</span>`;
      actionBtn = `<button class="btn btn-secondary btn-sm" data-action="test-template" data-device-id="${esc(deviceId)}" data-template="${esc(name)}">Test lagi</button>`;
      break;
    case 'TESTING':
      testChip = `<span class="ui-chip ui-chip-warn t-xs">🧪 Sedang test...</span>`;
      actionBtn = `<button class="btn btn-ghost btn-sm" disabled>Berjalan</button>`;
      break;
    case 'NEEDS_RETEST':
      testChip = `<span class="ui-chip ui-chip-warn t-xs">⚠ Template diubah, test ulang</span>`;
      actionBtn = `<button class="btn btn-secondary btn-sm" data-action="test-template" data-device-id="${esc(deviceId)}" data-template="${esc(name)}">Test ulang</button>`;
      break;
    default: // NEW
      testChip = `<span class="ui-chip t-xs" style="color:var(--c-fg-3)">Belum diuji di HP ini</span>`;
      actionBtn = `<button class="btn btn-secondary btn-sm" data-action="test-template" data-device-id="${esc(deviceId)}" data-template="${esc(name)}">Test dulu</button>`;
  }

  return `
    <div style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3);background:var(--c-bg-1);border-radius:var(--r-md);transition:background var(--t-fast)"
         onmouseover="this.style.background='var(--c-bg-2)'" onmouseout="this.style.background='var(--c-bg-1)'">
      <span style="font-size:20px;flex-shrink:0">${platformIcon}</span>
      <div style="flex:1;min-width:0">
        <div class="t-sm t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>
        <div style="display:flex;align-items:center;gap:var(--sp-2);margin-top:4px;flex-wrap:wrap">
          <span class="t-xs t-muted">${stepCount} langkah · ${esc(platform)}</span>
          <span class="ui-chip ${matchClass} t-xs" style="padding:2px var(--sp-2)">${matchLabel}</span>
          ${testChip}
        </div>
      </div>
      ${actionBtn}
      <button class="btn btn-ghost btn-sm btn-icon" data-action="template-menu" data-template="${esc(name)}" title="Menu">⋮</button>
    </div>
  `;
}
