import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "미래사업팀 Hub",
  description: "미래사업팀 통합 업무 플랫폼",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ minHeight: '100vh', background: '#f8f8f7' }}>
        {children}
      </body>
    </html>
  );
}
