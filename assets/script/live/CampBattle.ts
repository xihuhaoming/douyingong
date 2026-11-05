import {
    _decorator,
    Component,
    Graphics,
    Node,
    Prefab,
    Label,
    ProgressBar,
    UITransform,
    Vec3,
    clamp,
    instantiate,
    input,
    Input,
    EventTouch,
    view,
} from 'cc';
import { liveEventBus, LiveUserEvent } from './LiveEventBus';
import { SoldierUnit } from './SoldierUnit';
import { SkillProjectile } from './SkillProjectile';
import { GiftEffectManager } from './GiftEffectManager';
import { DamageTextLayer } from './DamageTextLayer';

const { ccclass, property } = _decorator;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 场上一个活着的小兵 */
interface Fighter {
    unit: SoldierUnit;
    side: number;
    hp: number;
    /** 距离下次攻击的倒计时（秒） */
    nextAttack: number;
}

/** 一颗在飞的弹体 */
interface Flight {
    proj: SkillProjectile;
    /** 发射方：-1 左 / +1 右，伤害只结算给对方 */
    side: number;
    /** 这颗弹的基础伤害 */
    damage: number;
    done: boolean;
}

/**
 * 阵营攻防战主控（挂在 BattleLayer 上）。
 *
 * 玩法：
 *   - 观众点屏幕左/右半边 → 该方出一个兵，落在点击位置（或出生区域随机）
 *   - 落地后持续朝中线（空气墙）前进，走到墙前停住；双方允许 wallOverlap 的轻微交叠
 *   - 每隔几秒朝对面发射一颗【抛物线】弹体，弹体真的飞到敌人身上才扣血
 *   - 命中点周围 skillRadius 内的所有敌人都吃伤害，边缘按 damageFalloff 衰减
 *   - 血量归零 → 变灰淡出消失（播死亡特效）
 */
