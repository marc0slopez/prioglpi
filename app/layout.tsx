import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PrioGLPI — Priorización de Tickets",
  description: "Sistema interno de priorización y seguimiento de tickets GLPI para el equipo de Sistemas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-AR">
      <body>
        {children}
      </body>
    </html>
  );
}
