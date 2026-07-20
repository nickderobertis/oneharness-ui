import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { themeStorageKey, themes } from "@/components/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";

export const metadata: Metadata = {
  description: "Read and continue local oneharness sessions",
  title: "oneharness",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* This runs before paint so a persisted or OS-selected dark theme never flashes light. */}
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {`(()=>{try{const m=${JSON.stringify(themes)},t=localStorage.getItem(${JSON.stringify(themeStorageKey)}),v=m.includes(t)?t:"system",d=v==="dark"||(v==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.dataset.theme=v}catch{}})()`}
        </Script>
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
