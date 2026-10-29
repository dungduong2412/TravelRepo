const DECIMAL = /^\d+(?:\.\d+)?$/;

function trimDecimal(value: string) {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function fractionToPercentagePoints(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value).trim();
  if (!DECIMAL.test(raw)) throw new Error('Invalid fractional rate');
  const [whole, fraction = ''] = raw.split('.');
  const digits = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const places = Math.max(fraction.length - 2, 0);
  const padded = digits.padStart(places + 1, '0');
  const percentage = places ? `${padded.slice(0, -places)}.${padded.slice(-places)}` : padded;
  return trimDecimal(percentage);
}

export function percentagePointsToFraction(value: string) {
  const raw = value.trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error('Percentage must use at most two decimal places');
  }
  const [whole, fraction = ''] = raw.split('.');
  const pointHundredths = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  if (Number(raw) > 100) throw new Error('Percentage must be between 0 and 100');
  const padded = pointHundredths.padStart(5, '0');
  return `${padded.slice(0, -4)}.${padded.slice(-4)}`;
}
