import { _decorator, Color, Component, Graphics, UITransform } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 数码管段位：a 上 / b 右上 / c 右下 / d 下 / e 左下 / f 左上 / g 中
 */
/** lineCap / lineJoin 都用 ROUND(1)；不同 Creator 版本枚举挂载位置不一样，兜底取 1 */
const ROUND = (Graphics as unknown as { LineCap?: { ROUND?: number } }).LineCap?.ROUND ?? 1;

const DIGIT_SEGS = [
    'abcdef', // 0
    'bc', // 1
    'abged', // 2
    'abgcd', // 3
    'fgbc', // 4
    'afgcd', // 5
    'afgecd', // 6
    'abc', // 7
    'abcdefg', // 8
    'abcdfg', // 9
];

/**
 * 用 Graphics 现画的数字（只支持 0-9 和 -），不依赖任何字体资源。
 *
 * 每帧不用重画：只在 setText 时重建一次几何，动画（缩放/位移/淡出）交给外层。
 * 一个 Graphics 组件 = 一次 DrawCall，和 Label CHAR 模式差不多。
 *
 * 分成 4 遍描边画出"霓虹"效果：
 *   1. 深色外描边（保证任何背景上都看得清）
 *   2. 彩色外发光（半透明，笔画更粗）
 *   3. 主色笔画
 *   4. 中心高光（很细的亮线，模拟灯管中心）
 */
@ccclass('GraphicsNumber')
export class GraphicsNumber extends Component {
    @property({ tooltip: '数字高度（px）' })
    digitHeight = 34;

    @property({ tooltip: '笔画粗细（px），越小越细' })
    thickness = 6;

    @property({ tooltip: '深色描边宽度（px），2 = 细描边' })
    outlineWidth = 2;

    @property({ tooltip: '倾斜角度（度），正数往右上斜' })
    skew = 10;

    @property({ tooltip: '字间距（px）' })
    spacing = 4;

    @property({ tooltip: '单字宽高比（0.5~0.65 之间比较好看）' })
    aspect = 0.56;

    @property({ type: Color, tooltip: '描边颜色（默认白描边）' })
    outlineColor: Color = new Color(255, 255, 255, 255);

    @property({ type: Color, tooltip: '中心高光颜色（笔画很细时不画）' })
    coreColor: Color = new Color(255, 255, 235, 255);

    @property({ tooltip: '外发光额外加的粗细（0 = 不发光）' })
    glowWidth = 0;

    private g: Graphics | null = null;
    private text = '';
    /** 主色，由 setText 传入（跟伤害颜色走） */
    private fillColor = new Color(255, 255, 255, 255);

    onLoad() {
        this.g = this.getComponent(Graphics) || this.addComponent(Graphics);
    }

    /** 换内容 + 主色，重画一次 */
    setText(text: string, color: Color) {
        this.text = text;
        this.fillColor.set(color);
        this.redraw();
    }

    /** 换字号（飘字层给暴击放大时会用到） */
    setHeight(height: number) {
        if (Math.abs(this.digitHeight - height) < 0.5) return;
        this.digitHeight = height;
        this.redraw();
    }

    private redraw() {
        const g = this.g || (this.g = this.getComponent(Graphics) || this.addComponent(Graphics));
        g.clear();
        if (!this.text) {
            this.syncSize();
            return;
        }

        const h = Math.max(8, this.digitHeight);
        const w = h * this.aspect;
        const gap = this.spacing;
        const count = this.text.length;
        const totalW = count * w + (count - 1) * gap;

        let ox = -totalW / 2;
        for (let i = 0; i < count; i++) {
            this.drawChar(g, this.text[i], ox, w, h);
            ox += w + gap;
        }

        this.syncSize();
    }

    /** 一个字符画 4 遍 */
    private drawChar(g: Graphics, ch: string, ox: number, w: number, h: number) {
        const segs = ch === '-' ? 'g' : DIGIT_SEGS[ch.charCodeAt(0) - 48];
        if (!segs) return;

        const m = this.thickness * 0.55;
        const tan = Math.tan((this.skew * Math.PI) / 180);

        const stroke = (color: Color, width: number) => {
            g.lineWidth = width;
            g.lineCap = ROUND as Graphics['lineCap'];
            g.lineJoin = ROUND as Graphics['lineJoin'];
            g.strokeColor = color;

            for (const key of segs) {
                const [x1, y1, x2, y2] = this.segPoints(key, w, h, m);
                g.moveTo(ox + this.skewX(x1, y1, h, tan), y1 - h / 2);
                g.lineTo(ox + this.skewX(x2, y2, h, tan), y2 - h / 2);
            }
            g.stroke();
        };

        // 1) 深色描边：笔画两侧各加 outlineWidth，所以线宽是 thickness + outlineWidth * 2
        const outline = Math.max(0, this.outlineWidth);
        stroke(this.outlineColor, this.thickness + outline * 2);

        // 2) 彩色外发光（默认关闭）
        if (this.glowWidth > 0) {
            const glow = new Color(this.fillColor.r, this.fillColor.g, this.fillColor.b, 110);
            stroke(glow, this.thickness + this.glowWidth);
        }

        // 3) 主色
        stroke(this.fillColor, this.thickness);

        // 4) 中心高光：笔画太细时画了会显脏，只在粗笔画时开
        if (this.thickness >= 10) {
            stroke(this.coreColor, Math.max(1, this.thickness * 0.32));
        }
    }

    /** 某个段的两个端点（盒子坐标：左下 0,0，右上 w,h） */
    private segPoints(key: string, w: number, h: number, m: number): [number, number, number, number] {
        const l = m;
        const r = w - m;
        const b = m;
        const t = h - m;
        const mid = h / 2;

        switch (key) {
            case 'a':
                return [l, t, r, t];
            case 'b':
                return [r, t, r, mid];
            case 'c':
                return [r, mid, r, b];
            case 'd':
                return [l, b, r, b];
            case 'e':
                return [l, mid, l, b];
            case 'f':
                return [l, t, l, mid];
            default:
                return [l, mid, r, mid]; // g
        }
    }

    /** 斜体：越往上越往右偏 */
    private skewX(x: number, y: number, h: number, tan: number): number {
        return x + (y - h / 2) * tan;
    }

    private syncSize() {
        const ut = this.node.getComponent(UITransform);
        if (!ut) return;

        const w = Math.max(8, this.digitHeight) * this.aspect;
        const count = Math.max(1, this.text.length);
        ut.setContentSize(count * w + (count - 1) * this.spacing + 24, Math.max(8, this.digitHeight) + 24);
    }
}
