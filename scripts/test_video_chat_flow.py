import urllib.request
import json
import os
import time
import ssl
import mimetypes

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE_URL = "https://orbaagent.dev"

def test_video_chat():
    print("=== Step 1: Uploading photograph to /api/uploads ===")
    test_image_path = "frame_1s.png"
    if not os.path.exists(test_image_path):
        test_image_path = "agent-6.png"

    with open(test_image_path, "rb") as f:
        img_bytes = f.read()

    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="files"; filename="portrait.png"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode("utf-8") + img_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req_upload = urllib.request.Request(
        f"{BASE_URL}/api/uploads",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    with urllib.request.urlopen(req_upload, context=ctx) as resp:
        upload_data = json.loads(resp.read().decode())
        print("Upload Response:", upload_data)
        art = upload_data["artifacts"][0]
        artifact_id = art["id"]
        artifact_url = art["url"]
        print("Artifact ID:", artifact_id)
        print("Artifact URL:", artifact_url)


    print(f"\n=== Step 2: Submitting Chat Request: 'Generate a vertical video with this photo.' ===")
    chat_payload = {
        "messages": [
            {
                "role": "user",
                "content": "Generate a vertical video with this photo."
            }
        ],
        "attachments": [
            {
                "name": "portrait.png",
                "type": "image/png",
                "size": len(img_bytes),
                "artifactId": artifact_id,
                "url": artifact_url
            }
        ]
    }

    t0 = time.time()
    req_chat = urllib.request.Request(
        f"{BASE_URL}/api/chat",
        data=json.dumps(chat_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    
    with urllib.request.urlopen(req_chat, context=ctx, timeout=300) as resp_chat:
        print("Chat Stream Response Status:", resp_chat.status)
        chunks = []
        for line in resp_chat:
            decoded = line.decode("utf-8").strip()
            if decoded:
                chunks.append(decoded)
                if "event:" in decoded or "data:" in decoded:
                    print(f"[{time.time()-t0:.1f}s] {decoded[:140]}")

    full_text = "\n".join(chunks)
    print(f"\nTotal elapsed: {time.time()-t0:.1f}s")
    print(f"Total lines received: {len(chunks)}")

    if "ALL_PROVIDERS_UNAVAILABLE" in full_text:
        print("[FAIL] ALL_PROVIDERS_UNAVAILABLE still occurred!")
        return False
    elif "No endpoints found" in full_text:
        print("[FAIL] OpenRouter 404 still occurred!")
        return False
    elif "exceeded maximum number of tokens" in full_text:
        print("[FAIL] Token limit 429 still occurred!")
        return False
    else:
        print("[SUCCESS] No provider failover cascade or token limit error!")
        return True

if __name__ == "__main__":
    test_video_chat()
