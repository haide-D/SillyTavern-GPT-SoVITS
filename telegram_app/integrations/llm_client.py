import httpx


class TelegramLlmClient:
    async def chat_completions(
        self, api_url: str, api_key: str, payload: dict, proxy: str = None
    ) -> dict:
        api_url = api_url.strip()
        if "/chat/completions" not in api_url:
            api_url = api_url.rstrip("/") + "/chat/completions"

        is_local = (
            "127.0.0.1" in api_url or "localhost" in api_url or "0.0.0.0" in api_url
        )

        kwargs = {}
        if is_local:
            kwargs["proxy"] = None
            kwargs["trust_env"] = False
        elif proxy:
            kwargs["proxy"] = proxy

        async with httpx.AsyncClient(timeout=300.0, **kwargs) as client:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            response = await client.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
