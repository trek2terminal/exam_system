import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/react/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom", "zustand"],
          charts: ["recharts"],
          editorShell: ["@monaco-editor/react", "xterm"],
          icons: ["lucide-react"]
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false
      },
      "/socket.io": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false,
        ws: true
      },
      "/static": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false
      },
      "/student": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false
      },
      "/teacher": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false
      },
      "/admin": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false
      }
    }
  }
});
