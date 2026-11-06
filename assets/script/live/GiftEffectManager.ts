import {
    _decorator,
    Component,
    Node,
    Prefab,
    Vec3,
    instantiate,
    tween,
    Tween,
    ParticleSystem2D,
    Animation,
    sp,
    UITransform,
} from 'cc';
import { liveEventBus, LiveGiftEvent } from './LiveEventBus';
import { spineDefaultAnim } from './SkillProjectile';

const { ccclass, property } = _decorator;

/** 一条「礼物 → 特效」的配置（Inspector 里加条目用） */
@ccclass('GiftEffectConfig')
export class GiftEffectConfig {
    @property({ tooltip: '礼物 id —— 抖音弹幕礼物消息里的 giftId 对上它' })
    giftId = 'rose';

    @property({ tooltip: '备注名（玫瑰 / 火箭…），只给自己看' })
    label = '';

    @property({ type: Prefab, tooltip: '这个礼物要播的特效 prefab' })
    prefab: Prefab | null = null;

    @property({ tooltip: '播多久后回收（秒）' })
    duration = 1.6;

    @property({ tooltip: '同屏最多同时几个' })
    maxAlive = 6;

    @property({ tooltip: '要播的 spine 动画名（留空 = 用 prefab 上 Spine 组件配的默认动画）' })
    anim = '';
}

/**
 * 礼物特效管理器：监听总线的 gift 事件，按 giftId 找 prefab，
 * 从对象池取出来 → 挂到特效层 → 播（粒子 / 动画 / 缩放脉冲兜底）→ 到期回池。
 * 技能命中、死亡、点击爆点等战斗特效也统一走 playPrefab()。
 */
@ccclass('GiftEffectManager')
export class GiftEffectManager extends Component {
    @property({ type: [GiftEffectConfig], tooltip: '礼物 → 特效 对照表' })
    gifts: GiftEffectConfig[] = [];

    @property({ type: Node, tooltip: '特效统一挂这下面（建议 Canvas 里最上面一层）' })
    effectRoot: Node | null = null;

    @property({ tooltip: '不指定位置时，特效在屏幕中央附近散开的半径（px）' })
    scatterRadius = 180;

    @property({ tooltip: '每种特效最多缓存几个（超出直接销毁，防止池子无限膨胀）' })
    maxPooledPerPrefab = 12;

    private pools = new Map<Prefab, Node[]>();
    private owner = new Map<Node, Prefab>();
    private alive = new Map<Prefab, number>();

    onLoad() {
        liveEventBus.onGift(this.onGift);
    }

    onDestroy() {
        liveEventBus.offGift(this.onGift);
        this.clearPools();
    }

    private onGift = (e: LiveGiftEvent) => {
        const cfg = this.gifts.find((g) => g.giftId === e.giftId);
        if (!cfg || !cfg.prefab) {
            console.warn('[GiftEffect] 没配置礼物「' + e.giftId + '」的特效，去 Inspector 的 gifts 里加一条');
            return;
        }
        // 一次刷一串也没意义，最多连播 4 个，间隔 0.1s 错开
        const n = Math.min(Math.max(1, e.count), 4);
        for (let i = 0; i < n; i++) {
            this.play(cfg, i * 0.1);
        }
    };

    /** 播一个特效（公开接口）。worldPos 传世界坐标，不传就在中央附近随机散点 */
    playPrefab(prefab: Prefab, worldPos?: Vec3, duration = 1.5, delay = 0, anim = '') {
        if (!prefab) return;
        this.play({ giftId: '', label: '', prefab, duration, maxAlive: 99, anim }, delay, worldPos);
    }

    private play(cfg: GiftEffectConfig, delay = 0, worldPos?: Vec3) {
        const root = this.effectRoot || this.node;
        const pf = cfg.prefab;
        if (!root || !pf) return;

        const cnt = this.alive.get(pf) || 0;
        if (cnt >= cfg.maxAlive) return;

        const node = this.take(pf);
        // 池里可能混进已被销毁的节点，取不到就放弃这一发，别让整场战斗崩掉
        if (!node || !node.isValid) return;

        this.alive.set(pf, cnt + 1);
        node.setParent(root, false);
        node.active = false; // delay 期间先藏着

        if (worldPos) {
            const ut = root.getComponent(UITransform) || root.addComponent(UITransform);
            node.setPosition(ut.convertToNodeSpaceAR(worldPos, new Vec3()));
        } else {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * this.scatterRadius;
            node.setPosition(new Vec3(Math.cos(a) * r, Math.sin(a) * r, 0));
        }
        node.setScale(1, 1, 1);

        const start = () => {
            // 延迟期间节点被销毁（切场景等）：把占用的名额还回去，
            // 否则 alive 只增不减，打一会儿就再也不播特效了
            if (!node || !node.isValid) {
                this.releaseAlive(pf);
                return;
            }
            this.fire(node, cfg.duration, cfg.anim);
        };

        if (delay > 0) {
            this.scheduleOnce(start, delay);
        } else {
            start();
        }
    }

