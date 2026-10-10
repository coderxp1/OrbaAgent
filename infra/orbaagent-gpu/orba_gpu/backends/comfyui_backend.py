import json
import urllib.request
import urllib.parse
import time
import os
import shutil
import uuid
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ComfyUI runs in the same bridge network as the worker under the hostname "orbaagent-comfyui"
COMFYUI_URL = "http://orbaagent-comfyui:8188"
COMFYUI_OUTPUT_DIR = "/output"

class ComfyUIBackend:
    def __init__(self, models_dir: str):
        self.models_dir = models_dir
        self.image_model = os.getenv("MEDIA_GENERATION_IMAGE_MODEL", "flux1-schnell")
        self.video_model = os.getenv("MEDIA_GENERATION_VIDEO_MODEL", "wan2.1_t2v_1.3B_fp16")

    def _queue_prompt(self, prompt_workflow: dict) -> Optional[str]:
        p = {"prompt": prompt_workflow}
        data = json.dumps(p).encode('utf-8')
        req = urllib.request.Request(f"{COMFYUI_URL}/prompt", data=data)
        req.add_header('Content-Type', 'application/json')
        try:
            response = urllib.request.urlopen(req, timeout=10)
            res = json.loads(response.read())
            return res.get('prompt_id')
        except Exception as e:
            logger.error(f"Failed to queue ComfyUI prompt: {e}")
            return None

    def _wait_for_completion(self, prompt_id: str, timeout: int = 120) -> bool:
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                response = urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}", timeout=5)
                history = json.loads(response.read())
                if prompt_id in history:
                    # History shows success
                    return True
            except Exception as e:
                pass
            time.sleep(1)
        return False

    def generate_image(self, prompt: str, negative_prompt: str, width: int, height: int, steps: int, seed: int, output_format: str, output_path: str) -> bool:
        workflow = {
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": 1,
                    "sampler_name": "euler",
                    "scheduler": "simple",
                    "denoise": 1,
                    "model": ["10", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["5", 0]
                }
            },
            "5": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 1
                }
            },
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["10", 1]
                }
            },
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt or "",
                    "clip": ["10", 1]
                }
            },
            "8": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["3", 0],
                    "vae": ["10", 2]
                }
            },
            "9": {
                "class_type": "SaveImage",
                "inputs": {
                    "filename_prefix": f"orba_img_{seed}",
                    "images": ["8", 0]
                }
            },
            "10": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": "flux1-schnell-fp8.safetensors"
                }
            }
        }

        prompt_id = self._queue_prompt(workflow)
        if not prompt_id:
            return False

        if not self._wait_for_completion(prompt_id):
            return False

        # ComfyUI saves to its output dir. The `orbaagent_output` volume is shared,
        # so we can read it directly from `/output`.
        # Filename prefix is "orba_img_{seed}_00001.png" etc.
        # But `SaveImage` saves it. We'll find the most recent file matching the prefix.
        prefix = f"orba_img_{seed}"
        try:
            candidates = [f for f in os.listdir(COMFYUI_OUTPUT_DIR) if f.startswith(prefix) and f.endswith(".png")]
            if not candidates:
                return False
            # Sort by modification time to get the latest
            candidates.sort(key=lambda x: os.path.getmtime(os.path.join(COMFYUI_OUTPUT_DIR, x)), reverse=True)
            target = os.path.join(COMFYUI_OUTPUT_DIR, candidates[0])
            
            # The API handler expects the file to be at output_path.
            shutil.copy2(target, output_path)
            return True
        except Exception as e:
            logger.error(f"Failed to copy ComfyUI image output: {e}")
            return False

    def generate_video(self, prompt: str, negative_prompt: str, width: int, height: int, steps: int, seed: int, output_format: str, output_path: str) -> bool:
        workflow = {
            "1": {
                "class_type": "UNETLoader",
                "inputs": {
                    "unet_name": "wan2.1_t2v_1.3B_fp16.safetensors",
                    "weight_dtype": "default"
                }
            },
            "2": {
                "class_type": "DualCLIPLoader",
                "inputs": {
                    "clip_name1": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
                    "clip_name2": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
                    "type": "sd3"
                }
            },
            "3": {
                "class_type": "VAELoader",
                "inputs": {
                    "vae_name": "wan_2.1_vae.safetensors"
                }
            },
            "4": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["2", 0]
                }
            },
            "5": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt or "",
                    "clip": ["2", 0]
                }
            },
            "6": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 16 # frames
                }
            },
            "7": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": 1,
                    "sampler_name": "euler",
                    "scheduler": "simple",
                    "denoise": 1,
                    "model": ["1", 0],
                    "positive": ["4", 0],
                    "negative": ["5", 0],
                    "latent_image": ["6", 0]
                }
            },
            "8": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["7", 0],
                    "vae": ["3", 0]
                }
            },
            "9": {
                "class_type": "SaveImage",
                "inputs": {
                    "filename_prefix": f"orba_vid_{seed}",
                    "images": ["8", 0]
                }
            }
        }

        # Wait longer for video
        prompt_id = self._queue_prompt(workflow)
        if not prompt_id:
            return False

        if not self._wait_for_completion(prompt_id, timeout=600):
            return False

        # For video, ComfyUI saves multiple PNG frames natively unless a VideoCombine node is used.
        # But wait! Wan 2.1 is natively supported in ComfyUI as video, but `SaveImage` saves an image sequence.
        # If CoderXP uses VideoCombine (comfyui-videohelpers), we should use VHS_VideoCombine.
        # Since I'm using SaveImage, it saves frames. We will construct a GIF or MP4 using imageio if needed.
        # Let's use the actual workflow. If it saves PNGs, we can ffmpeg them into mp4.
        
        prefix = f"orba_vid_{seed}"
        try:
            frames = sorted([f for f in os.listdir(COMFYUI_OUTPUT_DIR) if f.startswith(prefix) and f.endswith(".png")])
            if not frames:
                return False
                
            # If the output format expects a video file, we need to stitch it.
            # But wait, earlier diffusers exported to mp4. Let's stitch with ffmpeg.
            # The worker image has `ffmpeg` installed (see Dockerfile).
            import subprocess
            frame_pattern = os.path.join(COMFYUI_OUTPUT_DIR, f"{prefix}_%05d.png")
            # Create mp4
            subprocess.run([
                "ffmpeg", "-y", "-framerate", "8", "-i", frame_pattern,
                "-c:v", "libx264", "-pix_fmt", "yuv420p", output_path
            ], check=True)
            return True
        except Exception as e:
            logger.error(f"Failed to process ComfyUI video output: {e}")
            return False

    def is_healthy(self) -> bool:
        try:
            response = urllib.request.urlopen(f"{COMFYUI_URL}/system_stats", timeout=3)
            return response.status == 200
        except Exception:
            return False
