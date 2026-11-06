import {
    _decorator,
    Animation,
    clamp,
    Color,
    Component,
    Graphics,
    instantiate,
    Node,
    Prefab,
    tween,
    Tween,
    UIOpacity,
    UITransform,
    view,
} from 'cc';
import { SpriteSheetAnimation } from '../SpriteSheetAnimation';

const { ccclass, property } = _decorator;

/** 一次前置动效的参数 */
export interface SkillIntroOptions {
    /** 宽度占屏比例（0.5 = 半屏宽） */
    widthRatio: number;
    /** 高度占屏比例 */
    heightRatio: number;
    /** 播放时长（秒），到点开始淡出 */
    seconds: number;
    /** 压暗战场强度 0~1 */
    dim: number;
}

/**
 * 技能前置动效播放器（序列帧 prefab）。
 *
 * 做法：
 *   1. 背景压暗（黑底淡入）
 *   2. 实例化动效 prefab，按「宽占屏 × 高占屏」做**等比 contain** 缩放（不变形，居中）
 *   3. 播 SpriteSheetAnimation / Animation
 *   4. 到时间淡出 → 销毁节点 → 回调解锁技能流程
 *
 * 注意：尺寸按「单帧像素」等比缩放到目标框内，所以素材宽高比不会被拉变形。
 */
@ccclass('SkillIntro')
export class SkillIntro extends Component {
    @property({ type: Node, tooltip: '动效挂载层（空 = 本节点）。建议是一个铺满屏幕的空节点' })
    contentRoot: Node | null = null;

    @property({ tooltip: '默认宽度占屏比例' })
    defaultWidthRatio = 0.5;

    @property({ tooltip: '默认高度占屏比例' })
    defaultHeightRatio = 0.5;

    @property({ tooltip: '默认播放时长（秒）' })
    defaultSeconds = 1.5;

    @property({ tooltip: '默认压暗强度 0~1（0 = 不压暗）' })
    defaultDim = 0.35;

    @property({ type: Color, tooltip: '压暗层颜色' })
    dimColor: Color = new Color(0, 0, 0, 255);

    @property({ tooltip: '淡入时长（秒）' })
    fadeIn = 0.12;

    @property({ tooltip: '淡出时长（秒）' })
    fadeOut = 0.18;

    @property({ tooltip: '打印日志，方便调试' })
    debugLog = false;

    private playing = false;
    private current: Node | null = null;
    private dimNode: Node | null = null;
    private dimOp: UIOpacity | null = null;

    get isPlaying(): boolean {
        return this.playing;
    }

    /**
     * 播一次前置动效。
     * @param prefab 序列帧 prefab（内部挂 SpriteSheetAnimation）
     * @param opt 尺寸/时长/压暗，按需覆盖
     * @param onDone 播完（开始淡出时）回调，用来继续技能结算
     */
    play(prefab: Prefab | null, opt?: Partial<SkillIntroOptions>, onDone?: () => void) {
        if (!prefab) {
            onDone?.();
            return;
        }

        // 连点：直接打断上一段，避免技能被吞
        if (this.playing) this.cancel();

        const root = this.contentRoot || this.node;
        if (!root || !root.isValid) {
            onDone?.();
            return;
        }

        const wRatio = clamp(opt?.widthRatio ?? this.defaultWidthRatio, 0.05, 2);
        const hRatio = clamp(opt?.heightRatio ?? this.defaultHeightRatio, 0.05, 2);
        const seconds = Math.max(0.1, opt?.seconds ?? this.defaultSeconds);
        const dim = clamp(opt?.dim ?? this.defaultDim, 0, 1);

        this.playing = true;
        this.showDim(dim);

        const node = instantiate(prefab);
        node.layer = root.layer;
        node.setParent(root, false);
        node.setPosition(0, 0, 0);
        node.setSiblingIndex(root.children.length - 1);
        this.current = node;

        this.fitIntoBox(node, wRatio, hRatio);
        this.playAnimation(node);

        // 淡入
        const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        op.opacity = 0;
        Tween.stopAllByTarget(op);
        tween(op).to(Math.max(0, this.fadeIn), { opacity: 255 }).start();

        if (this.debugLog) {
            console.log(
                `[SkillIntro] 播放 ${prefab.name}，目标 ${wRatio}×${hRatio} 屏，时长 ${seconds}s`,
            );
        }

        this.scheduleOnce(() => this.finish(onDone), seconds);
    }

