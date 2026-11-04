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
    UITransform,
} from 'cc';
import { liveEventBus, LiveGiftEvent } from './LiveEventBus';

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
    playPrefab(prefab: Prefab, worldPos?: Vec3, duration = 1.5, delay = 0) {
        if (!prefab) return;
        this.play({ giftId: '', label: '', prefab, duration, maxAlive: 99 }, delay, worldPos);
    }

    private play(cfg: GiftEffectConfig, delay = 0, worldPos?: Vec3) {
        const root = this.effectRoot || this.node;
        const pf = cfg.prefab;
        if (!root || !pf) return;

        const cnt = this.alive.get(pf) || 0;
        if (cnt >= cfg.maxAlive) return;
        this.alive.set(pf, cnt + 1);

        const node = this.take(pf);
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

        if (delay > 0) {
            this.scheduleOnce(() => this.fire(node, cfg.duration), delay);
        } else {
            this.fire(node, cfg.duration);
        }
    }

    /** 真正开始播：粒子 reset / 动画 play / 什么都没有就缩放脉冲兜底 */
    private fire(node: Node, duration: number) {
        node.active = true;
        const ps = node.getComponentInChildren(ParticleSystem2D);
        if (ps) ps.resetSystem();
        const anim = node.getComponentInChildren(Animation);
        if (anim && anim.defaultClip) anim.play();
        if (!ps && !anim) {
            tween(node)
                .to(0.1, { scale: new Vec3(1.18, 1.18, 1) })
                .to(0.1, { scale: new Vec3(1, 1, 1) })
                .union()
                .repeat(2)
                .start();
        }
        this.scheduleOnce(() => this.back(node), Math.max(0.2, duration));
    }

    private take(pf: Prefab): Node {
        let list = this.pools.get(pf);
        if (!list) {
            list = [];
            this.pools.set(pf, list);
        }
        const node = list.pop() || instantiate(pf);
        this.owner.set(node, pf);
        return node;
    }

    private back(node: Node) {
        const pf = this.owner.get(node);
        if (!pf) {
            node.destroy();
            return;
        }
        Tween.stopAllByTarget(node);
        node.active = false;
        const c = this.alive.get(pf) || 0;
        this.alive.set(pf, Math.max(0, c - 1));
        this.pools.get(pf)!.push(node);
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
