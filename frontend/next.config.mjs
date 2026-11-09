/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // RETIRED: the Partner "Members" (team) screen belonged to the old Partner-to-Merchant team model. Every active Partner works with every
  // active Merchant (global Partner network, 2026-11-09), so there is no per-Merchant team to manage. Old links and bookmarks land on the
  // Partner dashboard with a real 307. Nothing was deleted in the database: `collaborators.merchant_system_id`, the historical association
  // audit rows and the `/collaborators/members` API routes are untouched.
  async redirects() {
    return [{ source: '/collaborator/dashboard/members', destination: '/collaborator/dashboard', permanent: false }];
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100',
  },
};

export default nextConfig;
