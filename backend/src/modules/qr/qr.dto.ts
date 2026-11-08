import { z } from 'zod';

export const ResolveQrSchema = z.object({
  payload: z.string().trim().min(1).max(512),
  /** One id per scan attempt chosen by the phone: a retry or a repeated detection of the SAME scan is counted once. */
  scan_id: z.string().uuid().optional(),
  source: z.enum(['camera', 'upload', 'capture', 'manual']).optional(),
}).strict();

export const ScanSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
  merchant_id: z.string().uuid().optional(),
}).strict();
export type ScanSummaryQuery = z.infer<typeof ScanSummaryQuerySchema>;

export type ResolveQrDto = z.infer<typeof ResolveQrSchema>;
