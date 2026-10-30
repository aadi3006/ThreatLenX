import type { Metadata } from 'next';
import './globals.css';
import './spatial/motion/motion-language.css';
export const metadata: Metadata = {
  title: 'ThreatLenX',
  description: 'Offline-first spatial Security Operations Center (SOC) platform for real-time threat detection, attack graph investigation, hypothesis hunting, and incident response.',
};
export const viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#000403'};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en" className="dark"><body>{children}</body></html> }
