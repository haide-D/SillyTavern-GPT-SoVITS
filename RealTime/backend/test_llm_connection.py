# LLM 连接最小测试单元
# 用法: python test_llm_connection.py
# 
# 功能: 
# 1. 测试能否从 Python 后端直接调用 LLM API
# 2. 诊断 502 错误的根本原因

import httpx
import asyncio
import json
from typing import Dict


async def test_llm_minimal(
    api_url: str,
    api_key: str,
    model: str = "gpt-4o-mini",
    prompt: str = "你好，请回复'连接成功'"
) -> Dict:
    """
    最小 LLM 调用测试
    
    返回详细的诊断信息
    """
    result = {
        "success": False,
        "api_url": api_url,
        "model": model,
        "error": None,
        "response": None,
        "diagnosis": None
    }
    
    # 自动补全 URL
    if '/chat/completions' not in api_url:
        api_url = api_url.rstrip('/') + '/chat/completions'
    
    request_body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "stream": False
    }
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"  # 模拟浏览器
    }
    
    print(f"\n{'='*60}")
    print(f"🧪 LLM 连接测试")
    print(f"{'='*60}")
    print(f"📍 URL: {api_url}")
    print(f"🤖 Model: {model}")
    print(f"📝 Prompt: {prompt[:50]}...")
    print(f"\n📤 请求体:")
    print(json.dumps(request_body, ensure_ascii=False, indent=2))
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            print(f"\n⏳ 发送请求...")
            response = await client.post(
                api_url,
                headers=headers,
                json=request_body
            )
            
            print(f"\n📥 响应状态: {response.status_code}")
            print(f"📥 响应头:")
            for key, value in response.headers.items():
                print(f"   {key}: {value}")
            
            if response.status_code == 200:
                data = response.json()
                content = None
                
                # 解析响应
                if data.get("choices"):
                    message = data["choices"][0].get("message", {})
                    content = message.get("content", "")
                
                print(f"\n✅ 成功！")
                print(f"📄 响应内容: {content}")
                
                result["success"] = True
                result["response"] = content
                result["diagnosis"] = "LLM API 从 Python 后端调用正常工作"
                
            elif response.status_code == 502:
                print(f"\n❌ 502 Bad Gateway")
                print(f"📄 响应内容: {response.text[:500]}")
                
                result["error"] = f"502 Bad Gateway"
                result["diagnosis"] = """
502 错误可能的原因:
1. API 代理服务器问题（如 CloudFlare、反代服务器）
2. API 服务不接受服务器端请求（User-Agent 检测）
3. API URL 配置错误
4. API KEY 无效或过期

建议:
- 检查 API URL 是否需要走代理
- 尝试使用浏览器直接访问测试
- 检查 API KEY 是否有效
"""
            else:
                result["error"] = f"HTTP {response.status_code}: {response.text[:200]}"
                result["diagnosis"] = f"非预期的 HTTP 状态码"
                
    except httpx.ConnectError as e:
        print(f"\n❌ 连接错误: {e}")
        result["error"] = f"连接失败: {e}"
        result["diagnosis"] = "无法连接到 API 服务器，检查网络或 URL 是否正确"
        
    except httpx.TimeoutException as e:
        print(f"\n❌ 超时: {e}")
        result["error"] = f"请求超时: {e}"
        result["diagnosis"] = "请求超时，API 服务器响应过慢"
        
    except Exception as e:
        print(f"\n❌ 未知错误: {type(e).__name__}: {e}")
        result["error"] = f"{type(e).__name__}: {e}"
        result["diagnosis"] = "未知错误，请查看详细日志"
    
    print(f"\n{'='*60}")
    print(f"📊 诊断结果")
    print(f"{'='*60}")
    print(f"成功: {result['success']}")
    if result['error']:
        print(f"错误: {result['error']}")
    print(f"诊断: {result['diagnosis']}")
    
    return result


# ============================================================
# 配置区 - 修改这里的值
# ============================================================
if __name__ == "__main__":
    # TODO: 从你的 system_settings.json 复制配置
    TEST_CONFIG = {
        "api_url": "https://api.openai.com/v1",  # 改成你的 API URL
        "api_key": "sk-xxx",                      # 改成你的 API KEY
        "model": "gpt-4o-mini",                   # 改成你要测试的模型
    }
    
    print("\n" + "="*60)
    print("⚠️  请先在上方 TEST_CONFIG 中配置你的 LLM API 信息！")
    print("="*60 + "\n")
    
    # 如果配置未修改，尝试从 system_settings.json 读取
    import os
    import sys
    
    # 添加路径
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    
    try:
        from config import load_json, SETTINGS_FILE
        settings = load_json(SETTINGS_FILE)
        # LLM 配置在 phone_call.llm 路径下
        llm_config = settings.get("phone_call", {}).get("llm", {})
        
        if llm_config.get("api_key"):
            TEST_CONFIG = {
                "api_url": llm_config.get("api_url", ""),
                "api_key": llm_config.get("api_key", ""),
                "model": llm_config.get("model", "gpt-4o-mini"),
            }
            print(f"✅ 从 system_settings.json 加载配置:")
            print(f"   API URL: {TEST_CONFIG['api_url']}")
            print(f"   Model: {TEST_CONFIG['model']}")
        else:
            print("⚠️  system_settings.json 中没有找到 LLM 配置")
            print("   请手动在脚本中配置 TEST_CONFIG")
            
    except Exception as e:
        print(f"⚠️  无法读取配置文件: {e}")
        print("   请手动在脚本中配置 TEST_CONFIG")
    
    # 运行测试
    asyncio.run(test_llm_minimal(
        api_url=TEST_CONFIG["api_url"],
        api_key=TEST_CONFIG["api_key"],
        model=TEST_CONFIG["model"]
    ))
