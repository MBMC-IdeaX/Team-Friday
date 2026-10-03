import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Bootstrap from "@/components/bootstrap";
import Shell from "@/components/shell";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HerGuardian",
  description:
    "Predictive women's safety: real-time Safety Scores, safest routes, one-tap SOS.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "HerGuardian",
    statusBarStyle: "black-translucent",
  },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#1b7a86",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Shell>{children}</Shell>
        <Bootstrap />
      </body>
    </html>
  );
}
