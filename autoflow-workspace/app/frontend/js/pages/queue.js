// ── Upload Queue Page ─────────────────────────────────

import { $, esc, parseCSV } from '../utils/helpers.js';
import state, { set, on, emit } from '../state.js';
import { appendLog } from '../components/console-panel.js';

const { invoke } = window.__TAURI__.core;

let expandedRow = -1; // which row is expanded for editing

export function init() {
  const panel = $('#page-queue');

  panel.addEventListener('input', (e) => {
    if (e.target.dataset.field !== undefined && e.target.dataset.row !== undefined) {
      state.queue[parseInt(e.target.dataset.row)][e.target.dataset.field] = e.target.value;
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
      if (a === 'clear-all') { state.queue = []; expandedRow = -1; render(); }
      if (a === 'assign-selected') openAssignModal();
      return;
    }

    // Click row to expand (not on interactive elements)
    if (!e.target.closest('input') && !e.target.closest('button') && !e.target.closest('.q-menu') && !e.target.closest('textarea') && !e.target.closest('.q-kebab')) {
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
  const assignBtn = $('#page-queue').querySelector('#q-assign-btn');
  if (info) info.style.display = n > 0 ? '' : 'none';
  if (info) { const span = info.querySelector('span'); if (span) span.textContent = n; }
  if (assignBtn) assignBtn.style.display = n > 0 ? '' : 'none';
}

function openAssignModal() {
  const n = $('#page-queue').querySelectorAll('.q-cb:checked').length;
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

export function render() {
  const panel = $('#page-queue');
  const fields = state.flow?.batch_fields || [];
  const queue = state.queue;
  const req = fields.filter(f => f.required);
  const validCount = queue.filter(item => req.every(f => (item[f.key] || '').trim())).length;

  const counts = { success: 0, failed: 0, uploading: 0, pending: 0 };
  queue.forEach(item => { counts[item._status || 'pending']++; });

  const platLabel = state.platform === 'shopee_upload' ? 'Shopee' : 'TikTok';

  panel.innerHTML = `
    <!-- Toolbar -->
    <div style="padding:8px 16px;border-bottom:1px solid #21262d;display:flex;align-items:center;gap:8px;flex-shrink:0;background:#161b22">
      <span style="font-size:11px;font-weight:600;color:#f0f6fc">${queue.length} videos</span>
      <span style="font-size:10px;color:#30363d">|</span>
      <span style="font-size:10px;color:#3fb950;font-weight:500">${validCount} ready</span>
      ${counts.success ? `<span style="font-size:10px;color:#3fb950">${counts.success} done</span>` : ''}
      ${counts.failed ? `<span style="font-size:10px;color:#f85149">${counts.failed} failed</span>` : ''}
      ${counts.uploading ? `<span style="font-size:10px;color:#d29922">${counts.uploading} uploading</span>` : ''}
      <span id="q-sel-info" style="font-size:10px;color:#58a6ff;display:none">(<span>0</span> selected)</span>
      <div style="flex:1"></div>
      <button id="q-assign-btn" class="btn btn-accent" style="display:none" data-action="assign-selected">Assign</button>
      ${counts.failed ? '<button class="btn btn-danger" data-action="retry-failed">Retry failed</button>' : ''}
      ${queue.length ? '<button class="btn" style="color:#484f58" data-action="clear-all">Clear</button>' : ''}
      <button class="btn" data-action="import-csv">Import CSV</button>
      <input type="file" id="csv-input" accept=".csv,.tsv,.txt" style="display:none">
      <button class="btn btn-primary" data-action="add-row">+ Add</button>
    </div>

    <!-- Table -->
    <div style="flex:1;overflow:auto">
      ${!queue.length ? `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;color:#484f58">
          <svg width="40" height="40" fill="none" stroke="#21262d" stroke-width="1" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          <p style="font-size:12px">Queue is empty</p>
          <p style="font-size:10px;color:#30363d">Click "+ Add" to add videos or "Import CSV" to bulk import</p>
        </div>
      ` : `
        <table class="tbl">
          <thead><tr>
            <th style="width:28px;padding:6px 10px"><input type="checkbox" id="q-selall-tbl" style="accent-color:#58a6ff"></th>
            <th style="width:28px">#</th>
            <th>Video</th>
            <th>Caption</th>
            <th style="width:60px">Phone</th>
            <th style="width:65px">Status</th>
            <th style="width:36px"></th>
          </tr></thead>
          <tbody>
            ${queue.map((item, i) => {
              const status = item._status || 'pending';
              const sm = { success: { c: 'green', l: 'Done' }, failed: { c: 'red', l: 'Failed' }, uploading: { c: 'amber', l: 'Running' }, pending: { c: 'gray', l: 'Queued' } };
              const b = sm[status] || sm.pending;
              const fileName = getFileName(item.video_path);
              const phoneLabel = getDeviceLabel(item._phone);
              const isOpen = expandedRow === i;
              const caption = item.caption || '';
              const captionPreview = caption.length > 40 ? caption.slice(0, 40) + '...' : caption;

              return `
              <!-- Summary row -->
              <tr data-qrow="${i}" style="cursor:pointer;${isOpen ? 'background:rgba(88,166,255,.04);border-left:2px solid #58a6ff' : ''}" onmouseover="if(!${isOpen})this.style.background='rgba(48,54,61,.2)'" onmouseout="if(!${isOpen})this.style.background='${isOpen ? 'rgba(88,166,255,.04)' : 'transparent'}'">
                <td style="padding:4px 10px" onclick="event.stopPropagation()"><input type="checkbox" class="q-cb" data-i="${i}" style="accent-color:#58a6ff"></td>
                <td style="color:#30363d;font-size:10px;font-family:'IBM Plex Mono',monospace">${i + 1}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px">
                    <div style="width:28px;height:20px;background:#21262d;border-radius:3px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                      <svg width="10" height="10" fill="none" stroke="#484f58" stroke-width="2" viewBox="0 0 24 24"><path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/></svg>
                    </div>
                    <span style="font-size:10px;color:#c9d1d9;font-family:'IBM Plex Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.video_path || '')}">${esc(fileName || 'No video')}</span>
                  </div>
                </td>
                <td style="color:#8b949e;font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(captionPreview) || '<span style="color:#30363d">No caption</span>'}</td>
                <td style="font-size:10px;color:#8b949e">${phoneLabel}</td>
                <td>
                  ${status === 'uploading'
                    ? '<div style="display:flex;align-items:center;gap:3px"><div style="width:40px;height:3px;background:#21262d;border-radius:2px;overflow:hidden"><div style="width:65%;height:100%;background:#d29922;border-radius:2px"></div></div><span style="font-size:8px;color:#d29922">65%</span></div>'
                    : '<span class="badge b-' + b.c + '">' + b.l + '</span>'
                  }
                </td>
                <td>
                  <div style="position:relative">
                    <button class="q-kebab" data-row="${i}" style="background:none;border:none;color:#8b949e;cursor:pointer;padding:4px 6px;border-radius:3px;line-height:0;transition:all .1s" onmouseover="this.style.color='#f0f6fc';this.style.background='#21262d'" onmouseout="this.style.color='#8b949e';this.style.background='none'">
                      <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" style="pointer-events:none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                    </button>
                    <div class="q-menu" data-menu="${i}" style="display:none;position:absolute;right:0;top:100%;margin-top:2px;width:140px;background:#161b22;border:1px solid #30363d;border-radius:6px;z-index:50;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.4)">
                      <button data-action="duplicate" data-row="${i}" style="width:100%;text-align:left;padding:7px 12px;font-size:11px;color:#c9d1d9;border:none;background:transparent;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='#21262d'" onmouseout="this.style.background='transparent'">
                        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                        Duplicate
                      </button>
                      <div style="border-top:1px solid #21262d"></div>
                      <button data-action="delete" data-row="${i}" style="width:100%;text-align:left;padding:7px 12px;font-size:11px;color:#f85149;border:none;background:transparent;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='#21262d'" onmouseout="this.style.background='transparent'">
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
                <td colspan="7" style="padding:0;border-bottom:1px solid #21262d">
                  <div style="padding:12px 16px 12px 48px;background:rgba(88,166,255,.02);display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    <div style="grid-column:1/3">
                      <label style="font-size:9px;color:#484f58;font-weight:600;display:block;margin-bottom:3px">VIDEO PATH</label>
                      <input type="text" value="${esc(item.video_path || '')}" placeholder="/path/to/video.mp4" data-row="${i}" data-field="video_path" class="inp" style="width:100%;font-size:10px;font-family:'IBM Plex Mono',monospace">
                    </div>
                    <div style="grid-column:1/3">
                      <label style="font-size:9px;color:#484f58;font-weight:600;display:block;margin-bottom:3px">CAPTION</label>
                      <textarea data-row="${i}" data-field="caption" placeholder="Write caption..." class="inp" style="width:100%;font-size:10px;resize:vertical;min-height:50px">${esc(item.caption || '')}</textarea>
                    </div>
                    <div>
                      <label style="font-size:9px;color:#484f58;font-weight:600;display:block;margin-bottom:3px">HASHTAGS</label>
                      <input type="text" value="${esc(item.hashtags || '')}" placeholder="#shopee #promo #viral" data-row="${i}" data-field="hashtags" class="inp" style="width:100%;font-size:10px;color:#58a6ff">
                    </div>
                    <div>
                      <label style="font-size:9px;color:#484f58;font-weight:600;display:block;margin-bottom:3px">PRODUCT LINK</label>
                      <input type="text" value="${esc(item.product_url || '')}" placeholder="https://shopee.co.id/..." data-row="${i}" data-field="product_url" class="inp" style="width:100%;font-size:10px">
                    </div>
                  </div>
                </td>
              </tr>
              ` : ''}`;
            }).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  panel.querySelector('#csv-input')?.addEventListener('change', handleCSVImport);
}
