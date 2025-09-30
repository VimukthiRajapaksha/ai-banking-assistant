import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'

export const metadata: Metadata = {
  title: 'Family Bank Assistant',
  description: 'Your personal banking assistant - secure, reliable banking help.',
  generator: 'Next.js',
  icons: {
    icon: 'https://img.icons8.com/?size=40&id=16713&format=png',
    shortcut: 'https://img.icons8.com/?size=40&id=16713&format=png',
    apple: 'https://img.icons8.com/?size=40&id=16713&format=png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <style>{`
html {
  font-family: ${GeistSans.style.fontFamily};
  --font-sans: ${GeistSans.variable};
  --font-mono: ${GeistMono.variable};
}
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
