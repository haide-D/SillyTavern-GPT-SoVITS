import re

with open('g:/Ai/SillyTavern/data/default-user/extensions/st-direct-tts/admin/js/admin.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Modify showNotification
content = re.sub(r"function showNotification\(message, type = 'info'\) \{", 
                 r"function showNotification(message, type = 'info') {\n    if (window.t) message = window.t(message);", content)

# 2. Translate textContent assignments containing Chinese
def text_replacer(match):
    prefix = match.group(1)
    val = match.group(2)
    # Check if there are Chinese characters
    if re.search(r'[\u4e00-\u9fa5]', val):
        return f'{prefix}window.t({val})'
    return match.group(0)

content = re.sub(r"(\w+\.textContent\s*=\s*)(['\"`].*?['\"`])", text_replacer, content)

# 3. Add translateDOM after renderModels
content = re.sub(r"(container\.innerHTML = models\.map\(.*?\)\.join\(''\);)",
                 r"\1\n    if (window.translateDOM) window.translateDOM(container);", content, flags=re.DOTALL)

# 4. Add translateDOM after renderAudios
content = re.sub(r"(container\.innerHTML = audios\.map\(.*?\)\.join\(''\);)",
                 r"\1\n    if (window.translateDOM) window.translateDOM(container);", content, flags=re.DOTALL)

# 5. Add translateDOM for simple innerHTML assignments containing Chinese
def html_replacer(match):
    statement = match.group(0)
    if re.search(r'[\u4e00-\u9fa5]', statement):
        # find the element variable or document.getElementById
        el_match = re.match(r'\s*([^\.]+)\.innerHTML', statement)
        if el_match:
            el = el_match.group(1)
            return f"{statement}\n        if (window.translateDOM) window.translateDOM({el});"
    return statement

content = re.sub(r"^[ \t]*.*\.innerHTML\s*=\s*['\"`].*?['\"`];$", html_replacer, content, flags=re.MULTILINE)

# 6. For select populates
content = content.replace("select.innerHTML = '<option value=\"\">选择模型...</option>' +", 
                          "select.innerHTML = '<option value=\"\">' + window.t('选择模型...') + '</option>' +")
content = content.replace("modelSelect.innerHTML = '<option value=\"\">请选择模型...</option>';",
                          "modelSelect.innerHTML = '<option value=\"\">' + window.t('请选择模型...') + '</option>';")

with open('g:/Ai/SillyTavern/data/default-user/extensions/st-direct-tts/admin/js/admin.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done rewriting admin.js')
