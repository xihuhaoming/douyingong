import {
    _decorator,
    Color,
    Component,
    Graphics,
    sp,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec3,
    clamp,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * 项目设置 → 功能裁剪 里没勾 Spine 时，运行时的 cc.sp 是 undefined。
 * 直接写 sp.SkeletonData 会在模块加载阶段就抛 TypeError（整个游戏白屏），
 * 所以这里统一兜底：没有 spine 就让这个字段退化成普通字段，其它逻辑照跑。
 */
const SP = sp as unknown as typeof sp | undefined;
const SkeletonDataCls = SP ? SP.SkeletonData : null;

/**
 * 读 Spine 组件上配的默认动画名。
 * Creator 3.8 各小版本里这个字段有的叫 defaultAnimation、有的只有 animation，
 * 直接访问会编译报「属性不存在」，所以这里做一次兼容读取。
 */
export function spineDefaultAnim(sk: sp.Skeleton | null): string {
    if (!sk) return '';
    const anySk = sk as unknown as { defaultAnimation?: string; animation?: string };
    return anySk.defaultAnimation || anySk.animation || '';
}

/**
 * 取一个还活着的 spine 组件。
 * 节点被销毁后组件内部的 this.node 会变成 null，
 * 此时再调 setToSetupPose / setAnimation 会抛
 * "Cannot read property 'getComponentInChildren' of null"。
 */
export function aliveSkeleton(sk: sp.Skeleton | null): sp.Skeleton | null {
    if (!sk || !sk.isValid) return null;
    const n = sk.node;
    return n && n.isValid ? sk : null;
}

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

    // ------------------------------------------------ Spine 弹体

    @property({
        type: SkeletonDataCls,
        tooltip: '弹体 Spine 数据。配了就用 Spine（优先于贴图/圆球）；prefab 上已经挂 sp.Skeleton 的话这里可以不填',
    })
    skeletonData: sp.SkeletonData | null = null;

    @property({ tooltip: '飞行时循环播的动画名（spine 里的 fly / throw）' })
    flyAnim = 'fly';

    @property({ tooltip: '命中/落地播放的爆炸动画名，留空 = 落地直接消失' })
    boomAnim = 'boom';

    @property({ tooltip: '爆炸动画时长（秒），播完才回对象池' })
    boomSeconds = 0.45;

    @property({ tooltip: '爆炸时的额外缩放倍率（1 = 不放大）' })
    boomScale = 1.6;

    private from = new Vec3();
    private to = new Vec3();
    private elapsed = 0;
    private duration = 1;
    private arc = 160;
    private side = -1;
    private built = false;

    /** Spine 组件（没有配 spine 时为 null） */
    private skeleton: sp.Skeleton | null = null;
    /** 正在播爆炸：这期间不再沿抛物线走 */
    private booming = false;
    /** prefab 上的原始缩放，爆炸放大要基于它算 */
    private baseScale = new Vec3(1, 1, 1);

    onLoad() {
        this.baseScale = this.node.scale.clone();
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
        this.booming = false;
        this.node.active = true;
        this.node.angle = 0;
        this.node.setScale(this.baseScale);
        this.playFly();
        this.applyPose(0);
    }

    stop() {
        // 交给对象池：重置时间，避免 arrived 残留为 true
        this.elapsed = 0;
        this.duration = 1;
        this.booming = false;
        this.node.setScale(this.baseScale);

        const sk = aliveSkeleton(this.skeleton);
        if (sk) {
            sk.setToSetupPose();
            sk.clearTracks();
        }
    }

    /**
     * 命中/落地：切爆炸动画并停在原地。
     * 返回「多久之后才能回收这个节点」（秒）；没有爆炸动画就返回 0，调用方立刻回池。
     */
    playBoom(): number {
        const sk = aliveSkeleton(this.skeleton);
        if (!sk || !this.boomAnim) return 0;

        this.booming = true;
        this.node.setScale(
            this.baseScale.x * this.boomScale,
            this.baseScale.y * this.boomScale,
            this.baseScale.z,
        );
        sk.setToSetupPose();
        sk.setAnimation(0, this.boomAnim, false);
        return Math.max(0.1, this.boomSeconds);
    }

    /** 飞行时循环播 flyAnim（没填就用 prefab 上 Spine 组件的默认动画） */
    private playFly() {
        const sk = aliveSkeleton(this.skeleton);
        if (!sk) return;

        const name = this.flyAnim || spineDefaultAnim(sk);
        if (!name) return;

        sk.setToSetupPose();
        sk.setAnimation(0, name, true);
    }

    /** 是否已经飞完（飞完就由 CampBattle 结算落地爆炸） */
    get arrived(): boolean {
        return this.elapsed >= this.duration;
    }

    update(dt: number) {
        if (this.booming) return;
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
        ut.setContentSize(this.radius * 2, this.radius * 2);

        // 1. Spine 优先：prefab 上已经挂 sp.Skeleton，或者这里配了 skeletonData
        //    （Spine 模块被裁掉时 SkeletonComp 是 null，直接跳过，走贴图/圆球）
        const SkeletonComp = SP ? SP.Skeleton : null;
        let sk: sp.Skeleton | null = null;
        if (SkeletonComp) {
            sk = this.node.getComponent(SkeletonComp);
            if (!sk && this.skeletonData) sk = this.node.addComponent(SkeletonComp);
        }
        if (sk) {
            if (!sk.skeletonData && this.skeletonData) sk.skeletonData = this.skeletonData;
            if (sk.skeletonData) {
                this.skeleton = sk;
                this.playFly();
                this.built = true;
                return;
            }
        }

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
