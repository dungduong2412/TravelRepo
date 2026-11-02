/** express.json `verify` callback: keeps the exact request bytes ONLY for /auth/hooks/* (Standard Webhooks signature verification). */
export function captureHookRawBody(req: any, _res: unknown, buf: Buffer): void {
  if (String(req.originalUrl || req.url).startsWith('/auth/hooks/')) req.rawBody = buf;
}
