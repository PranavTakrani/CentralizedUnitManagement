"""Vercel serverless entrypoint.

Vercel's Python runtime looks for an ASGI/WSGI app named `app` in this file.
`main.py`, `routers/` and `token_store.py` live one directory up, so put that
directory on sys.path before importing them.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app  # noqa: E402

__all__ = ["app"]
