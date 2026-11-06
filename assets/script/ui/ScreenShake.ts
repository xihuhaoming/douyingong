import {
    _decorator,
    Camera,
    Canvas,
    clamp,
    Color,
    Component,
    director,
    Graphics,
    Node,
    Tween,
    tween,
    UIOpacity,
    UITransform,
    Vec3,
    view,
} from 'cc';

const { ccclass, property } = _decorator;

/** 一次震动的节拍 */
export interface ShakeBeat {
    /** 相对开始的时间（秒） */
    time: number;
    /** 强度（px） */
    strength: number;
    /** 这次震动持续多久（秒） */
    duration: number;
}

/**
 * 打击感一整套：震屏 + 相机 zoom + 命中定格 + 全屏闪光。
 *
 * 两种震动目标（自动判断）：
 *   - target 是相机 / Canvas → 震相机（只改渲染视角，不动布局）
 *   - target 是普通容器节点（如 GameShakeRoot）→ 震这个节点（容器震动，最直观）
 *   想强制容器模式就勾 containerMode。
 *
 * 用法：
 *   shake.play();                       // 用默认强度
 *   shake.play(30, 0.35);               // 指定强度/时长
 *   shake.playBeats([{time:0.06,strength:14,duration:0.18}, ...]);  // 对齐 spine 打击节拍
 */
@ccclass('ScreenShake')
export class ScreenShake extends Component {
    // ------------------------------------------------ 目标

    @property({
        type: Node,
        tooltip: '震动目标：相机 / Canvas / 容器节点都行；留空 = 自动找 Canvas 上的相机',
    })
    target: Node | null = null;

    @property({ tooltip: '强制容器模式：不管 target 是不是相机，都抖这个节点本身' })
    containerMode = false;

    // ------------------------------------------------ 强度

    @property({ tooltip: '强度上限（px），超过按它算，防止手滑震飞' })
    maxStrength = 80;

    @property({ tooltip: '不传参数时的默认强度（px）' })
    defaultStrength = 26;

    @property({ tooltip: '整体强度倍率：代码侧统一放大，不用改配置表' })
    strengthScale = 1.6;

    @property({ tooltip: '默认持续时长（秒）' })
    defaultDuration = 0.35;

    @property({ tooltip: '抖动频率，越大越碎，代码里限制在 0.2~3' })
    frequency = 1;

    // ------------------------------------------------ 相机 zoom（B）

    @property({ tooltip: '震的同时让相机轻微推近（相机模式下才生效）' })
    zoomShake = true;

    @property({ tooltip: 'zoom 幅度（0.02 = 推近 2%）' })
    zoomPercent = 0.02;

    // ------------------------------------------------ 命中定格（C）

    @property({ tooltip: '命中定格：全局减速一下，打击感提升最明显' })
    enableHitStop = true;

    @property({ tooltip: '定格时的全局时间倍率（0.15 = 慢到 15%）' })
    hitStopScale = 0.15;

    @property({ tooltip: '定格持续（秒，真实时间）' })
    hitStopSeconds = 0.06;

    // ------------------------------------------------ 全屏闪光（C）

    @property({ tooltip: '命中瞬间全屏闪一下' })
    enableFlash = true;

    @property({ type: Color, tooltip: '闪光颜色' })
    flashColor: Color = new Color(255, 255, 255, 255);

    @property({ tooltip: '闪光峰值透明度（0~255），太高会白屏' })
    flashAlpha = 110;

    @property({ tooltip: '闪光淡出时长（秒）' })
    flashSeconds = 0.18;

    @property({ tooltip: '两次打击感的最小间隔（秒），防止节拍密集时闪成一片' })
    impactCooldown = 0.12;

    // ------------------------------------------------ 调试

    @property({ tooltip: '调试用：启动 1 秒后自动震一次，确认组件本身能不能用' })
    testOnStart = false;

    @property({ tooltip: '打印每次震动日志' })
    debugLog = false;

    // ------------------------------------------------ 运行时

    private nodeTarget: Node | null = null;
    /** 相机模式下的相机组件（节点模式为 null） */
    private cam: Camera | null = null;
    private basePos = new Vec3();
    private baseOrtho = 0;
    private baseValid = false;

