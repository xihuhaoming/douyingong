# -*- coding: utf-8 -*-
"""touch TugOfWar.ts -> 等编辑器重新编译 -> CDP 真机跑 test_range.js。"""
import datetime
import glob
import os
import subprocess
import sys
import time

PROJ = r'F:/cocosProject/DouyinJue'
TS = os.path.join(PROJ, 'assets/script/TugOfWar.ts')
PY = r'C:/Users/CatFree/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
URL = 'http://localhost:7456/?scene=14bdd3ab-93f9-4d6e-9a2b-e33435a291f9'
SHOT = os.path.join(PROJ, '.workbuddy/tmp/range.png')


def find_chunk():
    for c in glob.glob(os.path.join(PROJ, 'temp/programming/packer-driver/targets/preview/chunks/*/*.js')):
        t = open(c, encoding='utf-8', errors='ignore').read()
        if 'TugOfWar' in t and 'chainX' in t and 'spanX' in t:
            return c
    return None


def main():
    src = open(TS, encoding='utf-8').read()
    open(TS, 'w', encoding='utf-8', newline='').write(src)
    print('touched', datetime.datetime.now().strftime('%H:%M:%S'), flush=True)

    for i in range(75):
        c = find_chunk()
        if c:
            print('COMPILED >', os.path.basename(c),
                  datetime.datetime.fromtimestamp(os.path.getmtime(c)).strftime('%H:%M:%S'), flush=True)
            break
        time.sleep(4)
    else:
        print('TIMEOUT: 编辑器 5 分钟内没重新编译（packer 又停摆了）', flush=True)
        return 2

    os.makedirs(os.path.dirname(SHOT), exist_ok=True)
    r = subprocess.run(
        [PY, os.path.join(PROJ, '.workbuddy/tools/cdp_probe.py'), URL, '16',
         os.path.join(PROJ, '.workbuddy/tools/test_range.js'), '9351', SHOT, '390', '844'],
        capture_output=True, text=True, encoding='utf-8', errors='ignore')
    print('--- probe stdout ---', flush=True)
    print(r.stdout, flush=True)
    if r.stderr.strip():
        print('--- probe stderr ---', flush=True)
        print(r.stderr[:1500], flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
