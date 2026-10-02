import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE="./" (relative) for GitHub Pages: one build works at nolaatlas.com/ and under any
// folder (the old github.io project path), which keeps a domain switch from breaking assets.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
});
