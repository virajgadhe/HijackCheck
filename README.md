# HijackCheck

HijackCheck is a controlled AI security experiment. It tests whether malicious
instructions embedded in webpage content can influence a Gemma workflow, and
evaluates a Python-based defence.

This repository currently implements **Milestone 1**: the Flask foundation, a
fictional product page containing a controlled injection, and Playwright-based
rendered-content extraction with tests.

## Requirements

- Python 3.12+
- Chromium installed through Playwright

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env
```

## Run

```bash
source .venv/bin/activate
python run.py
```

- Health check: <http://127.0.0.1:5000/health>
- Controlled attack page: <http://127.0.0.1:5000/lab/attack-page>

## Tests

```bash
source .venv/bin/activate
python -m pytest -v
```

The integration test starts a local Flask server and opens the rendered page in
headless Chromium, then verifies that the injected instruction appears in the
actual extracted DOM text.

## Status

No Gemma 4 request has been made. Extracting the instruction does not mean the
model follows it or that the attack succeeds.
