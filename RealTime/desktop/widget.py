"""
桌面小组件启动器 - PyWebView

创建一个无边框、置顶的桌面窗口，加载实时对话 UI。
"""

import webview
import os
import sys

# 修复 Windows cmd 下 gbk 编码无法输出 emoji 导致崩溃的问题
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# 窗口配置
CHAT_WIDTH = 380
CHAT_HEIGHT = 580
CHAT_TITLE = '实时对话'

LIVE2D_WIDTH = 400
LIVE2D_HEIGHT = 500
LIVE2D_TITLE = 'Live2D'

def main():
    # 定位 HTML 文件
    here = os.path.dirname(os.path.abspath(__file__))
    html_path = os.path.join(here, 'widget.html')
    live2d_path = os.path.join(here, 'live2d.html')

    if not os.path.exists(html_path):
        print(f'[Widget] ❌ 找不到 {html_path}')
        sys.exit(1)

    # 读取代理配置注入引擎（需要在创建窗口前设置环境变量）
    import json
    try:
        settings_path = os.path.join(here, '..', '..', 'system_settings.json')
        with open(settings_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
            proxy_cfg = cfg.get("telegram", {}).get("proxy", {})
            if proxy_cfg.get("enabled") and proxy_cfg.get("http"):
                proxy_url = proxy_cfg["http"]
                os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--proxy-server={proxy_url}"
                print(f"[Widget] 🌍 已为浏览器引擎注入代理: {proxy_url}")
    except Exception as e:
        print(f"[Widget] ⚠️ 读取代理配置失败: {e}")

    # 配置浏览器引擎权限
    try:
        webview.settings['ALLOW_FILE_ACCESS_FROM_FILES'] = True
    except Exception:
        pass

    # 创建聊天窗口
    chat_window = webview.create_window(
        CHAT_TITLE,
        url=html_path,
        width=CHAT_WIDTH,
        height=CHAT_HEIGHT,
        resizable=True,
        frameless=True,
        on_top=True,
        easy_drag=True,
        text_select=False,
        min_size=(320, 400),
    )

    # 创建 Live2D 独立窗口
    if os.path.exists(live2d_path):
        live2d_window = webview.create_window(
            LIVE2D_TITLE,
            url=live2d_path,
            width=LIVE2D_WIDTH,
            height=LIVE2D_HEIGHT,
            resizable=True,
            frameless=True,
            on_top=True,
            easy_drag=True,
            text_select=False,
            transparent=True,
            min_size=(200, 250),
        )
        print(f'[Widget] Live2D 独立窗口 ({LIVE2D_WIDTH}x{LIVE2D_HEIGHT})')
    else:
        print(f'[Widget] ⚠️ Live2D 页面不存在，跳过: {live2d_path}')

    print(f'[Widget] 启动桌面小组件 ({CHAT_WIDTH}x{CHAT_HEIGHT})')
    print(f'[Widget] 确保后端已运行: python manager.py')

    # 启动 GUI 事件循环
    webview.start(
        debug=True,
        private_mode=False,
        http_server=True,
    )


if __name__ == '__main__':
    main()
