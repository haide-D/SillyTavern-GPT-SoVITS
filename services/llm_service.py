import httpx
from typing import Dict, Optional


class LLMService:
    """LLM交互服务"""
    
    @staticmethod
    async def call(config: Dict, prompt: str) -> str:
        """
        调用LLM API (支持多种响应格式)
        
        Args:
            config: LLM配置 {api_url, api_key, model, temperature, max_tokens, ...}
            prompt: 提示词
            
        Returns:
            LLM响应文本
        """
        api_url = config.get("api_url")
        api_key = config.get("api_key")
        model = config.get("model")
        temperature = config.get("temperature", 0.8)
        max_tokens = config.get("max_tokens")
        
        if not api_url or not api_key or not model:
            raise ValueError("缺少必要的LLM配置: api_url, api_key, model")
        
        request_body = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
            "stream": False
        }
        
        if max_tokens:
            request_body["max_tokens"] = max_tokens
        
        for key in ["top_p", "frequency_penalty", "presence_penalty"]:
            if key in config and config[key] is not None:
                request_body[key] = config[key]
        
        print(f"[LLM] 请求URL: {api_url}")
        print(f"[LLM] 模型: {model}")
        print(f"[LLM] 请求体: {request_body}")
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    },
                    json=request_body
                )
                
                print(f"[LLM] 响应状态: {response.status_code}")
                
                response.raise_for_status()
                data = response.json()
                
                print(f"[LLM] 响应结构预览: {str(data)[:500]}")
                
                content = LLMService.parse_response(data)
                print(f"[LLM] ✅ 成功获取响应,长度: {len(content)}")
                
                return content
                
            except httpx.HTTPStatusError as e:
                error_msg = f"HTTP错误 {e.response.status_code}: {e.response.text[:200]}"
                print(f"[LLM] ❌ {error_msg}")
                raise Exception(error_msg)
            except httpx.RequestError as e:
                error_msg = f"请求错误: {str(e)}"
                print(f"[LLM] ❌ {error_msg}")
                raise Exception(error_msg)
            except Exception as e:
                error_msg = f"未知错误: {str(e)}"
                print(f"[LLM] ❌ {error_msg}")
                raise Exception(error_msg)
    
    @staticmethod
    def parse_response(data: Dict) -> str:
        """
        解析多种格式的LLM响应
        
        支持7种响应格式:
        1. OpenAI标准: choices[0].message.content
        2. 推理模型: choices[0].message.reasoning_content
        3. 简化格式: choices[0].text
        4. 直接字段: content
        5. Output字段: output
        6. Response字段: response
        7. Result字段: result
        """
        content = None
        
        if data.get("choices") and len(data["choices"]) > 0:
            message = data["choices"][0].get("message", {})
            if message.get("content"):
                content = message["content"].strip()
            elif message.get("reasoning_content"):
                content = message["reasoning_content"].strip()
            elif data["choices"][0].get("text"):
                content = data["choices"][0]["text"].strip()
        
        if not content and data.get("content"):
            content = data["content"].strip()
        
        if not content and data.get("output"):
            content = data["output"].strip()
        
        if not content and data.get("response"):
            content = data["response"].strip()
        
        if not content and data.get("result"):
            result = data["result"]
            content = result.strip() if isinstance(result, str) else str(result)
        
        if not content:
            raise ValueError(f"无法解析LLM响应,响应格式不兼容: {str(data)[:200]}")
        
        return content
    
    @staticmethod
    async def test_connection(config: Dict) -> Dict:
        """
        测试LLM连接
        
        Args:
            config: LLM配置,包含test_prompt字段
            
        Returns:
            测试结果字典
        """
        test_prompt = config.get("test_prompt", "你好,请回复'测试成功'")
        
        try:
            response = await LLMService.call(config, test_prompt)
            
            return {
                "status": "success",
                "message": "LLM连接测试成功",
                "config": {
                    "api_url": config.get("api_url"),
                    "model": config.get("model"),
                    "temperature": config.get("temperature"),
                    "max_tokens": config.get("max_tokens")
                },
                "test_prompt": test_prompt,
                "response": response,
                "response_length": len(response)
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"LLM连接测试失败: {str(e)}",
                "config": {
                    "api_url": config.get("api_url"),
                    "model": config.get("model")
                },
                "error_detail": str(e)
            }
