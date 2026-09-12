import ast
import asyncio
import sqlite3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from contextlib import closing
from typing import List, Dict, Optional
from unittest.mock import AsyncMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from starlette.applications import Starlette
from starlette.routing import Mount
from middleware.ui_static_files import UIStaticFiles
from phone_call_utils.prompt_builder import PromptBuilder

class UpdateRegressions(unittest.IsolatedAsyncioTestCase):
    async def test_module_graph_version_changes_on_dependency_update(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'js').mkdir()
            (root/'index.html').write_text('<script type="module" src="js/main.js"></script>')
            (root/'js/main.js').write_text("import { close } from './ui.js';")
            (root/'js/ui.js').write_text('export const close = 1;')
            app=Starlette(routes=[Mount('/admin', UIStaticFiles(directory=tmp, html=True))])
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                first=await client.get('/admin/')
                module=await client.get('/admin/js/main.js')
                self.assertIn('main.js?v=',first.text)
                self.assertIn('ui.js?v=',module.text)
                self.assertIn('must-revalidate',module.headers['cache-control'])
                (root/'js/ui.js').write_text('export const close = 222;')
                second=await client.get('/admin/')
                self.assertNotEqual(first.text,second.text)
                self.assertNotEqual(module.text,(await client.get('/admin/js/main.js')).text)
                self.assertEqual((await client.get('/admin/../secret')).status_code,404)

    async def test_scheduler_keeps_pending_record_and_passes_background(self):
        tree=ast.parse(Path('services/auto_call_scheduler.py').read_text(encoding='utf-8'))
        cls=next(n for n in tree.body if isinstance(n,ast.ClassDef))
        ns=dict(asyncio=asyncio,List=List,Dict=Dict,Optional=Optional)
        exec(compile(ast.Module(body=[cls],type_ignores=[]),'scheduler','exec'),ns)
        Scheduler=ns['AutoCallScheduler']
        with tempfile.TemporaryDirectory() as tmp:
            path=str(Path(tmp)/'calls.db')
            conn=sqlite3.connect(path)
            conn.execute('CREATE TABLE auto_phone_calls (id INTEGER PRIMARY KEY, chat_branch TEXT, context_fingerprint TEXT, status TEXT, UNIQUE(chat_branch,context_fingerprint))')
            conn.execute("INSERT INTO auto_phone_calls VALUES (1,'chat','fp','generating')")
            conn.commit();conn.close()
            class DB:
                def _get_connection(self): return sqlite3.connect(path)
                def is_auto_call_generated(self,*args): return False
                def update_auto_call_status(self,*args,**kwargs): pass
                def get_auto_call_history_by_chat_branch(self,*args,**kwargs):
                    return [{'status':'generating','char_name':'Alice'}, {'status':'completed','char_name':'Alice','segments':[{'text':'previous call'}]}]
            scheduler=Scheduler.__new__(Scheduler);scheduler.db=DB();scheduler._running_tasks=set()
            scheduler.phone_call_service=types.SimpleNamespace(build_prompt=AsyncMock(return_value={'prompt':'prompt','llm_config':{}}))
            self.assertIsNone(await scheduler.schedule_auto_call('chat',['Alice'],1,[], 'fp'))
            with closing(sqlite3.connect(path)) as c: self.assertEqual(c.execute('SELECT status FROM auto_phone_calls').fetchone()[0],'generating')
            notify=AsyncMock()
            module=types.ModuleType('services.notification_service');module.NotificationService=lambda: types.SimpleNamespace(notify_llm_request=notify)
            with patch.dict(sys.modules,{'services.notification_service':module}):
                await scheduler._execute_generation(2,'chat',['Alice'],1,[{'mes':'latest'}],'User','Alice','reason','tone',None,'persona','lore')
            args=scheduler.phone_call_service.build_prompt.call_args.kwargs
            self.assertEqual(args['world_info'],'lore');self.assertEqual(args['character_persona'],'persona')
            self.assertEqual(args['call_reason'],'reason');self.assertEqual(args['context'],[{'mes':'latest'}])
            self.assertEqual(args['last_call_info']['status'],'completed')
            notify.assert_awaited_once()
            self.assertFalse(scheduler._running_tasks)

    async def test_duplicate_completion_synthesizes_only_once(self):
        import json, re
        tree=ast.parse(Path('services/phone_call_service.py').read_text(encoding='utf-8'))
        cls=next(n for n in tree.body if isinstance(n,ast.ClassDef))
        method=next(n for n in cls.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='complete_generation')
        ns=dict(List=List, Dict=Dict, Optional=Optional, Any=object, json=json, re=re, load_json=lambda _: {}, SETTINGS_FILE='', HTTPException=RuntimeError)
        exec(compile(ast.Module(body=[method],type_ignores=[]),'completion','exec'),ns)
        with tempfile.TemporaryDirectory() as tmp:
            path=str(Path(tmp)/'calls.db')
            with closing(sqlite3.connect(path)) as c:
                c.execute('CREATE TABLE auto_phone_calls (id INTEGER PRIMARY KEY, chat_branch TEXT, status TEXT, char_name TEXT, audio_path TEXT, audio_url TEXT, segments TEXT)')
                c.execute("INSERT INTO auto_phone_calls (id,chat_branch,status) VALUES (1,'chat','generating')")
                c.commit()
            started=asyncio.Event();release=asyncio.Event()
            async def synthesize(**kwargs):
                started.set();await release.wait();return b'audio',[]
            service=types.SimpleNamespace(
                db=types.SimpleNamespace(_get_connection=lambda:sqlite3.connect(path)),
                emotion_service=types.SimpleNamespace(get_available_emotions=lambda _:['neutral']),
                response_parser=types.SimpleNamespace(parse_json_response=lambda *a,**kw:[]),
                audio_pipeline=types.SimpleNamespace(synthesize_segments=AsyncMock(side_effect=synthesize)),
                notification_service=types.SimpleNamespace(notify_phone_call_ready=AsyncMock()),
                _save_audio=AsyncMock(return_value=('path','url')), _cleanup_running_task=lambda _:None)
            args=(service,1,'{"speaker":"Alice"}','chat',['Alice'])
            first=asyncio.create_task(ns['complete_generation'](*args))
            await started.wait()
            duplicate=await ns['complete_generation'](*args)
            self.assertEqual(duplicate['status'],'duplicate')
            release.set()
            self.assertEqual((await first)['status'],'success')
            self.assertEqual((await ns['complete_generation'](*args))['status'],'duplicate')
            service.audio_pipeline.synthesize_segments.assert_awaited_once()
            service.notification_service.notify_phone_call_ready.assert_awaited_once()

    async def test_websocket_payload_preserves_trigger_snapshot(self):
        tree=ast.parse(Path('routers/phone_call.py').read_text(encoding='utf-8'))
        messages=[node for node in ast.walk(tree) if isinstance(node,ast.Dict)
                  and any(isinstance(v,ast.Constant) and v.value=='continuous_analysis_request' for v in node.values)]
        self.assertEqual(len(messages),1)
        payload={key.value:ast.unparse(value) for key,value in zip(messages[0].keys,messages[0].values)}
        for field in ['context','character_persona','world_info']:
            self.assertEqual(payload[field],f"analysis_data['{field}']")

    async def test_custom_call_template_cannot_drop_background(self):
        prompt=PromptBuilder.build(template='Custom JSON',char_name='Alice',context=[{'mes':'latest nickname','name':'Alice','is_user':False}],extracted_data={},emotions=['neutral'],user_name='User',world_info='lore rule',character_persona='persona rule',last_call_info={'char_name':'Alice','segments':[{'text':'old call'}]})
        for text in ['latest nickname','lore rule','persona rule','old call','称呼连续性']:
            self.assertIn(text,prompt)

if __name__=='__main__': unittest.main()
