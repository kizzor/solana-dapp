/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverComponentsExternalPackages: ['@solana/web3.js', '@coral-xyz/anchor', 'rpc-websockets', 'jayson']
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, net: false, tls: false, crypto: false,
        path: false, os: false, stream: false, buffer: false,
      }
    }
    return config
  }
}
module.exports = nextConfig
