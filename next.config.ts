import type { NextConfig } from "next";

import { BODY_SIZE_LIMIT_BYTES } from "./src/lib/images/body-limit";

const nextConfig: NextConfig = {
  // The phone reaches this dev server through `adb reverse`, as 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],

  experimental: {
    /*
     * Raised from the 1 MB Next caps a server action body at by default
     * (action-handler.js, 1024 * 1024), because the limit that refuses a file
     * has to be ours and has to say why.
     *
     * At the default, a file over 1 MB gets a 413 from the framework, the
     * action call rejects, settle() turns it into "A resposta do servidor não
     * chegou" — the sentence written for a lost connection — and the teacher
     * is told the wrong thing about a picture that was merely too big.
     *
     * The number lives in body-limit.ts beside the cap every file is held to,
     * so the frame and the rule under it cannot drift apart.
     */
    serverActions: { bodySizeLimit: BODY_SIZE_LIMIT_BYTES },
  },
};

export default nextConfig;
