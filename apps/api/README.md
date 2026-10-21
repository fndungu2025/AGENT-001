# customeriq-api

FastAPI service for CustomerIQ. Import path: `app` (e.g. `from app.main import app`).

```bash
uv sync --all-packages                         # from the repo root
uv run uvicorn app.main:app --reload --app-dir apps/api
curl localhost:8000/v1/health
```

Configuration comes from environment variables (see `.env.example`, names only) via `app/config.py`.
