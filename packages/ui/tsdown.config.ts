import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  deps: {
    neverBundle: [
      /^(?:react|react-dom|@radix-ui|react-markdown|rehype-highlight|lucide-react|class-variance-authority|clsx|tailwind-merge)(?:\/|$)/,
    ],
  },
  entry: ["src/index.ts"],
  format: ["esm"],
  minify: false,
  outputOptions: {
    preserveModules: true,
  },
  sourcemap: true,
});
