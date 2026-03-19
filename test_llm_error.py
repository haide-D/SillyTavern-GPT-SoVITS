import asyncio
from telegram_app.integrations.llm_client import TelegramLlmClient
from telegram_app.assets.import_models import TelegramImportRequest
from services.telegram_import_service import TelegramImportService

async def test():
    client = TelegramLlmClient()
    try:
        await client.chat_completions(
            "https://sunlea.de/v1", 
            "sk-8XVMmHY8nqguYY4SvnnjtCx3a5Hu5HxG5XCfyCk7DJPHcPrd", 
            {"model": "claude-sonnet-4.6", "messages": [{"role": "user", "content": "test"}]}
        )
        print("Success")
    except Exception as e:
        print(f"Exception Type: {type(e)}")
        print(f"Exception Str: {str(e)}")

asyncio.run(test())
