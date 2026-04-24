// ── Upload Queue Page ─────────────────────────────────

import { $, esc, parseCSV } from '../utils/helpers.js';
import state, { set, on, emit, getDeviceLabel as getSavedDeviceLabel, getTestStatus, getActiveTemplate } from '../state.js';
import { appendLog } from '../components/console-panel.js';
import { navigate } from '../router.js';
import { detectPlatformFromTemplate } from '../utils/templateMatch.js';
import { t } from '../i18n.js';

const { invoke } = window.__TAURI__.core;
const convertFileSrc = window.__TAURI__.core.convertFileSrc || ((path) => `asset://localhost/${encodeURIComponent(path)}`);
let openDialog = null;
try { openDialog = window.__TAURI__.dialog?.open; } catch(e) {}

function previewVideo(path) {
  if (!path) return;
  const modal = document.getElementById('video-preview-modal');
  const player = document.getElementById('video-preview-player');
  const name = document.getElementById('video-preview-name');
  if (!modal || !player) return;
  try {
    player.src = convertFileSrc(path);
    name.textContent = path.split('/').pop().split('\\').pop();
    modal.style.display = 'flex';
    player.play().catch(() => {});
  } catch (e) {
    appendLog('[ERROR] Cannot preview: ' + e);
  }
}

const FLOW_ICONS = {
  shopee: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#EE4D2D"><path d="M12 2C9.24 2 7 4.24 7 7h2c0-1.66 1.34-3 3-3s3 1.34 3 3h2c0-2.76-2.24-5-5-5zm-7 7c-.55 0-1 .45-1 1v1l1.53 8.55C5.7 20.38 6.4 21 7.23 21h9.54c.83 0 1.53-.62 1.7-1.45L20 11v-1c0-.55-.45-1-1-1H5zm7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>',
  tiktok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="var(--c-fg-0)"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.18 8.18 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z"/></svg>',
};

let expandedRow = -1; // which row is expanded for editing
let queueLoaded = false;
let saveTimer = null;

function autoSaveQueue() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await invoke('save_queue', { items: state.queue });
    } catch (e) {}
  }, 500);
}

export function init() {
  const panel = $('#page-queue');

  panel.addEventListener('input', (e) => {
    if (e.target.dataset.field !== undefined && e.target.dataset.row !== undefined) {
      state.queue[parseInt(e.target.dataset.row)][e.target.dataset.field] = e.target.value;
      autoSaveQueue();
    }
  });

  panel.addEventListener('change', (e) => {
    if (e.target.dataset.field === '_flow' && e.target.dataset.row !== undefined) {
      state.queue[parseInt(e.target.dataset.row)]._flow = e.target.value;
      render();
    }
  });

  panel.addEventListener('click', (e) => {
    // Kebab menu toggle
    const kebab = e.target.closest('.q-kebab');
    if (kebab) {
      e.preventDefault();
      e.stopPropagation();
      const row = kebab.dataset.row;
      closeAllMenus();
      const menu = panel.querySelector(`[data-menu="${row}"]`);
      if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
      return;
    }

    // Menu item actions
    const menuItem = e.target.closest('.q-menu [data-action]');
    if (menuItem) {
      e.stopPropagation();
      const i = parseInt(menuItem.dataset.row);
      const a = menuItem.dataset.action;
      closeAllMenus();
      if (a === 'delete') { state.queue.splice(i, 1); if (expandedRow === i) expandedRow = -1; else if (expandedRow > i) expandedRow--; render(); }
      if (a === 'duplicate') { state.queue.splice(i + 1, 0, { ...state.queue[i] }); render(); }
      return;
    }

    // Toolbar actions (no data-row needed)
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const a = btn.dataset.action;
      if (a === 'retry-failed') retryFailed();
      if (a === 'import-csv') panel.querySelector('#csv-input')?.click();
      if (a === 'add-row') addRow();
      if (a === 'clear-done') {
        const count = state.queue.filter(q => q._status === 'success').length;
        if (!count || !confirm(t('job.confirm_clear_done', { count }))) return;
        state.queue = state.queue.filter(q => q._status !== 'success');
        expandedRow = -1; render();
      }
      if (a === 'clear-all') {
        if (!state.queue.length || !confirm(t('job.confirm_clear_all', { count: state.queue.length }))) return;
        state.queue = []; expandedRow = -1; render();
      }
      if (a === 'delete-selected') {
        const ids = [...$('#page-queue').querySelectorAll('.q-cb:checked')].map(cb => parseInt(cb.dataset.i));
        if (!ids.length) return;
        if (!confirm(t('job.confirm_delete_sel', { count: ids.length }))) return;
        state.queue = state.queue.filter((_, i) => !ids.includes(i));
        expandedRow = -1; render();
      }
      if (a === 'auto-distribute') autoDistribute();
      if (a === 'assign-selected') openAssignModal();
      if (a === 'go-devices') navigate('devices');
      if (a === 'csv-menu') { openCsvMenu(btn); return; }
      if (a === 'more-menu') { openMoreMenu(btn); return; }
      if (a === 'run') emit('start-automation');
      if (a === 'stop-all') emit('stop-automation');
      return;
    }

    // File picker button
    const fpBtn = e.target.closest('.q-filepick');
    if (fpBtn) {
      e.stopPropagation();
      const row = parseInt(fpBtn.dataset.row);
      const field = fpBtn.dataset.field;
      pickFile(row, field);
      return;
    }

    // Video preview
    const videoLink = e.target.closest('.q-video-link');
    if (videoLink && videoLink.dataset.videoPath) {
      e.stopPropagation();
      previewVideo(videoLink.dataset.videoPath);
      return;
    }

    // Click row to expand (not on interactive elements)
    if (!e.target.closest('input') && !e.target.closest('button') && !e.target.closest('.q-menu') && !e.target.closest('textarea') && !e.target.closest('.q-kebab') && !e.target.closest('.q-video-link')) {
      const row = e.target.closest('[data-qrow]');
      if (row) {
        const i = parseInt(row.dataset.qrow);
        expandedRow = expandedRow === i ? -1 : i;
        closeAllMenus();
        render();
        return;
      }
    }

    // Close menus on outside click
    if (!e.target.closest('.q-menu') && !e.target.closest('.q-kebab')) closeAllMenus();
  });

  panel.addEventListener('change', (e) => {
    if (e.target.id === 'q-selall' || e.target.id === 'q-selall-tbl') { toggleSelectAll(e.target.checked); }
    if (e.target.classList.contains('q-cb')) { updateSelCount(); }
  });

  // (legacy assign-modal in index.html is no longer used; picker is built dynamically)

  on('flow', render);
  on('devices', render);
  on('selectedTemplate', render);
  on('platform', render);
  on('isRunning', render);
  on('activeTemplates', render);
  on('deviceLabels', render);
  on('lang', render);
  on('progress', () => { if (state.activeRoute === 'queue') render(); });
}

