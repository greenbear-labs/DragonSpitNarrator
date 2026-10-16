import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from narrator_engine.api import create_app
from narrator_engine.config import ALL_ENGINES, Settings

FAKE_WORKER = [sys.executable, str(Path(__file__).parent / "fake_worker.py")]
TOKEN = "test-token"


@pytest.fixture
def settings(tmp_path):
    s = Settings(
        data_dir=tmp_path,
        token=TOKEN,
        worker_commands={engine: FAKE_WORKER for engine in ALL_ENGINES},
    )
    s.ensure_dirs()
    return s


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings), headers={"Authorization": f"Bearer {TOKEN}"}) as c:
        yield c
