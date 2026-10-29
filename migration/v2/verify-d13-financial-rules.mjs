#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const source = process.argv[2];
if (!source) {
  throw new Error('Usage: node verify-d13-financial-rules.mjs <RestaurantComTrack.jsonl>');
}

function scaled(value, scale) {
  const text = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Invalid decimal value: ${text}`);
  const fraction = (match[3] || '').padEnd(scale, '0').slice(0, scale);
  const magnitude = BigInt(match[2]) * (10n ** BigInt(scale)) + BigInt(fraction || '0');
  return match[1] === '-' ? -magnitude : magnitude;
}

function roundProductToFour(amount, rate) {
  const product = scaled(amount, 4) * scaled(rate, 4);
  const divisor = 10_000n;
  const sign = product < 0n ? -1n : 1n;
  const magnitude = product < 0n ? -product : product;
  return sign * ((magnitude + divisor / 2n) / divisor);
}

function format(value) {
  const sign = value < 0n ? '-' : '';
  const magnitude = value < 0n ? -value : value;
  const integer = magnitude / 10_000n;
  const fraction = String(magnitude % 10_000n).padStart(4, '0');
  return `${sign}${integer}.${fraction}`;
}

const statusCounts = new Map();
const discountRateCounts = new Map();
const commissionRateCounts = new Map();
let rows = 0;
let discountFormulaMatches = 0;
let commissionGrossMatches = 0;
let commissionNetMatches = 0;
let documentTotal = 0n;
let discountTotal = 0n;
let commissionTotal = 0n;

const input = createInterface({ input: createReadStream(source), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  rows += 1;
  const status = String(row.Status);
  const discountRate = String(row.DocDiscountPerc);
  const commissionRate = String(row.CommissionPer);
  statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  discountRateCounts.set(discountRate, (discountRateCounts.get(discountRate) || 0) + 1);
  commissionRateCounts.set(commissionRate, (commissionRateCounts.get(commissionRate) || 0) + 1);

  const total = scaled(row.DocTotal, 4);
  const discount = scaled(row.DocDiscountAmt, 4);
  const commission = scaled(row.CommissionAmt, 4);
  documentTotal += total;
  discountTotal += discount;
  commissionTotal += commission;

  if (roundProductToFour(row.DocTotal, row.DocDiscountPerc) === discount) discountFormulaMatches += 1;
  if (roundProductToFour(row.DocTotal, row.CommissionPer) === commission) commissionGrossMatches += 1;
  if (roundProductToFour(format(total - discount), row.CommissionPer) === commission) commissionNetMatches += 1;
}

const ordered = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => Number(a) - Number(b)));
console.log(JSON.stringify({
  rows,
  status_counts: ordered(statusCounts),
  totals: {
    document: format(documentTotal),
    discount: format(discountTotal),
    commission: format(commissionTotal),
  },
  exact_formula_matches: {
    discount_equals_document_times_source_rate: discountFormulaMatches,
    commission_equals_document_times_source_rate: commissionGrossMatches,
    commission_equals_net_after_discount_times_source_rate: commissionNetMatches,
  },
  source_rate_distributions: {
    discount: ordered(discountRateCounts),
    commission: ordered(commissionRateCounts),
  },
}, null, 2));
