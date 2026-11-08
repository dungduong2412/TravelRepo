// Run: npx tsx lib/qr/qr.selftest.ts   (needs ffmpeg for the decode matrix; everything else is pure)
// Covers: the payload parser matrix (same cases as the API test), in-app browser detection on real user-agent strings, money/rate formatting,
// and the decode engine on degraded phone-camera frames and 12-megapixel photos built from the two QR designs (new on-screen design, old 1-module-margin design).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parsePartnerQrPayload } from './payload';
import { detectEnvironment, detectInApp, detectOs } from './environment';
import { formatRate, formatVnd } from './money';
import { decodeFrame, decodeWithJsQr, downscale, loadEngine, Frame } from './engine';

let checks = 0; const ok = (label: string, fn: () => void) => { try { fn(); checks += 1; } catch (e) { console.error(`FAIL: ${label}`); throw e; } };
const CODE = 'COL-D600ABC8D5C2C528';

// ---- payload parser ---------------------------------------------------------------------------------------------------------------------------
ok('payload: accepted forms', () => {
  const accept: Array<[string, string]> = [
    [CODE, CODE], [`https://vno-web-uat.up.railway.app/c/${CODE}`, CODE], [`http://localhost:3000/c/${CODE}`, CODE], [`https://old.example.org/c/${CODE}/`, CODE],
    [`https://x.test/c/${CODE}?utm=1#frag`, CODE], [`vno-web-uat.up.railway.app/c/${CODE}`, CODE], [`localhost:3000/c/${CODE}`, CODE], [`  ${CODE}\n`, CODE],
    [`${CODE}​`, CODE], [`﻿${CODE}`, CODE], [`${CODE} `, CODE], [`https://x.test/c/${CODE.toLowerCase()}`, CODE.toLowerCase()], [CODE.toLowerCase(), CODE.toLowerCase()],
    ['https://x.test/c/%43OL-D600ABC8D5C2C528', CODE], ['C2500228', 'C2500228'], ['https://x.test/path/c/C2500228', 'C2500228'],
  ];
  for (const [input, expected] of accept) { const r = parsePartnerQrPayload(input); assert.equal(r.ok, true, `accept ${JSON.stringify(input)}`); assert.equal((r as { code: string }).code, expected); }
});
ok('payload: rejected forms', () => {
  for (const bad of ['', '   ', '​​', 'hello world', '{"a":1}', 'https://example.com/pay?id=123', 'https://x.test/d/COL-ABC', 'https://x.test/c/', 'https://x.test/c/a b', 'javascript:alert(1)//c/COL-ABC',
    'ftp://x.test/c/COL-ABC', 'C', '--bad', 'a'.repeat(65), 'COL- D600', 'https://x.test/c/%E0%A4%A', 'mailto:a@b.test', 12345, null, undefined]) {
    assert.equal(parsePartnerQrPayload(bad).ok, false, `reject ${JSON.stringify(bad)}`);
  }
  assert.equal((parsePartnerQrPayload('   ') as { reason: string }).reason, 'empty');
});

// ---- environment detection --------------------------------------------------------------------------------------------------------------------
const UA = {
  zaloIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo/24.03.1',
  zaloAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.178 Mobile Safari/537.36 Zalo/24.03.1',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0;FBBV/1]',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  unknownWkWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};
ok('environment: in-app browsers are recognised, real browsers are not', () => {
  assert.equal(detectInApp(UA.zaloIos), 'zalo'); assert.equal(detectInApp(UA.zaloAndroid), 'zalo'); assert.equal(detectInApp(UA.facebookIos), 'facebook');
  assert.equal(detectInApp(UA.unknownWkWebView), 'other');
  for (const real of [UA.safariIos, UA.chromeIos, UA.chromeAndroid, UA.desktop]) assert.equal(detectInApp(real), 'none', real);
  assert.deepEqual([UA.zaloIos, UA.zaloAndroid, UA.chromeAndroid, UA.desktop].map(detectOs), ['ios', 'android', 'android', 'desktop']);
});
ok('environment: the live camera is only "likely" with a camera API on a secure page', () => {
  const env = (ua: string, hasGetUserMedia: boolean, isSecureContext = true) => detectEnvironment({ ua, hasGetUserMedia, isSecureContext, maxTouchPoints: 5 });
  assert.equal(env(UA.safariIos, true).liveCameraLikely, true);
  assert.equal(env(UA.zaloIos, false).liveCameraLikely, false); assert.equal(env(UA.safariIos, true, false).liveCameraLikely, false);
  assert.equal(env(UA.zaloIos, false).inApp, 'zalo');
});

