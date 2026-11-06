import type { Metadata } from "next";

import { rootMetadata } from "@/lib/brand";
import { currentSite } from "@/lib/current-site";

import { archivo, plexMono } from "./fonts";
import "./globals.css";

/** Name, description, icons and robots come from the brand of the Host. */
export async function generateMetadata(): Promise<Metadata> {
  return rootMetadata(await currentSite());
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${archivo.variable} ${plexMono.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
