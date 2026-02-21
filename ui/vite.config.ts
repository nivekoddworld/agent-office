import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3847",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          mantine: [
            "react",
            "react-dom",
            "@mantine/core",
            "@mantine/hooks",
            "@mantine/notifications",
          ],
          icons: ["@tabler/icons-react"],
          markdown: ["react-markdown", "rehype-highlight", "remark-gfm"],
          xyflow: ["@xyflow/react", "dagre"],
        },
      },
    },
  },
});
