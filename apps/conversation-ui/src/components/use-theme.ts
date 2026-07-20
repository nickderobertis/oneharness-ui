"use client";

import { useEffect, useState } from "react";
import { isTheme, type Theme, themeStorageKey, themes } from "./theme";

function applyAndPersistTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(themeStorageKey, theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem(themeStorageKey);
    const initial = isTheme(stored) ? stored : "system";
    setThemeState(initial);
    applyAndPersistTheme(initial);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => {
      if (document.documentElement.dataset.theme === "system") applyAndPersistTheme("system");
    };
    media.addEventListener("change", syncSystem);
    return () => media.removeEventListener("change", syncSystem);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    applyAndPersistTheme(next);
  };
  return {
    next: themes[(themes.indexOf(theme) + 1) % themes.length] ?? "system",
    setTheme,
    theme,
  };
}
