import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TravelRepo',
  description: 'Travel platform for merchants and collaborators',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
