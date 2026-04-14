// ── Console Panel (resizable, mockup v4.3) ────────────

import { $ } from '../utils/helpers.js';
import state from '../state.js';

const MIN_HEIGHT = 0;
const DEFAULT_HEIGHT = 150;
const EXPANDED_HEIGHT = 350;
let expanded = false;
let consoleHidden = false;

export function renderConsole() {
  const el = $('#console-output');
  if (!el) return;

  const logs = state.logs;
  if (!logs.length) {
    el.innerHTML = '<div class="console-line"><span class="c-prefix">$</span><span style="color:var(--c-accent)">AUV ready</span></div>';
    updateLineCount(0);
    return;
  }

  const now = new Date();
  el.innerHTML = logs.map((line, i) => {
    const isError = line.includes('[ERROR]');
    const isSystem = line.includes('[SYSTEM]');
    const isMock = line.includes('[MOCK]');
    const isAdb = line.includes('ADB:');

    let prefix, color, tag;
    if (isError)       { prefix = '!'; color = 'var(--c-red)'; tag = 'ERR'; }
    else if (isSystem) { prefix = '$'; color = 'var(--c-accent)'; tag = 'SYS'; }
    else if (isMock)   { prefix = '~'; color = 'var(--c-amber)'; tag = 'DBG'; }
    else if (isAdb)    { prefix = '>';  color = 'var(--c-fg-3)'; tag = 'ADB'; }
    else               { prefix = '>'; color = 'var(--c-green)'; tag = ''; }

    // Clean up the log line — remove [SYSTEM], [ERROR] etc from display
    let clean = escHtml(line)
      .replace(/\[ERROR\]\s*/g, '')
      .replace(/\[SYSTEM\]\s*/g, '')
      .replace(/\[MOCK\]\s*/g, '');

    const tagHtml = tag ? `<span style="color:${color};opacity:.5;font-size:9px;font-weight:700;margin-right:6px">${tag}</span>` : '';

    return `<div class="console-line"><span class="c-prefix" style="color:${color}">${prefix}</span>${tagHtml}<span style="color:${color}">${clean}</span></div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
  updateLineCount(logs.length);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function updateLineCount(n) {
  const el = $('#console-line-count');
  if (el) el.textContent = n > 0 ? `${n} lines` : '';
}

export function appendLog(line) {
  state.logs.push(line);
  renderConsole();
}

export function clearLogs() {
  state.logs = [];
  renderConsole();
}

export function initConsole() {
  const output = $('#console-output');
  const dragHandle = $('#console-drag');
  const toggleBtn = $('#btn-toggle-console');
  const clearBtn = $('#btn-clear-logs');
  const icon = $('#console-expand-icon');

  if (clearBtn) clearBtn.addEventListener('click', clearLogs);

  // Toggle expand/collapse
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      if (consoleHidden) {
        // Show console
        showConsole();
      } else {
        expanded = !expanded;
        if (output) output.style.height = expanded ? EXPANDED_HEIGHT + 'px' : DEFAULT_HEIGHT + 'px';
      }
      updateIcon();
    });
  }

  // Close button (hide completely)
  const closeBtn = $('#btn-hide-console');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      hideConsole();
    });
  }

  // Drag to resize
  if (dragHandle && output) {
    let startY, startH;

    dragHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startH = output.offsetHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';

      const onMove = (e) => {
        const delta = startY - e.clientY;
        const newH = Math.max(MIN_HEIGHT, Math.min(window.innerHeight * 0.7, startH + delta));
        output.style.height = newH + 'px';
        output.style.transition = 'none';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        output.style.transition = 'height .15s';
        expanded = output.offsetHeight > DEFAULT_HEIGHT + 50;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

function hideConsole() {
  const panel = $('#console-panel');
  if (panel) panel.style.display = 'none';
  consoleHidden = true;
}

function showConsole() {
  const panel = $('#console-panel');
  const output = $('#console-output');
  if (panel) panel.style.display = 'flex';
  if (output) output.style.height = DEFAULT_HEIGHT + 'px';
  consoleHidden = false;
  expanded = false;
}

function updateIcon() {
  const icon = $('#console-expand-icon');
  if (!icon) return;
  icon.innerHTML = expanded
    ? '<path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.5 3.5m11 5.5V4.5m0 4.5h4.5m-4.5 0l5.5-5.5M9 15v4.5M9 15H4.5M9 15l-5.5 5.5m11-5.5v4.5m0-4.5h4.5m-4.5 0l5.5 5.5"/>'
    : '<path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>';
}

export function toggleConsole() {
  if (consoleHidden) showConsole();
  else hideConsole();
}

export function isConsoleHidden() {
  return consoleHidden;
}
