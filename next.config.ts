import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Uploads come in through server actions: question papers (.docx with
      // embedded diagrams) and study notes (PDFs, capped at 20 MB in
      // lib/uploads.ts). The default 1 MB body limit would reject those long
      // before our own validation ran, so this sits just above the file cap to
      // leave room for multipart overhead.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
