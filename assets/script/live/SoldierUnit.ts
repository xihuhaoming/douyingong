import {
    _decorator,
    clamp,
    Color,
    Component,
    gfx,
    Node,
    Sprite,
    tween,
    Tween,
    UIOpacity,
    UITransform,
    Vec3,
} from 'cc';

const { ccclass } = _decorator;

/** 白闪用的颜色常量，避免每次受击都 new */
const FLASH_WHITE = new Color(255, 255, 255, 255);

/** 一次出场流程的参数，由 CampBattle 组装好传进来 */
export interface SoldierRunOptions {
    from: Vec3;
    to: Vec3;
    /** true = 让兵面朝右（面向敌方） */
    faceRight: boolean;
    /** 落地耗时（秒） */
    walkSeconds: number;
}

/**
 * 场上小兵的表现组件（忘记挂也没关系，CampBattle 会自动补上）。
 *
 * 职责边界：
 *   - 这里只管表现和位移：落地、朝中线走、到达后原地小跳、受击闪红、攻击前顶、死亡淡出
 *   - 血量、攻击间隔、伤害、命中判定全在 CampBattle，这里不存任何数值
 *
 * 位移有两段：
 *   1. run()     从落点上方掉到落点（tween，落地期间不前进）
 *   2. walkToWorldPos()  落地后由 CampBattle 每帧驱动，走到自己在阵型里的那个站位
 */
@ccclass('SoldierUnit')
export class SoldierUnit extends Component {
    /** 属于哪一方：-1 左 / +1 右（CampBattle 生成时写入） */
    side = 1;

    private baseScaleX = 1;
    private baseScaleY = 1;
    private sprite: Sprite | null = null;
    private opacity: UIOpacity | null = null;

    /** 落地 tween 进行中：这期间不接受前进指令，否则两套逻辑会抢 position */
    private landing = false;
    /** 正在朝自己的阵型站位走 */
    private moving = false;
    /** 已经站定（站位没变就不再重设，避免每帧打断小跳） */
    private atTarget = false;
    private moveTargetWorldX = 0;
    private moveTargetWorldY = 0;
    private moveSpeed = 100;

    /** 站立时的小跳（用正弦算，不再用 tween，避免和前进抢 position） */
    private bobOn = false;
    private bobPhase = 0;
    private baseY = 0;

    /** 死亡中：停止一切自主位移 */
    private dying = false;

    /** 受击白闪的叠加层（第一次受击时建，之后复用） */
    private flash: Sprite | null = null;
    private flashNode: Node | null = null;

    /** 当前受击位移（局部 x，正 = 往右），阻尼回弹到 0 */
    private recoilX = 0;
    /** 已经写进 node.position 的那部分位移，避免和走位互相覆盖 */
    private recoilApplied = 0;

    /** 跑一次落地流程（节点复用时也直接调这个） */
    run(o: SoldierRunOptions) {
        const n = this.node;
        this.resetVisual();
        Tween.stopAllByTarget(n);

        this.dying = false;
        this.landing = true;
        this.moving = false;
        this.atTarget = false;
        this.bobOn = false;
        this.bobPhase = 0;
        this.recoilX = 0;
        this.recoilApplied = 0;
        this.baseY = o.to.y;

        n.active = true;
        n.setPosition(o.from);

        this.baseScaleX = Math.abs(n.scale.x) || 1;
        this.baseScaleY = Math.abs(n.scale.y) || 1;
        const sx = o.faceRight ? this.baseScaleX : -this.baseScaleX;
        n.setScale(sx, this.baseScaleY, n.scale.z);

        tween(n)
            .to(Math.max(0.12, o.walkSeconds), { position: o.to.clone() }, { easing: 'sineInOut' })
            .call(() => {
                this.landing = false;
                n.setPosition(o.to.x, o.to.y, o.to.z);
            })
            .start();
    }

    /**
     * 朝某个世界坐标走（CampBattle 每帧调，目标就是阵型里的站位）。
     * 传世界坐标，内部按父节点的世界缩放换算成局部位移。
     * 目标没变就直接返回，否则到位后的小跳会被每帧重置、看起来像站桩。
     */
    walkToWorldPos(targetWorldX: number, targetWorldY: number, speed: number) {
        if (this.dying) return;

        const same =
            Math.abs(this.moveTargetWorldX - targetWorldX) < 0.01 &&
            Math.abs(this.moveTargetWorldY - targetWorldY) < 0.01;
        if (same && (this.moving || this.atTarget)) return;

        this.moveTargetWorldX = targetWorldX;
        this.moveTargetWorldY = targetWorldY;
        this.moveSpeed = Math.max(1, speed);
        this.moving = true;
        this.atTarget = false;
        this.bobOn = false;
    }

    /** 停掉一切动作并藏起来（回池前的清理） */
    sleep() {
        Tween.stopAllByTarget(this.node);
        this.moving = false;
        this.atTarget = false;
        this.landing = false;
        this.bobOn = false;
        this.dying = false;
        this.bobPhase = 0;
        this.recoilX = 0;
        this.recoilApplied = 0;
        this.hideFlash();
        this.resetVisual();
        this.node.active = false;
    }

    /**
     * 受击反馈：整个人白闪一下 + 被推得往后退一点。
     * 往后的方向就是远离中线：左方（side = -1）往左退，右方往右退。
     */
    showDamage() {
        this.flashWhite();
        this.recoilX = clamp(this.recoilX + this.side * 14, -30, 30);
    }

