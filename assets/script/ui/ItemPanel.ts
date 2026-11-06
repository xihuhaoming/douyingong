import {
    _decorator,
    assetManager,
    AssetManager,
    Button,
    Canvas,
    Component,
    instantiate,
    JsonAsset,
    Node,
    Prefab,
    ScrollView,
    SpriteFrame,
    tween,
    UIOpacity,
    UITransform,
    Vec3,
    view,
} from 'cc';
import { ItemData, ItemView } from './ItemView';
import { ItemList } from './ItemList';
import { findDef, getItemDefs, ItemDef, parseItemDefs, setItemDefs } from './ItemDefs';
import { CampBattle } from '../live/CampBattle';
import { PanelSlideIn } from './PanelSlideIn';
import { ScreenShake } from './ScreenShake';
import { SkillIntro } from './SkillIntro';

const { ccclass, property } = _decorator;

/** Inspector 里的一条道具配置 */
@ccclass('ItemConfig')
export class ItemConfig {
    @property({ tooltip: '唯一 id，点击时回传（如 gold / elf）' })
    id = '';

    @property({ type: SpriteFrame, tooltip: '图标：把 png 直接拖进来' })
    icon: SpriteFrame | null = null;

    @property({ tooltip: '显示名字' })
    name = '';

    @property({ tooltip: '数量' })
    count = 1;
}

// 技能参数（伤害 / 半径 / 特效 / 震屏）现在统一写在 ItemDefs.ts 的 ITEM_DEFS 里，
// 不再需要在 Inspector 里一条条拖拽。

/**
 * 助力道具面板的数据源。
 *
 * 两种数据来源，用 useCodeDefs 切换：
 *   ✔ 勾选（默认）：读 ItemDefs.ts 里的 ITEM_DEFS，图标按路径从 bundle 异步加载。
 *      接抖音道具时只要调 applyRuntime([{ id, count }]) 把数量刷进来即可。
 *   ✘ 不勾：读 Inspector 的 items 数组（图标直接拖 png）。
 *
 * 点击某个道具时会在本节点上 emit `use-item` 事件（参数是 ItemData），
 * 其它脚本监听：panelNode.on('use-item', (d) => ...)
 */
@ccclass('ItemPanel')
export class ItemPanel extends Component {
    /** 点道具时派发的事件名 */
    static readonly USE = 'use-item';

    @property({ type: ItemList, tooltip: '列表组件（List 节点上的 ItemList）' })
    itemList: ItemList | null = null;

    @property({ type: ScrollView, tooltip: '外层滚动视图（可空）。配了之后每次刷新会回到顶部' })
    scrollView: ScrollView | null = null;

    @property({ tooltip: '刷新后自动回到列表顶部' })
    scrollToTopOnRefresh = true;

    @property({
        tooltip: '用代码表 ItemDefs.ts 的 ITEM_DEFS 生成列表（取消勾选则用下面 Inspector 的 items）',
    })
    useCodeDefs = true;

    @property({ tooltip: '图标所在的 AssetBundle 名（Loading 场景里 loadBundle 过的那个）' })
    iconBundle = 'bundle';

    @property({ tooltip: '道具配置表在 bundle 里的路径（不带扩展名）。留空 = 只用代码兜底表' })
    configPath = 'config/items';

    @property({ tooltip: '只显示数量 > 0 的道具（接抖音数据后有用）' })
    hideZeroCount = false;

    @property({
        type: [ItemConfig],
        tooltip: '不用代码表时的配置：点 + 添加，图标把 png 拖进来',
    })
    items: ItemConfig[] = [];

    @property({ tooltip: '开局自动刷新一次列表' })
    refreshOnStart = true;

    @property({ tooltip: '点击时打印日志，方便调试' })
    debugLog = true;

    // ------------------------------------------------ 道具 → 技能

    @property({ type: CampBattle, tooltip: '战斗主控（BattleLayer 上的 CampBattle）' })
    battle: CampBattle | null = null;

    @property({ type: ScreenShake, tooltip: '屏幕震动（挂在 Canvas 或任意节点上都行）' })
    screenShake: ScreenShake | null = null;

    @property({ type: SkillIntro, tooltip: '技能前置动效播放器（挂在 IntroLayer 上）' })
    introPlayer: SkillIntro | null = null;

    @property({
        type: Node,
        tooltip: '卡片飞行层：全屏居中的空节点，放在面板之外的最上层（不然会被面板裁掉/挡住）',
    })
    castLayer: Node | null = null;

