/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disabled: StrictMode double-mounts effects in dev, which destroys+recreates
  // each player. The first WebGLVideoRenderer calls loseContext() on the canvas,
  // and the remount then fails to get a WebGL2 context -> slow 2D fallback. An
  // internal debug tool doesn't need StrictMode.
  reactStrictMode: false,
  transpilePackages: ['@yumyum-player/core', '@yumyums/ui', '@yumyum-player/hevc-wasm', '@yumyum-player/pro-streaming'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      const originalIgnored = config.watchOptions?.ignored;
      let newIgnored;

      if (originalIgnored instanceof RegExp) {
        // Combine the original RegExp with our HLS segment paths using a regex union
        newIgnored = new RegExp(
          `(${originalIgnored.source})|public\\/(rtsp-stream|rtsp-streams|custom-streams)\\/`
        );
      } else if (typeof originalIgnored === 'string') {
        newIgnored = [
          originalIgnored,
          '**/public/rtsp-stream/**',
          '**/public/rtsp-streams/**',
          '**/public/custom-streams/**',
        ];
      } else if (Array.isArray(originalIgnored)) {
        newIgnored = [
          ...originalIgnored,
          '**/public/rtsp-stream/**',
          '**/public/rtsp-streams/**',
          '**/public/custom-streams/**',
        ];
      } else {
        newIgnored = /public\/(rtsp-stream|rtsp-streams|custom-streams)\//;
      }

      config.watchOptions = {
        ...config.watchOptions,
        ignored: newIgnored,
      };
    }
    return config;
  },
};

export default nextConfig;
