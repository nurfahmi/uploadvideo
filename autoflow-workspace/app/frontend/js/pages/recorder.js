// ── Device Recorder (Sprint 1) ──────────────────────────
// Mirror device screen + capture taps into template JSON.

import { $ } from '../utils/helpers.js';
import state, { on } from '../state.js';
import { appendLog } from '../components/console-panel.js';
import { platformIconTile, detectPlatformFromTemplate } from '../utils/templateMatch.js';
import { toast } from '../components/toast.js';
import { showInputDialog } from '../components/input-dialog.js';
import { t } from '../i18n.js';

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
      editingName: rec._editingName || null,
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
    rec._editingName = s.editingName || null;
    logRec(`restored session: ${rec.steps.length} steps, device=${rec.deviceId || 'none'}, platform=${rec.platform || 'none'}, editing=${rec._editingName || 'new'}`);
  } catch (e) { logRec('restore FAILED', { err: String(e) }); }
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  rec.steps = [];
  rec.samples = null;
  rec.platform = null;
  rec._editingName = null;
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

// Platform-specific sample values used to pre-fill recording. Captions/hashtags
// are what gets typed into the target app's real UI during recording, so they
// should match the platform's conventions (no "#shopee" when on TikTok, etc.).
const SAMPLE_DEFAULTS_BY_PLATFORM = {
  shopee: {
    caption: 'Mobil RC drift keren banget! Wajib punya',
    hashtags: '#mobilrc #shopee #rccar #drift #mainan',
    affiliate_link: 'https://shopee.co.id/Mainan-Mobil-Remote-Control-4WD-High-Speed-3-Kecepatan-RC-Mobil-Drift-Ada-Lampu-20KM-Jam-i.451272134.23343070368',
  },
  tiktok: {
    caption: 'Mobil RC drift keren banget! Wajib punya 🔥',
    hashtags: '#mobilrc #fyp #viral #rccar #mainan',
    affiliate_link: '',
  },
  default: {
    caption: 'Mobil RC drift keren banget! Wajib punya',
    hashtags: '#mobilrc #viral #rccar #mainan',
    affiliate_link: '',
  },
};

function getSampleDefaults(platform) {
  return SAMPLE_DEFAULTS_BY_PLATFORM[platform] || SAMPLE_DEFAULTS_BY_PLATFORM.default;
}

const PLATFORM_PACKAGES = {
  shopee: 'com.shopee.id',
  // TikTok ships under different package IDs per region (global, SEA, CN).
  // Resolved at launch time via `pm list packages` so we hit whichever is installed.
  tiktok: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill', 'com.ss.android.ugc.aweme'],
  instagram: 'com.instagram.android',
  youtube: 'com.google.android.youtube',
  lazada: 'com.lazada.android',
  other: null,
};

const PLATFORM_INTENTS = {
  shopee: '-n com.shopee.id/com.shopee.app.ui.home.HomeActivity_',
  // TikTok launcher activity differs between trill/musically/aweme — use `monkey`
  // instead so we don't have to track activity names per region.
  tiktok: null,
  instagram: '-n com.instagram.android/com.instagram.mainactivity.MainActivity',
  youtube: '-n com.google.android.youtube/com.google.android.apps.youtube.app.WatchWhileActivity',
  lazada: '-n com.lazada.android/com.lazada.android.launcher.LauncherActivity',
  other: null,
};

// Pick the first installed candidate for platforms whose package varies by region.
// For single-string entries, returns it unchanged.
async function resolveInstalledPackage(platformKey, deviceId) {
  const entry = PLATFORM_PACKAGES[platformKey];
  if (!Array.isArray(entry)) return entry;
  try {
    const out = await invoke('adb_shell', { deviceId, command: 'pm list packages' });
    const text = String(out || '');
    const found = entry.find(p => text.includes(`package:${p}\n`) || text.endsWith(`package:${p}`));
    return found || entry[0];
  } catch (e) { return entry[0]; }
}

// Visual identity per platform for the picker (brand colors, SVG marks)
const PLATFORM_UI = {
  shopee: {
    label: 'Shopee',
    bg: '#EE4D2D',
    fg: '#fff',
    svg: '<svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M12 1.4c-2.7 0-5 2.2-5 5H8.8c0-1.7 1.4-3.1 3.2-3.1s3.2 1.4 3.2 3.1H17c0-2.8-2.3-5-5-5zM4.8 8.2c-.5 0-.9.4-.9.9l.9 10.4c.1 1.1 1 1.9 2.1 1.9H17c1.1 0 2-.8 2.1-1.9l.9-10.4c0-.5-.4-.9-.9-.9H4.8zm7.2 10c-2 0-3.7-1.2-4.4-2.9l1.5-.6c.5 1.1 1.6 1.9 2.9 1.9 1.4 0 2.6-1.1 2.6-2.3 0-1.1-.8-1.8-2.6-2.4-2-.6-3.3-1.3-3.3-3.1 0-1.8 1.8-3.1 3.9-3.1 1.8 0 3.2.8 3.8 2l-1.5.7c-.5-.9-1.3-1.3-2.3-1.3-1.2 0-2.1.6-2.1 1.6s1 1.3 2.4 1.8c2.3.7 3.5 1.6 3.5 3.7 0 2-1.9 3.5-4.4 3.5z"/></svg>',
  },
  tiktok: {
    label: 'TikTok',
    bg: '#000',
    fg: '#fff',
    svg: '<svg viewBox="0 0 24 24" width="32" height="32"><path fill="#25F4EE" d="M9.5 21.5A6.5 6.5 0 1 1 16 15V3h3.5a5 5 0 0 0 4.5 4.5V11a8.5 8.5 0 0 1-4.5-1.3V15A6.5 6.5 0 0 1 9.5 21.5Z"/><path fill="#FE2C55" d="M10.5 20.5A6.5 6.5 0 1 1 17 14V2h3.5A5 5 0 0 0 25 6.5V10a8.5 8.5 0 0 1-4.5-1.3V14A6.5 6.5 0 0 1 10.5 20.5Z"/><path fill="#fff" d="M10 21A6.5 6.5 0 1 0 16.5 14.5V2.5H20A4.5 4.5 0 0 0 24.5 7v3A8 8 0 0 1 20 8.7V14.5A6.5 6.5 0 0 1 10 21Zm.5-9.5a3 3 0 1 0 3 3v-6.5h-3v3.5Z"/></svg>',
  },
  instagram: {
    label: 'Instagram',
    bg: 'linear-gradient(135deg,#405DE6,#5851DB,#833AB4,#C13584,#E1306C,#FD1D1D,#F56040,#FCAF45)',
    fg: '#fff',
    svg: '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/></svg>',
  },
  youtube: {
    label: 'YouTube',
    bg: '#FF0000',
    fg: '#fff',
    svg: '<svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M23 7.2s-.2-1.6-.9-2.3c-.9-.9-1.8-.9-2.3-1-3.2-.2-7.9-.2-7.9-.2s-4.7 0-7.9.2c-.5.1-1.5.1-2.3 1-.7.7-.9 2.3-.9 2.3S.6 9 .6 10.9v1.7c0 1.9.2 3.7.2 3.7s.2 1.6.9 2.3c.9.9 2.1.9 2.7 1 1.9.2 8.1.2 8.1.2s4.7 0 7.9-.3c.5-.1 1.5-.1 2.3-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.7V11c.1-1.9-.1-3.8-.1-3.8zM9.5 14.9V8.6l6 3.2-6 3.1z"/></svg>',
  },
  lazada: {
    label: 'Lazada',
    bg: '#0F146D',
    fg: '#fff',
    svg: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 7l6-3 6 3-6 3-6-3z"/><path d="M6 7v9l6 3 6-3V7"/><path d="M12 10v9"/></svg>',
  },
  other: {
    label: 'Lainnya',
    bg: 'var(--c-bg-2)',
    fg: 'var(--c-fg-1)',
    svg: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10" stroke-linecap="round"/></svg>',
  },
};

