import type {Metadata,Viewport} from 'next';
export const metadata:Metadata={title:'BTCo OS · Ballard Trading Co.',description:'Shared inventory and operations for Ballard Trading Co.',robots:{index:false,follow:false}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#172e43'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><head><link rel="stylesheet" href="/styles.css?v=0.11.4"/><link rel="stylesheet" href="/vision.css?v=0.11.4"/></head><body>{children}</body></html>;}
