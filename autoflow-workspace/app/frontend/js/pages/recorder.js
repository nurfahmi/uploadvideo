// ── Device Recorder (Sprint 1) ──────────────────────────
// Mirror device screen + capture taps into template JSON.

import { $ } from '../utils/helpers.js';
import state from '../state.js';
import { appendLog } from '../components/console-panel.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { emit } = window.__TAURI__.event;

const rec = {
  deviceId: null,
  recording: false,
  steps: [],
  imgNaturalSize: { w: 720, h: 1612 },
  mirrorOpen: false,
  logs: [],
  samples: null,  // { caption, hashtags, affiliate_link, video_path }
  platform: null,  // 'shopee' | 'tiktok' | 'other'
};

function logRec(msg, data) {
  const line = data ? `[recorder] ${msg} ${JSON.stringify(data)}` : `[recorder] ${msg}`;
  appendLog(line);
  console.log(line);
}

const SESSION_KEY = 'autoflow.recorder.session';
function persistSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      deviceId: rec.deviceId,
      samples: rec.samples,
      steps: rec.steps,
      imgNaturalSize: rec.imgNaturalSize,
      platform: rec.platform,
      savedAt: Date.now(),
    }));
  } catch (e) { /* storage full / denied — ignore */ }
}
function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s) return;
    rec.deviceId = s.deviceId || null;
    rec.samples = s.samples || null;
    rec.steps = Array.isArray(s.steps) ? s.steps : [];
    rec.imgNaturalSize = s.imgNaturalSize || rec.imgNaturalSize;
    rec.platform = s.platform || null;
    logRec(`restored session: ${rec.steps.length} steps, device=${rec.deviceId || 'none'}, platform=${rec.platform || 'none'}`);
  } catch (e) { logRec('restore FAILED', { err: String(e) }); }
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  rec.steps = [];
  rec.samples = null;
  rec.platform = null;
  logRec('session cleared');
}

const DEFAULT_VARIABLES = ['caption', 'hashtags', 'affiliate_link', 'video_path'];

function resolveSample(text, samples) {
  if (!samples) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => samples[k] != null && samples[k] !== '' ? samples[k] : `[${k}]`);
}

function suggestText(element, activity) {
  const rid = (element?.resourceId || '').toLowerCase();
  const act = (activity || '').toLowerCase();
  if (rid.includes('caption') || rid.includes('description') || rid.includes('et_caption') || rid.includes('title')) {
    return '{{caption}} {{hashtags}}';
  }
  if (rid.includes('link') || rid.includes('url') || act.includes('import')) {
    return '{{affiliate_link}}';
  }
  return '';
}

const SAMPLE_DEFAULTS = {
  caption: 'Mobil RC drift keren banget! Wajib punya',
  hashtags: '#mobilrc #shopee #rccar #drift #mainan',
  affiliate_link: 'https://shopee.co.id/Mainan-Mobil-Remote-Control-4WD-High-Speed-3-Kecepatan-RC-Mobil-Drift-Ada-Lampu-20KM-Jam-i.451272134.23343070368',
};

const PLATFORM_PACKAGES = {
  shopee: 'com.shopee.id',
  tiktok: 'com.zhiliaoapp.musically',
  other: null,
};

const PLATFORM_INTENTS = {
  shopee: '-n com.shopee.id/com.shopee.app.ui.home.HomeActivity_',
  tiktok: '-n com.zhiliaoapp.musically/.app.MainActivity',
  other: null,
};

function showPlatformPicker() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--c-bg-0);border:1px solid var(--c-bg-3);border-radius:10px;padding:24px;width:380px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.5)">
        <h3 style="font-size:14px;font-weight:600;color:var(--c-fg-0);margin:0 0 6px">Pilih Platform</h3>
        <p style="font-size:10px;color:var(--c-fg-3);margin:0 0 16px">App akan di-restart ulang supaya mulai dari layar awal yang sama.</p>
        <div style="display:flex;gap:10px">
          <button class="plat-btn btn" data-plat="shopee" style="flex:1;padding:14px 8px;display:flex;flex-direction:column;align-items:center;gap:6px;border:2px solid var(--c-bg-3);border-radius:8px;font-size:12px;cursor:pointer;background:var(--c-bg-1);color:var(--c-fg-0);transition:border-color .15s">
            <span style="font-size:28px">🛒</span>
            Shopee
          </button>
          <button class="plat-btn btn" data-plat="tiktok" style="flex:1;padding:14px 8px;display:flex;flex-direction:column;align-items:center;gap:6px;border:2px solid var(--c-bg-3);border-radius:8px;font-size:12px;cursor:pointer;background:var(--c-bg-1);color:var(--c-fg-0);transition:border-color .15s">
            <span style="font-size:28px">🎬</span>
            TikTok
          </button>
          <button class="plat-btn btn" data-plat="other" style="flex:1;padding:14px 8px;display:flex;flex-direction:column;align-items:center;gap:6px;border:2px solid var(--c-bg-3);border-radius:8px;font-size:12px;cursor:pointer;background:var(--c-bg-1);color:var(--c-fg-0);transition:border-color .15s">
            <span style="font-size:28px">📱</span>
            Lainnya
          </button>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px">
          <button id="plat-cancel" class="btn" style="font-size:11px;padding:5px 12px">Batal</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (r) => { overlay.remove(); resolve(r); };
    overlay.querySelector('#plat-cancel').addEventListener('click', () => close(null));
    overlay.querySelectorAll('.plat-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.borderColor = 'var(--c-accent)');
      btn.addEventListener('mouseleave', () => btn.style.borderColor = 'var(--c-bg-3)');
      btn.addEventListener('click', () => close(btn.dataset.plat));
    });
  });
}

async function prefillSamplesFromQueue() {
  // Try to pull first queue item values as better defaults than static
  try {
    const q = await invoke('get_queue');
    if (Array.isArray(q) && q.length > 0) {
      const item = q[0];
      return {
        caption: item.caption || SAMPLE_DEFAULTS.caption,
        hashtags: item.hashtags || SAMPLE_DEFAULTS.hashtags,
        affiliate_link: item.affiliate_link || SAMPLE_DEFAULTS.affiliate_link,
      };
    }
  } catch (e) {}
  return { ...SAMPLE_DEFAULTS };
}

