import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import motor_repost as m


class UrlTests(unittest.TestCase):
    def test_profile(self):
        self.assertEqual(m.profile_name('https://www.tiktok.com/@futuroinexplicavel?lang=pt'), 'futuroinexplicavel')
        with self.assertRaises(ValueError):
            m.profile_name('http://www.tiktok.com/@abc')
        with self.assertRaises(ValueError):
            m.profile_name('https://badexample.com/@abc')
        with self.assertRaises(ValueError):
            m.profile_name('https://www.tiktok.com/@abc/video/1234567890123456789')

    def test_video_url(self):
        match = m.canonical_video('https://www.tiktok.com/@futuroinexplicavel/video/7696270806078246162?lang=pt', 'futuroinexplicavel')
        self.assertEqual(match, ('7696270806078246162', 'https://www.tiktok.com/@futuroinexplicavel/video/7696270806078246162'))
        self.assertIsNone(m.canonical_video('https://www.tiktok.com/@another/video/7696270806078246162', 'futuroinexplicavel'))

    def test_incremental_store_and_duplicate(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(m, 'DATA', Path(d)):
                state = m.load_manifest('profile')
                self.assertEqual(m.add_links('profile', state, {'7696270806078246162':'https://www.tiktok.com/@profile/video/7696270806078246162'}),1)
                self.assertEqual(m.add_links('profile', state, {'7696270806078246162':'https://www.tiktok.com/@profile/video/7696270806078246162'}),0)
                state2 = m.load_manifest('profile')
                self.assertEqual(len(state2['videos']),1)
                self.assertEqual(len((Path(d)/'profile'/'urls.txt').read_text(encoding='utf-8').splitlines()),1)

    def test_links_on_page(self):
        class Page:
            def eval_on_selector_all(self, selector, js):
                return [
                    'https://www.tiktok.com/@abc/video/7696270806078246162?foo=bar',
                    'https://www.tiktok.com/@abc/video/7696270806078246162',
                    'https://www.tiktok.com/@other/video/7696270806078246161',
                    'https://example.com/@abc/video/7696270806078246160',
                ]
        self.assertEqual(len(m.links_on_page(Page(), 'abc')), 1)


if __name__ == '__main__':
    unittest.main()

class DownloadTests(unittest.TestCase):
    def test_download_and_skip_existing_file(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as d:
            temp = Path(d)
            with patch.object(m, 'DATA', temp / 'dados'), patch.object(m, 'DOWNLOADS', temp / 'downloads'):
                user = 'abc'
                video_id = '7696270806078246162'
                state = m.load_manifest(user)
                m.add_links(user, state, {video_id: f'https://www.tiktok.com/@{user}/video/{video_id}'})
                def fake_run(command, **kwargs):
                    self.assertIn('yt_dlp', command)
                    self.assertIn(m.PREFERRED_FORMAT, command)
                    folder = m.DOWNLOADS / user
                    folder.mkdir(parents=True, exist_ok=True)
                    (folder / f'{video_id}.mp4').write_bytes(b'fakefile')
                    return SimpleNamespace(returncode=0, stdout='ok', stderr='')
                with patch.object(m.subprocess, 'run', side_effect=fake_run) as runner:
                    success, fail = m.download_batch(user, state, lambda _:None, lambda:False)
                    self.assertEqual((success,fail),(1,0))
                    success, fail = m.download_batch(user, state, lambda _:None, lambda:False)
                    self.assertEqual((success,fail),(1,0))
                    self.assertEqual(runner.call_count,1)
                self.assertEqual(m.load_manifest(user)['videos'][video_id]['status'],'downloaded')

class ScanTests(unittest.TestCase):
    def test_browser_scan_collects_across_scrolls_and_persists(self):
        import sys
        from types import ModuleType, SimpleNamespace
        class MockPage:
            def __init__(self):
                self.scrolls=0
                self.mouse=SimpleNamespace(wheel=self.wheel)
            def goto(self, *args, **kwargs):
                return None
            def wait_for_timeout(self, *args):
                pass
            def wheel(self, *args):
                self.scrolls += 1
            def eval_on_selector_all(self, selector, js):
                urls = ['https://www.tiktok.com/@abc/video/7696270806078246162']
                if self.scrolls >= 2:
                    urls.append('https://www.tiktok.com/@abc/video/7696180816719875336')
                return urls
        page=MockPage()
        context=SimpleNamespace(pages=[page],close=lambda: None)
        class Ctx:
            def __enter__(self):
                return SimpleNamespace(chromium=SimpleNamespace(launch_persistent_context=lambda *a,**kw:context))
            def __exit__(self,*args):
                return False
        module=ModuleType('playwright.sync_api')
        module.sync_playwright=lambda: Ctx()
        with tempfile.TemporaryDirectory() as d:
            temp=Path(d)
            with patch.dict(sys.modules,{'playwright':ModuleType('playwright'),'playwright.sync_api':module}), patch.object(m,'DATA',temp/'dados'), patch.object(m,'BROWSER_DIR',temp/'dados'/'browser'):
                state=m.load_manifest('abc')
                new=m.scan_profile('abc',state, lambda _:None,lambda:False)
                self.assertEqual(new,2)
                self.assertEqual(len(m.load_manifest('abc')['videos']),2)
                self.assertGreaterEqual(page.scrolls,10)
