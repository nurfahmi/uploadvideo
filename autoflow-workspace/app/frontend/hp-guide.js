// ── Phone Setup Guide ─────────────────────────────────
// In-app USB debugging guide per brand, accessible from Devices tab
// and auto-shown when Scan Devices finds no devices.

window.hpGuide = {
  _visible: false,

  show() {
    if (this._visible) return;
    this._visible = true;
    document.body.insertAdjacentHTML('beforeend', this._html());
    document.getElementById('hp-guide-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'hp-guide-overlay') hpGuide.hide();
    });
  },

  hide() {
    const el = document.getElementById('hp-guide-overlay');
    if (el) el.remove();
    this._visible = false;
  },

  async scanAndRetry() {
    const btn = document.getElementById('hp-guide-scan-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Memindai...'; }

    try {
      const { invoke } = window.__TAURI__.core;
      const devices = await invoke('list_devices');
      if (devices.length > 0) {
        this.hide();
        if (typeof refreshDevices === 'function') await refreshDevices();
      } else {
        const msg = document.getElementById('hp-guide-msg');
        if (msg) {
          msg.textContent = 'HP masih belum terdeteksi. Cek ulang langkah di atas.';
          msg.classList.remove('hidden');
          setTimeout(() => { if (msg) msg.classList.add('hidden'); }, 4000);
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Pindai Lagi'; }
      }
    } catch (err) {
      console.error('Scan failed:', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Pindai Lagi'; }
    }
  },

  _html() {
    const brands = [
      {
        name: 'Samsung',
        icon: 'S',
        color: 'from-blue-500 to-blue-600',
        steps: [
          'Buka <code class="text-indigo-400">Pengaturan</code> > <code class="text-indigo-400">Tentang HP</code> > <code class="text-indigo-400">Software Information</code>',
          'Tap <code class="text-indigo-400">Build Number</code> 7 kali sampai muncul "Mode pengembang aktif"',
          'Balik ke Pengaturan > <code class="text-indigo-400">Opsi Pengembang</code>',
          'Aktifkan <code class="text-indigo-400">USB Debugging</code>',
          'Kalau ada, aktifkan juga <code class="text-indigo-400">USB Configuration</code> jika ada',
        ],
      },
      {
        name: 'Xiaomi / Redmi / POCO',
        icon: 'Mi',
        color: 'from-orange-500 to-orange-600',
        steps: [
          'Buka <code class="text-indigo-400">Pengaturan</code> > <code class="text-indigo-400">Tentang HP</code>',
          'Tap <code class="text-indigo-400">MIUI Version</code> 7 kali',
          'Balik ke Pengaturan > <code class="text-indigo-400">Pengaturan Tambahan</code> > <code class="text-indigo-400">Opsi Pengembang</code>',
          'Aktifkan <code class="text-indigo-400">USB Debugging</code>',
          'Kalau ada, aktifkan juga <code class="text-indigo-400">Install via USB</code>',
        ],
      },
      {
        name: 'Oppo / Realme',
        icon: 'O',
        color: 'from-green-500 to-green-600',
        steps: [
          'Buka <code class="text-indigo-400">Pengaturan</code> > <code class="text-indigo-400">Tentang HP</code>',
          'Tap <code class="text-indigo-400">Build Number</code> 7 kali',
          'Balik ke Pengaturan > <code class="text-indigo-400">Pengaturan Sistem</code> > <code class="text-indigo-400">Opsi Pengembang</code>',
          'Aktifkan <code class="text-indigo-400">USB Debugging</code>',
          'Path bisa beda dikit tergantung versi ColorOS',
        ],
      },
      {
        name: 'Vivo',
        icon: 'V',
        color: 'from-violet-500 to-violet-600',
        steps: [
          'Buka <code class="text-indigo-400">Pengaturan</code> > <code class="text-indigo-400">Tentang HP</code>',
          'Tap <code class="text-indigo-400">Software Version</code> 7 kali',
          'Balik ke Pengaturan > <code class="text-indigo-400">System Management</code> > <code class="text-indigo-400">Opsi Pengembang</code>',
          'Aktifkan <code class="text-indigo-400">USB Debugging</code>',
          'Versi Funtouch OS mungkin sedikit beda',
        ],
      },
    ];

    return `
    <div id="hp-guide-overlay" class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        <div class="px-5 pt-4 pb-3 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <h2 class="text-base font-bold text-white">Panduan Setup HP Android</h2>
            <p class="text-[10px] text-slate-500 mt-0.5">Aktifkan USB Debugging biar HP bisa konek ke AutoFlow</p>
          </div>
          <button onclick="hpGuide.hide()" class="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          ${brands.map(b => `
            <details class="group bg-slate-800/40 border border-slate-700/40 rounded-xl overflow-hidden">
              <summary class="px-4 py-3 cursor-pointer flex items-center gap-3 hover:bg-slate-800/60 transition-colors">
                <div class="w-8 h-8 rounded-lg bg-gradient-to-br ${b.color} flex items-center justify-center shrink-0">
                  <span class="text-[10px] font-bold text-white">${b.icon}</span>
                </div>
                <span class="text-sm font-medium text-slate-200 flex-1">${b.name}</span>
                <svg class="w-4 h-4 text-slate-500 group-open:rotate-180 transition-transform shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
              </summary>
              <div class="px-4 pb-3 space-y-1.5">
                ${b.steps.map((s, i) => `
                  <div class="flex gap-2 text-xs">
                    <span class="text-indigo-400 font-semibold w-5 shrink-0 text-right">${i + 1}.</span>
                    <span class="text-slate-400">${s}</span>
                  </div>
                `).join('')}
              </div>
            </details>
          `).join('')}

          <div class="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4">
            <p class="text-xs font-semibold text-indigo-400 mb-2">Setelah USB Debugging aktif:</p>
            <div class="space-y-1.5 text-xs text-slate-400">
              <p>1. Colok HP ke laptop pake kabel USB</p>
              <p>2. Pilih mode <code class="text-indigo-400">Transfer File (MTP)</code> di HP</p>
              <p>3. Tap <code class="text-indigo-400">Izinkan</code> saat muncul popup "Izinkan USB Debugging?"</p>
              <p>4. Centang "Selalu izinkan dari komputer ini" biar gak ditanya terus</p>
            </div>
          </div>

          <div class="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
            <p class="text-xs font-semibold text-amber-400 mb-2">Masih belum terdeteksi?</p>
            <div class="space-y-1 text-xs text-slate-400">
              <p>- Pastikan USB Debugging <span class="text-slate-300">AKTIF</span></p>
              <p>- Pastikan udah tap <span class="text-slate-300">Izinkan</span> di popup HP</p>
              <p>- Mode USB harus <span class="text-slate-300">Transfer File</span> (bukan cuma Charging)</p>
              <p>- Pastikan kabel support <span class="text-slate-300">transfer data</span> (bukan cuma charging)</p>
              <p>- Coba <span class="text-slate-300">cabut dan colok ulang</span> kabel USB</p>
              <p>- Coba <span class="text-slate-300">restart HP</span></p>
              <p>- Coba port USB lain di laptop</p>
            </div>
          </div>
        </div>

        <div class="px-5 py-3 border-t border-slate-800 flex items-center justify-between shrink-0">
          <span id="hp-guide-msg" class="hidden text-xs text-amber-400 max-w-[250px] truncate"></span>
          <div class="flex gap-2 ml-auto">
            <button onclick="hpGuide.hide()" class="text-xs text-slate-500 hover:text-slate-300 px-3 py-2 transition-colors cursor-pointer">Tutup</button>
            <button id="hp-guide-scan-btn" onclick="hpGuide.scanAndRetry()"
              class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              Pindai Lagi
            </button>
          </div>
        </div>
      </div>
    </div>`;
  },
};
