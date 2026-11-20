import '@fontsource-variable/noto-sans';
import '@fontsource-variable/noto-sans-arabic';
import '@fontsource-variable/noto-sans-bengali';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type * as React from 'react';
import { AppProviders } from '@/providers/app-providers';

export const metadata: Metadata = {
  title: 'Hardware ERP',
  description: 'Inventory, POS and accounting for hardware stores in Saudi Arabia',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Sets lang/dir before first paint from the saved preference (the UI itself renders client-side).
const setDirection = `try{var l=localStorage.getItem('erp.locale');if(l==='en'||l==='ar'||l==='bn'){document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr';}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: setDirection }} />
      </head>
      <body className="min-h-dvh antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
