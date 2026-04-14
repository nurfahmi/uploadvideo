// ── Live Monitor Page ──────────────────────────────────

import { $, esc } from '../utils/helpers.js';
import state, { set, on, emit } from '../state.js';
import { navigate } from '../router.js';

export function init() {
  const panel = $('#page-monitor');
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'stop-all') emit('stop-automation');
    if (btn.dataset.action === 'back-queue') navigate('queue');
  });

  on('isRunning', render);
  on('progress', () => { if (state.activeRoute === 'monitor') render(); });
}

export function render() {
  const panel = $('#page-monitor');
  const progress = state.deviceProgress;
  const finished = state.finishedCount;
  const total = state.totalEngines;
  const isRunning = state.isRunning;
  const isDone = !isRunning && total > 0 && finished >= total;

  const successCount = state.queue.filter(q => q._status === 'success').length;
  const failedCount = state.queue.filter(q => q._status === 'failed').length;
  const totalItems = state.queue.length;

  const devices = [...state.selectedDevices].map(devId => {
    const short = devId.length > 8 ? devId.slice(-6) : devId;
    const h = state.deviceHealth[devId] || {};
    const brand = h.brand ? h.brand.charAt(0).toUpperCase() + h.brand.slice(1).toLowerCase() : '';
    const model = brand || h.model || state.devices.find(d => d[0] === devId)?.[1] || short;
    const p = progress[short] || { step: 'Waiting...', percent: 0, status: 'waiting' };
    return { devId, short, model, ...p };
  });

  // Need actual hex for color+alpha suffixes in inline SVG (e.g. ${c}15)
  const cs = getComputedStyle(document.documentElement);
  const colors = [cs.getPropertyValue('--c-accent').trim(), cs.getPropertyValue('--c-purple').trim(), cs.getPropertyValue('--c-cyan').trim(), cs.getPropertyValue('--c-amber').trim(), cs.getPropertyValue('--c-red').trim()];

  panel.innerHTML = `
    <!-- Header bar -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px">
        <h2 style="font-size:15px;font-weight:700;color:var(--c-fg-0);margin:0">Live Monitor</h2>
        <span class="badge ${isDone ? 'b-green' : isRunning ? 'b-amber pulse' : 'b-gray'}">
          ${isDone ? 'Completed' : isRunning ? 'Running' : 'Idle'}
        </span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        ${isRunning ? `
          <button class="mon-icon-btn" data-action="stop-all" title="Stop All">
            <svg width="16" height="16" fill="var(--c-red)" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>
          </button>
        ` : ''}
        <button class="mon-icon-btn" data-action="back-queue" title="Back to Queue">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 12H5m0 0l7 7m-7-7l7-7"/></svg>
        </button>
      </div>
    </div>

    ${isDone ? `
    <!-- Completion summary -->
    <div style="background:linear-gradient(135deg,var(--c-green-a08),var(--c-accent-a04));border:1px solid var(--c-green-a15);border-radius:10px;padding:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--c-green-a15);display:flex;align-items:center;justify-content:center">
          <svg width="20" height="20" fill="none" stroke="var(--c-green)" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <div>
          <p style="font-size:14px;font-weight:700;color:var(--c-fg-0);margin:0">Upload Complete</p>
          <p style="font-size:11px;color:var(--c-fg-2);margin:0">${totalItems} video${totalItems > 1 ? 's' : ''} processed</p>
        </div>
      </div>
      <div style="display:flex;gap:20px">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="width:8px;height:8px;border-radius:50%;background:var(--c-green)"></div>
          <span style="font-size:13px;font-weight:600;color:var(--c-green)">${successCount} success</span>
        </div>
        ${failedCount > 0 ? `
        <div style="display:flex;align-items:center;gap:6px">
          <div style="width:8px;height:8px;border-radius:50%;background:var(--c-red)"></div>
          <span style="font-size:13px;font-weight:600;color:var(--c-red)">${failedCount} failed</span>
        </div>
        ` : ''}
      </div>
    </div>
    ` : ''}

    <!-- Device cards -->
    <div style="display:flex;flex-direction:column;gap:10px">
      ${devices.length ? devices.map((d, idx) => {
        const c = colors[idx % colors.length];
        const isDevDone = d.status === 'done' || d.status === 'error';
        const badgeClass = d.status === 'error' ? 'b-red' : isDevDone ? 'b-green' : d.status === 'waiting' ? 'b-gray' : 'b-amber';
        const badgeLabel = d.status === 'error' ? 'Failed' : isDevDone ? 'Done' : d.status === 'waiting' ? 'Waiting' : 'Uploading';

        return `
          <div class="monitor-card">
            <div class="progress-bg" style="width:${d.percent}%;background:${c}"></div>
            <div style="position:relative;z-index:1">
              <!-- Device header -->
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="width:28px;height:28px;border-radius:6px;background:${c}15;border:1px solid ${c}30;display:flex;align-items:center;justify-content:center">
                    <svg width="14" height="14" fill="none" stroke="${c}" stroke-width="2" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18" stroke-linecap="round" stroke-width="3"/></svg>
                  </div>
                  <div>
                    <span style="font-size:12px;font-weight:600;color:var(--c-fg-0);display:block;line-height:1.2">${esc(d.model)}</span>
                    <span style="font-size:9px;color:var(--c-fg-3);font-family:'IBM Plex Mono',monospace">${esc(d.short)}</span>
                  </div>
                </div>
                <span class="badge ${badgeClass}">${badgeLabel}</span>
              </div>

              <!-- Current video + step info -->
              ${d.videoName ? `
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:4px 8px;background:var(--c-accent-a04);border-radius:4px;border:1px solid var(--c-accent-a10)">
                <svg width="12" height="12" fill="none" stroke="var(--c-accent)" stroke-width="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span style="font-size:10px;color:var(--c-accent);font-family:'IBM Plex Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.videoName)}</span>
              </div>
              ` : ''}
              <p style="font-size:10px;color:var(--c-fg-2);margin:0 0 8px 0">
                <span style="color:var(--c-fg-1);font-weight:600">${esc(d.step)}</span>${d.stepDesc ? ` <span style="color:var(--c-fg-3)">—</span> ${esc(d.stepDesc)}` : ''}
              </p>

              <!-- Progress bar -->
              <div style="display:flex;align-items:center;gap:10px">
                <div style="flex:1;height:4px;background:var(--c-bg-2);border-radius:2px;overflow:hidden">
                  <div style="width:${d.percent}%;height:100%;background:${c};border-radius:2px;transition:width .3s"></div>
                </div>
                <span style="font-size:10px;color:${c};font-weight:700;min-width:32px;text-align:right;font-family:'IBM Plex Mono',monospace">${d.percent}%</span>
              </div>
            </div>
          </div>`;
      }).join('') : `
        <div style="text-align:center;padding:40px 20px;color:var(--c-fg-3)">
          <svg width="40" height="40" fill="none" stroke="var(--c-bg-2)" stroke-width="1.5" viewBox="0 0 24 24" style="margin-bottom:8px"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          <p style="font-size:12px;margin:0">No active automation</p>
          <p style="font-size:10px;color:var(--c-bg-3);margin-top:4px">Start an upload from the Queue page</p>
        </div>
      `}
    </div>
  `;
}
