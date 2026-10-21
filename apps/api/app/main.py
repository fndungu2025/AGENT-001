"""FastAPI application entry point."""

import os
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from app import __version__


class HealthResponse(BaseModel):
    """Liveness payload."""

    status: Literal["ok"]
    version: str
    git_sha: str


app = FastAPI(
    title="CustomerIQ API",
    version=__version__,
    openapi_url="/v1/openapi.json",
    docs_url="/v1/docs",
    redoc_url=None,
)


@app.get(
    "/v1/health",
    summary="Liveness check",
    response_model=HealthResponse,
    tags=["health"],
)
def health() -> HealthResponse:
    """Report that the service is up, with its version and deployed git SHA."""
    return HealthResponse(
        status="ok", version=__version__, git_sha=os.environ.get("GIT_SHA", "dev")
    )
