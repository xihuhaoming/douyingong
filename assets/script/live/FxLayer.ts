import {
    _decorator,
    Color,
    Component,
    Graphics,
    Node,
    Tween,
    tween,
    UIOpacity,
    UITransform,
    Vec3,
} from 'cc';

const { ccclass, property } = _decorator;

/** 池化的一个特效节点 */
interface FxNode {
    node: Node;
    g: Graphics;
    op: UIOpacity;
}

/**
 * 纯代码绘制的战斗特效层（不用任何贴图/粒子资源）。
 *
 * 三种特效：
 *   - playHit   命中：白色闪光 + 扩散冲击环 + 放射火花
 *   - playTap   点击：指尖波纹 + 上浮光点
 *   - playDeath 死亡：灰色扩散环 + 碎片
 *
 * 每个特效都是「画一次 + 用 tween 缩放/淡出」，节点从池子里取，播完回池。
 * 想换成美术素材时，只要在 CampBattle 里配上 prefab，就会优先用 prefab。
 */
@ccclass('FxLayer')
export class FxLayer extends Component {
    @property({ tooltip: '节点池上限（超出直接销毁，防止无限膨胀）' })
    maxPooled = 40;

    @property({ tooltip: '命中火花条数' })
    hitSparks = 6;

    @property({ tooltip: '命中特效整体大小倍率' })
    hitScale = 1;

    @property({ tooltip: '点击特效整体大小倍率' })
    tapScale = 1;

    @property({ tooltip: '点击波纹圈数（依次扩散）' })
    tapRings = 3;

    @property({ tooltip: '波纹之间的间隔（秒）' })
    tapRingGap = 0.07;

    @property({ tooltip: '打印日志（调试用）' })
    debugLog = false;

    private pool: Node[] = [];
    /** 复用同一个 Vec3，避免每次 new */
    private tmp = new Vec3();

    onDestroy() {
        for (const n of this.pool) {
            if (n && n.isValid) n.destroy();
        }
        this.pool.length = 0;
    }

    // ------------------------------------------------ 对外

