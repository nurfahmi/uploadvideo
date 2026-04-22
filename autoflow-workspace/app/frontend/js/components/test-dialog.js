// ── Test Dialog ────────────────────────────────────────
// Modal for starting a template test on a specific device.
// Returns a promise resolving to { videoPath, caption, url } or null if cancelled.

import state, { getDeviceLabel } from '../state.js';
import { toast } from './toast.js';

const { invoke } = window.__TAURI__.core;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Inspect template to decide which fields the test needs.
// Falls back to sensible defaults.
function inferFields(tpl) {
  const fields = { video: true, caption: false, url: false };
  if (!tpl) return fields;
  const samples = tpl.samples || {};
  if ('caption' in samples || 'hashtags' in samples) fields.caption = true;
  if ('affiliate_link' in samples || 'url' in samples || 'link' in samples) fields.url = true;
  // Also scan steps for u2_type fields that reference these vars
  const stepsStr = JSON.stringify(tpl.steps || []);
  if (/\{caption\}|\{hashtags\}/.test(stepsStr)) fields.caption = true;
  if (/\{affiliate_link\}|\{url\}|\{link\}/.test(stepsStr)) fields.url = true;
  return fields;
}

export function openTestDialog({ deviceId, templateName, template }) {
  return new Promise((resolve) => {
    const fields = inferFields(template);
    const deviceLabel = getDeviceLabel(deviceId, deviceId);
    const stepCount = template?.steps?.length || 0;

    const overlay = document.createElement('div');
    overlay.className = 'auv-test-dialog-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 8000;
      background: var(--c-overlay);
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(2px);
    `;

    overlay.innerHTML = `
      <div class="ui-card" style="width:440px;max-width:calc(100vw - 40px);padding:0;overflow:hidden">
        <!-- Header -->
        <div style="padding:var(--sp-4);border-bottom:1px solid var(--c-bg-2)">
          <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-1)">
            <span style="font-size:16px">🧪</span>
            <h3 class="t-lg t-strong" style="margin:0">Test Template</h3>
          </div>
          <p class="t-sm t-muted" style="margin:0">
            <strong>${esc(templateName)}</strong> di <strong>${esc(deviceLabel)}</strong>
          </p>
          <p class="t-xs t-muted" style="margin-top:var(--sp-1)">
            ${stepCount} langkah akan dijalankan sekali untuk verifikasi.
          </p>
        </div>

        <!-- Body -->
        <div style="padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-4)">
          ${fields.video ? `
            <div>
              <label class="t-xs t-strong" style="display:block;margin-bottom:var(--sp-2);text-transform:uppercase;letter-spacing:.5px">Video untuk test</label>
              <div style="display:flex;gap:var(--sp-2)">
                <input type="text" class="inp" data-field="videoPath" readonly placeholder="Belum dipilih..." style="flex:1;cursor:pointer">
                <button class="btn btn-secondary btn-sm" data-action="pick-video">Pilih</button>
              </div>
              <p class="t-xs t-muted" style="margin-top:var(--sp-1)">MP4, MOV, AVI (max ~100MB)</p>
            </div>
          ` : ''}

          ${fields.caption ? `
            <div>
              <label class="t-xs t-strong" style="display:block;margin-bottom:var(--sp-2);text-transform:uppercase;letter-spacing:.5px">Caption (opsional)</label>
              <textarea class="inp" data-field="caption" rows="3" placeholder="Caption untuk test... (kosongkan untuk pakai default)" style="width:100%;resize:vertical"></textarea>
            </div>
          ` : ''}

          ${fields.url ? `
            <div>
              <label class="t-xs t-strong" style="display:block;margin-bottom:var(--sp-2);text-transform:uppercase;letter-spacing:.5px">URL / Link (opsional)</label>
              <input type="text" class="inp" data-field="url" placeholder="https://..." style="width:100%">
            </div>
          ` : ''}

          <div style="background:var(--c-amber-a12);border-radius:var(--r-sm);padding:var(--sp-2) var(--sp-3);display:flex;align-items:flex-start;gap:var(--sp-2)">
            <svg width="14" height="14" fill="none" stroke="var(--c-amber)" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;margin-top:2px"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <p class="t-xs" style="margin:0;color:var(--c-amber);line-height:1.4">HP akan otomatis menjalankan flow — jangan sentuh layar selama test berjalan.</p>
          </div>
        </div>

        <!-- Footer -->
        <div style="padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--c-bg-2);display:flex;justify-content:flex-end;gap:var(--sp-2);background:var(--c-bg-1)">
          <button class="btn btn-ghost" data-action="cancel">Batal</button>
          <button class="btn btn-primary" data-action="start" disabled>Mulai Test →</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const result = { videoPath: '', caption: '', url: '' };
    const startBtn = overlay.querySelector('[data-action="start"]');
    const videoInput = overlay.querySelector('[data-field="videoPath"]');

    const updateStartEnabled = () => {
      startBtn.disabled = fields.video && !result.videoPath;
    };

    overlay.addEventListener('click', async (e) => {
      if (e.target === overlay) { cleanup(null); return; }

      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'cancel') { cleanup(null); return; }

      if (action === 'pick-video') {
        try {
          const open = window.__TAURI__?.dialog?.open;
          if (!open) { toast.error('File dialog tidak tersedia'); return; }
          const selected = await open({
            multiple: false,
            filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'MP4', 'MOV'] }],
          });
          if (selected) {
            result.videoPath = selected;
            if (videoInput) videoInput.value = selected;
            updateStartEnabled();
          }
        } catch (err) {
          toast.error('Gagal pilih file: ' + err);
        }
      }

      if (action === 'start') {
        const capInp = overlay.querySelector('[data-field="caption"]');
        const urlInp = overlay.querySelector('[data-field="url"]');
        if (capInp) result.caption = capInp.value;
        if (urlInp) result.url = urlInp.value;
        cleanup(result);
      }
    });

    videoInput?.addEventListener('click', () => {
      overlay.querySelector('[data-action="pick-video"]')?.click();
    });

    const onEsc = (ev) => { if (ev.key === 'Escape') cleanup(null); };
    document.addEventListener('keydown', onEsc);

    function cleanup(val) {
      document.removeEventListener('keydown', onEsc);
      overlay.remove();
      resolve(val);
    }
  });
}
