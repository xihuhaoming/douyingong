# -*- coding: utf-8 -*-
"""最终验证：loading 场景挂载 -> 进度条推进 -> 自动进入 game。

判定：4s 时必须在 loading 且挂载了 LoadingScene；34s 时必须在 game 且 Canvas 上有 TugOfWar。
"""
import datetime
import glob
import json
import os
import subprocess
import sys
import time

PROJ = r'F:/cocosProject/DouyinJue'
TS = os.path.join(PROJ, 'assets/script/LoadingScene.ts')
PY = r'C:/Users/CatFree/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
URL = 'http://localhost:7456/?scene=0b399bf0-4a47-410d-90b6-c5ada4752952'
JS = os.path.join(PROJ, '.workbuddy/tools/test_loading_quick.js')


def find_chunk(since):
    for c in glob.glob(os.path.join(PROJ, 'temp/programming/packer-driver/targets/preview/chunks/*/*.js')):
        if os.path.getmtime(c) < since - 2:
            continue
        t = open(c, encoding='utf-8', errors='ignore').read()
        if 'LoadingScene' in t and 'overtime' in t:
            return c
    return None


def probe(wait, port):
    r = subprocess.run([PY, os.path.join(PROJ, '.workbuddy/tools/cdp_probe.py'), URL, str(wait), JS, str(port)],
                       capture_output=True, text=True, encoding='utf-8', errors='ignore')
    try:
        return json.loads(r.stdout)['value']
    except Exception:
        return {'_raw': (r.stdout or r.stderr).strip()[:300]}


def main():
    d = json.load(open(os.path.join(PROJ, 'assets/loading.scene'), encoding='utf-8'))
    canvas = next(o for o in d if isinstance(o, dict) and o.get('_name') == 'Canvas')
    types = [str(o.get('__type__')) for o in d if isinstance(o, dict) and not str(o.get('__type__')).startswith('cc.')]
    print('scene custom comps:', types, '| Canvas components:', [c.get('__id__') for c in canvas['_components']])

    t0 = time.time()
    src = open(TS, encoding='utf-8').read()
    open(TS, 'w', encoding='utf-8', newline='').write(src)
    print('touched', datetime.datetime.now().strftime('%H:%M:%S'), flush=True)

    deadline = time.time() + 300
    while time.time() < deadline:
        c = find_chunk(t0)
        if c:
            print('COMPILED >', os.path.basename(c),
                  datetime.datetime.fromtimestamp(os.path.getmtime(c)).strftime('%H:%M:%S'), flush=True)
            break
        time.sleep(4)
    else:
        print('TIMEOUT: 没编译出来', flush=True)
        return 2

    a = probe(4.0, 9381)
    print('\n[loading @4s]', json.dumps(a, ensure_ascii=False))

    b = {}
    port = 9383
    for i in range(3):
        b = probe(34.0, port)
        port += 2
        print('[跳转后 @34s try%d]' % (i + 1), json.dumps(b, ensure_ascii=False))
        if b.get('scene') == 'game':
            break

    ok = (a.get('scene') == 'loading' and a.get('hasLoadingScene')
          and b.get('scene') == 'game' and b.get('hasTugOfWar'))
    print('\nRESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
