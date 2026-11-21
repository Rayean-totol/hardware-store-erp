import '@fontsource-variable/noto-sans';
import '@fontsource-variable/noto-sans-arabic';
import '@fontsource-variable/noto-sans-bengali';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type * as React from 'react';
import { BASE_PATH } from '@/lib/base-path';
import { AppProviders } from '@/providers/app-providers';

export const metadata: Metadata = {
  title: 'Al Qureshi Hardware ERP Pro',
  description: 'Inventory, POS and purchasing for hardware stores in Saudi Arabia',
  applicationName: 'Al Qureshi Hardware ERP Pro',
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  icons: {
    icon: [{ url: `${BASE_PATH}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }],
    apple: [{ url: `${BASE_PATH}/icons/apple-touch-icon.png`, sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'AQ Hardware ERP', statusBarStyle: 'black-translucent' },
};

// viewport-fit=cover lets the layout use the notch and home-indicator areas via env(safe-area-inset-*).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#070d1a' };

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
