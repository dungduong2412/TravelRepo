import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { z } from 'zod';

const FLOWS = ['recovery', 'signup_confirm', 'recovery_request'] as const;
const STAGES = [
  'page_load', 'token_present', 'token_missing', 'hash_error', 'legacy_recovery_event',
  'verify_start', 'verify_ok', 'verify_failed', 'update_start', 'update_ok', 'update_failed',
  'request_start', 'request_ok', 'request_failed',
] as const;

// Closed vocabulary only: the browser can never smuggle free text, tokens, e-mails or URLs into server logs.
const EventSchema = z.object({
  evt: z.literal('auth_flow'),
  cid: z.string().regex(/^[a-f0-9]{12}$/),
  flow: z.enum(FLOWS),
  stage: z.enum(STAGES),
  code: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
}).strict();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

@Controller('auth')
export class AuthDiagnosticsController {
  private readonly log = new Logger('AuthDiagnostics');
  private readonly hits = new Map<string, { start: number; count: number }>();

  private allow(ip: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(ip);
    if (!entry || now - entry.start > WINDOW_MS) {
      if (this.hits.size > 5000) this.hits.clear();
      this.hits.set(ip, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= MAX_PER_WINDOW;
  }

  @Post('diagnostics')
  @HttpCode(204)
  record(@Body() body: unknown, @Req() req: any) {
    const ip = String(req.headers?.['x-forwarded-for'] ?? req.ip ?? 'unknown').split(',')[0].trim();
    if (!this.allow(ip)) return;
    const parsed = EventSchema.safeParse(body);
    if (!parsed.success) return;
    const { cid, flow, stage, code } = parsed.data;
    this.log.log(`auth_flow cid=${cid} flow=${flow} stage=${stage}${code ? ` code=${code}` : ''}`);
  }
}
