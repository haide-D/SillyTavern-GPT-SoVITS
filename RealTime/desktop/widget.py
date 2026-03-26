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
WIDTH = 380
HEIGHT = 580
TITLE = '实时对话'

def main():
    # 定位 HTML 文件
    here = os.path.dirname(os.path.abspath(__file__))
    html_path = os.path.join(here, 'widget.html')

    if not os.path.exists(html_path):
        print(f'[Widget] ❌ 找不到 {html_path}')
        sys.exit(1)

    # 创建窗口
    window = webview.create_window(
        TITLE,
        url=html_path,
        width=WIDTH,
        height=HEIGHT,
        resizable=True,
        frameless=True,       # 无系统边框（用自定义标题栏）
        on_top=True,          # 窗口置顶
        easy_drag=True,       # 允许拖拽标题栏
        text_select=False,    # 禁止文本选择
        min_size=(320, 400),
    )

    print(f'[Widget] 启动桌面小组件 ({WIDTH}x{HEIGHT})')
    print(f'[Widget] 确保后端已运行: python manager.py')

    # 配置浏览器引擎权限 (使用全局 webview 对象)
    try:
        webview.settings['ALLOW_FILE_ACCESS_FROM_FILES'] = True
    except Exception:
        pass

    # 读取代理配置注入引擎（解决国内 Web Speech API 报 network 错误）
    import json
    try:
        settings_path = os.path.join(here, '..', '..', 'system_settings.json')
        with open(settings_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
            proxy_cfg = cfg.get("telegram", {}).get("proxy", {})
            if proxy_cfg.get("enabled") and proxy_cfg.get("http"):
                proxy_url = proxy_cfg["http"]
                # 为 WebView2 强制设置代理
                os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--proxy-server={proxy_url}"
                print(f"[Widget] 🌍 已为浏览器引擎注入代理: {proxy_url}")
    except Exception as e:
        print(f"[Widget] ⚠️ 读取代理配置失败: {e}")

    # 启动 GUI 事件循环，加入命令行参数允许直接使用麦克风
    webview.start(
        debug=False,
        private_mode=False,
        http_server=True, # 采用内置 HTTP 协议替代 file:// 协议，有助于唤起 Web API
    )


if __name__ == '__main__':
    main()
