import urllib.request
import ssl
import json
import time

ctx = ssl._create_unverified_context()
BASE = "https://orbaagent.dev/api/mcp"

def rpc(method, params=None, req_id=1):
    payload = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        payload["params"] = params
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(BASE, data=data, headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, context=ctx) as res:
        elapsed = round((time.time() - t0) * 1000, 1)
        body = json.loads(res.read().decode())
        return body, elapsed

def main():
    print("=== Step 1: MCP initialize handshake ===")
    init_res, t_init = rpc("initialize", {"protocolVersion": "2024-11-05"}, 1)
    print(f"[{t_init}ms] Server: {init_res.get('result', {}).get('serverInfo')} Protocol: {init_res.get('result', {}).get('protocolVersion')}")
    assert init_res.get("result", {}).get("serverInfo", {}).get("name") == "OrbaAgent MCP Server"

    print("\n=== Step 2: MCP tools/list discovery ===")
    tools_res, t_tools = rpc("tools/list", None, 2)
    tools = tools_res.get("result", {}).get("tools", [])
    print(f"[{t_tools}ms] Discovered {len(tools)} tools:")
    for t in tools:
        print(f"  - {t['name']}: {t['description']}")
    assert len(tools) >= 4

    print("\n=== Step 3: MCP tools/call (workspace_search) ===")
    search_res, t_search = rpc("tools/call", {
        "name": "workspace_search",
        "arguments": {"query": "OrbaAgent Architecture"}
    }, 3)
    print(f"[{t_search}ms] Result:", search_res.get("result", {}).get("content"))
    assert search_res.get("result", {}).get("content") is not None

    print("\n=== Step 4: MCP tools/call (media_image_generate) ===")
    img_res, t_img = rpc("tools/call", {
        "name": "media_image_generate",
        "arguments": {"prompt": "cinematic neon robot portrait", "width": 1024, "height": 1024}
    }, 4)
    print(f"[{t_img}ms] Result:", img_res.get("result", {}).get("content"))
    assert img_res.get("result", {}).get("content") is not None

    print("\n[PASS] All real MCP client operations verified successfully against production!")

if __name__ == "__main__":
    main()