    /** 白闪：用一层同贴图的叠加（ADD）Sprite 铺在身上，比改 color 更明显 */
    private flashWhite() {
        const sp = this.getSprite();
        const f = sp ? this.getFlash(sp) : null;
        if (!f) return;

        f.spriteFrame = sp!.spriteFrame;
        f.color = FLASH_WHITE;

        const ut = this.node.getComponent(UITransform);
        const fut = f.node.getComponent(UITransform);
        if (ut && fut) fut.setContentSize(ut.contentSize);

        f.node.active = true;
        this.unschedule(this.hideFlash);
        this.scheduleOnce(this.hideFlash, 0.09);
    }

    private hideFlash = () => {
        if (this.flashNode && this.flashNode.isValid) this.flashNode.active = false;
    };

    /** 懒创建白闪层：子节点 + Sprite，加色混合，只用来闪一下 */
    private getFlash(main: Sprite): Sprite | null {
        if (this.flash) return this.flash;

        const n = new Node('HitFlash');
        n.layer = this.node.layer;
        n.setParent(this.node, false);
        n.setPosition(0, 0, 0);

        const ut = n.addComponent(UITransform);
        const mainUt = this.node.getComponent(UITransform);
        if (mainUt) ut.setContentSize(mainUt.contentSize);

        const f = n.addComponent(Sprite);
        f.type = Sprite.Type.SIMPLE;
        f.sizeMode = Sprite.SizeMode.CUSTOM;
        f.spriteFrame = main.spriteFrame;
        f.color = FLASH_WHITE;
        // 加色混合：叠在原图上只会更亮，配合 alpha 就是"被打白"的感觉
        f.srcBlendFactor = gfx.BlendFactor.SRC_ALPHA;
        f.dstBlendFactor = gfx.BlendFactor.ONE;

        n.active = false;
        this.flashNode = n;
        this.flash = f;
        return f;
    }

    /** 受击位移：阻尼回弹，位移量以增量的方式叠到节点坐标上，不干扰走位 */
    private tickRecoil(dt: number) {
        if (this.recoilX !== 0) {
            this.recoilX *= Math.exp(-9 * dt);
            if (Math.abs(this.recoilX) < 0.3) this.recoilX = 0;
        }

        const delta = this.recoilX - this.recoilApplied;
        if (delta === 0) return;

        const p = this.node.position;
        this.node.setPosition(p.x + delta, p.y, p.z);
        this.recoilApplied = this.recoilX;
    }

    /** 攻击反馈：往敌方方向顶一下 */
    attackPulse() {
        if (this.dying) return;
        const n = this.node;
        const sx = Math.abs(n.scale.x) * (n.scale.x < 0 ? -1 : 1);
        tween(n)
            .to(0.08, { scale: new Vec3(sx * 1.15, this.baseScaleY * 1.1, 1) })
            .to(0.12, { scale: new Vec3(sx, this.baseScaleY, 1) })
            .start();
    }

    /** 死亡：变灰下坠淡出，动画完回调（CampBattle 负责回收节点） */
    die(onDone?: () => void) {
        const n = this.node;
        this.dying = true;
        this.moving = false;
        this.bobOn = false;
        this.recoilX = 0;
        this.recoilApplied = 0;
        this.hideFlash();
        Tween.stopAllByTarget(n);

        const sp = this.getSprite();
        if (sp) sp.color.set(140, 140, 140, 255);
        const op = this.getOpacity();
        op.opacity = 255;

        tween(n)
            .by(
                0.5,
                {
                    position: new Vec3(0, -36, 0),
                    angle: n.angle + (this.side > 0 ? 60 : -60),
                },
            )
            .start();
        tween(op)
            .to(0.5, { opacity: 0 })
            .call(() => {
                if (onDone) onDone();
            })
            .start();
    }

    update(dt: number) {
        if (this.dying || this.landing) return;

        if (this.moving) {
            this.stepMove(dt);
            this.tickRecoil(dt);
            return;
        }

        if (this.bobOn) {
            // 0.9 秒一个来回的原地小跳
            this.bobPhase += (dt * Math.PI * 2) / 0.9;
            const p = this.node.position;
            this.node.setPosition(p.x, this.baseY + Math.sin(this.bobPhase) * 8, p.z);
        }

        this.tickRecoil(dt);
    }

    /** 朝目标世界坐标走一步；到位就停下并开始小跳 */
    private stepMove(dt: number) {
        const wp = this.node.worldPosition;
        const dx = this.moveTargetWorldX - wp.x;
        const dy = this.moveTargetWorldY - wp.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = this.moveSpeed * dt;

        if (dist <= step) {
            this.moveLocal(dx, dy);
            this.moving = false;
            this.atTarget = true;
            this.bobOn = true;
            this.bobPhase = 0;
            // 到位后以小跳的平衡位置为准，避免残留一点纵向偏移
            this.baseY = this.node.position.y;
            return;
        }

        const k = step / Math.max(dist, 0.0001);
        this.moveLocal(dx * k, dy * k);
    }

    /** 世界位移 → 局部位移（父节点有缩放时换算一下） */
    private moveLocal(dxWorld: number, dyWorld: number) {
        const parent = this.node.parent;
        const sx = parent ? parent.worldScale.x || 1 : 1;
        const sy = parent ? parent.worldScale.y || 1 : 1;
        const p = this.node.position;
        this.node.setPosition(p.x + dxWorld / sx, p.y + dyWorld / sy, p.z);
    }

    /** 复用前把外观恢复原样 */
    private resetVisual() {
        if (this.sprite) this.sprite.color.set(255, 255, 255, 255);
        if (this.opacity) this.opacity.opacity = 255;
        this.node.angle = 0;
    }

    private getSprite(): Sprite | null {
        if (!this.sprite) this.sprite = this.node.getComponentInChildren(Sprite);
        return this.sprite;
    }

    private getOpacity(): UIOpacity {
        if (!this.opacity) {
            this.opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        }
        return this.opacity;
    }
}
