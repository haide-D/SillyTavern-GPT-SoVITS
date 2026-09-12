import ast
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from phone_call_utils.prompt_builder import PromptBuilder

class PromptRegressions(unittest.TestCase):
    def test_alignment_rules_cover_every_template_path(self):
        for options in ({}, {'eavesdrop_config': {'conversation_theme': 'test'}}, {'template': 'Custom {{lang_display}} {{context}}'}):
            with self.subTest(options=options):
                prompt = PromptBuilder.build_eavesdrop_prompt(
                    context=[{'name': 'Alice', 'mes': 'latest story', 'is_user': False}],
                    speakers_emotions={'Alice': ['neutral']}, user_name='User', text_lang='ja', **options)
                self.assertIn('latest story', prompt)
                self.assertIn('text 是唯一会送去配音的完整台词，必须使用日文', prompt)
                self.assertIn('尤其最后一个分句', prompt)
                self.assertIn('逐段双向核对', prompt)

    def test_automatic_call_receives_request_context(self):
        tree = ast.parse(Path('routers/continuous_analysis.py').read_text(encoding='utf-8'))
        contexts = [kw.value for node in ast.walk(tree) if isinstance(node, ast.Call)
                    for kw in node.keywords if kw.arg == 'context']
        self.assertFalse(any(isinstance(value, ast.List) and not value.elts for value in contexts))
        self.assertGreaterEqual(sum(ast.unparse(value) == 'req.context or []' for value in contexts), 2)

if __name__ == '__main__':
    unittest.main()
