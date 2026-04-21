"""Quant Portfolio Lab — entry point.

The application lives in `artifacts/quant-portfolio-lab/`. This file is a
convenience launcher so you can run the app from the project root.

Usage:
    pip install -r artifacts/quant-portfolio-lab/requirements.txt
    python app.py

Or run directly from the artifact directory:
    cd artifacts/quant-portfolio-lab && python app.py
"""
import os
import sys

ARTIFACT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifacts", "quant-portfolio-lab")

if __name__ == "__main__":
    sys.path.insert(0, ARTIFACT_DIR)
    os.chdir(ARTIFACT_DIR)
    from app import app  # type: ignore
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
