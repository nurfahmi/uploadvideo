// ── Toast Notifications ────────────────────────────────
// Lightweight, stacked, auto-dismissing. Supports optional action (e.g. Undo).

let container = null;
let counter = 0;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'auv-toast-container';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
    max-width: 400px;
  `;
  document.body.appendChild(container);
  return container;
}

const TYPE_CONFIG = {
  success: {
    bg: 'var(--c-green-a12)',
    border: 'var(--c-green-a20, rgba(76,199,100,.20))',
    color: 'var(--c-green)',
    icon: '<path d="M20 6L9 17l-5-5"/>',
    defaultDuration: 4000,
  },
  error: {
    bg: 'var(--c-red-a15)',
    border: 'var(--c-red-a20)',
    color: 'var(--c-red)',
    icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    defaultDuration: 10000,
  },
  warn: {
    bg: 'var(--c-amber-a12)',
    border: 'var(--c-amber-a20)',
    color: 'var(--c-amber)',
    icon: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    defaultDuration: 6000,
  },
  info: {
    bg: 'var(--c-accent-a12)',
    border: 'var(--c-accent-a20)',
    color: 'var(--c-accent)',
    icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    defaultDuration: 4000,
  },
};

export function showToast(type, message, options = {}) {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.info;
  const duration = options.duration ?? cfg.defaultDuration;
  const id = ++counter;
  const el = document.createElement('div');
  el.dataset.toastId = id;
  el.style.cssText = `
    background: var(--c-bg-card);
    border: 1px solid ${cfg.border};
    border-left: 3px solid ${cfg.color};
    border-radius: var(--r-md);
    padding: var(--sp-3) var(--sp-4);
    display: flex;
    align-items: flex-start;
    gap: var(--sp-3);
    box-shadow: var(--elev-2);
    pointer-events: auto;
    font-size: var(--fs-sm);
    color: var(--c-fg-1);
    min-width: 260px;
    max-width: 400px;
    transform: translateX(400px);
    opacity: 0;
    transition: transform .22s ease-out, opacity .18s ease-out;
  `;

  const actionBtn = options.action
    ? `<button class="btn btn-ghost btn-sm" data-toast-action style="color:${cfg.color}">${options.action.label}</button>`
    : '';

  el.innerHTML = `
    <svg width="16" height="16" fill="none" stroke="${cfg.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="flex-shrink:0;margin-top:1px">${cfg.icon}</svg>
    <div style="flex:1;min-width:0">
      ${options.title ? `<div class="t-strong" style="color:${cfg.color};margin-bottom:2px">${escapeHtml(options.title)}</div>` : ''}
      <div style="line-height:1.4;word-break:break-word">${escapeHtml(message)}</div>
      ${actionBtn}
    </div>
    <button data-toast-close title="Tutup" style="background:none;border:none;color:var(--c-fg-3);cursor:pointer;padding:0;line-height:0;flex-shrink:0">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  ensureContainer().appendChild(el);

  // animate in
  requestAnimationFrame(() => {
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
  });

  const dismiss = () => {
    el.style.transform = 'translateX(400px)';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  };

  el.querySelector('[data-toast-close]').addEventListener('click', dismiss);
  const actionEl = el.querySelector('[data-toast-action]');
  if (actionEl && options.action?.onClick) {
    actionEl.addEventListener('click', () => {
      try { options.action.onClick(); } finally { dismiss(); }
    });
  }

  let timer = duration > 0 ? setTimeout(dismiss, duration) : null;
  el.addEventListener('mouseenter', () => { if (timer) { clearTimeout(timer); timer = null; } });
  el.addEventListener('mouseleave', () => { if (!timer && duration > 0) timer = setTimeout(dismiss, 2000); });

  return { id, dismiss };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const toast = {
  success: (msg, opts) => showToast('success', msg, opts),
  error: (msg, opts) => showToast('error', msg, opts),
  warn: (msg, opts) => showToast('warn', msg, opts),
  info: (msg, opts) => showToast('info', msg, opts),
};