function showPlatformPicker() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)';

    const order = ['shopee', 'tiktok'];
    const cardHtml = order.map(key => {
      const ui = PLATFORM_UI[key];
      return `
        <button class="plat-btn" data-plat="${key}" style="padding:24px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border:2px solid transparent;border-radius:var(--r-md);font-size:13px;font-weight:600;cursor:pointer;background:${ui.bg};color:${ui.fg};transition:transform .12s, border-color .12s;min-height:140px">
          <span style="width:52px;height:52px;display:flex;align-items:center;justify-content:center;color:${ui.fg}">${ui.svg}</span>
          <span>${ui.label}</span>
        </button>`;
    }).join('');

    overlay.innerHTML = `
      <div class="ui-card" style="width:420px;max-width:92vw;padding:var(--sp-6)">
        <h3 class="t-lg t-strong" style="margin:0 0 var(--sp-2)">${t('rec.platform_title')}</h3>
        <p class="t-sm t-muted" style="margin:0 0 var(--sp-4)">${t('rec.platform_hint')}</p>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-3)">
          ${cardHtml}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:var(--sp-4)">
          <button id="plat-cancel" class="btn btn-ghost btn-sm">${t('rec.platform_cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (r) => { overlay.remove(); resolve(r); };
    overlay.querySelector('#plat-cancel').addEventListener('click', () => close(null));
    overlay.querySelectorAll('.plat-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.03)'; btn.style.borderColor = 'var(--c-accent)'; });
      btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; btn.style.borderColor = 'transparent'; });
      btn.addEventListener('click', () => {
        const plat = btn.dataset.plat;
        if (plat === 'other') {
          // Ask for custom platform name + optional package id so engine can
          // still kill+relaunch the target app (otherwise PLATFORM_PACKAGES
          // lookup returns null and we lose the clean-start behavior).
          const name = prompt(t('rec.platform_custom_name'), '');
          if (name === null || !name.trim()) return;
          const pkg = prompt(t('rec.platform_custom_pkg', { name: name.trim() }), '');
          const key = name.trim().toLowerCase().replace(/\s+/g, '_');
          if (pkg && pkg.trim()) {
            PLATFORM_PACKAGES[key] = pkg.trim();
            PLATFORM_INTENTS[key] = `-a android.intent.action.MAIN -n ${pkg.trim()}`;
          } else {
            PLATFORM_PACKAGES[key] = null;
            PLATFORM_INTENTS[key] = null;
          }
          close(key);
          return;
        }
        close(plat);
      });
    });
  });
}

async function prefillSamplesFromQueue() {
  // Try to pull first queue item values as better defaults than static.
  // Falls back to platform-specific defaults so TikTok recordings don't get
  // Shopee hashtags/links and vice versa.
  const defaults = getSampleDefaults(rec.platform);
  try {
    const q = await invoke('get_queue');
    if (Array.isArray(q) && q.length > 0) {
      const item = q[0];
      return {
        caption: item.caption || defaults.caption,
        hashtags: item.hashtags || defaults.hashtags,
        affiliate_link: item.affiliate_link || defaults.affiliate_link,
      };
    }
  } catch (e) {}
  return { ...defaults };
}

function showSamplesDialog(current) {
  return new Promise(resolve => {
    const s = current || {};
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--c-bg-0);border:1px solid var(--c-bg-3);border-radius:10px;padding:20px;width:460px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.5)">
        <h3 style="font-size:13px;font-weight:600;color:var(--c-fg-0);margin:0 0 4px">${t('rec.samples_title')}</h3>
        <p style="font-size:10px;color:var(--c-fg-3);margin:0 0 14px">${t('rec.samples_hint')}</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="font-size:10px;color:var(--c-fg-2)">${t('rec.samples_caption')}
            <textarea id="sv-caption" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;height:48px;resize:vertical;box-sizing:border-box;margin-top:4px">${escapeHtml(s.caption||'')}</textarea>
          </label>
          <label style="font-size:10px;color:var(--c-fg-2)">${t('rec.samples_hashtags')}
            <input id="sv-hashtags" type="text" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;box-sizing:border-box;margin-top:4px" value="${escapeHtml(s.hashtags||'')}">
          </label>
          <label style="font-size:10px;color:var(--c-fg-2)">${t('rec.samples_link')}
            <input id="sv-link" type="text" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;box-sizing:border-box;margin-top:4px" value="${escapeHtml(s.affiliate_link||'')}" placeholder="https://shopee.co.id/...">
          </label>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button id="sv-skip" class="btn" style="font-size:11px;padding:5px 12px">${t('rec.samples_skip')}</button>
          <button id="sv-ok" class="btn btn-primary" style="font-size:11px;padding:5px 12px">${t('rec.samples_start')}</button>
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
    const hintBanner = suggestion ? `<div style="padding:6px 10px;margin-bottom:10px;background:var(--c-accent-a08);border:1px solid var(--c-accent-a20);border-radius:5px;font-size:10px;color:var(--c-fg-1)">💡 ${t('rec.type_dialog_hint')}</div>` : '';
    overlay.innerHTML = `
      <div style="background:var(--c-bg-0);border:1px solid var(--c-bg-3);border-radius:10px;padding:20px;width:460px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.5)">
        <h3 style="font-size:13px;font-weight:600;color:var(--c-fg-0);margin:0 0 4px">${t('rec.type_dialog_title')}</h3>
        <p style="font-size:10px;color:var(--c-fg-3);margin:0 0 12px;font-family:'IBM Plex Mono',monospace;word-break:break-all">${t('rec.type_dialog_target', { sel: escapeHtml(sel) })}</p>
        ${hintBanner}
        <textarea id="td-text" style="width:100%;height:72px;padding:8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;font-family:inherit;resize:vertical;box-sizing:border-box" placeholder="${t('rec.type_dialog_placeholder')}">${escapeHtml(suggestion || '')}</textarea>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
          <span style="font-size:10px;color:var(--c-fg-3);margin-right:4px">${t('rec.type_dialog_insert')}</span>
          ${DEFAULT_VARIABLES.map(v => `<button class="td-chip" data-var="${v}" style="background:var(--c-bg-2);border:1px solid var(--c-bg-3);color:var(--c-fg-1);padding:3px 8px;border-radius:12px;font-size:10px;font-family:'IBM Plex Mono',monospace;cursor:pointer">{{${v}}}</button>`).join('')}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button id="td-cancel" class="btn" style="font-size:11px;padding:5px 12px">${t('shared.cancel')}</button>
          <button id="td-ok" class="btn btn-primary" style="font-size:11px;padding:5px 12px">${t('shared.save')}</button>
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
      if (!text) { alert(t('rec.text_empty')); return; }
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
    alert(t('rec.type_failed_alert', { err: String(e) }));
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
  const sec = parseFloat(prompt(t('rec.wait_prompt'), '3'));
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
  // Preserve scroll-to-bottom intent: if the user is already near the bottom
  // (or actively recording), auto-scroll to latest. If they scrolled up to
  // inspect a past step, don't yank them back to the bottom.
  const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const shouldAutoScroll = rec.recording || wasNearBottom;
  if (rec.steps.length === 0) {
    list.innerHTML = `<div style="color:var(--c-fg-3);font-size:11px;padding:12px;text-align:center">${t('rec.empty_step_list')}</div>`;
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
        <div style="color:var(--c-accent);font-size:10px;margin-top:3px;font-family:'IBM Plex Mono',monospace">${t('rec.type_prefix', { val: escapeHtml(val).slice(0, 80) })}</div>`;
    } else if (action === 'screenshot') {
      body = `<div style="color:var(--c-fg-2);font-size:10px;font-family:'IBM Plex Mono',monospace">📸 ${t('rec.screenshot_note', { file: escapeHtml(s.output || '_shot.png') })}</div>`;
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
          <span style="font-weight:600;color:var(--c-fg-0);flex:1">${statusIcon} ${t('rec.step_label', { n: i + 1, action })}</span>
          <button data-idx="${i}" class="recorder-edit-delay" title="${t('rec.step_delay_title')}" style="background:none;border:1px dashed var(--c-bg-3);border-radius:3px;padding:1px 6px;font-size:9px;${delayStyle};cursor:pointer;font-family:'IBM Plex Mono',monospace">⏱ ${delay}s</button>
          <button data-idx="${i}" class="recorder-step-menu" title="${t('rec.step_menu_title')}" style="background:none;border:none;color:var(--c-fg-3);cursor:pointer;font-size:14px;padding:0 4px">⋮</button>
          <button data-idx="${i}" class="recorder-del-step" title="${t('rec.step_delete_title')}" style="background:none;border:none;color:var(--c-fg-3);cursor:pointer;font-size:14px">×</button>
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
    btn.addEventListener('click', async () => {
      const i = parseInt(btn.dataset.idx, 10);
      const current = stepDelaySeconds(i);
      const result = await showDelayDialog(i + 1, current, rec.steps[i].custom_delay_seconds != null);
      if (result == null) return;
      if (result === 'reset') {
        delete rec.steps[i].custom_delay_seconds;
        logRec(`step ${i + 1} delay reset to auto`);
      } else {
        rec.steps[i].custom_delay_seconds = result;
        logRec(`step ${i + 1} delay → ${result}s (custom)`);
      }
      persistSession();
      renderSteps();
    });
  });
  // Auto-scroll to latest step when recording (or when user was already at bottom)
  if (shouldAutoScroll) {
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }
}

// Custom delay editor — returns Promise<number|'reset'|null>.
// Uses a real DOM modal (window.prompt is unreliable in Tauri webviews).
function showDelayDialog(stepNum, currentSec, isCustom) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
    overlay.innerHTML = `
      <div class="ui-card" style="width:360px;max-width:92vw;padding:var(--sp-4)">
        <h3 class="t-lg t-strong" style="margin:0 0 var(--sp-2)">${t('rec.delay_title', { n: stepNum })}</h3>
        <p class="t-xs t-muted" style="margin:0 0 var(--sp-3)">${t('rec.delay_hint')}</p>
        <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3)">
          <input id="dly-input" type="number" min="0" max="120" step="0.5" class="inp" style="flex:1;font-family:'IBM Plex Mono',monospace" value="${currentSec}" />
          <span class="t-sm t-muted">${t('rec.delay_unit')}</span>
        </div>
        <div style="display:flex;gap:var(--sp-2);flex-wrap:wrap;margin-bottom:var(--sp-3)">
          ${[1, 2, 3, 5, 8].map(s => `<button class="btn btn-ghost btn-sm" data-preset="${s}">${s}s</button>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--sp-2)">
          <button id="dly-reset" class="btn btn-ghost btn-sm" ${isCustom ? '' : 'style="opacity:.4;pointer-events:none"'}>${t('rec.delay_reset')}</button>
          <div style="display:flex;gap:var(--sp-2)">
            <button id="dly-cancel" class="btn btn-ghost btn-sm">${t('rec.delay_cancel')}</button>
            <button id="dly-ok" class="btn btn-primary btn-sm">${t('rec.delay_ok')}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const inp = overlay.querySelector('#dly-input');
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('#dly-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('#dly-reset').addEventListener('click', () => close('reset'));
    overlay.querySelector('#dly-ok').addEventListener('click', () => {
      const v = parseFloat(inp.value);
      if (isNaN(v) || v < 0 || v > 120) { inp.style.borderColor = 'var(--c-red)'; return; }
      close(v);
    });
    overlay.querySelectorAll('[data-preset]').forEach(b => {
      b.addEventListener('click', () => close(parseFloat(b.dataset.preset)));
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('#dly-ok').click();
      if (e.key === 'Escape') close(null);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
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
      <h3 style="font-size:14px;font-weight:600;color:var(--c-amber);margin:0 0 8px">${t('rec.interrupt_title')}</h3>
      <div style="font-size:12px;color:var(--c-fg-1);margin-bottom:14px;line-height:1.5">
        ${t('rec.interrupt_body', { expected: escapeHtml(expected), current: escapeHtml(current) })}
      </div>
      <div style="font-size:11px;color:var(--c-fg-2);padding:10px 12px;background:var(--c-bg-2);border-radius:6px;margin-bottom:14px">
        ${t('rec.interrupt_hint')}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="intr-abort" class="btn" style="font-size:11px;padding:6px 14px;color:var(--c-red)">${t('rec.interrupt_abort')}</button>
        <button id="intr-skip" class="btn" style="font-size:11px;padding:6px 14px">${t('rec.interrupt_skip')}</button>
        <button id="intr-resume" class="btn btn-primary" style="font-size:11px;padding:6px 14px;font-weight:600">${t('rec.interrupt_resume')}</button>
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
    { label: t('rec.step_move_up'), act: () => moveStep(i, i - 1), disabled: i === 0 },
    { label: t('rec.step_move_down'), act: () => moveStep(i, i + 1), disabled: i === rec.steps.length - 1 },
    { label: t('rec.step_duplicate'), act: () => duplicateStep(i) },
    { sep: true },
    { label: t('rec.step_insert_wait'), act: () => insertWaitStep(i) },
    { label: t('rec.step_insert_screenshot'), act: () => insertScreenshotStep(i) },
    { sep: true },
    { label: t('rec.step_truncate'), act: () => {
        if (confirm(t('rec.truncate_confirm', { n: i + 1, count: rec.steps.length - i }))) {
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

    // Kill + relaunch target app via ADB shell (fast: ~200ms total, no Python).
    const pkg = await resolveInstalledPackage(picked, rec.deviceId);
    const intent = PLATFORM_INTENTS[picked];
    if (pkg && rec.deviceId) {
      logRec(`killing ${pkg} for clean start...`);
      try {
        await invoke('adb_shell', {
          deviceId: rec.deviceId,
          command: `am force-stop ${pkg}`,
        });
      } catch (e) { logRec(`force-stop failed: ${e}`); }
      try {
        // Prefer explicit intent when we know it; otherwise `monkey` asks the
        // package manager for the launcher activity — works across regional
        // TikTok variants (trill/musically/aweme) without hardcoding names.
        const cmd = intent
          ? `am start ${intent}`
          : `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`;
        await invoke('adb_shell', { deviceId: rec.deviceId, command: cmd });
        logRec(`launched ${pkg}`);
      } catch (e) { logRec(`launch failed: ${e}`); }
    }
    persistSession();
  }
  if (on && !rec.samples) {
    // Use platform-specific defaults (ignore queue — queue may hold shopee
    // items even when recording a tiktok flow, which would leak wrong hashtags
    // into the caption dialog).
    rec.samples = { ...getSampleDefaults(rec.platform) };
    logRec(`recording start: using ${rec.platform || 'default'} samples`, rec.samples);
    persistSession();
  }
  rec.recording = on;
  const btn = $('#recorder-btn-record');
  if (btn) {
    btn.textContent = on ? `⏸ ${t('rec.btn_record')}` : `● ${t('rec.btn_record')}`;
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
        <h3 style="font-size:13px;font-weight:600;color:var(--c-fg-0);margin:0 0 12px">${t('rec.save_title')}</h3>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="font-size:10px;color:var(--c-fg-2)">${t('rec.save_name_label')}
            <input id="st-name" type="text" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;box-sizing:border-box;margin-top:4px" value="${escapeHtml(d.name || '')}" placeholder="${t('rec.save_name_placeholder')}">
          </label>
          <label style="font-size:10px;color:var(--c-fg-2)">${t('rec.save_desc_label')}
            <textarea id="st-desc" style="width:100%;padding:6px 8px;border:1px solid var(--c-bg-3);border-radius:5px;background:var(--c-bg-1);color:var(--c-fg-0);font-size:11px;height:52px;resize:vertical;box-sizing:border-box;margin-top:4px" placeholder="${t('rec.save_desc_placeholder')}">${escapeHtml(d.description || '')}</textarea>
          </label>
        </div>
        <div style="font-size:10px;color:var(--c-fg-3);margin-top:8px">
          ${t('rec.save_info', { count: d.stepCount || 0, platform: escapeHtml(d.platform || 'auto-detect'), device: escapeHtml(d.deviceId || 'unknown') })}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button id="st-cancel" class="btn" style="font-size:11px;padding:5px 12px">${t('rec.save_cancel')}</button>
          <button id="st-ok" class="btn btn-primary" style="font-size:11px;padding:5px 12px">${t('rec.save_ok')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const nameEl = overlay.querySelector('#st-name');
    setTimeout(() => { nameEl.focus(); nameEl.select(); }, 50);
    const close = (r) => { overlay.remove(); resolve(r); };
    overlay.querySelector('#st-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('#st-ok').addEventListener('click', () => {
      const name = nameEl.value.trim();
      if (!name) { alert(t('rec.save_name_required')); return; }
      // Platform is passed in from defaults (auto-detected from rec.platform or activity_before)
      close({
        name,
        platform: d.platform || 'other',
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
  if (!health || !health.runs) return `<span class="ui-chip t-xs">${t('rec.health_unused')}</span>`;
  const rate = health.success / health.runs;
  const cls = rate >= 0.8 ? 'ui-chip-ok' : rate >= 0.5 ? 'ui-chip-warn' : 'ui-chip-err';
  return `<span class="ui-chip ${cls} t-xs">${t('rec.health_count', { success: health.success, total: health.runs })}</span>`;
}

async function renderTemplatesGrid() {
  const grid = $('#tpl-grid');
  if (!grid) return;
  let names = [];
  try { names = await invoke('recorder_list_templates') || []; } catch (e) { logRec('list templates failed', { err: String(e) }); }
  const query = ($('#tpl-search')?.value || '').toLowerCase().trim();
  if (names.length === 0) {
    grid.innerHTML = `
      <div class="ui-card" style="padding:var(--sp-8);text-align:center">
        <div style="font-size:48px;margin-bottom:var(--sp-3);opacity:.5">📋</div>
        <h3 class="t-lg t-strong" style="margin-bottom:var(--sp-2)">${t('rec.empty_grid_title')}</h3>
        <p class="t-sm t-muted" style="max-width:380px;margin:0 auto var(--sp-4);line-height:1.5">
          ${t('rec.empty_grid_body')}
        </p>
      </div>`;
    return;
  }
  const entries = await Promise.all(names.map(async n => {
    try { return { n, tpl: await invoke('recorder_get_template', { name: n }) }; }
    catch { return { n, tpl: null }; }
  }));
  const filtered = entries.filter(e => !query || e.n.toLowerCase().includes(query) || (e.tpl?.platform || '').toLowerCase().includes(query));
  if (filtered.length === 0) {
    grid.innerHTML = `<div style="padding:32px;text-align:center;color:var(--c-fg-3);font-size:12px">${t('rec.tpl_grid_not_match', { q: escapeHtml(query) })}</div>`;
    return;
  }
  grid.innerHTML = filtered.map(({ n, tpl }) => {
    const steps = tpl?.steps?.length || 0;
    const detected = detectPlatformFromTemplate(tpl);
    const platform = detected !== 'other' ? detected : (tpl?.platform || 'unknown').toLowerCase();
    const health = tpl?.health;
    return `
      <div class="ui-card ui-card-interactive tpl-card" data-name="${escapeHtml(n)}" style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) var(--sp-3)">
        ${platformIconTile(tpl || platform, 28)}
        <div style="flex:1;min-width:0">
          <div class="t-sm t-strong" title="${escapeHtml(n)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(n)}</div>
          <div class="t-xs t-muted" style="margin-top:1px">${t('rec.tpl_step_count', { n: steps, platform })}</div>
        </div>
        <div style="flex-shrink:0">${healthBadge(health)}</div>
        <button class="tpl-run btn btn-primary btn-sm" data-name="${escapeHtml(n)}" style="flex-shrink:0">${t('rec.tpl_use')}</button>
        <button class="tpl-menu btn btn-ghost btn-sm btn-icon" data-name="${escapeHtml(n)}" title="Menu" style="flex-shrink:0">⋮</button>
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

// ── Template card action handlers ──────────────────
export async function loadTemplateIntoSession(name) {
  if (rec.steps.length > 0) {
    if (!confirm(t('rec.load_replace_confirm', { n: rec.steps.length, name }))) return;
  }
  try {
    const tpl = await invoke('recorder_get_template', { name });
    rec.steps = Array.isArray(tpl.steps) ? tpl.steps : [];
    rec.platform = tpl.platform || null;
    rec.samples = tpl.samples || null;
    rec._editingName = name;  // remember the name so Save defaults back to it
    persistSession();
    updateEditingBar();
    renderSteps();
    document.getElementById('recorder-steps')?.scrollIntoView({ behavior: 'smooth' });
    logRec(`template loaded for editing: ${name} (${rec.steps.length} steps)`);
  } catch (e) {
    alert(t('rec.load_fail_alert', { err: String(e) }));
  }
}

async function renameTemplateFlow(name) {
  const newName = await showInputDialog({
    title: t('rec.rename_title'),
    message: t('rec.rename_from', { name }),
    defaultValue: name,
    placeholder: 'nama_baru',
    okLabel: t('rec.rename_ok'),
  });
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === name) return;
  try {
    await invoke('recorder_rename_template', { oldName: name, newName: trimmed });
    try {
      const { renameTestsForTemplate } = await import('../state.js');
      renameTestsForTemplate(name, trimmed);
    } catch {}
    logRec(`template renamed: ${name} → ${trimmed}`);
    toast.success(t('rec.rename_done', { name: trimmed }), { title: t('rec.rename_done_title') });
    renderTemplatesGrid();
    refreshTemplateList();
  } catch (e) { toast.error(String(e), { title: t('rec.rename_fail') }); }
}

