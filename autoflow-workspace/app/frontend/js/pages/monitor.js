// ── Live Monitor Page (mockup v4.3) ───────────────────

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
    if (btn.dataset.action === 'retry-failed') { /* TODO */ }
  });

  on('isRunning', render);

  // Poll render while running
  setInterval(() => {
    if (state.isRunning && state.activeRoute === 'monitor') render();
  }, 1500);
}

export function render() {
  const panel = $('#page-monitor');
  const progress = state.deviceProgress;
  const finished = state.finishedCount;
  const total = state.totalEngines;
  const isRunning = state.isRunning;
  const isDone = !isRunning && total > 0 && finished >= total;

  const devices = [...state.selectedDevices].map(devId => {
    const short = devId.length > 8 ? devId.slice(-6) : devId;
    const model = state.devices.find(d => d[0] === devId)?.[1] || short;
    const p = progress[short] || { step: 'Waiting...', percent: 0, status: 'waiting' };
    return { devId, short, model, ...p };
  });

  const colors = ['#58a6ff', '#bc8cff', '#39d2c0', '#d29922', '#f85149'];

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px">
        <h2 style="font-size:14px;font-weight:700;color:#f0f6fc">Live monitor</h2>
        <span class="badge ${isDone ? 'b-green' : isRunning ? 'b-amber pulse' : 'b-gray'}">${isDone ? 'Completed' : isRunning ? 'Running' : 'Idle'}</span>
      </div>
      ${isRunning ? `
        <div style="display:flex;gap:6px">
          <button class="btn btn-danger" data-action="stop-all">
            <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24" style="vertical-align:-1px"><rect x="4" y="4" width="16" height="16" rx="2"/></svg> Stop all
          </button>
        </div>
      ` : ''}
    </div>

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
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:13px;font-weight:600;color:#f0f6fc">${esc(d.model)}</span>
                  <span style="font-size:10px;color:#484f58;font-family:'IBM Plex Mono',monospace">${esc(d.short)}</span>
                </div>
                <span class="badge ${badgeClass}">${badgeLabel}</span>
              </div>
              <p style="font-size:11px;color:#c9d1d9;margin-bottom:2px">${esc(d.step)}</p>
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;margin-top:8px">
                <div style="flex:1;height:4px;background:#21262d;border-radius:2px;overflow:hidden">
                  <div style="width:${d.percent}%;height:100%;background:${c};border-radius:2px;transition:width .3s"></div>
                </div>
                <span style="font-size:10px;color:#8b949e;font-weight:600;min-width:30px">${d.percent}%</span>
              </div>
            </div>
          </div>`;
      }).join('') : '<p style="font-size:12px;color:#484f58;text-align:center;padding:30px">No active automation</p>'}
    </div>

    <!-- Completion summary -->
    ${isDone ? `
      <div class="card" style="padding:16px;margin-top:16px">
        <p style="font-size:12px;font-weight:700;color:#f0f6fc;margin-bottom:10px">Upload complete</p>
        <div style="display:flex;gap:16px;margin-bottom:12px">
          <span style="font-size:13px;font-weight:600;color:#3fb950">${finished} finished</span>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-accent" data-action="back-queue">Back to queue</button>
        </div>
      </div>
    ` : ''}
  `;
}
