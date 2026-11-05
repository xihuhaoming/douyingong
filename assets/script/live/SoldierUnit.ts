import { _decorator, Component, Node, Sprite, Vec3, tween, Tween, UIOpacity } from 'cc';

const { ccclass } = _decorator;

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
        this.resetVisual();
        this.node.active = false;
    }

    /** 受击反馈：闪一下红 */
    showDamage() {
        const sp = this.getSprite();
        if (!sp) return;
        sp.color.set(255, 90, 90, 255);
        this.scheduleOnce(() => {
            if (this.sprite) this.sprite.color.set(255, 255, 255, 255);
        }, 0.12);
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
            return;
        }

        if (this.bobOn) {
            // 0.9 秒一个来回的原地小跳
            this.bobPhase += (dt * Math.PI * 2) / 0.9;
            const p = this.node.position;
            this.node.setPosition(p.x, this.baseY + Math.sin(this.bobPhase) * 8, p.z);
        }
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
