import { _decorator, Component, Button, Prefab, input, Input, EventKeyboard, KeyCode } from 'cc';
import { liveEventBus } from './LiveEventBus';
import { GiftEffectManager } from './GiftEffectManager';

const { ccclass, property } = _decorator;

const NAMES = ['小星星', '爱吃糖', '风清扬', '大魔王', '路过滴', '月半弯', '冲鸭', '抱走熊'];

/**
 * 模拟面板（演示用）：编辑器里手动搭好按钮，把引用拖进来，点击往总线上发模拟事件。
 *   助力按钮 → emit boost → CampBattle 出兵
 *   礼物按钮 → emit gift  → GiftEffectManager 播特效
 * 以后接真实弹幕：写适配层把 tt.onMessage 翻译成总线事件，这个面板禁用即可。
 */
@ccclass('LiveSimPanel')
export class LiveSimPanel extends Component {
    @property({ type: Button, tooltip: '左方助力按钮' })
    btnBoostLeft: Button | null = null;

    @property({ type: Button, tooltip: '右方助力按钮' })
    btnBoostRight: Button | null = null;

    @property({ type: [Button], tooltip: '礼物按钮，顺序和 giftIds 一一对应' })
    giftButtons: Button[] = [];

    @property({ type: [String], tooltip: '礼物 id 列表，和 giftButtons 顺序对应' })
    giftIds: string[] = [];

    @property({ type: GiftEffectManager, tooltip: '点击爆点特效走这里播（可空）' })
    fx: GiftEffectManager | null = null;

    @property({ type: Prefab, tooltip: '点助力时的爆点粒子 prefab（可空）' })
    clickBurst: Prefab | null = null;

    @property({ tooltip: '自动模拟：每隔一会儿随机来一波进直播间/助力/礼物' })
    autoSimulate = true;

    @property({ tooltip: '自动模拟间隔（秒）' })
    autoInterval = 2.5;

    private autoTimer = 0;

    onLoad() {
        this.btnBoostLeft?.node.on(Button.EventType.CLICK, this.onLeftClick, this);
        this.btnBoostRight?.node.on(Button.EventType.CLICK, this.onRightClick, this);
        this.giftButtons.forEach((b, i) => {
            if (b) b.node.on(Button.EventType.CLICK, () => this.gift(i), this);
        });
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDestroy() {
        this.btnBoostLeft?.node.off(Button.EventType.CLICK, this.onLeftClick, this);
        this.btnBoostRight?.node.off(Button.EventType.CLICK, this.onRightClick, this);
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    update(dt: number) {
        if (!this.autoSimulate) return;
        this.autoTimer += dt;
        if (this.autoTimer >= Math.max(0.5, this.autoInterval)) {
            this.autoTimer = 0;
            this.randomOnce();
        }
    }

    /** 键盘快测：B 左助力 / N 右助力 / 1~3 礼物 */
    private onKeyDown(e: EventKeyboard) {
        switch (e.keyCode) {
            case KeyCode.KEY_B:
                this.boost(-1);
                break;
            case KeyCode.KEY_N:
                this.boost(1);
                break;
            case KeyCode.KEY_1:
            case KeyCode.KEY_2:
            case KeyCode.KEY_3: {
                const i = e.keyCode - KeyCode.KEY_1;
                if (i < this.giftButtons.length) this.gift(i);
                break;
            }
            default:
                break;
        }
    }

    private onLeftClick() {
        this.boost(-1);
    }

    private onRightClick() {
        this.boost(1);
    }

    /** 助力：发事件 + 按钮位置冒个爆点 */
    private boost(side: number) {
        liveEventBus.emitUser('boost', { side, nickname: NAMES[(Math.random() * NAMES.length) | 0] });
        if (this.clickBurst) {
            const btn = side > 0 ? this.btnBoostRight : this.btnBoostLeft;
            this.fx?.playPrefab(this.clickBurst, btn ? btn.node.worldPosition : undefined, 0.7);
        }
    }

    /** 进直播间 */
    private enter() {
        liveEventBus.emitUser('enter', {
            side: Math.random() < 0.5 ? -1 : 1,
            nickname: NAMES[(Math.random() * NAMES.length) | 0],
        });
    }

    /** 刷第 i 个礼物按钮对应的礼物 */
    private gift(i: number) {
        const id = this.giftIds[i] || this.giftIds[0] || 'rose';
        liveEventBus.emitGift({
            giftId: id,
            count: 1 + (Math.random() < 0.2 ? 1 : 0),
            nickname: NAMES[(Math.random() * NAMES.length) | 0],
        });
    }

    /** 自动模拟的一拍 */
    private randomOnce() {
        const roll = Math.random();
        if (roll < 0.4) {
            this.boost(Math.random() < 0.5 ? -1 : 1);
        } else if (roll < 0.7) {
            this.enter();
        } else {
            const n = Math.max(1, this.giftButtons.length);
            this.gift((Math.random() * n) | 0);
        }
    }
}

