def get_phone_call_tools() -> list[dict]:
    """Return structured tool definitions for phone/eavesdrop capabilities."""
    return [
        {
            "type": "function",
            "function": {
                "name": "analyze_scene",
                "description": "Analyze recent context and decide whether a phone call, eavesdrop scene, or no action is appropriate.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "context": {
                            "type": "array",
                            "description": "Conversation context items.",
                            "items": {"type": "object"},
                        },
                        "speakers": {
                            "type": "array",
                            "description": "Available character names.",
                            "items": {"type": "string"},
                        },
                        "max_context_messages": {
                            "type": "integer",
                            "description": "Maximum number of recent messages to analyze.",
                            "default": 10,
                        },
                        "user_name": {
                            "type": "string",
                            "description": "Optional user display name for disambiguation.",
                        },
                        "call_history": {
                            "type": "array",
                            "description": "Optional recent phone call history records.",
                            "items": {"type": "object"},
                        },
                    },
                    "required": ["context", "speakers"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "build_phone_call_prompt",
                "description": "Build the prompt and config for a phone call generation flow without changing the current two-stage workflow.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chat_branch": {
                            "type": "string",
                            "description": "Conversation branch identifier.",
                        },
                        "speakers": {
                            "type": "array",
                            "description": "Candidate caller names.",
                            "items": {"type": "string"},
                        },
                        "context": {
                            "type": "array",
                            "description": "Conversation context items.",
                            "items": {"type": "object"},
                        },
                        "user_name": {
                            "type": "string",
                            "description": "Optional user display name.",
                        },
                        "last_call_info": {
                            "type": "object",
                            "description": "Optional last call summary metadata for follow-up calls.",
                        },
                        "call_reason": {
                            "type": "string",
                            "description": "Optional analyzed call reason.",
                            "default": "",
                        },
                        "call_tone": {
                            "type": "string",
                            "description": "Optional desired tone for the call.",
                            "default": "",
                        },
                        "generate_audio": {
                            "type": "boolean",
                            "description": "Compatibility flag kept for parity with existing service input.",
                            "default": true,
                        },
                    },
                    "required": ["chat_branch", "speakers", "context"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "complete_phone_call_generation",
                "description": "Complete phone call generation from an LLM response, including parsing, audio generation, database updates, and notification side effects.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "call_id": {
                            "type": "integer",
                            "description": "Existing auto phone call record id.",
                        },
                        "llm_response": {
                            "type": "string",
                            "description": "LLM JSON response for the phone call.",
                        },
                        "chat_branch": {
                            "type": "string",
                            "description": "Conversation branch identifier.",
                        },
                        "speakers": {
                            "type": "array",
                            "description": "Allowed speaker names.",
                            "items": {"type": "string"},
                        },
                        "char_name": {
                            "type": "string",
                            "description": "Optional primary character name used for websocket routing.",
                        },
                    },
                    "required": ["call_id", "llm_response", "chat_branch", "speakers"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "build_eavesdrop_prompt",
                "description": "Build the prompt and config for a multi-speaker private conversation scene.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "context": {
                            "type": "array",
                            "description": "Conversation context items.",
                            "items": {"type": "object"},
                        },
                        "speakers": {
                            "type": "array",
                            "description": "Characters participating in the private conversation.",
                            "items": {"type": "string"},
                        },
                        "user_name": {
                            "type": "string",
                            "description": "Optional user display name.",
                            "default": "用户",
                        },
                        "text_lang": {
                            "type": "string",
                            "description": "Target language for generated speech text.",
                            "default": "zh",
                        },
                        "max_context_messages": {
                            "type": "integer",
                            "description": "Maximum number of recent messages to include.",
                            "default": 20,
                        },
                        "scene_description": {
                            "type": "string",
                            "description": "Optional scene description.",
                        },
                        "eavesdrop_config": {
                            "type": "object",
                            "description": "Optional analyzed topic/tension guidance.",
                        },
                    },
                    "required": ["context", "speakers"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "complete_eavesdrop_generation",
                "description": "Complete a private conversation generation from an LLM response, including audio generation, database updates, and websocket notification side effects.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "record_id": {
                            "type": "integer",
                            "description": "Existing eavesdrop record id.",
                        },
                        "llm_response": {
                            "type": "string",
                            "description": "LLM JSON response for the private conversation.",
                        },
                        "chat_branch": {
                            "type": "string",
                            "description": "Conversation branch identifier.",
                        },
                        "speakers": {
                            "type": "array",
                            "description": "Speakers included in the result.",
                            "items": {"type": "string"},
                        },
                        "char_name": {
                            "type": "string",
                            "description": "Optional primary character name used for websocket routing.",
                        },
                        "text_lang": {
                            "type": "string",
                            "description": "Target language for generated speech text.",
                            "default": "zh",
                        },
                    },
                    "required": [
                        "record_id",
                        "llm_response",
                        "chat_branch",
                        "speakers",
                    ],
                },
            },
        },
    ]
