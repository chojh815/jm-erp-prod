// src/app/layout.tsx
import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import { PermissionsProvider } from "@/components/auth/PermissionsProvider";
import "./globals.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "JM ERP",
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
          <Header />
          <main>{children}</main>
        </PermissionsProvider>
      </body>
    </html>
  );
}