async function duplicateTemplateFlow(name) {
  try {
    const suggested = await invoke('recorder_next_copy_name', { sourceName: name });
    const newName = await showInputDialog({
      title: t('rec.dup_title'),
      message: t('rec.rename_from', { name }),
      defaultValue: suggested,
      placeholder: 'nama_copy',
      okLabel: t('rec.dup_ok'),
    });
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    const src = await invoke('recorder_get_template', { name });
    const payload = {
      ...src,
      name: trimmed,
      recorded_at: new Date().toISOString(),
    };
    delete payload.health;
    await invoke('recorder_save_template', { name: trimmed, data: payload });
    logRec(`template duplicated: ${name} → ${trimmed}`);
    toast.success(t('rec.dup_done', { name: trimmed }), { title: t('rec.dup_done_title') });
    renderTemplatesGrid();
    refreshTemplateList();
  } catch (e) { toast.error(String(e), { title: t('rec.dup_fail') }); }
}

// Strip device-/install-specific fields so the exported JSON can be imported
// on a different machine/phone without surprising behavior. Steps themselves
// are portable (resolveInstalledPackage + monkey handles launcher variants).
function sanitizeForExport(tpl) {
  const clone = JSON.parse(JSON.stringify(tpl || {}));
  delete clone.health;
  if (clone.device_profile) {
    delete clone.device_profile.serial;
    delete clone.device_profile.device_id;
  }
  return clone;
}

