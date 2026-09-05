export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <title>OrbaAgent</title>
        <meta name="description" content="Autonomous AI Agent Platform" />
      </head>
      <body>{children}</body>
    </html>
  );
}
