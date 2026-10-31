// Exact 4-decimal arithmetic with BigInt (round half up), mirroring the server contract.
const SCALE = 10n ** 4n;
export function toUnits(v: string): bigint { const [w, f = ''] = v.split('.'); return BigInt(w) * SCALE + BigInt(f.padEnd(4, '0').slice(0, 4)); }
export function fmt(u: bigint): string { const w = u / SCALE; const f = (u % SCALE).toString().padStart(4, '0'); return `${w}.${f}`; }
// gross × rate where both are 4-decimal strings, result rounded half-up to 4 decimals
export function mul(gross: string, rate: string): string { const p = toUnits(gross) * toUnits(rate); return fmt((p + SCALE / 2n) / SCALE); }
export const eq4 = (a: unknown, b: string) => toUnits(String(a)) === toUnits(b);
