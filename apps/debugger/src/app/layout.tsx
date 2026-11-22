import React from 'react';
import './globals.css';
import { Toaster } from 'sonner';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Multi-Codec Player SDK | Diagnostics Dashboard',
  description: 'High-performance independent multi-codec video player SDK demo featuring WebCodecs, WASM, and WebGL.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-text-primary antialiased min-h-screen">
        {children}
        <Toaster position="top-right" theme="dark" closeButton richColors />
      </body>
    </html>
  );
}
