// ── Onboarding Wizard ─────────────────────────────────
// 6-step guided setup for first-time users

const onboarding = {
  step: 1,
  data: {
    platforms: [],
    deviceId: null,
    deviceModel: null,
  },
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
      <div id="onboarding-overlay" class="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-sm flex items-center justify-center p-4">
        <div id="onboarding-wizard" class="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
          <div id="onboarding-header" class="px-6 pt-5 pb-3"></div>
          <div id="onboarding-content" class="px-6 pb-4"></div>
          <div id="onboarding-footer" class="px-6 pb-5 flex items-center justify-between"></div>
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
    await invoke('save_config', {
      config: { onboarding_completed: true, selected_platforms: this.data.platforms }
    });
    this.destroy();
  },

  goTo(step) {
    this.step = step;
    this.render();
  },

  next() {
    if (this.step === '2b') { this.goTo(3); return; }
    if (this.step >= 5) { this.complete(); return; }
    this.goTo(this.step + 1);
  },

  back() {
    if (this.step === '2b') { this.goTo(2); return; }
    if (this.step > 1) this.goTo(this.step - 1);
  },

  render() {
    const steps = { 1: 1, 2: 2, '2b': 2, 3: 3, 4: 4, 5: 5 };
    const current = steps[this.step] || 1;
    const total = 5;

    // Header: step dots
    document.getElementById('onboarding-header').innerHTML = `
      <div class="flex items-center justify-center gap-2 mb-1">
        ${Array.from({ length: total }, (_, i) => {
          const n = i + 1;
          const active = n === current;
          const done = n < current;
          return `<div class="w-2 h-2 rounded-full transition-all ${active ? 'bg-indigo-500 w-6' : done ? 'bg-indigo-500/40' : 'bg-slate-700'}"></div>`;
        }).join('')}
      </div>
      <p class="text-center text-[10px] text-slate-600 font-medium">Langkah ${current} dari ${total}</p>
    `;

    // Content
    const renderMap = {
      1: () => this.renderWelcome(),
      2: () => this.renderConnectDevice(),
      '2b': () => this.renderUSBGuide(),
      3: () => this.renderPlatform(),
      4: () => this.renderFirstUpload(),
      5: () => this.renderComplete(),
    };
    (renderMap[this.step] || renderMap[1])();
  },

  // ── Step 1: Welcome ──────────────────────────────────
  renderWelcome() {
    document.getElementById('onboarding-content').innerHTML = `
      <div class="text-center py-6">
        <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h2 class="text-xl font-bold text-white mb-2">Selamat datang di AutoFlow!</h2>
        <p class="text-sm text-slate-400 leading-relaxed max-w-sm mx-auto">
          Upload video ke TikTok & Shopee secara otomatis. Mari setup dalam beberapa langkah sederhana.
        </p>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.skip()" class="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">Skip setup</button>
      <button onclick="onboarding.next()" class="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-all cursor-pointer">
        Mulai Setup
      </button>
    `;
  },

  // ── Step 2: Connect Device ────────────────────────────
  renderConnectDevice() {
    const hasDevice = !!this.data.deviceId;
    document.getElementById('onboarding-content').innerHTML = `
      <div class="text-center py-4">
        <div class="flex items-center justify-center gap-4 mb-5">
          <div class="w-12 h-20 rounded-lg border-2 border-slate-600 flex items-center justify-center">
            <svg class="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
            </svg>
          </div>
          <div class="flex items-center gap-1">
            <div class="w-8 h-0.5 bg-slate-600"></div>
            <svg class="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            <div class="w-8 h-0.5 bg-slate-600"></div>
          </div>
          <div class="w-16 h-12 rounded-lg border-2 border-slate-600 flex items-center justify-center">
            <svg class="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" />
            </svg>
          </div>
        </div>
        <h2 class="text-lg font-bold text-white mb-1">Hubungkan HP Android</h2>
        <p class="text-xs text-slate-400 mb-5">Colokkan HP via kabel USB ke komputer kamu</p>

        ${hasDevice ? `
          <div class="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-4 inline-flex items-center gap-2">
            <svg class="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span class="text-sm text-emerald-300 font-medium">${this._esc(this.data.deviceModel)}</span>
          </div>
        ` : `
          <button id="ob-scan-btn" onclick="onboarding._scanDevice()" class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            Scan Device
          </button>
          <div id="ob-scan-result" class="mt-3 text-xs text-slate-500"></div>
        `}
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.back()" class="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">Kembali</button>
      <button onclick="onboarding.next()" ${hasDevice ? '' : 'disabled'} class="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
        Lanjut
      </button>
    `;
  },

  async _scanDevice() {
    const btn = document.getElementById('ob-scan-btn');
    const result = document.getElementById('ob-scan-result');
    if (btn) btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Scanning...';

    try {
      const { invoke } = window.__TAURI__.core;
      const devices = await invoke('list_devices');
      if (devices.length > 0) {
        this.data.deviceId = devices[0][0];
        this.data.deviceModel = devices[0][1];
        this.render();
      } else {
        if (result) result.innerHTML = `
          <span class="text-amber-400">HP tidak ditemukan.</span>
          <button onclick="onboarding.goTo('2b')" class="text-indigo-400 hover:text-indigo-300 underline ml-1 cursor-pointer">Lihat panduan USB Debugging</button>
        `;
        if (btn) btn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg> Scan Ulang';
      }
    } catch (err) {
      if (result) result.innerHTML = `<span class="text-red-400">Error: ${this._esc(String(err))}</span>`;
      if (btn) btn.innerHTML = 'Scan Device';
    }
  },

  // ── Step 2b: USB Debugging Guide ──────────────────────
  renderUSBGuide() {
    const brands = [
      { name: 'Samsung', path: 'Settings > About Phone > Software Information > Build Number', note: 'Tap 7 kali. Juga aktifkan "USB Configuration".' },
      { name: 'Xiaomi', path: 'Settings > About Phone > MIUI Version', note: 'Tap 7 kali. Lalu aktifkan "Install via USB" juga.' },
      { name: 'Oppo / Realme', path: 'Settings > About Phone > Build Number', note: 'Tap 7 kali. Path bisa berbeda di ColorOS.' },
      { name: 'Vivo', path: 'Settings > About Phone > Software Version', note: 'Tap 7 kali. Funtouch OS variant.' },
    ];

    document.getElementById('onboarding-content').innerHTML = `
      <div class="py-2">
        <h2 class="text-lg font-bold text-white mb-1 text-center">Aktifkan USB Debugging</h2>
        <p class="text-xs text-slate-400 mb-4 text-center">Ikuti langkah sesuai merk HP kamu</p>

        <div class="space-y-2 mb-4">
          ${brands.map(b => `
            <details class="group bg-slate-800/50 border border-slate-700/50 rounded-lg">
              <summary class="px-3 py-2.5 text-sm font-medium text-slate-200 cursor-pointer flex items-center justify-between">
                ${b.name}
                <svg class="w-4 h-4 text-slate-500 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
              </summary>
              <div class="px-3 pb-3 text-xs text-slate-400 space-y-1.5">
                <p><span class="text-slate-300 font-medium">1.</span> Buka <code class="text-indigo-400">${b.path}</code></p>
                <p><span class="text-slate-300 font-medium">2.</span> ${b.note}</p>
                <p><span class="text-slate-300 font-medium">3.</span> Kembali ke Settings > <code class="text-indigo-400">Developer Options</code></p>
                <p><span class="text-slate-300 font-medium">4.</span> Aktifkan <code class="text-indigo-400">USB Debugging</code></p>
                <p><span class="text-slate-300 font-medium">5.</span> Hubungkan USB, pilih mode <code class="text-indigo-400">File Transfer (MTP)</code></p>
                <p><span class="text-slate-300 font-medium">6.</span> Tap <code class="text-indigo-400">Allow / Izinkan</code> pada popup di HP</p>
              </div>
            </details>
          `).join('')}
        </div>

        <div class="bg-slate-800/30 border border-slate-700/30 rounded-lg p-3 text-xs text-slate-500 space-y-1">
          <p class="font-medium text-slate-400">Checklist troubleshooting:</p>
          <p>- USB Debugging sudah di-enable?</p>
          <p>- Sudah tap "Allow/Izinkan" di popup HP?</p>
          <p>- Mode USB = File Transfer (bukan Charging only)?</p>
          <p>- Kabel support data (bukan charging-only)?</p>
          <p>- Coba cabut-colok ulang / restart HP</p>
        </div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.goTo(2)" class="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">Kembali</button>
      <button onclick="onboarding._scanFromGuide()" class="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-all cursor-pointer">
        Coba Scan Lagi
      </button>
    `;
  },

  async _scanFromGuide() {
    try {
      const { invoke } = window.__TAURI__.core;
      const devices = await invoke('list_devices');
      if (devices.length > 0) {
        this.data.deviceId = devices[0][0];
        this.data.deviceModel = devices[0][1];
        this.goTo(3);
      } else {
        // Stay on guide, show message
        const footer = document.getElementById('onboarding-footer');
        if (!document.getElementById('ob-guide-msg')) {
          footer.insertAdjacentHTML('beforeend', '<span id="ob-guide-msg" class="text-xs text-amber-400 absolute left-1/2 -translate-x-1/2">HP masih belum terdeteksi</span>');
          setTimeout(() => { const m = document.getElementById('ob-guide-msg'); if (m) m.remove(); }, 3000);
        }
      }
    } catch (err) {
      console.error('Scan failed:', err);
    }
  },

  // ── Step 3: Platform Selection ────────────────────────
  renderPlatform() {
    const platforms = [
      { id: 'tiktok_upload', icon: '🎵', name: 'TikTok', desc: 'Upload video ke TikTok dengan caption & hashtag' },
      { id: 'shopee_upload', icon: '🛒', name: 'Shopee Video', desc: 'Upload video produk ke Shopee dengan link produk' },
    ];

    document.getElementById('onboarding-content').innerHTML = `
      <div class="text-center py-4">
        <h2 class="text-lg font-bold text-white mb-1">Pilih Platform</h2>
        <p class="text-xs text-slate-400 mb-5">Kamu bisa pilih satu atau dua-duanya</p>
        <div class="grid grid-cols-2 gap-3">
          ${platforms.map(p => {
            const selected = this.data.platforms.includes(p.id);
            return `
              <button onclick="onboarding._togglePlatform('${p.id}')"
                class="p-4 rounded-xl border-2 transition-all cursor-pointer text-left
                  ${selected ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'}">
                <span class="text-2xl block mb-2">${p.icon}</span>
                <span class="text-sm font-semibold ${selected ? 'text-indigo-300' : 'text-slate-200'} block">${p.name}</span>
                <span class="text-[10px] text-slate-500 block mt-1">${p.desc}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.back()" class="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">Kembali</button>
      <button onclick="onboarding.next()" ${this.data.platforms.length ? '' : 'disabled'}
        class="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
        Lanjut
      </button>
    `;
  },

  _togglePlatform(id) {
    const idx = this.data.platforms.indexOf(id);
    if (idx >= 0) this.data.platforms.splice(idx, 1);
    else this.data.platforms.push(id);
    this.render();
  },

  // ── Step 4: First Upload ──────────────────────────────
  renderFirstUpload() {
    document.getElementById('onboarding-content').innerHTML = `
      <div class="py-2">
        <h2 class="text-lg font-bold text-white mb-1 text-center">Upload Video Pertama</h2>
        <p class="text-xs text-slate-400 mb-4 text-center">Coba upload satu video untuk memastikan semuanya jalan</p>
        <div id="ob-upload-form"></div>
        <div id="ob-upload-console" class="hidden mt-3 bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-32 overflow-y-auto font-mono text-[10px]"></div>
        <div id="ob-upload-success" class="hidden text-center py-4"></div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <button onclick="onboarding.back()" class="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">Kembali</button>
      <div class="flex gap-2">
        <button onclick="onboarding.next()" class="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer py-2 px-3">Lewati</button>
        <button id="ob-upload-btn" onclick="onboarding._startUpload()" class="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-all cursor-pointer">
          Upload Sekarang
        </button>
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
        <div class="space-y-2.5">
          ${fields.map(f => `
            <div>
              <label class="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1 block">
                ${f.label}${f.required ? '<span class="text-red-400 ml-0.5">*</span>' : ''}
              </label>
              <input type="text" id="ob-field-${f.key}" placeholder="${f.placeholder || ''}"
                class="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors" />
            </div>
          `).join('')}
        </div>
      `;
      this._uploadFlow = flow;
      this._uploadPlatform = platformId;
    } catch (err) {
      document.getElementById('ob-upload-form').innerHTML = `<p class="text-xs text-red-400">Error loading flow: ${this._esc(String(err))}</p>`;
    }
  },

  async _startUpload() {
    if (!this._uploadFlow || !this.data.deviceId) {
      if (!this.data.deviceId) {
        document.getElementById('ob-upload-console').classList.remove('hidden');
        document.getElementById('ob-upload-console').innerHTML = '<p class="text-amber-400">Tidak ada device terhubung. Lewati langkah ini atau kembali ke step 2.</p>';
      }
      return;
    }

    const fields = this._uploadFlow.batch_fields || [];
    const item = {};
    for (const f of fields) {
      const el = document.getElementById(`ob-field-${f.key}`);
      item[f.key] = el ? el.value : '';
    }

    // Validate required
    const missing = fields.filter(f => f.required && !item[f.key]?.trim());
    if (missing.length) {
      document.getElementById('ob-upload-console').classList.remove('hidden');
      document.getElementById('ob-upload-console').innerHTML = `<p class="text-amber-400">Isi field: ${missing.map(f => f.label).join(', ')}</p>`;
      return;
    }

    // Disable button, show console
    const btn = document.getElementById('ob-upload-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }
    const consoleEl = document.getElementById('ob-upload-console');
    consoleEl.classList.remove('hidden');
    consoleEl.innerHTML = '';

    // Listen to engine logs
    const { listen } = window.__TAURI__.event;
    const { invoke } = window.__TAURI__.core;

    this._unlisten = await listen('engine-log', (e) => {
      const line = e.payload;
      let cls = 'text-emerald-400';
      if (line.includes('[ERROR]')) cls = 'text-red-400';
      else if (line.includes('[SYSTEM]')) cls = 'text-indigo-400';
      else if (line.includes('ADB:')) cls = 'text-slate-600';
      consoleEl.innerHTML += `<div class="${cls}">${this._esc(line)}</div>`;
      consoleEl.scrollTop = consoleEl.scrollHeight;

      if (line.includes('finished successfully') || line.includes('Batch complete')) {
        this._onUploadSuccess();
      } else if (line.includes('exited with code') || line.includes('Spawn failed')) {
        this._onUploadError();
      }
    });

    try {
      await invoke('start_automation', {
        deviceIds: [this.data.deviceId],
        flowName: this._uploadPlatform,
        vars: JSON.stringify({ items: [item] }),
      });
    } catch (err) {
      consoleEl.innerHTML += `<div class="text-red-400">Error: ${this._esc(String(err))}</div>`;
      this._onUploadError();
    }
  },

  _onUploadSuccess() {
    if (this._unlisten) { this._unlisten(); this._unlisten = null; }
    const successEl = document.getElementById('ob-upload-success');
    successEl.classList.remove('hidden');
    successEl.innerHTML = `
      <div class="relative">
        <div id="ob-confetti" class="absolute inset-0 pointer-events-none overflow-hidden"></div>
        <svg class="w-12 h-12 text-emerald-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="text-sm font-semibold text-emerald-300">Upload berhasil!</p>
      </div>
    `;
    // Update footer
    document.getElementById('onboarding-footer').innerHTML = `
      <div></div>
      <button onclick="onboarding.next()" class="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-all cursor-pointer">
        Lanjut
      </button>
    `;
    this._spawnConfetti();
  },

  _onUploadError() {
    if (this._unlisten) { this._unlisten(); this._unlisten = null; }
    const btn = document.getElementById('ob-upload-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Coba Lagi'; }
  },

  _spawnConfetti() {
    const container = document.getElementById('ob-confetti');
    if (!container) return;
    const colors = ['#818cf8', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#38bdf8'];
    for (let i = 0; i < 20; i++) {
      const dot = document.createElement('div');
      dot.style.cssText = `
        position:absolute; width:6px; height:6px; border-radius:50%;
        background:${colors[i % colors.length]};
        left:${Math.random() * 100}%; top:-10px;
        animation: ob-fall ${0.8 + Math.random() * 1.2}s ease-out ${Math.random() * 0.3}s forwards;
        opacity:0.9;
      `;
      container.appendChild(dot);
    }
    // Inject keyframe if not exists
    if (!document.getElementById('ob-confetti-style')) {
      const style = document.createElement('style');
      style.id = 'ob-confetti-style';
      style.textContent = `@keyframes ob-fall { to { top: 120%; opacity: 0; transform: rotate(${360}deg) scale(0.5); } }`;
      document.head.appendChild(style);
    }
  },

  // ── Step 5: Complete ──────────────────────────────────
  renderComplete() {
    document.getElementById('onboarding-content').innerHTML = `
      <div class="text-center py-6">
        <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 class="text-xl font-bold text-white mb-2">Setup Selesai!</h2>
        <p class="text-sm text-slate-400 mb-5">Kamu siap mulai upload video secara otomatis</p>
        <div class="text-left bg-slate-800/30 border border-slate-700/30 rounded-lg p-4 space-y-2 text-xs text-slate-400">
          <p class="font-medium text-slate-300 mb-2">Quick tips:</p>
          <p>📋 <span class="text-slate-300">Upload Queue</span> — tambah video manual atau import dari CSV</p>
          <p>📱 <span class="text-slate-300">Devices</span> — kelola HP Android yang terhubung</p>
          <p>⚙️ <span class="text-slate-300">Flow Editor</span> — edit langkah-langkah otomasi</p>
          <p>▶️ Klik <span class="text-slate-300">Start</span> untuk mulai upload batch</p>
        </div>
      </div>
    `;
    document.getElementById('onboarding-footer').innerHTML = `
      <div></div>
      <button onclick="onboarding.complete()" class="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-all cursor-pointer">
        Masuk ke Dashboard
      </button>
    `;
  },

  // ── Helpers ───────────────────────────────────────────
  _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
};
