// Minimal, dependency-free SMTP server for tests: records every connection and message, supports STARTTLS / implicit TLS / AUTH PLAIN+LOGIN,
// and can simulate the failures a real provider produces (bad credentials, rejected recipient, 4xx, stalled server, no STARTTLS offered).
import net from 'node:net';
import tls from 'node:tls';

export type MiniSmtpOptions = {
  mode: 'starttls' | 'tls' | 'plain';
  cert?: { key: string; cert: string };
  user?: string; pass?: string;              // when set, AUTH is required before MAIL
  offerStarttls?: boolean;                   // mode=starttls: false = behave like a server without STARTTLS support
  rejectRcpt?: (address: string) => string | null; // full reply line, e.g. '550 5.1.1 mailbox unavailable'
  dataReply?: string;                        // e.g. '451 4.3.0 try later'
  stallMs?: number;                          // do not send the greeting for this long
};
export type Captured = { from: string; to: string[]; raw: string; authUser?: string; encrypted: boolean };

export class MiniSmtp {
  readonly messages: Captured[] = [];
  connections = 0;
  authFailures = 0;
  authAttempts = 0;
  private server!: net.Server;
  private sockets = new Set<net.Socket>();
  constructor(private readonly o: MiniSmtpOptions) {}

  async start(): Promise<number> {
    const onConn = (socket: net.Socket) => { this.connections++; this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); this.session(socket, this.o.mode === 'tls'); };
    this.server = this.o.mode === 'tls' ? (tls.createServer({ ...this.o.cert!, minVersion: 'TLSv1.2' }, onConn) as unknown as net.Server) : net.createServer(onConn);
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return (this.server.address() as net.AddressInfo).port;
  }
  async stop() { for (const s of this.sockets) s.destroy(); await new Promise<void>((r) => this.server.close(() => r())); }

  private session(initial: net.Socket, encrypted: boolean) {
    let sock = initial; let secure = encrypted; let authed = false; let authUser: string | undefined;
    let from = ''; let to: string[] = []; let data: string[] | null = null; let buf = ''; let authStep: null | 'plain' | 'login-user' | 'login-pass' = null; let loginUser = '';
    const send = (line: string) => { if (!sock.destroyed) sock.write(line + '\r\n'); };
    const needAuth = () => Boolean(this.o.user) && !authed;
    const check = (user: string, pass: string) => { this.authAttempts++; const ok = user === this.o.user && pass === this.o.pass; if (ok) { authed = true; authUser = user; send('235 2.7.0 Authentication successful'); } else { this.authFailures++; send('535 5.7.8 Authentication credentials invalid'); } };

    const line = (l: string) => {
      if (data) {
        if (l === '.') {
          this.messages.push({ from, to, raw: data.join('\r\n'), authUser, encrypted: secure });
          data = null; from = ''; to = [];
          send(this.o.dataReply ?? '250 2.0.0 queued');
        } else data.push(l.startsWith('..') ? l.slice(1) : l);
        return;
      }
      if (authStep === 'plain') { authStep = null; const [, u, p] = Buffer.from(l, 'base64').toString().split('\0'); return check(u, p); }
      if (authStep === 'login-user') { loginUser = Buffer.from(l, 'base64').toString(); authStep = 'login-pass'; return send('334 UGFzc3dvcmQ6'); }
      if (authStep === 'login-pass') { authStep = null; return check(loginUser, Buffer.from(l, 'base64').toString()); }
      const [verb, ...rest] = l.split(' '); const arg = rest.join(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO': case 'HELO': {
          const caps = ['250-mini.local'];
          const starttls = this.o.mode === 'starttls' && !secure && this.o.offerStarttls !== false;
          if (starttls) caps.push('250-STARTTLS');
          // Like real providers, credentials are only offered once the channel is encrypted (or the mode is plain test mode).
          if (this.o.user && (secure || this.o.mode === 'plain' || this.o.offerStarttls === false)) caps.push('250-AUTH PLAIN LOGIN');
          caps.push('250 8BITMIME'); caps.forEach(send); return;
        }
        case 'STARTTLS': {
          if (this.o.mode !== 'starttls' || this.o.offerStarttls === false || secure) return send('502 5.5.1 STARTTLS not supported');
          send('220 2.0.0 Ready to start TLS');
          const upgraded = new tls.TLSSocket(sock, { isServer: true, ...this.o.cert!, minVersion: 'TLSv1.2' });
          this.sockets.add(upgraded); sock = upgraded; secure = true; buf = ''; wire(upgraded); return;
        }
        case 'AUTH': {
          const [mech, initialResponse] = arg.split(' ');
          if (mech.toUpperCase() === 'PLAIN') { if (initialResponse) { const [, u, p] = Buffer.from(initialResponse, 'base64').toString().split('\0'); return check(u, p); } authStep = 'plain'; return send('334 '); }
          if (mech.toUpperCase() === 'LOGIN') { authStep = 'login-user'; return send('334 VXNlcm5hbWU6'); }
          return send('504 5.5.4 unrecognized mechanism');
        }
        case 'MAIL': if (needAuth()) return send('530 5.7.0 Authentication required'); from = arg; return send('250 2.1.0 OK');
        case 'RCPT': {
          const address = (arg.match(/<([^>]*)>/) || [])[1] || '';
          const reject = this.o.rejectRcpt?.(address); if (reject) return send(reject);
          to.push(address); return send('250 2.1.5 OK');
        }
        case 'DATA': if (!to.length) return send('503 5.5.1 need RCPT'); data = []; return send('354 End data with <CR><LF>.<CR><LF>');
        case 'RSET': from = ''; to = []; return send('250 2.0.0 OK');
        case 'NOOP': return send('250 2.0.0 OK');
        case 'QUIT': send('221 2.0.0 Bye'); sock.end(); return;
        default: return send('500 5.5.1 unknown command');
      }
    };
    const wire = (s: net.Socket) => {
      s.on('data', (chunk) => { buf += chunk.toString('utf8'); let i; while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); line(l); } });
      s.on('error', () => undefined);
    };
    wire(sock);
    if (this.o.stallMs) setTimeout(() => send('220 mini.local ESMTP'), this.o.stallMs).unref();
    else send('220 mini.local ESMTP');
  }
}

