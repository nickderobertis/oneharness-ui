"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const themes = ["system", "light", "dark"] as const;
type Theme = (typeof themes)[number];

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("oneharness-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem("oneharness-theme");
    const initial = themes.find((candidate) => candidate === stored) ?? "system";
    setTheme(initial);
    applyTheme(initial);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => {
      if (document.documentElement.dataset.theme === "system") applyTheme("system");
    };
    media.addEventListener("change", syncSystem);
    return () => media.removeEventListener("change", syncSystem);
  }, []);

  const next = themes[(themes.indexOf(theme) + 1) % themes.length] ?? "system";
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Laptop;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={`Theme: ${theme}. Switch to ${next}`}
          onClick={() => {
            setTheme(next);
            applyTheme(next);
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Theme: {theme}</TooltipContent>
    </Tooltip>
  );
}