    private time = 0;
    private duration = 0;
    private strength = 0;
    private running = false;
    private seed = Math.random() * 100;

    /** 定格前的全局时间倍率，用于还原 */
    private savedTimeScale = 1;
    private hitStopTimer: number | null = null;
    private lastImpactAt = 0;

    private flashNode: Node | null = null;
    private flashOp: UIOpacity | null = null;

    // ------------------------------------------------ 对外

    /** 单次震动（多次调用取最强、最长；不会叠加成抖成筛子） */
    play(strength = this.defaultStrength, duration = this.defaultDuration) {
        const node = this.resolveTarget();
        if (!node) return;

        if (!this.running) {
            this.captureBase(node);
            this.time = 0;
            this.seed = Math.random() * 100;
        }

        const s = clamp(strength * Math.max(0, this.strengthScale), 0, Math.max(0, this.maxStrength));
        this.strength = Math.max(this.strength, s);
        this.duration = Math.max(this.duration, Math.max(0.05, duration));
        this.running = true;

        this.triggerImpact();

        if (this.debugLog) {
            console.log(
                `[ScreenShake] 强度 ${s.toFixed(1)} 时长 ${duration.toFixed(2)}s 目标 ${node.name}`,
            );
        }
    }

    /** 按节拍震：适合对齐 spine 动画里的"打一下" */
    playBeats(beats: ShakeBeat[]) {
        if (!beats || !beats.length) return;

        for (const b of beats) {
            if (!b || b.strength <= 0) continue;
            this.scheduleOnce(() => {
                this.play(b.strength, b.duration || this.defaultDuration);
            }, Math.max(0, b.time));
        }
    }

    /** 立刻停止并复位 */
    stop() {
        this.running = false;
        this.time = 0;
        this.duration = 0;
        this.strength = 0;
        this.restore();
    }

    // ------------------------------------------------ 主循环

    update(dt: number) {
        if (!this.running) return;

        const node = this.nodeTarget;
        if (!node || !node.isValid) {
            this.running = false;
            return;
        }

        this.time += dt;
        if (this.time >= this.duration || !this.baseValid) {
            this.running = false;
            this.restore();
            return;
        }

        // 二次衰减：开头最猛，结尾收干净
        const k = 1 - this.time / this.duration;
        const amp = this.strength * k * k;
        const freq = clamp(this.frequency || 1, 0.2, 3);
        const t = (this.time * 60 + this.seed) * freq;

        const ox = (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5) * amp * 0.62;
        const oy = (Math.sin(t * 1.7 + 1.3) + Math.sin(t * 2.9) * 0.5) * amp * 0.45;

        node.setPosition(this.basePos.x + ox, this.basePos.y + oy, this.basePos.z);

        // 相机 zoom：推近一点点再弹回，比纯位移明显得多
        const cam = this.cam;
        if (this.zoomShake && cam && cam.isValid && this.baseOrtho > 0) {
            const z = this.zoomPercent * k * (0.85 + 0.15 * Math.sin(t * 1.9));
            cam.orthoHeight = this.baseOrtho * (1 - z);
        }
    }

    start() {
        if (this.testOnStart) {
            this.scheduleOnce(() => this.play(this.defaultStrength, 0.5), 1);
        }
    }

    onDisable() {
        this.stop();
        this.restoreTimeScale();
    }

    onDestroy() {
        this.restore();
        this.restoreTimeScale();
        if (this.flashNode && this.flashNode.isValid) this.flashNode.destroy();
    }

    // ------------------------------------------------ 打击感附加项

    /** 一次打击只触发一次定格/闪光（节拍密集时靠 cooldown 合并） */
    private triggerImpact() {
        const now = Date.now();
        if (now - this.lastImpactAt < Math.max(0, this.impactCooldown) * 1000) return;
        this.lastImpactAt = now;

        this.doHitStop();
        this.doFlash();
    }

