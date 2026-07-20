export const themeStorageKey = "oneharness-theme";
export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

export function isTheme(value: string | null): value is Theme {
  return themes.some((theme) => theme === value);
}
