import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The phone reaches this dev server through `adb reverse`, as 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],

  experimental: {
    /*
     * Raised from the 1 MB Next caps a server action body at by default
     * (action-handler.js, 1024 * 1024), because the limit that refuses a
     * structure reference has to be ours and has to say why.
     *
     * At the default, a file over 1 MB gets a 413 from the framework, the
     * action call rejects, settle() turns it into "A resposta do servidor não
     * chegou" — the sentence written for a lost connection — and the teacher
     * is told the wrong thing about a picture that was merely too big.
     *
     * 3 MB against a 2 MB cap of our own, so the frame is wider than the rule
     * and never the thing that fires. The browser shrinks every reference
     * before it is sent anyway, and after that almost nothing reaches a few
     * hundred KB; both numbers are nets, not rules anyone is meant to feel.
     */
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
