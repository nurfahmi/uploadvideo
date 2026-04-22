// ── Upload Queue Page ─────────────────────────────────

import { $, esc, parseCSV } from '../utils/helpers.js';
import state, { set, on, emit, getDeviceLabel as getSavedDeviceLabel, getTestStatus } from '../state.js';
import { appendLog } from '../components/console-panel.js';
import { navigate } from '../router.js';

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
      if (a === 'clear-done') { const count = state.queue.filter(q => q._status === 'success').length; if (!count || !confirm(`Remove ${count} completed items?`)) return; state.queue = state.queue.filter(q => q._status !== 'success'); expandedRow = -1; render(); }
      if (a === 'clear-all') { if (!state.queue.length || !confirm(`Clear all ${state.queue.length} items in queue?`)) return; state.queue = []; expandedRow = -1; render(); }
      if (a === 'assign-selected') openAssignModal();
      if (a === 'go-devices') navigate('devices');
      if (a === 'csv-menu') { openCsvMenu(btn); return; }
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

  $('#modal-close')?.addEventListener('click', closeAssignModal);
  $('#modal-cancel')?.addEventListener('click', closeAssignModal);
  $('#modal-apply')?.addEventListener('click', applyAssign);

  on('flow', render);
  on('devices', render);
  on('selectedTemplate', render);
  on('platform', render);
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

function retryFailed() {
  state.queue.forEach(item => { if (item._status === 'failed') item._status = 'pending'; });
  render();
}

function toggleSelectAll(checked) {
  $('#page-queue').querySelectorAll('.q-cb').forEach(cb => cb.checked = checked);
  updateSelCount();
}

function updateSelCount() {
  const n = $('#page-queue').querySelectorAll('.q-cb:checked').length;
  const info = $('#page-queue').querySelector('#q-sel-info');
  if (info) info.style.display = n > 0 ? '' : 'none';
  if (info) { const span = info.querySelector('span'); if (span) span.textContent = n; }
}

function openAssignModal() {
  const n = $('#page-queue').querySelectorAll('.q-cb:checked').length;
  if (n === 0) { alert('Select videos first by checking the checkboxes.'); return; }
  $('#modal-count').textContent = `(${n} videos)`;
  const phoneSel = $('#modal-phone');
  phoneSel.innerHTML = '<option>Auto-distribute</option>' + state.devices.map(([id]) => {
    const h = state.deviceHealth[id] || {};
    const brand = h.brand ? h.brand.charAt(0).toUpperCase() + h.brand.slice(1).toLowerCase() : id.slice(-6);
    return `<option value="${esc(id)}">${esc(brand)}</option>`;
  }).join('');
  $('#assign-modal').style.display = 'flex';
}

function closeAssignModal() { $('#assign-modal').style.display = 'none'; }

function applyAssign() {
  const phone = $('#modal-phone').value;
  const flow = $('#modal-flow').value;
  $('#page-queue').querySelectorAll('.q-cb:checked').forEach(cb => {
    const i = parseInt(cb.dataset.i);
    if (phone !== 'Auto-distribute') state.queue[i]._phone = phone;
    if (flow) state.queue[i]._flow = flow;
  });
  closeAssignModal();
  render();
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
  const menuWidth = 260;
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
        <div class="t-sm t-strong">Impor CSV</div>
        <div class="t-xs t-muted" style="margin-top:1px">Dari file yang sudah kamu punya</div>
      </div>
    </button>
    <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;text-align:left;padding:var(--sp-2) var(--sp-3);height:auto${hasFlow ? '' : ';opacity:.5;pointer-events:none'}" data-csv-action="download" ${hasFlow ? '' : 'disabled'}>
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;margin-right:var(--sp-2)"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      <div style="flex:1;min-width:0">
        <div class="t-sm t-strong">Unduh template CSV</div>
        <div class="t-xs t-muted" style="margin-top:1px">${hasFlow ? 'Dengan kolom yang dibutuhkan template ini' : 'Pilih template dulu'}</div>
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
  const headers = fields.map(f => f.label || f.key);
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
      title: 'Simpan template CSV',
    });
    if (!chosen) return;  // user cancelled
    await invoke('write_text_file', { path: chosen, content: bom + csv });
    appendLog(`[SYSTEM] Template CSV disimpan: ${chosen}`);
    try {
      const { toast } = await import('../components/toast.js');
      toast.success(`Template CSV disimpan`, {
        title: chosen.split('/').pop(),
        duration: 6000,
      });
    } catch {}
  } catch (err) {
    appendLog(`[ERROR] Gagal simpan CSV: ${err}`);
  }
}

function handleCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = (ev) => {
    const rows = parseCSV(ev.target.result);
    if (rows.length < 2) { appendLog('[SYSTEM] CSV is empty'); return; }
    const headers = rows[0];
    const fields = state.flow?.batch_fields || [];
    const fieldKeys = fields.map(f => f.key);
    const colMap = headers.map(h => {
      const clean = h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      return fieldKeys.find(k => k === clean) || fields.find(f => f.label.toLowerCase().replace(/[^a-z0-9_]/g, '_') === clean)?.key || fieldKeys.find(k => clean.includes(k) || k.includes(clean)) || null;
    });
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
    appendLog(`[SYSTEM] Imported ${imported} rows from ${file.name}`);
  };
  reader.readAsText(file);
}

function closeAllMenus() {
  document.querySelectorAll('.q-menu').forEach(m => m.style.display = 'none');
}

function getDeviceLabel(id) {
  if (!id) return 'Auto';
  const h = state.deviceHealth[id] || {};
  return h.brand ? h.brand.charAt(0).toUpperCase() + h.brand.slice(1).toLowerCase() : id.slice(-6);
}

function getFileName(path) {
  if (!path) return '';
  return path.split('/').pop().split('\\').pop();
}

export async function render() {
  const panel = $('#page-queue');

  // Load saved queue from disk on first render
  if (!queueLoaded) {
    try {
      const saved = await invoke('get_queue');
      if (Array.isArray(saved) && saved.length && !state.queue.length) {
        state.queue = saved;
      }
      queueLoaded = true;
    } catch (e) { queueLoaded = true; }
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
          <h3 class="t-lg t-strong" style="margin-bottom:var(--sp-2)">Pilih template dulu</h3>
          <p class="t-sm t-muted" style="margin-bottom:var(--sp-4);line-height:1.5">Buka Perangkat, pilih HP, lalu klik <strong>Pakai →</strong> pada template yang sudah teruji.</p>
          <button class="btn btn-primary" data-action="go-devices">Ke Perangkat →</button>
        </div>
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    ${hasTemplate ? `
      <div style="padding:var(--sp-3) var(--sp-4);background:var(--c-accent-a08);border-bottom:1px solid var(--c-accent-a15);display:flex;align-items:center;gap:var(--sp-3);flex-shrink:0">
        <svg width="16" height="16" fill="none" stroke="var(--c-accent)" stroke-width="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        <div style="flex:1;min-width:0">
          <div class="t-sm t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            Template: ${esc(tplName)}
          </div>
          <div class="t-xs t-muted" style="margin-top:1px">
            ${selectedIds.length ? selectedIds.map(id => esc(getSavedDeviceLabel(id, id.slice(-6)))).join(' · ') : 'Belum ada HP dipilih'}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="go-devices">Ganti</button>
      </div>
    ` : ''}
    <!-- Toolbar -->
    <div style="padding:8px 16px;display:flex;align-items:center;gap:8px;flex-shrink:0">
      <span style="font-size:11px;font-weight:600;color:var(--c-fg-0)">${queue.length} videos</span>
      <span style="font-size:10px;color:var(--c-bg-3)">|</span>
      <span style="font-size:10px;color:var(--c-green);font-weight:500">${validCount} ready</span>
      ${counts.success ? `<span style="font-size:10px;color:var(--c-green)">${counts.success} done</span>` : ''}
      ${counts.failed ? `<span style="font-size:10px;color:var(--c-red)">${counts.failed} failed</span>` : ''}
      ${counts.uploading ? `<span style="font-size:10px;color:var(--c-amber)">${counts.uploading} uploading</span>` : ''}
      <span id="q-sel-info" style="font-size:10px;color:var(--c-accent);display:none">(<span>0</span> selected)</span>
      <div style="flex:1"></div>
      <button class="btn" id="q-assign-btn" data-action="assign-selected">Assign</button>
      ${counts.failed ? `<button class="btn btn-danger" data-action="retry-failed">Retry</button>` : ''}
      ${counts.success ? `<button class="btn" data-action="clear-done">Clear done</button>` : ''}
      ${queue.length ? `<button class="btn" data-action="clear-all">Clear all</button>` : ''}
      <button class="btn" data-action="csv-menu">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:4px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
        CSV
        <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-left:2px"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <input type="file" id="csv-input" accept=".csv,.tsv,.txt" style="display:none">
      <button class="btn btn-primary" data-action="add-row">Add video
      </button>
    </div>

    <!-- Table -->
    <div style="flex:1;overflow:auto;padding:8px 8px 0">
      ${!queue.length ? `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;color:var(--c-fg-3)">
          <svg width="40" height="40" fill="none" stroke="var(--c-bg-2)" stroke-width="1" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          <p style="font-size:12px">Queue is empty</p>
          <p style="font-size:10px;color:var(--c-bg-3)">Click "+ Add" to add videos or "Import CSV" to bulk import</p>
        </div>
      ` : `
        <div class="card" style="overflow:visible">
        <table class="tbl">
          <thead><tr>
            <th style="width:28px;padding:6px 10px"><input type="checkbox" id="q-selall-tbl" style="accent-color:var(--c-accent)"></th>
            <th style="width:28px">#</th>
            <th>Video</th>
            <th>Caption</th>
            <th style="width:40px">Flow</th>
            <th style="width:60px">Phone</th>
            <th style="width:65px">Status</th>
            <th style="width:36px"></th>
          </tr></thead>
          <tbody>
            ${queue.map((item, i) => {
              const status = item._status || 'pending';
              const sm = { success: { c: 'green', l: 'Done' }, failed: { c: 'red', l: 'Failed' }, uploading: { c: 'amber', l: 'Running' }, pending: { c: 'gray', l: 'Queued' } };
              const b = sm[status] || sm.pending;
              const isDone = status === 'success';
              const fileName = getFileName(item.video_path);
              const phoneLabel = getDeviceLabel(item._phone);
              const flowId = item._flow || state.platform;
              const flowBrand = (flowId === 'shopee_upload' || flowId === 'shopee_upload_u2') ? 'shopee' : flowId === 'tiktok_upload' ? 'tiktok' : '';
              const isOpen = expandedRow === i;
              const caption = item.caption || '';
              const captionPreview = caption.length > 40 ? caption.slice(0, 40) + '...' : caption;
              const dimStyle = isDone ? 'opacity:.45;' : '';

              return `
              <!-- Summary row -->
              <tr data-qrow="${i}" style="cursor:pointer;${dimStyle}${isOpen ? 'background:var(--c-accent-a04);border-left:2px solid var(--c-accent)' : ''}" onmouseover="if(!${isOpen})this.style.background='var(--c-hover-20)'" onmouseout="if(!${isOpen})this.style.background='${isOpen ? 'var(--c-accent-a04)' : 'transparent'}'">
                <td style="padding:4px 10px" onclick="event.stopPropagation()"><input type="checkbox" class="q-cb" data-i="${i}" style="accent-color:var(--c-accent)" ${isDone ? 'disabled' : ''}></td>
                <td style="color:var(--c-bg-3);font-size:10px;font-family:'IBM Plex Mono',monospace">${i + 1}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px">
                    ${isDone
                      ? `<div style="width:28px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                          <svg width="14" height="14" fill="none" stroke="var(--c-green)" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                        </div>`
                      : `<div style="width:28px;height:20px;background:var(--c-bg-2);border-radius:3px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                          <svg width="10" height="10" fill="none" stroke="var(--c-fg-3)" stroke-width="2" viewBox="0 0 24 24"><path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/></svg>
                        </div>`
                    }
                    <span class="q-video-link" data-video-path="${esc(item.video_path || '')}" style="font-size:10px;color:${isDone ? 'var(--c-green)' : 'var(--c-fg-1)'};font-family:'IBM Plex Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:${item.video_path ? 'pointer' : 'default'}${isDone ? ';text-decoration:line-through' : ''}" title="${esc(item.video_path || '')}">${esc(fileName || 'No video')}</span>
                  </div>
                </td>
                <td style="color:var(--c-fg-2);font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(captionPreview) || '<span style="color:var(--c-bg-3)">No caption</span>'}</td>
                <td style="text-align:center"><span title="${flowId === 'shopee_upload' ? 'Shopee Video' : flowId === 'shopee_upload_u2' ? 'Shopee Video (u2)' : flowId === 'tiktok_upload' ? 'TikTok Upload' : flowId}" style="cursor:default;display:inline-flex">${FLOW_ICONS[flowBrand] || flowId}</span></td>
                <td style="font-size:10px;color:var(--c-fg-2)">${phoneLabel}</td>
                <td>
                  ${status === 'uploading'
                    ? '<div style="display:flex;align-items:center;gap:3px"><div style="width:40px;height:3px;background:var(--c-bg-2);border-radius:2px;overflow:hidden"><div style="width:65%;height:100%;background:var(--c-amber);border-radius:2px"></div></div><span style="font-size:8px;color:var(--c-amber)">65%</span></div>'
                    : '<span class="badge b-' + b.c + '">' + b.l + '</span>'
                  }
                </td>
                <td>
                  <div style="position:relative">
                    <button class="q-kebab" data-row="${i}" style="background:none;border:none;color:var(--c-fg-2);cursor:pointer;padding:4px 6px;border-radius:3px;line-height:0;transition:all .1s" onmouseover="this.style.color='var(--c-fg-0)';this.style.background='var(--c-bg-2)'" onmouseout="this.style.color='var(--c-fg-2)';this.style.background='none'">
                      <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" style="pointer-events:none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                    </button>
                    <div class="q-menu" data-menu="${i}" style="display:none;position:absolute;right:0;top:100%;margin-top:2px;width:140px;background:var(--c-bg-card);border:none;border-radius:10px;z-index:50;overflow:hidden;box-shadow:0 8px 24px var(--c-shadow)">
                      <button data-action="duplicate" data-row="${i}" style="width:100%;text-align:left;padding:7px 12px;font-size:11px;color:var(--c-fg-1);border:none;background:transparent;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='var(--c-bg-2)'" onmouseout="this.style.background='transparent'">
                        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                        Duplicate
                      </button>
                      <div style="border-top:1px solid var(--c-bg-2)"></div>
                      <button data-action="delete" data-row="${i}" style="width:100%;text-align:left;padding:7px 12px;font-size:11px;color:var(--c-red);border:none;background:transparent;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='var(--c-bg-2)'" onmouseout="this.style.background='transparent'">
                        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        Delete
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
              <!-- Expanded edit form -->
              ${isOpen ? `
              <tr>
                <td colspan="8" style="padding:0;border-bottom:1px solid var(--c-bg-2)">
                  <div style="padding:12px 16px 12px 48px;background:var(--c-accent-a04);display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    <div>
                      <label style="font-size:9px;color:var(--c-fg-3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:3px">Flow</label>
                      <select data-row="${i}" data-field="_flow" class="inp" style="width:100%;font-size:10px">
                        <option value="shopee_upload" ${(item._flow || state.platform) === 'shopee_upload' ? 'selected' : ''}>Shopee Video</option>
                        <option value="shopee_upload_u2" ${(item._flow || state.platform) === 'shopee_upload_u2' ? 'selected' : ''}>Shopee Video (u2, cross-device)</option>
                        <option value="tiktok_upload" ${(item._flow || state.platform) === 'tiktok_upload' ? 'selected' : ''}>TikTok Upload</option>
                      </select>
                    </div>
                    ${fields.map(f => {
                      const isFile = f.key === 'video_path' || f.key.endsWith('_path') || f.key.endsWith('_file');
                      const isLong = f.key === 'caption' || f.key === 'description';
                      const span = (isFile || isLong) ? 'grid-column:1/3' : '';
                      const extraStyle = f.key.includes('hashtag') ? 'color:var(--c-accent)' : (isFile ? "font-family:'IBM Plex Mono',monospace" : '');
                      const reqMark = f.required ? '<span style="color:var(--c-red)"> *</span>' : '';

                      if (isLong) {
                        return `<div style="${span}">
                          <label style="font-size:9px;color:var(--c-fg-3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:3px">${esc(f.label || f.key)}${reqMark}</label>
                          <textarea data-row="${i}" data-field="${f.key}" placeholder="${esc(f.placeholder || '')}" class="inp" style="width:100%;font-size:10px;resize:vertical;min-height:50px;${extraStyle}">${esc(item[f.key] || '')}</textarea>
                        </div>`;
                      }

                      return `<div style="${span}">
                        <label style="font-size:9px;color:var(--c-fg-3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:3px">${esc(f.label || f.key)}${reqMark}</label>
                        <div style="display:flex;gap:4px">
                          <input type="text" value="${esc(item[f.key] || '')}" placeholder="${esc(f.placeholder || '')}" data-row="${i}" data-field="${f.key}" class="inp" style="width:100%;font-size:10px;${extraStyle}">
                          ${isFile ? `<button class="btn q-filepick" data-row="${i}" data-field="${f.key}" style="padding:2px 8px;font-size:9px;white-space:nowrap;flex-shrink:0" title="Browse file">📂</button>` : ''}
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
