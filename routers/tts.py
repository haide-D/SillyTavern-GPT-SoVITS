import os
import hashlib
import requests
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from typing import Optional, Union, List
from pydantic import BaseModel

from config import get_current_dirs, get_sovits_host
from utils import maintain_cache_size

router = APIRouter()


class TTSRequest(BaseModel):
    """完整的GPT-SoVITS TTS请求参数"""
    # 必需参数
    text: str
    text_lang: str
    ref_audio_path: str
    prompt_lang: str
    prompt_text: str = ""
    
    # 可选参数(带默认值)
    aux_ref_audio_paths: Optional[List[str]] = None
    top_k: int = 5
    top_p: float = 1.0
    temperature: float = 1.0
    text_split_method: str = "cut5"
    batch_size: int = 1
    batch_threshold: float = 0.75
    split_bucket: bool = True
    speed_factor: float = 1.0
    fragment_interval: float = 0.3
    seed: int = -1
    parallel_infer: bool = True
    repetition_penalty: float = 1.35
    sample_steps: int = 32
    super_sampling: bool = False
    streaming_mode: Union[bool, int] = False
    overlap_length: int = 2
    min_chunk_length: int = 16

@router.get("/proxy_set_gpt_weights")
def proxy_set_gpt_weights(weights_path: str):
    try:
        url = f"{get_sovits_host()}/set_gpt_weights"
        resp = requests.get(url, params={"weights_path": weights_path}, timeout=10)
        return {"status": resp.status_code, "detail": resp.text}
    except Exception as e:
        print(f"Set GPT Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/proxy_set_sovits_weights")
def proxy_set_sovits_weights(weights_path: str):
    try:
        url = f"{get_sovits_host()}/set_sovits_weights"
        resp = requests.get(url, params={"weights_path": weights_path}, timeout=10)
        return {"status": resp.status_code, "detail": resp.text}
    except Exception as e:
        print(f"Set SoVITS Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/tts_proxy")
async def tts_proxy_legacy(text: str, text_lang: str, ref_audio_path: str, prompt_text: str, prompt_lang: str, streaming_mode: Optional[str] = "false", check_only: Optional[str] = None):
    _, cache_dir = get_current_dirs()

    try:
        # 生成缓存Key
        raw_key = f"{text}_{ref_audio_path}_{prompt_text}_{text_lang}_{prompt_lang}"
        file_hash = hashlib.md5(raw_key.encode('utf-8')).hexdigest()

        # 【修改 1】明确定义文件名变量，方便后续使用
        filename = f"{file_hash}.wav"
        cache_file_path = os.path.join(cache_dir, filename)

        # 【修改 2】定义响应头 (Headers)
        # X-Audio-Filename: 告诉前端这个音频在服务器叫什么名字
        # Access-Control-Expose-Headers: 允许前端 JS 读取这个自定义 header (否则会被浏览器拦截)
        custom_headers = {
            "X-Audio-Filename": filename,
            "Access-Control-Expose-Headers": "X-Audio-Filename"
        }

        # 检查缓存是否存在
        if check_only == "true":
            # 【修改 3】check_only 模式下，也返回 filename，方便前端记录
            return {
                "cached": os.path.exists(cache_file_path),
                "filename": filename
            }

        if os.path.exists(cache_file_path):
            # 【修改 4】缓存命中时，带上 headers 返回
            return FileResponse(cache_file_path, media_type="audio/wav", headers=custom_headers)

        maintain_cache_size(cache_dir)

        # 转发请求给 SoVITS (非流式)
        url = f"{get_sovits_host()}/tts"
        params = {
            "text": text,
            "text_lang": text_lang,
            "ref_audio_path": ref_audio_path,
            "prompt_text": prompt_text,
            "prompt_lang": prompt_lang,
            "streaming_mode": "false" # 明确关闭流式
        }

        try:
            # 去掉 stream=True，增加超时时间
            r = requests.get(url, params=params, timeout=120)
        except requests.exceptions.RequestException:
            raise HTTPException(status_code=503, detail="无法连接到 SoVITS 服务，请检查 9880 端口")

        if r.status_code != 200:
            raise HTTPException(status_code=500, detail=f"SoVITS Error: {r.status_code}")

        # 保存文件逻辑
        temp_path = cache_file_path + ".tmp"

        try:
            with open(temp_path, "wb") as f:
                f.write(r.content)

            if os.path.exists(cache_file_path):
                os.remove(cache_file_path)
            os.rename(temp_path, cache_file_path)

        except Exception as e:
            print(f"文件保存错误: {e}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise HTTPException(status_code=500, detail="Failed to save audio file")

        # 【修改 5】新生成文件返回时，也带上 headers
        return FileResponse(cache_file_path, media_type="audio/wav", headers=custom_headers)

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"General TTS Error: {e}")
        raise HTTPException(status_code=500, detail="TTS Server Internal Error")
