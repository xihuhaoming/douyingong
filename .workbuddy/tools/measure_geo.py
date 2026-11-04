# -*- coding: utf-8 -*-
"""静态解析 game.scene，算出各关键节点在 Canvas 坐标系下的 x 区间与遮罩/屏幕的几何关系。"""
import json
import sys

SCENE = r"F:\cocosProject\DouyinJue\assets\game.scene"

with open(SCENE, "r", encoding="utf-8") as f:
    raw = f.read()
data = json.loads(raw)

byid = {}
for i, o in enumerate(data):
    byid[i] = o


def ref(o):
    return o["__id__"] if isinstance(o, dict) and "__id__" in o else None


def comps(node):
    out = []
    for c in node.get("_components") or []:
        i = ref(c)
        if i is not None:
            out.append(byid[i])
    return out


def ut_of(node):
    for c in comps(node):
        if c.get("__type__") == "cc.UITransform":
            return c
    return None


root = None
for i, o in enumerate(data):
    if o.get("__type__") == "cc.Scene":
        root = i
        break

# 收集节点树：name -> [(path, 累计x, 累计scale)]
found = {}


def walk(idx, path, accx, accs):
    o = data[idx]
    if not isinstance(o, dict):
        return
    name = o.get("_name", "?")
    p = path + "/" + name
    pos = o.get("_lpos") or {"x": 0, "y": 0, "z": 0}
    scl = o.get("_lscale") or {"x": 1, "y": 1, "z": 1}
    x = accx + pos.get("x", 0) * accs
    s = accs * scl.get("x", 1)
    found.setdefault(name, []).append((p, x, s, idx))
    for c in o.get("_children") or []:
        ci = ref(c)
        if ci is not None:
            walk(ci, p, x, s)


walk(root, "", 0.0, 1.0)

print("=== Canvas ===")
for p, x, s, idx in found.get("Canvas", []):
    ut = ut_of(data[idx])
    cs = (ut or {}).get("_contentSize", {})
    ap = (ut or {}).get("_anchorPoint", {})
    print("path=%s x=%.3f scale=%.4f size=%sx%s anchor=%s" % (
        p, x, s, cs.get("width"), cs.get("height"), ap))
    for c in comps(data[idx]):
        t = c.get("__type__")
        if t and "Canvas" in str(t):
            print("  CanvasComp keys:", {k: c[k] for k in c if k in ("_fitHeight", "_fitWidth", "_alignCanvasWithScreen")})

print()
print("=== 关键节点 x 区间（Canvas 坐标，已含父链位移/缩放）===")
TARGETS = ["Background", "LeftBgMask", "RightBgMask", "LeftBackground", "RightBackground",
           "Left_Land", "Left_Player", "Right_Land", "Right_Player",
           "BottomTestBtn", "ButtonLeft", "ButtonRight"]
rows = []
for name in TARGETS:
    for p, x, s, idx in found.get(name, []):
        ut = ut_of(data[idx])
        if not ut:
            print("%-16s path=%s x=%.3f (no UITransform)" % (name, p, x))
            continue
        cs = ut.get("_contentSize", {})
        ap = ut.get("_anchorPoint", {"x": 0.5, "y": 0.5})
        w = cs.get("width", 0) * s
        h = cs.get("height", 0) * s
        left = x - w * ap.get("x", 0.5)
        right = left + w
        rows.append((name, p, x, w, h, left, right))
        print("%-16s x=%9.3f  w=%8.3f h=%8.3f  [%9.3f , %9.3f]  %s" % (
            name, x, w, h, left, right, p))

print()
print("=== 遮罩组件 ===")
for name in ["LeftBgMask", "RightBgMask"]:
    for p, x, s, idx in found.get(name, []):
        for c in comps(data[idx]):
            t = c.get("__type__")
            if t and "Mask" in str(t):
                print("%s mask type=%s inverted=%s" % (p, c.get("_type"), c.get("_inverted")))

print()
print("=== 推算 ===")
half = None
# 屏幕在 Canvas 坐标下的可视半宽：用 Canvas contentSize 判断 fit 模式
for p, x, s, idx in found.get("Canvas", []):
    ut = ut_of(data[idx])
    cw = ((ut or {}).get("_contentSize") or {}).get("width", 750)
    ch = ((ut or {}).get("_contentSize") or {}).get("height", 1334)
    print("Canvas contentSize = %s x %s" % (cw, ch))
    break

d = {r[0]: r for r in rows}
if "LeftBackground" in d and "RightBackground" in d:
    _, _, lx, lw, lh, ll, lr = d["LeftBackground"]
    _, _, rx, rw, rh, rl, rr = d["RightBackground"]
    print("左图右缘 = %.3f" % lr)
    print("右图左缘 = %.3f" % rl)
    print("两图重叠宽度 = %.3f  (负=缝隙)" % (lr - rl))