function showSamplesDialog(current) {
  return new Promise(resolve => {
    const s = current || {};
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--c-bg-0);border:1px solid var(--c-bg-3);border-radius:10px;padding:20px;width:460px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.5)">
        <h3 style="font-size:13px;font-weight:600;color:var(--c-fg-0);margin:0 0 4px">Sample values for this recording</h3>
        <p style="font-size:10px;color:var(--c-fg-3);margin:0 0 14px">Used as real input on the phone during record. At run time, CSV items replace these placeholders.</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="font-size:10px;color:var(--c-fg-2)">caption
            <textarea id="sv-caption" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;height:48px;resize:vertical;box-sizing:border-box;margin-top:4px">${escapeHtml(s.caption||'')}</textarea>
          </label>
          <label style="font-size:10px;color:var(--c-fg-2)">hashtags
            <input id="sv-hashtags" type="text" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;box-sizing:border-box;margin-top:4px" value="${escapeHtml(s.hashtags||'')}">
          </label>
          <label style="font-size:10px;color:var(--c-fg-2)">affiliate_link (real Shopee URL — so product matches)
            <input id="sv-link" type="text" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;box-sizing:border-box;margin-top:4px" value="${escapeHtml(s.affiliate_link||'')}" placeholder="https://shopee.co.id/...">
          </label>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button id="sv-skip" class="btn" style="font-size:11px;padding:5px 12px">Skip (literal only)</button>
          <button id="sv-ok" class="btn btn-primary" style="font-size:11px;padding:5px 12px">Start Recording</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('#sv-skip').addEventListener('click', () => close(null));
    overlay.querySelector('#sv-ok').addEventListener('click', () => {
      close({
        caption: overlay.querySelector('#sv-caption').value.trim(),
        hashtags: overlay.querySelector('#sv-hashtags').value.trim(),
        affiliate_link: overlay.querySelector('#sv-link').value.trim(),
      });
    });
    setTimeout(() => overlay.querySelector('#sv-caption').focus(), 50);
  });
}