    /** 真正开始播：粒子 reset / 动画 play / Spine 播一遍 / 什么都没有就缩放脉冲兜底 */
    private fire(node: Node, duration: number, animName = '') {
        // 延迟播放期间场景可能已经切走，节点已销毁时直接跳过
        if (!node || !node.isValid) return;

        node.active = true;

        const ps = node.getComponentInChildren(ParticleSystem2D);
        if (ps) ps.resetSystem();

        const anim = node.getComponentInChildren(Animation);
        if (anim && anim.defaultClip) anim.play();

        // Spine 特效：播 prefab 上 Spine 组件配的默认动画（只播一遍，不循环）
        // Spine 模块被功能裁剪掉时 cc.sp 是 undefined，这里不能直接取
        const SkeletonComp = (sp as unknown as typeof sp | undefined)?.Skeleton;
        const found = SkeletonComp ? node.getComponentInChildren(SkeletonComp) : null;

        // spine 组件被销毁后内部 this.node 会是 null，再调用就抛
        // "Cannot read property 'getComponentInChildren' of null"，所以这里先验活
        const sk = found && found.isValid && found.node && found.node.isValid ? found : null;

        if (sk) {
            // 优先用调用方指定的动画名，其次用 prefab 上 Spine 组件配的默认动画
            const name = animName || spineDefaultAnim(sk);
            if (name) {
                sk.setToSetupPose();
                sk.setAnimation(0, name, false);
            } else {
                console.warn('[GiftEffect] Spine 特效没有可用动画名：' + node.name);
            }
        }

        if (!ps && !anim && !sk) {
            tween(node)
                .to(0.1, { scale: new Vec3(1.18, 1.18, 1) })
                .to(0.1, { scale: new Vec3(1, 1, 1) })
                .union()
                .repeat(2)
                .start();
        }
        this.scheduleOnce(() => this.back(node), Math.max(0.2, duration));
    }

    private take(pf: Prefab): Node | null {
        let list = this.pools.get(pf);
        if (!list) {
            list = [];
            this.pools.set(pf, list);
        }

        // 池里可能混着已销毁的节点（切场景、超上限销毁等），跳过它们
        let node: Node | null = null;
        while (list.length) {
            const n = list.pop();
            if (n && n.isValid) {
                node = n;
                break;
            }
        }

        if (!node) {
            if (!pf || !pf.isValid) return null;
            node = instantiate(pf);
        }

        this.owner.set(node, pf);
        return node;
    }

    /** alive 计数 -1（不会低于 0） */
    private releaseAlive(pf: Prefab) {
        const c = this.alive.get(pf) || 0;
        this.alive.set(pf, Math.max(0, c - 1));
    }

    private back(node: Node) {
        const pf = node && node.isValid ? this.owner.get(node) : null;

        // 不管节点还在不在，先把名额还回去，杜绝"越打特效越少"
        if (pf) this.releaseAlive(pf);

        if (!node || !node.isValid) return;

        if (!pf) {
            node.destroy();
            return;
        }

        Tween.stopAllByTarget(node);
        node.active = false;

        const list = this.pools.get(pf);
        if (!list) {
            this.owner.delete(node);
            node.destroy();
            return;
        }

        // 池子满了就销毁，避免长期运行后缓存节点越来越多
        if (this.maxPooledPerPrefab > 0 && list.length >= this.maxPooledPerPrefab) {
            this.owner.delete(node);
            node.destroy();
            return;
        }

        list.push(node);
    }

    private clearPools() {
        for (const list of this.pools.values()) {
            for (const n of list) n.destroy();
        }
        this.pools.clear();
        this.owner.clear();
        this.alive.clear();
    }
}
