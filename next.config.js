/** @type {import('next').NextConfig} */
const nextConfig = {
  // TS errors are now fixed (tsc --noEmit passes) — builds typecheck again.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // SUI SDK packages (bundled within @mysten/sui, no externals needed)
    // Solana externals removed — API routes migrated to SUI.
    serverComponentsExternalPackages: []
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
