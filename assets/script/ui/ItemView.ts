import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/** 一条道具数据（列表脚本只认这个结构，跟 UI 无关） */
export interface ItemData {
    /** 唯一 id，点击时回传 */
    id: string;
    /** 图标 */
    icon?: SpriteFrame | null;
    /** 名字 */
    name?: string;
    /** 数量 */
    count?: number;
    /** 品质 0~3，可用来换底框颜色（现在没用到） */
    quality?: number;
    /** 自定义附加数据 */
    extra?: unknown;
}

/**
 * 列表里的一个道具格子。
 *
 * 三种引用（icon / nameLabel / countLabel）都可以留空：
 * 留空会按名字自动在子节点里找 icon/Icon/img、Name、Number/Count。
 *
 * 点击不直接调业务回调，而是往自己节点上 emit 一个 `item-click` 事件，
 * 由 ItemList 统一监听——这样节点被复用、被池化都不会重复绑定。
 */
@ccclass('ItemView')
export class ItemView extends Component {
    /** ItemList 监听用的事件名 */
    static readonly CLICK = 'item-click';

    @property({ type: Sprite, tooltip: '图标（留空自动找子节点 icon / Icon / img）' })
    icon: Sprite | null = null;

    @property({ type: Label, tooltip: '名字（留空自动找子节点 Name）' })
    nameLabel: Label | null = null;

    @property({ type: Label, tooltip: '数量（留空自动找子节点 Number / Count）' })
    countLabel: Label | null = null;

    @property({ type: Button, tooltip: '点击目标（留空 = 本节点上的 Button，再没有就用本节点触摸）' })
    button: Button | null = null;

    private data: ItemData | null = null;
    private bound = false;

    get itemData(): ItemData | null {
        return this.data;
    }

    onLoad() {
        this.resolveRefs();
        this.bindClick();
    }

    onDestroy() {
        const btn = this.button || this.node.getComponent(Button);
        if (btn) btn.node.off(Button.EventType.CLICK, this.onClick, this);
        else this.node.off(Node.EventType.TOUCH_END, this.onClick, this);
    }

    /** 填数据（复用节点时会反复调用） */
    init(data: ItemData) {
        this.data = data;
        this.resolveRefs();

        if (this.icon) this.icon.spriteFrame = data.icon || null;
        if (this.nameLabel) this.nameLabel.string = data.name ?? '';
        if (this.countLabel) this.countLabel.string = data.count === undefined ? '' : String(data.count);

        this.node.name = 'Item_' + data.id;
    }

    private onClick() {
        if (!this.data) return;
        this.node.emit(ItemView.CLICK, this);
    }

    private bindClick() {
        if (this.bound) return;
        this.bound = true;

        const btn = this.button || this.node.getComponent(Button);
        if (btn) btn.node.on(Button.EventType.CLICK, this.onClick, this);
        else this.node.on(Node.EventType.TOUCH_END, this.onClick, this);
    }

    /** 引用没填的话，按常见命名自动找一遍 */
    private resolveRefs() {
        if (!this.icon) {
            const n = findChild(this.node, ['icon', 'Icon', 'img', 'Image']);
            if (n) this.icon = n.getComponent(Sprite);
        }
        if (!this.nameLabel) {
            const n = findChild(this.node, ['Name', 'name', 'Title']);
            if (n) this.nameLabel = n.getComponent(Label);
        }
        if (!this.countLabel) {
            const n = findChild(this.node, ['Number', 'Count', 'Num']);
            if (n) this.countLabel = n.getComponent(Label);
        }
    }
}

/** 广度优先按名字找子节点（不区分大小写兜底） */
function findChild(root: Node, names: string[]): Node | null {
    const queue: Node[] = [...root.children];
    while (queue.length) {
        const n = queue.shift()!;
        if (names.indexOf(n.name) >= 0) return n;
        for (const c of n.children) queue.push(c);
    }

    // 名字大小写不一致时再兜一次
    const lower = names.map((s) => s.toLowerCase());
    const queue2: Node[] = [...root.children];
    while (queue2.length) {
        const n = queue2.shift()!;
        if (lower.indexOf(n.name.toLowerCase()) >= 0) return n;
        for (const c of n.children) queue2.push(c);
    }
    return null;
}
