import {
    _decorator,
    Component,
    Sprite,
    SpriteFrame,
    UITransform,
    Rect,
    Enum,
    clamp,
} from 'cc';

const { ccclass, property, menu } = _decorator;

/** 播放方向 */
export enum PlayDirection {
    /** 正向：第 1 帧 → 最后 1 帧 */
    Forward = 0,
    /** 反向：最后 1 帧 → 第 1 帧 */
    Reverse = 1,
    /** 来回：正向播完反向播，循环往复 */
    PingPong = 2,
}

/** 供编辑器下拉框使用的枚举（必须用 Enum() 包装） */
const PlayDirectionEnum = Enum(PlayDirection);

/**
 * 通用精灵图（Sprite Sheet）帧动画组件
 *
 * 使用方法：
 * 1. 挂在带有 Sprite 组件的节点上；
 * 2. 将整张精灵图拖到 spriteFrame 属性；
 * 3. 设置每一帧的大小 frameWidth / frameHeight（像素）；
 * 4. 组件会根据图片尺寸自动算出行列数与总帧数并自动播放。
 *
 * 默认：从第一帧到最后一帧、无限循环。
 * 支持设置播放速度（fps）、播放方向（正向/反向/来回）、是否循环、是否自动播放。
 */
@ccclass('SpriteSheetAnimation')
@menu('通用/SpriteSheetAnimation（精灵图帧动画）')
export class SpriteSheetAnimation extends Component {

    @property({ type: SpriteFrame })
    public spriteFrame: SpriteFrame | null = null;

    @property()
    public frameWidth: number = 128;

    @property()
    public frameHeight: number = 128;

    @property()
    public fps: number = 10;

    @property({ type: PlayDirectionEnum })
    public direction: PlayDirection = PlayDirection.Forward;

    @property()
    public loop: boolean = true;

    @property()
    public totalFrames: number = 0;

    @property()
    public playOnLoad: boolean = true;

    @property()
    public startFromEndWhenReverse: boolean = true;

    @property()
    public fitNodeSize: boolean = true;

    @property()
    public debugLog: boolean = true;

    /** 当前帧索引（从 0 开始） */
    private _frameIndex: number = 0;
    /** 计算出的横向帧数 */
    private _columns: number = 1;
    /** 计算出的纵向帧数 */
    private _rows: number = 1;
    /** 实际使用的总帧数 */
    private _frameCount: number = 1;
    /** 累积时间 */
    private _accTime: number = 0;
    /** 是否正在播放 */
    private _playing: boolean = false;
    /** PingPong 时的方向（1 正 / -1 反） */
    private _pingPongStep: number = 1;
    /** 克隆出来的 SpriteFrame，避免修改到共享资源 */
    private _clonedFrame: SpriteFrame | null = null;
    private _sprite: Sprite | null = null;

    public get frameIndex(): number { return this._frameIndex; }
    public get frameCount(): number { return this._frameCount; }
    public get playing(): boolean { return this._playing; }

    protected onLoad(): void {
        this._sprite = this.getComponent(Sprite);
        if (!this._sprite) {
            console.error('[SpriteSheetAnimation] 节点上缺少 Sprite 组件');
            return;
        }
        if (!this.spriteFrame) {
            // 兜底：取 Sprite 上已设置的图
            this.spriteFrame = this._sprite.spriteFrame;
        }
        if (!this.spriteFrame) {
            console.error('[SpriteSheetAnimation] 未设置精灵图 spriteFrame');
            return;
        }

        // 克隆一份，运行时只改 rect，不影响引用同一张图的其他组件
        this._clonedFrame = this.spriteFrame.clone();
        this._clonedFrame.name = `${this.spriteFrame.name}(runtime)`;
        // 关闭动态图集打包，否则纹理被合入图集后 rect 坐标会错位/失效
        this._clonedFrame.packable = false;

        this.calcFrames();

        if (this.fitNodeSize && this._sprite) {
            // 单帧按原始像素大小显示，避免被拉伸成整图大小
            this._sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
            ut.setContentSize(this.frameWidth, this.frameHeight);
        }

        this._sprite!.spriteFrame = this._clonedFrame;
        this.applyFrame();

        if (this.playOnLoad) {
            this.play();
        }
    }

    protected onDestroy(): void {
        this._clonedFrame?.decRef();
        this._clonedFrame = null;
    }

    protected update(dt: number): void {
        if (!this._playing || this._frameCount <= 1) return;

        this._accTime += dt;
        const interval = 1 / Math.max(this.fps, 0.0001);

        while (this._accTime >= interval) {
            this._accTime -= interval;
            this.advance();
        }
    }

    // ------------------------------------------------------------------ 核心