    @property({ tooltip: '点击道具时施放技能（关掉就只派发 use-item 事件）' })
    castOnClick = true;

    @property({ tooltip: '卡片飞到中间用时（秒）' })
    cardFlySeconds = 0.28;

    @property({ tooltip: '卡片在中间停留多久（秒）' })
    cardHold = 0.15;

    @property({ tooltip: '卡片在中间的放大倍数' })
    cardCenterScale = 1.5;

    @property({ tooltip: '卡片飞行时向上拱的高度（px），0 = 直线' })
    cardArc = 260;

    // ------------------------------------------------ 到达中央后的消散

    @property({ tooltip: '主卡淡出/放大用时（秒）' })
    cardFadeSeconds = 0.2;

    @property({ type: Prefab, tooltip: '到达中央时播的粒子/特效 prefab（可空）' })
    cardBurst: Prefab | null = null;

    @property({ tooltip: '粒子特效播放时长（秒）' })
    cardBurstSeconds = 0.8;

    @property({ tooltip: '碎散残影数量（0 = 关闭）' })
    cardShardCount = 6;

    @property({ tooltip: '残影飞散距离（px）' })
    cardShardDistance = 130;

    @property({ tooltip: '残影散开用时（秒）' })
    cardShardSeconds = 0.32;

    @property({ type: PanelSlideIn, tooltip: '底部抽屉（点道具后自动收起，可空）' })
    drawer: PanelSlideIn | null = null;

    @property({ tooltip: '点击道具后收起抽屉' })
    closeDrawerOnCast = true;

    /** 抖音下发的数量：id → count */
    private runtimeCounts = new Map<string, number>();
    /** 加载过的图标，避免反复 load */
    private iconCache = new Map<string, SpriteFrame | null>();
    /** 加载过的技能特效 prefab（按 bundle 路径缓存） */
    private prefabCache = new Map<string, Prefab | null>();
    /** 技能施放中（前置动效期间挡住连点） */
    private casting = false;
    /** bundle 加载中（多个图标同时请求时只 load 一次） */
    private bundlePromise: Promise<AssetManager.Bundle | null> | null = null;

    start() {
        if (this.refreshOnStart) void this.loadConfigThenRefresh();
    }

    /** 先异步读配置表，读完再刷新列表；失败就用代码兜底表 */
    private async loadConfigThenRefresh() {
        await this.loadConfig();
        this.refresh();
    }

    /** 从 bundle 读 config/items.json，校验后替换当前道具表 */
    private async loadConfig() {
        if (!this.configPath) return;

        const bundle = await this.ensureBundle();
        if (!bundle) return;

        const json = await new Promise<JsonAsset | null>((resolve) => {
            bundle.load(this.configPath, JsonAsset, (err, asset) => {
                if (err || !asset) {
                    console.warn(
                        `[ItemPanel] 道具配置加载失败：${this.configPath}，已回退到代码兜底表`,
                        err,
                    );
                    resolve(null);
                    return;
                }
                resolve(asset);
            });
        });

        if (!json) return;

        const { list, errors } = parseItemDefs(json.json);
        if (errors.length) {
            console.warn('[ItemPanel] 道具配置有问题：\n' + errors.join('\n'));
        }
        setItemDefs(list);
    }

    /** 刷新列表（按当前数据源） */
    refresh() {
        if (this.useCodeDefs) {
            void this.refreshFromDefs();
            return;
        }

        const list: ItemData[] = [];
        for (const cfg of this.items) {
            if (!cfg || !cfg.id) continue;
            list.push({
                id: cfg.id,
                icon: cfg.icon,
                name: cfg.name,
                count: cfg.count,
            });
        }
        this.setData(list);
    }

    /**
     * 抖音侧数据：只覆盖数量，图标和名字仍然来自本地 ItemDefs。
     * 接 SDK 后拿到道具列表就调这个：
     *   itemPanel.applyRuntime([{ id: 'gold', count: 3 }, ...]);
     */
    applyRuntime(list: { id: string; count: number }[]) {
        this.runtimeCounts.clear();
        for (const it of list) {
            if (!it || !it.id) continue;
            this.runtimeCounts.set(it.id, Math.max(0, Math.floor(it.count)));
        }
        this.refresh();
    }

