/**
 * 道具配置。
 *
 * 数据来源优先级：
 *   1. bundle 里的 config/items.json（运行时加载，改数值不用重新编译）
 *   2. 下面 DEFAULT_ITEMS 里的兜底数据（JSON 加载失败时用）
 *
 * 一个道具 = 一条配置，包含显示、技能、震屏三部分。
 * 图标和特效都用「bundle 内的路径」，运行时自动加载并缓存，不需要在 Inspector 里拖。
 */

/** 一次震屏节拍（对齐 spine 动画里的打击点） */
export interface ShakeBeatDef {
    /** 相对特效开始的时间（秒） */
    time: number;
    /** 强度（px） */
    strength: number;
    /** 这次持续多久（秒） */
    duration: number;
}

export interface ItemDef {
    /** 游戏内部唯一 id */
    id: string;
    /** 显示名字 */
    name: string;
    /**
     * 图标在 AssetBundle 里的路径（不带扩展名、不带 /spriteFrame）。
     * 例如 assets/bundle/img/ui/tool_01.png → 'img/ui/tool_01'
     */
    icon: string;
    /** 默认数量（没接平台数据时用） */
    count?: number;
    /** 抖音侧的道具 / 商品 id，接入 SDK 后用来对上 */
    ttId?: string;

    // ------------------------------------------------ 技能

    /** 中心伤害（边缘按 CampBattle.damageFalloff 衰减） */
    damage?: number;
    /** 爆炸范围半径（px） */
    radius?: number;
    /**
     * 技能特效 prefab 在 bundle 里的路径（不带扩展名）。
     * 例如 assets/bundle/prefabs/fx/pf_fire_xuan.prefab → 'prefabs/fx/pf_fire_xuan'
     * 留空 = 用 CampBattle 上配的 hitEffect
     */
    effect?: string;
    /** 特效播放时长（秒） */
    effectSeconds?: number;
    /**
     * spine 动画名（一个 skeleton 里有多条动画时用）。
     * 留空 = 用 prefab 上 Spine 组件配的默认动画。
     */
    anim?: string;

    // ------------------------------------------------ 前置动效（技能起手表演）

    /** 前置动效 prefab 路径（bundle 内，不带扩展名），空 = 不播 */
    intro?: string;
    /** 前置动效宽度占屏比例（0.5 = 半屏宽） */
    introWidthRatio?: number;
    /** 前置动效高度占屏比例（0.5 = 半屏高） */
    introHeightRatio?: number;
    /** 前置动效时长（秒），到点开始淡出并结算 */
    introSeconds?: number;
    /** 播放时压暗战场 0~1（0 = 不压） */
    introDim?: number;

    // ------------------------------------------------ 震屏

    /** 单次震动强度（px），0 / 不填 = 不震；配了 shakeBeats 就以节拍为准 */
    shakeStrength?: number;
    /** 单次震动时长（秒） */
    shakeDuration?: number;
    /** 相对特效开始的延迟（秒） */
    shakeDelay?: number;
    /** 按 spine 打击节拍排的震动 */
    shakeBeats?: ShakeBeatDef[];
}

/** 兜底数据：JSON 加载失败时仍然能玩 */
export const DEFAULT_ITEMS: ItemDef[] = [
    { id: 'gold', name: '摸金符', icon: 'img/ui/tool_01', count: 1, damage: 60, radius: 240, shakeStrength: 14, shakeDuration: 0.32 },
    { id: 'elf', name: '仙女棒', icon: 'img/ui/tool_02', count: 1, damage: 45, radius: 200, shakeStrength: 10, shakeDuration: 0.25 },
    { id: 'luoyangchan', name: '洛阳铲', icon: 'img/ui/tool_03', count: 1, damage: 70, radius: 180 },
    { id: 'ghost', name: '通灵术', icon: 'img/ui/tool_04', count: 1, damage: 55, radius: 260, shakeStrength: 12, shakeDuration: 0.3 },
    { id: 'jiulong', name: '九龙拉棺', icon: 'img/ui/tool_05', count: 1, damage: 120, radius: 320 },
    { id: 'fire_ball', name: '火球术', icon: 'img/ui/tool_06', count: 1, damage: 80, radius: 240, effect: 'prefabs/fx/pf_fire_xuan', effectSeconds: 1.0 },
    { id: 'blood', name: '血祭', icon: 'img/ui/tool_07', count: 1, damage: 90, radius: 220, shakeStrength: 18, shakeDuration: 0.35 },
];

/** 当前生效的道具表（JSON 加载成功后会被替换） */
let currentDefs: ItemDef[] = DEFAULT_ITEMS;

