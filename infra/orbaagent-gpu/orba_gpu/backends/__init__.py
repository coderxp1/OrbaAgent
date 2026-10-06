"""Real generation backends.

These modules are imported lazily by ``orba_gpu.generation`` so that importing the
worker (and running its unit tests) does not require ``torch`` or ``diffusers``
to be installed. They only load on the GPU host where those packages exist.
"""
