import * as nodemailer from 'nodemailer';

/**
 * Provider-neutral SMTP settings for the existing VNO e-mail service (any standard SMTP submission endpoint: STARTTLS on 587, implicit TLS on 465,
 * or a provider-specific port such as 2525 with an explicit mode). Nothing here is provider specific and nothing is guessed: a missing or
 * contradictory value is a configuration error that keeps delivery off, never a silent default.
 *
 *   SMTP_HOST           required
 *   SMTP_PORT           optional when SMTP_SECURITY is set (587 for starttls, 465 for tls)
 *   SMTP_SECURITY       starttls | tls | plain   (optional only for ports 587 / 465; "plain" is accepted for loopback hosts only)
 *   SMTP_AUTH           optional: "none" for an IP-allowlisted relay that takes no credentials; otherwise SMTP_USER and SMTP_PASS are required
 *   SMTP_USER / SMTP_PASS
 *   SMTP_FROM           required: "no-reply@uat.example.org" or "VNO UAT <no-reply@uat.example.org>"
 *   SMTP_FROM_NAME      optional display name (overrides the name inside SMTP_FROM)
 *   SMTP_REPLY_TO       optional
 *   SMTP_TLS_SERVERNAME optional: certificate name to verify when HOST is an IP or an alias
 *   SMTP_TIMEOUT_MS     optional, 1000-4000 (default 3000): Supabase Auth abandons a hook call after ~5 s
 * Certificates are always verified (TLS >= 1.2); there is deliberately no switch to disable verification.
 */
export class SmtpConfigError extends Error {}

export type SmtpSecurity = 'starttls' | 'tls' | 'plain';
export type SmtpSettings = {
  host: string; port: number; security: SmtpSecurity; user?: string; pass?: string;
  from: { name?: string; address: string }; replyTo?: string; tlsServername?: string; timeoutMs: number;
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export function parseFrom(raw: string, nameOverride?: string): { name?: string; address: string } {
  const m = raw.trim().match(/^(?:"?([^"<]*?)"?\s*)?<([^<>]+)>$/);
  const address = (m ? m[2] : raw).trim();
  if (!ADDRESS.test(address)) throw new SmtpConfigError('SMTP_FROM is not a valid sender address');
  const name = (nameOverride?.trim() || m?.[1]?.trim() || undefined)?.replace(/[\r\n]/g, ' ');
  return { name, address };
}

export function readSmtpSettings(env: NodeJS.ProcessEnv = process.env): SmtpSettings {
  const host = (env.SMTP_HOST || '').trim();
  if (!host) throw new SmtpConfigError('SMTP_HOST is not set');
  if (!env.SMTP_FROM) throw new SmtpConfigError('SMTP_FROM is not set');

  const declared = (env.SMTP_SECURITY || '').trim().toLowerCase();
  if (declared && !['starttls', 'tls', 'plain'].includes(declared)) throw new SmtpConfigError('SMTP_SECURITY must be starttls, tls or plain');
  const rawPort = (env.SMTP_PORT || '').trim();
  if (rawPort && !/^\d{1,5}$/.test(rawPort)) throw new SmtpConfigError('SMTP_PORT must be a port number');
  let port = rawPort ? Number(rawPort) : 0;
  if (rawPort && (port < 1 || port > 65535)) throw new SmtpConfigError('SMTP_PORT is out of range');
  let security = declared as SmtpSecurity | '';
  if (!security) {
    if (!port) throw new SmtpConfigError('Set SMTP_SECURITY (starttls | tls) and SMTP_PORT as given by the provider');
    if (port === 587) security = 'starttls';
    else if (port === 465) security = 'tls';
    else throw new SmtpConfigError(`SMTP_SECURITY must be set explicitly for port ${port}`);
  }
  if (!port) port = security === 'tls' ? 465 : security === 'starttls' ? 587 : 25;
  if (security === 'plain' && !LOOPBACK.has(host.toLowerCase())) throw new SmtpConfigError('SMTP_SECURITY=plain is accepted for loopback hosts only; production credentials never travel unencrypted');
  if (security === 'starttls' && port === 465) throw new SmtpConfigError('Port 465 is implicit TLS: use SMTP_SECURITY=tls');
  if (security === 'tls' && port === 587) throw new SmtpConfigError('Port 587 is STARTTLS: use SMTP_SECURITY=starttls');

  const noAuth = (env.SMTP_AUTH || '').trim().toLowerCase() === 'none';
  if (!noAuth && (!env.SMTP_USER || !env.SMTP_PASS)) throw new SmtpConfigError('SMTP_USER and SMTP_PASS are required (or SMTP_AUTH=none for a credential-less relay)');
  if (noAuth && security !== 'plain' && (env.SMTP_USER || env.SMTP_PASS)) throw new SmtpConfigError('SMTP_AUTH=none contradicts SMTP_USER / SMTP_PASS');

  const timeoutMs = env.SMTP_TIMEOUT_MS ? Number(env.SMTP_TIMEOUT_MS) : 3000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 4000) throw new SmtpConfigError('SMTP_TIMEOUT_MS must be between 1000 and 4000');
  const replyTo = env.SMTP_REPLY_TO?.trim() || undefined;
  if (replyTo && !ADDRESS.test(replyTo)) throw new SmtpConfigError('SMTP_REPLY_TO is not a valid address');

  return {
    host, port, security: security as SmtpSecurity, user: noAuth ? undefined : env.SMTP_USER, pass: noAuth ? undefined : env.SMTP_PASS,
    from: parseFrom(env.SMTP_FROM, env.SMTP_FROM_NAME), replyTo, tlsServername: env.SMTP_TLS_SERVERNAME?.trim() || undefined, timeoutMs,
  };
}

