import {
    _decorator,
    Component,
    Node,
    Button,
    Graphics,
    Label,
    Color,
    UITransform,
    Layers,
    view,
    director,
    clamp,
    Animation,
    AnimationState,
    ProgressBar,
} from 'cc';

const { ccclass, property } = _decorator;

interface Layer {
    node: Node;
    /** 初始 local x（地台沿用它 + 背景位移量×系数） */
    baseLocalX: number;
    /** 位移系数 */
    factor: number;
    /** +1 = 左阵营，-1 = 右阵营 */
    side: number;
}

/**
 * 角力（Tug of War）。
 *
 * 左右两边各有一个「推力」数值（leftPower / rightPower），差算成推进量
 * value ∈ [-1, 1]：>0 = 右方占优。
 *
 * value 只驱动一件事：**两张背景的 position.x 同向、同量移动** ——
 *   value > 0（右方占优）→ 两张图一起往右
 *   value < 0（左方占优）→ 两张图一起往左
 *
 * 能走多远**不写死**：按「每张图必须始终盖住自己那个遮罩窗口」反推出来
 * （见 computeRange）。窗口取「屏幕可见范围 ∩ 自己的遮罩 − 中线挡住的部分」。
 *
 * 角色（Left_Player / Right_Player）**永远钉在镜头中央，不参与任何平移** —— 这是硬约束。
 * 地台（Left_Land / Right_Land）默认也不动；想让它跟着背景一起平移就开 moveGroundUnits。
 *
 * 遮罩、中线、人物都不动 —— 中线永远在屏幕正中。
 */
@ccclass('TugOfWar')
export class TugOfWar extends Component {
    @property({ tooltip: '左方推力（初始值）' })
    leftPower = 29994;

    @property({ tooltip: '右方推力（初始值）' })
    rightPower = 26320;

    @property({ tooltip: '每点一次给该方加多少推力' })
    powerPerTap = 900;

    @property({ tooltip: '推力差 → 推进量的放大倍数（越大越灵敏）' })
    powerGain = 3;

    @property({ tooltip: '位移跟随速度' })
    followSpeed = 14;

    @property({ tooltip: '地台跟随系数（人物永远钉在镜头中央，不进跟随逻辑）' })
    factorLand = 0.85;

    @property({ tooltip: '地台是否跟着背景一起平移；人物永远钉在镜头中央，不归这个开关管' })
    moveGroundUnits = true;

    @property({ tooltip: '运行时自建测试按钮（场景里已经搭好 ButtonLeft/ButtonRight 就自动不建）' })
    runtimeButtons = true;

    @property({ tooltip: '按钮直径' })
    btnSize = 148;

    @property({ tooltip: '顶部「人间道 / 魔道」两个数值是否跟着推力走' })
    bindTopScore = true;

    @property({ tooltip: '顶部两条力量条是否按双方占比伸缩（中间有 VS 徽章，开了两款条会同时变短）' })
    bindTopProgress = false;

    @property({ tooltip: '角色动画是否按推力方向正放/倒放' })
    driveActorAnim = true;

    @property({
        tooltip: '动画幅度：1 = 推力差走满 [-1,1] 时动画正好播完一遍；调大动作更夸张，但到顶会停住',
    })
    animGain = 1;

    private layers: Layer[] = [];
    private bgLeft: Node | null = null;
    private bgRight: Node | null = null;
    private bgL0 = 0;
    private bgR0 = 0;
    /** 同向平移的余量：往右 / 往左（负数） */
    private rangeRight = 0;
    private rangeLeft = 0;

    private value = 0;
    private hud: Label | null = null;

    /** 顶部两人间道 / 魔道的数值 */
    private scoreL: Label | null = null;
    private scoreR: Label | null = null;
    private barL: ProgressBar | null = null;
    private barR: ProgressBar | null = null;
    private lastScoreL = -1;
    private lastScoreR = -1;

    /** 两个角色的动画状态，时间由代码接管 */
    private animL: AnimationState | null = null;
    private animR: AnimationState | null = null;

    onLoad() {
        this.collectLayers();
        this.bindSceneButtons();
    }

    /**
     * 放到 start：onLoad 阶段 Canvas 的 Widget 还没对齐，
     * view.getVisibleSize() 拿到的还是设计分辨率 750x1334，会把遮罩高度算小、按钮摆错。
     */
    start() {
        this.fitMaskHeight();
        this.computeRange();
        this.bindTopUi();
        this.bindActorAnims();
        if (this.runtimeButtons) {
            this.buildTestUi();
        }
    }

    // ---------------------------------------------------------------- 采集

