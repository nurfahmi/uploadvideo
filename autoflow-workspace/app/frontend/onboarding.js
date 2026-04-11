// ── Onboarding Wizard (v4.3 design) ───────────────────
// 6-step guided setup for first-time users

const onboarding = {
  step: 1,
  data: { platforms: [], deviceId: null, deviceModel: null },
  onComplete: null,
  _unlisten: null,

  async init(onComplete) {
    this.onComplete = onComplete;
    this.step = 1;
    this.data = { platforms: [], deviceId: null, deviceModel: null };
    this._injectOverlay();
    this.render();
  },

  _injectOverlay() {
    if (document.getElementById('onboarding-overlay')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="onboarding-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:200;background:rgba(1,4,9,.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px">
        <div id="onboarding-wizard" style="background:#0d1117;border:1px solid #21262d;border-radius:12px;width:100%;max-width:480px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.4)">
          <div id="onboarding-header" style="padding:20px 24px 12px"></div>
          <div id="onboarding-content" style="padding:0 24px 16px"></div>
          <div id="onboarding-footer" style="padding:12px 24px 20px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #21262d"></div>
        </div>
      </div>
    `);
  },

  destroy() {
    const el = document.getElementById('onboarding-overlay');
    if (el) el.remove();
    if (this._unlisten) { this._unlisten(); this._unlisten = null; }
    if (this.onComplete) this.onComplete();
  },

  async skip() {
    const { invoke } = window.__TAURI__.core;
    await invoke('save_config', { config: { onboarding_completed: true, selected_platforms: [] } });
    this.destroy();
  },

  async complete() {
    const { invoke } = window.__TAURI__.core;
    await invoke('save_config', { config: { onboarding_completed: true, selected_platforms: this.data.platforms } });
    this.destroy();
  },

  goTo(step) { this.step = step; this.render(); },
  next() { if (this.step === '2b') { this.goTo(3); return; } if (this.step >= 5) { this.complete(); return; } this.goTo(this.step + 1); },
  back() { if (this.step === '2b') { this.goTo(2); return; } if (this.step > 1) this.goTo(this.step - 1); },

  render() {
    const steps = { 1: 1, 2: 2, '2b': 2, 3: 3, 4: 4, 5: 5 };
    const current = steps[this.step] || 1;
    const total = 5;
    const labels = ['Welcome', 'Connect', 'Platform', 'Upload', 'Done'];

    document.getElementById('onboarding-header').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-bottom:6px">
        ${Array.from({ length: total }, (_, i) => {
          const n = i + 1;
          const active = n === current;
          const done = n < current;
          return `<div style="height:3px;border-radius:2px;transition:all .2s;${active ? 'width:32px;background:#58a6ff' : done ? 'width:20px;background:rgba(88,166,255,.3)' : 'width:20px;background:#21262d'}"></div>`;
        }).join('')}
      </div>
      <p style="text-align:center;font-size:10px;color:#484f58;font-weight:500">${labels[current - 1]} — Step ${current} of ${total}</p>
    `;

    const renderMap = { 1: () => this.renderWelcome(), 2: () => this.renderConnectDevice(), '2b': () => this.renderUSBGuide(), 3: () => this.renderPlatform(), 4: () => this.renderFirstUpload(), 5: () => this.renderComplete() };
    (renderMap[this.step] || renderMap[1])();
  },

  renderWelcome() {
    document.getElementById('onboarding-content').innerHTML = `
      <div style="text-align:center;padding:24px 0">
        <div style="width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg,#58a6ff,#bc8cff);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
          <svg width="28" height="28" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </div>
        <h2 style="font-size:18px;font-weight:700;color:#f0f6fc;margin-bottom:6px">Welcome to AUV</h2>
        <p style="font-size:12px;color:#8b949e;line-height:1.5;max-width:340px;margin:0 auto">
          Automatically upload videos to TikTok, Shopee & more platforms. Let's get set up in a few simple steps.
        </p>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.skip()" style="background:none;border:none;color:#484f58;font-size:11px;cursor:pointer;font-family:inherit;font-weight:500;transition:color .1s" onmouseover="this.style.color='#c9d1d9'" onmouseout="this.style.color='#484f58'">Skip setup</button>
      <button onclick="onboarding.next()" class="btn btn-primary" style="padding:6px 20px">Start Setup</button>
    `;
  },

  renderConnectDevice() {
    const hasDevice = !!this.data.deviceId;
    document.getElementById('onboarding-content').innerHTML = `
      <div style="text-align:center;padding:16px 0">
        <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:20px">
          <div style="width:48px;height:72px;border-radius:8px;border:2px solid #30363d;display:flex;align-items:center;justify-content:center">
            <svg width="24" height="24" fill="none" stroke="#8b949e" stroke-width="1.3" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/></svg>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <div style="width:24px;height:2px;background:#30363d"></div>
            <svg width="12" height="12" fill="none" stroke="#484f58" stroke-width="2" viewBox="0 0 24 24"><path d="M13 7l5 5-5 5"/></svg>
            <div style="width:24px;height:2px;background:#30363d"></div>
          </div>
          <div style="width:64px;height:48px;border-radius:8px;border:2px solid #30363d;display:flex;align-items:center;justify-content:center">
            <svg width="24" height="24" fill="none" stroke="#8b949e" stroke-width="1.3" viewBox="0 0 24 24"><path d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z"/></svg>
          </div>
        </div>
        <h2 style="font-size:15px;font-weight:700;color:#f0f6fc;margin-bottom:4px">Connect Android Phone</h2>
        <p style="font-size:11px;color:#484f58;margin-bottom:16px">Plug in your phone via USB cable</p>
        ${hasDevice ? `
          <div style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.2);border-radius:6px">
            <svg width="14" height="14" fill="none" stroke="#3fb950" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span style="font-size:12px;color:#3fb950;font-weight:600">${this._esc(this.data.deviceModel)}</span>
          </div>
        ` : `
          <button id="ob-scan-btn" onclick="onboarding._scanDevice()" class="btn" style="padding:6px 18px">
            <span style="display:flex;align-items:center;gap:6px">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              Scan Device
            </span>
          </button>
          <div id="ob-scan-result" style="margin-top:10px;font-size:11px;color:#484f58"></div>
        `}
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.back()" style="background:none;border:none;color:#484f58;font-size:11px;cursor:pointer;font-family:inherit" onmouseover="this.style.color='#c9d1d9'" onmouseout="this.style.color='#484f58'">Back</button>
      <button onclick="onboarding.next()" class="btn btn-primary" style="padding:6px 20px" ${hasDevice ? '' : 'disabled style="padding:6px 20px;opacity:.3;cursor:not-allowed"'}>Next</button>
    `;
  },

  async _scanDevice() {
    const btn = document.getElementById('ob-scan-btn');
    const result = document.getElementById('ob-scan-result');
    if (btn) btn.innerHTML = '<span style="display:flex;align-items:center;gap:6px"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke="#484f58" stroke-width="3" fill="none" stroke-dasharray="60 30"/></svg> Scanning...</span>';
    try {
      const { invoke } = window.__TAURI__.core;
      const devices = await invoke('list_devices');
      if (devices.length > 0) {
        this.data.deviceId = devices[0][0];
        // Get brand name via health check
        try {
          const health = await invoke('check_device_health', { deviceId: devices[0][0] });
          this.data.deviceModel = health.brand ? health.brand.charAt(0).toUpperCase() + health.brand.slice(1).toLowerCase() + (health.model ? ' ' + health.model : '') : devices[0][1];
        } catch (e) {
          this.data.deviceModel = devices[0][1];
        }
        this.render();
      } else {
        if (result) result.innerHTML = '<span style="color:#d29922">Phone not found.</span> <button onclick="onboarding.goTo(\'2b\')" style="color:#58a6ff;background:none;border:none;cursor:pointer;font-family:inherit;font-size:11px;text-decoration:underline">View USB Debugging guide</button>';
        if (btn) btn.innerHTML = '<span style="display:flex;align-items:center;gap:6px"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg> Scan Again</span>';
      }
    } catch (err) {
      if (result) result.innerHTML = `<span style="color:#f85149">Error: ${this._esc(String(err))}</span>`;
      if (btn) btn.innerHTML = 'Scan Device';
    }
  },

  renderUSBGuide() {
    const brands = [
      { name: 'Samsung', color: '#1a73e8', note: 'Tap Build Number 7 times. Also enable "USB Configuration".' },
      { name: 'Xiaomi / Redmi', color: '#ff6700', note: 'Tap MIUI Version 7 times. Enable "Install via USB".' },
      { name: 'Oppo / Realme', color: '#1ba158', note: 'Tap Build Number 7 times. Path may differ on ColorOS.' },
      { name: 'Vivo', color: '#415fff', note: 'Tap Software Version 7 times. Funtouch OS variant.' },
    ];
    document.getElementById('onboarding-content').innerHTML = `
      <div style="padding:4px 0">
        <h2 style="font-size:15px;font-weight:700;color:#f0f6fc;margin-bottom:4px;text-align:center">Enable USB Debugging</h2>
        <p style="font-size:11px;color:#484f58;margin-bottom:12px;text-align:center">Select your phone brand</p>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
          ${brands.map(b => `
            <details style="background:#161b22;border:1px solid #21262d;border-radius:6px;overflow:hidden">
              <summary style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;color:#c9d1d9;list-style:none">
                <div style="width:8px;height:8px;border-radius:2px;background:${b.color};flex-shrink:0"></div>
                ${b.name}
                <svg width="10" height="10" fill="none" stroke="#484f58" stroke-width="2" viewBox="0 0 24 24" style="margin-left:auto"><path d="M19 9l-7 7-7-7"/></svg>
              </summary>
              <div style="padding:4px 12px 10px 28px;font-size:10px;color:#8b949e;line-height:1.7">
                <p>1. Open <span style="color:#58a6ff">Settings > About Phone</span></p>
                <p>2. ${b.note}</p>
                <p>3. Go back to <span style="color:#58a6ff">Developer Options</span></p>
                <p>4. Enable <span style="color:#58a6ff">USB Debugging</span></p>
                <p>5. Connect USB, select <span style="color:#58a6ff">File Transfer</span></p>
                <p>6. Tap <span style="color:#58a6ff">Allow</span> on the popup</p>
              </div>
            </details>
          `).join('')}
        </div>
        <div style="padding:8px 10px;background:#161b22;border:1px solid #21262d;border-radius:6px;font-size:10px;color:#484f58;line-height:1.7">
          <p style="color:#8b949e;font-weight:600;margin-bottom:2px">Troubleshooting:</p>
          <p>- USB Debugging enabled? - Tapped Allow? - File Transfer mode?</p>
          <p>- Data cable (not charging-only)? - Try replug or restart phone</p>
        </div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.goTo(2)" style="background:none;border:none;color:#484f58;font-size:11px;cursor:pointer;font-family:inherit" onmouseover="this.style.color='#c9d1d9'" onmouseout="this.style.color='#484f58'">Back</button>
      <button onclick="onboarding._scanFromGuide()" class="btn btn-primary" style="padding:6px 20px">Try Scan Again</button>
    `;
  },

  async _scanFromGuide() {
    try {
      const { invoke } = window.__TAURI__.core;
      const devices = await invoke('list_devices');
      if (devices.length > 0) {
        this.data.deviceId = devices[0][0];
        try {
          const health = await invoke('check_device_health', { deviceId: devices[0][0] });
          this.data.deviceModel = health.brand ? health.brand.charAt(0).toUpperCase() + health.brand.slice(1).toLowerCase() + (health.model ? ' ' + health.model : '') : devices[0][1];
        } catch (e) { this.data.deviceModel = devices[0][1]; }
        this.goTo(3);
      }
      else {
        const footer = document.getElementById('onboarding-footer');
        if (!document.getElementById('ob-guide-msg')) {
          footer.insertAdjacentHTML('beforeend', '<span id="ob-guide-msg" style="font-size:10px;color:#d29922;position:absolute;left:50%;transform:translateX(-50%)">Phone still not detected</span>');
          setTimeout(() => { const m = document.getElementById('ob-guide-msg'); if (m) m.remove(); }, 3000);
        }
      }
    } catch (err) { console.error('Scan failed:', err); }
  },

  renderPlatform() {
    const platforms = [
      { id: 'tiktok_upload', name: 'TikTok', desc: 'Videos with captions & hashtags', color: '#ff0050', icon: '<path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.18 8.18 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z"/>' },
      { id: 'shopee_upload', name: 'Shopee Video', desc: 'Product videos with links', color: '#EE4D2D', icon: '<path d="M12 2C9.24 2 7 4.24 7 7h2c0-1.66 1.34-3 3-3s3 1.34 3 3h2c0-2.76-2.24-5-5-5zm-7 7c-.55 0-1 .45-1 1v1l1.53 8.55C5.7 20.38 6.4 21 7.23 21h9.54c.83 0 1.53-.62 1.7-1.45L20 11v-1c0-.55-.45-1-1-1H5zm7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>' },
    ];
    document.getElementById('onboarding-content').innerHTML = `
      <div style="text-align:center;padding:16px 0">
        <h2 style="font-size:15px;font-weight:700;color:#f0f6fc;margin-bottom:4px">Choose Platform</h2>
        <p style="font-size:11px;color:#484f58;margin-bottom:16px">Select one or both</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${platforms.map(p => {
            const sel = this.data.platforms.includes(p.id);
            return `
              <button onclick="onboarding._togglePlatform('${p.id}')" style="padding:16px;border-radius:8px;border:1.5px solid ${sel ? p.color + '80' : '#21262d'};background:${sel ? p.color + '10' : '#161b22'};cursor:pointer;text-align:left;font-family:inherit;transition:all .15s" onmouseover="if(!${sel})this.style.borderColor='#30363d'" onmouseout="if(!${sel})this.style.borderColor='#21262d'">
                <div style="width:32px;height:32px;border-radius:8px;background:${p.color}15;border:1px solid ${p.color}30;display:flex;align-items:center;justify-content:center;margin-bottom:10px;color:${p.color}">
                  <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">${p.icon}</svg>
                </div>
                <p style="font-size:13px;font-weight:600;color:${sel ? '#f0f6fc' : '#c9d1d9'};margin-bottom:2px">${p.name}</p>
                <p style="font-size:10px;color:#484f58">${p.desc}</p>
              </button>`;
          }).join('')}
        </div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.back()" style="background:none;border:none;color:#484f58;font-size:11px;cursor:pointer;font-family:inherit" onmouseover="this.style.color='#c9d1d9'" onmouseout="this.style.color='#484f58'">Back</button>
      <button onclick="onboarding.next()" class="btn btn-primary" style="padding:6px 20px" ${this.data.platforms.length ? '' : 'disabled style="padding:6px 20px;opacity:.3;cursor:not-allowed"'}>Next</button>
    `;
  },

  _togglePlatform(id) {
    const idx = this.data.platforms.indexOf(id);
    if (idx >= 0) this.data.platforms.splice(idx, 1);
    else this.data.platforms.push(id);
    this.render();
  },

  renderFirstUpload() {
    document.getElementById('onboarding-content').innerHTML = `
      <div style="padding:4px 0">
        <h2 style="font-size:15px;font-weight:700;color:#f0f6fc;margin-bottom:4px;text-align:center">First Video Upload</h2>
        <p style="font-size:11px;color:#484f58;margin-bottom:12px;text-align:center">Try uploading one video to verify everything works</p>
        <div id="ob-upload-form"></div>
        <div id="ob-upload-console" style="display:none;margin-top:10px;background:#161b22;border:1px solid #21262d;border-radius:6px;padding:8px 10px;max-height:100px;overflow:auto;font-family:'IBM Plex Mono',monospace;font-size:10px"></div>
        <div id="ob-upload-success" style="display:none;text-align:center;padding:16px 0"></div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.back()" style="background:none;border:none;color:#484f58;font-size:11px;cursor:pointer;font-family:inherit" onmouseover="this.style.color='#c9d1d9'" onmouseout="this.style.color='#484f58'">Back</button>
      <div style="display:flex;gap:8px">
        <button onclick="onboarding.next()" style="background:none;border:none;color:#484f58;font-size:11px;cursor:pointer;font-family:inherit" onmouseover="this.style.color='#c9d1d9'" onmouseout="this.style.color='#484f58'">Skip</button>
        <button id="ob-upload-btn" onclick="onboarding._startUpload()" class="btn btn-primary" style="padding:6px 20px">Upload Now</button>
      </div>
    `;
    this._loadUploadForm();
  },

  async _loadUploadForm() {
    const { invoke } = window.__TAURI__.core;
    const platformId = this.data.platforms[0] || 'tiktok_upload';
    try {
      const flow = await invoke('get_flow_details', { flowName: platformId });
      const fields = flow.batch_fields || [];
      document.getElementById('ob-upload-form').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${fields.map(f => `
            <div>
              <label style="font-size:9px;color:#484f58;font-weight:600;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:3px">${f.label}${f.required ? '<span style="color:#f85149"> *</span>' : ''}</label>
              <input type="text" id="ob-field-${f.key}" placeholder="${f.placeholder || ''}" class="inp" style="width:100%;padding:6px 10px">
            </div>
          `).join('')}
        </div>
      `;
      this._uploadFlow = flow;
      this._uploadPlatform = platformId;
    } catch (err) {
      document.getElementById('ob-upload-form').innerHTML = `<p style="font-size:11px;color:#f85149">Error loading flow: ${this._esc(String(err))}</p>`;
    }
  },

  async _startUpload() {
    if (!this._uploadFlow || !this.data.deviceId) {
      if (!this.data.deviceId) {
        const c = document.getElementById('ob-upload-console');
        c.style.display = 'block';
        c.innerHTML = '<p style="color:#d29922">No device connected. Skip this step or go back.</p>';
      }
      return;
    }
    const fields = this._uploadFlow.batch_fields || [];
    const item = {};
    for (const f of fields) { const el = document.getElementById(`ob-field-${f.key}`); item[f.key] = el ? el.value : ''; }
    const missing = fields.filter(f => f.required && !item[f.key]?.trim());
    if (missing.length) {
      const c = document.getElementById('ob-upload-console');
      c.style.display = 'block';
      c.innerHTML = `<p style="color:#d29922">Fill in: ${missing.map(f => f.label).join(', ')}</p>`;
      return;
    }
    const btn = document.getElementById('ob-upload-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }
    const consoleEl = document.getElementById('ob-upload-console');
    consoleEl.style.display = 'block';
    consoleEl.innerHTML = '';
    const { listen } = window.__TAURI__.event;
    const { invoke } = window.__TAURI__.core;
    this._unlisten = await listen('engine-log', (e) => {
      const line = e.payload;
      let c = '#3fb950';
      if (line.includes('[ERROR]')) c = '#f85149';
      else if (line.includes('[SYSTEM]')) c = '#58a6ff';
      else if (line.includes('ADB:')) c = '#30363d';
      consoleEl.innerHTML += `<div style="color:${c}">${this._esc(line)}</div>`;
      consoleEl.scrollTop = consoleEl.scrollHeight;
      if (line.includes('finished successfully') || line.includes('Batch complete')) this._onUploadSuccess();
      else if (line.includes('exited with code') || line.includes('Spawn failed')) this._onUploadError();
    });
    try {
      await invoke('start_automation', { deviceIds: [this.data.deviceId], flowName: this._uploadPlatform, vars: JSON.stringify({ items: [item] }) });
    } catch (err) {
      consoleEl.innerHTML += `<div style="color:#f85149">Error: ${this._esc(String(err))}</div>`;
      this._onUploadError();
    }
  },

  _onUploadSuccess() {
    if (this._unlisten) { this._unlisten(); this._unlisten = null; }
    const el = document.getElementById('ob-upload-success');
    el.style.display = 'block';
    el.innerHTML = `
      <svg width="40" height="40" fill="none" stroke="#3fb950" stroke-width="2" viewBox="0 0 24 24" style="margin:0 auto 8px;display:block"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <p style="font-size:13px;font-weight:600;color:#3fb950">Upload successful!</p>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <div></div>
      <button onclick="onboarding.next()" class="btn btn-primary" style="padding:6px 20px">Next</button>
    `;
  },

  _onUploadError() {
    if (this._unlisten) { this._unlisten(); this._unlisten = null; }
    const btn = document.getElementById('ob-upload-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Try Again'; }
  },

  renderComplete() {
    document.getElementById('onboarding-content').innerHTML = `
      <div style="text-align:center;padding:24px 0">
        <div style="width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg,#3fb950,#39d2c0);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
          <svg width="28" height="28" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        </div>
        <h2 style="font-size:18px;font-weight:700;color:#f0f6fc;margin-bottom:6px">Setup Complete!</h2>
        <p style="font-size:12px;color:#8b949e;margin-bottom:20px">You're ready to start uploading videos</p>
        <div style="text-align:left;background:#161b22;border:1px solid #21262d;border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:10px;font-size:11px">
            <svg width="16" height="16" fill="none" stroke="#58a6ff" stroke-width="1.5" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/></svg>
            <span style="color:#c9d1d9"><span style="color:#f0f6fc;font-weight:600">Devices</span> — connect & manage your phones</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;font-size:11px">
            <svg width="16" height="16" fill="none" stroke="#58a6ff" stroke-width="1.5" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
            <span style="color:#c9d1d9"><span style="color:#f0f6fc;font-weight:600">Upload Queue</span> — add videos or import CSV</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;font-size:11px">
            <svg width="16" height="16" fill="none" stroke="#58a6ff" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 3h6l2 2v4l-2 2H9L7 9V5l2-2z"/></svg>
            <span style="color:#c9d1d9"><span style="color:#f0f6fc;font-weight:600">Flow Action</span> — customize automation steps</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;font-size:11px">
            <svg width="16" height="16" fill="none" stroke="#3fb950" stroke-width="2" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <span style="color:#c9d1d9">Click <span style="color:#3fb950;font-weight:600">Run Flow</span> to begin uploading</span>
          </div>
        </div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <div></div>
      <button onclick="onboarding.complete()" class="btn btn-primary" style="padding:6px 20px">Go to Dashboard</button>
    `;
  },

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
};
