# -*- coding: utf-8 -*-
"""给 DouyinJue/game.scene 的 Canvas 挂上 TugOfWar 组件（幂等，可重跑）"""
import json
import os
import random
import string
import uuid

PROJ = r'F:/cocosProject/DouyinJue'
SCENE = os.path.join(PROJ, 'assets/game.scene')
TS_REL = 'assets/script/TugOfWar.ts'

B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'


def compress_uuid(u: str) -> str:
    h = u.replace('-', '')
    head, rest, out = h[:5], h[5:], []
    for i in range(0, len(rest), 3):
        v = int(rest[i:i + 3].ljust(3, '0'), 16)
        out.append(B64[v >> 6])
        out.append(B64[v & 0x3F])
    return head + ''.join(out)


def rand_id(n=22):
    return ''.join(random.choice(B64) for _ in range(n))


# ---------------------------------------------------------------- meta
script_dir = os.path.join(PROJ, 'assets/script')
os.makedirs(script_dir, exist_ok=True)

dir_meta = os.path.join(PROJ, 'assets/script.meta')
if not os.path.exists(dir_meta):
    with open(dir_meta, 'w', encoding='utf-8', newline='') as f:
        json.dump({
            'ver': '1.2.0', 'importer': 'directory', 'imported': True,
            'uuid': str(uuid.uuid4()), 'files': [], 'subMetas': {}, 'userData': {},
        }, f, ensure_ascii=False, indent=2)
    print('[new] assets/script.meta')

ts_meta = os.path.join(PROJ, TS_REL + '.meta')
if os.path.exists(ts_meta):
    ts_uuid = json.load(open(ts_meta, encoding='utf-8'))['uuid']
    print('[reuse] ts uuid', ts_uuid)
else:
    ts_uuid = str(uuid.uuid4())
    with open(ts_meta, 'w', encoding='utf-8', newline='') as f:
        json.dump({
            'ver': '4.0.24', 'importer': 'typescript', 'imported': True,
            'uuid': ts_uuid, 'files': [], 'subMetas': {}, 'userData': {},
        }, f, ensure_ascii=False, indent=2)
    print('[new] ts.meta uuid', ts_uuid)

ctype = compress_uuid(ts_uuid)
print('compressed type =', ctype, 'len', len(ctype))

# ---------------------------------------------------------------- scene
raw = open(SCENE, 'rb').read()
txt = raw.decode('utf-8')
assert json.dumps(json.loads(txt), indent=2, ensure_ascii=False) == txt, 'JSON round-trip 不成立，先别整份重写'
data = json.loads(txt)

canvas_id = None
for i, o in enumerate(data):
    if isinstance(o, dict) and o.get('__type__') == 'cc.Node' and o.get('_name') == 'Canvas':
        canvas_id = i
assert canvas_id is not None, '找不到 Canvas 节点'
canvas = data[canvas_id]

existing = [c['__id__'] for c in canvas['_components']
            if 0 <= c.get('__id__', -1) < len(data) and data[c['__id__']].get('__type__') == ctype]
if existing:
    print('[skip] Canvas 上已有该组件 id=', existing)
    raise SystemExit(0)

used_ids = {o.get('_id') for o in data if isinstance(o, dict)}
new_id = rand_id()
while new_id in used_ids:
    new_id = rand_id()

comp = {
    '__type__': ctype,
    '_name': '',
    '_objFlags': 0,
    '__editorExtras__': {},
    'node': {'__id__': canvas_id},
    '_enabled': True,
    '__prefab': None,
    'maxShift': 420,
    'stepPerTap': 0.045,
    'recoverPerSec': 0.02,
    'followSpeed': 14,
    'factorBack': 1.0,
    'factorLand': 0.85,
    'factorActor': 0.72,
    'btnSize': 148,
    '_id': new_id,
}
comp_id = len(data)
data.append(comp)
canvas['_components'].append({'__id__': comp_id})

out = json.dumps(data, indent=2, ensure_ascii=False)
assert out == json.dumps(json.loads(out), indent=2, ensure_ascii=False)
with open(SCENE, 'w', encoding='utf-8', newline='') as f:
    f.write(out)

print('appended component id=%d, _id=%s, node=%d' % (comp_id, new_id, canvas_id))
print('entries', len(data))

# ---------------------------------------------------------------- 回读
chk = json.load(open(SCENE, encoding='utf-8'))
c2 = chk[canvas_id]
print('Canvas components ->', [c['__id__'] for c in c2['_components']])
print('last entry ->', json.dumps(chk[-1], ensure_ascii=False)[:200])
print('no CRLF:', open(SCENE, 'rb').read().count(b'\r\n') == 0)
