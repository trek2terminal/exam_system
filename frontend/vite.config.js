import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
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
