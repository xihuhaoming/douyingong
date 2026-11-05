import { _decorator, clamp, Component, Node, Vec3 } from 'cc';
import { CampBattle } from './CampBattle';

const { ccclass, property } = _decorator;

/**
 * 背景推挤（拔河效果）：哪一方血量低，背景就往那一方的反方向压一点。
 *
 *   左方血量低  → 背景整体往右移  → 视觉上右边压过来
 *   右方血量低  → 背景整体往左移
 *   势均力敌    → 回到原位
 *
 * 为什么用「节点数组」而不是直接移动 Background 本身：
 *   Background 节点上挂了 cc.Widget，Widget 每帧会把 position 拉回去，
 *   脚本改了也会被覆盖。而子节点（LeftBackground / RightBackground / 地面）
 *   没有 Widget，可以安全平移。
 *
 * 边界约束：offset 会被夹在 [-maxShift, maxShift]，并且始终基于「初始位置」计算，
 * 不会随帧累积漂移。maxShift 需要按美术余量来填，填太大就会露出背景边缘。
 */
@ccclass('BackgroundScroll')
export class BackgroundScroll extends Component {
    @property({ type: CampBattle, tooltip: '战斗主控，读双方总血量对比（一般就是 BattleLayer 上那个）' })
    battle: CampBattle | null = null;

    @property({
        type: [Node],
        tooltip: '要跟着一起平移的节点：左右背景、左右地面（不要拖带 Widget 的 Background 本身）',
    })
    targets: Node[] = [];

    @property({ tooltip: '最大平移距离（px）。填到背景不露边为止，建议先 80~120 试' })
    maxShift = 110;

    @property({ tooltip: '幅度系数，1 = 用满 maxShift，0.5 = 只用一半' })
    factor = 1;

    @property({ tooltip: '跟随速度，越大越快贴住目标（4~8 手感比较自然）' })
    followSpeed = 5;

    @property({ tooltip: '反向：默认 false。左方低血时往右压，改动前先确认方向' })
    invert = false;

    /** 各节点的初始 x，push 完都基于它算，避免累积漂移 */
    private originX: number[] = [];
    private offset = 0;

    start() {
        this.originX = this.targets.map((n) => (n ? n.position.x : 0));
    }

    update(dt: number) {
        if (!this.battle || this.targets.length === 0) return;

        const dir = this.invert ? -1 : 1;
        const limit = Math.max(0, this.maxShift);
        // 两次 clamp：先归一化血量差，再兜住 factor 过大导致越界
        const raw = clamp(this.battle.getBalance() * dir, -1, 1) * limit * this.factor;
        const target = clamp(raw, -limit, limit);

        // 与帧率无关的平滑跟随
        const k = 1 - Math.exp(-Math.max(0.01, this.followSpeed) * dt);
        this.offset += (target - this.offset) * k;
        this.applyOffset();
    }

    /** 立刻回到原位（切场景 / 回合重置时调） */
    reset() {
        this.offset = 0;
        this.applyOffset();
    }

    private applyOffset() {
        for (let i = 0; i < this.targets.length; i++) {
            const n = this.targets[i];
            if (!n || !n.isValid) continue;
            const p = n.position;
            n.setPosition(this.originX[i] + this.offset, p.y, p.z);
        }
    }
}