async function exportTemplateFlow(name) {
  try {
    const tpl = await invoke('recorder_get_template', { name });
    const payload = sanitizeForExport(tpl);
    const json = JSON.stringify(payload, null, 2);
    const filename = `${name}.json`;
    const defaultPath = await invoke('default_export_path', { filename }).catch(() => filename);
    const save = window.__TAURI__?.dialog?.save;
    if (!save) { alert(t('rec.export_fail') + 'dialog unavailable'); return; }
    const chosen = await save({
      defaultPath,
      filters: [{ name: 'JSON', extensions: ['json'] }],
      title: t('rec.export_dialog_title'),
    });
    if (!chosen) return;
    await invoke('write_text_file', { path: chosen, content: json });
    logRec(`template exported: ${name} → ${chosen}`);
    toast.success(t('rec.export_done_body', { path: chosen.split('/').pop() }), {
      title: t('rec.export_done_title'),
    });
  } catch (e) {
    toast.error(t('rec.export_fail') + String(e));
  }
}

async function importTemplateFlow() {
  try {
    const open = window.__TAURI__?.dialog?.open;
    if (!open) { alert('dialog unavailable'); return; }
    const chosen = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
      title: t('rec.import_dialog_title'),
    });
    if (!chosen) return;
    const content = await invoke('read_text_file', { path: chosen });
    let data;
    try { data = JSON.parse(content); }
    catch (e) { toast.error(String(e), { title: t('rec.import_fail_title') }); return; }
    if (!data || !Array.isArray(data.steps)) {
      toast.error(t('rec.import_invalid_body'), { title: t('rec.import_fail_title') });
      return;
    }
    // Suggest a name from the file or template, letting user rename to avoid collisions.
    const fileBase = chosen.split('/').pop().split('\\').pop().replace(/\.json$/i, '');
    const suggested = data.name || fileBase;
    const newName = await showInputDialog({
      title: t('rec.import_name_title'),
      message: t('rec.import_name_hint'),
      defaultValue: suggested,
      placeholder: suggested,
    });
    if (newName === null) return;
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    const payload = { ...sanitizeForExport(data), name: trimmed, imported_at: new Date().toISOString() };
    await invoke('recorder_save_template', { name: trimmed, data: payload });
    logRec(`template imported: ${chosen} → ${trimmed} (${data.steps.length} steps)`);
    toast.success(t('rec.import_done_body', { name: trimmed, n: data.steps.length }), {
      title: t('rec.import_done_title'),
    });
    renderTemplatesGrid();
    refreshTemplateList();
  } catch (e) {
    toast.error(String(e), { title: t('rec.import_fail_title') });
  }
}

