/**
 * 直播事件总线 —— 「抖音弹幕/礼物」与「玩法表现」之间的唯一通道。
 *
 * 现在由 LiveSimPanel 模拟触发；以后接真实弹幕时把宿主消息翻译成 emit 即可，
 * 下游（出兵、特效）一行不用改。约定：
 *   enter  —— 有观众进入直播间
 *   boost  —— 有观众点击助力（点击屏幕左/右半边）
 *   gift   —— 有观众刷礼物（按 giftId 区分）
 */

export type LiveEventType = 'enter' | 'boost';

/** 进入直播间 / 点击助力 */
export interface LiveUserEvent {
    nickname?: string;
    /** 站哪边：-1 = 左方、+1 = 右方。不填由下游随机 */
    side?: number;
}

/** 刷礼物 */
export interface LiveGiftEvent {
    /** 礼物 id —— 要和 GiftEffectManager 里配置的 giftId 一致 */
    giftId: string;
    count: number;
    nickname?: string;
}

type UserHandler = (e: LiveUserEvent) => void;
type GiftHandler = (e: LiveGiftEvent) => void;

class LiveEventBusImpl {
    private userHandlers = new Map<LiveEventType, Set<UserHandler>>();
    private giftHandlers = new Set<GiftHandler>();

    onUser(type: LiveEventType, h: UserHandler) {
        let set = this.userHandlers.get(type);
        if (!set) {
            set = new Set();
            this.userHandlers.set(type, set);
        }
        set.add(h);
    }

    offUser(type: LiveEventType, h: UserHandler) {
        this.userHandlers.get(type)?.delete(h);
    }

    emitUser(type: LiveEventType, e: LiveUserEvent) {
        const set = this.userHandlers.get(type);
        if (!set) return;
        for (const h of set) {
            try {
                h(e);
            } catch (err) {
                console.error('[LiveEventBus] 处理 ' + type + ' 事件出错：', err);
            }
        }
    }

    onGift(h: GiftHandler) {
        this.giftHandlers.add(h);
    }

    offGift(h: GiftHandler) {
        this.giftHandlers.delete(h);
    }

    emitGift(e: LiveGiftEvent) {
        for (const h of this.giftHandlers) {
            try {
                h(e);
            } catch (err) {
                console.error('[LiveEventBus] 处理 gift 事件出错：', err);
            }
        }
    }
}

/** 全局单例，直接 import 使用 */
export const liveEventBus = new LiveEventBusImpl();
