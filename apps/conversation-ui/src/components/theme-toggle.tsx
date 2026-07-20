"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "./use-theme";

export function ThemeToggle() {
  const { next, setTheme, theme } = useTheme();
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Laptop;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={`Theme: ${theme}. Switch to ${next}`}
          onClick={() => setTheme(next)}
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
