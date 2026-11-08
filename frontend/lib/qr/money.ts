/** Display helpers for the payment step. Amounts arrive as exact decimal STRINGS from the API ("1234.5678"); they are formatted, never computed on, here. */
export function formatVnd(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return '—';
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimals = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${grouped}${decimals ? `,${decimals}` : ''} ₫`;
}

/** "0.0500" -> "5%", "0.125" -> "12,5%". */
export function formatRate(fraction: string | number | null | undefined): string {
  if (fraction === null || fraction === undefined || fraction === '') return '—';
  const raw = String(fraction).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return '—';
  const [whole, frac = ''] = raw.split('.');
  const digits = `${whole}${frac.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const places = Math.max(frac.length - 2, 0);
  const padded = digits.padStart(places + 1, '0');
  const pct = places ? `${padded.slice(0, -places)}.${padded.slice(-places)}` : padded;
  const trimmed = pct.includes('.') ? pct.replace(/0+$/, '').replace(/\.$/, '') : pct;
  return `${trimmed.replace('.', ',')}%`;
}
