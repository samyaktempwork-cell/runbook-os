import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RunbookOS',
  description: 'DevOps incident memory — stop writing runbooks, incidents write them for you',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  )
}
