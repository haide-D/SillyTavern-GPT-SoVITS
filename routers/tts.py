import os
import hashlib
import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from typing import Optional

from config import get_current_dirs, get_sovits_host
from utils import maintain_cache_size

router = APIRouter()

@router.get("/proxy_set_gpt_weights")
def proxy_set_gpt_weights(weights_path: str):
    # 1. 检查文件是否存在
    if not os.path.exists(weights_path):
        raise HTTPException(
            status_code=400, 
            detail=f"GPT 权重文件不存在: {weights_path}"
        )
    
    # 2. 尝试连接服务并切换权重
    try:
        url = f"{get_sovits_host()}/set_gpt_weights"
        resp = requests.get(url, params={"weights_path": weights_path}, timeout=10)
        
        if resp.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"GPT 权重切换失败 (服务返回 {resp.status_code}): {resp.text}"
            )
        
        return {"status": resp.status_code, "detail": resp.text}
        
    except requests.exceptions.ConnectionError:
        print(f"Set GPT Error: 无法连接到 GPT-SoVITS 服务 (端口 9880)")
        raise HTTPException(
            status_code=503, 
            detail="无法连接到 GPT-SoVITS 服务,请检查服务是否已启动 (端口 9880)"
        )
    except requests.exceptions.Timeout:
        print(f"Set GPT Error: 连接超时")
        raise HTTPException(
            status_code=503,
            detail="连接 GPT-SoVITS 服务超时,请检查服务状态"
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Set GPT Error: {e}")
        raise HTTPException(status_code=500, detail=f"GPT 权重切换失败: {str(e)}")

@router.get("/proxy_set_sovits_weights")
def proxy_set_sovits_weights(weights_path: str):
    # 1. 检查文件是否存在
    if not os.path.exists(weights_path):
        raise HTTPException(
            status_code=400,
            detail=f"SoVITS 权重文件不存在: {weights_path}"
        )
    
    # 2. 尝试连接服务并切换权重
    try:
        url = f"{get_sovits_host()}/set_sovits_weights"
        resp = requests.get(url, params={"weights_path": weights_path}, timeout=10)
        
        if resp.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"SoVITS 权重切换失败 (服务返回 {resp.status_code}): {resp.text}"
            )
        
        return {"status": resp.status_code, "detail": resp.text}
        
    except requests.exceptions.ConnectionError:
        print(f"Set SoVITS Error: 无法连接到 GPT-SoVITS 服务 (端口 9880)")
        raise HTTPException(
            status_code=503,
            detail="无法连接到 GPT-SoVITS 服务,请检查服务是否已启动 (端口 9880)"
        )
    except requests.exceptions.Timeout:
        print(f"Set SoVITS Error: 连接超时")
        raise HTTPException(
            status_code=503,
            detail="连接 GPT-SoVITS 服务超时,请检查服务状态"
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Set SoVITS Error: {e}")
        raise HTTPException(status_code=500, detail=f"SoVITS 权重切换失败: {str(e)}")

@router.get("/tts_proxy")
def tts_proxy(
    text: str, 
    text_lang: str, 
    ref_audio_path: str, 
    prompt_text: str, 
    prompt_lang: str, 
    emotion: Optional[str] = "default",
    streaming_mode: Optional[str] = "false", 
    check_only: Optional[str] = None
):
    # ========== 缓存检查逻辑 ==========
    _, cache_dir = get_current_dirs()

    try:
        # 新缓存Key: 包含情绪,不包含具体音频路径
        new_key = f"{text}_{emotion}_{text_lang}_{prompt_lang}"
        new_hash = hashlib.md5(new_key.encode('utf-8')).hexdigest()
        new_filename = f"{new_hash}.wav"
        new_cache_path = os.path.join(cache_dir, new_filename)
        
        # 旧缓存Key: 包含音频路径 (用于兼容旧数据)
        old_key = f"{text}_{ref_audio_path}_{prompt_text}_{text_lang}_{prompt_lang}"
        old_hash = hashlib.md5(old_key.encode('utf-8')).hexdigest()
        old_filename = f"{old_hash}.wav"
        old_cache_path = os.path.join(cache_dir, old_filename)

        # 响应头
        custom_headers = {
            "X-Audio-Filename": new_filename,
            "Access-Control-Expose-Headers": "X-Audio-Filename"
        }

        # 检查缓存是否存在
        if check_only == "true":
            # 优先检查新缓存,回退检查旧缓存
            cached = os.path.exists(new_cache_path) or os.path.exists(old_cache_path)
            return {
                "cached": cached,
                "filename": new_filename
            }

        # 优先查找新缓存
        if os.path.exists(new_cache_path):
            return FileResponse(new_cache_path, media_type="audio/wav", headers=custom_headers)

        # 回退查找旧缓存
        if os.path.exists(old_cache_path):
            # 找到旧缓存,复制到新Key (逐步迁移)
            try:
                import shutil
                shutil.copy2(old_cache_path, new_cache_path)
                print(f"[Cache Migration] {old_filename} -> {new_filename}")
            except Exception as e:
                print(f"[Cache Migration Failed] {e}")
            return FileResponse(old_cache_path, media_type="audio/wav", headers=custom_headers)

        # ========== 缓存未命中,需要生成,进行参数验证 ==========
        from validation_utils import validate_tts_request
        
        try:
            validate_tts_request(
                text=text,
                text_lang=text_lang,
                ref_audio_path=ref_audio_path,
                prompt_lang=prompt_lang,
                sovits_host=get_sovits_host()
            )
        except HTTPException:
            # 验证失败时直接抛出,让 FastAPI 处理
            raise

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

        # 保存到新缓存路径
        temp_path = new_cache_path + ".tmp"

        try:
            with open(temp_path, "wb") as f:
                f.write(r.content)

            if os.path.exists(new_cache_path):
                os.remove(new_cache_path)
            os.rename(temp_path, new_cache_path)

        except Exception as e:
            print(f"文件保存错误: {e}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise HTTPException(status_code=500, detail="Failed to save audio file")

        # 新生成文件返回时,也带上 headers
        return FileResponse(new_cache_path, media_type="audio/wav", headers=custom_headers)

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
