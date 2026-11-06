import {
    _decorator,
    clamp,
    Color,
    Component,
    Node,
    Sprite,
    tween,
    Tween,
    SpriteFrame,
    UIOpacity,
    UITransform,
    Vec3,
} from 'cc';
import { SpriteSheetAnimation } from '../SpriteSheetAnimation';

const { ccclass, property } = _decorator;

/**
 * 受击闪烁色。
 * 注意：Cocos 3.8 的 Sprite 已经移除了 srcBlendFactor / dstBlendFactor，
 * 没法做「加色混合的白闪」（纯白 tint 等于原色，看不出效果），
 * 所以这里用偏暖的亮色，压在暗色小兵身上能明显看到一下"发亮"。
 */
const DAMAGE_TINT = new Color(255, 214, 150, 255);

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

    // ------------------------------------------------ 交战动画

    @property({ type: SpriteFrame, tooltip: '攻击动画序列图（留空 = 不切动画）' })
    attackSheet: SpriteFrame | null = null;

    @property({ tooltip: '攻击动画单帧宽（0 = 用行走动画的帧宽）' })
    attackFrameWidth = 0;

    @property({ tooltip: '攻击动画单帧高（0 = 用行走动画的帧高）' })
    attackFrameHeight = 0;

    @property({ tooltip: '攻击动画 fps' })
    attackFps = 12;

    @property({ tooltip: '攻击动画是否循环' })
    attackLoop = true;

    @property({
        tooltip:
            '攻击动画整体缩放倍率（走路角色高 200px、攻击角色只有 160px 就填 1.25）。' +
            '只影响交战时，脱离后自动还原',
    })
    attackScale = 1;

    private baseScaleX = 1;
    private baseScaleY = 1;
    /** 当前动作倍率（1 = 走路，attackScale = 交战） */
    private scaleMul = 1;
    /** 攻击前顶的脉冲强度（1 → 0 衰减），和 scaleMul 乘在一起算最终缩放 */
    private pulse = 0;
    private pulseTime = 0;
    /** 当前朝向（用于重算缩放时保留镜像） */
    private facingRight = true;
    private sprite: Sprite | null = null;
    private opacity: UIOpacity | null = null;

    /** 帧动画组件（切换行走/攻击用） */
    private anim: SpriteSheetAnimation | null = null;
    /** 当前是否处于交战状态 */
    private inCombat = false;

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
        this.pulse = 0;
        this.pulseTime = 0;
        this.restoreCombat();
        this.baseY = o.to.y;

        n.active = true;
        n.setPosition(o.from);

        this.baseScaleX = Math.abs(n.scale.x) || 1;
        this.baseScaleY = Math.abs(n.scale.y) || 1;
        this.facingRight = o.faceRight;
        this.scaleMul = 1;
        this.applyScale();

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
        this.pulse = 0;
        this.pulseTime = 0;
        this.restoreCombat();
        this.restoreTint();
        this.resetVisual();
        this.node.active = false;
    }

    /**
     * 受击反馈：闪一下亮色 + 被推得往后退一点。
     * 往后的方向就是远离中线：左方（side = -1）往左退，右方往右退。
     */
    showDamage() {
        this.flashTint();
        this.recoilX = clamp(this.recoilX + this.side * 14, -30, 30);
    }

    /** 当前是否在交战（只读，给外部做调试/统计用） */
    get combat(): boolean {
        return this.inCombat;
    }

    /**
     * 交战状态切换：有敌人靠近就播攻击动画 + 套用 attackScale，脱离就还原。
     * 由 CampBattle 每帧按双方距离驱动，这里只负责换图和缩放。
     */
    setCombat(on: boolean) {
        if (this.inCombat === on) return;
        if (this.dying || this.landing) return;
        if (on && !this.attackSheet) return;

        this.inCombat = on;

        // 缩放和动画分开：图没配进来时，倍率照样生效
        this.scaleMul = on ? Math.max(0.05, this.attackScale) : 1;
        this.applyScale();

        if (!this.anim) this.anim = this.getComponent(SpriteSheetAnimation);
        if (!this.anim) return;

        if (on) {
            this.anim.playSheet(
                this.attackSheet,
                this.attackFrameWidth || this.anim.frameWidth,
                this.attackFrameHeight || this.anim.frameHeight,
                this.attackFps,
                this.attackLoop,
                0,
                true,
            );
        } else {
            this.anim.playOriginal();
        }
    }

    /** 回到非交战状态（出场 / 回收时调）：动画和缩放都还原 */
    private restoreCombat() {
        this.inCombat = false;
        this.scaleMul = 1;
        this.applyScale();

        if (!this.anim) this.anim = this.getComponent(SpriteSheetAnimation);
        this.anim?.playOriginal();
    }

    /** 受击闪一下：tint 到暖亮色，0.09s 后恢复（3.8 已移除加色混合 API，做不了纯白闪） */
    private flashTint() {
        const sp = this.getSprite();
        if (!sp) return;

        sp.color = DAMAGE_TINT;
        this.unschedule(this.restoreTint);
        this.scheduleOnce(this.restoreTint, 0.09);
    }

    private restoreTint = () => {
        const sp = this.getSprite();
        if (sp) sp.color = Color.WHITE;
    };

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

    /**
     * 攻击反馈：往敌方方向顶一下。
     * 不再用 tween 写 scale —— 那会和 setCombat 里的 applyScale 抢，
     * 一旦被打断就永远停在攻击尺寸（表现就是"有的兵忽大忽小"）。
     * 现在只置一个脉冲系数，由 update 每帧衰减并统一走 applyScale。
     */
    attackPulse() {
        if (this.dying || this.landing) return;

        this.pulse = 1;
        this.pulseTime = 0;
        this.applyScale();
    }

    /** 推进攻击脉冲（0.2 秒线性衰减到 0） */
    private tickPulse(dt: number) {
        if (this.pulse <= 0) return;

        this.pulseTime += dt;
        const left = 1 - this.pulseTime / 0.2;
        this.pulse = left > 0 ? left : 0;
        this.applyScale();
    }

    /** 按「基础缩放 × 动作倍率 × 攻击脉冲 × 朝向」重设节点缩放（朝向用符号，别覆盖掉） */
    private applyScale() {
        const n = this.node;
        const dir = this.facingRight ? 1 : -1;
        const k = this.pulse > 0 ? this.pulse : 0;

        n.setScale(
            this.baseScaleX * this.scaleMul * (1 + 0.15 * k) * dir,
            this.baseScaleY * this.scaleMul * (1 + 0.1 * k),
            n.scale.z,
        );
    }

    /** 死亡：变灰下坠淡出，动画完回调（CampBattle 负责回收节点） */
    die(onDone?: () => void) {
        const n = this.node;
        this.dying = true;
        this.moving = false;
        this.bobOn = false;
        this.recoilX = 0;
        this.recoilApplied = 0;
        this.restoreTint();
        Tween.stopAllByTarget(n);

        const sp = this.getSprite();
        if (sp) sp.color.set(140, 140, 140, 255);
        const op = this.getOpacity();
        if (op) op.opacity = 255;

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

        this.tickPulse(dt);

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
        // 节点被销毁后 this.node 会是 null，这里必须挡一下（回收/延迟回调时会走到）
        if (!this.node || !this.node.isValid) return null;
        if (!this.sprite || !this.sprite.isValid) {
            this.sprite = this.node.getComponentInChildren(Sprite);
        }
        return this.sprite;
    }

    private getOpacity(): UIOpacity | null {
        if (!this.node || !this.node.isValid) return null;
        if (!this.opacity || !this.opacity.isValid) {
            this.opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        }
        return this.opacity;
    }
}
