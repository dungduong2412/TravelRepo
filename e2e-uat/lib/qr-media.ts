import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EVIDENCE_DIR } from './env';

/**
 * Test media for QR scanning: phone-camera-like feeds (Chromium fake camera, .y4m) and photos/screenshots, rendered with ffmpeg from a REAL QR image.
 * Scenes model what a camera sees when it points at another phone's screen: distance, blur, sensor noise, tilt, perspective, glare, washed-out contrast.
 * Needs ffmpeg on the machine running the tests (the specs skip the media scenarios, and say so, when it is missing).
 */
export type Scene = { s: number; blur?: number; noise?: number; rot?: number; persp?: number; eq?: string; glare?: boolean; bg?: string; W?: number; H?: number };
export const MEDIA_DIR = path.join(EVIDENCE_DIR, 'qr-media');
export const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function graph(o: Scene, W: number, H: number): { filter: string; bg: string } {
  const bg = o.bg ?? '0x30343a';
  let f = `[1:v]scale=${o.s}:${o.s}:flags=neighbor`;
  if (o.rot) f += `,rotate=${o.rot}*PI/180:c=${bg}:ow=rotw(${o.rot}*PI/180):oh=roth(${o.rot}*PI/180)`;
  f += '[q];[0:v][q]overlay=(W-w)/2:(H-h)/2';
  if (o.glare) f += ',drawbox=x=0:y=ih/3:w=iw:h=ih/6:color=white@0.45:t=fill';
  if (o.persp) f += `,perspective=x0=0:y0=0:x1=${W}:y1=${o.persp}:x2=0:y2=${H}:x3=${W}:y3=${H - o.persp}:interpolation=linear`;
  if (o.blur) f += `,boxblur=${o.blur}:1`;
  if (o.eq) f += `,eq=${o.eq}`;
  if (o.noise) f += `,noise=alls=${o.noise}:allf=t`;
  return { filter: f, bg };
}

/** A looping camera feed (Y4M) for Chromium's fake video device. */
export function makeFeed(qrPng: string, name: string, scene: Scene, seconds = 4, fps = 10): string {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const out = path.join(MEDIA_DIR, `${name}.y4m`); const W = scene.W ?? 1280, H = scene.H ?? 720; const { filter, bg } = graph(scene, W, H);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:d=${seconds}:r=${fps}`, '-i', qrPng, '-filter_complex', `${filter},format=yuv420p`, '-f', 'yuv4mpegpipe', out]);
  return out;
}

/** A still photo / screenshot (JPEG or PNG by extension) — e.g. a 12-megapixel iPhone photo of another phone's screen. */
export function makePhoto(qrPng: string, name: string, scene: Scene): string {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const out = path.join(MEDIA_DIR, name); const W = scene.W ?? 4032, H = scene.H ?? 3024; const { filter, bg } = graph(scene, W, H);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:d=1`, '-i', qrPng, '-filter_complex', filter, '-frames:v', '1', out]);
  return out;
}

/** Any QR image for negative cases (a non-VNO QR, an unknown code, an old-design Partner QR), via the backend's own QR library. */
export async function writeQrPng(payload: string, name: string, opts: { margin?: number; ec?: 'L' | 'M' | 'Q' | 'H'; width?: number } = {}): Promise<string> {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const QR = require('../../backend/node_modules/qrcode');
  const out = path.join(MEDIA_DIR, name);
  fs.writeFileSync(out, Buffer.from((await QR.toDataURL(payload, { errorCorrectionLevel: opts.ec ?? 'M', margin: opts.margin ?? 4, width: opts.width ?? 720, type: 'image/png' })).split(',')[1], 'base64'));
  return out;
}

export function fakeCameraArgs(feed: string) { return ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${feed}`]; }
export const IPHONE_ZALO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo/24.03.1';
export const LONGTASK_PROBE = `window.__lt=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push(Math.round(e.duration))}).observe({entryTypes:['longtask']})}catch(e){}`;