export function createSmtpTransport(s: SmtpSettings) {
  return nodemailer.createTransport({
    host: s.host, port: s.port,
    secure: s.security === 'tls',
    requireTLS: s.security === 'starttls', // never downgrade to plain text if the server does not offer STARTTLS
    ignoreTLS: s.security === 'plain',
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, ...(s.tlsServername ? { servername: s.tlsServername } : {}) },
    connectionTimeout: s.timeoutMs, greetingTimeout: s.timeoutMs, socketTimeout: s.timeoutMs + 1000,
    disableFileAccess: true, disableUrlAccess: true,
  });
}

/** Safe-to-log description: no password, user name reduced to its first character. */
export function describeSmtp(s: SmtpSettings): string {
  return `${s.host}:${s.port} ${s.security} auth=${s.user ? `${s.user[0]}***` : 'none'} from=${s.from.address}`;
}

/** Maps a transport failure to a stable class for logs and troubleshooting. Never includes server text that could contain addresses or credentials. */
export type DeliveryFailure = 'auth_failed' | 'recipient_rejected' | 'sender_rejected' | 'temporary_failure' | 'tls_failed' | 'connection_failed' | 'timeout' | 'message_rejected' | 'unknown';
export function classifySmtpError(err: any): DeliveryFailure {
  const code = String(err?.code || '');
  const rc = Number(err?.responseCode || 0);
  if (code === 'EAUTH' || rc === 535 || rc === 534 || rc === 530) return 'auth_failed';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout';
  const msg = String(err?.message || '');
  if (code === 'EREQUIRETLS' || code === 'ETLS' || err?.command === 'STARTTLS' || /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME_MISMATCH|ERR_SSL|ERR_TLS/i.test(code) || (code === 'ESOCKET' && /certificate|wrong version|STARTTLS|TLS|SSL|altname/i.test(msg))) return 'tls_failed';
  if (code === 'ECONNECTION' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EDNS' || code === 'ECONNRESET' || code === 'ESOCKET' || code === 'EHOSTUNREACH') return 'connection_failed';
  if (code === 'EENVELOPE') {
    const rejected = Array.isArray(err?.rejected) && err.rejected.length > 0;
    return rejected || rc === 550 || rc === 551 || rc === 553 || rc === 554 ? 'recipient_rejected' : 'sender_rejected';
  }
  if (rc >= 400 && rc < 500) return 'temporary_failure';
  if (code === 'EMESSAGE' || rc >= 500) return 'message_rejected';
  return 'unknown';
}