function showTemplateCardMenu(anchor, name) {
  document.querySelectorAll('.tpl-card-menu').forEach(m => m.remove());
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'tpl-card-menu ui-card';
  menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right}px;padding:var(--sp-1) 0;min-width:128px;box-shadow:var(--elev-2);z-index:9999`;
  const items = [
    { label: t('rec.menu_edit'), act: async () => { await loadTemplateIntoSession(name); } },
    { label: t('rec.menu_rename'), act: async () => { await renameTemplateFlow(name); } },
    { label: t('rec.menu_duplicate'), act: async () => { await duplicateTemplateFlow(name); } },
    { label: t('rec.menu_export'), act: async () => { await exportTemplateFlow(name); } },
    { sep: true },
    { label: t('rec.menu_delete'), danger: true, act: async () => {
        if (!confirm(t('rec.del_confirm', { name }))) return;
        try {
          await invoke('recorder_delete_template', { name });
          try {
            const { removeTestsForTemplate } = await import('../state.js');
            removeTestsForTemplate(name);
          } catch {}
          logRec(`template deleted: ${name}`);
          renderTemplatesGrid();
        } catch (e) { alert(t('rec.del_fail') + String(e)); }
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
    el.style.cssText = `padding:5px var(--sp-3);cursor:pointer;font-size:var(--fs-sm);color:${it.danger ? 'var(--c-red)' : 'var(--c-fg-1)'}`;
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
        const tpl = await invoke('recorder_get_template', { name: n });
        const h = tpl?.health;
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
          ${hasError ? t('rec.prerun_error_title') : t('rec.prerun_warn_title')}
        </h3>
        <p style="font-size:10px;color:var(--c-fg-3);margin:0 0 12px">
          ${hasError ? t('rec.prerun_error_hint') : t('rec.prerun_warn_hint')}
        </p>
        <div style="max-height:260px;overflow:auto;font-size:11px">${rows}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button id="pr-cancel" class="btn" style="font-size:11px;padding:6px 14px">${t('rec.prerun_cancel')}</button>
          ${hasError ? '' : `<button id="pr-go" class="btn btn-primary" style="font-size:11px;padding:6px 14px">${t('rec.prerun_go')}</button>`}
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
  if (!name) { alert(t('rec.pick_template_alert')); return; }
  if (!rec.deviceId) { alert(t('rec.no_device_alert')); return; }

  // Validate attached device is still connected (guard against stale session)
  try {
    const devices = await invoke('list_devices');
    const ids = (devices || []).map(d => d[0]);
    if (!ids.includes(rec.deviceId)) {
      alert(t('rec.device_gone_alert', { id: rec.deviceId, list: ids.join(', ') || 'none' }));
      // Clear stale state
      rec.deviceId = null;
      persistSession();
      const label = $('#recorder-device-label');
      if (label) label.textContent = t('rec.device_label_none');
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
    videoPath = prompt(t('rec.video_prompt'), '/Users/aleekhabib/Downloads/test_video.mp4');
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
    setRunningUI(true, { templateName: name, progress: t('rec.engine_prep') });
    await invoke('start_automation', {
      deviceIds: [rec.deviceId],
      flowName: result.flow_name,
      vars,
    });
    logRec('engine kicked off — watch Console panel below');
  } catch (e) {
    logRec('run FAILED', { err: String(e) });
    setRunningUI(false);
    toast.error(String(e), { title: t('rec.run_fail_start') });
  }
}

async function handleSave() {
  if (rec.steps.length === 0) { alert(t('rec.no_steps')); return; }
  // Bring main window to front (it may be hidden behind the always-on-top mirror popup)
  try {
    const { getCurrentWindow } = window.__TAURI__.window;
    const w = getCurrentWindow();
    await w.setFocus();
  } catch (e) { /* ignore */ }
  const firstAct = (rec.steps[0]?.activity_before || '').toLowerCase();
  const platformGuess = rec.platform
                      || (firstAct.includes('shopee') ? 'shopee'
                      : (firstAct.includes('musically') || firstAct.includes('trill') || firstAct.includes('aweme') || firstAct.includes('zhiliao')) ? 'tiktok'
                      : 'other');

  // If editing an existing template, save directly without prompting — this
  // prevents accidental "save as new" when the user just wanted to persist edits.
  let result;
  if (rec._editingName) {
    // Preserve existing description from the original template (if any)
    let existingDescription = '';
    try {
      const orig = await invoke('recorder_get_template', { name: rec._editingName });
      existingDescription = orig?.description || '';
    } catch {}
    result = {
      name: rec._editingName,
      platform: platformGuess,
      description: existingDescription,
    };
    logRec(`save (overwrite): ${rec._editingName}`);
  } else {
    const defaultName = `template_${platformGuess}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
    result = await showSaveTemplateDialog({
      name: defaultName,
      platform: platformGuess,
      description: '',
      stepCount: rec.steps.length,
      deviceId: rec.deviceId,
    });
    if (!result) { logRec('save cancelled'); return; }
  }

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
    const savedName = result.name;
    const savedStepCount = rec.steps.length;
    // Clean exit: clear session + editing state so the step list resets. User
    // gets a clear visual cue that save succeeded (empty list + updated grid),
    // then picks Edit again from the card if they want to continue iterating.
    clearSession();
    rec._editingName = null;
    persistSession();
    updateEditingBar();
    renderSteps();
    renderTemplatesGrid();
    refreshTemplateList();
    toast.success(t('rec.saved_body', { n: savedStepCount }), { title: savedName });
  } catch (e) {
    logRec('save FAILED', { err: String(e) });
    toast.error(String(e), { title: t('rec.save_failed_title') });
  }
}