    /** 按名字递归找 —— 不要写死层级，遮罩是后来插进去的 */
    private pick(name: string): Node | null {
        const scene = director.getScene();
        if (!scene) return null;
        const walk = (n: Node): Node | null => {
            if (n.name === name) return n;
            for (const c of n.children) {
                const r = walk(c);
                if (r) return r;
            }
            return null;
        };
        return walk(scene);
    }

    /** 在指定子树里按名字找（左右各有一个 Score / ProgressBar，不能全局找） */
    private pickIn(root: Node | null, name: string): Node | null {
        if (!root) return null;
        const walk = (n: Node): Node | null => {
            if (n.name === name) return n;
            for (const c of n.children) {
                const r = walk(c);
                if (r) return r;
            }
            return null;
        };
        return walk(root);
    }

    // ---------------------------------------------------------------- 顶部 UI

    /** 把「人间道 / 魔道」两个数值（和可选的力量条）接到 leftPower / rightPower */
    private bindTopUi() {
        const lp = this.pick('LeftPeople');
        const rp = this.pick('RightPeople');
        this.scoreL = this.pickIn(lp, 'Score')?.getComponent(Label) ?? null;
        this.scoreR = this.pickIn(rp, 'Score')?.getComponent(Label) ?? null;
        this.barL = this.pickIn(lp, 'ProgressBar')?.getComponent(ProgressBar) ?? null;
        this.barR = this.pickIn(rp, 'ProgressBar')?.getComponent(ProgressBar) ?? null;

        console.log(
            '[TugOfWar] 顶部绑定：人间道数值 ' + !!this.scoreL + ' / 魔道数值 ' + !!this.scoreR +
                ' / 力量条 ' + !!this.barL + ',' + !!this.barR,
        );
        this.refreshTopUi(true);
    }

    /** 数值每帧只在真变了才写，避免无谓的字符串分配 */
    private refreshTopUi(force = false) {
        const l = Math.round(this.leftPower);
        const r = Math.round(this.rightPower);
        if (this.bindTopScore) {
            if (this.scoreL && (force || l !== this.lastScoreL)) {
                this.scoreL.string = String(l);
            }
            if (this.scoreR && (force || r !== this.lastScoreR)) {
                this.scoreR.string = String(r);
            }
        }
        if (this.bindTopProgress) {
            const total = this.leftPower + this.rightPower;
            if (total > 0 && this.barL && this.barR) {
                this.barL.progress = clamp(this.leftPower / total, 0, 1);
                this.barR.progress = clamp(this.rightPower / total, 0, 1);
            }
        }
        this.lastScoreL = l;
        this.lastScoreR = r;
    }

    // ---------------------------------------------------------------- 角色动画

    /**
     * 把 AnimationState 的时间接管过来：speed 归零，之后每帧用 setTime + sample
     * 直接把「动画进度」写进去 —— 进度变大就是往前播，变小就是往后播。
     */
    private bindOneAnim(nodeName: string, tag: string): AnimationState | null {
        const node = this.pick(nodeName);
        if (!node) {
            console.warn('[TugOfWar] 找不到角色节点：' + nodeName);
            return null;
        }
        const anim = node.getComponent(Animation);
        if (!anim) {
            console.warn('[TugOfWar] ' + nodeName + ' 上没有 Animation 组件');
            return null;
        }
        const clip = anim.defaultClip || (anim.clips && anim.clips[0]) || null;
        if (!clip) {
            console.warn('[TugOfWar] ' + nodeName + ' 没配动画 clip');
            return null;
        }
        anim.play(clip.name);
        const st = anim.getState(clip.name);
        if (!st) {
            console.warn('[TugOfWar] ' + nodeName + ' 拿不到 AnimationState');
            return null;
        }
        st.speed = 0; // 时间轴交给代码
        console.log(
            '[TugOfWar] ' + tag + ' 动画接管：' + clip.name + '，' + st.length.toFixed(3) + 's',
        );
        return st;
    }

    private bindActorAnims() {
        this.animL = this.bindOneAnim('Left_Player', '左侧');
        this.animR = this.bindOneAnim('Right_Player', '右侧');
    }

    /** progress 0→1 对应 clip 首帧→末帧；值变小就是倒放 */
    private driveAnim(st: AnimationState | null, progress: number) {
        if (!st) return;
        const len = st.length;
        if (!(len > 0)) return;
        const t = clamp(progress, 0, 1) * (len - 1e-4);
        st.setTime(t);
        st.sample();
    }

