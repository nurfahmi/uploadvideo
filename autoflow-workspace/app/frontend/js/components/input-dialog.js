// ── Text Input Dialog ──────────────────────────────────
// A replacement for window.prompt() which is unreliable in Tauri webviews.
// Returns Promise<string|null> (null = cancelled).

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function showInputDialog({
  title,
  message = '',
  defaultValue = '',
  placeholder = '',
  okLabel = 'Simpan',
  cancelLabel = 'Batal',
} = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
    overlay.innerHTML = `
      <div class="ui-card" style="width:380px;max-width:92vw;padding:var(--sp-4)">
        <h3 class="t-lg t-strong" style="margin:0 0 ${message ? 'var(--sp-2)' : 'var(--sp-3)'}">${esc(title)}</h3>
        ${message ? `<p class="t-xs t-muted" style="margin:0 0 var(--sp-3)">${esc(message)}</p>` : ''}
        <input id="dlg-input" type="text" class="inp" style="width:100%;box-sizing:border-box;margin-bottom:var(--sp-3)" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" />
        <div style="display:flex;gap:var(--sp-2);justify-content:flex-end">
          <button id="dlg-cancel" class="btn btn-ghost btn-sm">${esc(cancelLabel)}</button>
          <button id="dlg-ok" class="btn btn-primary btn-sm">${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const inp = overlay.querySelector('#dlg-input');
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('#dlg-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('#dlg-ok').addEventListener('click', () => close(inp.value));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(inp.value);
      if (e.key === 'Escape') close(null);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  });
}
