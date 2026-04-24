// ── Template ↔ Device Smart Match ────────────────────
// Score a template against a device based on how likely the recorded flow
// will replay correctly on this device.
//
// 3 = Cocok           (same model + same Android major)
// 2 = Mungkin cocok   (same model, different Android major)
// 1 = Perlu uji       (same brand only)
// 0 = Beda brand      (still replayable via smart scaling, but risky)
// -1 = Incompatible   (legacy template without record_device, or missing device info)

function normalize(s) {
  return (s || '').toString().trim().toLowerCase();
}

function androidMajor(ver) {
  if (ver == null) return null;
  const m = String(ver).match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function deviceFingerprint(deviceHealth) {
  if (!deviceHealth) return null;
  return {
    brand: normalize(deviceHealth.brand),
    model: normalize(deviceHealth.model),
    android_major: androidMajor(deviceHealth.android_version),
    screen: deviceHealth.screen_resolution || null,
  };
}

function templateFingerprint(tpl) {
  const rd = tpl?.record_device;
  if (!rd) return null;
  return {
    brand: normalize(rd.brand),
    model: normalize(rd.model),
    android_major: rd.android_major != null ? Number(rd.android_major) : null,
    screen_w: rd.screen_w || null,
    screen_h: rd.screen_h || null,
  };
}

export function scoreTemplate(tpl, deviceHealth) {
  const dev = deviceFingerprint(deviceHealth);
  const tp = templateFingerprint(tpl);
  if (!dev || !tp) return -1;
  if (!tp.model || !dev.model) return -1;

  if (tp.model === dev.model && tp.android_major != null && dev.android_major != null
      && tp.android_major === dev.android_major) return 3;
  if (tp.model === dev.model) return 2;
  if (tp.brand && dev.brand && tp.brand === dev.brand) return 1;
  return 0;
}

export function labelForScore(score) {
  switch (score) {
    case 3: return 'Cocok';
    case 2: return 'Mungkin cocok';
    case 1: return 'Perlu uji';
    case 0: return 'Beda brand';
    default: return 'Legacy';
  }
}

export function colorForScore(score) {
  switch (score) {
    case 3: return 'var(--c-green)';
    case 2: return 'var(--c-amber)';
    case 1: return 'var(--c-amber)';
    case 0: return 'var(--c-fg-3)';
    default: return 'var(--c-fg-3)';
  }
}

export function chipClassForScore(score) {
  if (score >= 3) return 'ui-chip-ok';
  if (score >= 2) return 'ui-chip-warn';
  if (score >= 1) return 'ui-chip-warn';
  return 'ui-chip';
}

// Build device fingerprint for embedding into template on save.
export function buildRecordDevice(deviceHealth) {
  if (!deviceHealth) return null;
  return {
    brand: deviceHealth.brand || null,
    model: deviceHealth.model || null,
    android_version: deviceHealth.android_version || null,
    android_major: androidMajor(deviceHealth.android_version),
    screen_w: parseScreenDim(deviceHealth.screen_resolution, 0),
    screen_h: parseScreenDim(deviceHealth.screen_resolution, 1),
  };
}

function parseScreenDim(res, idx) {
  if (!res) return null;
  const m = String(res).match(/(\d+)\s*[x×]\s*(\d+)/);
  if (!m) return null;
  return parseInt(m[idx + 1], 10);
}

// ── Platform visual identity (shared by recorder grid + device template row) ─
const PLATFORM_ICONS = {
  shopee: {
    bg: '#EE4D2D', fg: '#fff',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.4c-2.7 0-5 2.2-5 5H8.8c0-1.7 1.4-3.1 3.2-3.1s3.2 1.4 3.2 3.1H17c0-2.8-2.3-5-5-5zM4.8 8.2c-.5 0-.9.4-.9.9l.9 10.4c.1 1.1 1 1.9 2.1 1.9H17c1.1 0 2-.8 2.1-1.9l.9-10.4c0-.5-.4-.9-.9-.9H4.8zm7.2 10c-2 0-3.7-1.2-4.4-2.9l1.5-.6c.5 1.1 1.6 1.9 2.9 1.9 1.4 0 2.6-1.1 2.6-2.3 0-1.1-.8-1.8-2.6-2.4-2-.6-3.3-1.3-3.3-3.1 0-1.8 1.8-3.1 3.9-3.1 1.8 0 3.2.8 3.8 2l-1.5.7c-.5-.9-1.3-1.3-2.3-1.3-1.2 0-2.1.6-2.1 1.6s1 1.3 2.4 1.8c2.3.7 3.5 1.6 3.5 3.7 0 2-1.9 3.5-4.4 3.5z"/></svg>',
  },
  tiktok: {
    bg: '#000', fg: '#fff',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.18 8.18 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z"/></svg>',
  },
  instagram: {
    bg: 'linear-gradient(135deg,#405DE6,#833AB4,#E1306C,#F56040,#FCAF45)', fg: '#fff',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/></svg>',
  },
  youtube: {
    bg: '#FF0000', fg: '#fff',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.2s-.2-1.6-.9-2.3c-.9-.9-1.8-.9-2.3-1-3.2-.2-7.9-.2-7.9-.2s-4.7 0-7.9.2c-.5.1-1.5.1-2.3 1-.7.7-.9 2.3-.9 2.3S.6 9 .6 10.9v1.7c0 1.9.2 3.7.2 3.7s.2 1.6.9 2.3c.9.9 2.1.9 2.7 1 1.9.2 8.1.2 8.1.2s4.7 0 7.9-.3c.5-.1 1.5-.1 2.3-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.7V11c.1-1.9-.1-3.8-.1-3.8zM9.5 14.9V8.6l6 3.2-6 3.1z"/></svg>',
  },
  lazada: {
    bg: '#0F146D', fg: '#fff',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 7l6-3 6 3-6 3-6-3z"/><path d="M6 7v9l6 3 6-3V7"/><path d="M12 10v9"/></svg>',
  },
  other: {
    bg: 'var(--c-bg-2)', fg: 'var(--c-fg-2)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12h6M12 9v6" stroke-linecap="round"/></svg>',
  },
};

function normalizePlatform(p) {
  const s = (p || '').toString().toLowerCase();
  if (s.includes('shopee')) return 'shopee';
  if (s.includes('tiktok') || s.includes('musically') || s.includes('trill') || s.includes('aweme') || s.includes('zhiliao')) return 'tiktok';
  if (s.includes('instagram')) return 'instagram';
  if (s.includes('youtube')) return 'youtube';
  if (s.includes('lazada')) return 'lazada';
  return 'other';
}

/**
 * Infer the real platform from a template. Uses the stored `platform` field
 * first, but falls back to scanning all steps' activity_after fields — so
 * templates that started from a launcher (stored as 'other') still get the
 * correct brand icon.
 */
export function detectPlatformFromTemplate(tpl) {
  const stored = normalizePlatform(tpl?.platform);
  if (stored !== 'other') return stored;
  const steps = tpl?.steps || [];
  for (const s of steps) {
    const joined = `${s.activity_after || ''} ${s.activity_before || ''} ${s.package || ''}`;
    const guess = normalizePlatform(joined);
    if (guess !== 'other') return guess;
  }
  return 'other';
}

export function getPlatformUI(platformOrTemplate) {
  // Accept either a platform string OR a full template object (for auto-detect)
  if (platformOrTemplate && typeof platformOrTemplate === 'object') {
    return PLATFORM_ICONS[detectPlatformFromTemplate(platformOrTemplate)] || PLATFORM_ICONS.other;
  }
  return PLATFORM_ICONS[normalizePlatform(platformOrTemplate)] || PLATFORM_ICONS.other;
}

/** Render a square tile with the platform's brand color + icon.
 *  Accepts a platform string ("shopee") or a full template object.
 */
export function platformIconTile(platformOrTemplate, size = 40) {
  const ui = getPlatformUI(platformOrTemplate);
  const iconSize = Math.round(size * 0.55);
  return `<div style="width:${size}px;height:${size}px;border-radius:var(--r-md);background:${ui.bg};color:${ui.fg};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">
    <span style="width:${iconSize}px;height:${iconSize}px;display:flex;align-items:center;justify-content:center">${ui.svg.replace('<svg ', `<svg width="${iconSize}" height="${iconSize}" `)}</span>
  </div>`;
}
