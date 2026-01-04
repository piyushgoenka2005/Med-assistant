/** @type {import('next').NextConfig} */
const path = require('node:path');

// Load repo-root .env when running under npm workspaces.
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch {
  // Ignore if dotenv isn't installed in this package.
}

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  // On Windows/OneDrive, Next's dev output can trigger file-locking and UNKNOWN fs errors.
  // Use a LOCALAPPDATA dist directory to avoid OneDrive interference.
  distDir:
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.relative(__dirname, path.join(process.env.LOCALAPPDATA, 'medi-web-next', 'dist'))
      : '.next',
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
    return [
      {
        source: '/v1/health',
        destination: `${apiBase}/health`
      },
      {
        source: '/v1/:path*',
        destination: `${apiBase}/v1/:path*`
      }
    ];
  }
};

module.exports = nextConfig;
