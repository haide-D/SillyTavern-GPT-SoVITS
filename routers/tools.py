import json
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from phone_call_tools import PhoneCallToolExecutor, get_phone_call_tools

router = APIRouter(prefix="/api/tools", tags=["Tools"])
tool_executor = PhoneCallToolExecutor()


class ToolExecuteRequest(BaseModel):
    tool_name: str = Field(..., description="Tool function name")
    arguments: Dict[str, Any] = Field(
        default_factory=dict, description="Tool arguments"
    )


class ToolBatchExecuteRequest(BaseModel):
    calls: List[ToolExecuteRequest] = Field(
        ..., description="Tool calls to execute sequentially"
    )


@router.get("/phone_call")
async def list_phone_call_tools():
    return {
        "status": "success",
        "tools": get_phone_call_tools(),
    }


@router.post("/execute")
async def execute_tool(req: ToolExecuteRequest):
    try:
        return await tool_executor.execute(req.tool_name, req.arguments)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch_execute")
async def batch_execute_tools(req: ToolBatchExecuteRequest):
    results = []
    for call in req.calls:
        try:
            result = await tool_executor.execute(call.tool_name, call.arguments)
        except HTTPException as exc:
            results.append(
                {
                    "status": "error",
                    "tool": call.tool_name,
                    "error": {
                        "status_code": exc.status_code,
                        "detail": exc.detail,
                    },
                }
            )
            continue
        except Exception as exc:
            results.append(
                {
                    "status": "error",
                    "tool": call.tool_name,
                    "error": {"detail": str(exc)},
                }
            )
            continue

        results.append(result)

    return {
        "status": "success",
        "results": results,
    }


@router.post("/execute_from_tool_call")
async def execute_from_tool_call(payload: Dict[str, Any]):
    try:
        function_payload = payload.get("function", {})
        tool_name = function_payload.get("name") or payload.get("tool_name")
        raw_arguments = function_payload.get("arguments", payload.get("arguments", {}))

        if isinstance(raw_arguments, str):
            raw_arguments = json.loads(raw_arguments or "{}")

        if not isinstance(raw_arguments, dict):
            raise ValueError("Tool arguments must decode to an object")

        return await tool_executor.execute(tool_name, raw_arguments)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
