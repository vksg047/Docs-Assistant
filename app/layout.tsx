import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Docs Assistant",
  description: "A minimal Docs AI question-answering assistant.",
  icons: {
    icon: "https://www.uipath.com/favicon.ico"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
