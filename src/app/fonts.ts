import localFont from "next/font/local";

/**
 * Brand faces, self-hosted. Keeping the files in the repo makes builds
 * reproducible offline and avoids a runtime dependency on Google Fonts.
 */
export const archivo = localFont({
  src: [
    { path: "./fonts/archivo-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/archivo-latin-500-normal.woff2", weight: "500" },
    { path: "./fonts/archivo-latin-600-normal.woff2", weight: "600" },
    { path: "./fonts/archivo-latin-700-normal.woff2", weight: "700" },
    { path: "./fonts/archivo-latin-800-normal.woff2", weight: "800" },
  ],
  variable: "--font-archivo",
  display: "swap",
  fallback: ["Helvetica Neue", "Arial", "sans-serif"],
});

export const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});
