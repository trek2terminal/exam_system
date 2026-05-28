import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { ToastViewport } from "./components/ui";
import "./styles.css";

const DEFAULT_THEME = "dark";

function applyInitialTheme() {
  try {
    const stored = window.localStorage.getItem("examTheme");
    const theme = stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
    const fontSize = window.localStorage.getItem("examFontSize") || "medium";
    const highContrast = window.localStorage.getItem("examHighContrast") === "true";
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.add(`font-${fontSize}`);
    document.documentElement.classList.toggle("high-contrast", highContrast);
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  }
}

applyInitialTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename="/react">
      <App />
      <ToastViewport />
    </BrowserRouter>
  </React.StrictMode>
);
