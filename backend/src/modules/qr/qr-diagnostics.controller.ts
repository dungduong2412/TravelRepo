import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator';
import { SlidingWindowLimiter, clientIp } from '../../common/http/rate-limiter';

// Closed vocabulary only: the browser can never put free text, codes, URLs, e-mail addresses or tokens into the server log.
const EVENTS = [
  'page_open', 'camera_support', 'camera_start', 'camera_started', 'camera_error', 'camera_stopped', 'decode_ok', 'decode_fail',
  'upload_selected', 'upload_decoded', 'upload_failed', 'resolve_ok', 'resolve_error', 'fallback_shown', 'manual_submit', 'engine_ready', 'engine_failed',
] as const;
const EventSchema = z.object({
  evt: z.literal('qr_scan'),
  cid: z.string().regex(/^[a-f0-9]{12}$/),
  event: z.enum(EVENTS),
  source: z.enum(['camera', 'upload', 'capture', 'manual']).optional(),
  inapp: z.enum(['none', 'zalo', 'facebook', 'instagram', 'line', 'wechat', 'tiktok', 'other']).optional(),
  os: z.enum(['ios', 'android', 'desktop', 'other']).optional(),
  secure: z.boolean().optional(),
  media: z.boolean().optional(),
  err: z.string().regex(/^[A-Za-z0-9_]{1,40}$/).optional(),
  engine: z.enum(['zxing', 'jsqr']).optional(),
  ms: z.number().int().min(0).max(600_000).optional(),
  w: z.number().int().min(0).max(20_000).optional(),
  h: z.number().int().min(0).max(20_000).optional(),
  n: z.number().int().min(0).max(100_000).optional(),
  code: z.string().regex(/^[A-Z_]{1,40}$/).optional(),
}).strict();

/**
 * Scanner telemetry from the Merchant's phone, so a camera problem on a device nobody can hold (an in-app browser, an old iPhone) can be read from
 * the server log. No identity, no payload, no image ever leaves the device through this route.
 */
@Controller('qr')
export class QrDiagnosticsController {
  private readonly log = new Logger('QrScan');
  private readonly limiter = new SlidingWindowLimiter(120, 60_000);

  @Public()
  @Post('diagnostics')
  @HttpCode(204)
  record(@Body() body: unknown, @Req() req: any) {
    if (!this.limiter.take(clientIp(req))) return;
    const parsed = EventSchema.safeParse(body);
    if (!parsed.success) return;
    const { evt: _evt, cid, event, ...rest } = parsed.data;
    const fields = Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' ');
    this.log.log(`qr_scan cid=${cid} event=${event}${fields ? ` ${fields}` : ''}`);
  }
}