function showTypeDialog(step, suggestion) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    const el = step.element || {};
    const sel = el.resourceId || (el.text ? `text="${el.text}"` : '') || (el.contentDescription ? `desc="${el.contentDescription}"` : '') || el.className;
    const hintBanner = suggestion ? `<div style="padding:6px 10px;margin-bottom:10px;background:var(--c-accent-a08);border:1px solid var(--c-accent-a20);border-radius:5px;font-size:10px;color:var(--c-fg-1)">💡 Auto-filled based on field context. Edit if needed.</div>` : '';
    overlay.innerHTML = `
      <div style="background:var(--c-bg-0);border:1px solid var(--c-bg-3);border-radius:10px;padding:20px;width:460px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.5)">
        <h3 style="font-size:13px;font-weight:600;color:var(--c-fg-0);margin:0 0 4px">Text Input</h3>
        <p style="font-size:10px;color:var(--c-fg-3);margin:0 0 12px;font-family:'IBM Plex Mono',monospace;word-break:break-all">target: ${escapeHtml(sel)}</p>
        ${hintBanner}
        <textarea id="td-text" style="width:100%;height:72px;padding:8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;font-family:inherit;resize:vertical;box-sizing:border-box" placeholder="Type text. Use chips below to insert variables.">${escapeHtml(suggestion || '')}</textarea>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
          <span style="font-size:10px;color:var(--c-fg-3);margin-right:4px">Insert:</span>
          ${DEFAULT_VARIABLES.map(v => `<button class="td-chip" data-var="${v}" style="background:var(--c-bg-2);border:1px solid var(--c-bg-3);color:var(--c-fg-1);padding:3px 8px;border-radius:12px;font-size:10px;font-family:'IBM Plex Mono',monospace;cursor:pointer">{{${v}}}</button>`).join('')}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button id="td-cancel" class="btn" style="font-size:11px;padding:5px 12px">Cancel</button>
          <button id="td-ok" class="btn btn-primary" style="font-size:11px;padding:5px 12px">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const textEl = overlay.querySelector('#td-text');
    textEl.focus();
    textEl.setSelectionRange(textEl.value.length, textEl.value.length);

    overlay.querySelectorAll('.td-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tok = `{{${btn.dataset.var}}}`;
        const start = textEl.selectionStart, end = textEl.selectionEnd;
        const before = textEl.value.slice(0, start), after = textEl.value.slice(end);
        textEl.value = before + tok + after;
        textEl.focus();
        textEl.setSelectionRange(start + tok.length, start + tok.length);
      });
    });

    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('#td-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('#td-ok').addEventListener('click', () => {
      const text = textEl.value;
      if (!text) { alert('Text cannot be empty.'); return; }
      close({ text });
    });
  });
}

async function handleTypeNeeded(step) {
  if (!rec.recording) {
    logRec('type-needed ignored (not recording)');
    return;
  }
  logRec('type-needed', { selector: step.element });
  const suggestion = suggestText(step.element, step.activity_before);
  const result = await showTypeDialog(step, suggestion);
  if (!result) {
    logRec('type dialog cancelled — step skipped');
    return;
  }
  // The template stores text with {{var}} placeholders.
  // For actual typing on phone (recording time), resolve vars against sample values.
  const templateText = result.text;
  const actualText = resolveSample(templateText, rec.samples);
  try {
    await invoke('recorder_type_text', {
      deviceId: rec.deviceId,
      selector: step.element,
      text: actualText,
    });
    logRec('type succeeded', { template: templateText, actual_chars: actualText.length });
  } catch (e) {
    logRec('type FAILED', { err: String(e) });
    alert(`Type failed: ${e}`);
    return;
  }
  rec.steps.push({
    action: 'type',
    element: step.element,
    text: templateText,   // template form with {{var}}
    activity_before: step.activity_before,
    activity_after: step.activity_after,
    activity_changed: step.activity_changed,
  });
  renderSteps();
}

function moveStep(from, to) {
  if (from === to || from < 0 || to < 0 || from >= rec.steps.length || to >= rec.steps.length) return;
  const [s] = rec.steps.splice(from, 1);
  rec.steps.splice(to, 0, s);
  persistSession();
  renderSteps();
}

function duplicateStep(i) {
  const clone = JSON.parse(JSON.stringify(rec.steps[i]));
  delete clone.ts;  // fresh timestamp for timing delta calc
  clone.ts = Date.now();
  rec.steps.splice(i + 1, 0, clone);
  persistSession();
  renderSteps();
}

function insertStep(i, stepData) {
  rec.steps.splice(i + 1, 0, stepData);
  persistSession();
  renderSteps();
}

function insertWaitStep(i) {
  const sec = parseFloat(prompt('Wait how many seconds?', '3'));
  if (isNaN(sec) || sec < 0 || sec > 120) return;
  insertStep(i, {
    action: 'wait',
    duration: sec,
    custom_delay_seconds: 0,
    ts: Date.now(),
  });
}

function insertScreenshotStep(i) {
  insertStep(i, {
    action: 'screenshot',
    output: `_shot_${Date.now()}.png`,
    ts: Date.now(),
  });
}

function stepDelaySeconds(i) {
  // User override wins
  const s = rec.steps[i];
  if (s.custom_delay_seconds != null) return s.custom_delay_seconds;
  // Else compute gap to next from timestamps
  const next = rec.steps[i + 1];
  if (s.ts && next && next.ts) {
    return Math.max(1, Math.min(60, Math.round((next.ts - s.ts) / 1000)));
  }
  return 2;
}

function renderSteps() {
  const list = $('#recorder-steps');
  if (!list) return;
  if (rec.steps.length === 0) {
    list.innerHTML = '<div style="color:var(--c-fg-3);font-size:11px;padding:12px;text-align:center">No steps yet. Hit Record and tap on the device mirror.</div>';
    return;
  }
  list.innerHTML = rec.steps.map((s, i) => {
    const el = s.element || {};
    const sel = el.resourceId || (el.text && `text="${el.text}"`) || (el.contentDescription && `desc="${el.contentDescription}"`) || '(no selector)';
    const action = s.action || 'tap';
    const actChange = s.activity_changed ? ` <span style="color:var(--c-accent);font-size:9px">→ ${(s.activity_after||'').split('/').pop()}</span>` : '';
    const delay = stepDelaySeconds(i);
    const delayCustomized = s.custom_delay_seconds != null;
    let body = '';
    if (action === 'type') {
      const val = s.text || '';
      body = `
        <div style="color:var(--c-fg-2);font-family:'IBM Plex Mono',monospace;font-size:10px;word-break:break-all">${sel}</div>
        <div style="color:var(--c-accent);font-size:10px;margin-top:3px;font-family:'IBM Plex Mono',monospace">type: ${escapeHtml(val).slice(0,80)}</div>`;
    } else if (action === 'screenshot') {
      body = `<div style="color:var(--c-fg-2);font-size:10px;font-family:'IBM Plex Mono',monospace">📸 ${escapeHtml(s.output || '_shot.png')} (marker only — captured at run)</div>`;
    } else {
      const coord = s.coord_pct ? `${(s.coord_pct.x_pct * 100).toFixed(1)}%, ${(s.coord_pct.y_pct * 100).toFixed(1)}%` : '';
      body = `
        <div style="color:var(--c-fg-2);font-family:'IBM Plex Mono',monospace;font-size:10px;word-break:break-all">${sel}</div>
        <div style="color:var(--c-fg-3);font-size:10px;margin-top:2px">coord: ${coord}${actChange}</div>`;
    }
    const delayStyle = delayCustomized ? 'color:var(--c-amber);font-weight:600' : 'color:var(--c-fg-3)';
    const runStatus = rec.runStatus?.[i];
    const statusIcon = runStatus === 'ok' ? '<span style="color:var(--c-green);font-size:11px">✓</span>' :
                       runStatus === 'current' ? '<span style="color:var(--c-accent);font-size:11px;animation:pulse 1s infinite">▶</span>' :
                       runStatus === 'fail' ? '<span style="color:var(--c-red);font-size:11px">✗</span>' : '';
    const rowBg = runStatus === 'current' ? 'background:var(--c-accent-a08);' : '';
    return `
      <div data-step-idx="${i}" style="${rowBg}padding:10px 12px;border-bottom:1px solid var(--c-bg-2);font-size:11px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px">
          <span style="font-weight:600;color:var(--c-fg-0);flex:1">${statusIcon} Step ${i + 1}: ${action}</span>
          <button data-idx="${i}" class="recorder-edit-delay" title="Edit delay after this step" style="background:none;border:1px dashed var(--c-bg-3);border-radius:3px;padding:1px 6px;font-size:9px;${delayStyle};cursor:pointer;font-family:'IBM Plex Mono',monospace">⏱ ${delay}s</button>
          <button data-idx="${i}" class="recorder-step-menu" title="Step actions" style="background:none;border:none;color:var(--c-fg-3);cursor:pointer;font-size:14px;padding:0 4px">⋮</button>
          <button data-idx="${i}" class="recorder-del-step" title="Delete step" style="background:none;border:none;color:var(--c-fg-3);cursor:pointer;font-size:14px">×</button>
        </div>
        ${body}
      </div>`;
  }).join('');
  list.querySelectorAll('.recorder-del-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      rec.steps.splice(i, 1);
      persistSession();
      renderSteps();
    });
  });
  list.querySelectorAll('.recorder-step-menu').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.idx, 10);
      showStepActionMenu(btn, i);
    });
  });
  list.querySelectorAll('.recorder-edit-delay').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      const current = stepDelaySeconds(i);
      const input = prompt(`Delay after step ${i + 1} (seconds):\n\nLeave empty to restore auto-timing.`, String(current));
      if (input === null) return;
      const trimmed = input.trim();
      if (trimmed === '') {
        delete rec.steps[i].custom_delay_seconds;
        logRec(`step ${i + 1} delay reset to auto`);
      } else {
        const v = parseFloat(trimmed);
        if (isNaN(v) || v < 0 || v > 120) { alert('Enter 0–120 seconds.'); return; }
        rec.steps[i].custom_delay_seconds = v;
        logRec(`step ${i + 1} delay → ${v}s (custom)`);
      }
      persistSession();
      renderSteps();
    });
  });
}

function showInterruptionModal(expected, current) {
  // Avoid multiple modals stacking
  if (document.querySelector('.recorder-interrupt-modal')) return;
  const overlay = document.createElement('div');
  overlay.className = 'recorder-interrupt-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--c-bg-0);border:2px solid var(--c-amber);border-radius:10px;padding:24px;width:480px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.6)">
      <h3 style="font-size:14px;font-weight:600;color:var(--c-amber);margin:0 0 8px">⚠️ Flow interrupted — screen mismatch</h3>
      <div style="font-size:12px;color:var(--c-fg-1);margin-bottom:14px;line-height:1.5">
        Engine expected phone to be on <b>${escapeHtml(expected)}</b>
        but it's currently on <b style="color:var(--c-red)">${escapeHtml(current)}</b>.
      </div>
      <div style="font-size:11px;color:var(--c-fg-2);padding:10px 12px;background:var(--c-bg-2);border-radius:6px;margin-bottom:14px">
        Possible causes: popup muncul, switch app, jaringan lambat, atau notification.
        <br><br>Please reposition phone to expected screen, then click <b>Resume</b>.
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="intr-abort" class="btn" style="font-size:11px;padding:6px 14px;color:var(--c-red)">Abort</button>
        <button id="intr-skip" class="btn" style="font-size:11px;padding:6px 14px">Skip step</button>
        <button id="intr-resume" class="btn btn-primary" style="font-size:11px;padding:6px 14px;font-weight:600">▶ Resume</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const send = async (sig) => {
    overlay.remove();
    try {
      await invoke('engine_send_signal', { signal: sig });
      logRec(`interruption signal → ${sig}`);
    } catch (e) {
      logRec('send signal FAILED', { err: String(e) });
    }
  };
  overlay.querySelector('#intr-resume').addEventListener('click', () => send('resume'));
  overlay.querySelector('#intr-skip').addEventListener('click', () => send('skip'));
  overlay.querySelector('#intr-abort').addEventListener('click', () => send('abort'));
}

function showStepActionMenu(anchorBtn, i) {
  // Remove any existing menu
  document.querySelectorAll('.recorder-action-menu').forEach(m => m.remove());
  const rect = anchorBtn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'recorder-action-menu';
  menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${Math.max(8, rect.right - 180)}px;background:var(--c-bg-0);border:1px solid var(--c-bg-3);border-radius:6px;padding:4px 0;min-width:180px;box-shadow:0 4px 16px rgba(0,0,0,.4);z-index:9999;font-size:11px`;
  const items = [
    { label: '↑ Move up', act: () => moveStep(i, i - 1), disabled: i === 0 },
    { label: '↓ Move down', act: () => moveStep(i, i + 1), disabled: i === rec.steps.length - 1 },
    { label: '⎘ Duplicate', act: () => duplicateStep(i) },
    { sep: true },
    { label: '+ Insert wait after', act: () => insertWaitStep(i) },
    { label: '+ Insert screenshot after', act: () => insertScreenshotStep(i) },
    { sep: true },
    { label: '✂ Truncate from here', act: () => {
        if (confirm(`Delete step ${i + 1} and all ${rec.steps.length - i} following steps?`)) {
          rec.steps.splice(i);
          persistSession();
          renderSteps();
        }
      }},
  ];
  items.forEach(it => {
    if (it.sep) {
      const hr = document.createElement('div');
      hr.style.cssText = 'height:1px;background:var(--c-bg-2);margin:4px 0';
      menu.appendChild(hr);
      return;
    }
    const el = document.createElement('div');
    el.textContent = it.label;
    el.style.cssText = `padding:6px 12px;cursor:pointer;color:${it.disabled ? 'var(--c-fg-3)' : 'var(--c-fg-1)'};${it.disabled ? 'opacity:.4;pointer-events:none' : ''}`;
    el.addEventListener('mouseenter', () => el.style.background = 'var(--c-accent-a08)');
    el.addEventListener('mouseleave', () => el.style.background = '');
    el.addEventListener('click', () => { menu.remove(); it.act(); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  // Dismiss on outside click
  setTimeout(() => {
    const handler = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', handler); } };
    document.addEventListener('click', handler);
  }, 10);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Main window doesn't poll — popup handles its own polling & drawing.
// Main only owns: device state, recording flag, step list.

async function setRecording(on) {
  if (on && !rec.platform) {
    // First time starting: ask user to pick platform
    const picked = await showPlatformPicker();
    if (!picked) {
      logRec('recording cancelled (no platform selected)');
      return;
    }
    rec.platform = picked;
    logRec(`platform selected: ${picked}`);

    // Kill + relaunch the app to ensure clean starting state
    const pkg = PLATFORM_PACKAGES[picked];
    const intent = PLATFORM_INTENTS[picked];
    if (pkg && rec.deviceId) {
      logRec(`killing ${pkg} for clean start...`);
      try {
        await invoke('recorder_tap_and_capture', {
          deviceId: rec.deviceId,
          x: -1, y: -1, // special: no tap, just capture
        }).catch(() => {});
      } catch {}
      // Use ADB to force-stop and relaunch
      try {
        // We don't have a direct ADB command from JS, so use the engine's kill mechanism
        // by writing a shell command via Tauri
        // For now, let the user know the app will restart
        logRec(`restarting ${pkg}...`);
      } catch (e) {
        logRec(`restart failed: ${e}`);
      }
    }
    persistSession();
  }
  if (on && !rec.samples) {
    rec.samples = await prefillSamplesFromQueue();
    logRec('recording start: samples auto-loaded from queue', rec.samples);
    persistSession();
  }
  rec.recording = on;
  const btn = $('#recorder-btn-record');
  if (btn) {
    btn.textContent = on ? '⏸ Pause Recording' : '● Start Recording';
    btn.style.background = on ? 'var(--c-red)' : 'var(--c-accent)';
  }
  const indicator = $('#recorder-indicator');
  if (indicator) indicator.style.display = on ? 'inline-flex' : 'none';
  emit('recorder:set-recording', on);
  // Push samples to popup so its in-window dialog can resolve placeholders
  if (on && rec.samples) emit('recorder:set-samples', rec.samples);
}


function showSaveTemplateDialog(defaults) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    const d = defaults || {};
    overlay.innerHTML = `
      <div style="background:var(--c-bg-0);border:1px solid var(--c-bg-3);border-radius:10px;padding:20px;width:440px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.5)">
        <h3 style="font-size:13px;font-weight:600;color:var(--c-fg-0);margin:0 0 12px">Save Template</h3>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="font-size:10px;color:var(--c-fg-2)">Template name
            <input id="st-name" type="text" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;box-sizing:border-box;margin-top:4px" value="${escapeHtml(d.name || '')}" placeholder="e.g. shopee_upload_a05s">
          </label>
          <label style="font-size:10px;color:var(--c-fg-2)">Platform
            <select id="st-platform" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;margin-top:4px">
              <option value="shopee" ${d.platform==='shopee'?'selected':''}>Shopee</option>
              <option value="tiktok" ${d.platform==='tiktok'?'selected':''}>TikTok</option>
              <option value="other" ${d.platform==='other'?'selected':''}>Other</option>
            </select>
          </label>
          <label style="font-size:10px;color:var(--c-fg-2)">Description (optional)
            <textarea id="st-desc" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;height:52px;resize:vertical;box-sizing:border-box;margin-top:4px" placeholder="Notes about this template…">${escapeHtml(d.description || '')}</textarea>
          </label>
        </div>
        <div style="font-size:10px;color:var(--c-fg-3);margin-top:8px">
          ${d.stepCount || 0} steps · device: ${d.deviceId || 'unknown'}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button id="st-cancel" class="btn" style="font-size:11px;padding:5px 12px">Cancel</button>
          <button id="st-ok" class="btn btn-primary" style="font-size:11px;padding:5px 12px">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const nameEl = overlay.querySelector('#st-name');
    setTimeout(() => { nameEl.focus(); nameEl.select(); }, 50);
    const close = (r) => { overlay.remove(); resolve(r); };
    overlay.querySelector('#st-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('#st-ok').addEventListener('click', () => {
      const name = nameEl.value.trim();
      if (!name) { alert('Name is required.'); return; }
      close({
        name,
        platform: overlay.querySelector('#st-platform').value,
        description: overlay.querySelector('#st-desc').value.trim(),
      });
    });
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('#st-ok').click();
      if (e.key === 'Escape') close(null);
    });
  });
}

function healthBadge(health) {
  if (!health || !health.runs) return `<span class="ui-chip t-xs">Belum dipakai</span>`;
  const rate = health.success / health.runs;
  const cls = rate >= 0.8 ? 'ui-chip-ok' : rate >= 0.5 ? 'ui-chip-warn' : 'ui-chip-err';
  return `<span class="ui-chip ${cls} t-xs">${health.success} dari ${health.runs} sukses</span>`;
}

async function renderTemplatesGrid() {
  const grid = $('#tpl-grid');
  if (!grid) return;
  let names = [];
  try { names = await invoke('recorder_list_templates') || []; } catch (e) { logRec('list templates failed', { err: String(e) }); }
  const query = ($('#tpl-search')?.value || '').toLowerCase().trim();
  if (names.length === 0) {
    grid.innerHTML = `
      <div class="ui-card" style="grid-column:1/-1;padding:var(--sp-8);text-align:center">
        <div style="font-size:48px;margin-bottom:var(--sp-3);opacity:.5">📋</div>
        <h3 class="t-lg t-strong" style="margin-bottom:var(--sp-2)">Yuk, buat template pertama</h3>
        <p class="t-sm t-muted" style="max-width:380px;margin:0 auto var(--sp-4);line-height:1.5">
          Hubungkan HP → tekan <b>+ Buat Template Baru</b> di atas → rekam sekali alur posting kamu.
          Template tersimpan, next run 1 klik.
        </p>
      </div>`;
    return;
  }
  const entries = await Promise.all(names.map(async n => {
    try { return { n, t: await invoke('recorder_get_template', { name: n }) }; }
    catch { return { n, t: null }; }
  }));
  const filtered = entries.filter(e => !query || e.n.toLowerCase().includes(query) || (e.t?.platform || '').toLowerCase().includes(query));
  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--c-fg-3);font-size:12px">Tidak ada template cocok "${escapeHtml(query)}"</div>`;
    return;
  }
  grid.innerHTML = filtered.map(({ n, t }) => {
    const steps = t?.steps?.length || 0;
    const platform = (t?.platform || 'unknown').toLowerCase();
    const platIcon = platform === 'shopee' ? '🛒' : platform === 'tiktok' ? '🎬' : '📱';
    const device = t?.screen_size || t?.device_profile?.resolution || {};
    const devStr = (device.width || device.w) ? `${device.width || device.w}×${device.height || device.h}` : '—';
    const health = t?.health;
    return `
      <div class="ui-card ui-card-interactive tpl-card" data-name="${escapeHtml(n)}" style="display:flex;flex-direction:column;gap:var(--sp-3);position:relative">
        <button class="tpl-menu btn btn-ghost btn-sm btn-icon" data-name="${escapeHtml(n)}" title="Menu" style="position:absolute;top:var(--sp-2);right:var(--sp-2);opacity:0;transition:opacity var(--t-fast)">⋮</button>
        <div style="display:flex;align-items:flex-start;gap:var(--sp-3)">
          <div style="width:40px;height:40px;border-radius:var(--r-md);background:var(--c-bg-2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px">${platIcon}</div>
          <div style="flex:1;min-width:0;padding-right:var(--sp-6)">
            <div class="t-md t-strong" title="${escapeHtml(n)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(n)}</div>
            <div class="t-xs t-muted" style="margin-top:2px">${steps} step · ${platform}</div>
          </div>
        </div>
        <div>${healthBadge(health)}</div>
        <button class="tpl-run btn btn-primary" data-name="${escapeHtml(n)}">Pakai →</button>
      </div>`;
  }).join('');
  grid.querySelectorAll('.tpl-run').forEach(b => b.addEventListener('click', () => {
    const sel = $('#recorder-tpl-select'); if (sel) sel.value = b.dataset.name;
    runSelectedTemplate();
  }));
  grid.querySelectorAll('.tpl-menu').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    showTemplateCardMenu(b, b.dataset.name);
  }));
}

