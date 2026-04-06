// ── Upload Queue Page ─────────────────────────────────

import { $, esc, parseCSV } from '../utils/helpers.js';
import state, { set, on, emit } from '../state.js';
import { appendLog } from '../components/console-panel.js';

export function init() {
  const panel = $('#page-queue');

  panel.addEventListener('input', (e) => {
    if (e.target.dataset.field !== undefined) {
      state.queue[parseInt(e.target.dataset.row)][e.target.dataset.field] = e.target.value;
    }
  });

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const i = parseInt(btn.dataset.row);
    if (btn.dataset.action === 'delete') { state.queue.splice(i, 1); render(); }
    if (btn.dataset.action === 'duplicate') { state.queue.splice(i + 1, 0, { ...state.queue[i] }); render(); }
  });

  on('platform', render);
  on('flow', render);
}

export function renderActions(container) {
  container.innerHTML = `
    <span id="queue-count" class="text-[10px] text-slate-500 font-medium uppercase tracking-wider mr-4"></span>
    <button id="btn-import-csv-new" class="text-xs text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1 font-medium cursor-pointer">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
      Import CSV
    </button>
    <input type="file" id="csv-file-input-new" accept=".csv,.tsv,.txt" class="hidden" />
    <button id="btn-add-row-new" class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 font-medium cursor-pointer">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
      Add Row
    </button>
  `;

  container.querySelector('#btn-add-row-new')?.addEventListener('click', addRow);
  container.querySelector('#btn-import-csv-new')?.addEventListener('click', () => {
    container.querySelector('#csv-file-input-new')?.click();
  });
  container.querySelector('#csv-file-input-new')?.addEventListener('change', handleCSVImport);
}

function addRow() {
  const fields = state.flow?.batch_fields || [];
  const empty = {};
  fields.forEach(f => empty[f.key] = '');
  state.queue.push(empty);
  render();
}

function handleCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    const rows = parseCSV(text);
    if (rows.length < 2) { appendLog('[SYSTEM] CSV is empty or has no data rows'); return; }

    const headers = rows[0];
    const fields = state.flow?.batch_fields || [];
    const fieldKeys = fields.map(f => f.key);

    const colMap = headers.map(h => {
      const clean = h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const exact = fieldKeys.find(k => k === clean);
      if (exact) return exact;
      const byLabel = fields.find(f => f.label.toLowerCase().replace(/[^a-z0-9_]/g, '_') === clean);
      if (byLabel) return byLabel.key;
      const partial = fieldKeys.find(k => clean.includes(k) || k.includes(clean));
      return partial || null;
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
    const unmapped = headers.filter((h, i) => !colMap[i]).map(h => h.trim());
    if (unmapped.length) appendLog(`[SYSTEM] Skipped columns: ${unmapped.join(', ')}`);
  };
  reader.readAsText(file);
}

export function render() {
  const panel = $('#page-queue');
  const fields = state.flow?.batch_fields || [];
  const queue = state.queue;

  const validCount = queue.filter(item => {
    const req = fields.filter(f => f.required);
    return req.every(f => (item[f.key] || '').trim());
  }).length;
  const devCount = state.selectedDevices.size;

  // Update count in header
  const countEl = document.getElementById('queue-count');
  if (countEl) countEl.textContent = `${queue.length} items · ${validCount} ready · ${devCount} devices`;

  panel.innerHTML = `
    <div class="flex-1 overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-slate-900 z-10">
          <tr class="border-b border-slate-800">
            <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>
            ${fields.map(f => `<th class="px-2 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">${f.label}${f.required ? '<span class="text-red-400 ml-0.5">*</span>' : ''}</th>`).join('')}
            <th class="px-2 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-16">Status</th>
            <th class="px-2 py-2 w-16"></th>
          </tr>
        </thead>
        <tbody>
          ${!queue.length ? `
            <tr><td colspan="${fields.length+3}" class="px-5 py-8 text-center text-slate-600 text-xs italic">No items. Click "Add Row" or "Import CSV" to start.</td></tr>
          ` : queue.map((item, i) => {
            const status = item._status || 'pending';
            const statusBadge = {
              pending: '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-500/10 text-slate-500">Pending</span>',
              uploading: '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 animate-pulse">Uploading</span>',
              success: '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">Success</span>',
              failed: '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">Failed</span>',
            };
            return `
              <tr class="border-b border-slate-800/50 hover:bg-slate-900/50 group">
                <td class="px-3 py-1.5 text-slate-600 font-mono text-[10px]">${i+1}</td>
                ${fields.map(f => `<td class="px-2 py-1"><input type="text" value="${esc(item[f.key]||'')}" placeholder="${f.placeholder||''}" data-row="${i}" data-field="${f.key}" class="w-full bg-slate-800/50 border border-slate-700/50 rounded px-2 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"/></td>`).join('')}
                <td class="px-2 py-1.5">${statusBadge[status] || statusBadge.pending}</td>
                <td class="px-2 py-1.5">
                  <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button data-action="duplicate" data-row="${i}" title="Duplicate" class="p-1 text-slate-600 hover:text-slate-300 rounded hover:bg-slate-800 cursor-pointer">
                      <svg class="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                    </button>
                    <button data-action="delete" data-row="${i}" title="Delete" class="p-1 text-slate-600 hover:text-red-400 rounded hover:bg-slate-800 cursor-pointer">
                      <svg class="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}
