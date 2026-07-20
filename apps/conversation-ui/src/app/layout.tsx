import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
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
          {`(()=>{try{const t=localStorage.getItem("oneharness-theme");const d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.dataset.theme=t==="light"||t==="dark"?t:"system"}catch{}})()`}
        </Script>
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