function handleClear() {
  if (rec.steps.length === 0) return;
  if (!confirm(t('rec.clear_confirm', { n: rec.steps.length }))) return;
  clearSession();
  rec._editingName = null;
  updateEditingBar();
  renderSteps();
}

function handleCancelEdit() {
  if (!rec._editingName) return;
  const name = rec._editingName;
  if (rec.steps.length > 0) {
    if (!confirm(t('rec.cancel_edit_confirm', { name }))) return;
  }
  rec._editingName = null;
  rec.steps = [];
  rec.samples = null;
  rec.platform = null;
  persistSession();
  updateEditingBar();
  renderSteps();
  logRec(`edit cancelled: ${name}`);
}

function setRunningUI(running, { templateName, progress } = {}) {
  rec._isRunning = running;
  const bar = $('#recorder-running-bar');
  const title = $('#rr-title');
  const prog = $('#rr-progress');
  if (!bar) return;
  if (running) {
    bar.style.display = 'flex';
    if (title) title.textContent = t('rec.running_prefix', { name: templateName || rec._currentRunTemplate || 'template' });
    if (prog && progress) prog.textContent = progress;
  } else {
    bar.style.display = 'none';
  }
  // Disable all "Pakai →" buttons + top recording/attach actions while running
  document.querySelectorAll('.tpl-run').forEach(b => b.disabled = !!running);
  const btns = ['#recorder-btn-record', '#recorder-btn-attach', '#recorder-btn-detach', '#tpl-btn-new'];
  btns.forEach(sel => { const el = $(sel); if (el) el.disabled = !!running; });
}

