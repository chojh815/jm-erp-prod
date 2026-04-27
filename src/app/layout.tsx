// src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import Header from "@/components/layout/Header";
import { PermissionsProvider } from "@/components/auth/PermissionsProvider";
import PwaRegistrar from "@/components/pwa/PwaRegistrar";
import "./globals.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "JM ERP",
  description: "JM International ERP mobile web app",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "JM ERP",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PermissionsProvider>
          <PwaRegistrar />
          <Header />
          <main>{children}</main>
        </PermissionsProvider>
      </body>
    </html>
  );
}
