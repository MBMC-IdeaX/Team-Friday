import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Bootstrap from "@/components/bootstrap";
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
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

// No chrome here on purpose: each route group owns its own shell (see
// (map)/layout.tsx, (app)/layout.tsx, (bare)/layout.tsx), so the markup for a
// route is identical on the server and the client.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Bootstrap />
      </body>
    </html>
  );
}
