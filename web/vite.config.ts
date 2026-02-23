import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  publicDir: "public",
  build: {
    outDir: "dist",
  },
  server: {
    port: 5173,
    open: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../src"),
    },
  },
});
