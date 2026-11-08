/** Camera access for QR scanning, with the fallbacks real phones need. Browser-only. */
export type CameraFailure = 'denied' | 'busy' | 'none' | 'unsupported' | 'insecure' | 'unknown';

export class CameraError extends Error {
  constructor(readonly kind: CameraFailure, readonly errorName: string) { super(kind); this.name = 'CameraError'; }
}

const ATTEMPTS: MediaStreamConstraints[] = [
  { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
  { video: { facingMode: 'environment' }, audio: false },
  { video: true, audio: false },
];

/** Opens the back camera, relaxing the constraints when a device rejects them (OverconstrainedError is common on older iPhones and Android WebViews). */
export async function openCamera(): Promise<MediaStream> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) throw new CameraError('insecure', 'InsecureContext');
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported', 'NoMediaDevices');
  let last: unknown;
  for (const constraints of ATTEMPTS) {
    try { return await navigator.mediaDevices.getUserMedia(constraints); }
    catch (err) {
      last = err; const name = (err as { name?: string })?.name || 'Error';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') throw new CameraError('denied', name);
      if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') throw new CameraError('busy', name);
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') throw new CameraError('none', name);
      // OverconstrainedError / TypeError / anything else: try the next, simpler request
    }
  }
  throw new CameraError('unknown', (last as { name?: string })?.name || 'Error');
}

export function stopStream(stream: MediaStream | null) { stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } }); }

/** Starts playback the way iOS Safari / WKWebView require: muted + playsinline + metadata loaded + a user gesture upstream. */
export async function attachStream(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.muted = true; video.setAttribute('playsinline', 'true'); video.setAttribute('webkit-playsinline', 'true'); video.autoplay = true;
  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    if (video.readyState >= 1) return resolve();
    const done = () => { video.removeEventListener('loadedmetadata', done); resolve(); };
    video.addEventListener('loadedmetadata', done); setTimeout(done, 3000);
  });
  await video.play();
}