async function pickFile(row, field) {
  try {
    const open = openDialog || window.__TAURI__?.dialog?.open;
    if (!open) { appendLog('[SYSTEM] File dialog not available'); return; }
    const selected = await open({
      multiple: false,
      filters: field.includes('video') || field.includes('path')
        ? [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'MOV', 'MP4'] }]
        : [],
    });
    if (selected) {
      state.queue[row][field] = selected;
      render();
    }
  } catch (err) {
    appendLog('[ERROR] File picker: ' + err);
  }
}

function addRow() {
  const fields = state.flow?.batch_fields || [];
  const empty = {};
  fields.forEach(f => empty[f.key] = '');
  state.queue.push(empty);
  render();
}

async function retryFailed() {
  const failed = state.queue.filter(item => item._status === 'failed');
  if (!failed.length) {
    appendLog('[SYSTEM] Tidak ada item yang gagal');
    return;
  }
  failed.forEach(item => { item._status = 'pending'; });
  render();
  appendLog(`[SYSTEM] ${failed.length} item di-reset ke antri — mulai ulang`);
  try {
    const { toast } = await import('../components/toast.js');
    toast.success(t('job.retry_body', { n: failed.length }), { title: t('job.retry_title') });
  } catch {}
  // Fire the same start-automation signal that the Jalankan button uses
  emit('start-automation');
}

function toggleSelectAll(checked) {
  $('#page-queue').querySelectorAll('.q-cb').forEach(cb => cb.checked = checked);
  updateSelCount();
}

function updateSelCount() {
  const n = $('#page-queue').querySelectorAll('.q-cb:checked').length;
  const info = $('#page-queue').querySelector('#q-sel-info');
  const countEl = $('#page-queue').querySelector('#q-sel-count');
  if (info) info.style.display = n > 0 ? 'inline-flex' : 'none';
  if (countEl) countEl.textContent = n;
}