    /** 根据图片尺寸和每帧大小计算行列数与总帧数 */
    private calcFrames(): void {
        if (!this.spriteFrame) return;

        const tex = this.spriteFrame.texture;
        const texW = tex ? tex.width : this.spriteFrame.rect.width;
        const texH = tex ? tex.height : this.spriteFrame.rect.height;

        const fw = Math.max(this.frameWidth, 1);
        const fh = Math.max(this.frameHeight, 1);

        this._columns = Math.max(1, Math.floor(texW / fw + 0.001));
        this._rows = Math.max(1, Math.floor(texH / fh + 0.001));

        const auto = this._columns * this._rows;
        this._frameCount = this.totalFrames > 0
            ? Math.min(this.totalFrames, auto)
            : auto;

        this._frameIndex = clamp(this._frameIndex, 0, this._frameCount - 1);
        // 初始帧位置
        if (this.playOnLoad && this.direction === PlayDirection.Reverse && this.startFromEndWhenReverse) {
            this._frameIndex = this._frameCount - 1;
        }

        if (this.debugLog) {
            console.log(`[SpriteSheetAnimation] 图片 ${texW}x${texH}，每帧 ${fw}x${fh}，` +
                `共 ${this._columns} 列 x ${this._rows} 行 = ${this._frameCount} 帧`);
        }
        if (this._frameCount <= 1) {
            console.warn(`[SpriteSheetAnimation] 只算出 ${this._frameCount} 帧！` +
                `请检查 frameWidth/frameHeight（${fw}x${fh}）是否等于图片里"单帧格子"的真实像素大小。` +
                `当前图片是 ${texW}x${texH}。`);
        } else if (texW % fw !== 0 || texH % fh !== 0) {
            console.warn(`[SpriteSheetAnimation] 图片尺寸（${texW}x${texH}）不是每帧大小（${fw}x${fh}）的整数倍，` +
                `取整后可能导致边缘帧错位。建议每帧大小 = 图片宽高分别除以列数/行数。`);
        }
    }

    /** 推进到下一帧（含方向与循环逻辑） */
    private advance(): void {
        const last = this._frameCount - 1;

        if (this.direction === PlayDirection.PingPong) {
            this._frameIndex += this._pingPongStep;

            if (this._frameIndex >= last) {
                // 到达末帧，掉头往回走
                this._frameIndex = last;
                this._pingPongStep = -1;
            } else if (this._frameIndex <= 0) {
                if (!this.loop && this._pingPongStep === -1) {
                    // 非循环：完整往返一次后停在起点
                    this.stopAt(0);
                    return;
                }
                this._frameIndex = 0;
                this._pingPongStep = 1;
            }
        } else {
            const step = this.direction === PlayDirection.Reverse ? -1 : 1;
            this._frameIndex += step;

            if (this._frameIndex > last || this._frameIndex < 0) {
                if (this.loop) {
                    this._frameIndex = this.direction === PlayDirection.Reverse ? last : 0;
                } else {
                    this._frameIndex = clamp(this._frameIndex, 0, last);
                    this.stop();
                    return;
                }
            }
        }
        this.applyFrame();
    }

    /** 把当前帧对应的区域写入克隆的 SpriteFrame */
    private applyFrame(): void {
        if (!this._clonedFrame || !this.spriteFrame) return;

        const fw = this.frameWidth;
        const fh = this.frameHeight;
        const col = this._frameIndex % this._columns;
        const row = Math.floor(this._frameIndex / this._columns);

        // SpriteFrame.rect 的原点在纹理左上角，y 轴向下
        const x = col * fw;
        const y = row * fh;
        this._clonedFrame.rect = new Rect(x, y, fw, fh);

        // 保险：强制刷新渲染数据，确保换帧立即生效
        if (this._sprite) {
            this._sprite.markForUpdateRenderData();
        }
    }

    // ------------------------------------------------------------------ 公共 API

    /** 开始播放（从头开始可选） */
    public play(restart: boolean = false): void {
        if (restart) {
            this._frameIndex = (this.direction === PlayDirection.Reverse && this.startFromEndWhenReverse)
                ? this._frameCount - 1
                : 0;
            this._pingPongStep = this.direction === PlayDirection.Reverse && this.startFromEndWhenReverse ? -1 : 1;
        }
        this._playing = true;
        this._accTime = 0;
        this.applyFrame();
    }

    /** 停止并回到起始帧 */
    public stop(): void {
        this._playing = false;
        this._frameIndex = 0;
        this._pingPongStep = 1;
        this.applyFrame();
    }

    /** 停在指定帧 */
    public stopAt(index: number): void {
        this._playing = false;
        this.setFrame(index);
    }

    /** 暂停（保持当前帧） */
    public pause(): void {
        this._playing = false;
    }

    /** 从暂停处继续播放 */
    public resume(): void {
        this._playing = true;
    }

    /** 直接跳到某一帧 */
    public setFrame(index: number): void {
        this._frameIndex = clamp(Math.floor(index), 0, this._frameCount - 1);
        this.applyFrame();
    }
}