@ccclass('CampBattle')
export class CampBattle extends Component {
    @property({ type: Prefab, tooltip: '小兵 prefab 兜底（左右没单独配时用这个）' })
    soldierPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '左方小兵 prefab（空 = 用 soldierPrefab）' })
    leftSoldierPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '右方小兵 prefab（空 = 用 soldierPrefab）' })
    rightSoldierPrefab: Prefab | null = null;

    @property({ type: Node, tooltip: '左方出生点 / 出生区域（UITransform 的宽高就是随机范围）' })
    leftRoot: Node | null = null;

    @property({ type: Node, tooltip: '右方出生点 / 出生区域' })
    rightRoot: Node | null = null;

    @property({ type: Node, tooltip: '空气墙节点（中线），双方都走不过去；不配 = 用本节点 x' })
    centerWall: Node | null = null;

    @property({ type: Node, tooltip: '弹体挂载层（空 = 挂在战斗层下）' })
    skillLayer: Node | null = null;

    @property({ type: Prefab, tooltip: '技能弹体 prefab（空 = 代码生成占位圆球）' })
    projectilePrefab: Prefab | null = null;

    @property({ tooltip: '小兵贴图默认朝向：画的是朝右就勾上' })
    artFaceRight = true;

    @property({ tooltip: '右方小兵贴图是否也朝右（右方图是朝左的话取消勾选）' })
    rightArtFaceRight = true;

    // ------------------------------------------------ 移动 / 空气墙

    @property({ tooltip: '前进速度（px/秒）' })
    moveSpeed = 110;

    @property({ tooltip: '双方允许交叠的宽度（px），20 = 两边各允许压过中线 10' })
    wallOverlap = 20;

    @property({ tooltip: '小兵碰撞半径（px），同时决定在空气墙前停在哪' })
    unitRadius = 90;

    // ------------------------------------------------ 战斗数值

    @property({ tooltip: '每个小兵的满血量' })
    soldierMaxHp = 100;

    @property({ tooltip: '单发技能的基础伤害下限' })
    damageMin = 10;

    @property({ tooltip: '单发技能的基础伤害上限' })
    damageMax = 80;

    @property({ tooltip: '攻击间隔下限（秒）' })
    attackIntervalMin = 2.0;

    @property({ tooltip: '攻击间隔上限（秒）' })
    attackIntervalMax = 4.0;

    @property({ tooltip: '超过这个距离就不出手（px）' })
    attackRange = 700;

    @property({ tooltip: '每边场上最多多少个兵' })
    maxAlivePerSide = 15;

    @property({ tooltip: '开局每边先出几个兵（演示用，0 = 空场开局）' })
    initialSoldiersPerSide = 3;

    @property({ tooltip: '进直播间（enter 事件）的出兵概率 0~1' })
    enterChance = 0.6;

    // ------------------------------------------------ 技能弹体

    @property({ tooltip: '弹体飞行速度（px/秒）' })
    projectileSpeed = 800;

    @property({ tooltip: '弹体碰撞半径（px）' })
    projectileRadius = 26;

    @property({ tooltip: '抛物线最高点高度（px）' })
    arcHeight = 180;

    @property({ tooltip: '技能范围伤害半径（px）' })
    skillRadius = 120;

    @property({ tooltip: '范围边缘伤害系数（0~1），1 = 不衰减' })
    damageFalloff = 0.6;

    // ------------------------------------------------ 出兵交互

    @property({ tooltip: '点屏幕左/右半边出兵（真实观众交互；预览时可关掉避免和模拟按钮重复）' })
    tapToBoost = true;

    @property({ tooltip: '点哪里就在那一侧的哪里落地（关掉 = 固定从左右出生点出）' })
    dropToTap = true;

    @property({
        tooltip: '出生范围用出生点节点自己的 UITransform 宽高（把 LeftSpawn / RightSpawn 拖大即可）',
    })
    useSpawnArea = true;

    @property({ tooltip: '落地基准高度（相对 BattleLayer，负数往下）' })
    dropY = -80;

    @property({ tooltip: '纵向是否也跟随点击位置（关掉 = 只用 dropY 当地面）' })
    followTapY = false;

    @property({ tooltip: '落点离中线 / 屏幕边缘的留白（px），防止贴边' })
    dropSidePadding = 60;

    @property({ tooltip: '出生区域内部留白（px），区域小的时候要调小，否则全挤在中心' })
    areaPad = 10;

    @property({ tooltip: '落点横向随机偏移（px），同一点连点几个不会完全重叠' })
    dropJitterX = 50;

    @property({ tooltip: '落点纵向随机偏移（px）' })
    dropJitterY = 25;

    @property({ tooltip: '从天而降的高度（px），0 = 直接在落点出现' })
    dropHeight = 120;

    @property({ tooltip: '落下过程耗时（秒）' })
    dropSeconds = 0.35;

    // ------------------------------------------------ 表现

    @property({ type: GiftEffectManager, tooltip: '技能命中/死亡/点击特效走这里播（可空）' })
    fx: GiftEffectManager | null = null;

    @property({ type: DamageTextLayer, tooltip: '伤害飘字层（可空，不配就不飘数字）' })
    damageText: DamageTextLayer | null = null;

    @property({ type: Prefab, tooltip: '技能命中特效 prefab（可空）' })
    hitEffect: Prefab | null = null;

    @property({ type: Prefab, tooltip: '死亡特效 prefab（可空）' })
    deathEffect: Prefab | null = null;

    @property({ type: Prefab, tooltip: '点击助力时指尖爆点特效（可空）' })
    tapBurst: Prefab | null = null;

    @property({ type: Label, tooltip: '左方总血量文字（可空）' })
    hpLabelL: Label | null = null;

    @property({ type: Label, tooltip: '右方总血量文字（可空）' })
    hpLabelR: Label | null = null;

    @property({ type: ProgressBar, tooltip: '左方血条（可空）' })
    hpBarL: ProgressBar | null = null;

    @property({ type: ProgressBar, tooltip: '右方血条（可空）' })
    hpBarR: ProgressBar | null = null;

    // ------------------------------------------------ 运行时状态

    private rows: { [side: number]: Fighter[] } = { '-1': [], '1': [] };
    /** 每个小兵 prefab 一个池：左右兵种不同时，复用的节点不会串贴图 */
    private pools = new Map<Prefab, SoldierUnit[]>();
    /** 记录每个小兵节点来自哪个 prefab，回池时才知道放回哪个池 */
    private owner = new Map<SoldierUnit, Prefab>();
    private hpDirty = true;
    /** 出生区域只在第一次算到时打一条日志，避免刷屏 */
    private areaLogged = false;

    /** 在飞的弹体 */
    private flights: Flight[] = [];
    /** 弹体对象池 */
    private projPool: SkillProjectile[] = [];

    onLoad() {
        liveEventBus.onUser('boost', this.onBoost);
        liveEventBus.onUser('enter', this.onEnter);
        if (this.tapToBoost) {
            input.on(Input.EventType.TOUCH_END, this.onTap, this);
        }
    }

    start() {
        const n = Math.floor(this.initialSoldiersPerSide);
        for (let i = 0; i < n; i++) {
            this.spawnSoldier(-1);
            this.spawnSoldier(1);
        }
        this.refreshHpUi(true);
    }

    onDestroy() {
        liveEventBus.offUser('boost', this.onBoost);
        liveEventBus.offUser('enter', this.onEnter);
        input.off(Input.EventType.TOUCH_END, this.onTap, this);
        this.clearPool();
    }

    private onBoost = (e: LiveUserEvent) => {
        this.spawnSoldier(e.side ?? this.randomSide(), e.nickname, e.tap);
    };

    private onEnter = (e: LiveUserEvent) => {
        if (Math.random() < this.enterChance) {
            this.spawnSoldier(e.side ?? this.randomSide(), e.nickname);
        }
    };

    private randomSide(): number {
        return Math.random() < 0.5 ? -1 : 1;
    }

    // ------------------------------------------------ 观众点屏幕助力

    /** 点屏幕左半边 = 左方助力，右半边 = 右方助力；点击位置一起发下去当落点 */
    private onTap(e: EventTouch) {
        const loc = e.getUILocation();
        const half = this.viewSize().width / 2;
        const side = loc.x < half ? -1 : 1;
        liveEventBus.emitUser('boost', { side, tap: { x: loc.x, y: loc.y } });
        if (this.tapBurst) {
            this.fx?.playPrefab(this.tapBurst, new Vec3(loc.x, loc.y, 0), 0.6);
        }
    }

    /** 屏幕可见尺寸（抖音容器里 view 可能拿不到，给设计分辨率兜底） */
    private viewSize(): { width: number; height: number } {
        try {
            const s = view.getVisibleSize();
            if (s && s.width > 1 && s.height > 1) return { width: s.width, height: s.height };
        } catch (err) {
            /* 抖音运行时 view 可能拿不到，走兜底 */
        }
        return { width: 750, height: 1334 };
    }

    /** 战斗层自己的尺寸（判断左右半屏、限制落点范围都靠它） */
    private battleSize(): { width: number; height: number } {
        const ut = this.node.getComponent(UITransform);
        if (ut && ut.contentSize.width > 1 && ut.contentSize.height > 1) {
            return { width: ut.contentSize.width, height: ut.contentSize.height };
        }
        return this.viewSize();
    }

    /** 点击的 UI 坐标 → BattleLayer 的局部坐标（原点在图层中心） */
    private tapToLocal(tap: { x: number; y: number }): Vec3 {
        const size = this.battleSize();
        const vs = this.viewSize();
        const u = clamp(tap.x / Math.max(1, vs.width), 0, 1);
        const v = clamp(tap.y / Math.max(1, vs.height), 0, 1);
        return new Vec3((u - 0.5) * size.width, (v - 0.5) * size.height, 0);
    }

    /** BattleLayer 局部坐标 → 出生点节点（小兵的父节点）的局部坐标 */
    private toRootLocal(root: Node, x: number, y: number): Vec3 {
        const utSelf = this.node.getComponent(UITransform);
        const world = utSelf
            ? utSelf.convertToWorldSpaceAR(new Vec3(x, y, 0), new Vec3())
            : new Vec3(this.node.worldPosition.x + x, this.node.worldPosition.y + y, 0);

        // 注意：这里不能给 root 补 UITransform，否则会给它塞一个默认 100x100 的尺寸，
        // 反过来污染下面 spawnRect() 的区域判断
        const utRoot = root.getComponent(UITransform);
        if (utRoot) return utRoot.convertToNodeSpaceAR(world, new Vec3());

        const wp = root.worldPosition;
        const sx = Math.abs(root.worldScale.x) || 1;
        const sy = Math.abs(root.worldScale.y) || 1;
        return new Vec3((world.x - wp.x) / sx, (world.y - wp.y) / sy, 0);
    }

    /**
     * 出生区域 = 出生点节点自己 UITransform 的宽高。
     * 返回的是「相对该节点的局部坐标」范围，原点就是节点 position。
     * 没配 UITransform 或者尺寸小得像默认值，就返回 null 走老逻辑。
     */
    private spawnRect(root: Node): { minX: number; maxX: number; minY: number; maxY: number } | null {
        if (!this.useSpawnArea) return null;
        const ut = root.getComponent(UITransform);
        if (!ut) return null;

        // 用 contentSize 本身即可：子节点坐标和 contentSize 是同一套单位，
        // 节点整体缩放会同步放大子节点坐标，不需要再乘 scale
        const w = ut.contentSize.width;
        const h = ut.contentSize.height;
        if (w < 20 || h < 20) return null;

        if (!this.areaLogged) {
            this.areaLogged = true;
            console.log(`[CampBattle] ${root.name} 出生区域 ${w.toFixed(0)} x ${h.toFixed(0)}（按节点 UITransform 宽高）`);
        }

        const ax = ut.anchorPoint.x;
        const ay = ut.anchorPoint.y;
        return {
            minX: -w * ax,
            maxX: w * (1 - ax),
            minY: -h * ay,
            maxY: h * (1 - ay),
        };
    }

    /** 在出生点局部坐标 (x, y) 处从上方落下；dropHeight = 0 就是原地出现 */
    private dropAt(x: number, y: number) {
        const to = new Vec3(x, y, 0);
        const from = new Vec3(x, y + this.dropHeight, 0);
        return { from, to, seconds: Math.max(0.15, this.dropSeconds) };
    }

    // ------------------------------------------------ 出兵

    /** 这一方用哪个小兵 prefab：优先各自配置，其次兜底，再没有就出不了兵 */
    private prefabFor(side: number): Prefab | null {
        return (side > 0 ? this.rightSoldierPrefab : this.leftSoldierPrefab) || this.soldierPrefab;
    }

    /**
     * 算这一个兵的落点（返回的是「相对出生点节点」的局部坐标）。
     *
     * 优先级：
     *   1. 出生点节点配了 UITransform 宽高（useSpawnArea）→ 落点一定夹在这个矩形里
     *      · 有点击位置：点在矩形内就落点上，点在外面会被拉回最近的边
     *      · 没有点击位置（弹幕/按钮）：矩形内随机
     *   2. 没配区域 → 按屏幕半屏限制，纵向用 dropY（或跟随点击）
     *   3. 连点击位置都没有 → 出生点附近随机落一个
     *
     * 注意：落点之后还会继续朝中线走，这里只决定「出生在哪」。
     */
    private resolveDrop(root: Node, side: number, tap?: { x: number; y: number }) {
        const area = this.spawnRect(root);
        const pad = Math.max(0, this.dropSidePadding);
        const hasTap = this.dropToTap && !!tap;

        if (area) {
            const ap = Math.max(0, this.areaPad);
            const x0 = Math.min(area.minX + ap, area.maxX - ap);
            const x1 = Math.max(area.minX + ap, area.maxX - ap);
            const y0 = Math.min(area.minY + ap, area.maxY - ap);
            const y1 = Math.max(area.minY + ap, area.maxY - ap);

            if (hasTap && tap) {
                const p = this.tapToLocal(tap);
                const local = this.toRootLocal(root, p.x, p.y);
                const x = clamp(local.x + rand(-this.dropJitterX, this.dropJitterX), x0, x1);
                const y = clamp(local.y + rand(-this.dropJitterY, this.dropJitterY), y0, y1);
                return this.dropAt(x, y);
            }

            // 没有点击位置：直接在区域里随机
            return this.dropAt(rand(x0, x1), rand(y0, y1));
        }

        if (hasTap && tap) {
            const size = this.battleSize();
            const p = this.tapToLocal(tap);
            const halfW = size.width / 2;

            // 左半屏：[-halfW+pad, -pad]，右半屏：[pad, halfW-pad]
            const lo = side < 0 ? -halfW + pad : pad;
            const hi = side < 0 ? -pad : halfW - pad;
            const minX = Math.min(lo, hi);
            const maxX = Math.max(lo, hi);

            const x = clamp(p.x + rand(-this.dropJitterX, this.dropJitterX), minX, maxX);
            const baseY = this.followTapY
                ? clamp(p.y, -size.height / 2 + pad, size.height / 2 - pad)
                : this.dropY;
            const y = baseY + rand(-this.dropJitterY, this.dropJitterY);

            const to = this.toRootLocal(root, x, y);
            return this.dropAt(to.x, to.y);
        }

        // 没有点击、没有区域：出生点附近随机落一个，之后照样朝中线走
        return this.dropAt(rand(-30, 30), rand(-24, 24));
    }

    /** 出一个兵（血量 soldierMaxHp）。观众助力 / 进直播间都走这里 */
    spawnSoldier(side: number, _nickname?: string, tap?: { x: number; y: number }) {
        const root = side > 0 ? this.rightRoot : this.leftRoot;
        const pf = this.prefabFor(side);
        if (!root || !pf) {
            console.warn('[CampBattle] 没配置小兵 prefab / 出生点，出不了兵');
            return;
        }
        const list = this.rows[side] || (this.rows[side] = []);
        if (list.length >= this.maxAlivePerSide) return; // 场上满了就不再出

        const unit = this.take(pf);
        unit.node.setParent(root, false);
        unit.side = side;
        list.push({
            unit,
            side,
            hp: this.soldierMaxHp,
            nextAttack: rand(this.attackIntervalMin, this.attackIntervalMax),
        });

        const drop = this.resolveDrop(root, side, tap);
        // 左方要朝右（面向敌方），右方要朝左；两张图原图朝向可以不一样
        const artFaceRight = side < 0 ? this.artFaceRight : this.rightArtFaceRight;
        const faceRight = side < 0 ? artFaceRight : !artFaceRight;
        unit.run({
            from: drop.from,
            to: drop.to,
            faceRight,
            walkSeconds: drop.seconds,
        });
        this.hpDirty = true;
    }

    // ------------------------------------------------ 主循环

    update(dt: number) {
        this.march();
        this.tickAttack(dt);
        this.tickFlights();

        if (this.hpDirty) this.refreshHpUi();
    }

    /** 空气墙世界 x */
    private wallWorldX(): number {
        return this.centerWall ? this.centerWall.worldPosition.x : this.node.worldPosition.x;
    }

    /**
     * 双方持续朝中线前进。
     * 停步位置 = 离中线「小兵半径 - 交叠量/2」，两边各让一半，所以视觉上交叠 wallOverlap。
     */
    private march() {
        const wallX = this.wallWorldX();
        const halfOverlap = Math.max(0, this.wallOverlap) / 2;
        const r = Math.max(1, this.unitRadius);
        const leftStop = wallX - r + halfOverlap;
        const rightStop = wallX + r - halfOverlap;

        for (const f of this.rows[-1]) f.unit.walkToWorldX(leftStop, this.moveSpeed);
        for (const f of this.rows[1]) f.unit.walkToWorldX(rightStop, this.moveSpeed);
    }

    /** 攻击计时：到点就朝对面发射一颗抛物线弹体 */
    private tickAttack(dt: number) {
        for (const side of [-1, 1]) {
            const list = this.rows[side];
            const foes = this.rows[-side];
            if (!list.length) continue;

            for (const f of list) {
                f.nextAttack -= dt;
                if (f.nextAttack > 0) continue;
                f.nextAttack = rand(this.attackIntervalMin, this.attackIntervalMax);
                if (!foes.length) continue;

                const selfPos = f.unit.node.worldPosition;
                const usable = foes.filter((g) => {
                    const p = g.unit.node.worldPosition;
                    return Vec3.distance(selfPos, p) <= this.attackRange;
                });
                if (!usable.length) continue;

                this.fire(f, usable[(Math.random() * usable.length) | 0]);
            }
        }
    }

    /** 发射一颗弹体：起点是发射者，落点是目标当前位置（发射瞬间锁定） */
    private fire(attacker: Fighter, target: Fighter) {
        const from = attacker.unit.node.worldPosition.clone();
        const to = target.unit.node.worldPosition.clone();
        const dist = Vec3.distance(from, to);

        const duration = clamp(dist / Math.max(50, this.projectileSpeed), 0.22, 1.4);
        const arc = this.arcHeight * clamp(dist / 500, 0.35, 1.2);

        const proj = this.takeProjectile();
        proj.setSide(attacker.side);
        proj.launch(from, to, duration, arc);

        attacker.unit.attackPulse();
        this.flights.push({
            proj,
            side: attacker.side,
            damage: Math.round(rand(this.damageMin, this.damageMax)),
            done: false,
        });
    }

    /** 推进所有弹体：撞到敌人 or 落地就炸，做范围结算 */
    private tickFlights() {
        if (!this.flights.length) return;

        const dead: Fighter[] = [];
        const reach = Math.max(4, this.projectileRadius) + Math.max(1, this.unitRadius);

        for (const fl of this.flights) {
            if (fl.done) continue;

            const pos = fl.proj.node.worldPosition;
            const foes = this.rows[-fl.side];

            let hit = false;
            for (const g of foes) {
                if (Vec3.distance(pos, g.unit.node.worldPosition) <= reach) {
                    hit = true;
                    break;
                }
            }

            if (!hit && !fl.proj.arrived) continue;

            fl.done = true;
            this.explode(fl, pos, dead);
        }

        if (this.flights.some((f) => f.done)) {
            this.flights = this.flights.filter((f) => !f.done);
        }
        if (dead.length) this.killFighters(dead);
    }

    /** 范围伤害：命中点 skillRadius 内的敌人全部吃伤害，边缘按 damageFalloff 衰减 */
    private explode(fl: Flight, at: Vec3, dead: Fighter[]) {
        const foes = this.rows[-fl.side];
        const range = Math.max(1, this.skillRadius) + Math.max(1, this.unitRadius);
        const falloff = clamp(this.damageFalloff, 0, 1);

        for (const g of foes) {
            const d = Vec3.distance(at, g.unit.node.worldPosition);
            if (d > range) continue;

            const k = 1 - (1 - falloff) * clamp(d / range, 0, 1);
            const dmg = Math.max(1, Math.round(fl.damage * k));

            g.hp -= dmg;
            g.unit.showDamage();
            this.damageText?.show(g.unit.node.worldPosition, dmg);

            if (g.hp <= 0) dead.push(g);
        }

        if (this.hitEffect) {
            this.fx?.playPrefab(this.hitEffect, at.clone(), 0.6);
        }
        this.recycleProjectile(fl.proj);
    }

    private killFighters(dead: Fighter[]) {
        for (const f of dead) {
            if (!this.removeFighter(f)) continue; // 同一帧被两颗弹重复命中的话只结算一次
            if (this.deathEffect) {
                this.fx?.playPrefab(this.deathEffect, f.unit.node.worldPosition.clone(), 0.8);
            }
            f.unit.die(() => this.recycle(f.unit));
        }
    }

    private removeFighter(f: Fighter): boolean {
        for (const side of [-1, 1]) {
            const list = this.rows[side];
            const i = list.indexOf(f);
            if (i >= 0) {
                list.splice(i, 1);
                this.hpDirty = true;
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------ 对外读数（背景推挤 / 结算用）

    /**
     * 双方总血量对比。符号就是「谁被压」：
     *   +1 ≈ 左方空了、右方满血（视觉上右边压过来）
     *   -1 ≈ 右方空了、左方满血（左边压过来）
     *    0 ≈ 势均力敌 / 场上没人
     */
    getBalance(): number {
        let left = 0;
        let right = 0;
        for (const f of this.rows[-1]) left += Math.max(0, f.hp);
        for (const f of this.rows[1]) right += Math.max(0, f.hp);
        const total = left + right;
        return total > 0 ? (right - left) / total : 0;
    }

    // ------------------------------------------------ 血量 UI

    /** 总血量 = 场上己方小兵血量之和；一方全灭就归零，等观众助力重新出兵 */
    private refreshHpUi(force = false) {
        if (!force && !this.hpDirty) return;
        this.hpDirty = false;
        for (const side of [-1, 1]) {
            let sum = 0;
            for (const f of this.rows[side]) sum += Math.max(0, f.hp);
            const full = this.maxAlivePerSide * this.soldierMaxHp;
            const label = side > 0 ? this.hpLabelR : this.hpLabelL;
            const bar = side > 0 ? this.hpBarR : this.hpBarL;
            if (label) label.string = String(sum);
            if (bar) bar.progress = full > 0 ? Math.min(1, sum / full) : 0;
        }
    }

    // ------------------------------------------------ 弹体对象池

    private takeProjectile(): SkillProjectile {
        const cached = this.projPool.pop();
        if (cached) {
            cached.node.active = true;
            return cached;
        }

        const parent = this.skillLayer || this.node;
        let node: Node;
        if (this.projectilePrefab) {
            node = instantiate(this.projectilePrefab);
        } else {
            node = new Node('SkillProj');
            node.layer = parent.layer;
            node.addComponent(UITransform);
            node.addComponent(Graphics);
        }
        node.setParent(parent, false);
        return node.getComponent(SkillProjectile) || node.addComponent(SkillProjectile);
    }

    private recycleProjectile(p: SkillProjectile) {
        p.stop();
        p.node.active = false;
        this.projPool.push(p);
    }

    // ------------------------------------------------ 小兵对象池

    private take(pf: Prefab): SoldierUnit {
        let list = this.pools.get(pf);
        if (!list) {
            list = [];
            this.pools.set(pf, list);
        }
        let unit = list.pop();
        if (!unit) {
            const node = instantiate(pf);
            unit = node.getComponent(SoldierUnit) || node.addComponent(SoldierUnit);
        }
        this.owner.set(unit, pf);
        return unit;
    }

    private recycle(unit: SoldierUnit) {
        unit.sleep();
        const pf = this.owner.get(unit);
        const list = pf ? this.pools.get(pf) : null;
        if (list) {
            list.push(unit);
        } else {
            unit.node.destroy();
        }
    }

    private clearPool() {
        for (const list of this.pools.values()) {
            for (const u of list) u.node.destroy();
        }
        this.pools.clear();
        this.owner.clear();

        for (const p of this.projPool) p.node.destroy();
        this.projPool.length = 0;
        this.flights.length = 0;
    }
}