function openMoreMenu(anchor) {
  document.querySelectorAll('.q-more-menu').forEach(m => m.remove());
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'q-more-menu ui-card';
  const vw = window.innerWidth;
  const left = Math.max(8, Math.min(rect.right - 200, vw - 208));
  menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${left}px;width:200px;padding:var(--sp-1);z-index:5000;box-shadow:var(--elev-2);display:flex;flex-direction:column;gap:2px`;

  const hasFailed = state.queue.some(q => q._status === 'failed');
  const hasDone = state.queue.some(q => q._status === 'success');
  const hasItems = state.queue.length > 0;
  const hasDevices = state.devices.length > 0;

  const items = [
    { label: t('job.more_retry'), icon: '↻', action: 'retry-failed', disabled: !hasFailed },
    { label: t('job.more_distribute'), icon: '⇄', action: 'auto-distribute', disabled: !hasDevices || !hasItems },
    { sep: true },
    { label: t('job.more_clear_done'), icon: '✓', action: 'clear-done', disabled: !hasDone },
    { label: t('job.more_clear_all'), icon: '⌫', action: 'clear-all', disabled: !hasItems, danger: true },
  ];
  menu.innerHTML = items.map(it => {
    if (it.sep) return `<div style="height:1px;background:var(--c-bg-2);margin:var(--sp-1) 0"></div>`;
    const color = it.danger ? 'var(--c-red)' : 'var(--c-fg-1)';
    const opacity = it.disabled ? '.35' : '1';
    const pointerEvents = it.disabled ? 'none' : 'auto';
    return `<button class="q-more-item" data-action="${it.action}" style="width:100%;display:flex;align-items:center;gap:var(--sp-2);padding:6px var(--sp-3);background:none;border:none;border-radius:var(--r-sm);cursor:pointer;text-align:left;font-family:inherit;font-size:var(--fs-sm);color:${color};opacity:${opacity};pointer-events:${pointerEvents}"><span style="width:14px;text-align:center">${it.icon}</span>${it.label}</button>`;
  }).join('');
  document.body.appendChild(menu);
  // Click handler direct on menu — it lives outside #page-queue so delegation
  // from the panel-level listener won't catch these buttons.
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('.q-more-item');
    if (!btn) return;
    e.stopPropagation();
    const a = btn.dataset.action;
    menu.remove();
    if (a === 'retry-failed') retryFailed();
    else if (a === 'auto-distribute') autoDistribute();
    else if (a === 'clear-done') {
      const count = state.queue.filter(q => q._status === 'success').length;
      if (!count || !confirm(t('job.confirm_clear_done', { count }))) return;
      state.queue = state.queue.filter(q => q._status !== 'success');
      expandedRow = -1; render();
    }
    else if (a === 'clear-all') {
      if (!state.queue.length || !confirm(t('job.confirm_clear_all', { count: state.queue.length }))) return;
      state.queue = []; expandedRow = -1; render();
    }
  });
  menu.querySelectorAll('.q-more-item').forEach(btn => {
    btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--c-bg-2)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; });
  });
  setTimeout(() => {
    const close = (e) => {
      if (!menu.contains(e.target) && !anchor.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    };
    document.addEventListener('click', close);
  }, 50);
}

function autoDistribute() {
  const devIds = state.devices.map(d => d[0]);
  if (!devIds.length) {
    appendLog('[SYSTEM] Tidak ada HP untuk didistribusi');
    return;
  }
  let idx = 0;
  state.queue.forEach(item => {
    if (item._status === 'success') return;
    item._phone = devIds[idx % devIds.length];
    idx++;
  });
  render();
  appendLog(`[SYSTEM] Auto-distribusi: ${idx} item dibagi ke ${devIds.length} HP`);
}

function openAssignModal() {
  const checked = [...$('#page-queue').querySelectorAll('.q-cb:checked')];
  const selectedIndexes = checked.map(cb => parseInt(cb.dataset.i));
  const n = selectedIndexes.length;
  if (n === 0) {
    import('../components/toast.js').then(({ toast }) => toast.warn(t('job.no_selection')));
    return;
  }

  const apply = (phoneOverride) => {
    if (phoneOverride === null) {
      // Clear assignment on selected rows
      selectedIndexes.forEach(i => { delete state.queue[i]._phone; });
    } else if (phoneOverride === '__auto__') {
      const devIds = state.devices.map(d => d[0]);
      if (!devIds.length) {
        import('../components/toast.js').then(({ toast }) => {
          toast.warn(t('job.assign_modal_no_phone'), { title: t('header.no_phones') });
        });
        return false;
      }
      selectedIndexes.forEach((i, idx) => {
        state.queue[i]._phone = devIds[idx % devIds.length];
      });
    } else {
      selectedIndexes.forEach(i => { state.queue[i]._phone = phoneOverride; });
    }
    render();
    return true;
  };

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';

  const firstItems = selectedIndexes.slice(0, 3).map(i =>
    (state.queue[i].video_path || '').split('/').pop().split('\\').pop() || `Item ${i + 1}`
  );
  const previewText = firstItems.join(', ') + (selectedIndexes.length > 3 ? `, ${t('dev.templates_extra', { n: selectedIndexes.length - 3 })}` : '');

  const devCount = state.devices.length;

  overlay.innerHTML = `
    <div class="ui-card" style="width:440px;max-width:92vw;padding:0;max-height:82vh;display:flex;flex-direction:column">
      <div style="padding:var(--sp-4);border-bottom:1px solid var(--c-bg-2)">
        <h3 class="t-lg t-strong" style="margin:0 0 var(--sp-1)">${esc(t('job.assign_modal_title', { n }))}</h3>
        <p class="t-xs t-muted" style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(previewText)}</p>
      </div>

      <div style="flex:1;overflow-y:auto;padding:var(--sp-2)">
        <!-- Auto distribute -->
        <button class="as-item" data-phone="__auto__" style="width:100%;display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3);background:none;border:none;border-radius:var(--r-md);cursor:pointer;text-align:left;font-family:inherit;${devCount === 0 ? 'opacity:.4;pointer-events:none' : ''}">
          <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--c-accent-a12);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="18" height="18" fill="none" stroke="var(--c-accent)" stroke-width="2" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <div style="flex:1;min-width:0">
            <div class="t-sm t-strong">${t('job.assign_modal_auto')}</div>
            <div class="t-xs t-muted" style="margin-top:2px">
              ${devCount ? t('job.assign_modal_auto_hint', { n: devCount }) : t('job.assign_modal_no_phone')}
            </div>
          </div>
        </button>

        ${devCount > 0 ? `
          <div style="padding:var(--sp-2) var(--sp-3) var(--sp-1);font-size:var(--fs-xs);color:var(--c-fg-3);text-transform:uppercase;letter-spacing:.5px;font-weight:600">${t('job.assign_modal_pick')}</div>
          ${state.devices.map(([id, model]) => renderAssignDeviceRow(id, model)).join('')}
        ` : ''}

        <div style="height:1px;background:var(--c-bg-2);margin:var(--sp-2) var(--sp-3)"></div>
        <button class="as-item" data-phone="__clear__" style="width:100%;display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3);background:none;border:none;border-radius:var(--r-md);cursor:pointer;text-align:left;font-family:inherit">
          <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--c-bg-2);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="16" height="16" fill="none" stroke="var(--c-fg-2)" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </div>
          <div style="flex:1;min-width:0">
            <div class="t-sm t-strong">${t('job.assign_modal_clear')}</div>
            <div class="t-xs t-muted" style="margin-top:2px">${t('job.assign_modal_clear_hint')}</div>
          </div>
        </button>
      </div>

      <div style="padding:var(--sp-3);border-top:1px solid var(--c-bg-2);display:flex;justify-content:flex-end">
        <button id="as-cancel" class="btn btn-ghost btn-sm">${t('job.assign_modal_close')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#as-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  overlay.querySelectorAll('.as-item').forEach(btn => {
    btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--c-bg-2)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; });
    btn.addEventListener('click', () => {
      const phone = btn.dataset.phone;
      let val;
      if (phone === '__auto__') val = '__auto__';
      else if (phone === '__clear__') val = null;
      else val = phone;
      const ok = apply(val);
      if (ok === false) return;  // silent fail (e.g., no devices)
      close();
      import('../components/toast.js').then(({ toast }) => {
        if (val === '__auto__') {
          toast.success(t('job.assign_modal_auto_body', { n, count: state.devices.length }), { title: t('job.assign_modal_auto_title') });
        } else if (val === null) {
          toast.success(t('job.assign_modal_clear_body', { n }), { title: t('job.assign_modal_clear_title') });
        } else {
          const h = state.deviceHealth[val] || {};
          const label = state.deviceLabels?.[val] || h.brand || val.slice(-6);
          toast.success(t('job.assign_modal_ok_body', { n, name: label }), { title: t('job.assign_modal_ok_title') });
        }
      });
    });
  });
}

