import { _decorator, Component, ProgressBar, director, clamp, assetManager, AssetManager, Scene } from 'cc';
import { sidebarHelper } from './DouyinSidebar';

const { ccclass, property } = _decorator;

/**
 * Loading 场景的入口脚本：预加载目标场景，进度条走满后自动切过去。
 *
 * 挂在 loading 场景的 Canvas 上即可，ProgressBar 会自动在子节点里找
 * （场景里那个 300x15 的进度条，已经接好 barSprite）。
 *
 * ## 为什么要先加载 AssetBundle
 *
 * `game.scene` 放在 `assets/bundle` 里，而这个目录开了 **isBundle**（AssetBundle）。
 * 打包后它不在主包，而是进了分包 `subpackages/bundle/`。
 *
 * `director.preloadScene('game')` / `director.loadScene('game')` 只认**主包**里的场景，
 * 跨 bundle 找不到，运行时会报：
 *   `Can not preload the scene "game" because it is not in the build settings.`
 *
 * 正确顺序是：`assetManager.loadBundle('bundle')` → `bundle.preloadScene('game')`
 * → `bundle.loadScene('game')` → `director.runScene(scene)`。
 *
 * 如果哪天把 game.scene 挪回主包，把 bundleName 清空即可，会自动走 director 的老路。
 *
 * ## 为什么不是「加载一秒就跳」
 *
 * preloadScene 对小场景几乎是瞬间完成，直接跳会让进度条一闪而过，
 * 所以加了 minShowTime（最短停留）和 minDuration（进度条从 0 走满的最短时长），
 * 两者取晚的那个。
 */
@ccclass('LoadingScene')
export class LoadingScene extends Component {
    @property({ tooltip: '加载完成后进入的场景名（不要带 .scene 后缀）' })
    targetScene = 'game';

    @property({
        tooltip:
            '目标场景所在的 AssetBundle 名（assets/bundle 开了 isBundle 时就是 bundle）。' +
            '留空 = 场景在主包里，直接用 director 加载',
    })
    bundleName = 'bundle';

    @property({ tooltip: '进度条至少停留多久（秒），防止一闪而过' })
    minShowTime = 1.5;

    @property({ tooltip: '进度条从 0 走满最少用多久（秒）' })
    minDuration = 0.9;

    @property({ tooltip: '预加载最长等待（秒）；超时就强行切场景兜底，防止卡死在 loading' })
    timeout = 30;

    private bar: ProgressBar | null = null;
    private bundle: AssetManager.Bundle | null = null;

    /** 当前显示的进度（0~1） */
    private shown = 0;
    /** 加载器给出的真实进度（0~1） */
    private target = 0;
    private elapsed = 0;
    private loadDone = false;
    private loadFailed = false;
    private launched = false;

    onLoad() {
        // 侧边栏复访是抖音必接能力，onShow 必须**尽早**注册（晚了收不到从侧边栏返回的回调）。
        // 放在全游戏的第一帧，比任何玩法脚本都早。
        sidebarHelper.init();

        this.bar = this.node.getComponentInChildren(ProgressBar);
        if (this.bar) {
            this.bar.progress = 0;
        } else {
            console.warn('[Loading] 没找到 ProgressBar，进度不会显示（但不影响跳场景）');
        }
    }

    start() {
        if (!this.bundleName) {
            console.log('[Loading] 场景在主包，直接预加载：' + this.targetScene);
            this.preloadTarget();
            return;
        }
        console.log('[Loading] 加载 AssetBundle：' + this.bundleName);
        assetManager.loadBundle(this.bundleName, (err, bundle) => {
            if (err || !bundle) {
                this.loadDone = true;
                this.loadFailed = true;
                console.error(
                    '[Loading] 加载 bundle "' + this.bundleName + '" 失败。检查 assets/bundle 目录' +
                        '是否勾了 isBundle、构建产物里有没有 subpackages/' + this.bundleName + '/ 。',
                    err,
                );
                return;
            }
            this.bundle = bundle;
            this.preloadTarget();
        });
    }

    /** 在正确的容器里预加载目标场景（bundle 优先，否则走主包） */
    private preloadTarget() {
        const onProgress = (completed: number, total: number) => {
            const p = total > 0 ? completed / total : 0;
            if (p > this.target) this.target = p;
        };
        const onDone = (err?: Error | null) => {
            this.loadDone = true;
            if (err) {
                this.loadFailed = true;
                console.error('[Loading] 预加载 ' + this.targetScene + ' 失败：', err);
            } else {
                console.log('[Loading] 预加载完成：' + this.targetScene);
            }
        };

        if (this.bundle) {
            this.bundle.preloadScene(this.targetScene, onProgress, onDone);
        } else {
            director.preloadScene(this.targetScene, onProgress, onDone);
        }
    }

    update(dt: number) {
        this.elapsed += dt;

        // 预加载结束就把目标拉满：有些场景没有需要下载的资源，
        // onProgress 可能一次都不回调，或者回调的 total 是 0。
        if (this.loadDone) {
            this.target = 1;
        }

        // 显示值平滑追目标；顺带保证「从 0 到 1 至少 minDuration 秒」
        if (this.shown < this.target) {
            const rate = 1 / Math.max(0.05, this.minDuration);
            this.shown = Math.min(this.target, this.shown + rate * dt);
        }

        if (this.bar) {
            this.bar.progress = clamp(this.shown, 0, 1);
        }

        // 进度满 + 停留够久 → 进场；或者等太久了直接兜底进场
        const overtime = this.elapsed >= this.timeout;
        if (!this.launched && ((this.shown >= 1 && this.elapsed >= this.minShowTime) || overtime)) {
            this.launched = true;
            if (overtime && this.shown < 1) {
                console.warn('[Loading] 预加载超时（' + this.timeout + 's），直接切场景兜底');
                if (this.bar) this.bar.progress = 1;
            }
            if (this.loadFailed) {
                console.error('[Loading] 预加载失败，仍然尝试直接切场景');
            }
            this.enterScene();
        }
    }

    /** 真正切场景：bundle 里来的场景必须自己 runScene，director.loadScene 找不到它 */
    private enterScene() {
        const name = this.targetScene;
        if (this.bundle) {
            console.log('[Loading] 从 bundle 加载场景：' + name);
            this.bundle.loadScene(name, (err, sceneAsset) => {
                if (err || !sceneAsset) {
                    // 只报一次，不要把 launched 改回 false —— 否则会每帧重试刷屏
                    this.loadFailed = true;
                    console.error('[Loading] bundle 里加载场景 ' + name + ' 失败：', err);
                    return;
                }
                const scene: Scene | null = sceneAsset.scene;
                if (!scene) {
                    console.error('[Loading] ' + name + ' 不是场景资源');
                    return;
                }
                console.log('[Loading] 进入场景：' + name);
                director.runScene(scene);
            });
            return;
        }

        console.log('[Loading] 进入场景：' + name);
        director.loadScene(name, (err) => {
            if (err) {
                this.loadFailed = true;
                console.error('[Loading] 进入 ' + name + ' 失败：', err);
            }
        });
    }
}
