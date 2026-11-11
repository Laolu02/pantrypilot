import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import Providers from "./providers";
import Shell from "@/components/shell";

export const metadata: Metadata = { title: "PantryPilot", description: "A kitchen agent that acts within limits and shows its work." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans min-h-[100dvh]">
        <Providers><Shell>{children}</Shell></Providers>
      </body>
    </html>
  );
}
