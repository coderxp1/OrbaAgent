"""OrbaAgent GPU media worker package.

Split into pure, injectable modules so the request/validation/limiter logic is
unit-testable without a GPU, torch, or diffusers:

    gpu_info    UUID-scoped GPU detection (never selects by ordering)
    config      environment settings and request bounds
    models      lazy, cached model manager
    generation  concurrency control, inference driving, output validation
    validation  image and video artifact verification
    ingest      authenticated delivery of artifacts to production
    secrets     secret loading and redaction
    app         FastAPI surface
"""

__all__ = ["__version__"]

__version__ = "2.0.0"
