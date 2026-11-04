import {
    _decorator,
    Component,
    Node,
    Prefab,
    Label,
    ProgressBar,
    Vec3,
    instantiate,
    input,
    Input,
    EventTouch,
    view,
} from 'cc';
import { liveEventBus, LiveUserEvent } from './LiveEventBus';
import { SoldierUnit } from './SoldierUnit';
import { GiftEffectManager } from './GiftEffectManager';

const { ccclass, property } = _decorator;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 场上一个活着的小兵 */
interface Fighter {
    unit: SoldierUnit;
    hp: number;
    /** 距离下次攻击的倒计时（秒） */
    nextAttack: number;
}

/**
 * 阵营攻防战主控（挂在 LiveGame 节点上）。
 *
 * 玩法：
 *   - 观众点屏幕左/右半边（或侧边按钮）→ 该方出一个兵，兵满血 100
 *   - 场上小兵自动隔几秒向对方放技能，伤害 10~80，命中处播特效
 *   - 小兵血量归零 → 变灰淡出消失（播死亡特效）
 *   - 一方全灭后，观众再点助力就重新出兵
 */
@ccclass('CampBattle')
export class CampBattle extends Component {
    @property({ type: Prefab, tooltip: '小兵 prefab（根节点带 Sprite）' })
    soldierPrefab: Prefab | null = null;

    @property({ type: Node, tooltip: '左方出生点（节点位置即出生位置）' })
    leftRoot: Node | null = null;

    @property({ type: Node, tooltip: '右方出生点' })
    rightRoot: Node | null = null;

    @property({ tooltip: '小兵贴图默认朝向：画的是朝右就勾上' })
    artFaceRight = true;

    @property({ tooltip: '进场后往敌方方向走多远（px）' })
    walkInDistance = 260;

    @property({ tooltip: '进场耗时（秒）' })
    walkSeconds = 1.0;

    @property({ tooltip: '每个小兵的满血量' })
    soldierMaxHp = 100;

    @property({ tooltip: '技能伤害下限' })
    damageMin = 10;

    @property({ tooltip: '技能伤害上限' })
    damageMax = 80;

    @property({ tooltip: '攻击间隔下限（秒）' })
    attackIntervalMin = 2.0;

    @property({ tooltip: '攻击间隔上限（秒）' })
    attackIntervalMax = 4.0;

    @property({ tooltip: '每边场上最多多少个兵' })
    maxAlivePerSide = 15;

    @property({ tooltip: '开局每边先出几个兵（演示用，0 = 空场开局）' })
    initialSoldiersPerSide = 3;

    @property({ tooltip: '进直播间（enter 事件）的出兵概率 0~1' })
    enterChance = 0.6;

    @property({ tooltip: '点屏幕左/右半边出兵（真实观众交互；预览时可关掉避免和模拟按钮重复）' })
    tapToBoost = true;

    @property({ type: GiftEffectManager, tooltip: '技能命中/死亡/点击特效走这里播（可空）' })
    fx: GiftEffectManager | null = null;

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
    private pool: SoldierUnit[] = [];
    private hpDirty = true;

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
        this.spawnSoldier(e.side ?? this.randomSide(), e.nickname);
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

    /** 点屏幕左半边 = 左方助力，右半边 = 右方助力 */
    private onTap(e: EventTouch) {
        const loc = e.getUILocation();
        const half = this.screenHalfWidth();
        const side = loc.x < half ? -1 : 1;
        liveEventBus.emitUser('boost', { side });
        if (this.tapBurst) {
            this.fx?.playPrefab(this.tapBurst, new Vec3(loc.x, loc.y, 0), 0.6);
        }
    }

    private screenHalfWidth(): number {
        try {
            const s = view.getVisibleSize();
            if (s && s.width > 1) return s.width / 2;
        } catch (err) {
            /* 抖音运行时 view 可能拿不到，走兜底 */
        }
        return 375;
    }

    // ------------------------------------------------ 出兵

    /** 出一个兵（血量 soldierMaxHp）。观众助力 / 进直播间都走这里 */
    spawnSoldier(side: number, _nickname?: string) {
        const root = side > 0 ? this.rightRoot : this.leftRoot;
        if (!root || !this.soldierPrefab) {
            console.warn('[CampBattle] 没配置 soldierPrefab / 出生点，出不了兵');
            return;
        }
        const list = this.rows[side] || (this.rows[side] = []);
        if (list.length >= this.maxAlivePerSide) return; // 场上满了就不再出

        const unit = this.take();
        unit.node.setParent(root, false);
        unit.side = side;
        list.push({ unit, hp: this.soldierMaxHp, nextAttack: rand(this.attackIntervalMin, this.attackIntervalMax) });

        // 出生点加随机抖动，一群兵不会叠成一坨
        const from = new Vec3(root.position.x + rand(-30, 30), root.position.y + rand(-24, 24), 0);
        const walk = this.walkInDistance * rand(0.8, 1.15);
        const to = new Vec3(from.x - side * walk, from.y, 0);
        const faceRight = side < 0 ? this.artFaceRight : !this.artFaceRight;
        unit.run({
            from,
            to,
            faceRight,
            walkSeconds: this.walkSeconds * rand(0.85, 1.15),
        });
        this.hpDirty = true;
    }

    // ------------------------------------------------ 战斗结算

    update(dt: number) {
        const dead: Fighter[] = [];
        for (const side of [-1, 1]) {
            const list = this.rows[side];
            const foes = this.rows[-side];
            for (const f of list) {
                f.nextAttack -= dt;
                if (f.nextAttack > 0) continue;
                f.nextAttack = rand(this.attackIntervalMin, this.attackIntervalMax);
                if (!foes.length) continue;
                // 随机挑一个敌人打 10~80
                const target = foes[(Math.random() * foes.length) | 0];
                const dmg = Math.round(rand(this.damageMin, this.damageMax));
                target.hp -= dmg;
                target.unit.showDamage();
                f.unit.attackPulse();
                if (this.hitEffect) {
                    this.fx?.playPrefab(this.hitEffect, target.unit.node.worldPosition, 0.6);
                }
                console.log(`[CampBattle] ${side > 0 ? '右' : '左'}方技能命中 ${dmg} 点`);
                if (target.hp <= 0) dead.push(target);
            }
        }
        // 结算死亡：播特效 → 淡出 → 回池
        for (const f of dead) {
            this.removeFighter(f);
            if (this.deathEffect) {
                this.fx?.playPrefab(this.deathEffect, f.unit.node.worldPosition, 0.8);
            }
            f.unit.die(() => this.recycle(f.unit));
        }
        if (this.hpDirty) this.refreshHpUi();
    }

    private removeFighter(f: Fighter) {
        for (const side of [-1, 1]) {
            const list = this.rows[side];
            const i = list.indexOf(f);
            if (i >= 0) {
                list.splice(i, 1);
                this.hpDirty = true;
                return;
            }
        }
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

    // ------------------------------------------------ 对象池

    private take(): SoldierUnit {
        const cached = this.pool.pop();
        if (cached) return cached;
        const node = instantiate(this.soldierPrefab!);
        return node.getComponent(SoldierUnit) || node.addComponent(SoldierUnit);
    }

    private recycle(unit: SoldierUnit) {
        unit.sleep();
        this.pool.push(unit);
    }

    private clearPool() {
        for (const u of this.pool) u.node.destroy();
        this.pool.length = 0;
    }
}
