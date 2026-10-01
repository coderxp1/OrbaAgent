import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <title>OrbaAgent — Autonomous AI Agent Platform</title>
        <meta name="description" content="Autonomous AI Agent & Multi-Model Engine Platform" />
      </head>
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
