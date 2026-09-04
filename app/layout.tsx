import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RoadTilt — Find your balance',
  description:
    'An endless first-person hover-road game. Tilt to accelerate, steer, and brake through three road topologies and three worlds.',
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
