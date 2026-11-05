import { _decorator, Color, Component, Graphics, UIOpacity, UITransform } from 'cc';

const { ccclass, property, requireComponent } = _decorator;

/**
 * 程序化 2D 闪光特效（不依赖任何粒子 / 贴图资源）。
 *
 * 用法：挂在带 Graphics 的节点上，做成 prefab，交给 GiftEffectManager 播。
 *   - 节点 active 切到 true 就自动播一遍（GiftEffectManager 从池里取出来就是这样激活的）
 *   - 播完停在最后一帧（全透明），回池后下次激活会重播
 *   - 想手动播：调 play()
 *
 * 三个商用常见预设：
 *   命中：radius 10 / maxRadius 70  / duration 0.35 / 亮黄 / spikes 8
 *   死亡：radius 20 / maxRadius 120 / duration 0.60 / 灰   / spikes 0
 *   点击：radius 6  / maxRadius 50  / duration 0.40 / 白   / spikes 12
 */
@ccclass('FxFlash')
@requireComponent(Graphics)
export class FxFlash extends Component {
    @property({ tooltip: '起始半径（px）' })
    radius = 10;

    @property({ tooltip: '最大半径（px）' })
    maxRadius = 70;

    @property({ tooltip: '播放时长（秒）' })
    duration = 0.35;

    @property({ type: Color, tooltip: '主色（整体淡出由 UIOpacity 控制）' })
    color: Color = new Color(255, 235, 120, 255);

    @property({ tooltip: '线条粗细（px）' })
    lineWidth = 8;

    @property({ tooltip: '星芒条数，0 = 纯圆环' })
    spikes = 8;

    @property({ tooltip: '圆环从粗到细的比例，1 = 全程不变' })
    taper = 0.6;

    private g: Graphics | null = null;
    private op: UIOpacity | null = null;
    private elapsed = 0;
    private running = false;

    onLoad() {
        this.prepare();
    }

    onEnable() {
        // 被 GiftEffectManager 从池里激活时自动播
        this.play();
    }

    onDisable() {
        this.running = false;
    }

    /** 从头播一遍 */
    play() {
        this.prepare();
        this.elapsed = 0;
        this.running = true;
        this.render(0);
    }

    update(dt: number) {
        if (!this.running) return;
        this.elapsed += dt;
        const p = this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
        this.render(p);
        if (p >= 1) this.running = false;
    }

    private prepare() {
        if (!this.g) this.g = this.getComponent(Graphics);
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        if (!this.op) this.op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
    }

    /** p: 0 → 1 的播放进度 */
    private render(p: number) {
        const g = this.g;
        if (!g) return;

        const r = this.radius + (this.maxRadius - this.radius) * p;
        g.clear();
        g.lineWidth = Math.max(0.5, this.lineWidth * (1 - this.taper * p));
        g.strokeColor = this.color;

        if (r > 0.5) {
            g.circle(0, 0, r);
            g.stroke();
        }

        if (this.spikes > 0 && r > 0.5) {
            const inner = r * 0.4;
            const outer = r * 1.15;
            const spin = p * 0.5; // 星芒微微旋转，比纯缩放更有打击感
            for (let i = 0; i < this.spikes; i++) {
                const a = (Math.PI * 2 * i) / this.spikes + spin;
                g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
                g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
            }
            g.stroke();
        }

        if (this.op) this.op.opacity = Math.round(255 * (1 - p));
    }
}