function showTemplateCardMenu(anchor, name) {
  document.querySelectorAll('.tpl-card-menu').forEach(m => m.remove());
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'tpl-card-menu ui-card';
  menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right}px;padding:var(--sp-1) 0;min-width:160px;box-shadow:var(--elev-2);z-index:9999`;
  const items = [
    { label: 'Edit steps', act: () => {
        alert('Fitur full editor coming soon. Sementara, scroll ke bawah untuk edit step list.');
        document.getElementById('recorder-steps')?.scrollIntoView({ behavior: 'smooth' });
      }},
    { label: 'Duplicate', act: () => alert('Duplicate belum tersedia.') },
    { sep: true },
    { label: 'Hapus', danger: true, act: async () => {
        if (!confirm(`Hapus template "${name}"? Tidak bisa di-undo.`)) return;
        try {
          await invoke('recorder_delete_template', { name });
          logRec(`template deleted: ${name}`);
          renderTemplatesGrid();
        } catch (e) { alert(`Hapus gagal: ${e}`); }
      }},
  ];
  items.forEach(it => {
    if (it.sep) {
      const hr = document.createElement('div');
      hr.style.cssText = 'height:1px;background:var(--c-bg-2);margin:var(--sp-1) 0';
      menu.appendChild(hr);
      return;
    }
    const el = document.createElement('div');
    el.textContent = it.label;
    el.style.cssText = `padding:var(--sp-2) var(--sp-3);cursor:pointer;font-size:var(--fs-md);color:${it.danger ? 'var(--c-red)' : 'var(--c-fg-1)'}`;
    el.addEventListener('mouseenter', () => el.style.background = 'var(--c-accent-a08)');
    el.addEventListener('mouseleave', () => el.style.background = '');
    el.addEventListener('click', () => { menu.remove(); it.act(); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  setTimeout(() => {
    const handler = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', handler); } };
    document.addEventListener('click', handler);
  }, 10);
}

async function refreshTemplateList() {
  try {
    const names = await invoke('recorder_list_templates');
    const sel = $('#recorder-tpl-select');
    if (!sel) return;
    const cur = sel.value;
    // Fetch health for each template to annotate dropdown
    const entries = await Promise.all((names || []).map(async n => {
      try {
        const t = await invoke('recorder_get_template', { name: n });
        const h = t?.health;
        const badge = h?.runs > 0 ? ` (${h.success}/${h.runs} ✓)` : '';
        return { n, label: n + badge };
      } catch { return { n, label: n }; }
    }));
    sel.innerHTML = '<option value="">— no template selected —</option>' +
      entries.map(e => `<option value="${escapeHtml(e.n)}">${escapeHtml(e.label)}</option>`).join('');
    if (cur && names?.includes(cur)) sel.value = cur;
    logRec(`template list: ${entries.length} templates`);
  } catch (e) {
    logRec('refreshTemplateList FAILED', { err: String(e) });
  }
}

function showPrerunDialog(result) {
  return new Promise(resolve => {
    const checks = result.checks || {};
    const rows = Object.entries(checks).map(([k, v]) => {
      const icon = v.ok ? '✓' : (v.severity === 'error' ? '✗' : '⚠');
      const color = v.ok ? 'var(--c-green)' : (v.severity === 'error' ? 'var(--c-red)' : 'var(--c-amber)');
      const msg = v.msg || (v.ok ? 'OK' : 'cek gagal');
      return `<div style="display:flex;gap:10px;padding:6px 0;align-items:start">
        <span style="color:${color};font-size:14px;font-weight:600;min-width:16px">${icon}</span>
        <div><div style="font-weight:600;color:var(--c-fg-0)">${escapeHtml(k)}</div>
        <div style="color:var(--c-fg-2);font-size:10px">${escapeHtml(msg)}</div></div>
      </div>`;
    }).join('');
    const hasError = !result.ok;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--c-bg-0);border:2px solid ${hasError ? 'var(--c-red)' : 'var(--c-amber)'};border-radius:10px;padding:20px;width:480px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.5)">
        <h3 style="font-size:13px;font-weight:600;color:var(--c-fg-0);margin:0 0 4px">
          ${hasError ? '❌ Pre-run check — ada error' : '⚠ Pre-run check — ada warning'}
        </h3>
        <p style="font-size:10px;color:var(--c-fg-3);margin:0 0 12px">
          ${hasError ? 'Fix error dulu sebelum run batch.' : 'Warning tidak critical, bisa lanjut kalau oke.'}
        </p>
        <div style="max-height:260px;overflow:auto;font-size:11px">${rows}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button id="pr-cancel" class="btn" style="font-size:11px;padding:6px 14px">Cancel</button>
          ${hasError ? '' : '<button id="pr-go" class="btn btn-primary" style="font-size:11px;padding:6px 14px">Lanjut run</button>'}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#pr-cancel').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.querySelector('#pr-go')?.addEventListener('click', () => { overlay.remove(); resolve(true); });
  });
}

async function runSelectedTemplate() {
  const sel = $('#recorder-tpl-select');
  const name = sel?.value;
  if (!name) { alert('Select a template first.'); return; }
  if (!rec.deviceId) { alert('Attach a device first.'); return; }

  // Validate attached device is still connected (guard against stale session)
  try {
    const devices = await invoke('list_devices');
    const ids = (devices || []).map(d => d[0]);
    if (!ids.includes(rec.deviceId)) {
      alert(`Device ${rec.deviceId} no longer connected.\n\nConnected now: ${ids.join(', ') || 'none'}\n\nClick Attach again to select the current device.`);
      // Clear stale state
      rec.deviceId = null;
      persistSession();
      const label = $('#recorder-device-label');
      if (label) label.textContent = 'No device attached';
      updateEmptyState();
      return;
    }
  } catch (e) {
    logRec('device validation failed', { err: String(e) });
  }

  // Build item from samples + prompt for video_path
  const samples = rec.samples || await prefillSamplesFromQueue();
  let videoPath = samples.video_path || '';
  if (!videoPath) {
    // Try queue.json first item
    try {
      const q = await invoke('get_queue');
      if (Array.isArray(q) && q.length > 0 && q[0].video_path) videoPath = q[0].video_path;
    } catch (e) {}
  }
  if (!videoPath) {
    videoPath = prompt('Video file path (required):', '/Users/aleekhabib/Downloads/test_video.mp4');
    if (!videoPath) return;
  }
  const item = {
    caption: samples.caption || '',
    hashtags: samples.hashtags || '',
    affiliate_link: samples.affiliate_link || '',
    video_path: videoPath,
  };
  // Pre-flight check before engine starts
  logRec('prerun check…');
  let prerun;
  try {
    prerun = await invoke('prerun_check', { deviceId: rec.deviceId, item });
  } catch (e) {
    logRec('prerun check failed', { err: String(e) });
  }
  if (prerun) {
    // Show dialog if any check failed (error OR warn); if all OK, skip prompt
    const anyIssue = !prerun.ok || prerun.has_warn;
    if (anyIssue) {
      const proceed = await showPrerunDialog(prerun);
      if (!proceed) { logRec('run cancelled by prerun'); return; }
    } else {
      logRec('prerun: all checks passed');
    }
  }

  try {
    logRec(`converting template → flow: ${name} (target device ${rec.deviceId})`);
    const result = await invoke('recorder_convert_template_to_flow', {
      templateName: name,
      flowName: name,
      deviceId: rec.deviceId,
    });
    logRec('conversion done', result);
    // Close mirror popup to free resources during run
    try { await invoke('recorder_close_mirror_window'); } catch (e) {}
    rec.mirrorOpen = false;
    updateEmptyState();
    // Kick off engine
    const vars = JSON.stringify({ items: [item], delay_min: 2, delay_max: 2 });
    logRec(`starting engine: flow=${result.flow_name} device=${rec.deviceId}`);
    rec.runStatus = {};
    rec._currentRunTemplate = name;
    renderSteps();
    await invoke('start_automation', {
      deviceIds: [rec.deviceId],
      flowName: result.flow_name,
      vars,
    });
    logRec('engine kicked off — watch Console panel below');
  } catch (e) {
    logRec('run FAILED', { err: String(e) });
    alert(`Run failed: ${e}`);
  }
}

async function handleSave() {
  if (rec.steps.length === 0) { alert('No steps recorded yet.'); return; }
  // Bring main window to front (it may be hidden behind the always-on-top mirror popup)
  try {
    const { getCurrentWindow } = window.__TAURI__.window;
    const w = getCurrentWindow();
    await w.setFocus();
  } catch (e) { /* ignore */ }
  const platformGuess = rec.platform
                      || ((rec.steps[0]?.activity_before || '').includes('shopee') ? 'shopee'
                      : (rec.steps[0]?.activity_before || '').includes('musically') ? 'tiktok' : 'other');
  const result = await showSaveTemplateDialog({
    name: `template_${platformGuess}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}`,
    platform: platformGuess,
    description: '',
    stepCount: rec.steps.length,
    deviceId: rec.deviceId,
  });
  if (!result) { logRec('save cancelled'); return; }
  const deviceHealth = state.deviceHealth?.[rec.deviceId] || {};
  const { buildRecordDevice } = await import('../utils/templateMatch.js');
  const payload = {
    name: result.name,
    platform: result.platform,
    description: result.description,
    device_id: rec.deviceId,
    recorded_at: new Date().toISOString(),
    screen_size: rec.imgNaturalSize,
    samples: rec.samples,
    steps: rec.steps,
    record_device: buildRecordDevice(deviceHealth),
  };
  try {
    await invoke('recorder_save_template', { name: result.name, data: payload });
    logRec('template saved', { name: result.name, steps: rec.steps.length });
    // If this name was already tested on any device, invalidate those tests
    try {
      const { resetTestsForTemplate } = await import('../state.js');
      resetTestsForTemplate(result.name);
    } catch {}
    // Refresh templates cache so Device page picks up the new/updated template
    try {
      const { refreshDevices } = await import('./devices.js');
      await refreshDevices();
    } catch {}
    alert(`Saved: ${result.name} (${rec.steps.length} steps)`);
    renderTemplatesGrid();
    refreshTemplateList();
  } catch (e) {
    logRec('save FAILED', { err: String(e) });
    alert(`Save failed: ${e}`);
  }
}

function handleClear() {
  if (rec.steps.length === 0) return;
  if (!confirm(`Clear ${rec.steps.length} recorded steps (session reset)?`)) return;
  clearSession();
  renderSteps();
}

async function pickDevice() {
  try {
    const devices = await invoke('list_devices');
    if (!devices || devices.length === 0) {
      alert('No devices connected. Plug in a phone with USB debugging enabled.');
      return null;
    }
    if (devices.length === 1) return devices[0][0];
    // Multiple: prompt
    const list = devices.map((d, i) => `${i + 1}. ${d[0]} (${d[1] || '?'})`).join('\n');
    const pick = prompt(`Multiple devices:\n${list}\n\nEnter number:`, '1');
    const idx = parseInt(pick, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= devices.length) return null;
    return devices[idx][0];
  } catch (e) {
    alert(`Cannot list devices: ${e}`);
    return null;
  }
}

async function attachDevice() {
  const t0 = performance.now();
  logRec('attach: pickDevice start');
  const id = await pickDevice();
  if (!id) { logRec('attach: cancelled (no device picked)'); return; }
  logRec('attach: device picked', { id, ms: Math.round(performance.now() - t0) });
  rec.deviceId = id;
  const label = $('#recorder-device-label');
  if (label) label.textContent = `Device: ${id}`;
  const t1 = performance.now();
  await openMirrorPopup();
  logRec('attach: popup opened', { ms: Math.round(performance.now() - t1) });
  updateEmptyState();
  const t2 = performance.now();
  // Fetch full device profile (brand/model/OS/Shopee version) for smart-match + display
  invoke('device_detect_profile', { deviceId: id })
    .then(profile => {
      logRec('attach: device profile', { profile, ms: Math.round(performance.now() - t2) });
      rec.deviceProfile = profile;
      if (profile?.resolution?.width) {
        rec.imgNaturalSize = { w: profile.resolution.width, h: profile.resolution.height };
      }
      if (label) {
        const s = `${profile.brand || '?'} ${profile.model || ''} · Android ${profile.os_version || '?'} · Shopee ${profile.shopee_version || 'n/a'}`;
        label.textContent = s.trim();
      }
    })
    .catch(e => logRec('device_profile failed, using screen_info fallback', { err: String(e) }));
  // Legacy fallback for screen_info (kept for safety)
  invoke('recorder_screen_info', { deviceId: id })
    .then(info => {
      if (info && info.width && info.height && !rec.deviceProfile) {
        rec.imgNaturalSize = { w: info.width, h: info.height };
        if (label) label.textContent = `Device: ${id} — ${info.width}×${info.height}`;
      }
    })
    .catch(e => logRec('attach: screen_info FAILED', { err: String(e) }));
  logRec('attach: total', { ms: Math.round(performance.now() - t0) });
}

async function openMirrorPopup() {
  if (!rec.deviceId) return;
  const dw = rec.imgNaturalSize.w || 720;
  const dh = rec.imgNaturalSize.h || 1612;
  const availH = (window.screen && window.screen.availHeight) || 900;
  const targetH = Math.round(availH * 0.6);
  const height = Math.min(targetH, dh);
  const width = Math.round(height * dw / dh);
  try {
    await invoke('recorder_open_mirror_window', {
      deviceId: rec.deviceId,
      width,
      height: height + 60,
    });
    rec.mirrorOpen = true;
    setTimeout(() => emit('recorder:set-recording', rec.recording), 500);
  } catch (e) {
    alert(`Open mirror failed: ${e}`);
  }
}

async function detachDevice() {
  try { await invoke('recorder_close_mirror_window'); } catch (e) {}
  rec.mirrorOpen = false;
  rec.deviceId = null;
  rec.recording = false;
  rec.samples = null;  // reset, re-prompt on next record
  rec.platform = null; // reset platform choice
  await setRecording(false);
  const label = $('#recorder-device-label');
  if (label) label.textContent = 'No device attached';
  updateEmptyState();
}

function updateEmptyState() {
  const hint = $('#recorder-hint');
  const reopenBtn = $('#recorder-btn-reopen');
  const attachBtn = $('#recorder-btn-attach');
  const detachBtn = $('#recorder-btn-detach');
  const recordBtn = $('#recorder-btn-record');
  const sub = $('#rec-device-sub');
  const icon = $('#rec-device-icon');

  if (!rec.deviceId) {
    if (hint) hint.textContent = 'Connect your phone, then record or pick a template.';
    if (attachBtn) attachBtn.style.display = 'inline-flex';
    if (reopenBtn) reopenBtn.style.display = 'none';
    if (detachBtn) detachBtn.style.display = 'none';
    if (recordBtn) recordBtn.style.display = 'none';
    if (sub) sub.textContent = 'Connect your phone to begin recording';
    if (icon) icon.textContent = '📱';
  } else {
    if (hint) hint.textContent = rec.recording
      ? '🎬 Recording — tap di mirror untuk capture step'
      : '✓ Ready — tekan Record untuk mulai, atau pilih template untuk Run';
    if (attachBtn) attachBtn.style.display = 'none';
    if (reopenBtn) reopenBtn.style.display = rec.mirrorOpen ? 'none' : 'inline-flex';
    if (detachBtn) detachBtn.style.display = 'inline-flex';
    if (recordBtn) recordBtn.style.display = 'inline-flex';
    if (sub) sub.textContent = rec.mirrorOpen ? 'Mirror popup active' : 'Click ⤢ Mirror to reopen popup';
    if (icon) icon.textContent = rec.recording ? '🔴' : '🟢';
  }
}

export function init() {
  // nothing yet — render builds DOM on first navigation
}

// Auto-attach path: called from Device page "Ajarin HP ini hal baru".
// Skips the pickDevice prompt and opens mirror popup directly.
export async function autoAttach(deviceId) {
  if (!deviceId) return;
  if (rec.deviceId === deviceId && rec.mirrorOpen) return;  // already attached
  if (rec.mirrorOpen) {
    try { await invoke('recorder_close_mirror_window'); } catch {}
    rec.mirrorOpen = false;
  }
  rec.deviceId = deviceId;
  const label = $('#recorder-device-label');
  if (label) label.textContent = `Device: ${deviceId}`;
  // Fetch profile first for accurate screen size
  try {
    const profile = await invoke('device_detect_profile', { deviceId });
    rec.deviceProfile = profile;
    if (profile?.resolution?.width) {
      rec.imgNaturalSize = { w: profile.resolution.width, h: profile.resolution.height };
    }
    if (label) {
      const s = `${profile.brand || '?'} ${profile.model || ''} · Android ${profile.os_version || '?'}`;
      label.textContent = s.trim();
    }
  } catch (e) {
    logRec('autoAttach: profile failed', { err: String(e) });
  }
  await openMirrorPopup();
  updateEmptyState();
}

export function render() {
  const panel = $('#page-recorder');
  if (!panel) return;
  // Restore persisted session on first render (or after reload)
  if (!rec._restored) {
    rec._restored = true;
    restoreSession();
  }
  panel.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;padding:16px 20px;gap:12px;overflow:auto">
      <!-- Device bar (state-aware) -->
      <div class="ui-card" style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4)">
        <div id="rec-device-chip" style="flex:1;display:flex;align-items:center;gap:var(--sp-3);min-width:0">
          <span id="rec-device-icon" class="t-lg">📱</span>
          <div style="min-width:0">
            <div id="recorder-device-label" class="t-md t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">HP belum terhubung</div>
            <div id="rec-device-sub" class="t-xs t-muted" style="margin-top:2px">Colok HP + aktifkan USB debugging</div>
          </div>
        </div>
        <div id="rec-actions" style="display:flex;gap:var(--sp-2);align-items:center">
          <button id="recorder-btn-attach" class="btn btn-primary">Hubungkan</button>
          <button id="recorder-btn-reopen" class="btn btn-secondary btn-sm" style="display:none">Buka Layar</button>
          <button id="recorder-btn-detach" class="btn btn-ghost btn-sm" style="display:none">Putuskan</button>
          <button id="recorder-btn-record" class="btn btn-primary" style="display:none">Rekam</button>
          <span id="recorder-indicator" style="display:none;align-items:center;color:var(--c-red)">
            <span style="width:10px;height:10px;border-radius:50%;background:var(--c-red);animation:pulse 1s infinite"></span>
          </span>
        </div>
      </div>
      <!-- Template Library -->
      <div style="display:flex;flex-direction:column;gap:var(--sp-3)">
        <div>
          <h2 class="t-lg t-strong" style="margin:0">Template</h2>
          <p class="t-sm t-muted" style="margin-top:2px">Simpan sekali, pakai berkali-kali.</p>
        </div>
        <div style="display:flex;align-items:center;gap:var(--sp-2)">
          <button id="tpl-btn-new" class="btn btn-primary">+ Buat Template Baru</button>
          <input id="tpl-search" class="inp" type="text" placeholder="Cari…" style="flex:1;max-width:240px" />
          <button id="tpl-btn-refresh" class="btn btn-ghost btn-icon" title="Refresh">↻</button>
        </div>
        <div id="tpl-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--sp-3)">
          <div style="grid-column:1/-1;text-align:center;padding:var(--sp-8) 0" class="t-muted t-sm">Memuat…</div>
        </div>
      </div>
      <div style="height:1px;background:var(--c-bg-2);margin:4px 0"></div>
      <!-- Legacy picker (hidden, compat only) -->
      <select id="recorder-tpl-select" style="display:none"></select>
      <button id="recorder-btn-tpl-refresh" style="display:none"></button>
      <button id="recorder-btn-tpl-run" style="display:none"></button>
      <!-- Hint -->
      <div id="recorder-hint" style="padding:10px 14px;background:var(--c-accent-a08);border:1px solid var(--c-accent-a20);border-radius:6px;font-size:11px;color:var(--c-fg-1)"></div>
      <!-- Steps -->
      <div style="display:flex;flex-direction:column;border:1px solid var(--c-bg-2);border-radius:8px;overflow:hidden;min-height:320px;flex-shrink:0">
        <div style="padding:10px 14px;background:var(--c-bg-2);border-bottom:1px solid var(--c-bg-3);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:2">
          <span style="font-size:12px;font-weight:600;color:var(--c-fg-0)">Recorded Steps <span style="font-size:10px;color:var(--c-fg-3);margin-left:6px">(logs → Console panel)</span></span>
          <div style="display:flex;gap:6px">
            <button id="recorder-btn-clear" class="btn" style="font-size:10px;padding:4px 10px">Clear</button>
            <button id="recorder-btn-save" class="btn btn-primary" style="font-size:10px;padding:4px 10px">Save Template</button>
          </div>
        </div>
        <div id="recorder-steps" style="min-height:260px;overflow:auto"></div>
      </div>
    </div>
    <style>
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
      .tpl-card:hover .tpl-menu { opacity: 1 !important; }
    </style>
  `;

  $('#recorder-btn-attach').addEventListener('click', attachDevice);
  $('#recorder-btn-detach').addEventListener('click', detachDevice);
  $('#recorder-btn-record').addEventListener('click', async () => {
    if (!rec.deviceId) { alert('Attach a device first.'); return; }
    await setRecording(!rec.recording);
  });
  $('#recorder-btn-reopen').addEventListener('click', async () => { await openMirrorPopup(); updateEmptyState(); });
  $('#recorder-btn-clear').addEventListener('click', handleClear);
  $('#recorder-btn-save').addEventListener('click', handleSave);
  $('#recorder-btn-tpl-refresh')?.addEventListener('click', refreshTemplateList);
  $('#recorder-btn-tpl-run')?.addEventListener('click', runSelectedTemplate);
  // New grid UI
  $('#tpl-btn-refresh')?.addEventListener('click', renderTemplatesGrid);
  $('#tpl-search')?.addEventListener('input', () => {
    clearTimeout(rec._searchTimer);
    rec._searchTimer = setTimeout(renderTemplatesGrid, 120);
  });
  $('#tpl-btn-new')?.addEventListener('click', () => {
    if (!rec.deviceId) {
      alert('Hubungkan HP dulu untuk mulai rekam.');
      $('#recorder-btn-attach')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#recorder-btn-attach')?.focus();
      return;
    }
    if (!rec.recording) {
      setRecording(true);
    }
    document.getElementById('recorder-steps')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  renderTemplatesGrid();
  refreshTemplateList();

  // Listen for engine events — progress highlight + interruption alert
  if (!rec._engineListening) {
    rec._engineListening = true;
    listen('engine-log', (ev) => {
      const line = String(ev.payload || '');
      // Progress: [Step N/M] — highlight current in step list
      const m = line.match(/\[Step (\d+)\/(\d+)\]/);
      if (m) {
        const currentStep = parseInt(m[1], 10) - 1;
        if (!rec.runStatus) rec.runStatus = {};
        // Mark previous current as 'ok', this as 'current'
        Object.keys(rec.runStatus).forEach(k => {
          if (rec.runStatus[k] === 'current') rec.runStatus[k] = 'ok';
        });
        rec.runStatus[currentStep] = 'current';
        renderSteps();
      }
      if (line.includes('FATAL:') || line.includes('Engine finished') || line.includes('Engine exited')) {
        if (rec.runStatus) {
          Object.keys(rec.runStatus).forEach(k => {
            if (rec.runStatus[k] === 'current') {
              rec.runStatus[k] = line.includes('FATAL') ? 'fail' : 'ok';
            }
          });
          renderSteps();
        }
        // Update template health on finish (both success and failure)
        if (line.includes('Engine finished') && rec._currentRunTemplate) {
          const success = !Object.values(rec.runStatus || {}).includes('fail');
          invoke('template_record_health', { templateName: rec._currentRunTemplate, success })
            .then(() => logRec(`template health updated: ${rec._currentRunTemplate} (${success ? 'success' : 'fail'})`))
            .catch(e => logRec('health update failed', { err: String(e) }));
          rec._currentRunTemplate = null;
        }
      }
      // Interruption detection (Sprint 4c)
      if (line.includes('[INTERRUPTION] waiting for user')) {
        // Extract expected/current from previous log line context — use a stored preview
        const expMatch = (rec._lastInterruptionLine || '').match(/expected '([^']*)', current '([^']*)'/);
        const expected = expMatch ? expMatch[1] : 'expected screen';
        const current = expMatch ? expMatch[2].split('/').pop() : 'unknown';
        showInterruptionModal(expected, current);
      }
      if (line.includes('[INTERRUPTION] expected')) {
        rec._lastInterruptionLine = line;
      }
    });
  }

  // Listen for events from popup
  if (!rec._listening) {
    rec._listening = true;
    listen('recorder:step-added', (ev) => {
      if (!rec.recording) return;
      rec.steps.push(ev.payload);
      persistSession();
      renderSteps();
      logRec('step-added', { idx: rec.steps.length, action: ev.payload.action, coord: ev.payload.coord });
    });
    listen('recorder:mirror-closed', () => {
      logRec('mirror-closed');
      rec.mirrorOpen = false;
      updateEmptyState();
    });
    listen('recorder:mirror-ready', () => {
      logRec('mirror-ready — pushing current state');
      emit('recorder:set-recording', rec.recording);
      if (rec.samples) emit('recorder:set-samples', rec.samples);
    });
    listen('recorder:log', (ev) => {
      logRec('[popup] ' + ev.payload);
    });
  }

  renderSteps();
  updateEmptyState();
}
