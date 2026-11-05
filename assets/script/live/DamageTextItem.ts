import { _decorator, Color, Component, Label, UIOpacity, Vec3 } from 'cc';

const { ccclass } = _decorator;

/**
 * 一条飘字自己的播放状态，由 DamageTextLayer 池化创建和复用。
 *
 * 用 update 手动推进而不是 tween：
 * 节点会被回收复用，tween 的 target 是临时对象时停不掉，容易在复用后继续改位置。
 *
 * 注意：Cocos 允许「每个脚本文件只能有一个 Component 类」，
 * 所以这个类必须单独放一个文件，不能和 DamageTextLayer 写在一起。
 */
@ccclass('DamageTextItem')
export class DamageTextItem extends Component {
    private label: Label | null = null;
    private op: UIOpacity | null = null;
    private elapsed = 0;
    private playing = false;
    private from = new Vec3();
    private rise = 90;
    private duration = 0.8;
    private popScale = 1.9;
    private endScale = 0.85;
    private fadeStart = 0.45;
    private onDone: (() => void) | null = null;

    onLoad() {
        this.label = this.getComponent(Label);
        this.op = this.getComponent(UIOpacity) || this.addComponent(UIOpacity);
    }

    play(
        text: string,
        color: Color,
        from: Vec3,
        opt: { rise: number; duration: number; popScale: number; endScale: number; fadeStart: number },
        onDone: () => void,
    ) {
        if (!this.label) this.label = this.getComponent(Label);
        if (!this.op) this.op = this.getComponent(UIOpacity);
        if (!this.label || !this.op) return;

        this.label.string = text;
        this.label.color = color;

        this.from.set(from);
        this.rise = opt.rise;
        this.duration = Math.max(0.1, opt.duration);
        this.popScale = Math.max(1, opt.popScale);
        this.endScale = Math.max(0.1, opt.endScale);
        this.fadeStart = Math.min(0.99, Math.max(0, opt.fadeStart));
        this.onDone = onDone;

        this.elapsed = 0;
        this.playing = true;
        this.op.opacity = 255;
        this.node.setPosition(this.from);
        this.node.setScale(this.popScale, this.popScale, 1);
    }

    /** 被回收 / 清池时打断，避免回调打到已经复用的节点上 */
    stop() {
        this.playing = false;
        this.onDone = null;
    }

    update(dt: number) {
        if (!this.playing) return;

        this.elapsed += dt;
        const p = Math.min(1, this.elapsed / this.duration);

        // 上浮：匀速上升，看着最稳
        this.node.setPosition(this.from.x, this.from.y + this.rise * p, this.from.z);

        // 由大到小：前 35% 从 popScale 缩到 1，之后继续缓慢缩到 endScale
        const s = p <= 0.35
            ? this.popScale + (1 - this.popScale) * (p / 0.35)
            : 1 + (this.endScale - 1) * ((p - 0.35) / 0.65);
        this.node.setScale(s, s, 1);

        // 渐渐隐藏：fadeStart 之前保持不透明，之后淡出
        if (this.op) {
            const fade = (p - this.fadeStart) / Math.max(0.01, 1 - this.fadeStart);
            this.op.opacity = Math.round(255 * (1 - Math.min(1, Math.max(0, fade))));
        }

        if (p >= 1) {
            this.playing = false;
            const cb = this.onDone;
            this.onDone = null;
            if (cb) cb();
        }
    }
}
