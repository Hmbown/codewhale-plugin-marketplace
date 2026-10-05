import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build` writes ONE self-contained dist/index.html: scripts and styles
// are inlined, so the result opens from disk or any static host.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
});