/** Decodes a captured raw message into the parts the tests assert on (headers unfolded, bodies decoded from quoted-printable / base64). */
export function parseCaptured(raw: string) {
  const split = raw.indexOf('\r\n\r\n');
  const headerText = raw.slice(0, split).replace(/\r\n[ \t]+/g, ' ').replace(/(\?=)\s+(=\?utf-8\?)/gi, '$1$2'); // whitespace between adjacent encoded words is not part of the value (RFC 2047)
  const headers: Record<string, string> = {};
  for (const l of headerText.split('\r\n')) { const k = l.indexOf(':'); if (k > 0) headers[l.slice(0, k).toLowerCase()] = l.slice(k + 1).trim(); }
  const decodeQp = (s: string) => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  const parts: { type: string; body: string }[] = [];
  const boundary = (headers['content-type'] || '').match(/boundary="?([^";]+)"?/)?.[1];
  const addPart = (head: string, body: string) => {
    const type = (head.match(/content-type:\s*([^;\r\n]+)/i)?.[1] || 'text/plain').toLowerCase();
    const enc = (head.match(/content-transfer-encoding:\s*(\S+)/i)?.[1] || '7bit').toLowerCase();
    parts.push({ type, body: enc === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8') : enc === 'quoted-printable' ? decodeQp(body) : body });
  };
  if (boundary) {
    for (const seg of raw.slice(split + 4).split(`--${boundary}`).slice(1)) {
      if (seg.startsWith('--')) break;
      const p = seg.replace(/^\r\n/, '').indexOf('\r\n\r\n'); const s = seg.replace(/^\r\n/, '');
      addPart(s.slice(0, p), s.slice(p + 4).replace(/\r\n$/, ''));
    }
  } else addPart(headerText, raw.slice(split + 4));
  const decodeWord = (v: string) => v.replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_m, e, t) => (e.toLowerCase() === 'b' ? Buffer.from(t, 'base64').toString('utf8') : decodeQp(t.replace(/_/g, ' '))));
  return { headers, subject: decodeWord(headers['subject'] || ''), text: parts.find((p) => p.type === 'text/plain')?.body || '', html: parts.find((p) => p.type === 'text/html')?.body || '' };
}
