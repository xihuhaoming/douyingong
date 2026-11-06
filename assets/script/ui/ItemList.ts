import { _decorator, Button, Component, instantiate, Layout, Node, Prefab } from 'cc';
import { ItemData, ItemView } from './ItemView';

const { ccclass, property } = _decorator;

/**
 * 道具列表：按数据批量铺 item。
 *
 * 两种用法：
 *   1. 动态数量（标准做法）：itemPrefab 拖一个 item 预制体，content 拖容器（一般是挂了 Layout 的 List 节点）
 *      → 数据有几条就实例化几个，多出来的隐藏、缺的补上
 *   2. 固定数量（数量永远不变时更省事）：itemPrefab 留空，content 下已经有 10 个子节点
 *      → 直接按顺序给它们填数据，不实例化
 *
 * 数据填充：
 *   itemList.setItems(ITEMS, (d) => { console.log('点了', d.id); });
 */
@ccclass('ItemList')
export class ItemList extends Component {
    @property({ type: Prefab, tooltip: 'item 预制体（留空 = 复用本节点/容器下已有的子节点）' })
    itemPrefab: Prefab | null = null;

    @property({ type: Node, tooltip: 'item 的父节点（留空 = 本节点）' })
    content: Node | null = null;

    @property({ tooltip: '日志：打印每次刷新的条数' })
    debugLog = false;

    @property({
        type: Node,
        tooltip: '选中放大副本挂这里（必须在 Mask 之外，默认用 ScrollView 节点）',
    })
    overlay: Node | null = null;

    @property({ tooltip: '选中时的放大倍数' })
    selectedScale = 1.15;

    @property({ tooltip: '点击后自动把这一格放大到最上层' })
    autoSelectOnClick = true;

    /** 当前所有格子（含隐藏的） */
    private items: ItemView[] = [];
    /** 由本脚本实例化出来的节点，销毁时要清掉 */
    private created: Node[] = [];
    /** 已经接管过现成子节点 */
    private bound = false;
    private onPick: ((d: ItemData, view?: ItemView) => void) | null = null;
    /** 选中放大用的副本节点 */
    private ghost: Node | null = null;

    get contentNode(): Node {
        return this.content || this.node;
    }

    get count(): number {
        return this.items.length;
    }

    onLoad() {
        // 固定数量模式：先把已有子节点接管过来
        if (!this.itemPrefab) this.bindExisting();
    }

    onDestroy() {
        this.clearSelection();

        for (const view of this.items) {
            if (view && view.node && view.node.isValid) {
                view.node.off(ItemView.CLICK, this.onItemClick, this);
            }
        }
        this.items.length = 0;

        for (const n of this.created) {
            if (n && n.isValid) n.destroy();
        }
        this.created.length = 0;
    }

    /**
     * 用数据刷新列表。
     * @param list 数据数组
     * @param onPick 点击某一项的回调（拿到的是 ItemData）
     */
    setItems(list: ItemData[], onPick?: (d: ItemData, view?: ItemView) => void) {
        this.onPick = onPick || null;
        this.clearSelection();

        if (!this.itemPrefab && !this.bound) this.bindExisting();

        const content = this.contentNode;
        let used = 0;

        for (const data of list) {
            let view = this.items[used];

            if (!view) {
                if (!this.itemPrefab) {
                    // 固定数量模式下数据比子节点多，只能停在这里
                    console.warn(
                        `[ItemList] 子节点只有 ${this.items.length} 个，但数据有 ${list.length} 条。` +
                            '要么加子节点，要么配置 itemPrefab 走动态实例化。',
                    );
                    break;
                }

                const node = instantiate(this.itemPrefab);
                node.setParent(content, false);
                this.created.push(node);
                view = this.track(node);
            }

            view.node.active = true;
            view.init(data);
            used++;
        }

        // 多出来的格子隐藏（不 destroy，下次还能复用）
        for (let i = used; i < this.items.length; i++) {
            const n = this.items[i].node;
            if (n && n.isValid) n.active = false;
        }

        const layout = content.getComponent(Layout);
        if (layout) layout.updateLayout();

        if (this.debugLog) {
            console.log(`[ItemList] 刷新 ${used} / ${this.items.length} 个格子`);
        }
    }

    /** 清空显示（保留节点，供下次复用） */
    clear() {
        for (const view of this.items) {
            if (view && view.node && view.node.isValid) view.node.active = false;
        }
    }

    /** 把已经存在的子节点接管为 item */
    private bindExisting() {
        this.bound = true;
        for (const child of this.contentNode.children) {
            if (!child.isValid) continue;
            this.track(child);
        }
    }

    private track(node: Node): ItemView {
        const view = node.getComponent(ItemView) || node.addComponent(ItemView);
        node.on(ItemView.CLICK, this.onItemClick, this);
        this.items.push(view);
        return view;
    }

    // ------------------------------------------------ 选中放大

    /**
     * 把某一格放大并盖在所有 item 最上层。
     *
     * 为什么不直接改 siblingIndex：
     *   item 都在 Layout 下面，Layout 是按 children 顺序排格子的，
     *   改顺序 = 这个 item 会被排到最后一个格子去，位置会跳。
     * 所以这里改成「克隆一份放到 Layout 之外的最高层」，原格子原封不动。
     */
    select(view: ItemView) {
        this.clearSelection();
        if (!view || !view.node || !view.node.isValid) return;

        const overlay = this.overlayNode();
        const world = view.node.worldPosition.clone();

        const ghost = instantiate(view.node);
        ghost.name = '__selectedItem';
        ghost.setParent(overlay, true); // 保持世界坐标
        ghost.setWorldPosition(world);
        ghost.setSiblingIndex(overlay.children.length - 1); // 压在最上层

        ghost.setScale(
            view.node.scale.x * this.selectedScale,
            view.node.scale.y * this.selectedScale,
            1,
        );

        // 副本只用来显示，不能再响应点击
        const itemView = ghost.getComponent(ItemView);
        if (itemView) itemView.destroy();
        const btn = ghost.getComponent(Button);
        if (btn) btn.interactable = false;

        this.ghost = ghost;

        if (this.debugLog) console.log('[ItemList] 选中放大：' + view.node.name);
    }

    /** 取消选中（刷新列表、关闭面板时记得调） */
    clearSelection() {
        if (this.ghost && this.ghost.isValid) this.ghost.destroy();
        this.ghost = null;
    }

    /** 放大副本要挂在哪：默认取 ScrollView 节点（必须在 Mask 外面，否则会被裁掉） */
    private overlayNode(): Node {
        if (this.overlay && this.overlay.isValid) return this.overlay;

        const p = this.node.parent;
        // 结构一般是 ScrollView > view(Mask) > List，往上跳一层就出 Mask 了
        const aboveMask = p && p.parent ? p.parent : p;
        return aboveMask && aboveMask.isValid ? aboveMask : this.node;
    }

    private onItemClick(view: ItemView) {
        if (!view || !view.itemData) return;

        if (this.autoSelectOnClick) this.select(view);
        this.onPick?.(view.itemData, view);
    }
}
