import {
    _decorator,
    Color,
    Component,
    Graphics,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec3,
    clamp,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * 抛物线技能弹体（表现层）。
 *
 * 只负责「按时间在空中画一条抛物轨迹」，不负责命中判定——
 * 命中和范围伤害都在 CampBattle 里算，因为只有它知道场上所有敌人。
 *
 * 轨迹：水平方向匀速插值，纵向叠加 4t(1-t) 的拱高，两端高度为 0，中点最高。
 *
 * 没配贴图时用 Graphics 画一个发光圆球占位，左蓝右红；
 * 以后有素材了，把图片拖到 spriteFrame（或用带 Sprite 的 prefab），其它逻辑不用改。
 */
@ccclass('SkillProjectile')
export class SkillProjectile extends Component {
    @property({ type: SpriteFrame, tooltip: '弹体贴图（不配 = 用 Graphics 画占位圆球）' })
    spriteFrame: SpriteFrame | null = null;

    @property({ tooltip: '弹体半径（px）' })
    radius = 24;

    @property({ type: Color, tooltip: '左方弹体颜色（配了贴图时作为染色）' })
    leftColor: Color = new Color(120, 200, 255, 255);

    @property({ type: Color, tooltip: '右方弹体颜色（配了贴图时作为染色）' })
    rightColor: Color = new Color(255, 140, 120, 255);

    @property({ tooltip: '飞行时自转速度（度/秒），0 = 不转' })
    spinSpeed = 0;

    private from = new Vec3();
    private to = new Vec3();
    private elapsed = 0;
    private duration = 1;
    private arc = 160;
    private side = -1;
    private built = false;

    onLoad() {
        this.build();
    }

    /** 由 CampBattle 在发射前调用，决定颜色 */
    setSide(side: number) {
        if (this.side === side && this.built) return;
        this.side = side;
        if (this.built) this.build();
    }

    launch(from: Vec3, to: Vec3, duration: number, arc: number) {
        this.from.set(from.x, from.y, from.z);
        this.to.set(to.x, to.y, to.z);
        this.elapsed = 0;
        this.duration = Math.max(0.05, duration);
        this.arc = Math.max(0, arc);
        this.node.active = true;
        this.node.angle = 0;
        this.applyPose(0);
    }

    stop() {
        // 交给对象池：重置时间，避免 arrived 残留为 true
        this.elapsed = 0;
        this.duration = 1;
    }

    /** 是否已经飞完（飞完就由 CampBattle 结算落地爆炸） */
    get arrived(): boolean {
        return this.elapsed >= this.duration;
    }

    update(dt: number) {
        if (this.elapsed >= this.duration) return;

        this.elapsed += dt;
        const t = clamp(this.elapsed / this.duration, 0, 1);
        this.applyPose(t);

        if (this.spinSpeed !== 0) {
            this.node.angle += this.spinSpeed * dt;
        }
    }

    /** t: 0 → 1 */
    private applyPose(t: number) {
        const x = this.from.x + (this.to.x - this.from.x) * t;
        const baseY = this.from.y + (this.to.y - this.from.y) * t;
        // 4t(1-t) 在 t=0.5 时为 1，两端为 0：标准抛物线拱
        const y = baseY + this.arc * 4 * t * (1 - t);
        this.node.setWorldPosition(x, y, this.from.z);
    }

    private build() {
        const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        const color = this.side > 0 ? this.rightColor : this.leftColor;

        if (this.spriteFrame) {
            const sp = this.node.getComponent(Sprite) || this.node.addComponent(Sprite);
            sp.spriteFrame = this.spriteFrame;
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.color = color;
            ut.setContentSize(this.radius * 2, this.radius * 2);
            this.built = true;
            return;
        }

        const g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        ut.setContentSize(this.radius * 4, this.radius * 4);
        g.clear();

        // 外光晕
        g.fillColor = new Color(color.r, color.g, color.b, 70);
        g.circle(0, 0, this.radius * 1.7);
        g.fill();

        // 主体
        g.fillColor = color;
        g.circle(0, 0, this.radius);
        g.fill();

        // 高光，让球体有体积感
        g.fillColor = new Color(255, 255, 255, 210);
        g.circle(-this.radius * 0.3, this.radius * 0.3, Math.max(2, this.radius * 0.33));
        g.fill();

        this.built = true;
    }
}
