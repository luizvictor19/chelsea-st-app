import type { Metadata } from "next";

import { rootMetadata } from "@/lib/brand";
import { currentSite } from "@/lib/current-site";

import { archivo, plexMono } from "./fonts";
import "./globals.css";

/** Name, description, icons and robots come from the brand of the Host. */
export async function generateMetadata(): Promise<Metadata> {
  return rootMetadata(await currentSite());
}

/**
 * data-brand picks the brand's colours in globals.css. A host outside the list
 * gets none, and with it the default palette.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const site = await currentSite();
  return (
    <html lang="pt-BR" data-brand={site?.brand.key}>
      <body
        className={`${archivo.variable} ${plexMono.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