    private collectLayers() {
        const bgL = this.pick('LeftBackground');
        const bgR = this.pick('RightBackground');
        if (bgL) {
            this.bgLeft = bgL;
            this.bgL0 = bgL.position.x;
        }
        if (bgR) {
            this.bgRight = bgR;
            this.bgR0 = bgR.position.x;
        }

        // 只有地台进跟随逻辑；人物永远不进，钉在中央。
        const defs: [string, number, number][] = [
            ['Left_Land', this.factorLand, 1],
            ['Right_Land', this.factorLand, -1],
        ];
        for (const [name, factor, side] of defs) {
            const node = this.pick(name);
            if (!node) {
                console.warn(`[TugOfWar] 找不到节点：${name}`);
                continue;
            }
            this.layers.push({ node, baseLocalX: node.position.x, factor, side });
        }

        console.log(
            `[TugOfWar] 背景 Left(x0=${this.bgL0.toFixed(1)}) Right(x0=${this.bgR0.toFixed(1)})，` +
                `地台 ${this.layers.length}（人物已锁定在中线，不参与平移）`,
        );
    }

    /**
     * 遮罩高度必须盖住实际可见高度。
     * 设计分辨率 1334，但 390x844 这类机器 fitHeight 之后可见高是 1588 ——
     * 遮罩还按 1334 画的话，画面上下会被裁出黑边。
     */
    private fitMaskHeight() {
        const need = Math.max(view.getVisibleSize().height + 120, 2000);
        let changed = 0;
        for (const name of ['LeftBgMask', 'RightBgMask']) {
            const m = this.pick(name);
            const ut = m && m.getComponent(UITransform);
            if (ut && ut.height < need) {
                ut.height = need;
                changed++;
            }
        }
        if (changed) {
            console.log(`[TugOfWar] 遮罩高度补到 ${need.toFixed(0)}（${changed} 个，可见高 ${view.getVisibleSize().height.toFixed(0)}）`);
        }
    }

    /**
     * 两张图同向平移，各自能走多远是**算**出来的，不写死数值。
     *
     * 硬约束是「每张图必须始终盖住自己那个遮罩窗口」——
     * 窗口 = 屏幕可见范围 ∩ 自己的遮罩矩形，再扣掉被中线挡住的那一段
     * （中线是另一个 Canvas 下的独立节点，图滑过界露出来的部分正好由它盖住）。
     *
     * 两个约束取交集，就是两张图能同步走的量：
     *   rangeRight ≥ 0（往右最多多少）、rangeLeft ≤ 0（往左最多多少）。
     */
    private computeRange() {
        if (!this.bgLeft || !this.bgRight) return;
        const lSpan = this.spanX(this.bgLeft);
        const rSpan = this.spanX(this.bgRight);
        if (!lSpan || !rSpan) {
            console.warn('[TugOfWar] 背景节点缺 UITransform，算不了行程');
            return;
        }

        const vs = view.getVisibleSize();
        const ccx = this.chainX(this.node); // Canvas 中心（场景根坐标）
        const visL = ccx - vs.width / 2;
        const visR = ccx + vs.width / 2;

        const lineSpan = this.spanX(this.pick('CenterLine'));
        const lmSpan = this.spanX(this.pick('LeftBgMask'));
        const rmSpan = this.spanX(this.pick('RightBgMask'));

        // 左图要盖到的右边界 / 右图要盖到的左边界（各取「遮罩边」和「中线边」里更靠外的那个）
        let seamL = Math.min(lmSpan ? lmSpan[1] : ccx, lineSpan ? lineSpan[0] : ccx);
        let seamR = Math.max(rmSpan ? rmSpan[0] : ccx, lineSpan ? lineSpan[1] : ccx);
        seamL = Math.max(seamL, visL);
        seamR = Math.min(seamR, visR);

        // 往右：左图左缘不能落进屏幕、右图左缘不能越过 seamR
        const maxD = Math.min(visL - lSpan[0], seamR - rSpan[0]);
        // 往左：左图右缘不能越过 seamL、右图右缘不能离开屏幕
        const minD = Math.max(seamL - lSpan[1], visR - rSpan[1]);

        this.rangeRight = Math.max(0, maxD);
        this.rangeLeft = Math.min(0, minD);

        const goRight = this.rangeRight;
        const goLeft = -this.rangeLeft;
        const mid = (goRight + goLeft) / 2;
        // 两张图一起往左挪这么多，往右/往左的余量正好相等
        const shift = (goLeft - goRight) / 2;
        let advice = '';
        if (shift > 2) {
            advice =
                '  两张图整体往左挪 ' + shift.toFixed(0) + 'px，两边就各能走 ' + mid.toFixed(0) + 'px';
        } else if (shift < -2) {
            advice =
                '  两张图整体往右挪 ' + (-shift).toFixed(0) + 'px，两边就各能走 ' + mid.toFixed(0) + 'px';
        }

        console.log(
            '[TugOfWar] 行程 往右 ' + goRight.toFixed(1) + ' / 往左 ' + goLeft.toFixed(1) + 'px' +
                '  |  左图 [' + lSpan[0].toFixed(0) + ',' + lSpan[1].toFixed(0) + ']' +
                ' 右图 [' + rSpan[0].toFixed(0) + ',' + rSpan[1].toFixed(0) + ']' +
                ' 中线 [' + (lineSpan ? lineSpan[0].toFixed(0) + ',' + lineSpan[1].toFixed(0) : '无') + ']' +
                ' 可视 [' + visL.toFixed(0) + ',' + visR.toFixed(0) + ']',
        );
        if (advice) console.warn('[TugOfWar]' + advice);
    }

