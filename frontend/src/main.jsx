import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import App from "./App.jsx";
import "./styles.css";

function applyInitialTheme() {
  try {
    const stored = window.localStorage.getItem("examTheme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const theme = stored || (prefersDark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.style.colorScheme = "light";
  }
}

applyInitialTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename="/react">
      <App />
      <Toaster position="top-right" />
    </BrowserRouter>
  </React.StrictMode>
);
