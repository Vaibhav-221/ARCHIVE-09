import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ARCHIVE 09 — The Internet That Forgot You",
  description: "Investigate the October 16 Incident through a recovered fictional web archive.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Script id="archive-theme-bootstrap" strategy="beforeInteractive">
          {`try { const savedTheme = localStorage.getItem("archive-09:theme"); document.documentElement.dataset.theme = savedTheme === "light" ? "light" : "dark"; } catch { document.documentElement.dataset.theme = "dark"; }`}
        </Script>
      </body>
    </html>
  );
}
