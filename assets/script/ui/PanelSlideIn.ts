import { _decorator, Button, Canvas, Component, Node, Tween, tween, UITransform, Vec3, view } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 弹窗从屏幕下方拉出：起始位置藏在屏幕外，先冲到目标位置上方一点，再回落到目标位置。
 *
 * 用法（两种都行）：
 *   1. 把「助力道具」按钮拖到 openButton，点它就播
 *   2. 按钮的 Click Events 里加一条：Target = 挂了这个组件的节点，Component = PanelSlideIn，Handler = play
 *
 * 注意：节点自己（或者它的父节点）不要挂 Widget 并且每帧对齐位置，
 * Widget 会在每帧把 position 拉回，tween 就白做了。要自适应请把这个动画放在单独一层容器上。
 */
@ccclass('PanelSlideIn')
export class PanelSlideIn extends Component {
    @property({ type: Button, tooltip: '点这个按钮打开抽屉（可空）' })
    openButton: Button | null = null;

    @property({ type: Button, tooltip: '点这个按钮收回抽屉（可空；不填就用面板里的关闭按钮挂 Click Events 调 hide）' })
    closeButton: Button | null = null;

    @property({ tooltip: '藏起来时往下偏多少 px；0 = 自动用自身高度 + 60' })
    hiddenOffset = 0;

    @property({ tooltip: '拉出耗时（秒），想更快就调小' })
    duration = 0.3;

    @property({ tooltip: '冲过目标位置多少 px，0 = 不过冲（没有回弹感）' })
    overshoot = 36;

    @property({ tooltip: '过冲后回落耗时（秒）' })
    settleDuration = 0.12;

    @property({ tooltip: '开局就把面板藏到屏幕外，等 play() 才出现' })
    hideOnStart = true;

    /** 编辑器里的原始位置，也就是「拉出来之后」应该在的位置 */
    private targetPos: Vec3 | null = null;
    /** 藏到屏幕外需要下移多少（开局在目标位置时算一次，之后不再变） */
    private baseOffset = 0;
    /** 已经播过 play()，避免 start() 跑得比 play() 晚时又把面板按回去 */
    private played = false;

    onLoad() {
        this.openButton?.node.on(Button.EventType.CLICK, this.play, this);
        this.closeButton?.node.on(Button.EventType.CLICK, this.hide, this);
    }

    onDestroy() {
        this.openButton?.node.off(Button.EventType.CLICK, this.play, this);
        this.closeButton?.node.off(Button.EventType.CLICK, this.hide, this);
        Tween.stopAllByTarget(this.node);
    }

    start() {
        this.cacheTarget();
        if (this.hideOnStart && !this.played) this.node.setPosition(this.hiddenPos());
    }

    /** 播放「从下方拉出 → 过冲 → 回落」。public，方便在 Button 的 Click Events 里直接选 play */
    play() {
        this.cacheTarget();
        this.played = true;
        Tween.stopAllByTarget(this.node);

        this.node.active = true;
        this.node.setPosition(this.hiddenPos());

        const target = this.targetPos!;
        const peak = new Vec3(target.x, target.y + Math.max(0, this.overshoot), target.z);

        tween(this.node)
            .to(this.duration, { position: peak }, { easing: 'quadOut' })
            .to(Math.max(0.01, this.settleDuration), { position: target.clone() }, { easing: 'sineOut' })
            .start();
    }

    /** 收回屏幕外（给关闭按钮用） */
    hide() {
        this.cacheTarget();
        this.played = true;
        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(Math.max(0.05, this.duration * 0.7), { position: this.hiddenPos() }, { easing: 'quadIn' })
            .start();
    }

    /** 立刻放到屏幕外，不播动画 */
    resetToHidden() {
        this.cacheTarget();
        Tween.stopAllByTarget(this.node);
        this.node.setPosition(this.hiddenPos());
    }

    private cacheTarget() {
        if (this.targetPos) return;

        this.targetPos = this.node.position.clone();
        // 必须趁节点还在「展开位置」时算，否则会把已经藏起来的位置当成基准
        this.baseOffset = this.computeOffset();
    }

    private hiddenPos(): Vec3 {
        const target = this.targetPos!;
        return new Vec3(target.x, target.y - this.baseOffset, target.z);
    }

    /**
     * 算「要下移多少才能完全看不见」：
     * 取节点在世界坐标里的包围盒，让它顶边落到画布底边以下（再多留 40px）。
     * 这样不管 UITransform 高度和实际视觉高度差多少，都能藏干净。
     */
    private computeOffset(): number {
        if (this.hiddenOffset > 0) return this.hiddenOffset;

        const parentScale = this.node.parent ? Math.abs(this.node.parent.worldScale.y) || 1 : 1;
        const box = this.boundingBox();
        if (!box) return (view.getVisibleSize().height || 1334) / parentScale;

        const bottom = this.canvasBottomWorldY();
        if (bottom !== null) {
            // 包围盒顶边（box.y + box.height）要低于画布底边
            const need = box.y + box.height - bottom + 40;
            if (need > 0) return need / parentScale;
        }

        return (box.height + 60) / parentScale;
    }

    /** 自己 + 所有子节点的世界包围盒（只取上下边界，用来判断到底多高） */
    private boundingBox(): { y: number; height: number } | null {
        let minY = 0;
        let maxY = 0;
        let has = false;

        const walk = (n: Node) => {
            const ut = n.getComponent(UITransform);
            if (ut) {
                const b = ut.getBoundingBoxToWorld();
                if (!has) {
                    minY = b.y;
                    maxY = b.y + b.height;
                    has = true;
                } else {
                    minY = Math.min(minY, b.y);
                    maxY = Math.max(maxY, b.y + b.height);
                }
            }
            for (const c of n.children) walk(c);
        };

        walk(this.node);
        return has ? { y: minY, height: maxY - minY } : null;
    }

    /** 画布底边的世界 y（拿不到就返回 null） */
    private canvasBottomWorldY(): number | null {
        let n: Node | null = this.node;
        while (n) {
            if (n.getComponent(Canvas)) {
                const ut = n.getComponent(UITransform);
                if (ut) return ut.getBoundingBoxToWorld().y;
            }
            n = n.parent;
        }
        return null;
    }
}
