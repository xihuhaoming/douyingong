/**
 * 阵型（纯逻辑，不依赖节点渲染）。
 *
 * 负责三件事：
 *   1. 算某个站位编号的世界坐标（row * cols + col，col 越小越靠空气墙）
 *   2. 分配 / 释放 / 补位（同排往前顶，队尾留空）
 *   3. 无限模式：格子不够时自动往后加一排
 *
 * 不持有 Node、不碰渲染、不知道 Scene，方便单测和复用（比如以后做回合制也能用）。
 */

export interface FormationOptions {
    /** 阵营：-1 左 / +1 右 */
    side: number;
    /** 列数（纵深，col 0 贴空气墙） */
    cols: number;
    /** 每列纵向排几个 */
    rows: number;
    /** 列间距（往自己后方退） */
    colSpacing: number;
    /** 行间距（纵向） */
    rowSpacing: number;
    /** 小兵半径，决定最前排离中线多远 */
    unitRadius: number;
    /** 双方允许交叠的宽度 */
    wallOverlap: number;
    /** 是否无限（格子满了自动加行） */
    unlimited: boolean;
    /** 格子数上限（0 / 不填 = 只受 unlimited 控制）。活动区域装不下时用它封顶 */
    maxSlots?: number;
    /** 空气墙世界 x（用函数是为了中心墙可以随时移动） */
    wallX: () => number;
    /** 阵型纵向中心的世界 y（第 0 行会以此居中） */
    centerY: () => number;
}

/** 站位坐标（复用同一个对象，拿到就立刻用掉） */
export interface SlotPos {
    x: number;
    y: number;
}

/** 会被阵型写 `slot` 字段的占用者 */
export interface SlotOwner {
    slot: number;
}

export class BattleFormation<T extends SlotOwner> {
    private opts: FormationOptions;
    /** 下标 = 站位编号，值 = 站在这的占用者 */
    private slots: (T | null)[] = [];
    /** 当前开了多少格 */
    private cap = 0;
    /** 第 0 行的世界 y，开局算一次；之后只往下加行，老站位不动 */
    private topY: number | null = null;
    private out: SlotPos = { x: 0, y: 0 };

    constructor(opts: FormationOptions) {
        this.opts = opts;
        this.reset();
    }

    // ------------------------------------------------------------------ 配置

    /**
     * 运行中改配置（列数、间距、阵营这些）。
     * 不重置 topY：列/行数在战斗中基本不变，重置反而会让已经站好的兵抖一下。
     */
    setOptions(patch: Partial<FormationOptions>) {
        Object.assign(this.opts, patch);
    }

    useSide(side: number) {
        this.opts.side = side > 0 ? 1 : -1;
    }

    /** 清空所有占位，恢复到初始格子数 */
    reset() {
        this.cap = this.baseSlotCount;
        this.slots = new Array(this.cap).fill(null);
        this.topY = null;
    }

    get colCount(): number {
        return Math.max(1, Math.floor(this.opts.cols));
    }

    get rowCount(): number {
        return Math.max(1, Math.floor(this.opts.rows));
    }

    /** 初始格子数（用于 UI 满员判断 / 启动警告） */
    get baseSlotCount(): number {
        return this.colCount * this.rowCount;
    }

    /** 当前开了多少格 */
    get capacity(): number {
        return this.cap;
    }

    // ------------------------------------------------------------------ 坐标

    /**
     * 第 index 个站位的世界坐标。
     * 返回的是复用对象，调用方要马上取值，不要跨帧持有。
     */
    position(index: number): SlotPos {
        const cols = this.colCount;
        const spacingY = Math.max(1, this.opts.rowSpacing);
        const i = Math.max(0, index);
        const row = Math.floor(i / cols);
        const col = i % cols;

        const r = Math.max(1, this.opts.unitRadius);
        const halfOverlap = Math.max(0, this.opts.wallOverlap) / 2;

        // 最前排离中线「半径 - 交叠量/2」，后面的列再往自己后方退
        const frontX = this.opts.wallX() + this.opts.side * (r - halfOverlap);
        const x = frontX + this.opts.side * col * Math.max(1, this.opts.colSpacing);

        if (this.topY === null) {
            this.topY = this.opts.centerY() + ((this.rowCount - 1) / 2) * spacingY;
        }
        const y = this.topY - row * spacingY;

        this.out.x = x;
        this.out.y = y;
        return this.out;
    }

    // ------------------------------------------------------------------ 分配

    /**
     * 找一个离 (x, y) 最近的空位。
     * 无限模式下格子用完会自动加一排再找；有限模式返回 -1。
     */
    alloc(x: number, y: number): number {
        for (let grow = 0; grow < 64; grow++) {
            this.ensureCap(this.cap);

            let best = -1;
            let bestDist = Infinity;
            for (let i = 0; i < this.cap; i++) {
                if (this.slots[i]) continue;
                const p = this.position(i);
                const dx = p.x - x;
                const dy = p.y - y;
                const d = dx * dx + dy * dy;
                if (d < bestDist) {
                    bestDist = d;
                    best = i;
                }
            }
            if (best >= 0) return best;
            if (!this.opts.unlimited) return -1;

            // 到了区域能装下的上限就不再往后加行
            const limit = this.opts.maxSlots && this.opts.maxSlots > 0 ? this.opts.maxSlots : Infinity;
            if (this.cap >= limit) return -1;

            this.cap = Math.min(limit, this.cap + this.colCount); // 加一排
        }
        return -1;
    }

    /** 占用某个站位，同时把 index 写进 owner.slot */
    occupy(index: number, owner: T) {
        this.ensureCap(index + 1);
        if (index + 1 > this.cap) this.cap = index + 1;

        owner.slot = index;
        this.slots[index] = owner;
    }

    /** 释放（兵死了 / 被回收） */
    free(owner: T) {
        const i = owner.slot;
        if (i >= 0 && i < this.slots.length && this.slots[i] === owner) {
            this.slots[i] = null;
        }
    }

    /**
     * 补位：把每一行里还活着的占用者，从前往后重新排成 0、1、2… 号格。
     * 只在本行内递补，所以纵向不会跳，空位永远留在队尾。
     */
    compact(alive: T[]) {
        const cols = this.colCount;

        // 容量要覆盖「当前开了多少格」和「最大编号」，加过行的话不能缩回去
        let need = Math.max(this.cap, cols);
        for (const f of alive) need = Math.max(need, f.slot + 1);
        need = Math.ceil(need / cols) * cols;
        this.cap = need;

        const next: (T | null)[] = new Array(need).fill(null);
        if (!alive.length) {
            this.slots = next;
            return;
        }

        const rows = need / cols;
        for (let r = 0; r < rows; r++) {
            const inRow: T[] = [];
            for (const f of alive) {
                if (Math.floor(f.slot / cols) === r) inRow.push(f);
            }
            if (!inRow.length) continue;

            inRow.sort((a, b) => a.slot - b.slot);
            for (let c = 0; c < inRow.length && c < cols; c++) {
                const f = inRow[c];
                f.slot = r * cols + c;
                next[f.slot] = f;
            }
        }

        this.slots = next;
    }

    private ensureCap(n: number) {
        while (this.slots.length < n) this.slots.push(null);
    }
}
