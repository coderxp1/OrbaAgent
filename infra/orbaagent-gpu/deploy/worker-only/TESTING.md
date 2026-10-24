# Worker-only review: testing evidence and limits

Base: `586f3f51271421ddd4aae54f55828730ac05337e` (main).
Review environment: Python 3.13.5, PyYAML 6.0.3. No Docker daemon/CLI or GPU/host access. No dependency installation, container build, image pull, deployment or inference was performed.

## Executed against this final package

From repository root:

```bash
python3 -m unittest discover -s infra/orbaagent-gpu/deploy/worker-only -p 'test_*.py' -v
python3 -m py_compile infra/orbaagent-gpu/deploy/worker-only/control.py infra/orbaagent-gpu/deploy/worker-only/test_control.py
sh -n infra/orbaagent-gpu/deploy/worker-only/orbaagent-gpu
python3 -I infra/orbaagent-gpu/deploy/worker-only/control.py help
```

Results: **51 tests, 119 parameterized subtests, 0 failures, 0 errors, 0 skipped** in the actual standard-library unittest runner. The subtests are included within the 51 test methods, not 119 additional independent tests. Syntax checks exited 0; isolated-mode help exited 0. No mocked function performs a server operation.

Coverage includes missing/duplicate/malformed policy, blank example, full UUID requirements, digest-only images, missing approval reference, live index mismatches, duplicate inventory rows, JSON duplicate keys and fragments, extra services, broad GPU selectors, mismatched three GPU pins, public/extra ports, bind mounts, resource creation, secret path drift, forbidden ComfyUI backend, unexpected ingest route, automatic restarts/pulls, actual container isolation/GPU/env/image drift, absent worker, preflight failures before mutation, wrong host, wrong container project, no-build/no-pull/no-deps deployment arguments, restart scoping/order, post-check failures without false success, rejected legacy commands, argument injection, clean subprocess environment, upstream command failure handling, filesystem ownership/modes/symlinks, health redirect rejection, and wrapper syntax.

The optional PyYAML test loads the checked-in template with synthetic values, normalizes a modeled Compose JSON shape, validates it and compares it to the unit-test fixture. It passed here. **This is not a real Docker Compose render.** Without PyYAML that one test explicitly skips; runtime controls need only stdlib plus host Docker/nvidia-smi. Actual Compose-version compatibility is an operator gate. The deliberately strict schema may reject a safe but differently serialized config; review that difference, never bypass the validator.

## Actual pytest attempt (not passed)

```bash
python3 -m pytest infra/orbaagent-gpu/deploy/worker-only/test_control.py
```

Exit 1: `No module named pytest`. No pytest shim was used for the final package. No pytest dependencies were installed in the offline environment. Once dependencies already exist on an approved development/CI runner, the same command runs these unittest-based tests under actual pytest.

## Earlier draft evidence is NOT final-package evidence

The previous unshipped draft was tested using a home-grown pytest compatibility shim. Reported checks: 61 allocation/inventory cases, 26 configuration cases, 12 GPU-query cases; targeted GPU adversarial and syntax checks. Other attempted modules hit files missing from the partial local mirror. Those runs did not establish a clean full pytest result. They are not counted as passing checks for this final architecture.

That earlier draft modified legacy compose/validator/config files and allowed broad operations in places. It is intentionally NOT included. The final change is additive under `deploy/worker-only/` and leaves all previous application/runtime/provisioning files and tests untouched.

## Outstanding verification (not claimed)

- Full repository Python suite: **not run**. Actual pytest is absent and the local main mirror is partial. On an authorized complete checkout, run `python3 -m pytest infra/orbaagent-gpu/tests infra/orbaagent-gpu/deploy/worker-only/test_control.py`; compare with an exact-base run using the same environment. Do not relabel failures as pre-existing without reproducing them.
- Existing PR #10 reports historical main failures (two provisioning hash tests and an app fixture); those reports are not reproduced evidence for this package.
- Existing TS/Next.js application tests, lint, typecheck and full CI: **not run**; no application files changed.
- Read-only `docker compose ... config --format json`, real daemon inspection shapes, ownership/ACL evidence, image digest/source provenance and CUDA device visibility: **not run here**.
- FLUX image inference, existing ingest upload, authorized artifact fetch/hash/decode/UI display and video inference: **not run**. Refer to RUNBOOK.md for separate approval gates.
- CI was not triggered intentionally. At the reviewed base the existing workflow runs on main pushes and PRs and includes Docker builds. Publish a non-main review branch without opening a PR until build/CI permission is clarified. A branch is a review artifact, not a deployment.

## Reproduce subtest count (optional)

```bash
python3 - <<'PY'
import sys, unittest
sys.path.insert(0, 'infra/orbaagent-gpu/deploy/worker-only')
import test_control
class Count(unittest.TextTestResult):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.subcases = 0
    def addSubTest(self, test, subtest, err):
        self.subcases += 1
        super().addSubTest(test, subtest, err)
r = unittest.TextTestRunner(verbosity=0, resultclass=Count).run(
    unittest.defaultTestLoader.loadTestsFromModule(test_control))
print('tests=%d subtests=%d failures=%d errors=%d skips=%d' % (
    r.testsRun, r.subcases, len(r.failures), len(r.errors), len(r.skipped)))
raise SystemExit(not r.wasSuccessful())
PY
```
