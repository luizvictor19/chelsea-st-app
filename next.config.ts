import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The phone reaches this dev server through `adb reverse`, as 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
