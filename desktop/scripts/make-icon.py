#!/usr/bin/env python3
"""Compatibility entry point for the supplied-artwork icon generator."""
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[2]
subprocess.run(["node", str(root / "app" / "scripts" / "generate-icons.cjs")], cwd=root, check=True)
