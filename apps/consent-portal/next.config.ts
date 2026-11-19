import type { NextConfig } from 'next';

// The path prefix the portal is served under, fixed at build time; empty for
// the root. On the WSO2 Developer Platform a service is reached at
// /<component>-<endpoint> on a shared host -- see the Dockerfile.
const basePath = process.env.BASE_PATH || '';

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // A self-contained server for the Docker image: `node server.js`, no
  // node_modules install at run time.
  output: 'standalone',
  poweredByHeader: false,
  // No generated AGENTS.md in the component folder.
  agentRules: false,
  // Oxygen UI ships ESM that imports MUI internals; transpiling it keeps one
  // copy of MUI (and so one theme context) between it and the app.
  transpilePackages: ['@wso2/oxygen-ui', '@wso2/oxygen-ui-icons-react'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Approve and Revoke must not be clickable through someone else's
          // invisible frame.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Consent ids are in paths; keep them out of other sites' logs.
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
