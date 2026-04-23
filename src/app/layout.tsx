import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FdF — Finanza di Famiglia",
  description:
    "PFM italiano per famiglie tech-savvy: sinking funds, multi-conto, Amex Italia, budget condiviso tra partner.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
        {children}
      </body>
    </html>
  );
}
