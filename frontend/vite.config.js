import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE is set for GitHub Pages builds (e.g. /nola-housing/); "./" makes a
// relocatable build (any folder, any host) for previews.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
});
