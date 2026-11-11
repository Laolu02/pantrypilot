/** @type {import('next').NextConfig} */
const API = process.env.API_URL ?? "http://localhost:4000";
export default {
  reactStrictMode: true,
  compress: false, // lets the SSE stream through the rewrite unbuffered
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API}/api/v1/:path*` }];
  },
};
