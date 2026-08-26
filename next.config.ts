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

    // A second, separate limit — and the one that actually bit. Because this app
    // has a proxy.ts, Next buffers every request body so it can be read twice,
    // capped at 10 MB by default. Past that it does not reject the request: it
    // silently hands on the first 10 MB, so a 12 MB PDF arrived as a half a
    // multipart body and surfaced as "Unexpected end of form" from the parser,
    // naming neither the file nor the size. Kept level with bodySizeLimit above,
    // because a body allowed through one gate and truncated by the other is the
    // worst of both.
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
