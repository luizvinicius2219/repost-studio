import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repost Studio | Biblioteca e Agendamento",
  description: "Workspace pessoal para catalogar perfis TikTok, organizar arquivos MP4 e planejar publicacoes.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