async function stopCurrentRun() {
  rec._stopRequested = true;
  try {
    await invoke('stop_automation');
    logRec('stop signal sent');
    toast.warn(t('rec.stop_sending'), { title: t('rec.stopping_title') });
  } catch (e) {
    rec._stopRequested = false;
    logRec('stop failed', { err: String(e) });
    toast.error(String(e), { title: t('rec.stop_fail_title') });
  }
}

function updateEditingBar() {
  const cancel = $('#recorder-btn-cancel-edit');
  const saveBtn = $('#recorder-btn-save');
  if (!cancel) return;
  if (rec._editingName) {
    cancel.style.display = 'inline-flex';
    if (saveBtn) saveBtn.textContent = t('rec.btn_save_editing', { name: rec._editingName });
  } else {
    cancel.style.display = 'none';
    if (saveBtn) saveBtn.textContent = t('rec.btn_save');
  }
}

async function pickDevice() {
  try {
    const devices = await invoke('list_devices');
    if (!devices || devices.length === 0) {
      alert(t('rec.no_device_list'));
      return null;
    }
    if (devices.length === 1) return devices[0][0];
    // Multiple: prompt
    const list = devices.map((d, i) => `${i + 1}. ${d[0]} (${d[1] || '?'})`).join('\n');
    const pick = prompt(t('rec.multi_device_prompt', { list }), '1');
    const idx = parseInt(pick, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= devices.length) return null;
    return devices[idx][0];
  } catch (e) {
    alert(t('rec.cannot_list_devices', { err: String(e) }));
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
    alert(t('rec.open_mirror_fail', { err: String(e) }));
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
  if (label) label.textContent = t('rec.device_label_none');
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
    if (hint) hint.textContent = t('rec.hint_no_device');
    if (attachBtn) attachBtn.style.display = 'inline-flex';
    if (reopenBtn) reopenBtn.style.display = 'none';
    if (detachBtn) detachBtn.style.display = 'none';
    if (recordBtn) recordBtn.style.display = 'none';
    if (sub) sub.textContent = t('rec.sub_no_device');
    if (icon) icon.textContent = '📱';
  } else {
    if (hint) hint.textContent = rec.recording
      ? t('rec.hint_recording')
      : t('rec.hint_ready');
    if (attachBtn) attachBtn.style.display = 'none';
    if (reopenBtn) reopenBtn.style.display = rec.mirrorOpen ? 'none' : 'inline-flex';
    if (detachBtn) detachBtn.style.display = 'inline-flex';
    if (recordBtn) recordBtn.style.display = 'inline-flex';
    if (sub) sub.textContent = rec.mirrorOpen ? t('rec.mirror_active') : t('rec.mirror_reopen_hint');
    if (icon) icon.textContent = rec.recording ? '🔴' : '🟢';
  }
}

