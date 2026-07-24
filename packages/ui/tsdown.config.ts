import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/index.ts", "src/primitives.ts"],
  deps: {
    neverBundle: [
      /^@radix-ui\//,
      "lucide-react",
      "react",
      "react-dom",
      "react-hook-form",
      "react-markdown",
      "rehype-highlight",
    ],
  },
  format: ["esm"],
  outDir: "dist",
  platform: "browser",
  sourcemap: true,
});
