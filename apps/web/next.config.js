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
  outputFileTracingRoot: path.join(__dirname, '..', '..')
};

module.exports = nextConfig;
