import httpx


class TelegramLlmClient:
    async def chat_completions(self, api_url: str, api_key: str, payload: dict) -> dict:
        api_url = api_url.strip()
        if "/chat/completions" not in api_url:
            api_url = api_url.rstrip("/") + "/chat/completions"

        async with httpx.AsyncClient(timeout=300.0) as client:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            response = await client.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
