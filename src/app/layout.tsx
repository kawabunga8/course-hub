import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RCS Course Hub',
  description: 'Central student data management for Richmond Christian School',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
