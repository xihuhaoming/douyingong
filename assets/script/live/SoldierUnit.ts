import { _decorator, Component, Node, Sprite, Vec3, tween, Tween, UIOpacity } from 'cc';

const { ccclass } = _decorator;

/** 一次出场流程的参数，由 CampBattle 组装好传进来 */
export interface SoldierRunOptions {
    from: Vec3;
    to: Vec3;
    /** true = 让兵面朝右（面向敌方） */
    faceRight: boolean;
    /** 跑进场耗时（秒） */
    walkSeconds: number;
}

/**
 * 场上小兵的表现组件（忘记挂也没关系，CampBattle 会自动补上）。
 * 只管表现：进场跑位、待命小跳、受击闪红、攻击前顶、死亡淡出。
 * 血量数值和战斗结算都在 CampBattle 里，这里不存数值。
 */
@ccclass('SoldierUnit')
export class SoldierUnit extends Component {
    /** 属于哪一方：-1 左 / +1 右（CampBattle 生成时写入） */
    side = 1;

    private baseScaleX = 1;
    private baseScaleY = 1;
    private sprite: Sprite | null = null;
    private opacity: UIOpacity | null = null;
    private bobbing = false;

    /** 跑一次完整出场流程（节点复用时也直接调这个） */
    run(o: SoldierRunOptions) {
        const n = this.node;
        this.resetVisual();
        Tween.stopAllByTarget(n);

        n.active = true;
        n.setPosition(o.from);
        this.baseScaleX = Math.abs(n.scale.x) || 1;
        this.baseScaleY = Math.abs(n.scale.y) || 1;
        const sx = o.faceRight ? this.baseScaleX : -this.baseScaleX;
        n.setScale(sx, this.baseScaleY, n.scale.z);

        tween(n)
            .to(Math.max(0.2, o.walkSeconds), { position: o.to.clone() }, { easing: 'sineInOut' })
            .call(() => this.startBob())
            .start();
    }

    /** 停掉一切动作并藏起来（回池前的清理） */
    sleep() {
        Tween.stopAllByTarget(this.node);
        this.bobbing = false;
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
        this.bobbing = false;
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

    /** 复用前把外观恢复原样 */
    private resetVisual() {
        if (this.sprite) this.sprite.color.set(255, 255, 255, 255);
        if (this.opacity) this.opacity.opacity = 255;
        this.node.angle = 0;
    }

    /** 到场后原地小跳 */
    private startBob() {
        if (this.bobbing) return;
        this.bobbing = true;
        const amp = 8;
        tween(this.node)
            .by(0.3, { position: new Vec3(0, amp, 0) }, { easing: 'sineOut' })
            .by(0.3, { position: new Vec3(0, -amp, 0) }, { easing: 'sineIn' })
            .union()
            .repeatForever()
            .start();
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