# [添加到 routers/tts.py 末尾]

@router.get("/delete_cache")
def delete_cache(filename: str):
    """
    直接根据文件名删除缓存。
    前端从 audio url 中提取文件名传过来即可。
    """
    _, cache_dir = get_current_dirs()

    # 安全措施：只允许删除文件名，不允许带路径（防止删错系统文件）
    safe_filename = os.path.basename(filename)
    target_path = os.path.join(cache_dir, safe_filename)

    if os.path.exists(target_path):
        try:
            os.remove(target_path)
            return {"status": "success", "msg": f"Deleted {safe_filename}"}
        except PermissionError:
            print(f"Warning: File {safe_filename} is in use and cannot be deleted.")
            return {"status": "success", "msg": "File in use, skipped deletion"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")
    else:
        # 如果文件本来就不在（可能已经被删了），也算成功，方便前端继续跑生成逻辑
        return {"status": "success", "msg": "File not found (already deleted?)"}


@router.post("/tts_proxy_v2")
async def tts_proxy_v2(req: TTSRequest, check_only: Optional[str] = None):
    """
    TTS代理接口 V2 - 支持完整GPT-SoVITS参数
    
    Args:
        req: TTS请求参数
        check_only: 仅检查缓存是否存在
    
    Returns:
        音频文件或缓存状态
    """
    _, cache_dir = get_current_dirs()

    try:
        # 生成缓存Key(基于核心参数)
        cache_key_parts = [
            req.text,
            req.ref_audio_path,
            req.prompt_text,
            req.text_lang,
            req.prompt_lang,
            str(req.speed_factor),  # 影响音频的参数也要加入缓存key
            str(req.temperature)
        ]
        raw_key = "_".join(cache_key_parts)
        file_hash = hashlib.md5(raw_key.encode('utf-8')).hexdigest()

        filename = f"{file_hash}.wav"
        cache_file_path = os.path.join(cache_dir, filename)

        custom_headers = {
            "X-Audio-Filename": filename,
            "Access-Control-Expose-Headers": "X-Audio-Filename"
        }

        # 检查缓存是否存在
        if check_only == "true":
            return {
                "cached": os.path.exists(cache_file_path),
                "filename": filename
            }

        if os.path.exists(cache_file_path):
            return FileResponse(cache_file_path, media_type="audio/wav", headers=custom_headers)

        maintain_cache_size(cache_dir)

        # 构建完整参数
        url = f"{get_sovits_host()}/tts"
        params = req.dict(exclude_none=True)  # 自动排除None值
        params["streaming_mode"] = False  # 强制非流式

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.get(url, params=params)
        except httpx.RequestError:
            raise HTTPException(status_code=503, detail="无法连接到 SoVITS 服务,请检查 9880 端口")

        if r.status_code != 200:
            raise HTTPException(status_code=500, detail=f"SoVITS Error: {r.status_code}")

        # 保存文件逻辑
        temp_path = cache_file_path + ".tmp"

        try:
            with open(temp_path, "wb") as f:
                f.write(r.content)

            if os.path.exists(cache_file_path):
                os.remove(cache_file_path)
            os.rename(temp_path, cache_file_path)

        except Exception as e:
            print(f"文件保存错误: {e}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise HTTPException(status_code=500, detail="Failed to save audio file")

        return FileResponse(cache_file_path, media_type="audio/wav", headers=custom_headers)

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"General TTS Error: {e}")
        raise HTTPException(status_code=500, detail="TTS Server Internal Error")
