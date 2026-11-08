/**
 * What this phone / browser can do for QR scanning, decided from facts (not guesses), so the screen can offer the right path instead of a dead end.
 * Pure: takes the values it needs, so it is unit-tested on real user-agent strings.
 */
export type InAppKind = 'none' | 'zalo' | 'facebook' | 'instagram' | 'line' | 'wechat' | 'tiktok' | 'other';
export type Os = 'ios' | 'android' | 'desktop' | 'other';
export type QrEnvironment = {
  os: Os;
  inApp: InAppKind;
  secure: boolean;
  /** navigator.mediaDevices.getUserMedia exists at all (many in-app WebViews and old browsers have no camera API) */
  cameraApi: boolean;
  /** the live camera can be tried here; false means go straight to "take a photo" */
  liveCameraLikely: boolean;
  touch: boolean;
};

export const IN_APP_LABEL: Record<Exclude<InAppKind, 'none'>, string> = {
  zalo: 'Zalo', facebook: 'Facebook / Messenger', instagram: 'Instagram', line: 'LINE', wechat: 'WeChat', tiktok: 'TikTok', other: 'một ứng dụng khác',
};

export function detectInApp(ua: string): InAppKind {
  if (/Zalo/i.test(ua)) return 'zalo';
  if (/FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(ua)) return 'facebook';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/\bLine\//i.test(ua)) return 'line';
  if (/MicroMessenger/i.test(ua)) return 'wechat';
  if (/musical_ly|TikTok|Bytedance/i.test(ua)) return 'tiktok';
  // An iPhone/iPad web view that is not Safari/Chrome/Firefox/Edge: a real browser's user agent carries the "Safari/" token, an embedded WKWebView does not.
  if (/iP(hone|od|ad)/.test(ua) && /Mobile\//.test(ua) && !/Safari\//.test(ua)) return 'other';
  if (/Android/.test(ua) && /; wv\)/.test(ua)) return 'other';
  return 'none';
}

export function detectOs(ua: string): Os {
  if (/iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua))) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop';
  return 'other';
}

export function detectEnvironment(input: { ua: string; isSecureContext: boolean; hasGetUserMedia: boolean; maxTouchPoints?: number }): QrEnvironment {
  const inApp = detectInApp(input.ua);
  const os = detectOs(input.ua);
  const cameraApi = input.hasGetUserMedia;
  return {
    os, inApp, secure: input.isSecureContext, cameraApi, touch: (input.maxTouchPoints ?? 0) > 0,
    liveCameraLikely: cameraApi && input.isSecureContext,
  };
}

/** Browser wrapper (kept separate so the pure part stays testable in Node). */
export function currentEnvironment(): QrEnvironment {
  return detectEnvironment({
    ua: navigator.userAgent || '', isSecureContext: window.isSecureContext !== false,
    hasGetUserMedia: Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'), maxTouchPoints: navigator.maxTouchPoints,
  });
}