function renderAssignDeviceRow(id, model) {
  const h = state.deviceHealth[id] || {};
  const nickname = state.deviceLabels?.[id]
    || (h.brand ? h.brand.charAt(0).toUpperCase() + h.brand.slice(1).toLowerCase() + (h.model ? ' ' + h.model : '') : model);
  const bat = h.battery;
  const connected = h.connected !== false;
  const net = h.wifi_ssid ? `Wifi: ${h.wifi_ssid}` : (h.network_type || 'Kabel');

  let warning = '';
  if (!connected) warning = `<span class="ui-chip ui-chip-err t-xs" style="padding:1px var(--sp-2)">${t('job.assign_modal_disconnected')}</span>`;
  else if (bat != null && bat < 20) warning = `<span class="ui-chip ui-chip-err t-xs" style="padding:1px var(--sp-2)">${t('job.assign_modal_low_bat', { bat })}</span>`;

  const batColor = bat == null ? 'var(--c-fg-3)' : bat < 20 ? 'var(--c-red)' : bat < 50 ? 'var(--c-amber)' : 'var(--c-green)';
  const disabled = !connected;

  return `
    <button class="as-item" data-phone="${esc(id)}" style="width:100%;display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3);background:none;border:none;border-radius:var(--r-md);cursor:pointer;text-align:left;font-family:inherit;${disabled ? 'opacity:.5;pointer-events:none' : ''}">
      <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--c-cyan-a12);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="18" height="18" fill="none" stroke="var(--c-cyan)" stroke-width="1.8" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/></svg>
      </div>
      <div style="flex:1;min-width:0">
        <div class="t-sm t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nickname)}</div>
        <div style="display:flex;align-items:center;gap:var(--sp-2);margin-top:3px;flex-wrap:wrap">
          <span class="t-xs" style="color:${batColor}">🔋 ${bat != null ? bat + '%' : '–'}</span>
          <span class="t-xs t-muted">·</span>
          <span class="t-xs t-muted" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(net)}</span>
          ${warning}
        </div>
      </div>
    </button>`;
}


// ── CSV menu (popup with Impor / Unduh template) ──────

function closeCsvMenu() {
  document.querySelectorAll('.csv-popover').forEach(m => m.remove());
}

function openCsvMenu(anchorBtn) {
  closeCsvMenu();
  const rect = anchorBtn.getBoundingClientRect();
  const hasFlow = !!(state.flow?.batch_fields?.length);
  const menu = document.createElement('div');
  menu.className = 'csv-popover ui-card';
  const menuWidth = 300;
  const vw = window.innerWidth;
  // Right-align so popup doesn't overflow viewport when button is near right edge
  let leftPos = rect.right - menuWidth;
  if (leftPos < 8) leftPos = Math.min(rect.left, vw - menuWidth - 8);
  menu.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 6}px;
    left: ${leftPos}px;
    width: ${menuWidth}px;
    padding: var(--sp-1);
    z-index: 5000;
    box-shadow: var(--elev-2);
    display: flex;
    flex-direction: column;
    gap: 2px;
  `;
  menu.innerHTML = `
    <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;text-align:left;padding:var(--sp-2) var(--sp-3);height:auto" data-csv-action="upload">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;margin-right:var(--sp-2)"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
      <div style="flex:1;min-width:0">
        <div class="t-sm t-strong">${t('job.csv_import')}</div>
        <div class="t-xs t-muted" style="margin-top:1px">${t('job.csv_import_hint')}</div>
      </div>
    </button>
    <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;text-align:left;padding:var(--sp-2) var(--sp-3);height:auto${hasFlow ? '' : ';opacity:.5;pointer-events:none'}" data-csv-action="download" ${hasFlow ? '' : 'disabled'}>
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;margin-right:var(--sp-2)"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      <div style="flex:1;min-width:0">
        <div class="t-sm t-strong">${t('job.csv_download')}</div>
        <div class="t-xs t-muted" style="margin-top:1px">${hasFlow ? t('job.csv_download_hint') : t('job.csv_download_none')}</div>
      </div>
    </button>
  `;
  document.body.appendChild(menu);

  // Attach click handlers directly on menu items (they're outside the queue panel scope)
  menu.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-csv-action]');
    if (!act) return;
    ev.stopPropagation();
    const a = act.dataset.csvAction;
    closeCsvMenu();
    if (a === 'upload') {
      document.getElementById('csv-input')?.click();
    } else if (a === 'download') {
      downloadCsvTemplate();
    }
  });

  setTimeout(() => {
    const close = (ev) => {
      if (!menu.contains(ev.target) && !anchorBtn.contains(ev.target)) {
        closeCsvMenu();
        document.removeEventListener('click', close);
      }
    };
    document.addEventListener('click', close);
  }, 50);
}

async function downloadCsvTemplate() {
  const fields = state.flow?.batch_fields || [];
  if (!fields.length) {
    appendLog('[SYSTEM] Tidak ada template aktif — pilih template dari Perangkat dulu');
    return;
  }
  // CSV headers use snake_case field keys (machine-friendly for re-import).
  // Pretty labels are for UI only; sticking to keys keeps the roundtrip simple.
  const headers = fields.map(f => f.key);
  const sampleRow = fields.map(f => {
    const k = (f.key || '').toLowerCase();
    if (k === 'video_path') return '/path/ke/video.mp4';
    if (k === 'caption') return 'Contoh caption untuk upload';
    if (k === 'hashtags') return '#fyp #viral';
    if (k.includes('link') || k.includes('url')) return 'https://shopee.co.id/...';
    return '';
  });
  const csv = [headers, sampleRow]
    .map(row => row.map(cell => {
      const needsQuote = /[,"\n]/.test(cell);
      return needsQuote ? `"${cell.replace(/"/g, '""')}"` : cell;
    }).join(','))
    .join('\n');
  const bom = '\uFEFF';

  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  const filename = `AutoFlow_Template_${today}.csv`;

  try {
    // Recommend ~/Documents/AutoFlow/<filename> as default location
    const defaultPath = await invoke('default_export_path', { filename }).catch(() => filename);
    const save = window.__TAURI__?.dialog?.save;
    if (!save) {
      appendLog('[SYSTEM] Save dialog tidak tersedia');
      return;
    }
    const chosen = await save({
      defaultPath,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      title: t('job.save_csv_title'),
    });
    if (!chosen) return;  // user cancelled
    await invoke('write_text_file', { path: chosen, content: bom + csv });
    appendLog(`[SYSTEM] Template CSV disimpan: ${chosen}`);
    try {
      const { toast } = await import('../components/toast.js');
      toast.success(t('job.csv_saved'), {
        title: chosen.split('/').pop(),
        duration: 6000,
      });
    } catch {}
  } catch (err) {
    appendLog(`[ERROR] Gagal simpan CSV: ${err}`);
  }
}