// ---- formatting -------------------------------------------------------------------------------------------------------------------------------
ok('money: exact decimal strings are formatted, never computed on', () => {
  assert.equal(formatVnd('1250000'), '1.250.000 ₫'); assert.equal(formatVnd('1250000.0000'), '1.250.000 ₫'); assert.equal(formatVnd('1234.5678'), '1.234,5678 ₫');
  assert.equal(formatVnd('0.0000'), '0 ₫'); assert.equal(formatVnd('99999999999999.9999'), '99.999.999.999.999,9999 ₫'); assert.equal(formatVnd(null), '—'); assert.equal(formatVnd('abc'), '—');
  assert.equal(formatRate('0.0500'), '5%'); assert.equal(formatRate('0.125'), '12,5%'); assert.equal(formatRate('0.1000'), '10%'); assert.equal(formatRate('1.0000'), '100%'); assert.equal(formatRate('0.0001'), '0,01%'); assert.equal(formatRate('x'), '—');
});

// ---- decode engine ----------------------------------------------------------------------------------------------------------------------------
function haveFfmpeg() { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } }
type Scene = { s: number; blur?: number; noise?: number; rot?: number; persp?: number; eq?: string; glare?: boolean; bg?: string; W?: number; H?: number };
function render(qr: string, o: Scene): Frame {
  const W = o.W ?? 1280, H = o.H ?? 720, bg = o.bg ?? '0x2b2b2b';
  let f = `[1:v]scale=${o.s}:${o.s}:flags=neighbor`;
  if (o.rot) f += `,rotate=${o.rot}*PI/180:c=${bg}:ow=rotw(${o.rot}*PI/180):oh=roth(${o.rot}*PI/180)`;
  f += '[q];[0:v][q]overlay=(W-w)/2:(H-h)/2';
  if (o.glare) f += ',drawbox=x=0:y=ih/3:w=iw:h=ih/6:color=white@0.45:t=fill';
  if (o.persp) f += `,perspective=x0=0:y0=0:x1=${W}:y1=${o.persp}:x2=0:y2=${H}:x3=${W}:y3=${H - o.persp}:interpolation=linear`;
  if (o.blur) f += `,boxblur=${o.blur}:1`;
  if (o.eq) f += `,eq=${o.eq}`;
  if (o.noise) f += `,noise=alls=${o.noise}:allf=t`;
  f += ',format=rgba';
  const out = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:d=1`, '-i', qr, '-filter_complex', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 });
  return { data: new Uint8ClampedArray(out), width: W, height: H };
}
const CAMERA: Array<[string, Scene]> = [
  ['clean 360px', { s: 360 }], ['clean 240px', { s: 240 }], ['far 160px', { s: 160 }], ['far 120px', { s: 120 }], ['far 90px', { s: 90 }],
  ['blur2 360', { s: 360, blur: 2 }], ['blur2 240', { s: 240, blur: 2 }], ['blur3 240', { s: 240, blur: 3 }], ['noise 240', { s: 240, noise: 28 }],
  ['rot15 360', { s: 360, rot: 15 }], ['rot30 240', { s: 240, rot: 30 }], ['perspective 360', { s: 360, persp: 60 }], ['low contrast 360', { s: 360, eq: 'contrast=0.4:brightness=0.28' }],
  ['glare band 240', { s: 240, glare: true }], ['light background 300', { s: 300, bg: '0xf2f2f2' }], ['blur2+noise+rot10 200', { s: 200, blur: 2, noise: 20, rot: 10 }], ['far 140 + blur1 + persp', { s: 140, blur: 1, persp: 30 }],
];
const PHOTOS: Array<[string, Scene]> = [
  ['12MP photo, QR 900px, sharp', { W: 4032, H: 3024, s: 900, bg: '0x30343a' }], ['12MP photo, QR 700px, blur4', { W: 4032, H: 3024, s: 700, blur: 4, bg: '0x30343a' }],
  ['12MP photo, QR 600px, noise+rot8+persp', { W: 4032, H: 3024, s: 600, noise: 22, rot: 8, persp: 120, bg: '0x30343a' }], ['12MP photo, QR 420px (far), blur3', { W: 4032, H: 3024, s: 420, blur: 3, bg: '0x30343a' }],
  ['screenshot 1170x2532, QR 800px', { W: 1170, H: 2532, s: 800, bg: '0xffffff' }], ['12MP photo, QR 800px, glare+low contrast', { W: 4032, H: 3024, s: 800, glare: true, eq: 'contrast=0.5:brightness=0.2', bg: '0x30343a' }],
];
const FIXTURE = (name: string) => path.join(__dirname, 'fixtures', name);
const PAYLOAD = 'https://vno-web-uat.up.railway.app/c/COL-0123456789ABCDEF';

(async () => {
  if (!haveFfmpeg()) { console.log(`qr selftest: ${checks} pure checks passed; decode matrix SKIPPED (ffmpeg not found)`); return; }
  const engine = await loadEngine({ bundledWasm: false });
  assert.equal(engine.name, 'zxing', 'the WebAssembly engine must load');

  let frames = 0, slowest = 0; const misses: string[] = [];
  for (const [design, file] of [['new screen design (4-module quiet zone, EC M)', 'qr-screen-m4.png'], ['old design (1-module margin, EC H)', 'qr-legacy-h1.png']] as const) {
    let passed = 0;
    for (const [name, scene] of CAMERA) {
      const frame = render(FIXTURE(file), scene); const t = performance.now(); const hit = await decodeFrame(frame); slowest = Math.max(slowest, performance.now() - t); frames += 1;
      if (hit?.text === PAYLOAD) passed += 1; else misses.push(`${design}: ${name}`);
    }
    for (const [name, scene] of PHOTOS) {
      const photo = render(FIXTURE(file), scene); const reduced = downscale(photo, 1600);        // what decodeImageFile does before decoding
      const t = performance.now(); const hit = await decodeFrame(reduced); slowest = Math.max(slowest, performance.now() - t); frames += 1;
      if (hit?.text === PAYLOAD) passed += 1; else misses.push(`${design}: ${name}`);
    }
    console.log(`  ${design}: ${passed}/${CAMERA.length + PHOTOS.length} degraded scenes decoded`);
    assert.equal(passed, CAMERA.length + PHOTOS.length, `every scene must decode for the ${design}; missed: ${misses.join(' | ')}`);
    checks += 1;
  }
  assert.ok(slowest < 800, `no single decode may take long (slowest ${Math.round(slowest)} ms)`); checks += 1;

  // the fallback engine must never stall the page, even on the worst frame (it is only ever handed <= 1000 px)
  const worst = render(FIXTURE('qr-screen-m4.png'), PHOTOS[2][1]); const t = performance.now(); decodeWithJsQr(worst);
  assert.ok(performance.now() - t < 8000, 'fallback engine stays bounded on a 12-megapixel noisy photo'); checks += 1;
  const clean = decodeWithJsQr(render(FIXTURE('qr-screen-m4.png'), CAMERA[0][1])); assert.equal(clean?.text, PAYLOAD); checks += 1;
  console.log(`qr selftest: ${checks} checks passed; ${frames} frames decoded (slowest ${Math.round(slowest)} ms)`);
})().catch((e) => { console.error(e); process.exit(1); });
