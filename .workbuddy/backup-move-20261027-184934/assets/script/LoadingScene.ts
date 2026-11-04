import { _decorator, Component, ProgressBar, Label, director, clamp } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Loading 场景的入口脚本：预加载目标场景，进度条走满后自动切过去。
 *
 * 挂在 loading 场景的 Canvas 上即可，ProgressBar 会自动在子节点里找
 * （场景里那个 300x15 的进度条，已经接好 barSprite）。
 *
 * 为什么不是「加载一秒就跳」：preloadScene 对小场景几乎是瞬间完成，
 * 直接跳会让进度条一闪而过，所以加了 minShowTime（最短停留）和
 * minDuration（进度条从 0 走满的最短时长），两者取晚的那个。
 */
@ccclass('LoadingScene')
export class LoadingScene extends Component {
    @property({ tooltip: '加载完成后进入的场景名（不要带 .scene 后缀）' })
    targetScene = 'game';

    @property({ tooltip: '进度条至少停留多久（秒），防止一闪而过' })
    minShowTime = 1.5;

    @property({ tooltip: '进度条从 0 走满最少用多久（秒）' })
    minDuration = 0.9;

    @property({ tooltip: '预加载最长等待（秒）；超时就强行 loadScene 兜底，防止卡死在 loading' })
    timeout = 30;

    private bar: ProgressBar | null = null;

    /** 当前显示的进度（0~1） */
    private shown = 0;
    /** 加载器给出的真实进度（0~1） */
    private target = 0;
    private elapsed = 0;
    private loadDone = false;
    private loadFailed = false;
    private launched = false;

    onLoad() {
        this.bar = this.node.getComponentInChildren(ProgressBar);
        if (this.bar) {
            this.bar.progress = 0;
        } else {
            console.warn('[Loading] 没找到 ProgressBar，进度不会显示（但不影响跳场景）');
        }
    }

    start() {
        console.log('[Loading] 开始预加载场景：' + this.targetScene);
        director.preloadScene(
            this.targetScene,
            (completed: number, total: number) => {
                const p = total > 0 ? completed / total : 0;
                if (p > this.target) this.target = p;
            },
            (err) => {
                this.loadDone = true;
                if (err) {
                    this.loadFailed = true;
                    console.error('[Loading] 预加载 ' + this.targetScene + ' 失败：', err);
                } else {
                    console.log('[Loading] 预加载完成');
                }
            },
        );
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
                console.warn('[Loading] 预加载超时（' + this.timeout + 's），直接 loadScene 兜底');
                if (this.bar) this.bar.progress = 1;
            }
            if (this.loadFailed) {
                console.error('[Loading] 预加载失败，仍然尝试直接 loadScene');
            }
            console.log('[Loading] 进入场景：' + this.targetScene);
            director.loadScene(this.targetScene, (err) => {
                if (err) {
                    // 只报一次，不要把 launched 改回 false —— 否则会每帧重试刷屏
                    console.error('[Loading] 进入 ' + this.targetScene + ' 失败：', err);
                    this.loadFailed = true;
                }
            });
        }
    }
}
