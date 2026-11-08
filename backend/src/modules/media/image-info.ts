/**
 * Reads the pixel size of a JPEG / PNG / WebP from its header (no decoding, no dependency). Used to reject files that carry the right magic bytes but are
 * truncated, corrupt or degenerate (0x0, 1x1) — a signature check alone accepts those. Returns null when the structure cannot be understood.
 */
export type ImageSize = { width: number; height: number };

export const MIN_IMAGE_SIDE = 32;
export const MAX_IMAGE_SIDE = 12_000;

export function readImageDimensions(bytes: Buffer, mimeType: string): ImageSize | null {
  try {
    if (mimeType === 'image/png') {
      // signature (8) + IHDR chunk: length(4) 'IHDR'(4) width(4) height(4)
      if (bytes.length < 24 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mimeType === 'image/jpeg') {
      let i = 2; // after SOI
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i += 1; continue; }
        const marker = bytes[i + 1];
        if (marker === 0xff) { i += 1; continue; }                       // fill byte
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // standalone markers
        const length = bytes.readUInt16BE(i + 2);
        if (length < 2) return null;
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
        i += 2 + length;
      }
      return null;
    }
    if (mimeType === 'image/webp') {
      const kind = bytes.subarray(12, 16).toString('ascii');
      if (kind === 'VP8 ') { // lossy: frame tag(3) start code 9d 01 2a, then 14-bit width / height
        if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
        return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      }
      if (kind === 'VP8L') { // lossless: signature 0x2f then 14+14 bits
        if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
        const bits = bytes.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (kind === 'VP8X') { // extended: 24-bit (width-1), 24-bit (height-1)
        if (bytes.length < 30) return null;
        return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
      }
      return null;
    }
  } catch { return null; }
  return null;
}
