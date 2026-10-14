#!/usr/bin/env node

const endpoint = process.env.VNO_TEST_BACKEND_URL || 'http://127.0.0.1:3100';
const email = process.env.VNO_TEST_EMAIL;
const password = process.env.VNO_TEST_PASSWORD;
const userType = process.env.VNO_TEST_ROLE;

if (!email || !password || !['admin', 'merchant', 'collaborator'].includes(userType)) {
  throw new Error('VNO_TEST_EMAIL, VNO_TEST_PASSWORD, and VNO_TEST_ROLE are required');
}
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(endpoint).hostname)) {
  throw new Error('This login smoke script is restricted to a local backend');
}

const response = await fetch(`${endpoint}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, userType }),
});
const body = await response.json().catch(() => null);
console.log(JSON.stringify({
  status: response.status < 300 && body?.user?.role === userType ? 'PASS' : 'FAIL',
  http_status: response.status,
  expected_role: userType,
  actual_role: body?.user?.role || null,
}, null, 2));
if (response.status >= 300 || body?.user?.role !== userType) process.exitCode = 1;