    /** 立刻停止并清理（切场景 / 被新的动效打断时用） */
    cancel() {
        this.unscheduleAllCallbacks();

        const node = this.current;
        if (node && node.isValid) node.destroy();
        this.current = null;

        this.hideDim(true);
        this.playing = false;
    }

    onDisable() {
        this.cancel();
    }

    onDestroy() {
        this.cancel();
        if (this.dimNode && this.dimNode.isValid) this.dimNode.destroy();
        this.dimNode = null;
        this.dimOp = null;
    }

    // ------------------------------------------------ 内部

    /** 等比缩放到「屏宽 × wRatio、屏高 × hRatio」的框内，居中不变形 */
    private fitIntoBox(node: Node, wRatio: number, hRatio: number) {
        const size = view.getVisibleSize();
        const boxW = Math.max(1, size.width * wRatio);
        const boxH = Math.max(1, size.height * hRatio);

        const ut = node.getComponent(UITransform);
        const srcW = ut && ut.contentSize.width > 1 ? ut.contentSize.width : 0;
        const srcH = ut && ut.contentSize.height > 1 ? ut.contentSize.height : 0;

        if (srcW <= 0 || srcH <= 0) return;

        const k = Math.min(boxW / srcW, boxH / srcH);
        const base = node.scale;
        node.setScale(base.x * k, base.y * k, base.z);

        if (this.debugLog) {
            console.log(
                `[SkillIntro] 单帧 ${srcW.toFixed(0)}×${srcH.toFixed(0)} → 缩放 ${k.toFixed(3)}，` +
                    `实际显示 ${(srcW * k).toFixed(0)}×${(srcH * k).toFixed(0)}`,
            );
        }
    }

    /** 播序列帧（优先 SpriteSheetAnimation，其次 Animation） */
    private playAnimation(node: Node) {
        const sheet = node.getComponentInChildren(SpriteSheetAnimation);
        if (sheet) {
            sheet.play(true);
            return;
        }

        const anim = node.getComponentInChildren(Animation);
        if (anim && anim.defaultClip) anim.play();
    }

    private finish(onDone?: () => void) {
        const node = this.current;
        if (!node || !node.isValid) {
            this.current = null;
            this.hideDim();
            this.playing = false;
            onDone?.();
            return;
        }

        // 先回调（让伤害/特效立刻接上），再做淡出清理
        onDone?.();

        const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        Tween.stopAllByTarget(op);
        tween(op)
            .to(Math.max(0.05, this.fadeOut), { opacity: 0 })
            .call(() => {
                if (node.isValid) node.destroy();
                if (this.current === node) this.current = null;
                this.hideDim();
                this.playing = false;
            })
            .start();
    }

    /** 压暗层：懒创建，铺满屏幕的黑色矩形 */
    private showDim(alpha: number) {
        if (alpha <= 0.001) return;

        if (!this.dimNode || !this.dimNode.isValid) {
            const size = view.getVisibleSize();
            const n = new Node('__introDim');
            n.layer = this.node.layer;
            n.setParent(this.node, false);
            n.setPosition(0, 0, 0);
            n.addComponent(UITransform).setContentSize(size.width, size.height);

            const g = n.addComponent(Graphics);
            g.fillColor = this.dimColor;
            g.rect(-size.width / 2, -size.height / 2, size.width, size.height);
            g.fill();

            const op = n.addComponent(UIOpacity);
            op.opacity = 0;
            this.dimNode = n;
            this.dimOp = op;
        }

        this.dimNode.setSiblingIndex(0); // 压暗层垫在最下面，动效在上面
        const op = this.dimOp;
        if (!op) return;

        Tween.stopAllByTarget(op);
        tween(op).to(Math.max(0.05, this.fadeIn), { opacity: Math.round(alpha * 255) }).start();
    }

    private hideDim(immediate = false) {
        const op = this.dimOp;
        if (!op || !op.isValid) return;

        Tween.stopAllByTarget(op);
        if (immediate) {
            op.opacity = 0;
            return;
        }
        tween(op).to(Math.max(0.05, this.fadeOut), { opacity: 0 }).start();
    }
}