// Synonym dictionary: any header that normalizes to one of these gets mapped
// to the canonical field key. Helps when CSV columns from different sources
// use slightly different naming (affiliate_link vs produk_link vs link).
const HEADER_SYNONYMS = {
  affiliate_link: ['affiliate_link', 'link', 'url', 'produk_link', 'product_link', 'product_url', 'shopee_link', 'affiliate'],
  caption: ['caption', 'description', 'text', 'deskripsi', 'keterangan'],
  hashtags: ['hashtags', 'tags', 'tag', 'hashtag'],
  video_path: ['video_path', 'video', 'path', 'file', 'filepath', 'file_path'],
  title: ['title', 'judul', 'nama'],
};

function matchHeaderToFieldKey(cleanHeader, fieldKeys, fields) {
  // 1. Exact match on field key
  const exact = fieldKeys.find(k => k === cleanHeader);
  if (exact) return exact;
  // 2. Exact match on field label
  const byLabel = fields.find(f => (f.label || '').toLowerCase().replace(/[^a-z0-9_]/g, '_') === cleanHeader);
  if (byLabel) return byLabel.key;
  // 3. Synonym match (e.g. CSV "link" → field "affiliate_link")
  for (const canonical of fieldKeys) {
    const synonyms = HEADER_SYNONYMS[canonical];
    if (synonyms && synonyms.includes(cleanHeader)) return canonical;
  }
  // 4. Reverse synonym (e.g. CSV "affiliate_link" → field "link")
  for (const group of Object.values(HEADER_SYNONYMS)) {
    if (group.includes(cleanHeader)) {
      const match = fieldKeys.find(k => group.includes(k));
      if (match) return match;
    }
  }
  // 5. Loose substring match as last resort
  return fieldKeys.find(k => cleanHeader.includes(k) || k.includes(cleanHeader)) || null;
}

function handleCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = (ev) => {
    const rows = parseCSV(ev.target.result);
    if (rows.length < 2) { appendLog('[SYSTEM] CSV kosong'); return; }
    const headers = rows[0];
    const fields = state.flow?.batch_fields || [];
    const fieldKeys = fields.map(f => f.key);
    const colMap = headers.map(h => {
      const clean = h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      return matchHeaderToFieldKey(clean, fieldKeys, fields);
    });
    // Log which columns got mapped vs skipped — helps diagnose mismatches
    const mapped = headers.map((h, i) => colMap[i] ? `"${h}"→${colMap[i]}` : `"${h}" (skip)`);
    appendLog(`[SYSTEM] CSV map: ${mapped.join(', ')}`);
    let imported = 0;
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      if (cells.every(c => !c.trim())) continue;
      const row = {};
      fieldKeys.forEach(k => row[k] = '');
      colMap.forEach((key, ci) => { if (key && ci < cells.length) row[key] = cells[ci].trim(); });
      state.queue.push(row);
      imported++;
    }
    render();
    appendLog(`[SYSTEM] ${imported} baris diimpor dari ${file.name}`);
  };
  reader.readAsText(file);
}

function closeAllMenus() {
  document.querySelectorAll('.q-menu').forEach(m => m.style.display = 'none');
}

function getDeviceLabel(id) {
  if (!id) return t('job.phone_auto');
  const h = state.deviceHealth[id] || {};
  return h.brand ? h.brand.charAt(0).toUpperCase() + h.brand.slice(1).toLowerCase() : id.slice(-6);
}

function getFileName(path) {
  if (!path) return '';
  return path.split('/').pop().split('\\').pop();
}

