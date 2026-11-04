# -*- coding: utf-8 -*-
"""离线复刻 TugOfWar.computeRange()，用 game.scene 的真实数值验证行程算法。

坐标一律用**场景根坐标系**（与 TS 的 chainX 一致）：
中线 CenterLine 挂在 UICanvas 下，和主 Canvas 是兄弟节点，不能停在 Canvas 上。
"""
import json

SCENE = r"F:\cocosProject\DouyinJue\assets\game.scene"
data = json.load(open(SCENE, encoding="utf-8"))


def ref(o):
    return o["__id__"] if isinstance(o, dict) and "__id__" in o else None


byid = {i: o for i, o in enumerate(data)}
parent = {}
for i, o in enumerate(data):
    if isinstance(o, dict) and o.get("__type__") == "cc.Node":
        for c in o.get("_children") or []:
            ci = ref(c)
            if ci is not None:
                parent[ci] = i


def node_named(name):
    for i, o in enumerate(data):
        if isinstance(o, dict) and o.get("__type__") == "cc.Node" and o.get("_name") == name:
            return i
    return None


def ut_of(i):
    for c in data[i].get("_components") or []:
        ci = ref(c)
        if ci is not None and byid[ci].get("__type__") == "cc.UITransform":
            return byid[ci]
    return None


def chain_x(i):
    stack = []
    n = i
    while n is not None and n in parent:
        stack.append(n)
        n = parent.get(n)
    x, s = 0.0, 1.0
    for k in reversed(stack):
        o = data[k]
        x += (o.get("_lpos") or {"x": 0})["x"] * s
        s *= (o.get("_lscale") or {"x": 1})["x"]
    return x


def span_x(name):
    i = node_named(name)
    if i is None:
        return None
    ut = ut_of(i)
    if not ut:
        return None
    s = 1.0
    n = i
    while n is not None:
        s *= (data[n].get("_lscale") or {"x": 1})["x"]
        n = parent.get(n)
    cx = chain_x(i)
    w = ut["_contentSize"]["width"] * s
    ax = ut["_anchorPoint"]["x"]
    return (cx - w * ax, cx + w * (1 - ax))


L = span_x("LeftBackground")
R = span_x("RightBackground")
ML = span_x("LeftBgMask")
MR = span_x("RightBgMask")
CL = span_x("CenterLine")
CANVAS = span_x("Canvas")

print("场景根坐标系（Canvas 中心 = %.1f）" % ((CANVAS[0] + CANVAS[1]) / 2))
for nm, sp in [("左图", L), ("右图", R), ("左遮罩", ML), ("右遮罩", MR), ("中线", CL), ("Canvas", CANVAS)]:
    print("  %-6s [%9.2f , %9.2f]" % (nm, sp[0], sp[1]))
print()

CENTER = (CANVAS[0] + CANVAS[1]) / 2


def compute(visW, lspan=L, rspan=R):
    visL, visR = CENTER - visW / 2, CENTER + visW / 2
    seamL = max(min(ML[1], CL[0]), visL)
    seamR = min(max(MR[0], CL[1]), visR)
    maxD = min(visL - lspan[0], seamR - rspan[0])
    minD = max(seamL - lspan[1], visR - rspan[1])
    return max(0.0, maxD), min(0.0, minD), seamL - CENTER, seamR - CENTER


print("=== 行程（不同可见宽，验证对 fitWidth/fitHeight 不敏感）===")
for visW in (750.0, 616.4, 892.6):
    gr, gl, sL, sR = compute(visW)
    print("  可见宽 %6.1f -> seamL=%7.2f seamR=%7.2f   往右 %7.2f / 往左 %7.2f px"
          % (visW, sL, sR, gr, -gl))

print()
gr, gl, _, _ = compute(750.0)
goLeft = -gl
mid = (gr + goLeft) / 2
print("对称化：右图往左挪 %.1f 、左图往右挪 %.1f  ->  两边各走 %.1f px"
      % (mid - gr, goLeft - mid, mid))

print()
print("=== 挪图后的行程（L=左图右移 a，R=右图左移 b）===")
print("  a      b      往右     往左")
for a, b in [(0, 0), (0, 60), (0, 100), (0, 200), (50, 50), (100, 100), (0, -100)]:
    l2 = (L[0] + a, L[1] + a)
    r2 = (R[0] - b, R[1] - b)
    g2r, g2l, _, _ = compute(750.0, l2, r2)
    print("%4.0f  %5.0f  %8.1f %8.1f" % (a, b, g2r, -g2l))
