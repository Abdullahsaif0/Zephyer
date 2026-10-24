import { build } from "vite";
import { copyFile, mkdir, cp } from "node:fs/promises";
await build({
  configFile: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: [
        "panel.html",
        "options.html",
        "offscreen.html",
        "gallery.html",
        "troubleshoot.html",
      ],
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
await build({
  configFile: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/background.ts",
      formats: ["es"],
      fileName: () => "background.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
await build({
  configFile: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/content.ts",
      formats: ["iife"],
      name: "ZephyerContent",
      fileName: () => "content.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
await copyFile("manifest.json", "dist/manifest.json");
await cp("public/icons", "dist/icons", { recursive: true });
await mkdir("release", { recursive: true });