    /** 从代码表生成列表（图标异步加载） */
    private async refreshFromDefs() {
        // 一旦有了抖音下发数据，本地没列到的道具就按 0 处理（配合 hideZeroCount 只显示拥有的）
        const hasRuntime = this.runtimeCounts.size > 0;

        const jobs = getItemDefs().map(async (def) => {
            const count = this.runtimeCounts.has(def.id)
                ? this.runtimeCounts.get(def.id)!
                : hasRuntime
                  ? 0
                  : def.count ?? 1;
            if (this.hideZeroCount && count <= 0) return null;

            const icon = await this.loadIcon(def.icon);
            const item: ItemData = { id: def.id, name: def.name, count, icon };
            return item;
        });

        const results = await Promise.all(jobs);
        // 等待期间面板可能已经被销毁
        if (!this.isValid) return;

        const list: ItemData[] = [];
        for (const r of results) {
            if (r) list.push(r);
        }
        this.setData(list);
    }

    /** 拿 bundle：没有就自己 load 一次（直接预览 game 场景也能用） */
    private ensureBundle(): Promise<AssetManager.Bundle | null> {
        const exist = assetManager.getBundle(this.iconBundle);
        if (exist) return Promise.resolve(exist);
        if (this.bundlePromise) return this.bundlePromise;

        this.bundlePromise = new Promise((resolve) => {
            assetManager.loadBundle(this.iconBundle, (err, bundle) => {
                if (err || !bundle) {
                    console.warn(`[ItemPanel] 加载 AssetBundle「${this.iconBundle}」失败`, err);
                    this.bundlePromise = null;
                    resolve(null);
                    return;
                }
                resolve(bundle);
            });
        });
        return this.bundlePromise;
    }

    /** 按 bundle 路径加载图标：'img/ui/tool_01' → spriteFrame */
    private async loadIcon(path: string): Promise<SpriteFrame | null> {
        if (!path) return null;
        if (this.iconCache.has(path)) return this.iconCache.get(path)!;

        const bundle = await this.ensureBundle();
        if (!bundle) return null;

        const sf = await new Promise<SpriteFrame | null>((resolve) => {
            // 图片资源的 SpriteFrame 存在子资源里，先按 /spriteFrame 取
            bundle.load(`${path}/spriteFrame`, SpriteFrame, (err, s) => {
                if (!err && s) {
                    resolve(s);
                    return;
                }
                // 兜底：直接按图片路径加载
                bundle.load(path, SpriteFrame, (err2, s2) => {
                    if (err2 || !s2) {
                        console.warn(`[ItemPanel] 图标加载失败：${path}`, err2 || err);
                        resolve(null);
                        return;
                    }
                    resolve(s2);
                });
            });
        });

        this.iconCache.set(path, sf);
        return sf;
    }

    /** 外部（配置表 / 接口）直接灌数据 */
    setData(list: ItemData[]) {
        if (!this.itemList) {
            console.warn('[ItemPanel] 没配置 ItemList，列表不会显示');
            return;
        }
        this.itemList.setItems(list, this.onPick);

        if (this.scrollView && this.scrollToTopOnRefresh) {
            // 下一帧再滚，等 Layout 把 content 尺寸算完
            this.scheduleOnce(() => this.scrollView?.scrollToTop(0), 0);
        }
    }

    private onPick = (data: ItemData, viewItem?: ItemView) => {
        if (this.debugLog) {
            console.log(`[ItemPanel] 使用道具：${data.id}（${data.name}）剩余 ${data.count}`);
        }
        this.node.emit(ItemPanel.USE, data);

        if (this.castOnClick) void this.castSkill(data, viewItem);
    };

    /** 点道具入口：有前置动效就先播，播完再走后面的流程 */
    private async castSkill(data: ItemData, viewItem?: ItemView) {
        if (this.casting) return;

        const def = findDef(data.id);

        // 抽屉立刻收起，别等动效播完
        if (this.closeDrawerOnCast) this.drawer?.hide();

        // 前置动效（序列帧）：播完回调里再继续
        if (def?.intro && this.introPlayer) {
            const introPrefab = await this.loadPrefab(def.intro);
            if (introPrefab) {
                this.casting = true;
                this.introPlayer.play(
                    introPrefab,
                    {
                        widthRatio: def.introWidthRatio ?? 0.5,
                        heightRatio: def.introHeightRatio ?? 0.5,
                        seconds: def.introSeconds ?? 1.5,
                        dim: def.introDim ?? 0.35,
                    },
                    () => {
                        this.casting = false;
                        void this.doCast(def, viewItem);
                    },
                );
                return;
            }
        }

        void this.doCast(def, viewItem);
    }

