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
      <div id="onboarding-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:200;background:var(--c-overlay-heavy);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px">
        <div id="onboarding-wizard" style="background:var(--c-bg-0);border:1px solid var(--c-bg-2);border-radius:12px;width:100%;max-width:480px;overflow:hidden;box-shadow:0 16px 48px var(--c-shadow)">
          <div id="onboarding-header" style="padding:20px 24px 12px"></div>
          <div id="onboarding-content" style="padding:0 24px 16px"></div>
          <div id="onboarding-footer" style="padding:12px 24px 20px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--c-bg-2)"></div>
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
    const labels = ['Selamat Datang', 'Hubungkan', 'Platform', 'Upload', 'Selesai'];

    document.getElementById('onboarding-header').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-bottom:6px">
        ${Array.from({ length: total }, (_, i) => {
          const n = i + 1;
          const active = n === current;
          const done = n < current;
          return `<div style="height:3px;border-radius:2px;transition:all .2s;${active ? 'width:32px;background:var(--c-accent)' : done ? 'width:20px;background:var(--c-accent-a30)' : 'width:20px;background:var(--c-bg-2)'}"></div>`;
        }).join('')}
      </div>
      <p style="text-align:center;font-size:10px;color:var(--c-fg-3);font-weight:500">${labels[current - 1]} — Langkah ${current} dari ${total}</p>
    `;

    const renderMap = { 1: () => this.renderWelcome(), 2: () => this.renderConnectDevice(), '2b': () => this.renderUSBGuide(), 3: () => this.renderPlatform(), 4: () => this.renderFirstUpload(), 5: () => this.renderComplete() };
    (renderMap[this.step] || renderMap[1])();
  },

  renderWelcome() {
    document.getElementById('onboarding-content').innerHTML = `
      <div style="text-align:center;padding:24px 0">
        <div style="width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg,var(--c-accent),var(--c-purple));display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
          <svg width="28" height="28" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </div>
        <h2 style="font-size:18px;font-weight:700;color:var(--c-fg-0);margin-bottom:6px">Selamat datang di AUV</h2>
        <p style="font-size:12px;color:var(--c-fg-2);line-height:1.5;max-width:340px;margin:0 auto">
          Upload video otomatis ke TikTok, Shopee, dan platform lainnya. Yuk siapin aplikasinya dalam beberapa langkah.
        </p>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.skip()" style="background:none;border:none;color:var(--c-fg-3);font-size:11px;cursor:pointer;font-family:inherit;font-weight:500;transition:color .1s" onmouseover="this.style.color='var(--c-fg-1)'" onmouseout="this.style.color='var(--c-fg-3)'">Lewati</button>
      <button onclick="onboarding.next()" class="btn btn-primary" style="padding:6px 20px">Mulai Setup</button>
    `;
  },

  renderConnectDevice() {
    const hasDevice = !!this.data.deviceId;
    document.getElementById('onboarding-content').innerHTML = `
      <div style="text-align:center;padding:16px 0">
        <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:20px">
          <div style="width:48px;height:72px;border-radius:8px;border:2px solid var(--c-bg-3);display:flex;align-items:center;justify-content:center">
            <svg width="24" height="24" fill="none" stroke="var(--c-fg-2)" stroke-width="1.3" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/></svg>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <div style="width:24px;height:2px;background:var(--c-bg-3)"></div>
            <svg width="12" height="12" fill="none" stroke="var(--c-fg-3)" stroke-width="2" viewBox="0 0 24 24"><path d="M13 7l5 5-5 5"/></svg>
            <div style="width:24px;height:2px;background:var(--c-bg-3)"></div>
          </div>
          <div style="width:64px;height:48px;border-radius:8px;border:2px solid var(--c-bg-3);display:flex;align-items:center;justify-content:center">
            <svg width="24" height="24" fill="none" stroke="var(--c-fg-2)" stroke-width="1.3" viewBox="0 0 24 24"><path d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z"/></svg>
          </div>
        </div>
        <h2 style="font-size:15px;font-weight:700;color:var(--c-fg-0);margin-bottom:4px">Hubungkan HP Android</h2>
        <p style="font-size:11px;color:var(--c-fg-3);margin-bottom:16px">Colok HP pakai kabel USB</p>
        ${hasDevice ? `
          <div style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--c-green-a08);border:1px solid var(--c-green-a15);border-radius:6px">
            <svg width="14" height="14" fill="none" stroke="var(--c-green)" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span style="font-size:12px;color:var(--c-green);font-weight:600">${this._esc(this.data.deviceModel)}</span>
          </div>
        ` : `
          <button id="ob-scan-btn" onclick="onboarding._scanDevice()" class="btn" style="padding:6px 18px">
            <span style="display:flex;align-items:center;gap:6px">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              Pindai HP
            </span>
          </button>
          <div id="ob-scan-result" style="margin-top:10px;font-size:11px;color:var(--c-fg-3)"></div>
        `}
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.back()" style="background:none;border:none;color:var(--c-fg-3);font-size:11px;cursor:pointer;font-family:inherit" onmouseover="this.style.color='var(--c-fg-1)'" onmouseout="this.style.color='var(--c-fg-3)'">Kembali</button>
      <button onclick="onboarding.next()" class="btn btn-primary" style="padding:6px 20px" ${hasDevice ? '' : 'disabled style="padding:6px 20px;opacity:.3;cursor:not-allowed"'}>Next</button>
    `;
  },

  async _scanDevice() {
    const btn = document.getElementById('ob-scan-btn');
    const result = document.getElementById('ob-scan-result');
    if (btn) btn.innerHTML = '<span style="display:flex;align-items:center;gap:6px"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke="var(--c-fg-3)" stroke-width="3" fill="none" stroke-dasharray="60 30"/></svg> Memindai...</span>';
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
        if (result) result.innerHTML = '<span style="color:var(--c-amber)">HP tidak ditemukan.</span> <button onclick="onboarding.goTo(\'2b\')" style="color:var(--c-accent);background:none;border:none;cursor:pointer;font-family:inherit;font-size:11px;text-decoration:underline">Lihat panduan USB Debugging</button>';
        if (btn) btn.innerHTML = '<span style="display:flex;align-items:center;gap:6px"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg> Pindai Lagi</span>';
      }
    } catch (err) {
      if (result) result.innerHTML = `<span style="color:var(--c-red)">Error: ${this._esc(String(err))}</span>`;
      if (btn) btn.innerHTML = 'Pindai HP';
    }
  },

  renderUSBGuide() {
    const brands = [
      { name: 'Samsung', color: '#1a73e8', note: 'Tap Build Number 7 kali. Aktifkan juga "USB Configuration".' },
      { name: 'Xiaomi / Redmi', color: '#ff6700', note: 'Tap MIUI Version 7 kali. Aktifkan "Install via USB".' },
      { name: 'Oppo / Realme', color: '#1ba158', note: 'Tap Build Number 7 kali. Path bisa beda di ColorOS.' },
      { name: 'Vivo', color: '#415fff', note: 'Tap Software Version 7 kali. Varian Funtouch OS.' },
    ];
    document.getElementById('onboarding-content').innerHTML = `
      <div style="padding:4px 0">
        <h2 style="font-size:15px;font-weight:700;color:var(--c-fg-0);margin-bottom:4px;text-align:center">Aktifkan USB Debugging</h2>
        <p style="font-size:11px;color:var(--c-fg-3);margin-bottom:12px;text-align:center">Pilih merk HP-mu</p>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
          ${brands.map(b => `
            <details style="background:var(--c-bg-1);border:1px solid var(--c-bg-2);border-radius:6px;overflow:hidden">
              <summary style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;color:var(--c-fg-1);list-style:none">
                <div style="width:8px;height:8px;border-radius:2px;background:${b.color};flex-shrink:0"></div>
                ${b.name}
                <svg width="10" height="10" fill="none" stroke="var(--c-fg-3)" stroke-width="2" viewBox="0 0 24 24" style="margin-left:auto"><path d="M19 9l-7 7-7-7"/></svg>
              </summary>
              <div style="padding:4px 12px 10px 28px;font-size:10px;color:var(--c-fg-2);line-height:1.7">
                <p>1. Buka <span style="color:var(--c-accent)">Pengaturan > Tentang HP</span></p>
                <p>2. ${b.note}</p>
                <p>3. Balik ke <span style="color:var(--c-accent)">Opsi Pengembang</span></p>
                <p>4. Aktifkan <span style="color:var(--c-accent)">USB Debugging</span></p>
                <p>5. Colok USB, pilih <span style="color:var(--c-accent)">Transfer File</span></p>
                <p>6. Tap <span style="color:var(--c-accent)">Izinkan</span> di popup</p>
              </div>
            </details>
          `).join('')}
        </div>
        <div style="padding:8px 10px;background:var(--c-bg-1);border:1px solid var(--c-bg-2);border-radius:6px;font-size:10px;color:var(--c-fg-3);line-height:1.7">
          <p style="color:var(--c-fg-2);font-weight:600;margin-bottom:2px">Troubleshooting:</p>
          <p>- USB Debugging sudah aktif? - Sudah tap Izinkan? - Mode Transfer File?</p>
          <p>- Kabel data (bukan cuma charging)? - Coba cabut-colok atau restart HP</p>
        </div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.goTo(2)" style="background:none;border:none;color:var(--c-fg-3);font-size:11px;cursor:pointer;font-family:inherit" onmouseover="this.style.color='var(--c-fg-1)'" onmouseout="this.style.color='var(--c-fg-3)'">Kembali</button>
      <button onclick="onboarding._scanFromGuide()" class="btn btn-primary" style="padding:6px 20px">Pindai Lagi</button>
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
          footer.insertAdjacentHTML('beforeend', '<span id="ob-guide-msg" style="font-size:10px;color:var(--c-amber);position:absolute;left:50%;transform:translateX(-50%)">HP masih belum terdeteksi</span>');
          setTimeout(() => { const m = document.getElementById('ob-guide-msg'); if (m) m.remove(); }, 3000);
        }
      }
    } catch (err) { console.error('Scan failed:', err); }
  },

  renderPlatform() {
    const platforms = [
      { id: 'tiktok_upload', name: 'TikTok', desc: 'Video dengan caption & hashtag', color: '#ff0050', icon: '<path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.18 8.18 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z"/>' },
      { id: 'shopee_upload', name: 'Shopee Video', desc: 'Video produk dengan link', color: '#EE4D2D', icon: '<path d="M12 2C9.24 2 7 4.24 7 7h2c0-1.66 1.34-3 3-3s3 1.34 3 3h2c0-2.76-2.24-5-5-5zm-7 7c-.55 0-1 .45-1 1v1l1.53 8.55C5.7 20.38 6.4 21 7.23 21h9.54c.83 0 1.53-.62 1.7-1.45L20 11v-1c0-.55-.45-1-1-1H5zm7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>' },
    ];
    document.getElementById('onboarding-content').innerHTML = `
      <div style="text-align:center;padding:16px 0">
        <h2 style="font-size:15px;font-weight:700;color:var(--c-fg-0);margin-bottom:4px">Pilih Platform</h2>
        <p style="font-size:11px;color:var(--c-fg-3);margin-bottom:16px">Bisa pilih satu atau keduanya</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${platforms.map(p => {
            const sel = this.data.platforms.includes(p.id);
            return `
              <button onclick="onboarding._togglePlatform('${p.id}')" style="padding:16px;border-radius:8px;border:1.5px solid ${sel ? p.color + '80' : 'var(--c-bg-2)'};background:${sel ? p.color + '10' : 'var(--c-bg-1)'};cursor:pointer;text-align:left;font-family:inherit;transition:all .15s" onmouseover="if(!${sel})this.style.borderColor='var(--c-bg-3)'" onmouseout="if(!${sel})this.style.borderColor='var(--c-bg-2)'">
                <div style="width:32px;height:32px;border-radius:8px;background:${p.color}15;border:1px solid ${p.color}30;display:flex;align-items:center;justify-content:center;margin-bottom:10px;color:${p.color}">
                  <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">${p.icon}</svg>
                </div>
                <p style="font-size:13px;font-weight:600;color:${sel ? 'var(--c-fg-0)' : 'var(--c-fg-1)'};margin-bottom:2px">${p.name}</p>
                <p style="font-size:10px;color:var(--c-fg-3)">${p.desc}</p>
              </button>`;
          }).join('')}
        </div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.back()" style="background:none;border:none;color:var(--c-fg-3);font-size:11px;cursor:pointer;font-family:inherit" onmouseover="this.style.color='var(--c-fg-1)'" onmouseout="this.style.color='var(--c-fg-3)'">Kembali</button>
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
        <h2 style="font-size:15px;font-weight:700;color:var(--c-fg-0);margin-bottom:4px;text-align:center">Upload Video Pertama</h2>
        <p style="font-size:11px;color:var(--c-fg-3);margin-bottom:12px;text-align:center">Coba upload 1 video untuk pastikan semuanya jalan</p>
        <div id="ob-upload-form"></div>
        <div id="ob-upload-console" style="display:none;margin-top:10px;background:var(--c-bg-1);border:1px solid var(--c-bg-2);border-radius:6px;padding:8px 10px;max-height:100px;overflow:auto;font-family:'IBM Plex Mono',monospace;font-size:10px"></div>
        <div id="ob-upload-success" style="display:none;text-align:center;padding:16px 0"></div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.back()" style="background:none;border:none;color:var(--c-fg-3);font-size:11px;cursor:pointer;font-family:inherit" onmouseover="this.style.color='var(--c-fg-1)'" onmouseout="this.style.color='var(--c-fg-3)'">Kembali</button>
      <div style="display:flex;gap:8px">
        <button onclick="onboarding.next()" style="background:none;border:none;color:var(--c-fg-3);font-size:11px;cursor:pointer;font-family:inherit" onmouseover="this.style.color='var(--c-fg-1)'" onmouseout="this.style.color='var(--c-fg-3)'">Lewati</button>
        <button id="ob-upload-btn" onclick="onboarding._startUpload()" class="btn btn-primary" style="padding:6px 20px">Upload Sekarang</button>
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
              <label style="font-size:9px;color:var(--c-fg-3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:3px">${f.label}${f.required ? '<span style="color:var(--c-red)"> *</span>' : ''}</label>
              <input type="text" id="ob-field-${f.key}" placeholder="${f.placeholder || ''}" class="inp" style="width:100%;padding:6px 10px">
            </div>
          `).join('')}
        </div>
      `;
      this._uploadFlow = flow;
      this._uploadPlatform = platformId;
    } catch (err) {
      document.getElementById('ob-upload-form').innerHTML = `<p style="font-size:11px;color:var(--c-red)">Error loading flow: ${this._esc(String(err))}</p>`;
    }
  },

  async _startUpload() {
    if (!this._uploadFlow || !this.data.deviceId) {
      if (!this.data.deviceId) {
        const c = document.getElementById('ob-upload-console');
        c.style.display = 'block';
        c.innerHTML = '<p style="color:var(--c-amber)">HP belum terhubung. Lewati langkah ini atau kembali.</p>';
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
      c.innerHTML = `<p style="color:var(--c-amber)">Isi dulu: ${missing.map(f => f.label).join(', ')}</p>`;
      return;
    }
    const btn = document.getElementById('ob-upload-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Mengupload...'; }
    const consoleEl = document.getElementById('ob-upload-console');
    consoleEl.style.display = 'block';
    consoleEl.innerHTML = '';
    const { listen } = window.__TAURI__.event;
    const { invoke } = window.__TAURI__.core;
    this._unlisten = await listen('engine-log', (e) => {
      const line = e.payload;
      let c = 'var(--c-green)';
      if (line.includes('[ERROR]')) c = 'var(--c-red)';
      else if (line.includes('[SYSTEM]')) c = 'var(--c-accent)';
      else if (line.includes('ADB:')) c = 'var(--c-bg-3)';
      consoleEl.innerHTML += `<div style="color:${c}">${this._esc(line)}</div>`;
      consoleEl.scrollTop = consoleEl.scrollHeight;
      if (line.includes('finished successfully') || line.includes('Batch complete')) this._onUploadSuccess();
      else if (line.includes('exited with code') || line.includes('Spawn failed')) this._onUploadError();
    });
    try {
      await invoke('start_automation', { deviceIds: [this.data.deviceId], flowName: this._uploadPlatform, vars: JSON.stringify({ items: [item] }) });
    } catch (err) {
      consoleEl.innerHTML += `<div style="color:var(--c-red)">Error: ${this._esc(String(err))}</div>`;
      this._onUploadError();
    }
  },

  _onUploadSuccess() {
    if (this._unlisten) { this._unlisten(); this._unlisten = null; }
    const el = document.getElementById('ob-upload-success');
    el.style.display = 'block';
    el.innerHTML = `
      <svg width="40" height="40" fill="none" stroke="var(--c-green)" stroke-width="2" viewBox="0 0 24 24" style="margin:0 auto 8px;display:block"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <p style="font-size:13px;font-weight:600;color:var(--c-green)">Upload berhasil!</p>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <div></div>
      <button onclick="onboarding.next()" class="btn btn-primary" style="padding:6px 20px">Lanjut</button>
    `;
  },

  _onUploadError() {
    if (this._unlisten) { this._unlisten(); this._unlisten = null; }
    const btn = document.getElementById('ob-upload-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Coba Lagi'; }
  },

  renderComplete() {
    document.getElementById('onboarding-content').innerHTML = `
      <div style="text-align:center;padding:24px 0">
        <div style="width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg,var(--c-green),var(--c-cyan));display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
          <svg width="28" height="28" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        </div>
        <h2 style="font-size:18px;font-weight:700;color:var(--c-fg-0);margin-bottom:6px">Setup Selesai!</h2>
        <p style="font-size:12px;color:var(--c-fg-2);margin-bottom:20px">Kamu siap mulai upload video</p>
        <div style="text-align:left;background:var(--c-bg-1);border:1px solid var(--c-bg-2);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:10px;font-size:11px">
            <svg width="16" height="16" fill="none" stroke="var(--c-accent)" stroke-width="1.5" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/></svg>
            <span style="color:var(--c-fg-1)"><span style="color:var(--c-fg-0);font-weight:600">Perangkat</span> — hubungkan & kelola HP</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;font-size:11px">
            <svg width="16" height="16" fill="none" stroke="var(--c-accent)" stroke-width="1.5" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
            <span style="color:var(--c-fg-1)"><span style="color:var(--c-fg-0);font-weight:600">Job</span> — tambah video atau impor CSV</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;font-size:11px">
            <svg width="16" height="16" fill="none" stroke="var(--c-green)" stroke-width="2" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <span style="color:var(--c-fg-1)">Klik <span style="color:var(--c-green);font-weight:600">Jalankan</span> untuk mulai upload</span>
          </div>
        </div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <div></div>
      <button onclick="onboarding.complete()" class="btn btn-primary" style="padding:6px 20px">Mulai Pakai</button>
    `;
  },

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
};
