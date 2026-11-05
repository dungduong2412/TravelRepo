#!/usr/bin/env node
// TEST TOOL (local clone only): reverse proxy in front of a local Supabase API that injects faults into Storage object uploads.
// Usage: fault-proxy.mjs <listen-port> <upstream-url> "<n>:<fault>,<n>:<fault>,..."   (n = 1-based count of Storage object POSTs since start)
// faults: stall (never respond) | reset (destroy socket) | 503 | 429 | stored-reset (forward upstream, then drop the response)
// Refuses any non-loopback upstream. Prints one JSON line per injected fault and a running POST count on SIGUSR1.
import http from 'node:http';

const [port, upstream, planArg = ''] = process.argv.slice(2);
const up = new URL(upstream);
if (!['127.0.0.1', 'localhost', '::1'].includes(up.hostname)) throw new Error('fault-proxy only forwards to a loopback upstream');
const plan = new Map(planArg.split(',').filter(Boolean).map((p) => { const [n, f] = p.split(':'); return [Number(n), f]; }));
let posts = 0;
const stalled = new Set();
const server = http.createServer((req, res) => {
  const isUpload = req.method === 'POST' && req.url.startsWith('/storage/v1/object/');
  let fault = null;
  if (isUpload) { posts++; fault = plan.get(posts) || null; if (fault) console.log(JSON.stringify({ post: posts, fault, url: req.url.slice(0, 120) })); }
  if (fault === 'stall') { stalled.add(req); req.resume(); return; }
  if (fault === 'reset') { req.resume(); return req.socket.destroy(); }
  if (fault === '503') { req.resume(); res.writeHead(503, { 'content-type': 'text/plain' }); return res.end('injected 503'); }
  if (fault === '429') { req.resume(); res.writeHead(429, { 'content-type': 'text/plain', 'retry-after': '2' }); return res.end('injected 429'); }
  const fwd = http.request({ host: up.hostname, port: up.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
    if (fault === 'stored-reset') { r.resume(); r.on('end', () => req.socket.destroy()); return; }
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  fwd.on('error', () => { try { res.writeHead(502); res.end('proxy upstream error'); } catch { /* socket gone */ } });
  req.pipe(fwd);
});
server.listen(Number(port), '127.0.0.1', () => console.log(JSON.stringify({ listening: Number(port), upstream, plan: [...plan] })));
process.on('SIGUSR1', () => console.log(JSON.stringify({ posts })));
