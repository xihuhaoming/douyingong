/**
 * 抖音小游戏「侧边栏复访」能力 —— **平台必接能力**。
 *
 * 未接入会被审核预检直接拦下（红色「检测项：侧边栏复访」），版本根本传不上去。
 * 预检是静态扫描代码，判断依据就一条：**代码里必须有 `tt.navigateToScene` 的调用**。
 * 但光有这一句只能骗过机器，人工审核会真的走一遍「从侧边栏回来必须发奖」的链路，
 * 所以这里把完整闭环做完：
 *
 *   ① 启动时（越早越好）注册 `tt.onShow` —— 晚了收不到从侧边栏返回的回调
 *   ② 用 `launch_from === 'homepage' && location === 'sidebar_card'`（或 scene 021036）判断来源
 *   ③ 命中就发奖（`onReward` 回调，游戏自己实现），同一会话只发一次
 *   ④ 提供一个入口按钮 → `tt.navigateToScene({ scene: 'sidebar' })` 跳出到侧边栏
 *
 * ## 两个坑
 *
 * - **不要用 `tt.getLaunchOptionsSync()` 当作唯一判断**：热启动（从侧边栏切回来）时它不更新，
 *   必须用 `tt.onShow` 的最新返回值。
 * - **onShow 必须尽早注册**：这个模块在 LoadingScene 的 onLoad 里 init，
 *   也就是进游戏的第一步，早于任何玩法逻辑。
 *
 * 老版本抖音没有侧边栏场景，用 `tt.checkScene` 判断，不支持就把入口按钮隐藏掉。
 */

// 抖音宿主注入的全局对象。Cocos 预览 / 微信环境里不存在，所以下面全部用 typeof 保护。
declare const tt: any;

/** 发奖时回传给游戏的信息 */
export interface SidebarRewardInfo {
    /** 是否确实从侧边栏进来 */
    fromSidebar: boolean;
    /** 宿主给的原始 onShow 参数，字段可能会加，原样留着备查 */
    raw: any;
}

class SidebarHelperImpl {
    /** 宿主是否支持侧边栏（`tt.checkScene` 的结果；还没回调时是 false） */
    supported = false;

    /** 本次进入 / 回到前台是否来自侧边栏 */
    fromSidebar = false;

    /** 已经判定该发奖，但游戏还没挂 onReward —— 挂上就立刻补发 */
    pendingReward = false;

    /** 游戏侧的奖励逻辑挂这里 */
    onReward: ((info: SidebarRewardInfo) => void) | null = null;

    private inited = false;
    /** 本次会话是否已经发过奖（避免同一局反复切侧边栏刷奖励） */
    private rewarded = false;

    /** 当前是否跑在抖音小游戏里，且具备跳转侧边栏的接口 */
    hasApi(): boolean {
        try {
            return typeof tt !== 'undefined' && !!tt && typeof tt.navigateToScene === 'function';
        } catch (e) {
            return false;
        }
    }

    /** 进游戏第一步调用，重复调用无副作用 */
    init() {
        if (this.inited) return;
        this.inited = true;

        if (!this.hasApi()) {
            console.log('[Sidebar] 当前不是抖音小游戏环境，侧边栏能力跳过（预览 / 其它平台正常现象）');
            return;
        }

        // ① 越早注册越好：从侧边栏切回来时只有 onShow 能拿到最新参数
        try {
            tt.onShow((res: any) => this.handleShow(res));
        } catch (e) {
            console.warn('[Sidebar] tt.onShow 注册失败：', e);
        }

        // ② 冷启动也要判一次：用户可能就是从侧边栏点进来的
        try {
            this.handleShow(tt.getLaunchOptionsSync());
        } catch (e) {
            console.warn('[Sidebar] getLaunchOptionsSync 失败：', e);
        }

        // ③ 老版本宿主没有侧边栏场景，先问一下
        try {
            tt.checkScene({
                scene: 'sidebar',
                success: (r: any) => {
                    this.supported = !!(r && r.isExist);
                    console.log('[Sidebar] 宿主支持侧边栏：' + this.supported);
                },
                fail: () => {
                    this.supported = false;
                    console.log('[Sidebar] 宿主不支持侧边栏（版本过低），入口按钮建议隐藏');
                },
            });
        } catch (e) {
            this.supported = false;
        }
    }

    /**
     * 判断 onShow 参数是否来自侧边栏。
     * 官方给的两个字段是 launch_from / location，部分版本只给 scene = '021036'，两个都认。
     */
    private handleShow(res: any) {
        if (!res) return;
        const hit = (res.launch_from === 'homepage' && res.location === 'sidebar_card') || res.scene === '021036';
        this.fromSidebar = hit;
        if (!hit) return;

        console.log('[Sidebar] 从侧边栏进入 / 返回', JSON.stringify(res));
        if (this.rewarded) {
            console.log('[Sidebar] 本次会话已发过奖，不再重复发');
            return;
        }
        this.rewarded = true;
        this.pendingReward = true;
        this.flush();
    }

    /** 游戏侧挂奖励逻辑；如果之前已经判定该发奖，挂上立刻补发 */
    setRewardHandler(fn: ((info: SidebarRewardInfo) => void) | null) {
        this.onReward = fn;
        this.flush();
    }

    private flush() {
        if (!this.pendingReward || !this.onReward) return;
        this.pendingReward = false;
        try {
            this.onReward({ fromSidebar: this.fromSidebar, raw: null });
        } catch (e) {
            console.error('[Sidebar] 发奖回调出错：', e);
        }
    }

    /**
     * 跳到侧边栏。**这一句 `tt.navigateToScene` 是审核预检的判定依据，不要删、不要包成别名。**
     */
    open(onResult?: (ok: boolean, msg?: string) => void) {
        if (!this.hasApi()) {
            console.warn('[Sidebar] 没有 tt.navigateToScene（非抖音环境），跳不过去');
            if (onResult) onResult(false, 'not-douyin');
            return;
        }
        try {
            tt.navigateToScene({
                scene: 'sidebar',
                success: () => {
                    console.log('[Sidebar] 跳转侧边栏成功');
                    if (onResult) onResult(true);
                },
                fail: (err: any) => {
                    console.warn('[Sidebar] 跳转侧边栏失败：', err);
                    if (onResult) onResult(false, (err && err.errMsg) || 'fail');
                },
            });
        } catch (e: any) {
            console.warn('[Sidebar] navigateToScene 抛异常：', e);
            if (onResult) onResult(false, (e && e.message) || 'error');
        }
    }
}

/** 全局单例，直接 import 使用 */
export const sidebarHelper = new SidebarHelperImpl();
