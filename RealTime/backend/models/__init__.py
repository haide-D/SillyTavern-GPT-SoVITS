# models 模块

from .request_models import (
    TTSRequest,
    InterruptRequest,
    WarmupRequest,
    SwitchRefAudioRequest
)

__all__ = [
    'TTSRequest',
    'InterruptRequest',
    'WarmupRequest',
    'SwitchRefAudioRequest'
]
