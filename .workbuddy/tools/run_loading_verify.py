# -*- coding: utf-8 -*-
"""等编辑器编译出 LoadingScene.ts -> CDP 打开 loading 场景，验证「加载完自动进 game」。"""
import datetime
import glob
import os
import subprocess
import sys
import time

PROJ = r'F:/cocosProject/DouyinJue'
TS = os.path.join(PROJ, 'assets/script/LoadingScene.ts')
PY = r'C:/Users/CatFree/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
LOADING_URL = 'http://localhost:7456/?scene=0b399bf0-4a47-410d-90b6-c5ada4752952'
SHOT = os.path.join(PROJ, '.workbuddy/tmp/loading.png')
MARKERS = ('LoadingScene', 'preloadScene')


def find_chunk():
    for c in glob.glob(os.path.join(PROJ, 'temp/programming/packer-driver/targets/preview/chunks/*/*.js')):
        t = open(c, encoding='utf-8', errors='ignore').read()
        if all(m in t for m in MARKERS):
            return c
    return None


def main():
    src = open(TS, encoding='utf-8').read()
    open(TS, 'w', encoding='utf-8', newline='').write(src)
    print('touched', datetime.datetime.now().strftime('%H:%M:%S'), flush=True)

    deadline = time.time() + 300
    while time.time() < deadline:
        c = find_chunk()
        if c:
            print('COMPILED >', os.path.basename(c),
                  datetime.datetime.fromtimestamp(os.path.getmtime(c)).strftime('%H:%M:%S'), flush=True)
            break
        time.sleep(4)
    else:
        print('TIMEOUT: 编辑器 5 分钟内没编译出 LoadingScene', flush=True)
        return 2

    os.makedirs(os.path.dirname(SHOT), exist_ok=True)
    r = subprocess.run(
        [PY, os.path.join(PROJ, '.workbuddy/tools/cdp_probe.py'), LOADING_URL, '1',
         os.path.join(PROJ, '.workbuddy/tools/test_loading.js'), '9355', SHOT, '390', '844'],
        capture_output=True, text=True, encoding='utf-8', errors='ignore')
    print('--- probe stdout ---', flush=True)
    print(r.stdout, flush=True)
    if r.stderr.strip():
        print('--- probe stderr ---', flush=True)
        print(r.stderr[:1500], flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
