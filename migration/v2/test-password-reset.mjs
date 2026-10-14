#!/usr/bin/env node

import { randomBytes } from 'node:crypto';

const apiUrl = process.env.API_URL;
const mailpitUrl = process.env.MAILPIT_URL;
const anonKey = process.env.ANON_KEY || process.env.PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SECRET_KEY;

if (!apiUrl || !mailpitUrl || !anonKey || !serviceRoleKey) {
  throw new Error('API_URL, MAILPIT_URL, ANON_KEY/PUBLISHABLE_KEY and SERVICE_ROLE_KEY/SECRET_KEY are required');
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl) ||
    !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(mailpitUrl)) {
  throw new Error('This smoke test is restricted to a local Supabase and local Mailpit instance');
}

const email = `vno-d3-reset-${Date.now()}@example.invalid`;
const initialPassword = `A1!${randomBytes(18).toString('base64url')}`;
const recoveredPassword = `B2!${randomBytes(18).toString('base64url')}`;
let userId;

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${new URL(url).pathname}: HTTP ${response.status}`);
  }
  return { response, body };
}

const adminHeaders = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

try {
  const created = await request(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ email, password: initialPassword, email_confirm: true }),
  });
  userId = created.body.id;

  await request(`${apiUrl}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      gotrue_meta_security: {},
    }),
  });

  const inbox = await request(`${mailpitUrl}/api/v1/messages`);
  const message = inbox.body.messages.find((item) =>
    item.To?.some((recipient) => recipient.Address?.toLowerCase() === email));
  if (!message) throw new Error('Mailpit did not capture the recovery email');

  const fullMessage = await request(`${mailpitUrl}/api/v1/message/${message.ID}`);
  const html = fullMessage.body.HTML || '';
  const linkMatch = html.match(/https?:\/\/[^"'<>\s]+\/auth\/v1\/verify[^"'<>\s]*/i);
  if (!linkMatch) throw new Error('Recovery email does not contain an Auth verification URL');
  const verificationUrl = linkMatch[0].replaceAll('&amp;', '&');
  const verified = await fetch(verificationUrl, { redirect: 'manual' });
  if (![302, 303].includes(verified.status)) {
    throw new Error(`Recovery verification returned HTTP ${verified.status}`);
  }
  const location = verified.headers.get('location');
  if (!location) throw new Error('Recovery verification did not return a redirect');
  const fragment = new URLSearchParams(new URL(location).hash.slice(1));
  const accessToken = fragment.get('access_token');
  if (!accessToken || fragment.get('type') !== 'recovery') {
    throw new Error('Recovery redirect did not establish a recovery session');
  }

  await request(`${apiUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: recoveredPassword }),
  });

  const login = await request(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: recoveredPassword }),
  });
  if (!login.body.access_token) throw new Error('Recovered password did not authenticate');

  console.log(JSON.stringify({
    status: 'PASS',
    transport: 'local Mailpit only',
    recipient_domain: 'example.invalid',
    recovery_email_captured: true,
    recovery_link_verified: true,
    password_update_verified: true,
    customer_email_sent: false,
  }, null, 2));
} finally {
  if (userId) {
    await fetch(`${apiUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
  }
}
