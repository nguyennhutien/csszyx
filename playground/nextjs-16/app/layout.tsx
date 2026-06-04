import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'csszyx Next.js 16 Playground',
    description: 'Next.js 16 compatibility playground for csszyx',
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
