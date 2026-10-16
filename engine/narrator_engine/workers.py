"""Model workers: one long-lived subprocess per engine, each in its own Python environment.

The TTS libraries pin conflicting versions of torch, transformers and numpy, so they
cannot share one environment. Each engine lives in workers/<engine>/ with its own
pyproject, and the server talks to it over a JSON-lines protocol on stdin/stdout
(see workers/_protocol.py).
"""

from __future__ import annotations

import json
import logging
import subprocess
import threading
from pathlib import Path

log = logging.getLogger(__name__)


class WorkerError(RuntimeError):
    pass


class Worker:
    def __init__(self, engine: str, command: list[str], log_dir: Path, device: str = "auto"):
        self.engine = engine
        self.command = command
        self.log_path = log_dir / f"{engine}.log"
        self.device = device
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self.state = "stopped"  # stopped, starting, ready, failed
        self.last_error: str | None = None

    def _start(self) -> None:
        self.state = "starting"
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        log_file = open(self.log_path, "ab")
        log.info("Starting %s worker: %s", self.engine, " ".join(self.command))
        self._proc = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=log_file,
            text=True,
            bufsize=1,
        )
        self._send({"op": "load", "device": self.device})
        reply = self._receive()
        if not reply.get("ok"):
            raise WorkerError(reply.get("error", "worker failed to load"))
        self.state = "ready"

    def _send(self, message: dict) -> None:
        assert self._proc and self._proc.stdin
        try:
            self._proc.stdin.write(json.dumps(message) + "\n")
            self._proc.stdin.flush()
        except BrokenPipeError as exc:
            raise WorkerError(self._died_message()) from exc

    def _receive(self) -> dict:
        assert self._proc and self._proc.stdout
        line = self._proc.stdout.readline()
        if not line:
            raise WorkerError(self._died_message())
        return json.loads(line)

    def _died_message(self) -> str:
        code = self._proc.poll() if self._proc else None
        return f"{self.engine} worker exited (code {code}); see {self.log_path}"

    def _alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def request(self, message: dict) -> dict:
        """Send one request and wait for its reply. Requests to one worker run one at a time."""
        with self._lock:
            try:
                if not self._alive():
                    self._start()
                self._send(message)
                reply = self._receive()
            except Exception as exc:
                self.state = "failed"
                self.last_error = str(exc)
                self.stop()
                raise WorkerError(str(exc)) from exc
            if not reply.get("ok"):
                raise WorkerError(reply.get("error", "unknown worker error"))
            return reply

    def stop(self) -> None:
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.stdin.close()
                self._proc.wait(timeout=10)
            except Exception:
                self._proc.kill()
        self._proc = None
        if self.state != "failed":
            self.state = "stopped"


class WorkerPool:
    def __init__(self, commands: dict[str, list[str]], log_dir: Path, device: str = "auto"):
        self.workers = {engine: Worker(engine, cmd, log_dir, device) for engine, cmd in commands.items()}

    def get(self, engine: str) -> Worker:
        try:
            return self.workers[engine]
        except KeyError:
            raise WorkerError(f"Engine '{engine}' is not enabled") from None

    def status(self) -> dict:
        return {
            name: {"state": w.state, "last_error": w.last_error} for name, w in self.workers.items()
        }

    def stop_all(self) -> None:
        for worker in self.workers.values():
            worker.stop()
