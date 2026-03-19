from typing import Any, Dict

from services.eavesdrop_service import EavesdropService
from services.phone_call_service import PhoneCallService
from services.scene_analyzer import SceneAnalyzer
from routers.eavesdrop import CompleteEavesdropRequest, complete_eavesdrop_generation
from routers.phone_call import CompleteGenerationRequest, complete_generation


class PhoneCallToolExecutor:
    """Compatibility-first executor that wraps existing services and routes."""

    def __init__(self):
        self._scene_analyzer = SceneAnalyzer()
        self._phone_call_service = PhoneCallService()
        self._eavesdrop_service = EavesdropService()

    async def execute(
        self, tool_name: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        if tool_name == "analyze_scene":
            data = await self._execute_analyze_scene(arguments)
        elif tool_name == "build_phone_call_prompt":
            data = await self._execute_build_phone_call_prompt(arguments)
        elif tool_name == "complete_phone_call_generation":
            data = await self._execute_complete_phone_call_generation(arguments)
        elif tool_name == "build_eavesdrop_prompt":
            data = await self._execute_build_eavesdrop_prompt(arguments)
        elif tool_name == "complete_eavesdrop_generation":
            data = await self._execute_complete_eavesdrop_generation(arguments)
        else:
            raise ValueError(f"Unsupported tool: {tool_name}")

        return {
            "status": "success",
            "tool": tool_name,
            "data": data,
        }

    async def _execute_analyze_scene(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        result = await self._scene_analyzer.analyze(
            context=arguments["context"],
            speakers=arguments["speakers"],
            max_context_messages=arguments.get("max_context_messages", 10),
            user_name=arguments.get("user_name"),
            call_history=arguments.get("call_history"),
        )
        return result

    async def _execute_build_phone_call_prompt(
        self, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        return await self._phone_call_service.generate(
            chat_branch=arguments["chat_branch"],
            speakers=arguments["speakers"],
            context=arguments["context"],
            generate_audio=arguments.get("generate_audio", True),
            user_name=arguments.get("user_name"),
            last_call_info=arguments.get("last_call_info"),
            call_reason=arguments.get("call_reason", ""),
            call_tone=arguments.get("call_tone", ""),
        )

    async def _execute_complete_phone_call_generation(
        self, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        request = CompleteGenerationRequest(**arguments)
        return await complete_generation(request)

    async def _execute_build_eavesdrop_prompt(
        self, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        return await self._eavesdrop_service.build_prompt(
            context=arguments["context"],
            speakers=arguments["speakers"],
            user_name=arguments.get("user_name", "用户"),
            text_lang=arguments.get("text_lang", "zh"),
            max_context_messages=arguments.get("max_context_messages", 20),
            scene_description=arguments.get("scene_description"),
            eavesdrop_config=arguments.get("eavesdrop_config"),
        )

    async def _execute_complete_eavesdrop_generation(
        self, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        request = CompleteEavesdropRequest(**arguments)
        return await complete_eavesdrop_generation(request)
