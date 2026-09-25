import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Preciprocal ERP",
  description: "Enterprise resource planning — manage users, billing, and analytics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("h-full", geistSans.variable, geistMono.variable)}>
      <body
        className="min-h-full flex flex-col text-sm antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