    /** 命中定格：全局 timeScale 降一下，用 setTimeout 按真实时间还原 */
    private doHitStop() {
        if (!this.enableHitStop) return;

        const scheduler = director.getScheduler();
        this.savedTimeScale = scheduler.getTimeScale() || 1;

        const target = clamp(this.hitStopScale, 0.01, 1);
        scheduler.setTimeScale(Math.min(this.savedTimeScale, target));

        if (this.hitStopTimer !== null) clearTimeout(this.hitStopTimer);
        // 不能用 scheduleOnce：它自己也受 timeScale 影响，会被拉长 6 倍
        this.hitStopTimer = setTimeout(() => {
            this.hitStopTimer = null;
            this.restoreTimeScale();
        }, Math.max(0.02, this.hitStopSeconds) * 1000) as unknown as number;
    }

    private restoreTimeScale() {
        const scheduler = director.getScheduler();
        if (Math.abs(scheduler.getTimeScale() - this.savedTimeScale) > 0.001) {
            scheduler.setTimeScale(this.savedTimeScale || 1);
        }
    }

    /** 全屏闪一下 */
    private doFlash() {
        if (!this.enableFlash) return;

        const op = this.ensureFlash();
        if (!op) return;

        Tween.stopAllByTarget(op);
        op.opacity = clamp(Math.round(this.flashAlpha), 0, 255);
        tween(op).to(Math.max(0.05, this.flashSeconds), { opacity: 0 }).start();
    }

    /** 懒创建全屏闪光层：一个铺满屏幕的白色矩形 + UIOpacity */
    private ensureFlash(): UIOpacity | null {
        if (this.flashOp && this.flashOp.isValid && this.flashNode && this.flashNode.isValid) {
            return this.flashOp;
        }

        const size = view.getVisibleSize();
        const n = new Node('__screenFlash');
        n.layer = this.node.layer;
        n.setParent(this.node, false);
        n.setPosition(0, 0, 0);
        n.addComponent(UITransform).setContentSize(size.width, size.height);

        const g = n.addComponent(Graphics);
        g.fillColor = this.flashColor;
        g.rect(-size.width / 2, -size.height / 2, size.width, size.height);
        g.fill();

        const op = n.addComponent(UIOpacity);
        op.opacity = 0;
        n.setSiblingIndex(this.node.children.length - 1);

        this.flashNode = n;
        this.flashOp = op;
        return op;
    }

    // ------------------------------------------------ 目标与复位

    private captureBase(node: Node) {
        this.nodeTarget = node;
        this.basePos.set(node.position);
        this.baseValid = true;

        const cam = this.containerMode ? null : node.getComponent(Camera);
        this.cam = cam || null;
        this.baseOrtho = cam ? cam.orthoHeight : 0;
    }

    private restore() {
        if (!this.baseValid) return;

        const node = this.nodeTarget;
        if (node && node.isValid) node.setPosition(this.basePos);

        const cam = this.cam;
        if (cam && cam.isValid && this.baseOrtho > 0) cam.orthoHeight = this.baseOrtho;

        this.baseValid = false;
    }

    /**
     * 找震动目标：
     *   containerMode → 直接用 target（容器震动）
     *   target 是相机 / Canvas → 换成对应的相机
     *   都没配 → 找祖先 Canvas 的相机
     */
    private resolveTarget(): Node | null {
        if (this.nodeTarget && this.nodeTarget.isValid) return this.nodeTarget;

        if (this.target && this.target.isValid) {
            this.nodeTarget = this.containerMode ? this.target : this.pickCamera(this.target);
            return this.nodeTarget;
        }

        let n: Node | null = this.node;
        while (n) {
            const canvas = n.getComponent(Canvas);
            if (canvas && canvas.cameraComponent) {
                this.nodeTarget = canvas.cameraComponent.node;
                return this.nodeTarget;
            }
            n = n.parent;
        }

        this.nodeTarget = this.node;
        return this.nodeTarget;
    }

    /** 传进来的节点如果本身不是相机，就换成它身上 / Canvas 上的相机 */
    private pickCamera(node: Node): Node {
        if (node.getComponent(Camera)) return node;

        const own = node.getComponent(Canvas);
        if (own && own.cameraComponent) return own.cameraComponent.node;

        const camInChildren = node.getComponentInChildren(Camera);
        if (camInChildren) return camInChildren.node;

        // 没有相机 → 当成容器节点直接抖
        return node;
    }
}