export function init() {
  on('lang', render);
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
            <div id="recorder-device-label" class="t-md t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t('rec.device_label_none')}</div>
            <div id="rec-device-sub" class="t-xs t-muted" style="margin-top:2px">${t('rec.device_sub_none')}</div>
          </div>
        </div>
        <div id="rec-actions" style="display:flex;gap:var(--sp-2);align-items:center">
          <button id="recorder-btn-attach" class="btn btn-primary">${t('rec.btn_attach')}</button>
          <button id="recorder-btn-reopen" class="btn btn-secondary btn-sm" style="display:none">${t('rec.btn_reopen')}</button>
          <button id="recorder-btn-detach" class="btn btn-ghost btn-sm" style="display:none">${t('rec.btn_detach')}</button>
          <button id="recorder-btn-record" class="btn btn-primary" style="display:none">${t('rec.btn_record')}</button>
          <span id="recorder-indicator" style="display:none;align-items:center;color:var(--c-red)">
            <span style="width:10px;height:10px;border-radius:50%;background:var(--c-red);animation:pulse 1s infinite"></span>
          </span>
        </div>
      </div>
      <!-- Running banner (shown while template replay is active) -->
      <div id="recorder-running-bar" style="display:none;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);background:var(--c-amber-a12);border:1px solid var(--c-amber-a20);border-radius:var(--r-md)">
        <span style="width:10px;height:10px;border-radius:50%;background:var(--c-amber);animation:pulse 1s infinite;flex-shrink:0"></span>
        <div style="flex:1;min-width:0">
          <div class="t-sm t-strong" style="color:var(--c-amber)" id="rr-title">${t('rec.running_template')}</div>
          <div class="t-xs t-muted" id="rr-progress" style="margin-top:2px">${t('rec.preparing')}</div>
        </div>
        <button id="recorder-btn-stop" class="btn btn-danger btn-sm">
          <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24" style="margin-right:4px"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
          ${t('rec.btn_stop')}
        </button>
      </div>

      <!-- Hint (Ready info — right after device bar for clearer hierarchy) -->
      <div id="recorder-hint" style="padding:10px 14px;background:var(--c-accent-a08);border:1px solid var(--c-accent-a20);border-radius:6px;font-size:11px;color:var(--c-fg-1)"></div>
      <!-- Template Library -->
      <div style="display:flex;flex-direction:column;gap:var(--sp-3)">
        <div id="tpl-section-header" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none">
          <div>
            <h2 class="t-lg t-strong" style="margin:0">${t('rec.tpl_title')}</h2>
            <p class="t-sm t-muted" style="margin-top:2px">${t('rec.tpl_subtitle')}</p>
          </div>
          <svg id="tpl-chevron" width="16" height="16" fill="none" stroke="var(--c-fg-2)" stroke-width="2" viewBox="0 0 24 24" style="transition:transform .15s"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
        </div>
        <div id="tpl-section-body" style="display:flex;flex-direction:column;gap:var(--sp-3)">
          <div style="display:flex;align-items:center;gap:var(--sp-2)">
            <button id="tpl-btn-new" class="btn btn-primary">${t('rec.tpl_new')}</button>
            <button id="tpl-btn-import" class="btn btn-secondary">${t('rec.tpl_import')}</button>
            <input id="tpl-search" class="inp" type="text" placeholder="${t('rec.tpl_search')}" style="flex:1;max-width:240px" />
            <button id="tpl-btn-refresh" class="btn btn-ghost btn-icon" title="${t('rec.tpl_refresh')}">↻</button>
          </div>
          <div id="tpl-grid" style="display:flex;flex-direction:column;gap:var(--sp-2)">
            <div style="text-align:center;padding:var(--sp-8) 0" class="t-muted t-sm">${t('rec.tpl_loading')}</div>
          </div>
        </div>
      </div>
      <div style="height:1px;background:var(--c-bg-2);margin:4px 0"></div>
      <!-- Legacy picker (hidden, compat only) -->
      <select id="recorder-tpl-select" style="display:none"></select>
      <button id="recorder-btn-tpl-refresh" style="display:none"></button>
      <button id="recorder-btn-tpl-run" style="display:none"></button>
      <!-- Steps -->
      <div style="display:flex;flex-direction:column;border:1px solid var(--c-bg-2);border-radius:8px;overflow:hidden;min-height:320px;flex-shrink:0">
        <div style="padding:10px 14px;background:var(--c-bg-2);border-bottom:1px solid var(--c-bg-3);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:2">
          <span class="t-lg t-strong">${t('rec.steps_title')}</span>
          <div style="display:flex;gap:6px">
            <button id="recorder-btn-cancel-edit" class="btn btn-ghost btn-sm" style="display:none">${t('rec.btn_cancel_edit')}</button>
            <button id="recorder-btn-clear" class="btn btn-sm">${t('rec.btn_clear')}</button>
            <button id="recorder-btn-save" class="btn btn-primary btn-sm">${t('rec.btn_save')}</button>
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
    if (!rec.deviceId) { alert(t('rec.no_device_alert')); return; }
    await setRecording(!rec.recording);
  });
  $('#recorder-btn-reopen').addEventListener('click', async () => { await openMirrorPopup(); updateEmptyState(); });
  $('#recorder-btn-clear').addEventListener('click', handleClear);
  $('#recorder-btn-save').addEventListener('click', handleSave);
  $('#recorder-btn-cancel-edit').addEventListener('click', handleCancelEdit);
  $('#recorder-btn-stop')?.addEventListener('click', stopCurrentRun);
  updateEditingBar();  // reflect restored editing state on first render
  $('#recorder-btn-tpl-refresh')?.addEventListener('click', refreshTemplateList);
  $('#recorder-btn-tpl-run')?.addEventListener('click', runSelectedTemplate);
  // New grid UI
  $('#tpl-btn-refresh')?.addEventListener('click', renderTemplatesGrid);
  $('#tpl-btn-import')?.addEventListener('click', importTemplateFlow);
  $('#tpl-search')?.addEventListener('input', () => {
    clearTimeout(rec._searchTimer);
    rec._searchTimer = setTimeout(renderTemplatesGrid, 120);
  });
  // Collapsible Template section — persist open/closed across sessions
  const TPL_COLLAPSE_KEY = 'auv-rec-tpl-collapsed';
  const applyTplCollapsed = (collapsed) => {
    const body = $('#tpl-section-body');
    const chev = $('#tpl-chevron');
    if (body) body.style.display = collapsed ? 'none' : 'flex';
    if (chev) chev.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0)';
  };
  applyTplCollapsed(localStorage.getItem(TPL_COLLAPSE_KEY) === '1');
  $('#tpl-section-header')?.addEventListener('click', () => {
    const next = localStorage.getItem(TPL_COLLAPSE_KEY) !== '1';
    localStorage.setItem(TPL_COLLAPSE_KEY, next ? '1' : '0');
    applyTplCollapsed(next);
  });
  $('#tpl-btn-new')?.addEventListener('click', async () => {
    if (!rec.deviceId) {
      // Auto-start the attach flow (picks device, opens mirror) so user
      // doesn't have to click twice.
      $('#recorder-btn-attach')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await attachDevice();
      if (!rec.deviceId) return;  // attach was cancelled/failed
    }
    // If steps exist in session, confirm before discarding
    if (rec.steps.length > 0) {
      if (!confirm(t('rec.new_confirm', { n: rec.steps.length }))) return;
      rec.steps = [];
      renderSteps();
    }
    // Always reset platform + samples + editing state on explicit new template
    // — force platform picker to show and prevent accidental overwrite of a
    // previously-edited template.
    rec.platform = null;
    rec.samples = null;
    rec._editingName = null;
    updateEditingBar();
    if (rec.recording) {
      // Stop any active recording first so setRecording(true) re-triggers the picker
      await setRecording(false);
    }
    persistSession();
    // Ensure the mirror popup is open before recording starts
    if (!rec.mirrorOpen) {
      await openMirrorPopup();
    }
    await setRecording(true);
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
      // Live progress in running banner
      const pm = line.match(/\[Step (\d+)\/(\d+)\]\s*(.*)/);
      if (pm && rec._isRunning) {
        const prog = $('#rr-progress');
        if (prog) prog.textContent = `Step ${pm[1]}/${pm[2]}${pm[3] ? ' — ' + pm[3] : ''}`;
      }

      if (line.includes('FATAL:') || line.includes('Engine finished') || line.includes('Engine exited') || line.includes('Spawn failed')) {
        if (rec.runStatus) {
          Object.keys(rec.runStatus).forEach(k => {
            if (rec.runStatus[k] === 'current') {
              rec.runStatus[k] = line.includes('FATAL') ? 'fail' : 'ok';
            }
          });
          renderSteps();
        }
        // Update template health + clear running UI on finish (both success and failure)
        if ((line.includes('Engine finished') || line.includes('Engine exited') || line.includes('Spawn failed')) && rec._currentRunTemplate) {
          const stopped = !!rec._stopRequested;
          const success = !stopped
            && line.includes('Engine finished')
            && !Object.values(rec.runStatus || {}).includes('fail');
          // Only record health for natural runs — user-initiated stops skew the metric
          if (!stopped) {
            invoke('template_record_health', { templateName: rec._currentRunTemplate, success })
              .then(() => logRec(`template health updated: ${rec._currentRunTemplate} (${success ? 'success' : 'fail'})`))
              .catch(e => logRec('health update failed', { err: String(e) }));
          }
          if (stopped) {
            toast.info(t('rec.stopped_by_user'), { title: rec._currentRunTemplate });
          } else if (success) {
            toast.success(t('rec.run_done'), { title: rec._currentRunTemplate });
          } else {
            toast.error(t('rec.run_error'), { title: rec._currentRunTemplate || t('rec.run_fail_title') });
          }
          rec._currentRunTemplate = null;
          rec._stopRequested = false;
          setRunningUI(false);
          renderTemplatesGrid();  // refresh health chip
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
      const step = ev.payload;
      // Paste actions await an ADB round-trip before emitting, so a screenshot
      // click during that window arrives with an earlier ts. Insert by ts so
      // the step list reflects the user's actual action order, not arrival order.
      let idx = rec.steps.length;
      if (step.ts) {
        while (idx > 0 && rec.steps[idx - 1].ts && rec.steps[idx - 1].ts > step.ts) idx--;
      }
      rec.steps.splice(idx, 0, step);
      persistSession();
      renderSteps();
      logRec('step-added', { idx, total: rec.steps.length, action: step.action, coord: step.coord });
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
