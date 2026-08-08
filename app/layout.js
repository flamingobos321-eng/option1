import './globals.css'
import { Toaster } from '@/components/ui/sonner'

export const metadata = {
  title: 'OptionAI Terminal — Personal Trading Copilot',
  description: 'AI-powered Indian options trading terminal',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-black text-slate-100 antialiased overflow-hidden">
        {children}
        <Toaster theme="dark" position="top-right" richColors />
      </body>
    </html>
  )
}
