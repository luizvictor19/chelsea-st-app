import type { Metadata } from "next";

import { archivo, plexMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chelsea St",
  description: "Plataforma de apoio às aulas de inglês da Chelsea St.",
};

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
