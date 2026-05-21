import ast
import os
import platform
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass


@dataclass
class CodeExecutionResult:
    ok: bool
    status: str
    stdout: str = ""
    stderr: str = ""
    message: str = ""
    execution_time_ms: int = 0

    def as_dict(self):
        return {
            "ok": self.ok,
            "status": self.status,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "message": self.message,
            "execution_time_ms": self.execution_time_ms,
        }


class CodeExecutionService:
    """Run student Python snippets with practical local-first safety controls."""

    BANNED_IMPORT_ROOTS = {
        "ctypes",
        "multiprocessing",
        "os",
        "pathlib",
        "requests",
        "shutil",
        "socket",
        "subprocess",
        "sys",
        "threading",
        "urllib",
    }
    BANNED_CALLS = {
        "__import__",
        "breakpoint",
        "compile",
        "eval",
        "exec",
        "globals",
        "locals",
        "open",
        "vars",
    }

    @staticmethod
    def _truncate(value, max_chars):
        value = value or ""
        if len(value) <= max_chars:
            return value
        return value[:max_chars] + "\n...[output truncated]"

    @staticmethod
    def validate_code(code, max_chars):
        if not code or not code.strip():
            return False, "Write Python code before running."
        if len(code) > max_chars:
            return False, f"Code is too long. Keep it under {max_chars} characters."
        if "__" in code:
            return False, "Dunder/private access is not allowed in exam code."

        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            return False, f"Syntax error on line {exc.lineno}: {exc.msg}"

        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                module_names = []
                if isinstance(node, ast.Import):
                    module_names = [alias.name for alias in node.names]
                elif node.module:
                    module_names = [node.module]

                for module_name in module_names:
                    root_name = module_name.split(".")[0]
                    if root_name in CodeExecutionService.BANNED_IMPORT_ROOTS:
                        return False, f"Import '{root_name}' is not allowed in exam code."

            if isinstance(node, ast.Call):
                function_name = ""
                if isinstance(node.func, ast.Name):
                    function_name = node.func.id
                elif isinstance(node.func, ast.Attribute):
                    function_name = node.func.attr

                if function_name in CodeExecutionService.BANNED_CALLS:
                    return False, f"Function '{function_name}' is not allowed in exam code."

        return True, ""

    @staticmethod
    def _resource_limiter():
        if platform.system().lower() == "windows":
            return None

        def limit_resources():
            try:
                import resource

                resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
                memory_bytes = 128 * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
            except Exception:
                pass

        return limit_resources

    @staticmethod
    def run_python(code, stdin_text="", timeout_seconds=10, max_chars=12000, output_max_chars=8000):
        is_valid, validation_message = CodeExecutionService.validate_code(code, max_chars)
        if not is_valid:
            return CodeExecutionResult(ok=False, status="rejected", message=validation_message)

        start = time.perf_counter()

        with tempfile.TemporaryDirectory(prefix="exam_code_") as temp_dir:
            script_path = os.path.join(temp_dir, "main.py")
            with open(script_path, "w", encoding="utf-8") as script_file:
                script_file.write(code)

            env = {
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUNBUFFERED": "1",
            }

            try:
                completed = subprocess.run(
                    [sys.executable, "-I", script_path],
                    input=stdin_text or "",
                    text=True,
                    capture_output=True,
                    cwd=temp_dir,
                    env=env,
                    timeout=timeout_seconds,
                    preexec_fn=CodeExecutionService._resource_limiter(),
                )
            except subprocess.TimeoutExpired as exc:
                elapsed_ms = int((time.perf_counter() - start) * 1000)
                stdout = CodeExecutionService._truncate(exc.stdout or "", output_max_chars)
                stderr = CodeExecutionService._truncate(exc.stderr or "", output_max_chars)
                return CodeExecutionResult(
                    ok=False,
                    status="timeout",
                    stdout=stdout,
                    stderr=stderr,
                    message=f"Execution timed out after {timeout_seconds} seconds.",
                    execution_time_ms=elapsed_ms,
                )

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        stdout = CodeExecutionService._truncate(completed.stdout, output_max_chars)
        stderr = CodeExecutionService._truncate(completed.stderr, output_max_chars)

        if completed.returncode == 0:
            return CodeExecutionResult(
                ok=True,
                status="success",
                stdout=stdout,
                stderr=stderr,
                message="Execution completed.",
                execution_time_ms=elapsed_ms,
            )

        return CodeExecutionResult(
            ok=False,
            status="error",
            stdout=stdout,
            stderr=stderr,
            message=f"Execution failed with exit code {completed.returncode}.",
            execution_time_ms=elapsed_ms,
        )
