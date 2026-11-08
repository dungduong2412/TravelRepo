"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, ScanLine } from 'lucide-react';
import { decodeFrame, loadEngine } from '../lib/qr/engine';
import { attachStream, CameraError, openCamera, stopStream } from '../lib/qr/camera';
import { decodeImageFile } from '../lib/qr/image';
import { currentEnvironment, IN_APP_LABEL, QrEnvironment } from '../lib/qr/environment';
import { logQrEvent, safeToken } from '../lib/qr/diagnostics';

export type ScanSource = 'camera' | 'upload' | 'capture';
type Phase = 'idle' | 'starting' | 'scanning' | 'paused' | 'error' | 'done';
type Props = { onDecode: (payload: string, source: ScanSource) => void; busy?: boolean; scanId: string };

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const FRAME_MAX_SIDE = 960;   // a camera frame is reduced before decoding: faster, and plenty for a QR held a normal distance away
const TICK_MS = 120;

/**
 * QR scanner for a Merchant's phone: live camera, "take a photo" (the phone's own camera app — this works inside in-app browsers such as Zalo where the
 * live camera is often blocked), and "upload an image". It decodes with ZXing (see lib/qr/engine.ts), keeps the camera lifecycle honest (stopped on
 * leaving the page or the app, restartable, one result per scan), and never leaves a dead end: every failure says what to do next.
 * It only produces a decoded string; whoever uses it decides what to do (here: look the Partner up — scanning creates nothing).
 */
