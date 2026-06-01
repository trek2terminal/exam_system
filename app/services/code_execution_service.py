import ast
import os
import platform
import secrets
import shutil
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
    exit_code: int | None = None

    def as_dict(self):
        return {
            "ok": self.ok,
            "status": self.status,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "message": self.message,
            "execution_time_ms": self.execution_time_ms,
            "exit_code": self.exit_code,
        }


class CodeExecutionService:
    """Run student Python snippets with practical local-first safety controls."""

    ALLOWED_IMPORT_ROOTS = {
        "array",
        "bisect",
        "calendar",
        "collections",
        "copy",
        "dataclasses",
        "datetime",
        "decimal",
        "fractions",
        "functools",
        "heapq",
        "itertools",
        "math",
        "operator",
        "random",
        "re",
        "statistics",
        "string",
        "typing",
    }
    BANNED_IMPORT_ROOTS = {
        "builtins",
        "ctypes",
        "faulthandler",
        "importlib",
        "inspect",
        "multiprocessing",
        "os",
        "pathlib",
        "pickle",
        "pkgutil",
        "pty",
        "requests",
        "resource",
        "runpy",
        "shutil",
        "signal",
        "site",
        "socket",
        "subprocess",
        "sys",
        "tempfile",
        "threading",
        "urllib",
        "venv",
    }
    BANNED_CALLS = {
        "__import__",
        "breakpoint",
        "compile",
        "delattr",
        "dir",
        "eval",
        "exec",
        "exit",
        "getattr",
        "globals",
        "help",
        "locals",
        "memoryview",
        "open",
        "quit",
        "setattr",
        "vars",
    }
    BANNED_NAMES = {
        "__builtins__",
        "copyright",
        "credits",
        "exit",
        "help",
        "license",
        "quit",
    }
    BANNED_ATTRIBUTES = {
        "mro",
        "popen",
        "remove",
        "removedirs",
        "rename",
        "rmdir",
        "rmtree",
        "socket",
        "subclasses",
        "system",
        "unlink",
        "walk",
    }
    VALID_EXECUTION_MODES = {"subprocess", "docker", "firejail", "auto"}

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
                elif node.level and node.level > 0:
                    return False, "Relative imports are not allowed in exam code."
                elif node.module:
                    module_names = [node.module]

                for module_name in module_names:
                    root_name = module_name.split(".")[0]
                    if root_name in CodeExecutionService.BANNED_IMPORT_ROOTS:
                        return False, f"Import '{root_name}' is not allowed in exam code."
                    if root_name not in CodeExecutionService.ALLOWED_IMPORT_ROOTS:
                        return False, f"Import '{root_name}' is not in the allowed exam module list."

            if isinstance(node, ast.Call):
                function_name = ""
                if isinstance(node.func, ast.Name):
                    function_name = node.func.id
                elif isinstance(node.func, ast.Attribute):
                    function_name = node.func.attr

                if function_name in CodeExecutionService.BANNED_CALLS:
                    return False, f"Function '{function_name}' is not allowed in exam code."

            if isinstance(node, ast.Name) and node.id in CodeExecutionService.BANNED_NAMES:
                return False, f"Name '{node.id}' is not allowed in exam code."

            if isinstance(node, ast.Attribute):
                if node.attr.startswith("_") or node.attr in CodeExecutionService.BANNED_ATTRIBUTES:
                    return False, f"Attribute '{node.attr}' is not allowed in exam code."

        return True, ""

    @staticmethod
    def _resource_limiter(memory_mb=128):
        if platform.system().lower() == "windows":
            return None
        memory_mb = max(int(memory_mb or 128), 32)

        def limit_resources():
            try:
                import resource

                resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
                memory_bytes = memory_mb * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
            except Exception:
                pass

        return limit_resources

    @staticmethod
    def _creation_flags():
        if platform.system().lower() != "windows":
            return 0
        flags = 0
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            flags |= subprocess.CREATE_NO_WINDOW
        if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
            flags |= subprocess.CREATE_NEW_PROCESS_GROUP
        return flags

    @staticmethod
    def _lockdown_workdir(temp_dir):
        if platform.system().lower() == "windows":
            return
        try:
            os.chmod(temp_dir, 0o555)
        except OSError:
            pass

    @staticmethod
    def _restore_workdir(temp_dir):
        try:
            os.chmod(temp_dir, 0o755)
        except OSError:
            pass

    @staticmethod
    def _isolated_env():
        return {
            "NO_PROXY": "*",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONUNBUFFERED": "1",
        }

    @staticmethod
    def _write_script(temp_dir, code):
        script_path = os.path.join(temp_dir, "main.py")
        with open(script_path, "w", encoding="utf-8") as script_file:
            script_file.write(code)
        try:
            os.chmod(script_path, 0o444)
        except OSError:
            pass
        return script_path

    @staticmethod
    def _docker_image_is_local(image_name):
        if not shutil.which("docker"):
            return False
        try:
            completed = subprocess.run(
                ["docker", "image", "inspect", image_name],
                text=True,
                capture_output=True,
                timeout=3,
                creationflags=CodeExecutionService._creation_flags(),
            )
        except Exception:
            return False
        return completed.returncode == 0

    @staticmethod
    def _resolve_execution_mode(mode, docker_image):
        clean_mode = (mode or "subprocess").strip().lower()
        if clean_mode not in CodeExecutionService.VALID_EXECUTION_MODES:
            clean_mode = "subprocess"
        if clean_mode == "auto":
            if CodeExecutionService._docker_image_is_local(docker_image):
                return "docker"
            if platform.system().lower() != "windows" and shutil.which("firejail"):
                return "firejail"
            return "subprocess"
        return clean_mode

    @staticmethod
    def _run_command(
        command,
        timeout_seconds=10,
        stdin_text="",
        output_max_chars=8000,
        cwd=None,
        env=None,
        preexec_fn=None,
        start_new_session=False,
        on_timeout=None,
    ):
        start = time.perf_counter()
        try:
            completed = subprocess.run(
                command,
                input=stdin_text,
                text=True,
                capture_output=True,
                cwd=cwd,
                env=env,
                timeout=timeout_seconds,
                preexec_fn=preexec_fn,
                start_new_session=start_new_session,
                creationflags=CodeExecutionService._creation_flags(),
            )
        except subprocess.TimeoutExpired as exc:
            if on_timeout:
                try:
                    on_timeout()
                except Exception:
                    pass
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            return CodeExecutionResult(
                ok=False,
                status="timeout",
                stdout=CodeExecutionService._truncate(exc.stdout or "", output_max_chars),
                stderr=CodeExecutionService._truncate(exc.stderr or "", output_max_chars),
                message=f"Execution timed out after {timeout_seconds} seconds.",
                execution_time_ms=elapsed_ms,
            )
        except OSError as exc:
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            return CodeExecutionResult(
                ok=False,
                status="error",
                message=f"Code runner could not start: {exc}",
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
                exit_code=completed.returncode,
            )

        return CodeExecutionResult(
            ok=False,
            status="error",
            stdout=stdout,
            stderr=stderr,
            message=f"Execution failed with exit code {completed.returncode}.",
            execution_time_ms=elapsed_ms,
            exit_code=completed.returncode,
        )

    @staticmethod
    def _run_subprocess(script_path, stdin_text, timeout_seconds, output_max_chars, temp_dir, memory_mb):
        try:
            CodeExecutionService._lockdown_workdir(temp_dir)
            return CodeExecutionService._run_command(
                [sys.executable, "-I", "-B", script_path],
                stdin_text=stdin_text,
                timeout_seconds=timeout_seconds,
                output_max_chars=output_max_chars,
                cwd=temp_dir,
                env=CodeExecutionService._isolated_env(),
                preexec_fn=CodeExecutionService._resource_limiter(memory_mb),
                start_new_session=platform.system().lower() != "windows",
            )
        finally:
            CodeExecutionService._restore_workdir(temp_dir)

    @staticmethod
    def _run_docker(script_path, stdin_text, timeout_seconds, output_max_chars, temp_dir, docker_image, memory_mb):
        if not shutil.which("docker"):
            return CodeExecutionResult(ok=False, status="error", message="Docker sandbox is configured but Docker is not available.")

        memory_mb = max(int(memory_mb or 128), 32)
        container_timeout = max(int(timeout_seconds or 10), 1)
        container_name = f"exam-code-{secrets.token_hex(8)}"
        command = [
            "docker",
            "run",
            "--rm",
            "--name",
            container_name,
            "--network",
            "none",
            "--cpus",
            "1",
            "--memory",
            f"{memory_mb}m",
            "--memory-swap",
            f"{memory_mb}m",
            "--pids-limit",
            "64",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--user",
            "65534:65534",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=16m",
            "-i",
            "-v",
            f"{temp_dir}:/workspace:ro",
            "--workdir",
            "/workspace",
            docker_image,
            "python",
            "-I",
            "-B",
            "/workspace/main.py",
        ]

        try:
            CodeExecutionService._lockdown_workdir(temp_dir)
            result = CodeExecutionService._run_command(
                command,
                stdin_text=stdin_text,
                timeout_seconds=container_timeout + 2,
                output_max_chars=output_max_chars,
                env={"NO_PROXY": "*"},
                on_timeout=lambda: subprocess.run(
                    ["docker", "rm", "-f", container_name],
                    text=True,
                    capture_output=True,
                    timeout=3,
                    creationflags=CodeExecutionService._creation_flags(),
                ),
            )
        finally:
            CodeExecutionService._restore_workdir(temp_dir)

        if result.status == "timeout":
            result.message = f"Docker sandbox timed out after {container_timeout} seconds."
        elif result.ok:
            result.message = "Execution completed in Docker sandbox."
        elif "Unable to find image" in result.stderr or "pull access denied" in result.stderr:
            result.message = f"Docker image '{docker_image}' is not available locally."
        return result

    @staticmethod
    def _run_firejail(script_path, stdin_text, timeout_seconds, output_max_chars, temp_dir, memory_mb):
        if platform.system().lower() == "windows" or not shutil.which("firejail"):
            return CodeExecutionResult(ok=False, status="error", message="Firejail sandbox is configured but is not available.")

        memory_bytes = max(int(memory_mb or 128), 32) * 1024 * 1024
        command = [
            "firejail",
            "--quiet",
            "--net=none",
            "--nonewprivs",
            "--caps.drop=all",
            f"--rlimit-cpu={max(int(timeout_seconds or 10), 1)}",
            f"--rlimit-as={memory_bytes}",
            f"--private={temp_dir}",
            sys.executable,
            "-I",
            "-B",
            script_path,
        ]
        result = CodeExecutionService._run_command(
            command,
            stdin_text=stdin_text,
            timeout_seconds=max(int(timeout_seconds or 10), 1) + 2,
            output_max_chars=output_max_chars,
            cwd=temp_dir,
            env=CodeExecutionService._isolated_env(),
            start_new_session=True,
        )
        if result.ok:
            result.message = "Execution completed in Firejail sandbox."
        return result

    @staticmethod
    def run_python(
        code,
        stdin_text="",
        timeout_seconds=10,
        max_chars=12000,
        stdin_max_chars=4000,
        output_max_chars=8000,
        execution_mode="subprocess",
        docker_image="python:3.11-alpine",
        memory_mb=128,
        allow_unsafe_subprocess=True,
    ):
        is_valid, validation_message = CodeExecutionService.validate_code(code, max_chars)
        if not is_valid:
            return CodeExecutionResult(ok=False, status="rejected", message=validation_message)

        stdin_text = stdin_text or ""
        if len(stdin_text) > stdin_max_chars:
            return CodeExecutionResult(
                ok=False,
                status="rejected",
                message=f"Input is too long. Keep stdin under {stdin_max_chars} characters.",
            )

        with tempfile.TemporaryDirectory(prefix="exam_code_") as temp_dir:
            script_path = CodeExecutionService._write_script(temp_dir, code)
            mode = CodeExecutionService._resolve_execution_mode(execution_mode, docker_image)
            if mode == "subprocess" and not allow_unsafe_subprocess:
                return CodeExecutionResult(
                    ok=False,
                    status="error",
                    message="Code execution sandbox is not available. Configure Docker or Firejail before enabling code execution.",
                )

            if mode == "docker":
                return CodeExecutionService._run_docker(
                    script_path,
                    stdin_text,
                    timeout_seconds,
                    output_max_chars,
                    temp_dir,
                    docker_image,
                    memory_mb,
                )

            if mode == "firejail":
                return CodeExecutionService._run_firejail(
                    script_path,
                    stdin_text,
                    timeout_seconds,
                    output_max_chars,
                    temp_dir,
                    memory_mb,
                )

            return CodeExecutionService._run_subprocess(
                script_path,
                stdin_text,
                timeout_seconds,
                output_max_chars,
                temp_dir,
                memory_mb,
            )
