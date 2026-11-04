# -*- coding: utf-8 -*-
"""极简 CDP 探针：起 headless Chrome -> 打开页面 -> 等 -> 执行 JS -> 打印返回值 -> 可选截图 -> 关掉 Chrome。

用法:
  python cdp_probe.py <url> <waitSec> <jsFile> [port] [shot.png] [width] [height]
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

CHROME = r'C:/Program Files/Google/Chrome/Application/chrome.exe'
if not os.path.exists(CHROME):
    CHROME = r'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'


class Cdp:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, max_size=64 * 1024 * 1024)
        self.mid = 0

    def call(self, method, params=None):
        self.mid += 1
        mid = self.mid
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == mid:
                if 'error' in msg:
                    raise RuntimeError('%s -> %s' % (method, msg['error']))
                return msg.get('result', {})

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def wait_port(port, timeout=25):
    end = time.time() + timeout
    while time.time() < end:
        try:
            data = json.loads(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % port, timeout=1).read())
            for t in data:
                if t.get('type') == 'page' and t.get('webSocketDebuggerUrl'):
                    return t['webSocketDebuggerUrl']
        except Exception:
            pass
        time.sleep(0.4)
    return None


def main():
    url = sys.argv[1]
    wait_s = float(sys.argv[2])
    js_file = sys.argv[3]
    port = int(sys.argv[4]) if len(sys.argv) > 4 else 9333
    shot = sys.argv[5] if len(sys.argv) > 5 else None
    width = int(sys.argv[6]) if len(sys.argv) > 6 else 390
    height = int(sys.argv[7]) if len(sys.argv) > 7 else 844

    profile = os.path.join(tempfile.gettempdir(), 'cdp-douyinjue-%d' % port)
    proc = subprocess.Popen([
        CHROME, '--do-not-de-elevate', '--headless=new',
        '--remote-debugging-port=%d' % port, '--remote-allow-origins=*',
        '--user-data-dir=' + profile, '--enable-unsafe-swiftshader',
        '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        '--disable-features=Translate', '--mute-audio',
        '--window-size=%d,%d' % (width, height), 'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=os.path.dirname(CHROME))

    ws_url = wait_port(port)
    if not ws_url:
        proc.terminate()
        raise SystemExit('[!] Chrome 调试端口没起来')

    cdp = Cdp(ws_url)
    out = {'_ok': False}
    try:
        cdp.call('Page.enable')
        cdp.call('Runtime.enable')
        cdp.call('Network.enable')
        cdp.call('Network.setCacheDisabled', {'cacheDisabled': True})
        cdp.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 2, 'mobile': True,
        })
        cdp.call('Page.navigate', {'url': url})
        time.sleep(wait_s)

        expr = open(js_file, encoding='utf-8').read()
        res = cdp.call('Runtime.evaluate', {
            'expression': expr, 'awaitPromise': True, 'returnByValue': True,
            'userGesture': True,
        })
        if 'exceptionDetails' in res:
            out = {'_ok': False, 'exception': res['exceptionDetails']}
        else:
            out = {'_ok': True, 'value': res.get('result', {}).get('value')}

        if shot:
            img = cdp.call('Page.captureScreenshot', {'format': 'png'})
            import base64
            with open(shot, 'wb') as f:
                f.write(base64.b64decode(img['data']))
            out['_shot'] = shot
    finally:
        cdp.close()
        try:
            proc.terminate()
        except Exception:
            pass

    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
