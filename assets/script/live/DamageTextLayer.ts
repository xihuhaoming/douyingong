import {
    _decorator,
    Color,
    Component,
    HorizontalTextAlignment,
    Label,
    Node,
    UIOpacity,
    UITransform,
    Vec3,
    VerticalTextAlignment,
} from 'cc';
import { DamageTextItem } from './DamageTextItem';

const { ccclass, property } = _decorator;

/**
 * 伤害飘字层（全局一个，挂在特效层 / 战斗层都行）。
 *
 * 每个兵受击时都会在「它自己的头顶」飘一条数字，位置由 CampBattle 传进来的
 * 世界坐标决定；这里只是把飘字节点池化复用，不是全屏只显示一条。
 *
 * 为什么不做成每个小兵 prefab 自带 Label：
 *   小兵是对象池复用的长生命周期节点，30 个兵各带一个 Label 就是 30 次 DrawCall，
 *   而飘字只活 0.8 秒，用池只需要几个节点。
 *
 * 用法：挂到 EffectLayer 上 → CampBattle 的 damageText 拖这个组件。
 */
@ccclass('DamageTextLayer')
export class DamageTextLayer extends Component {
    @property({ tooltip: '飘字底板宽度（px），文字长了会自动缩字' })
    width = 240;

    @property({ tooltip: '飘字底板高度（px）' })
    height = 80;

    @property({ tooltip: '字号' })
    fontSize = 48;

    @property({ tooltip: '上浮高度（px）' })
    rise = 90;

    @property({ tooltip: '总时长（秒）' })
    duration = 0.8;

    @property({ tooltip: '出现瞬间的放大倍数（由大到小的起点）' })
    popScale = 1.9;

    @property({ tooltip: '消失时的缩放（从 1 慢慢缩到这个值）' })
    endScale = 0.85;

    @property({ tooltip: '从哪个进度开始淡出，0.45 = 前半段清楚、后半段淡出' })
    fadeStart = 0.45;

    @property({ tooltip: '相对命中点的纵向偏移（px），让数字飘在头顶' })
    offsetY = 78;

    @property({ tooltip: '命中点横向随机抖动（px），避免多个数字完全重叠' })
    jitterX = 36;

    @property({ type: Color, tooltip: '普通伤害颜色' })
    normalColor: Color = new Color(255, 255, 255, 255);

    @property({ type: Color, tooltip: '高伤颜色' })
    highColor: Color = new Color(255, 214, 92, 255);

    @property({ type: Color, tooltip: '暴击颜色' })
    critColor: Color = new Color(255, 96, 96, 255);

    @property({ tooltip: '高伤阈值' })
    highThreshold = 40;

    @property({ tooltip: '暴击阈值' })
    critThreshold = 70;

    @property({ tooltip: '暴击额外放大倍数' })
    critExtraScale = 0.25;

    private pool: Node[] = [];

    onDestroy() {
        for (const n of this.pool) n.destroy();
        this.pool.length = 0;
    }

    /**
     * 在某个世界坐标处飘一个伤害数字。
     * @param worldPos 命中点（一般传小兵节点的 worldPosition）
     * @param value 伤害值（传正数，前面自动加 -）
     */
    show(worldPos: Vec3, value: number) {
        const crit = value >= this.critThreshold;
        const high = value >= this.highThreshold;
        const color = crit ? this.critColor : high ? this.highColor : this.normalColor;

        const item = this.take();
        const node = item.node;

        // 飘字永远压在最上面，避免被后出的特效盖住
        node.setSiblingIndex(this.node.children.length - 1);
        node.setPosition(this.toLocal(worldPos, crit));

        item.play(
            '-' + Math.round(value),
            color,
            node.position.clone(),
            {
                rise: this.rise,
                duration: this.duration,
                popScale: this.popScale + (crit ? this.critExtraScale : 0),
                endScale: this.endScale,
                fadeStart: this.fadeStart,
            },
            () => this.back(item),
        );
    }

    /** 世界坐标 → 本层局部坐标，顺便加头顶偏移和横向抖动 */
    private toLocal(worldPos: Vec3, extra: boolean): Vec3 {
        const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        const world = new Vec3(worldPos.x, worldPos.y + this.offsetY, worldPos.z);
        const local = ut.convertToNodeSpaceAR(world, new Vec3());
        local.x += (Math.random() - 0.5) * this.jitterX;
        if (extra) local.y += 10;
        return local;
    }

    private take(): DamageTextItem {
        const cached = this.pool.pop();
        if (cached) {
            cached.active = true;
            return cached.getComponent(DamageTextItem)!;
        }

        const node = new Node('DmgText');
        // 新节点的 layer 必须跟本层一致，否则 UI 相机不渲染
        node.layer = this.node.layer;
        node.addComponent(UITransform).setContentSize(this.width, this.height);

        const label = node.addComponent(Label);
        label.fontSize = this.fontSize;
        label.lineHeight = this.fontSize + 6;
        label.isBold = true;
        label.horizontalAlign = HorizontalTextAlignment.CENTER;
        label.verticalAlign = VerticalTextAlignment.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        label.cacheMode = Label.CacheMode.CHAR;

        node.addComponent(UIOpacity);
        const item = node.addComponent(DamageTextItem);
        node.setParent(this.node, false);
        return item;
    }

    private back(item: DamageTextItem) {
        item.stop();
        item.node.active = false;
        this.pool.push(item.node);
    }
}
