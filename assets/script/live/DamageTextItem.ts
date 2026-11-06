import { _decorator, Color, Component, Label, UIOpacity, Vec3 } from 'cc';
import { GraphicsNumber } from './GraphicsNumber';

const { ccclass } = _decorator;

/** 一条飘字的播放参数，由 DamageTextLayer 组装 */
export interface DamageTextStyle {
    rise: number;
    duration: number;
    popScale: number;
    endScale: number;
    fadeStart: number;
    /** 横向漂移（px），负值往左 */
    driftX: number;
    /** 出现时的倾斜角度（度），会迅速回正 */
    rotation: number;
    /** 出现瞬间的左右抖动幅度（px），暴击用 */
    shake: number;
}

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
    private gn: GraphicsNumber | null = null;
    private op: UIOpacity | null = null;
    private elapsed = 0;
    private playing = false;
    private from = new Vec3();
    private onDone: (() => void) | null = null;

    private style: DamageTextStyle = {
        rise: 90,
        duration: 0.8,
        popScale: 1.9,
        endScale: 0.85,
        fadeStart: 0.55,
        driftX: 0,
        rotation: 0,
        shake: 0,
    };

    onLoad() {
        this.label = this.getComponent(Label);
        this.gn = this.getComponent(GraphicsNumber);
        this.op = this.getComponent(UIOpacity) || this.addComponent(UIOpacity);
    }

    play(
        text: string,
        color: Color,
        from: Vec3,
        opt: DamageTextStyle,
        onDone: () => void,
    ) {
        if (!this.label) this.label = this.getComponent(Label);
        if (!this.gn) this.gn = this.getComponent(GraphicsNumber);
        if (!this.op) this.op = this.getComponent(UIOpacity);
        if (!this.op || (!this.label && !this.gn)) return;

        // 两种渲染：代码画的数码字 / Label 文本
        if (this.gn) {
            this.gn.setText(text, color);
        } else if (this.label) {
            this.label.string = text;
            this.label.color = color;
        }

        this.from.set(from);
        this.style = { ...opt };
        this.onDone = onDone;

        this.elapsed = 0;
        this.playing = true;
        this.op.opacity = 255;
        this.node.setPosition(this.from);
        this.node.angle = this.style.rotation;
        this.node.setScale(this.style.popScale, this.style.popScale, 1);
    }

    /** 同一个飘字节点可能被不同伤害复用，字号跟着变 */
    setFontSize(size: number) {
        if (!this.gn) this.gn = this.getComponent(GraphicsNumber);
        if (this.gn) {
            this.gn.setHeight(size);
            return;
        }

        if (!this.label) this.label = this.getComponent(Label);
        if (!this.label) return;

        this.label.fontSize = size;
        this.label.lineHeight = size + 6;
    }

    /** 被回收 / 清池时打断，避免回调打到已经复用的节点上 */
    stop() {
        this.playing = false;
        this.onDone = null;
    }

    update(dt: number) {
        if (!this.playing) return;

        this.elapsed += dt;
        const p = Math.min(1, this.elapsed / this.style.duration);

        // 1) 位移：先快后慢地上浮（easeOut），再叠加横向漂移和开局抖动
        const up = 1 - (1 - p) * (1 - p);
        const shakeSpan = 0.22;
        const shake = p < shakeSpan
            ? Math.sin(this.elapsed * 80) * this.style.shake * (1 - p / shakeSpan)
            : 0;
        this.node.setPosition(
            this.from.x + this.style.driftX * up + shake,
            this.from.y + this.style.rise * up,
            this.from.z,
        );

        // 2) 角度：出现时歪一点，0.25 内迅速回正
        const rotK = Math.min(1, p / 0.25);
        this.node.angle = this.style.rotation * (1 - rotK);

        // 3) 缩放：前 18% 从峰值快速收到 1（easeOutCubic），之后缓慢缩到 endScale
        const popSpan = 0.18;
        let s: number;
        if (p < popSpan) {
            const k = p / popSpan;
            s = this.style.popScale - (this.style.popScale - 1) * (1 - Math.pow(1 - k, 3));
        } else {
            s = 1 + (this.style.endScale - 1) * ((p - popSpan) / (1 - popSpan));
        }
        this.node.setScale(s, s, 1);

        // 4) 透明度：fadeStart 之前保持清楚，之后淡出
        if (this.op) {
            const fade = (p - this.style.fadeStart) / Math.max(0.01, 1 - this.style.fadeStart);
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
