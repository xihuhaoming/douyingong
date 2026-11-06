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
import { BattleFormation } from './BattleFormation';
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
    /** 占用的阵型站位编号（0 = 最前排），死亡后释放 */
    slot: number;
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
 *   - 落地后走到自己的阵型站位（formationCols x formationRows 的格子阵列，
 *     最前排贴着空气墙，后面的列依次后撤），不会全挤在中线一条竖线上
 *   - 同层按世界 y 排渲染顺序，屏幕上越靠下的兵盖住上面的（2.5D 遮挡）
 *   - 每隔几秒朝对面发射一颗【抛物线】弹体，弹体真的飞到敌人身上才扣血
 *   - 命中点周围 skillRadius 内的所有敌人都吃伤害，边缘按 damageFalloff 衰减
 *   - 血量归零 → 变灰淡出消失（播死亡特效），站位释放给后面的兵
 */
@ccclass('CampBattle')
export class CampBattle extends Component {
    @property({ type: Prefab, tooltip: '小兵 prefab 兜底（左右没单独配时用这个）' })
    soldierPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '左方小兵 prefab（空 = 用 soldierPrefab）' })
    leftSoldierPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '右方小兵 prefab（空 = 用 soldierPrefab）' })
    rightSoldierPrefab: Prefab | null = null;

    // ------------------------------------------------ 对象池

    @property({ tooltip: '每种兵最多缓存多少个（超出直接销毁，防止无限出兵把池子撑爆）' })
    maxPooledPerPrefab = 40;

    @property({ tooltip: '开局预热多少个兵（每边），减少前几次出兵的卡顿；0 = 不预热' })
    prewarmPerSide = 6;

    @property({ type: Node, tooltip: '左方出生点 / 出生区域（UITransform 的宽高就是随机范围）' })
    leftRoot: Node | null = null;

    @property({ type: Node, tooltip: '右方出生点 / 出生区域' })
    rightRoot: Node | null = null;

    @property({ type: Node, tooltip: '空气墙节点（中线），双方都走不过去；不配 = 用本节点 x' })
    centerWall: Node | null = null;

    @property({ type: Node, tooltip: '弹体挂载层（空 = 挂在战斗层下）' })
    skillLayer: Node | null = null;

    @property({
        type: Node,
        tooltip: '小兵统一挂载层（只用来做 2.5D 遮挡排序；空 = 直接挂在战斗层下）',
    })
    soldierRoot: Node | null = null;

    @property({ type: Prefab, tooltip: '技能弹体 prefab（兜底；左右没单独配时用它，空 = 代码生成占位圆球）' })
    projectilePrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '左方弹体 prefab（空 = 用上面的兜底）' })
    leftProjectilePrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '右方弹体 prefab（空 = 用上面的兜底）' })
    rightProjectilePrefab: Prefab | null = null;

    // ------------------------------------------------ 命中爆炸（独立 spine）

    @property({
        type: Prefab,
        tooltip: '左方命中爆炸 prefab。配了就用它（独立 spine），不再播弹体自身的 boom',
    })
    leftBoomPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '右方命中爆炸 prefab' })
    rightBoomPrefab: Prefab | null = null;

    @property({ tooltip: '左方爆炸 spine 动画名（留空 = 用 prefab 上 Spine 组件的默认动画）' })
    leftBoomAnim = '';

    @property({ tooltip: '右方爆炸 spine 动画名（留空 = 默认动画）' })
    rightBoomAnim = '';

    @property({ tooltip: '左方爆炸特效时长（秒，要 ≥ spine 动画实际长度，否则会播一半被回收）' })
    leftBoomSeconds = 0.8;

    @property({ tooltip: '右方爆炸特效时长（秒）' })
    rightBoomSeconds = 0.8;

    @property({ tooltip: '小兵贴图默认朝向：画的是朝右就勾上' })
    artFaceRight = true;

    @property({ tooltip: '右方小兵贴图是否也朝右（右方图是朝左的话取消勾选）' })
    rightArtFaceRight = true;

    // ------------------------------------------------ 移动 / 空气墙

    @property({ tooltip: '前进速度（px/秒）' })
    moveSpeed = 110;

    @property({ tooltip: '双方允许交叠的宽度（px），20 = 两边各允许压过中线 10' })
    wallOverlap = 20;

    @property({ tooltip: '小兵碰撞半径（px），同时决定最前排离空气墙多远' })
    unitRadius = 90;

    @property({
        tooltip: '双方小兵中心距离小于这个值（px）就切攻击动画。最前排贴脸时约 2×(unitRadius-wallOverlap/2)',
    })
    contactRange = 200;

    @property({ tooltip: '打印"小兵进入交战"的日志，调试用' })
    debugLogContact = false;

    // ------------------------------------------------ 矩形活动区域（空气墙）

    @property({
        type: Node,
        tooltip: '活动区域：拖一个铺满可视区的空节点（用它的 UITransform 矩形）；空 = 用全屏 + 下面的留白',
    })
    playArea: Node | null = null;

    @property({ tooltip: '左右留白（px），防止贴边被裁' })
    areaPaddingX = 40;

    @property({ tooltip: '上边留白（px），给顶部血条/头像让位' })
    areaPaddingTop = 120;

    @property({ tooltip: '下边留白（px），一般是底部按钮/抽屉的高度' })
    areaPaddingBottom = 230;

    // ------------------------------------------------ 阵型站位

    @property({ tooltip: '阵型列数（从空气墙往后排，1 = 只站一排）' })
    formationCols = 3;

    @property({ tooltip: '每列纵向站几个' })
    formationRows = 5;

    @property({ tooltip: '列间距（px，往自己后方退）' })
    colSpacing = 80;

    @property({ tooltip: '行间距（px，纵向）。比兵矮就会前后错开，2.5D 要的就是这个错位' })
    rowSpacing = 90;

    @property({ tooltip: '阵型纵向中心（相对战斗层 y）' })
    formationCenterY = -120;

    // ------------------------------------------------ 战斗数值

    @property({ tooltip: '每个小兵的满血量' })
    soldierMaxHp = 1000;

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

    @property({
        tooltip: '不限制单边兵力：勾上就忽略 maxAlivePerSide，格子满了自动往后加行，一直出',
    })
    unlimited = true;

    @property({
        tooltip: '每边场上最多多少个兵（unlimited 勾着时无效）。填 0 也等于不限制',
    })
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

    // ------------------------------------------------ 道具技能（外部调用）

    @property({ tooltip: '本地玩家阵营：-1 左 / +1 右。道具技能会打向对面' })
    mySide = -1;

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

    /** 复用同一个 Vec3 做区域夹紧，避免每帧 new */
    private tmpClamp = new Vec3();

    /** 站位满了只警告一次 */
    private slotFullWarned = false;
    /** 阵型（纯逻辑类，具体见 BattleFormation.ts） */
    private formation!: BattleFormation<Fighter>;

    /** 在飞的弹体 */
    private flights: Flight[] = [];
    /** 弹体对象池：按 prefab 分池，左右两套外观不会串 */
    private projPools = new Map<Prefab, SkillProjectile[]>();
    /** 弹体 → 它来自哪个 prefab（回收时才知道该还到哪个池） */
    private projOwner = new Map<SkillProjectile, Prefab>();

    onLoad() {
        this.initFormation();

        liveEventBus.onUser('boost', this.onBoost);
        liveEventBus.onUser('enter', this.onEnter);
        if (this.tapToBoost) {
            input.on(Input.EventType.TOUCH_END, this.onTap, this);
        }
    }

    start() {
        this.syncFormation();
        this.formation.reset();

        const cap = this.formation.baseSlotCount;
        if (!this.unlimited && this.maxAlivePerSide > 0 && cap < this.maxAlivePerSide) {
            console.warn(
                `[CampBattle] 阵型初始只有 ${cap} 个站位（${this.formationCols}列 x ${this.formationRows}行），` +
                    `maxAlivePerSide = ${this.maxAlivePerSide}，超出时会自动往后加行。` +
                    `想让阵型长度固定，把 maxAlivePerSide 调到 ${cap} 或更小。`,
            );
        }
        this.prewarm();

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

    /** 某个节点的局部坐标 → 世界坐标 */
    private toWorldOf(from: Node, v: Vec3): Vec3 {
        const ut = from.getComponent(UITransform);
        if (ut) return ut.convertToWorldSpaceAR(v, new Vec3());
        return new Vec3(from.worldPosition.x + v.x, from.worldPosition.y + v.y, v.z);
    }

    /** 出生点局部坐标 → 小兵挂载层的局部坐标（两者父级/位移可能不同） */
    private toLocalOf(parent: Node, from: Node, v: Vec3): Vec3 {
        if (parent === from) return v.clone();

        const world = this.toWorldOf(from, v);
        const utParent = parent.getComponent(UITransform);
        if (utParent) return utParent.convertToNodeSpaceAR(world, new Vec3());

        return new Vec3(world.x - parent.worldPosition.x, world.y - parent.worldPosition.y, v.z);
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

    // ------------------------------------------------ 阵型

    /** 创建阵型对象：Inspector 的配置喂给纯逻辑类，墙位置 / 纵向中心用 getter 实时取 */
    private initFormation() {
        if (this.formation) return;

        this.formation = new BattleFormation<Fighter>({
            side: -1,
            cols: this.formationCols,
            rows: this.formationRows,
            colSpacing: this.colSpacing,
            rowSpacing: this.rowSpacing,
            unitRadius: this.unitRadius,
            wallOverlap: this.wallOverlap,
            unlimited: this.unlimited || this.maxAlivePerSide <= 0,
            wallX: () => this.wallWorldX(),
            centerY: () => this.node.worldPosition.y + this.formationCenterY,
        });
    }

    /** 把 Inspector 上的阵型数值同步给纯逻辑类（运行中改了也能生效） */
    private syncFormation(side = -1) {
        this.initFormation();

        // 无限出兵时也不能超出活动区域：按「区域高度 / 行距」算行数上限
        const cols = Math.max(1, Math.floor(this.formationCols));
        const maxRows = this.maxRowsByArea();

        this.formation.setOptions({
            side: side > 0 ? 1 : -1,
            cols: this.formationCols,
            rows: this.formationRows,
            colSpacing: this.colSpacing,
            rowSpacing: this.rowSpacing,
            unitRadius: this.unitRadius,
            wallOverlap: this.wallOverlap,
            unlimited: this.unlimited || this.maxAlivePerSide <= 0,
            maxSlots: cols * maxRows,
        });
    }

    // ------------------------------------------------ 出兵

    /** 这一方用哪个小兵 prefab：优先各自配置，其次兜底，再没有就出不了兵 */
    private prefabFor(side: number): Prefab | null {
        return (side > 0 ? this.rightSoldierPrefab : this.leftSoldierPrefab) || this.soldierPrefab;
    }

    /**
     * 开局预热：先把节点实例化出来再 sleep 回池子，
     * 这样前几次出兵不用现场 instantiate（抖音小游戏首帧卡顿主要来自这里）。
     */
    private prewarm() {
        const n = Math.max(0, Math.floor(this.prewarmPerSide));
        if (n <= 0) return;

        for (const side of [-1, 1]) {
            const pf = this.prefabFor(side);
            if (!pf) continue;

            for (let i = 0; i < n; i++) {
                const unit = this.take(pf);
                unit.node.setParent(this.soldierRoot || this.node, false);
                this.recycle(unit);
            }
        }
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
     * 注意：落点之后还会走到自己的阵型站位，这里只决定「出生在哪」。
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
        // unlimited 勾着（或 maxAlivePerSide = 0）就不限制数量，一直出
        const capped = !this.unlimited && this.maxAlivePerSide > 0;
        if (capped && list.length >= this.maxAlivePerSide) return;
        if (list.length === 60) {
            console.warn(
                '[CampBattle] 单边已经 60 个兵了，低端机会开始掉帧；' +
                    '想稳一点就给 maxAlivePerSide 设个 40~60 的软上限。',
            );
        }

        // 先算落点 → 抢一个最近的空站位 → 才真去取节点，避免取出来又放不下
        const drop = this.resolveDrop(root, side, tap);
        // 落点也夹进活动区域：出生点贴着屏幕底部时，兵不会掉到画面外
        const dropTo = this.clampRootLocal(root, drop.to);
        const dropFrom = new Vec3(dropTo.x, dropTo.y + (drop.from.y - drop.to.y), 0);
        const dropWorld = this.toWorldOf(root, dropTo);
        this.syncFormation(side);
        const slot = this.formation.alloc(dropWorld.x, dropWorld.y);
        if (slot < 0) {
            if (!this.slotFullWarned) {
                this.slotFullWarned = true;
                console.warn(
                    `[CampBattle] ${side < 0 ? '左' : '右'}方阵型站满了（${this.formation.capacity} 个站位），` +
                        '这一波兵没出。想站更多人：调小 rowSpacing / 调大 PlayArea 高度 / 调大 formationCols。',
                );
            }
            return;
        }

        const unit = this.take(pf);
        // 统一挂到同一个父节点（SoldierRoot），否则左右两拨兵分属不同父节点，
        // 没法按 y 交叉排序；坐标从出生点换算过去，落点逻辑完全不用改
        const parent = this.soldierRoot || this.node;
        unit.node.setParent(parent, false);
        unit.side = side;

        const fighter: Fighter = {
            unit,
            side,
            hp: this.soldierMaxHp,
            nextAttack: rand(this.attackIntervalMin, this.attackIntervalMax),
            slot,
        };
        list.push(fighter);
        this.formation.occupy(slot, fighter);

        // 左方要朝右（面向敌方），右方要朝左；两张图原图朝向可以不一样
        const artFaceRight = side < 0 ? this.artFaceRight : this.rightArtFaceRight;
        const faceRight = side < 0 ? artFaceRight : !artFaceRight;
        unit.run({
            from: this.toLocalOf(parent, root, dropFrom),
            to: this.toLocalOf(parent, root, dropTo),
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
        this.updateContact();
        this.depthSort();

        if (this.hpDirty) this.refreshHpUi();
    }

    /**
     * 交战判定：对面有人在自己 contactRange 内就切攻击动画，脱离就切回行走。
     * 只改动画，不改位置和伤害（伤害照旧由 tickAttack 的弹体结算）。
     */
    private updateContact() {
        const range = Math.max(1, this.contactRange);
        const rr = range * range;

        for (const side of [-1, 1]) {
            const mine = this.rows[side];
            if (!mine.length) continue;

            const foes = this.rows[-side];
            if (!foes.length) {
                for (const f of mine) f.unit.setCombat(false);
                continue;
            }

            for (const f of mine) {
                const p = f.unit.node.worldPosition;
                let near = false;

                for (const g of foes) {
                    const q = g.unit.node.worldPosition;
                    const dx = p.x - q.x;
                    const dy = p.y - q.y;
                    if (dx * dx + dy * dy <= rr) {
                        near = true;
                        break;
                    }
                }

                if (this.debugLogContact && near && !f.unit.combat) {
                    console.log(
                        `[CampBattle] ${side < 0 ? '左' : '右'}方小兵进入交战（${range}px 内有人）`,
                    );
                }

                f.unit.setCombat(near);
            }
        }
    }

    /**
     * 2.5D 前后遮挡：同一层里，屏幕上越靠下（世界 y 越小）的小兵越晚画，盖住上面的那个。
     * 只调整 siblingIndex，不改坐标；y 相同也不会有抖动（排序稳定，索引只在变化时才设）。
     */
    private depthSort() {
        const parent = this.soldierRoot || this.node;
        const list: { node: Node; y: number }[] = [];

        for (const side of [-1, 1]) {
            for (const f of this.rows[side]) {
                const node = f.unit.node;
                if (node.parent === parent) list.push({ node, y: node.worldPosition.y });
            }
        }
        if (list.length < 2) return;

        list.sort((a, b) => b.y - a.y);

        // 取这批小兵当前占用的 siblingIndex 槽位（升序），再按 y 顺序重新分配，
        // 这样父节点里别的子节点（弹体层等）的相对位置不会被挤乱
        const slots = list.map((it) => it.node.getSiblingIndex()).sort((a, b) => a - b);
        for (let i = 0; i < list.length; i++) {
            const node = list[i].node;
            if (node.getSiblingIndex() !== slots[i]) node.setSiblingIndex(slots[i]);
        }
    }

    /** 空气墙世界 x */
    private wallWorldX(): number {
        return this.centerWall ? this.centerWall.worldPosition.x : this.node.worldPosition.x;
    }

    // ------------------------------------------------ 矩形活动区域

    /** 活动区域（世界坐标，已扣掉四边留白） */
    private playRect(): { minX: number; maxX: number; minY: number; maxY: number } {
        const area = this.playArea;
        const ut = area && area.isValid ? area.getComponent(UITransform) : null;

        let minX: number;
        let maxX: number;
        let minY: number;
        let maxY: number;

        if (ut) {
            const box = ut.getBoundingBoxToWorld();
            minX = box.x;
            maxX = box.x + box.width;
            minY = box.y;
            maxY = box.y + box.height;
        } else {
            // 没配区域：退化成「整个战斗层」
            const size = this.battleSize();
            const c = this.node.worldPosition;
            minX = c.x - size.width / 2;
            maxX = c.x + size.width / 2;
            minY = c.y - size.height / 2;
            maxY = c.y + size.height / 2;
        }

        const px = Math.max(0, this.areaPaddingX);
        const pt = Math.max(0, this.areaPaddingTop);
        const pb = Math.max(0, this.areaPaddingBottom);

        return {
            minX: minX + px,
            maxX: Math.max(minX + px, maxX - px),
            minY: minY + pb,
            maxY: Math.max(minY + pb, maxY - pt),
        };
    }

    /** 把世界坐标夹进活动区域（margin 是额外内缩，防止身体贴边被裁） */
    private clampWorld(x: number, y: number, marginX = 0, marginY = 0): Vec3 {
        const r = this.playRect();
        const loX = r.minX + marginX;
        const hiX = Math.max(loX, r.maxX - marginX);
        const loY = r.minY + marginY;
        const hiY = Math.max(loY, r.maxY - marginY);
        return this.tmpClamp.set(clamp(x, loX, hiX), clamp(y, loY, hiY), 0);
    }

    /** 出生点局部坐标 → 夹进活动区域 → 再转回出生点局部坐标 */
    private clampRootLocal(root: Node, v: Vec3): Vec3 {
        const world = this.toWorldOf(root, v);
        const cw = this.clampWorld(world.x, world.y, this.unitRadius * 0.5, this.unitRadius * 0.5);

        const ut = root.getComponent(UITransform);
        if (ut) return ut.convertToNodeSpaceAR(cw, new Vec3());

        const rp = root.worldPosition;
        return new Vec3(cw.x - rp.x, cw.y - rp.y, 0);
    }

    /** 区域高度内最多放几行（无限出兵时用来封顶） */
    private maxRowsByArea(): number {
        const r = this.playRect();
        const h = Math.max(1, r.maxY - r.minY);
        return Math.max(1, Math.floor(h / Math.max(1, this.rowSpacing)));
    }

    /**
     * 每个兵朝自己的阵型站位走。
     * 站位是固定格子：最前排由空气墙 + unitRadius 决定，后面的列依次往自己后方退，
     * 所以不会像以前那样全挤在中线一条竖线上。
     */
    private march() {
        for (const side of [-1, 1]) {
            if (!this.rows[side].length) continue;

            this.syncFormation(side);
            for (const f of this.rows[side]) {
                const p = this.formation.position(f.slot);
                // 夹进活动区域：阵型再怎么加行，也不会走出可视范围
                const c = this.clampWorld(p.x, p.y, this.unitRadius * 0.5, this.unitRadius * 0.5);
                f.unit.walkToWorldPos(c.x, c.y, this.moveSpeed);
            }
        }
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

        const proj = this.takeProjectile(attacker.side);
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

        // 爆炸优先级：本方的独立爆炸 prefab → 弹体自身 boom 动画 → 老 hitEffect
        const boomPrefab = this.boomPrefabFor(fl.side);
        if (boomPrefab) {
            const seconds = Math.max(0.2, fl.side > 0 ? this.rightBoomSeconds : this.leftBoomSeconds);
            const anim = fl.side > 0 ? this.rightBoomAnim : this.leftBoomAnim;
            this.fx?.playPrefab(boomPrefab, at.clone(), seconds, 0, anim);
            this.recycleProjectile(fl.proj);
            return;
        }

        if (this.hitEffect) {
            this.fx?.playPrefab(this.hitEffect, at.clone(), 0.6);
        }

        // 弹体本身带爆炸动画（Spine）就先留在原地播完，再回对象池
        const boom = fl.proj.playBoom();
        if (boom > 0) {
            this.scheduleOnce(() => this.recycleProjectile(fl.proj), boom);
        } else {
            this.recycleProjectile(fl.proj);
        }
    }

    private killFighters(dead: Fighter[]) {
        for (const f of dead) {
            if (!this.removeFighter(f)) continue; // 同一帧被两颗弹重复命中的话只结算一次
            if (this.deathEffect) {
                this.fx?.playPrefab(this.deathEffect, f.unit.node.worldPosition.clone(), 0.8);
            }
            // 站位等到尸体淡出播完再释放，避免后面的兵直接踩到还在倒的尸身上
            f.unit.die(() => {
                this.formation.free(f);
                this.syncFormation(f.side);
                this.formation.compact(this.rows[f.side]);
                this.recycle(f.unit);
            });
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

    // ------------------------------------------------ 道具技能：范围伤害

    /** 外部设置玩家阵营（接抖音登录 / 房间信息后调用） */
    setMySide(side: number) {
        this.mySide = side > 0 ? 1 : -1;
    }

    /** 敌方阵营 */
    get enemySide(): number {
        return this.mySide > 0 ? -1 : 1;
    }

    /** 某一阵营当前的人员中心；这边没人了就退回出生点 */
    campCenter(side: number): Vec3 {
        const list = this.rows[side];
        if (!list || !list.length) {
            const root = side > 0 ? this.rightRoot : this.leftRoot;
            return root ? root.worldPosition.clone() : this.node.worldPosition.clone();
        }

        let x = 0;
        let y = 0;
        for (const f of list) {
            const p = f.unit.node.worldPosition;
            x += p.x;
            y += p.y;
        }
        return new Vec3(x / list.length, y / list.length, 0);
    }

    /**
     * 范围技能结算（道具/礼物技能走这里）。
     *
     * @param side     施放方（-1 左 / +1 右），只打对面
     * @param at       爆点世界坐标
     * @param radius   范围半径（px）
     * @param damage   中心伤害（边缘按 damageFalloff 衰减）
     * @param effect   特效 prefab（可空）
     * @param effectSeconds 特效播放时长
     * @param effectAnim spine 动画名（留空用 prefab 默认动画）
     * @returns 打死了几个
     */
    castAreaDamage(
        side: number,
        at: Vec3,
        radius: number,
        damage: number,
        effect: Prefab | null = null,
        effectSeconds = 0.8,
        effectAnim = '',
    ): number {
        const foes = this.rows[-side];
        const range = Math.max(1, radius) + Math.max(1, this.unitRadius);
        const falloff = clamp(this.damageFalloff, 0, 1);
        const dead: Fighter[] = [];
        let hitCount = 0;

        for (const g of foes) {
            const d = Vec3.distance(at, g.unit.node.worldPosition);
            if (d > range) continue;

            const k = 1 - (1 - falloff) * clamp(d / range, 0, 1);
            const dmg = Math.max(1, Math.round(damage * k));

            g.hp -= dmg;
            g.unit.showDamage();
            this.damageText?.show(g.unit.node.worldPosition, dmg);
            hitCount++;

            if (g.hp <= 0) dead.push(g);
        }

        if (effect) {
            this.fx?.playPrefab(effect, at.clone(), effectSeconds, 0, effectAnim);
        } else if (this.hitEffect) {
            this.fx?.playPrefab(this.hitEffect, at.clone(), 0.6);
        }

        if (dead.length) this.killFighters(dead);
        this.hpDirty = true;

        console.log(
            `[CampBattle] ${side < 0 ? '左' : '右'}方道具技能：命中 ${hitCount} 个，击杀 ${dead.length} 个`,
        );
        return dead.length;
    }

    /**
     * 敌方阵营里的随机一点：优先挑一个活着的敌人，在它周围抖半个身位。
     * 这样每次放技能落点都不一样，不会永远砸在正中间。
     */
    randomEnemyPoint(): Vec3 {
        const foes = this.rows[this.enemySide];
        if (!foes.length) return this.campCenter(this.enemySide);

        const target = foes[Math.floor(Math.random() * foes.length)];
        const p = target.unit.node.worldPosition.clone();
        const r = Math.max(10, this.unitRadius * 0.5);

        p.x += (Math.random() - 0.5) * r * 2;
        p.y += (Math.random() - 0.5) * r * 2;
        return p;
    }

    /** 道具技能快捷入口：随机落在敌方阵营里的某个位置 */
    castSkillOnEnemy(
        damage: number,
        radius: number,
        effect: Prefab | null = null,
        effectSeconds = 0.8,
        effectAnim = '',
    ): number {
        const at = this.randomEnemyPoint();
        return this.castAreaDamage(this.mySide, at, radius, damage, effect, effectSeconds, effectAnim);
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
            const list = this.rows[side];
            let sum = 0;
            for (const f of list) sum += Math.max(0, f.hp);

            // 有限模式按上限算满血；无限模式按「初始格子数」和「当前人数」取大值，
            // 这样人越多血条越长，不会因为 maxAlivePerSide = 0 而恒为 0
            const capped = !this.unlimited && this.maxAlivePerSide > 0;
            const fullCount = capped
                ? this.maxAlivePerSide
                : Math.max(this.formation?.baseSlotCount ?? 1, list.length);

            const full = fullCount * this.soldierMaxHp;
            const label = side > 0 ? this.hpLabelR : this.hpLabelL;
            const bar = side > 0 ? this.hpBarR : this.hpBarL;
            if (label) label.string = String(sum);
            if (bar) bar.progress = full > 0 ? Math.min(1, sum / full) : 0;
        }
    }

    // ------------------------------------------------ 弹体对象池

    /** 这一方用哪个弹体 prefab */
    private projectilePrefabFor(side: number): Prefab | null {
        return (side > 0 ? this.rightProjectilePrefab : this.leftProjectilePrefab) || this.projectilePrefab;
    }

    /** 这一方用哪个爆炸 prefab（没配返回 null → 走弹体自身的 boom 动画 / hitEffect） */
    private boomPrefabFor(side: number): Prefab | null {
        return side > 0 ? this.rightBoomPrefab : this.leftBoomPrefab;
    }

    private takeProjectile(side: number): SkillProjectile {
        const pf = this.projectilePrefabFor(side);
        const parent = this.skillLayer || this.node;

        if (pf) {
            let list = this.projPools.get(pf);
            if (!list) {
                list = [];
                this.projPools.set(pf, list);
            }
            const cached = list.pop();
            if (cached) {
                cached.node.active = true;
                this.projOwner.set(cached, pf);
                return cached;
            }
        }

        let node: Node;
        if (pf) {
            node = instantiate(pf);
        } else {
            node = new Node('SkillProj');
            node.layer = parent.layer;
            node.addComponent(UITransform);
            node.addComponent(Graphics);
        }
        node.setParent(parent, false);

        const proj = node.getComponent(SkillProjectile) || node.addComponent(SkillProjectile);
        if (pf) this.projOwner.set(proj, pf);
        return proj;
    }

    private recycleProjectile(p: SkillProjectile) {
        // 爆炸动画是延迟回收的，期间场景可能已经切走
        if (!p || !p.node || !p.node.isValid) return;

        p.stop();
        p.node.active = false;

        const pf = this.projOwner.get(p);
        const list = pf ? this.projPools.get(pf) : null;
        const capped = this.maxPooledPerPrefab > 0 && list && list.length >= this.maxPooledPerPrefab;

        if (pf && list && !capped) {
            list.push(p);
            return;
        }

        // 没有归属 prefab（占位圆球）或池子满了 → 直接销毁
        this.projOwner.delete(p);
        p.node.destroy();
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
        const capped = this.maxPooledPerPrefab > 0 && list && list.length >= this.maxPooledPerPrefab;

        if (list && !capped) {
            list.push(unit);
            return;
        }

        // 没有归属 prefab，或者池子已经满了：直接销毁，避免常驻节点越来越多
        this.owner.delete(unit);
        if (unit.node && unit.node.isValid) unit.node.destroy();
    }

    private clearPool() {
        for (const list of this.pools.values()) {
            for (const u of list) u.node.destroy();
        }
        this.pools.clear();
        this.owner.clear();

        for (const list of this.projPools.values()) {
            for (const p of list) {
                if (p && p.node && p.node.isValid) p.node.destroy();
            }
        }
        this.projPools.clear();
        this.projOwner.clear();
        this.flights.length = 0;

        this.formation?.reset();
        this.slotFullWarned = false;
    }
}
