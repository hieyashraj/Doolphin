/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@ffprobe-installer/ffprobe',
    'ffmpeg-static',
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
    'bullmq',
    'ioredis'
  ],
};

export default nextConfig;