// Turn snake_case field keys into human-friendly labels.
// The explicit map is authoritative (overrides flow.json labels) so semantic
// fields stay consistent across platforms — e.g. TikTok uses `product_url`,
// Shopee uses `affiliate_link`, but both render as "Affiliate Link" in the UI.
const FIELD_LABELS = {
  affiliate_link: 'Affiliate Link',
  product_link: 'Affiliate Link',
  produk_link: 'Affiliate Link',
  product_url: 'Affiliate Link',
  shopee_link: 'Affiliate Link',
  video_path: 'Video',
  caption: 'Caption',
  hashtags: 'Hashtags',
  title: 'Judul',
  description: 'Deskripsi',
  url: 'URL',
  link: 'Link',
};
function prettifyLabel(field) {
  const key = field.key || '';
  // Map wins over flow.json's explicit label — keeps terminology consistent
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  if (field.label && field.label !== field.key) return field.label;
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Resolve which template will actually run for a given device.
 * Priority:
 *   1. Device's active override for the global template's platform
 *   2. The global selectedTemplate itself
 *   3. Fallback: any active override the device has (picks first — useful after
 *      app restart when selectedTemplate isn't persisted)
 * Returns { name, source: 'active'|'global'|null }
 */
export function resolveTemplateForItem(phoneId) {
  const globalName = state.selectedTemplate;
  if (!phoneId) return { name: globalName, source: globalName ? 'global' : null };
  const globalTpl = globalName ? state.templatesData?.[globalName] : null;
  const platform = globalTpl ? detectPlatformFromTemplate(globalTpl) : null;

  // 1. Explicit override for global template's platform
  if (platform) {
    const overrideName = getActiveTemplate(phoneId, platform);
    if (overrideName && overrideName !== globalName) {
      return { name: overrideName, source: 'active' };
    }
  }
  // 2. Global name (no override or override matches global)
  if (globalName) return { name: globalName, source: 'global' };
  // 3. No global at all — pick any device override (typical after app restart)
  const overrides = state.activeTemplates?.[phoneId] || {};
  const anyOverride = Object.values(overrides).find(Boolean);
  if (anyOverride) return { name: anyOverride, source: 'active' };
  return { name: null, source: null };
}

// Remap legacy/alternative keys in a queue item to the canonical field keys
// via the synonym dict. Used to auto-heal queues imported before synonym
// support existed (e.g. "product_url" → "affiliate_link").
export function healItemKeys(item, fieldKeys) {
  if (!item || !fieldKeys?.length) return item;
  for (const key of Object.keys(item)) {
    if (key.startsWith('_') || fieldKeys.includes(key)) continue;  // already canonical or internal
    // Find canonical whose synonyms include this key
    for (const canonical of fieldKeys) {
      const synonyms = HEADER_SYNONYMS[canonical];
      if (synonyms && synonyms.includes(key)) {
        if (!item[canonical] && item[key]) item[canonical] = item[key];
        delete item[key];
        break;
      }
    }
  }
  return item;
}

export async function render() {
  const panel = $('#page-queue');

  // Load saved queue from disk on first render
  if (!queueLoaded) {
    try {
      const saved = await invoke('get_queue');
      if (Array.isArray(saved) && saved.length && !state.queue.length) {
        state.queue = saved;
        // Any 'uploading' state on cold startup is stale (engine wasn't running).
        // Reset to 'pending' so user can see/retry without Ulangi gagal confusion.
        let stale = 0;
        state.queue.forEach(it => {
          if (it._status === 'uploading') { it._status = 'pending'; stale++; }
        });
        if (stale) {
          appendLog(`[SYSTEM] ${stale} item dari session lama direset ke Antri (status "Berjalan" tidak valid saat startup)`);
        }
      }
      queueLoaded = true;
    } catch (e) { queueLoaded = true; }
  }

  // Auto-heal keys against current flow's batch_fields
  const fieldKeysHeal = (state.flow?.batch_fields || []).map(f => f.key);
  if (fieldKeysHeal.length && state.queue.length) {
    let healed = 0;
    state.queue.forEach(it => {
      const before = Object.keys(it).sort().join(',');
      healItemKeys(it, fieldKeysHeal);
      if (before !== Object.keys(it).sort().join(',')) healed++;
    });
    if (healed > 0) {
      appendLog(`[SYSTEM] Auto-heal: ${healed} item key-nya dinormalisasi (product_url → affiliate_link, dll)`);
      autoSaveQueue();
    }
  }

  const fields = state.flow?.batch_fields || [];
  const queue = state.queue;
  const req = fields.filter(f => f.required);
  const validCount = queue.filter(item => item._status !== 'success' && req.every(f => (item[f.key] || '').trim())).length;

  const counts = { success: 0, failed: 0, uploading: 0, pending: 0 };
  queue.forEach(item => { counts[item._status || 'pending']++; });

  const platLabel = (state.platform === 'shopee_upload' || state.platform === 'shopee_upload_u2') ? 'Shopee' : 'TikTok';

  // ── Template context banner ──
  const hasTemplate = !!state.selectedTemplate;
  const tplName = state.selectedTemplate;
  const selectedIds = [...state.selectedDevices];

  // Full guard: if neither a selectedTemplate nor a loaded flow, block + redirect hint
  const hasAnyFlow = hasTemplate || !!state.flow;
  if (!hasAnyFlow) {
    panel.innerHTML = `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:var(--sp-6)">
        <div class="ui-card" style="max-width:420px;text-align:center;padding:var(--sp-6)">
          <div style="width:56px;height:56px;border-radius:var(--r-lg);background:var(--c-amber-a12);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-4)">
            <svg width="28" height="28" fill="none" stroke="var(--c-amber)" stroke-width="1.8" viewBox="0 0 24 24"><path d="M21 10H3M21 6H3M21 14H3M21 18H3"/></svg>
          </div>
          <h3 class="t-lg t-strong" style="margin-bottom:var(--sp-2)">${t('job.guard_title')}</h3>
          <p class="t-sm t-muted" style="margin-bottom:var(--sp-4);line-height:1.5">${t('job.guard_body')}</p>
          <button class="btn btn-primary" data-action="go-devices">${t('job.guard_btn')}</button>
        </div>
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    <div style="padding:var(--sp-4) var(--sp-4) var(--sp-2);flex-shrink:0">
      <h2 class="t-lg t-strong" style="margin:0">${t('job.title')}</h2>
      <p class="t-sm t-muted" style="margin-top:2px">${t('job.subtitle')}</p>
    </div>
    ${hasTemplate ? `
      <div style="margin:0 var(--sp-4) var(--sp-2);padding:var(--sp-3) var(--sp-4);background:var(--c-accent-a08);border:1px solid var(--c-accent-a15);border-radius:var(--r-md);display:flex;align-items:center;gap:var(--sp-3);flex-shrink:0">
        <svg width="16" height="16" fill="none" stroke="var(--c-accent)" stroke-width="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        <div style="flex:1;min-width:0">
          <div class="t-sm t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${t('job.ctx_template')} ${esc(tplName)}
          </div>
          <div class="t-xs t-muted" style="margin-top:1px">
            ${selectedIds.length ? selectedIds.map(id => esc(getSavedDeviceLabel(id, id.slice(-6)))).join(' · ') : t('job.ctx_no_phone')}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="go-devices">${t('job.ctx_change')}</button>
      </div>
    ` : ''}
    <!-- Toolbar -->
    <div style="padding:var(--sp-2) var(--sp-4);display:flex;align-items:center;gap:var(--sp-3);flex-shrink:0;border-bottom:1px solid var(--c-bg-2)">
      <!-- Stats -->
      <div style="display:flex;align-items:center;gap:var(--sp-3);min-width:0;flex:1">
        <span class="t-sm t-strong">${t('job.stat_videos', { n: queue.length })}</span>
        ${queue.length ? `<span class="t-xs" style="color:var(--c-fg-3)">·</span>` : ''}
        ${validCount ? `<span class="t-xs" style="color:var(--c-green)">${t('job.stat_ready', { n: validCount })}</span>` : ''}
        ${counts.uploading ? `<span class="t-xs" style="color:var(--c-amber)">${t('job.stat_running', { n: counts.uploading })}</span>` : ''}
        ${counts.success ? `<span class="t-xs" style="color:var(--c-green)">${t('job.stat_done', { n: counts.success })}</span>` : ''}
        ${counts.failed ? `<span class="t-xs" style="color:var(--c-red)">${t('job.stat_failed', { n: counts.failed })}</span>` : ''}
        <span id="q-sel-info" style="display:none;align-items:center;gap:var(--sp-2);margin-left:var(--sp-2)">
          <span class="ui-chip ui-chip-ok t-xs" style="padding:2px var(--sp-2)">${t('job.stat_selected', { n: '<span id="q-sel-count">0</span>' })}</span>
          <button class="btn btn-secondary btn-sm" data-action="assign-selected">${t('job.action_assign')}</button>
          <button class="btn btn-danger btn-sm" data-action="delete-selected">${t('job.action_delete_selected')}</button>
        </span>
      </div>
      <!-- Primary actions -->
      <button class="btn btn-ghost btn-sm" data-action="add-row" title="${esc(t('job.action_add_title'))}">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="margin-right:4px"><path d="M12 5v14M5 12h14"/></svg>
        ${t('job.action_add')}
      </button>
      <button class="btn btn-ghost btn-sm" data-action="csv-menu" title="${esc(t('job.action_csv_title'))}">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:4px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
        ${t('job.action_csv')}
        <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-left:2px"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <input type="file" id="csv-input" accept=".csv,.tsv,.txt" style="display:none">
      <button class="btn btn-ghost btn-sm btn-icon" data-action="more-menu" title="${esc(t('job.action_more'))}">
        <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>
      ${state.isRunning
        ? `<button class="btn btn-danger btn-sm" data-action="stop-all">
            <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24" style="margin-right:4px"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
            ${t('job.action_stop')}
          </button>`
        : `<button class="btn btn-primary btn-sm" data-action="run" ${validCount === 0 ? 'disabled' : ''} title="${esc(validCount === 0 ? t('job.run_empty_title') : t('job.run_start_title'))}">
            <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24" style="margin-right:4px"><path d="M8 5v14l11-7z"/></svg>
            ${t('job.action_run')}
          </button>`
      }
    </div>

    <!-- Table -->
    <div style="flex:1;overflow:auto;padding:8px 8px 0">
      ${!queue.length ? `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:var(--sp-2);color:var(--c-fg-3);padding:var(--sp-8)">
          <svg width="48" height="48" fill="none" stroke="var(--c-bg-3)" stroke-width="1.2" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          <p class="t-md t-strong" style="color:var(--c-fg-2);margin:var(--sp-2) 0 0">${t('job.empty_title')}</p>
          <p class="t-xs t-muted" style="margin:0;max-width:340px;text-align:center;line-height:1.5">${t('job.empty_hint')}</p>
        </div>
      ` : `
        <div class="card" style="overflow:visible">
        <table class="tbl">
          <thead><tr>
            <th style="width:32px;padding:8px 10px"><input type="checkbox" id="q-selall-tbl" style="accent-color:var(--c-accent)"></th>
            <th>${t('job.col_video')}</th>
            <th>${t('job.col_caption')}</th>
            <th style="width:140px">${t('job.col_hp')}</th>
            <th style="width:100px">${t('job.col_status')}</th>
            <th style="width:52px"></th>
          </tr></thead>
          <tbody>
            ${queue.map((item, i) => {
              const status = item._status || 'pending';
              const sm = {
                success: { cls: 'ui-chip-ok', l: t('q.status_done'), icon: '✓' },
                failed: { cls: 'ui-chip-err', l: t('q.status_failed'), icon: '✗' },
                uploading: { cls: 'ui-chip-warn', l: t('q.status_running'), icon: '▶' },
                pending: { cls: 'ui-chip', l: t('q.status_queued'), icon: '·' },
              };
              const b = sm[status] || sm.pending;
              const isDone = status === 'success';
              const fileName = getFileName(item.video_path);
              // HP cell: nickname + short-id. Fall back to "Auto" (italic) if not assigned.
              const phoneId = item._phone;
              const phoneH = phoneId ? (state.deviceHealth[phoneId] || {}) : null;
              const phoneNickname = phoneId
                ? (state.deviceLabels?.[phoneId] || (phoneH?.brand ? phoneH.brand.charAt(0).toUpperCase() + phoneH.brand.slice(1).toLowerCase() : phoneId.slice(-6)))
                : null;
              const phoneShortId = phoneId ? phoneId.slice(-6) : '';
              const isOpen = expandedRow === i;
              const caption = item.caption || '';
              const dimStyle = isDone ? 'opacity:.55;' : '';

              return `
              <!-- Summary row -->
              <tr data-qrow="${i}" style="cursor:pointer;${dimStyle}${isOpen ? 'background:var(--c-accent-a08)' : ''}" onmouseover="if(!${isOpen})this.style.background='var(--c-hover-20)'" onmouseout="if(!${isOpen})this.style.background='${isOpen ? 'var(--c-accent-a08)' : 'transparent'}'">
                <td style="padding:10px" onclick="event.stopPropagation()"><input type="checkbox" class="q-cb" data-i="${i}" style="accent-color:var(--c-accent)"></td>
                <td style="padding:10px 12px;vertical-align:middle;max-width:280px">
                  <div style="display:flex;align-items:center;gap:8px;min-width:0">
                    <span class="t-xs t-muted" style="min-width:22px;font-family:'IBM Plex Mono',monospace;flex-shrink:0">${i + 1}.</span>
                    ${isDone
                      ? `<div style="width:28px;height:22px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                          <svg width="14" height="14" fill="none" stroke="var(--c-green)" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                        </div>`
                      : `<div style="width:28px;height:22px;background:var(--c-bg-2);border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                          <svg width="11" height="11" fill="none" stroke="var(--c-fg-3)" stroke-width="2" viewBox="0 0 24 24"><path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/></svg>
                        </div>`
                    }
                    <span class="q-video-link" data-video-path="${esc(item.video_path || '')}" style="font-size:11px;color:${isDone ? 'var(--c-green)' : 'var(--c-fg-1)'};font-family:'IBM Plex Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:${item.video_path ? 'pointer' : 'default'};min-width:0;flex:1${isDone ? ';text-decoration:line-through' : ''}" title="${esc(item.video_path || '')}">${esc(fileName || t('job.no_video'))}</span>
                  </div>
                </td>
                <td style="padding:10px 12px;color:var(--c-fg-2);font-size:11px;max-width:260px;vertical-align:middle">
                  ${caption
                    ? `<span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.35;word-break:break-word">${esc(caption)}</span>`
                    : `<span style="color:var(--c-bg-3)">${t('job.no_caption')}</span>`}
                </td>
                <td style="padding:10px 12px;vertical-align:middle">
                  ${phoneId ? (() => {
                    const resolved = resolveTemplateForItem(phoneId);
                    const tplColor = resolved.source === 'active' ? 'var(--c-accent)' : 'var(--c-fg-3)';
                    const tplIcon = resolved.source === 'active' ? '★' : '→';
                    return `
                    <div style="min-width:0">
                      <div class="t-xs t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(phoneNickname)}</div>
                      ${resolved.name
                        ? `<div class="t-xs" style="font-size:9px;margin-top:2px;color:${tplColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(resolved.name)}${resolved.source === 'active' ? ' (aktif dari HP ini)' : ' (template global)'}">${tplIcon} ${esc(resolved.name)}</div>`
                        : `<div class="t-xs t-muted" style="font-size:9px;margin-top:2px">${t('job.template_none')}</div>`}
                    </div>`;
                  })() : `<span class="t-xs t-muted" style="font-style:italic">${t('job.phone_auto')}</span>`}
                </td>
                <td style="padding:10px 8px;vertical-align:middle">
                  ${status === 'uploading'
                    ? '<div style="display:flex;align-items:center;gap:4px"><span style="width:6px;height:6px;border-radius:50%;background:var(--c-amber);animation:pulse 1s infinite;flex-shrink:0"></span><span class="ui-chip ui-chip-warn t-xs" style="padding:2px var(--sp-2)">' + b.l + '</span></div>'
                    : '<span class="ui-chip ' + b.cls + ' t-xs" style="padding:2px var(--sp-2)"><span style="margin-right:3px">' + b.icon + '</span>' + b.l + '</span>'
                  }
                </td>
                <td style="padding:10px 8px;vertical-align:middle">
                  <div style="position:relative;display:flex;align-items:center;gap:2px;justify-content:flex-end">
                    <svg width="12" height="12" fill="none" stroke="var(--c-fg-3)" stroke-width="2" viewBox="0 0 24 24" style="transform:rotate(${isOpen ? '180' : '0'}deg);transition:transform .15s;flex-shrink:0"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                    <button class="q-kebab" data-row="${i}" style="background:none;border:none;color:var(--c-fg-2);cursor:pointer;padding:4px 6px;border-radius:3px;line-height:0;transition:all .1s" onmouseover="this.style.color='var(--c-fg-0)';this.style.background='var(--c-bg-2)'" onmouseout="this.style.color='var(--c-fg-2)';this.style.background='none'">
                      <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" style="pointer-events:none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                    </button>
                    <div class="q-menu" data-menu="${i}" style="display:none;position:absolute;right:0;top:100%;margin-top:2px;width:140px;background:var(--c-bg-card);border:none;border-radius:10px;z-index:50;overflow:hidden;box-shadow:0 8px 24px var(--c-shadow)">
                      <button data-action="duplicate" data-row="${i}" style="width:100%;text-align:left;padding:7px 12px;font-size:11px;color:var(--c-fg-1);border:none;background:transparent;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='var(--c-bg-2)'" onmouseout="this.style.background='transparent'">
                        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                        ${t('job.menu_duplicate')}
                      </button>
                      <div style="border-top:1px solid var(--c-bg-2)"></div>
                      <button data-action="delete" data-row="${i}" style="width:100%;text-align:left;padding:7px 12px;font-size:11px;color:var(--c-red);border:none;background:transparent;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='var(--c-bg-2)'" onmouseout="this.style.background='transparent'">
                        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        ${t('job.menu_delete')}
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
              <!-- Expanded edit form -->
              ${isOpen ? `
              <tr>
                <td colspan="6" style="padding:0;border-bottom:1px solid var(--c-bg-2)">
                  <div style="padding:var(--sp-4) var(--sp-4) var(--sp-4) 56px;background:var(--c-accent-a04);display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)">
                    ${fields.map(f => {
                      const isFile = f.key === 'video_path' || f.key.endsWith('_path') || f.key.endsWith('_file');
                      const isLong = f.key === 'caption' || f.key === 'description';
                      const span = (isFile || isLong) ? 'grid-column:1/3' : '';
                      const extraStyle = f.key.includes('hashtag') ? 'color:var(--c-accent)' : (isFile ? "font-family:'IBM Plex Mono',monospace" : '');
                      const reqMark = f.required ? '<span style="color:var(--c-red)"> *</span>' : '';
                      const labelClass = 't-xs t-muted';
                      const labelStyle = 'display:block;margin-bottom:var(--sp-1);font-weight:600';

                      if (isLong) {
                        return `<div style="${span}">
                          <label class="${labelClass}" style="${labelStyle}">${esc(prettifyLabel(f))}${reqMark}</label>
                          <textarea data-row="${i}" data-field="${f.key}" placeholder="${esc(f.placeholder || '')}" class="inp" style="width:100%;resize:vertical;min-height:56px;${extraStyle}">${esc(item[f.key] || '')}</textarea>
                        </div>`;
                      }

                      return `<div style="${span}">
                        <label class="${labelClass}" style="${labelStyle}">${esc(prettifyLabel(f))}${reqMark}</label>
                        <div style="display:flex;gap:var(--sp-2)">
                          <input type="text" value="${esc(item[f.key] || '')}" placeholder="${esc(f.placeholder || '')}" data-row="${i}" data-field="${f.key}" class="inp" style="flex:1;min-width:0;${extraStyle}">
                          ${isFile ? `<button class="btn btn-secondary btn-sm q-filepick" data-row="${i}" data-field="${f.key}" title="${esc(t('job.pick_file'))}">
                            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                          </button>` : ''}
                        </div>
                      </div>`;
                    }).join('')}
                  </div>
                </td>
              </tr>
              ` : ''}`;
            }).join('')}
          </tbody>
        </table>
        </div>
      `}
    </div>
  `;

  panel.querySelector('#csv-input')?.addEventListener('change', handleCSVImport);

  // Auto-save queue to disk
  if (queueLoaded) autoSaveQueue();
}
