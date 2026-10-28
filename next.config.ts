import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['mssql', 'msnodesqlv8'],
  experimental: {
    workerThreads: true
  }
};

export default nextConfig;
