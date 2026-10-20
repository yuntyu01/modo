#!/usr/bin/env python3
"""Regenerate Windows icons from the shared approved artwork."""
from pathlib import Path
import subprocess

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    subprocess.run(['node', str(root / 'desktop/scripts/generate-icons.cjs')], cwd=root, check=True)
