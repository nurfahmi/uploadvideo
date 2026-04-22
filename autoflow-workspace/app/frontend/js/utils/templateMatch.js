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