/** JSON 加载成功后调用；传空数组等于回退到兜底表 */
export function setItemDefs(list: ItemDef[]) {
    currentDefs = list && list.length ? list : DEFAULT_ITEMS;
}

/** 当前生效的道具表 */
export function getItemDefs(): ItemDef[] {
    return currentDefs;
}

/** 按 id 找定义 */
export function findDef(id: string): ItemDef | null {
    for (const d of currentDefs) {
        if (d.id === id) return d;
    }
    return null;
}

/** 解析结果 */
export interface ParseItemDefsResult {
    list: ItemDef[];
    /** 校验问题，加载时打一条 warn 即可 */
    errors: string[];
}

/**
 * 校验并转换 JSON 数据。
 * 原则：非法项跳过并记录下来，不整体失败——坏一条不能导致整个面板空掉。
 */
export function parseItemDefs(raw: unknown): ParseItemDefsResult {
    const errors: string[] = [];

    if (!Array.isArray(raw)) {
        errors.push('配置根节点不是数组');
        return { list: [], errors };
    }

    const list: ItemDef[] = [];
    const seen = new Set<string>();

    raw.forEach((it: any, i: number) => {
        const at = `第 ${i + 1} 条`;
        if (!it || typeof it !== 'object') {
            errors.push(`${at}：不是对象`);
            return;
        }

        const id = typeof it.id === 'string' ? it.id.trim() : '';
        if (!id) {
            errors.push(`${at}：缺少 id`);
            return;
        }
        if (seen.has(id)) {
            errors.push(`${at}：id「${id}」重复，已跳过`);
            return;
        }

        const icon = typeof it.icon === 'string' ? it.icon.trim() : '';
        if (!icon) errors.push(`${at}（${id}）：缺少 icon 路径`);

        const def: ItemDef = {
            id,
            name: typeof it.name === 'string' && it.name ? it.name : id,
            icon,
            count: toNum(it.count, 1),
            ttId: typeof it.ttId === 'string' && it.ttId ? it.ttId : undefined,
            damage: toNum(it.damage, 40),
            radius: toNum(it.radius, 220),
            effect: typeof it.effect === 'string' && it.effect ? stripExt(it.effect) : undefined,
            effectSeconds: toNum(it.effectSeconds, 0.8),
            anim: typeof it.anim === 'string' && it.anim ? it.anim.trim() : undefined,
            intro: typeof it.intro === 'string' && it.intro ? stripExt(it.intro) : undefined,
            introWidthRatio: toNum(it.introWidthRatio, 0.5),
            introHeightRatio: toNum(it.introHeightRatio, 0.5),
            introSeconds: toNum(it.introSeconds, 1.5),
            introDim: toNum(it.introDim, 0.35),
            shakeStrength: toNum(it.shakeStrength, 0),
            shakeDuration: toNum(it.shakeDuration, 0.35),
            shakeDelay: toNum(it.shakeDelay, 0),
        };

        if (def.damage! <= 0) errors.push(`${at}（${id}）：damage 应大于 0`);
        if (def.radius! <= 0) errors.push(`${at}（${id}）：radius 应大于 0`);

        if (it.shakeBeats !== undefined) {
            const beats = parseBeats(it.shakeBeats, id, errors);
            if (beats.length) def.shakeBeats = beats;
        }

        seen.add(id);
        list.push(def);
    });

    if (raw.length > 0 && list.length === 0) errors.push('没有任何一条有效配置，已回退到默认表');

    return { list, errors };
}

function parseBeats(raw: any, id: string, errors: string[]): ShakeBeatDef[] {
    if (!Array.isArray(raw)) {
        errors.push(`${id}：shakeBeats 不是数组`);
        return [];
    }

    const out: ShakeBeatDef[] = [];
    raw.forEach((b: any, i: number) => {
        if (!b || typeof b !== 'object') {
            errors.push(`${id}.shakeBeats[${i}]：不是对象`);
            return;
        }
        const strength = toNum(b.strength, 0);
        if (strength <= 0) {
            errors.push(`${id}.shakeBeats[${i}]：strength 应大于 0`);
            return;
        }
        out.push({
            time: Math.max(0, toNum(b.time, 0)),
            strength,
            duration: Math.max(0.05, toNum(b.duration, 0.2)),
        });
    });
    return out;
}

/** 数字兜底 */
function toNum(v: unknown, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/** 路径统一不带扩展名（有人写 xxx.prefab 也能用） */
function stripExt(p: string): string {
    return p.replace(/\.(prefab|json|png|jpg|jpeg)$/i, '').replace(/^\/+/, '');
}
