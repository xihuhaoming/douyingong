# -*- coding: utf-8 -*-
"""dump 场景节点树（含 Canvas 局部 x 区间、组件、父子关系）。"""
import json

SCENE = r"F:\cocosProject\DouyinJue\assets\game.scene"
with open(SCENE, "r", encoding="utf-8") as f:
    data = json.loads(f.read())


def ref(o):
    return o["__id__"] if isinstance(o, dict) and "__id__" in o else None


def comps(node):
    out = []
    for c in node.get("_components") or []:
        i = ref(c)
        if i is not None:
            out.append(data[i])
    return out


def ut_of(node):
    for c in comps(node):
        if c.get("__type__") == "cc.UITransform":
            return c
    return None


CANVAS_X = 375.0
root = next(i for i, o in enumerate(data) if o.get("__type__") == "cc.Scene")


def walk(idx, depth, accx, accs):
    o = data[idx]
    name = o.get("_name", "?")
    pos = o.get("_lpos") or {}
    scl = o.get("_lscale") or {}
    sx = scl.get("x", 1)
    x = accx + pos.get("x", 0) * accs
    s = accs * sx
    ut = ut_of(o)
    if ut:
        cs = ut.get("_contentSize") or {}
        ap = ut.get("_anchorPoint") or {"x": 0.5}
        w = cs.get("width", 0) * s
        h = cs.get("height", 0) * s
        left = x - CANVAS_X - w * ap.get("x", 0.5)
        tags = []
        for c in comps(o):
            t = str(c.get("__type__"))
            if t.startswith("cc.") and t in ("cc.UITransform",):
                continue
            if t.startswith("cc."):
                extra = ""
                if t == "cc.Sprite":
                    extra = " size=%s" % c.get("_sizeMode")
                tags.append(t.replace("cc.", "") + extra)
            else:
                tags.append("<custom>")
        print("%s%-22s x=%8.2f [%9.2f,%9.2f] w=%8.2f h=%8.2f  %s" % (
            "  " * depth, name, x - CANVAS_X, left, left + w, w, h, " ".join(tags)))
    else:
        print("%s%-22s x=%8.2f (no UITransform)" % ("  " * depth, name, x - CANVAS_X))
    for c in o.get("_children") or []:
        ci = ref(c)
        if ci is not None:
            walk(ci, depth + 1, x, s)


walk(root, 0, 0.0, 1.0)