    /**
     * 节点原点在**场景根坐标系**下的 x（沿父链一路加到根，含父级缩放）。
     *
     * 注意别在名为 Canvas 的节点上停：中线 CenterLine 挂在 UICanvas 下，
     * 和主 Canvas 是兄弟节点，停在 Canvas 会让两套坐标系混用、算出鬼数字。
     */
    private chainX(node: Node | null): number {
        const stack: Node[] = [];
        let n: Node | null = node;
        while (n && n.parent) {
            stack.push(n);
            n = n.parent;
        }
        let x = 0;
        let s = 1;
        for (let i = stack.length - 1; i >= 0; i--) {
            const m = stack[i];
            x += m.position.x * s;
            s *= m.scale.x;
        }
        return x;
    }

    /** 节点在场景根坐标系 x 轴上的 [左缘, 右缘]；节点缺失/无 UITransform 返回 null */
    private spanX(node: Node | null): [number, number] | null {
        if (!node) return null;
        const ut = node.getComponent(UITransform);
        if (!ut) return null;
        let s = 1;
        let n: Node | null = node;
        while (n) {
            s *= n.scale.x;
            n = n.parent;
        }
        const cx = this.chainX(node);
        const w = ut.width * s;
        const ax = ut.anchorX;
        return [cx - w * ax, cx + w * (1 - ax)];
    }

    // ---------------------------------------------------------------- 按钮

    private bindSceneButtons() {
        const l = this.pick('ButtonLeft');
        const r = this.pick('ButtonRight');
        if (l) l.on(Button.EventType.CLICK, () => this.addPower(-1), this);
        if (r) r.on(Button.EventType.CLICK, () => this.addPower(1), this);
        console.log(`[TugOfWar] 场景按钮：左 ${!!l}，右 ${!!r}`);
    }

    private buildTestUi() {
        const vs = view.getVisibleSize();
        const halfW = vs.width / 2;
        const halfH = vs.height / 2;
        const r = this.btnSize / 2;
        const y = -halfH + 150;
        const dx = halfW - 130;

        // 场景里已经搭了 ButtonLeft/ButtonRight 就不再自建，免得屏幕上四个按钮打架
        if (!this.pick('ButtonLeft')) {
            this.makeButton('BtnLeft', -dx, y, '推左', new Color(214, 158, 64, 235), () => this.addPower(-1));
            this.makeButton('BtnRight', dx, y, '推右', new Color(120, 78, 190, 235), () => this.addPower(1));
        }

        const hudNode = new Node('HudText');
        hudNode.layer = Layers.Enum.UI_2D;
        this.node.addChild(hudNode);
        hudNode.setPosition(0, y + r + 56, 0);
        const hut = hudNode.addComponent(UITransform);
        hut.setContentSize(700, 60);
        const hud = hudNode.addComponent(Label);
        hud.string = '';
        hud.fontSize = 20;
        hud.lineHeight = 26;
        hud.horizontalAlign = Label.HorizontalAlign.CENTER;
        hud.verticalAlign = Label.VerticalAlign.CENTER;
        hud.color = new Color(255, 255, 255, 210);
        hud.enableOutline = true;
        hud.outlineColor = new Color(0, 0, 0, 200);
        hud.outlineWidth = 2;
        this.hud = hud;
        this.refreshHud(this.bgL0, this.bgR0);
    }

