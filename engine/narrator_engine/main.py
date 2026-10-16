"""Command line: `narrator-engine serve` starts the API, `narrator-engine token` prints the API token."""

from __future__ import annotations

import argparse
import logging

import uvicorn

from .api import create_app
from .config import load_settings


def cli() -> None:
    parser = argparse.ArgumentParser(prog="narrator-engine")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="Start the engine API")
    serve.add_argument("--host", help="Bind address (default 127.0.0.1)")
    serve.add_argument("--port", type=int, help="Port (default 8765)")
    sub.add_parser("token", help="Print the API token")
    args = parser.parse_args()

    settings = load_settings()
    if args.command == "token":
        print(settings.token)
        return

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    host = args.host or settings.host
    port = args.port or settings.port
    print(f"Narrator engine on http://{host}:{port}  (data: {settings.data_dir})")
    print(f"Engines: {', '.join(settings.engines)}. API token: run `narrator-engine token`.")
    uvicorn.run(create_app(settings), host=host, port=port)


if __name__ == "__main__":
    cli()
