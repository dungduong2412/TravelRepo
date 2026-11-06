"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';

type ScannerState = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'scanned';

type Props = {
  onDecode: (payload: string) => void;
};

export default function QrCameraScanner({ onDecode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<ScannerState>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  async function startCamera() {
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setState('active');
      scan();
    } catch (err: any) {
      setState(
        err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' ? 'denied' : 'unavailable',
      );
    }
  }

  function scan() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (video.readyState < video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scan);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
    if (result?.data) {
      stopCamera();
      setState('scanned');
      onDecode(result.data);
      return;
    }
    rafRef.current = requestAnimationFrame(scan);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(image.data, image.width, image.height);
      if (result?.data) {
        onDecode(result.data);
      } else {
        setUploadError('Không tìm thấy mã QR trong ảnh. Vui lòng thử ảnh khác hoặc nhập mã thủ công.');
      }
    } catch {
      setUploadError('Không thể đọc ảnh. Vui lòng thử định dạng khác (JPEG, PNG, WebP).');
    } finally {
      e.target.value = '';
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Viewfinder */}
      <div className="relative bg-black" style={{ aspectRatio: '4/3' }}>
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          style={{ display: state === 'active' ? 'block' : 'none' }}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {state === 'active' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative h-52 w-52">
              <span className="absolute top-0 left-0 h-7 w-7 border-t-[3px] border-l-[3px] border-white rounded-tl-md" />
              <span className="absolute top-0 right-0 h-7 w-7 border-t-[3px] border-r-[3px] border-white rounded-tr-md" />
              <span className="absolute bottom-0 left-0 h-7 w-7 border-b-[3px] border-l-[3px] border-white rounded-bl-md" />
              <span className="absolute bottom-0 right-0 h-7 w-7 border-b-[3px] border-r-[3px] border-white rounded-br-md" />
              <span className="absolute inset-0 border border-white/20 rounded-md" />
            </div>
            <p className="absolute bottom-5 text-xs text-white/80">Hướng camera vào mã QR của Đối tác</p>
          </div>
        )}

        {(state === 'idle' || state === 'requesting') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <svg className="h-14 w-14 opacity-50" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
            </svg>
            <p className="text-sm">
              {state === 'requesting' ? 'Đang yêu cầu quyền truy cập camera…' : 'Camera chưa mở'}
            </p>
          </div>
        )}

        {state === 'denied' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-white text-center">
            <span className="text-3xl">🚫</span>
            <p className="text-sm">Không có quyền truy cập camera. Vui lòng cấp quyền trong cài đặt trình duyệt.</p>
          </div>
        )}

        {state === 'unavailable' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-white text-center">
            <span className="text-3xl">📵</span>
            <p className="text-sm">Camera không khả dụng. Vui lòng tải ảnh QR lên hoặc nhập mã thủ công.</p>
          </div>
        )}

        {state === 'scanned' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-emerald-900/80 text-white">
            <span className="text-4xl">✓</span>
            <p className="text-sm font-semibold">Đã quét thành công</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-4 space-y-2">
        {state === 'idle' && (
          <button
            type="button"
            onClick={startCamera}
            className="min-h-12 w-full rounded-xl bg-slate-800 px-5 font-semibold text-white active:opacity-80"
          >
            📷 Mở camera quét QR
          </button>
        )}
        {state === 'requesting' && (
          <div className="min-h-12 w-full flex items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-500">
            Đang khởi động camera…
          </div>
        )}
        {state === 'active' && (
          <button
            type="button"
            onClick={() => { stopCamera(); setState('idle'); }}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-5 font-semibold text-slate-700 active:opacity-80"
          >
            Đóng camera
          </button>
        )}
        {(state === 'denied' || state === 'unavailable') && (
          <button
            type="button"
            onClick={() => setState('idle')}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-5 font-semibold text-slate-700"
          >
            Thử lại
          </button>
        )}

        <label className="flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
          📁 Tải ảnh QR lên
          <input type="file" accept="image/*" className="sr-only" onChange={handleFileUpload} />
        </label>
        {uploadError && <p className="text-xs text-rose-700 mt-1">{uploadError}</p>}
      </div>
    </div>
  );
}
