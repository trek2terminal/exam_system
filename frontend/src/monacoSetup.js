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