    /** 命中特效：闪光 + 冲击环 + 火花。power 控制大小（1 = 普通，1.4 = 暴击） */
    playHit(worldPos: Vec3, color: Color, power = 1) {
        const s = Math.max(0.4, power) * Math.max(0.2, this.hitScale);

        // ① 中心闪光：快速放大 + 淡出
        const flash = this.take(worldPos);
        if (flash) {
            const r = 26 * s;
            flash.g.fillColor = color;
            flash.g.circle(0, 0, r);
            flash.g.fill();

            flash.op.opacity = 210;
            flash.node.setScale(0.7, 0.7, 1);

            tween(flash.node).to(0.12, { scale: new Vec3(1.5, 1.5, 1) }, { easing: 'quadOut' }).start();
            tween(flash.op).to(0.12, { opacity: 0 }).call(() => this.back(flash.node)).start();
        }

        // ② 冲击环：细圆环往外扩，边扩边淡
        const ring = this.take(worldPos);
        if (ring) {
            ring.g.strokeColor = color;
            ring.g.lineWidth = Math.max(2, 7 * s);
            ring.g.circle(0, 0, 30 * s);
            ring.g.stroke();

            ring.op.opacity = 235;
            ring.node.setScale(0.35, 0.35, 1);

            tween(ring.node)
                .to(0.2, { scale: new Vec3(1.9, 1.9, 1) }, { easing: 'quadOut' })
                .start();
            tween(ring.op).to(0.2, { opacity: 0 }).call(() => this.back(ring.node)).start();
        }

        // ③ 火花：从中心向外的短线
        const sparks = this.take(worldPos);
        if (sparks) {
            const n = Math.max(0, Math.floor(this.hitSparks));
            const inner = 16 * s;
            const len = 26 * s;

            sparks.g.strokeColor = color;
            sparks.g.lineWidth = Math.max(1, 3 * s);

            for (let i = 0; i < n; i++) {
                const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
                const l = len * (0.6 + Math.random() * 0.8);
                sparks.g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
                sparks.g.lineTo(Math.cos(a) * (inner + l), Math.sin(a) * (inner + l));
            }
            sparks.g.stroke();

            sparks.op.opacity = 255;
            sparks.node.setScale(0.55, 0.55, 1);
            sparks.node.angle = Math.random() * 360;

            tween(sparks.node)
                .to(0.18, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'quadOut' })
                .start();
            tween(sparks.op).to(0.18, { opacity: 0 }).call(() => this.back(sparks.node)).start();
        }
    }

    /** 点击特效：3 圈波纹依次扩散消失（从指尖荡开的水波感） */
    playTap(worldPos: Vec3, color: Color) {
        const s = Math.max(0.2, this.tapScale);
        const rings = Math.max(1, Math.floor(this.tapRings));
        const gap = Math.max(0, this.tapRingGap);

        for (let i = 0; i < rings; i++) {
            const ring = this.take(worldPos);
            if (!ring) continue;

            // k: 0 = 最内圈（最快、最快消失），1 = 最外圈（更慢更大更淡）
            const k = rings > 1 ? i / (rings - 1) : 0;

            const startR = Math.max(3, 10 - 2 * k) * s;
            const endR = (46 + 27 * k) * s;
            const width = Math.max(1, (2.6 - 0.5 * k) * s);
            // 每个圈都活得很短：内圈 0.16s 就消失，避免三个圈叠成粗环
            const dur = 0.16 + 0.06 * i;
            const op0 = Math.max(110, Math.round(210 - 35 * i));

            ring.g.strokeColor = color;
            ring.g.lineWidth = width;
            ring.g.circle(0, 0, startR);
            ring.g.stroke();

            ring.op.opacity = op0;
            ring.node.setScale(1, 1, 1);

            const grow = endR / startR;
            const delay = i * gap;

            tween(ring.node)
                .delay(delay)
                .to(dur, { scale: new Vec3(grow, grow, 1) }, { easing: 'quadOut' })
                .start();

            tween(ring.op)
                .delay(delay)
                .to(dur, { opacity: 0 })
                .call(() => this.back(ring.node))
                .start();
        }
    }

    /** 死亡特效：灰色扩散环 + 碎片 */
    playDeath(worldPos: Vec3, color?: Color) {
        const c = color || new Color(190, 195, 210, 255);

        const ring = this.take(worldPos);
        if (ring) {
            ring.g.strokeColor = c;
            ring.g.lineWidth = 4;
            ring.g.circle(0, 0, 22);
            ring.g.stroke();

            ring.op.opacity = 200;
            ring.node.setScale(0.5, 0.5, 1);

            tween(ring.node).to(0.45, { scale: new Vec3(2.2, 2.2, 1) }, { easing: 'quadOut' }).start();
            tween(ring.op).to(0.45, { opacity: 0 }).call(() => this.back(ring.node)).start();
        }

        const shards = this.take(worldPos);
        if (shards) {
            const n = 6;
            const inner = 12;
            const len = 30;

            shards.g.strokeColor = c;
            shards.g.lineWidth = 3;

            for (let i = 0; i < n; i++) {
                const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
                const l = len * (0.7 + Math.random() * 0.9);
                shards.g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
                shards.g.lineTo(Math.cos(a) * (inner + l), Math.sin(a) * (inner + l));
            }
            shards.g.stroke();

            shards.op.opacity = 220;
            shards.node.setScale(0.6, 0.6, 1);

            tween(shards.node).to(0.4, { scale: new Vec3(1.7, 1.7, 1) }, { easing: 'quadOut' }).start();
            tween(shards.op).to(0.4, { opacity: 0 }).call(() => this.back(shards.node)).start();
        }
    }

    // ------------------------------------------------ 池

    private take(worldPos: Vec3): FxNode | null {
        const node = this.pool.pop() || this.create();
        if (!node || !node.isValid) return null;

        // 世界坐标 → 本层局部坐标
        const ut = this.node.getComponent(UITransform);
        const local = ut ? ut.convertToNodeSpaceAR(worldPos, this.tmp) : worldPos;

        node.active = true;
        node.setPosition(local.x, local.y, 0);
        node.setScale(1, 1, 1);
        node.angle = 0;
        node.setSiblingIndex(this.node.children.length - 1);

        const g = node.getComponent(Graphics)!;
        const op = node.getComponent(UIOpacity)!;

        Tween.stopAllByTarget(node);
        Tween.stopAllByTarget(op);
        g.clear();
        op.opacity = 255;

        return { node, g, op };
    }

    private create(): Node | null {
        const n = new Node('__fx');
        n.layer = this.node.layer;
        n.setParent(this.node, false);
        n.addComponent(UITransform).setContentSize(1, 1);
        n.addComponent(Graphics);
        n.addComponent(UIOpacity);
        return n;
    }

    private back(node: Node) {
        if (!node || !node.isValid) return;

        node.active = false;
        const g = node.getComponent(Graphics);
        if (g) g.clear();

        if (this.maxPooled > 0 && this.pool.length >= this.maxPooled) {
            node.destroy();
            return;
        }
        this.pool.push(node);
    }
}