export default function QrScanner({ onDecode, busy = false, scanId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);
  const decodingRef = useRef(false);
  const busyRef = useRef(busy);
  const lastHit = useRef<{ text: string; at: number } | null>(null);
  const startedAt = useRef(0);
  const [env, setEnv] = useState<QrEnvironment | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [errorName, setErrorName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [slowHint, setSlowHint] = useState(false);
  const [engine, setEngine] = useState<string>('…');
  const [copied, setCopied] = useState(false);

  useEffect(() => { busyRef.current = busy; }, [busy]);

  const stop = useCallback(() => {
    scanningRef.current = false;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    stopStream(streamRef.current); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Environment + engine warm-up (the WebAssembly file loads now, so the first scan is instant).
  useEffect(() => {
    const e = currentEnvironment(); setEnv(e);
    logQrEvent(scanId, 'page_open', { inapp: e.inApp, os: e.os });
    logQrEvent(scanId, 'camera_support', { inapp: e.inApp, os: e.os, secure: e.secure, media: e.cameraApi });
    if (e.inApp !== 'none' || !e.liveCameraLikely) logQrEvent(scanId, 'fallback_shown', { inapp: e.inApp, media: e.cameraApi, secure: e.secure });
    loadEngine().then((r) => { setEngine(r.name); logQrEvent(scanId, r.name === 'zxing' ? 'engine_ready' : 'engine_failed', { engine: r.name }); });
    return () => stop();
  }, [scanId, stop]);

  // Leaving the page or the app releases the camera; it is restarted only by the person (iOS requires a tap anyway).
  useEffect(() => {
    const release = () => { if (scanningRef.current) { stop(); setPhase('paused'); setMessage('Camera đã tạm dừng khi bạn rời khỏi trang. Bấm “Mở camera” để quét tiếp.'); logQrEvent(scanId, 'camera_stopped'); } };
    const onVisibility = () => { if (document.visibilityState === 'hidden') release(); };
    document.addEventListener('visibilitychange', onVisibility); window.addEventListener('pagehide', release);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', release); };
  }, [scanId, stop]);

  const deliver = useCallback((text: string, source: ScanSource, engineName?: 'zxing' | 'jsqr', ms?: number) => {
    const now = Date.now();
    if (lastHit.current && lastHit.current.text === text && now - lastHit.current.at < 3000) return; // one code is reported once, however many frames show it
    lastHit.current = { text, at: now };
    stop(); setPhase('done'); setMessage(null);
    logQrEvent(scanId, source === 'camera' ? 'decode_ok' : 'upload_decoded', { source, engine: engineName, ms });
    onDecode(text, source);
  }, [onDecode, scanId, stop]);

  const tick = useCallback(async () => {
    if (!scanningRef.current) return;
    const video = videoRef.current; const canvas = canvasRef.current;
    if (video && canvas && video.readyState >= 2 && video.videoWidth > 0 && !decodingRef.current && !busyRef.current) {
      decodingRef.current = true;
      try {
        const k = Math.min(1, FRAME_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.max(1, Math.round(video.videoWidth * k)); const h = Math.max(1, Math.round(video.videoHeight * k));
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          const image = ctx.getImageData(0, 0, w, h);
          const hit = await decodeFrame({ data: image.data, width: w, height: h }, image);
          if (hit && scanningRef.current) { deliver(hit.text, 'camera', hit.engine, hit.ms); decodingRef.current = false; return; }
        }
      } catch { /* a bad frame never stops the loop */ }
      decodingRef.current = false;
    }
    if (Date.now() - startedAt.current > 9000) setSlowHint(true);
    if (scanningRef.current) timerRef.current = setTimeout(tick, TICK_MS);
  }, [deliver]);

  async function startCamera() {
    stop(); setMessage(null); setErrorName(null); setSlowHint(false); setPhase('starting');
    logQrEvent(scanId, 'camera_start', { source: 'camera' });
    try {
      const stream = await openCamera();
      streamRef.current = stream;
      const video = videoRef.current; if (!video) { stopStream(stream); return; }
      await attachStream(video, stream);
      startedAt.current = Date.now(); scanningRef.current = true; setPhase('scanning');
      logQrEvent(scanId, 'camera_started');
      timerRef.current = setTimeout(tick, TICK_MS);
    } catch (err) {
      stop();
      const kind = err instanceof CameraError ? err.kind : 'unknown'; const name = err instanceof CameraError ? err.errorName : (err as { name?: string })?.name || 'Error';
      setErrorName(name); setPhase('error');
      logQrEvent(scanId, 'camera_error', { err: safeToken(name), inapp: env?.inApp });
      setMessage(
        kind === 'denied' ? (env && env.inApp !== 'none'
          ? `Ứng dụng ${IN_APP_LABEL[env.inApp as Exclude<typeof env.inApp, 'none'>]} không cho trang web dùng camera. Hãy bấm “Chụp ảnh mã QR” bên dưới, hoặc mở liên kết này bằng Safari/Chrome.`
          : 'Trình duyệt chưa được cấp quyền camera. Hãy cho phép camera cho trang này (biểu tượng ổ khóa / aA trên thanh địa chỉ), rồi bấm “Mở camera” lại — hoặc dùng “Chụp ảnh mã QR”.')
        : kind === 'busy' ? 'Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi bấm “Mở camera” lại — hoặc dùng “Chụp ảnh mã QR”.'
        : kind === 'none' ? 'Không tìm thấy camera trên thiết bị này. Hãy dùng “Tải ảnh QR lên” hoặc nhập mã thủ công.'
        : kind === 'insecure' ? 'Trang chưa chạy qua HTTPS nên trình duyệt chặn camera. Hãy dùng “Chụp ảnh mã QR”.'
        : 'Không mở được camera trực tiếp trên thiết bị này. Hãy dùng “Chụp ảnh mã QR” hoặc “Tải ảnh QR lên”.');
    }
  }

  async function handleFile(source: 'upload' | 'capture', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || busy) return;
    setMessage(null); setErrorName(null);
    if (file.size > MAX_FILE_BYTES) { setMessage('Ảnh quá lớn (trên 40 MB). Hãy chụp lại hoặc chọn ảnh nhỏ hơn.'); logQrEvent(scanId, 'upload_failed', { source, err: 'TooLarge' }); return; }
    stop(); setReading(true); setPhase('idle');
    logQrEvent(scanId, 'upload_selected', { source });
    try {
      const result = await decodeImageFile(file);
      if (result.outcome) { deliver(result.outcome.text, source, result.outcome.engine, result.ms); return; }
      logQrEvent(scanId, 'upload_failed', { source, err: result.reason === 'unreadable' ? 'Unreadable' : 'NoCode', w: result.width, h: result.height, n: result.attempts, ms: result.ms });
      setMessage(result.reason === 'unreadable'
        ? 'Không đọc được tệp ảnh này. Hãy dùng ảnh JPEG hoặc PNG (ảnh chụp bằng camera điện thoại cũng được).'
        : 'Chưa tìm thấy mã QR trong ảnh. Hãy chụp lại: để cả mã QR nằm trọn trong khung, giữ máy ổn định, tăng độ sáng màn hình của máy kia — hoặc nhập mã thủ công.');
    } catch {
      logQrEvent(scanId, 'upload_failed', { source, err: 'Exception' });
      setMessage('Không thể xử lý ảnh này. Hãy thử lại với ảnh khác hoặc nhập mã thủ công.');
    } finally { setReading(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setMessage('Không sao chép được. Hãy mở menu của ứng dụng (⋯) và chọn “Mở bằng trình duyệt”.'); }
  }

  const inApp = env?.inApp && env.inApp !== 'none' ? env.inApp : null;
  const liveLikely = env?.liveCameraLikely ?? true;
  const showGuide = Boolean(env) && (Boolean(inApp) || !liveLikely || phase === 'error');
  const working = phase === 'starting' || reading;

  const cameraBtn = (primary: boolean) => (
    <button type="button" onClick={startCamera} disabled={working || busy} data-testid="scanner-open-camera"
      className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 font-semibold ${primary ? 'bg-slate-800 text-white' : 'border border-slate-300 bg-white text-slate-700'} disabled:opacity-60`}>
      <Camera aria-hidden="true" className="size-5" />{phase === 'scanning' ? 'Mở lại camera' : primary ? 'Mở camera quét QR' : 'Thử mở camera trực tiếp'}
    </button>
  );
  const captureBtn = (primary: boolean) => (
    <label className={`flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-5 font-semibold ${primary ? 'bg-slate-800 text-white' : 'border border-slate-300 bg-white text-slate-700'} ${working || busy ? 'pointer-events-none opacity-60' : ''}`}>
      <ScanLine aria-hidden="true" className="size-5" />Chụp ảnh mã QR
      <input type="file" accept="image/*" capture="environment" className="sr-only" data-testid="qr-file-capture" onChange={(e) => handleFile('capture', e)} />
    </label>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-testid="qr-scanner" data-phase={phase}>
      <div className="relative bg-black" style={{ aspectRatio: '4/3' }}>
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay style={{ display: phase === 'scanning' ? 'block' : 'none' }} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {phase === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-52 w-52">
              <span className="absolute left-0 top-0 h-7 w-7 rounded-tl-md border-l-[3px] border-t-[3px] border-white" /><span className="absolute right-0 top-0 h-7 w-7 rounded-tr-md border-r-[3px] border-t-[3px] border-white" />
              <span className="absolute bottom-0 left-0 h-7 w-7 rounded-bl-md border-b-[3px] border-l-[3px] border-white" /><span className="absolute bottom-0 right-0 h-7 w-7 rounded-br-md border-b-[3px] border-r-[3px] border-white" />
            </div>
            <p className="absolute bottom-4 px-4 text-center text-xs text-white/90">{slowHint ? 'Chưa đọc được? Đưa máy lại gần hơn, giữ ổn định và tăng độ sáng màn hình của máy kia.' : 'Hướng camera vào mã QR của Đối tác'}</p>
          </div>
        )}
        {phase !== 'scanning' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white/85">
            <Camera aria-hidden="true" className="size-12 opacity-50" />
            <p className="text-sm" data-testid="scanner-status" role="status" aria-live="polite">
              {phase === 'starting' ? 'Đang mở camera…' : reading ? 'Đang đọc ảnh…' : phase === 'done' ? 'Đã đọc mã QR' : phase === 'paused' ? 'Camera đã tạm dừng' : phase === 'error' ? 'Không mở được camera trực tiếp' : 'Sẵn sàng quét mã QR của Đối tác'}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 p-4">
        {showGuide && (
          <div role="note" data-testid="scanner-inapp-notice" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">{inApp ? `Bạn đang mở trang trong ${IN_APP_LABEL[inApp as Exclude<typeof inApp, null>]}` : 'Camera trực tiếp có thể không dùng được ở đây'}</p>
            <p className="mt-1">Cách nhanh nhất: bấm <b>Chụp ảnh mã QR</b> (mở camera của điện thoại) hoặc <b>Tải ảnh QR lên</b>. Muốn quét trực tiếp: mở trang này bằng <b>Safari</b> hoặc <b>Chrome</b> (menu ⋯ → “Mở bằng trình duyệt”).</p>
            <button type="button" onClick={copyLink} className="mt-2 min-h-10 rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900">{copied ? 'Đã sao chép liên kết' : 'Sao chép liên kết trang này'}</button>
          </div>
        )}

        {message && <p role="alert" data-testid="scanner-error" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{message}</p>}

        {liveLikely ? <>{cameraBtn(true)}{captureBtn(false)}</> : <>{captureBtn(true)}{env?.cameraApi ? cameraBtn(false) : null}</>}
        <label className={`flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 ${working || busy ? 'pointer-events-none opacity-60' : ''}`}>
          <ImagePlus aria-hidden="true" className="size-4" />Tải ảnh QR lên
          <input type="file" accept="image/*" className="sr-only" data-testid="qr-file-upload" onChange={(e) => handleFile('upload', e)} />
        </label>
        {phase === 'scanning' && <button type="button" onClick={() => { stop(); setPhase('idle'); logQrEvent(scanId, 'camera_stopped'); }} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700" data-testid="scanner-close-camera">Đóng camera</button>}

        <details className="text-xs text-slate-500" data-testid="scanner-diagnostics">
          <summary className="cursor-pointer select-none py-1">Thông tin kỹ thuật (gửi cho quản trị viên nếu không quét được)</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt>Hệ điều hành</dt><dd>{env?.os ?? '…'}</dd><dt>Ứng dụng nhúng</dt><dd>{env ? (env.inApp === 'none' ? 'không' : env.inApp) : '…'}</dd>
            <dt>Kết nối an toàn (HTTPS)</dt><dd>{env ? (env.secure ? 'có' : 'không') : '…'}</dd><dt>API camera</dt><dd>{env ? (env.cameraApi ? 'có' : 'không') : '…'}</dd>
            <dt>Bộ giải mã</dt><dd>{engine}</dd><dt>Lỗi camera gần nhất</dt><dd>{errorName ?? '—'}</dd><dt>Mã phiên</dt><dd className="font-mono">{scanId}</dd>
          </dl>
        </details>
      </div>
    </div>
  );
}
