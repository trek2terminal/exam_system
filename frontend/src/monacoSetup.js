import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

globalThis.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  }
};

loader.config({ monaco });

// Define premium dark mode theme for Monaco editor
monaco.editor.defineTheme("premium-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    // Keywords
    { token: "keyword", foreground: "c792ea", fontStyle: "bold" },
    { token: "keyword.control", foreground: "c792ea" },
    
    // Strings
    { token: "string", foreground: "c3e88d" },
    { token: "string.escape", foreground: "82aaff" },
    
    // Numbers and booleans
    { token: "number", foreground: "f78c6c" },
    { token: "constant", foreground: "f78c6c" },
    
    // Functions and methods
    { token: "identifier.function", foreground: "82aaff" },
    { token: "type.function", foreground: "82aaff" },
    
    // Comments
    { token: "comment", foreground: "546e7a", fontStyle: "italic" },
    
    // Operators
    { token: "operator", foreground: "89ddff" },
    
    // Variables
    { token: "variable", foreground: "eeffff" },
    { token: "variable.other", foreground: "eeffff" },
    
    // Built-in functions/classes
    { token: "variable.predefined", foreground: "64b5f6" },
    { token: "type", foreground: "64b5f6" },
  ],
  colors: {
    "editor.background": "#0d1117",
    "editor.foreground": "#eeffff",
    "editor.lineNumbersBackground": "#0d1117",
    "editor.lineNumber": "#3d4f6e",
    "editor.lineHighlightBackground": "rgba(99,102,241,0.05)",
    "editor.lineHighlightBorder": "transparent",
    "editor.selectionBackground": "rgba(99,102,241,0.3)",
    "editor.selectionHighlightBackground": "rgba(99,102,241,0.15)",
    "editor.wordHighlightBackground": "rgba(99,102,241,0.1)",
    "editor.wordHighlightBorder": "rgba(99,102,241,0.3)",
    "editorCursor.foreground": "#06b6d4",
    "editorWhitespace.foreground": "#3d4f6e",
    "editorIndentGuide.background": "#1e2a45",
    "editorIndentGuide.activeBackground": "#3d4f6e",
    "editor.bracketMatchBackground": "rgba(99,102,241,0.2)",
    "editor.bracketMatchBorder": "rgba(99,102,241,0.5)",
    "editorBracketHighlight.foreground1": "#82aaff",
    "editorBracketHighlight.foreground2": "#c3e88d",
    "editorBracketHighlight.foreground3": "#f78c6c",
    "editorBracketHighlight.unexpectedBracket.foreground": "#f43f5e",
    "editorError.foreground": "#f43f5e",
    "editorWarning.foreground": "#f59e0b",
    "editorInfo.foreground": "#06b6d4",
    "editorHint.foreground": "#10b981",
    "editorSuggestWidget.background": "#161f35",
    "editorSuggestWidget.border": "rgba(99,102,241,0.25)",
    "editorSuggestWidget.foreground": "#eeffff",
    "editorSuggestWidget.selectedBackground": "rgba(99,102,241,0.1)",
    "editorSuggestWidget.highlightForeground": "#06b6d4",
    "editorHoverWidget.background": "#161f35",
    "editorHoverWidget.border": "rgba(99,102,241,0.25)",
    "editorHoverWidget.foreground": "#eeffff",
  }
});

// Set default theme
loader.init().then(() => {
  monaco.editor.setTheme("premium-dark");
});