    /** 真正的施放：卡片飞行 → 震屏 → 敌方阵营随机点放特效并结算 */
    private async doCast(def: ItemDef | null, viewItem?: ItemView) {
        const hasCard = !!(viewItem && this.castLayer);

        if (hasCard) {
            this.itemList?.clearSelection();
            this.flyCard(viewItem!);
        }

        // 特效 prefab 从 bundle 按路径加载（已缓存，第二次是同步的）
        const effect = def?.effect ? await this.loadPrefab(def.effect) : null;
        const delay = hasCard ? this.cardFlySeconds + this.cardHold : 0;

        this.scheduleOnce(() => {
            const battle = this.battle;
            if (!battle) {
                console.warn('[ItemPanel] 没配置 CampBattle，道具技能不会造成伤害');
                return;
            }

            // 特效开播的同一帧开始震
            this.applyShake(def);

            battle.castSkillOnEnemy(
                def?.damage ?? 40,
                def?.radius ?? 220,
                effect,
                def?.effectSeconds ?? 0.8,
                def?.anim ?? '',
            );
        }, delay);
    }

    /** 按 ItemDefs 里的配置触发屏幕震动：优先节拍表，其次单次震动 */
    private applyShake(def: ItemDef | null) {
        const shake = this.screenShake;
        if (!shake || !def) return;

        const delay = Math.max(0, def.shakeDelay ?? 0);
        const beats = def.shakeBeats;

        if (beats && beats.length) {
            const list: { time: number; strength: number; duration: number }[] = [];
            for (const b of beats) {
                if (!b || b.strength <= 0) continue;
                list.push({
                    time: Math.max(0, b.time) + delay,
                    strength: b.strength,
                    duration: b.duration,
                });
            }
            if (list.length) shake.playBeats(list);
            return;
        }

        const strength = def.shakeStrength ?? 0;
        if (strength <= 0) return;

        const duration = def.shakeDuration ?? 0.35;
        if (delay > 0) {
            this.scheduleOnce(() => shake.play(strength, duration), delay);
        } else {
            shake.play(strength, duration);
        }
    }

    /** 按 bundle 路径加载 prefab（缓存，失败也缓存 null 避免反复加载） */
    private loadPrefab(path: string): Promise<Prefab | null> {
        if (this.prefabCache.has(path)) return Promise.resolve(this.prefabCache.get(path)!);

        return this.ensureBundle().then(
            (bundle) =>
                new Promise<Prefab | null>((resolve) => {
                    if (!bundle) {
                        resolve(null);
                        return;
                    }
                    bundle.load(path, Prefab, (err, prefab) => {
                        if (err || !prefab) {
                            console.warn(`[ItemPanel] 技能特效加载失败：${path}`, err);
                            this.prefabCache.set(path, null);
                            resolve(null);
                            return;
                        }
                        this.prefabCache.set(path, prefab);
                        resolve(prefab);
                    });
                }),
        );
    }

    /** 克隆一张卡片，从道具位置沿抛物线飞到屏幕正中央，放大后淡出 */
    private flyCard(viewItem: ItemView) {
        const layer = this.castLayer;
        if (!layer || !viewItem || !viewItem.node || !viewItem.node.isValid) return;

        const ut = layer.getComponent(UITransform) || layer.addComponent(UITransform);

        // 起点 = 被点的格子，终点 = 屏幕正中央（不是 castLayer 的 (0,0)，它可能偏）
        const start = ut.convertToNodeSpaceAR(viewItem.node.worldPosition, new Vec3());
        const end = ut.convertToNodeSpaceAR(this.screenCenterWorld(), new Vec3());

        const card = instantiate(viewItem.node);
        card.name = '__castCard';
        card.setParent(layer, false);
        card.setPosition(start);
        card.setSiblingIndex(layer.children.length - 1);

        // 副本只用来展示，不能再响应点击
        const itemView = card.getComponent(ItemView);
        if (itemView) itemView.destroy();
        const btn = card.getComponent(Button);
        if (btn) btn.interactable = false;

        const base = card.scale;
        const targetScale = this.cardCenterScale;
        const flight = Math.max(0.05, this.cardFlySeconds);
        const hold = Math.max(0, this.cardHold);
        const arc = Math.max(0, this.cardArc);

        // 抛物线：t 从 0 → 1，x/y 线性插值 + 4t(1-t) 的拱起
        const state = { t: 0 };
        tween(state)
            .to(
                flight,
                { t: 1 },
                {
                    easing: 'sineOut',
                    onUpdate: () => {
                        if (!card.isValid) return;

                        const t = state.t;
                        card.setPosition(
                            start.x + (end.x - start.x) * t,
                            start.y + (end.y - start.y) * t + arc * 4 * t * (1 - t),
                            0,
                        );

                        const s = 1 + (targetScale - 1) * t;
                        card.setScale(base.x * s, base.y * s, base.z);
                    },
                },
            )
            .start();

        const fade = Math.max(0.05, this.cardFadeSeconds);
        const op = card.getComponent(UIOpacity) || card.addComponent(UIOpacity);

        // 主卡：再放大一点 + 轻微旋转 + 淡出
        tween(card)
            .delay(flight + hold)
            .to(
                fade,
                {
                    scale: new Vec3(base.x * targetScale * 1.18, base.y * targetScale * 1.18, base.z),
                    angle: 8,
                },
                { easing: 'quadOut' },
            )
            .call(() => {
                if (card.isValid) card.destroy();
            })
            .start();

        tween(op)
            .delay(flight + hold)
            .to(fade, { opacity: 0 })
            .start();

        // 到中央那一刻：炸一发粒子 + 甩出碎散残影
        this.scheduleOnce(() => this.onCardArrive(card), flight + hold);
    }

