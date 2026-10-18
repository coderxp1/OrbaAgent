import urllib.request
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def test_profile():
    print("--- Testing /api/user/profile GET ---")
    req = urllib.request.Request("https://orbaagent.dev/api/user/profile")
    with urllib.request.urlopen(req, context=ctx) as resp:
        data = json.loads(resp.read().decode())
        print("GET Profile Response:", data)
        assert data["displayName"] is not None

    print("\n--- Testing /api/user/profile POST (Update Display Name) ---")
    update_payload = json.dumps({
        "displayName": "Paul Hartmann",
        "email": "paul@orbaagent.dev",
        "workspaceName": "Hartmann Core Workspace"
    }).encode("utf-8")
    req_post = urllib.request.Request(
        "https://orbaagent.dev/api/user/profile",
        data=update_payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req_post, context=ctx) as resp:
        post_data = json.loads(resp.read().decode())
        print("POST Update Response:", post_data)
        assert post_data["success"] is True
        assert post_data["profile"]["displayName"] == "Paul Hartmann"

    print("\n--- Verifying Persistence across reload ---")
    req_verify = urllib.request.Request("https://orbaagent.dev/api/user/profile")
    with urllib.request.urlopen(req_verify, context=ctx) as resp:
        verify_data = json.loads(resp.read().decode())
        print("Persisted Profile:", verify_data)
        assert verify_data["displayName"] == "Paul Hartmann"
        print("[PASS] Profile update and persistence verified successfully!")

def test_connections():
    print("\n--- Testing /api/connections/verify (Diagnostic Endpoint) ---")
    for provider in ["github", "google_drive", "google_calendar", "teams", "linear", "asana"]:
        payload = json.dumps({"provider": provider}).encode("utf-8")
        req = urllib.request.Request(
            "https://orbaagent.dev/api/connections/verify",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, context=ctx) as resp:
            data = json.loads(resp.read().decode())
            print(f"Provider '{provider}': status={data.get('status')} message={data.get('message')}")

if __name__ == "__main__":
    test_profile()
    test_connections()