    private makeButton(name: string, x: number, y: number, text: string, color: Color, onTap: () => void) {
        const btn = new Node(name);
        btn.layer = Layers.Enum.UI_2D;
        this.node.addChild(btn);
        btn.setPosition(x, y, 0);

        const ut = btn.addComponent(UITransform);
        ut.setContentSize(this.btnSize, this.btnSize);
        ut.setAnchorPoint(0.5, 0.5);

        const g = btn.addComponent(Graphics);
        const r = this.btnSize / 2;
        g.fillColor = color;
        g.circle(0, 0, r);
        g.fill();
        g.lineWidth = 5;
        g.strokeColor = new Color(255, 255, 255, 180);
        g.circle(0, 0, r - 3);
        g.stroke();

        const labelNode = new Node('Label');
        labelNode.layer = Layers.Enum.UI_2D;
        btn.addChild(labelNode);
        const lt = labelNode.addComponent(UITransform);
        lt.setContentSize(this.btnSize, 44);
        const lab = labelNode.addComponent(Label);
        lab.string = text;
        lab.fontSize = 36;
        lab.lineHeight = 40;
        lab.horizontalAlign = Label.HorizontalAlign.CENTER;
        lab.verticalAlign = Label.VerticalAlign.CENTER;
        lab.color = new Color(255, 255, 255, 255);
        lab.enableOutline = true;
        lab.outlineColor = new Color(40, 20, 0, 200);
        lab.outlineWidth = 2;

        const comp = btn.addComponent(Button);
        comp.transition = Button.Transition.SCALE;
        comp.zoomScale = 0.92;
        comp.duration = 0.06;
        btn.on(Button.EventType.CLICK, onTap, this);
    }

    // ---------------------------------------------------------------- 逻辑

    /** dir: +1 = 右方加力，-1 = 左方加力 */
    private addPower(dir: number) {
        if (dir > 0) {
            this.rightPower += this.powerPerTap;
        } else {
            this.leftPower += this.powerPerTap;
        }
    }

    /** 两个推力数值 → 推进量 */
    private computeValue(): number {
        const sum = this.leftPower + this.rightPower;
        if (sum <= 0) return 0;
        const diff = (this.rightPower - this.leftPower) / sum;
        return clamp(diff * this.powerGain, -1, 1);
    }

    update(dt: number) {
        const target = this.computeValue();
        const k = 1 - Math.exp(-dt * this.followSpeed);
        this.value += (target - this.value) * k;
        if (Math.abs(target - this.value) < 1e-4) {
            this.value = target;
        }

        // 顶部数值（人间道 / 魔道）跟着推力走
        this.refreshTopUi();

        // 角色动画：进度由 value 直接驱动
        //   value < 0（左方占优）→ 左侧进度变大=往前推、右侧进度变小=往后仰
        //   value > 0（右方占优）→ 反之
        if (this.driveActorAnim) {
            const half = this.value * this.animGain * 0.5;
            this.driveAnim(this.animL, 0.5 - half);
            this.driveAnim(this.animR, 0.5 + half);
        }

        // 两张图同向、同量平移；能走多远取两张图余量的交集
        const d = this.value >= 0 ? this.value * this.rangeRight : -this.value * this.rangeLeft;
        const lx = this.bgL0 + d;
        const rx = this.bgR0 + d;
        if (this.bgLeft) {
            const p = this.bgLeft.position;
            this.bgLeft.setPosition(lx, p.y, p.z);
        }
        if (this.bgRight) {
            const p = this.bgRight.position;
            this.bgRight.setPosition(rx, p.y, p.z);
        }

        // 地台/人物跟着各自阵营的背景走，系数缩小
        const dL = (lx - this.bgL0) * (this.moveGroundUnits ? 1 : 0);
        const dR = (rx - this.bgR0) * (this.moveGroundUnits ? 1 : 0);
        for (const l of this.layers) {
            const p = l.node.position;
            const d = l.side > 0 ? dL : dR;
            l.node.setPosition(l.baseLocalX + d * l.factor, p.y, p.z);
        }

        this.refreshHud(lx, rx);
    }

    private refreshHud(lx: number, rx: number) {
        if (!this.hud) return;
        const pct = Math.abs(this.value) * 100;
        const side = this.value > 0.001 ? '右方推进' : this.value < -0.001 ? '左方推进' : '持平';
        const range =
            '行程 往右 ' + this.rangeRight.toFixed(0) + ' / 往左 ' + (-this.rangeLeft).toFixed(0) + 'px';
        this.hud.string =
            `左 ${this.leftPower} : 右 ${this.rightPower}\n` +
            `${side} ${pct.toFixed(0)}%   左图 x=${lx.toFixed(0)} / 右图 x=${rx.toFixed(0)}\n` +
            range;
    }
}
