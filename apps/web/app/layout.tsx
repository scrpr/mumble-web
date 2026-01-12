import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mumble Web (Next)',
  description: 'Mumble web client (Next.js + WebSocket gateway)'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  )
}

