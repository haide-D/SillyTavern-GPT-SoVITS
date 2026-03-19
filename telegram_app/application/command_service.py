from typing import Optional

from telegram_app.application.session_service import TelegramSessionService
from telegram_app.assets.repository import TelegramAssetRepository
from telegram_app.domain.history import SessionHistoryRepository
from telegram_app.integrations.user_repository import TelegramUserRepository
from telegram_app.settings import TelegramSettings


class TelegramCommandService:
    def __init__(
        self,
        history_repo: SessionHistoryRepository,
        user_repo: TelegramUserRepository,
        session_service: TelegramSessionService,
        asset_repo: Optional[TelegramAssetRepository] = None,
    ):
        self._history = history_repo
        self._users = user_repo
        self._sessions = session_service
        self._assets = asset_repo or TelegramAssetRepository()

    def handle_start(self, chat_id: str, settings: TelegramSettings) -> str:
        session = self._sessions.ensure_active_session(chat_id, settings)
        return (
            "多 Bot 导演模式已就绪。\n"
            f"当前模式: {session.mode}\n"
            f"当前命名空间: {session.namespace_key}\n"
            f"当前资产包: {session.asset_pack_id or '-'}\n"
            "使用 /mode 切模式，/story <id> 切剧本，/pack 查看或绑定资产包。"
        )

    def handle_clear(self, chat_id: str, settings: TelegramSettings) -> str:
        session = self._sessions.ensure_active_session(chat_id, settings)
        self._history.clear_history(session.namespace_key)
        return f"已清空当前会话命名空间历史: {session.namespace_key}"

    def handle_mode(
        self, chat_id: str, settings: TelegramSettings, mode: Optional[str]
    ) -> str:
        if not mode:
            session = self._sessions.ensure_active_session(chat_id, settings)
            return (
                f"当前模式: {session.mode}\n"
                f"命名空间: {session.namespace_key}\n"
                f"资产包: {session.asset_pack_id or '-'}"
            )
        session = self._sessions.switch_mode(chat_id, settings, mode=mode)
        return (
            f"已切换模式到 {session.mode}\n"
            f"命名空间: {session.namespace_key}\n"
            f"资产包: {session.asset_pack_id or '-'}"
        )

    def handle_story(
        self, chat_id: str, settings: TelegramSettings, story_id: Optional[str]
    ) -> str:
        if not story_id:
            sessions = self._sessions.list_sessions(chat_id)
            if not sessions:
                return "当前没有已保存剧本会话。"
            lines = ["当前群聊已存在的会话："]
            for item in sessions[:10]:
                marker = "*" if item.get("is_active") else "-"
                lines.append(
                    f"{marker} {item.get('mode')} | story={item.get('story_id') or '-'} | pack={item.get('asset_pack_id') or '-'} | {item.get('namespace_key')}"
                )
            return "\n".join(lines)

        session = self._sessions.switch_mode(
            chat_id,
            settings,
            mode="scripted_story",
            story_id=story_id,
            title=story_id,
        )
        return (
            f"已切换到剧本 {story_id}\n"
            f"旧剧本记忆已冻结，新命名空间为: {session.namespace_key}\n"
            f"当前资产包: {session.asset_pack_id or '-'}"
        )

    def handle_pack(
        self, chat_id: str, settings: TelegramSettings, pack_id: Optional[str]
    ) -> str:
        if not pack_id:
            session = self._sessions.ensure_active_session(chat_id, settings)
            packs = self._assets.list_packs()
            lines = [f"当前资产包: {session.asset_pack_id or '-'}"]
            if packs:
                lines.append("可用资产包:")
                for item in packs[:20]:
                    marker = "*" if item["pack_id"] == session.asset_pack_id else "-"
                    lines.append(
                        f"{marker} {item['pack_id']} | {item['name']} | {item['source']}"
                    )
            else:
                lines.append(
                    "当前没有可用资产包。请先在 assets/telegram_packs 下放入 json 文件。"
                )
            return "\n".join(lines)

        pack = self._assets.get_pack(pack_id)
        if not pack:
            return f"未找到资产包: {pack_id}"
        session = self._sessions.bind_asset_pack(chat_id, settings, pack.pack_id)
        return (
            f"已绑定资产包 {pack.pack_id}\n"
            f"当前命名空间: {session.namespace_key}\n"
            f"角色数: {len(pack.characters)} | 剧本数: {len(pack.stories)}"
        )

    def handle_setpersona(self, user, chat_id: str, persona_text: str) -> str:
        success = self._users.set_user_persona(str(user.id), persona_text)
        if success:
            self._users.update_user_activity(user, chat_id)
            display_name = self._users.get_user_display_name(user)
            return f"已为您 [{display_name}] 设定群聊人设：\n{persona_text}"
        return "人设设定失败，请检查终端日志。"

    def handle_whoami(self, user) -> str:
        persona = self._users.get_user_persona(str(user.id))
        display_name = self._users.get_user_display_name(user)
        if persona:
            return f"您的身份是 [{display_name}]\n当前人设设定为:\n{persona}"
        return f"您的身份是 [{display_name}]\n当前并未设定自定义人设。使用 /setpersona 马上设定！"