    /** 卡片飞到中央：播粒子 + 生成碎散残影 */
    private onCardArrive(card: Node) {
        if (!card || !card.isValid) return;

        this.playBurst();
        if (this.cardShardCount > 0) this.spawnShards(card);
    }

    /** 屏幕中心播一次粒子/特效；没配 prefab 就跳过 */
    private playBurst() {
        if (!this.cardBurst) return;

        const center = this.screenCenterWorld();
        const fx = this.battle?.fx;

        if (fx) {
            fx.playPrefab(this.cardBurst, center, this.cardBurstSeconds);
            return;
        }

        // 没配 GiftEffectManager 就自己挂一个，播完销毁
        const layer = this.castLayer || this.node;
        const node = instantiate(this.cardBurst);
        node.setParent(layer, false);
        node.setWorldPosition(center);
        node.setSiblingIndex(layer.children.length - 1);

        this.scheduleOnce(() => {
            if (node.isValid) node.destroy();
        }, Math.max(0.2, this.cardBurstSeconds));
    }

    /** 克隆若干份卡片向外飞散淡出（不用 shader 的"碎散"效果） */
    private spawnShards(card: Node) {
        const layer = card.parent;
        if (!layer) return;

        const count = Math.max(1, Math.floor(this.cardShardCount));
        const seconds = Math.max(0.05, this.cardShardSeconds);

        for (let i = 0; i < count; i++) {
            const shard = instantiate(card);
            shard.name = '__castShard';
            shard.setParent(layer, false);
            shard.setPosition(card.position);
            shard.setScale(card.scale.x, card.scale.y, 1);
            shard.setSiblingIndex(layer.children.length - 1);

            const iv = shard.getComponent(ItemView);
            if (iv) iv.destroy();
            const btn = shard.getComponent(Button);
            if (btn) btn.interactable = false;

            const shardOp = shard.getComponent(UIOpacity) || shard.addComponent(UIOpacity);
            shardOp.opacity = 200;

            // 八方向散开 + 随机角度/距离
            const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
            const dist = this.cardShardDistance * (0.55 + Math.random() * 0.7);
            const tx = card.position.x + Math.cos(ang) * dist;
            const ty = card.position.y + Math.sin(ang) * dist;

            tween(shard)
                .to(
                    seconds,
                    {
                        position: new Vec3(tx, ty, 0),
                        scale: new Vec3(card.scale.x * 0.35, card.scale.y * 0.35, 1),
                        angle: (Math.random() - 0.5) * 70,
                    },
                    { easing: 'quadOut' },
                )
                .call(() => {
                    if (shard.isValid) shard.destroy();
                })
                .start();

            tween(shardOp).to(seconds, { opacity: 0 }).start();
        }
    }

    /** 屏幕正中央的世界坐标（取 Canvas 原点，拿不到就用可见区域中心） */
    private screenCenterWorld(): Vec3 {
        let n: Node | null = this.node;
        while (n) {
            if (n.getComponent(Canvas)) return n.worldPosition.clone();
            n = n.parent;
        }

        const size = view.getVisibleSize();
        return new Vec3(size.width / 2, size.height / 2, 0);
    }
}
