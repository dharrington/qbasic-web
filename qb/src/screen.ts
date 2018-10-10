// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

function bitMod16(offset: number): number {
    return 1 << (offset % 16);
}

const reverse4bit = [
    0b0000, 0b1000, 0b0100, 0b1100, 0b0010, 0b1010, 0b0110, 0b1110, 0b0001, 0b1001, 0b0101, 0b1101, 0b0011, 0b1011,
    0b0111, 0b1111,
];
function reverse16bit(n: number): number {
    return (reverse4bit[n & 0xf] << 12) |
        (reverse4bit[(n & 0xf0) >> 4] << 8) |
        (reverse4bit[(n & 0xf00) >> 8] << 4) |
        reverse4bit[(n & 0xf000) >> 12];
}
export class Viewport {
    constructor(public left: number, public top: number, public right: number, public bottom: number) { }
    copy() {
        return new Viewport(this.left, this.top, this.right, this.bottom);
    }
    within(x: number, y: number): boolean {
        return !(x < this.left || y < this.top || x > this.right || y > this.bottom);
    }
    clamp(x: number, y: number): [number, number] {
        return [Math.min(Math.max(x, this.left), this.right), Math.min(Math.max(y, this.top), this.bottom)];
    }
}
export class Buffer {
    public data: Uint8Array;
    public fullViewport: Viewport;
    constructor(public width: number, public height: number) {
        this.data = new Uint8Array(width * height);
        this.fullViewport = new Viewport(0, 0, width - 1, height - 1);
    }
    onScreen(x: number, y: number): boolean {
        return !(x < 0 || y < 0 || x >= this.width || y >= this.height);
    }
    pset(x: number, y: number, color: number, mask: Viewport) {
        if (x < mask.left || y < mask.top || x > mask.right || y > mask.bottom) return;
        this.data[x + y * this.width] = color;
    }
    pget(x: number, y: number): number {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
        return this.data[x + y * this.width];
    }
    offsetAt(x, y): number {
        return x + y * this.width;
    }
    blt(src: Buffer, srcX, srcY, srcW, srcH, x, y) {
        if (srcX < 0) srcW += srcX;
        if (srcY < 0) srcH += srcY;
        if (srcW + srcX > src.width) srcW = src.width - srcX;
        if (srcH + srcY > src.height) srcH = src.height - srcY;
        if (x >= this.width || y >= this.height || srcW < 1 || srcH < 1 ||
            srcX >= src.width || srcY >= src.height) return;

        if (x < 0) {
            return this.blt(src, srcX - x, srcY, srcW + x, srcH, 0, y);
        }
        if (y < 0) {
            return this.blt(src, srcX, srcY - y, srcW, srcH + y, x, 0);
        }
        for (let yp = y; yp < y + srcH; yp++) {
            const srcOffset = src.offsetAt(srcX, srcY);
            this.data.set(src.data.slice(srcOffset, srcOffset + srcW), this.offsetAt(x, yp));
            srcY++;
        }
    }

    drawChar(x: number, y: number, code: number, fg: number, bg: number, charmap: ICharmap, mask: Viewport) {
        const [w, h] = [charmap.width, charmap.height];
        x *= w;
        y *= h;
        const [cx, cy] = charmap.charOffset(code);
        const charBuf = charmap.data();
        for (let yi = 0; yi < h; yi++) {
            for (let xi = 0; xi < w; xi++) {
                this.pset(x + xi, y + yi, charBuf.pget(xi + cx, yi + cy) ? fg : bg, mask);
            }
        }
    }
    clear(color: number) {
        this.data.fill(color);
    }

    drawCircle(x0: number, y0: number, radius: number, color: number, start: number, stop: number, aspect: number, mask: Viewport) {
        const Xscale = aspect > 1 ? 1 / aspect : 1.0;
        const Yscale = aspect < 1 ? aspect : 1.0;
        const R2 = radius * radius;
        const bR = Math.ceil(radius / Math.SQRT2);

        const fix = (x: number, y: number) => {
            if (Math.abs(x) >= Math.abs(y)) {
                y = Math.round(y);
                if (x > 0) {
                    x = Math.sqrt(R2 - y * y);
                } else {
                    x = -Math.sqrt(R2 - y * y);
                }
                return [x, y];
            } else {
                x = Math.round(x);
                if (y > 0) {
                    y = Math.sqrt(R2 - x * x);
                } else {
                    y = -Math.sqrt(R2 - x * x);
                }
                return [x, y];
            }
        };
        function* circlePoints() {
            for (let y = 0; y >= -bR; y--) {
                yield [Math.sqrt(R2 - y * y), y];
            }
            for (let x = bR; x >= -bR; x--) {
                yield [x, -Math.sqrt(R2 - x * x)];
            }
            for (let y = -bR; y <= bR; y++) {
                yield [-Math.sqrt(R2 - y * y), y];
            }
            for (let x = -bR; x <= bR; x++) {
                yield [x, Math.sqrt(R2 - x * x)];
            }
            for (let y = bR; y > 0; y--) {
                yield [Math.sqrt(R2 - y * y), y];
            }
        }
        const atAngle = (a) => {
            const [x, y] = fix(radius * Math.cos(a), radius * -Math.sin(a));
            return [Math.round(x), Math.round(y)];
        };

        const [startx, starty] = atAngle(start);
        const [endx, endy] = atAngle(stop);
        let penOn = start > stop;
        const smallDistance = stop >= start && (stop - start < 1);

        for (const [x, y] of circlePoints()) {
            const [px, py] = [Math.round(x * Xscale), Math.round(y * Yscale)];
            if (Math.round(x) === startx && Math.round(y) === starty) {
                penOn = true;
            }
            if (penOn) this.pset(px + x0, py + y0, color, mask);
            if (Math.round(x) === endx && Math.round(y) === endy) {
                if (endx === startx && endy === starty && stop > start + 3) {
                } else {
                    penOn = false;
                }
            }
        }
    }

    paint(x0: number, y0: number, paintColor: number, borderColor: number, mask: Viewport) {
        const painted = new Set();
        const stack = [[x0, y0]];
        while (stack.length) {
            const [x, y] = stack.pop() as number[];
            if (!mask.within(x, y)) continue;
            const pos = this.offsetAt(x, y);
            if (painted.has(pos)) continue;
            painted.add(pos);
            if (this.pget(x, y) === borderColor) continue;
            this.pset(x, y, paintColor, mask);
            stack.push([x + 1, y]);
            stack.push([x - 1, y]);
            stack.push([x, y + 1]);
            stack.push([x, y - 1]);
        }
    }

    filledRect(x1: number, y1: number, x2: number, y2: number, color: number, mask: Viewport) {
        const [left, right] = [Math.min(x1, x2), Math.max(x1, x2)];
        const [top, bottom] = [Math.min(y1, y2), Math.max(y1, y2)];
        for (let y = top; y <= bottom; y++) {
            const offset = this.offsetAt(left, y);
            this.data.fill(color, offset, offset + (right - left + 1));
        }
    }
    rect(x1: number, y1: number, x2: number, y2: number, color: number, style: number, mask: Viewport) {
        const [left, right] = [Math.min(x1, x2), Math.max(x1, x2)];
        const [top, bottom] = [Math.min(y1, y2), Math.max(y1, y2)];
        this.line(left, top, right, top, color, style, mask);
        this.line(left, bottom, right, bottom, color, style, mask);
        this.line(left, top, left, bottom, color, style, mask);
        this.line(right, top, right, bottom, color, style, mask);
    }
    line(x1: number, y1: number, x2: number, y2: number, color: number, style: number, mask: Viewport) {
        const deltax = x2 - x1;
        const deltay = y2 - y1;
        if (Math.abs(deltax) >= Math.abs(deltay)) {
            if (x1 > x2) {
                return this.linex(x2, y2, x1, y1, color, style, mask);
            }
            return this.linex(x1, y1, x2, y2, color, reverse16bit(style), mask);
        }
        if (y1 > y2) {
            return this.liney(x2, y2, x1, y1, color, style, mask);
        }
        return this.liney(x1, y1, x2, y2, color, reverse16bit(style), mask);
    }
    private linex(x1: number, y1: number, x2: number, y2: number, color: number, style: number, mask: Viewport) {
        const deltax = x2 - x1;
        const deltay = y2 - y1;
        const deltaerr = Math.fround(Math.abs(deltay / deltax));
        let error = 0.0;
        let y = y1;
        let styleIndex = 0;
        for (let x = x1; x <= x2; x++) {
            if (style & bitMod16(styleIndex++)) {
                this.pset(x, y, color, mask);
            }
            error = Math.fround(error + deltaerr);
            if (error >= 0.25) {
                y = y + Math.sign(deltay);
                error = error - 1;
            }
        }
    }
    private liney(x1: number, y1: number, x2: number, y2: number, color: number, style: number, mask: Viewport) {
        const deltax = x2 - x1;
        const errorThreshold = deltax > 0 ? .25 : .75;
        const deltay = y2 - y1;
        const deltaerr = Math.fround(Math.abs(deltax / deltay));
        let error = 0.0;
        let x = x1;
        let styleIndex = 0;
        for (let y = y1; y <= y2; y++) {
            if (style & bitMod16(styleIndex++)) {
                this.pset(x, y, color, mask);
            }
            error = Math.fround(error + deltaerr);
            if (error > errorThreshold) {
                x = x + Math.sign(deltax);
                error = error - 1;
            }
        }
    }
}

export interface ICharmap {
    height: number;
    width: number;
    data(): Buffer;
    charOffset(code: number): number[];
}

function hexToRgb(hex: string) {
    let c;
    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        c = hex.substring(1).split("");
        if (c.length === 3) {
            c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c = "0x" + c.join("");
        return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    }
    return [0, 0, 0];
}
function hexPalette(palStr): number[][] {
    return palStr.split(",").map((hex) => hexToRgb(hex));
}
export const kScreenPalettes: Map<number, number[][]> = new Map([
    [0, [
        [0, 0, 0],
        [0, 0, 170],
        [0, 170, 0],
        [0, 170, 170],
        [170, 0, 0],
        [170, 0, 170],
        [170, 85, 0],
        [170, 170, 170],
        [85, 85, 85],
        [85, 85, 255],
        [85, 255, 85],
        [85, 255, 255],
        [255, 85, 85],
        [255, 85, 255],
        [255, 255, 85],
        [255, 255, 255],
    ]],
    [1, hexPalette("#000000,#0000aa,#00aa00,#00aaaa,#aa0000,#aa00aa,#aa5500,#aaaaaa,#555555,#5555ff,#55ff55,#55ffff,#ff5555,#ff55ff,#ffff55,#ffffff")],
    [2, hexPalette("#000000,#ffffff")],
    [7, hexPalette("#000000,#0000aa,#00aa00,#00aaaa,#aa0000,#aa00aa,#aa5500,#aaaaaa,#555555,#5555ff,#55ff55,#55ffff,#ff5555,#ff55ff,#ffff55,#ffffff")],
    [8, hexPalette("#000000,#0000aa,#00aa00,#00aaaa,#aa0000,#aa00aa,#aa5500,#aaaaaa,#555555,#5555ff,#55ff55,#55ffff,#ff5555,#ff55ff,#ffff55,#ffffff")],
    [9, hexPalette("#000000,#0000aa,#00aa00,#00aaaa,#aa0000,#aa00aa,#aa5500,#aaaaaa,#555555,#5555ff,#55ff55,#55ffff,#ff5555,#ff55ff,#ffff55,#ffffff")],
    [12, hexPalette("#000000,#0000aa,#00aa00,#00aaaa,#aa0000,#aa00aa,#aa5500,#aaaaaa,#555555,#5555ff,#55ff55,#55ffff,#ff5555,#ff55ff,#ffff55,#ffffff")],
    [13, hexPalette("#000000,#0000aa,#00aa00,#00aaaa,#aa0000,#aa00aa,#aa5500,#aaaaaa,#555555,#5555ff,#55ff55,#55ffff,#ff5555,#ff55ff,#ffff55,#ffffff,#000000,#141414,#202020,#2d2d2d,#393939,#454545,#515151,#616161,#717171,#828282,#929292,#a2a2a2,#b6b6b6,#cacaca,#e3e3e3,#ffffff,#0000ff,#4100ff,#7d00ff,#be00ff,#ff00ff,#ff00be,#ff007d,#ff0041,#ff0000,#ff4100,#ff7d00,#ffbe00,#ffff00,#beff00,#7dff00,#41ff00,#00ff00,#00ff41,#00ff7d,#00ffbe,#00ffff,#00beff,#007dff,#0041ff,#7d7dff,#9e7dff,#be7dff,#df7dff,#ff7dff,#ff7ddf,#ff7dbe,#ff7d9e,#ff7d7d,#ff9e7d,#ffbe7d,#ffdf7d,#ffff7d,#dfff7d,#beff7d,#9eff7d,#7dff7d,#7dff9e,#7dffbe,#7dffdf,#7dffff,#7ddfff,#7dbeff,#7d9eff,#b6b6ff,#c6b6ff,#dbb6ff,#ebb6ff,#ffb6ff,#ffb6eb,#ffb6db,#ffb6c6,#ffb6b6,#ffc6b6,#ffdbb6,#ffebb6,#ffffb6,#ebffb6,#dbffb6,#c6ffb6,#b6ffb6,#b6ffc6,#b6ffdb,#b6ffeb,#b6ffff,#b6ebff,#b6dbff,#b6c6ff,#000071,#1c0071,#390071,#550071,#710071,#710055,#710039,#71001c,#710000,#711c00,#713900,#715500,#717100,#557100,#397100,#1c7100,#007100,#00711c,#007139,#007155,#007171,#005571,#003971,#001c71,#393971,#453971,#553971,#613971,#713971,#713961,#713955,#713945,#713939,#714539,#715539,#716139,#717139,#617139,#557139,#457139,#397139,#397145,#397155,#397161,#397171,#396171,#395571,#394571,#515171,#595171,#615171,#695171,#715171,#715169,#715161,#715159,#715151,#715951,#716151,#716951,#717151,#697151,#617151,#597151,#517151,#517159,#517161,#517169,#517171,#516971,#516171,#515971,#000041,#100041,#200041,#310041,#410041,#410031,#410020,#410010,#410000,#411000,#412000,#413100,#414100,#314100,#204100,#104100,#004100,#004110,#004120,#004131,#004141,#003141,#002041,#001041,#202041,#282041,#312041,#392041,#412041,#412039,#412031,#412028,#412020,#412820,#413120,#413920,#414120,#394120,#314120,#284120,#204120,#204128,#204131,#204139,#204141,#203941,#203141,#202841,#2d2d41,#312d41,#352d41,#3d2d41,#412d41,#412d3d,#412d35,#412d31,#412d2d,#41312d,#41352d,#413d2d,#41412d,#3d412d,#35412d,#31412d,#2d412d,#2d4131,#2d4135,#2d413d,#2d4141,#2d3d41,#2d3541,#2d3141,#000000,#000000,#000000,#000000,#000000,#000000,#000000,#000000"),
    ],
]);

export const kScreenDims: Map<number, number[]> = new Map([
    [0, [640, 400]],
    [1, [320, 200]],
    [2, [640, 200]],
    [7, [320, 200]],
    [8, [640, 200]],
    [9, [640, 350]],
    [12, [640, 480]],
    [13, [320, 200]],
]);

export class Palette {
    public colors = new Uint8Array(256 * 3)
    constructor() {
        this.setPalette(kScreenPalettes.get(0) as any);
    }
    setPaletteEntry(attr: number, rgb: number[]) {
        this.colors[attr * 3 + 0] = rgb[0];
        this.colors[attr * 3 + 1] = rgb[1];
        this.colors[attr * 3 + 2] = rgb[2];
    }
    getEntry(attr: number): [number, number, number] {
        return [this.colors[attr * 3 + 0],
        this.colors[attr * 3 + 1],
        this.colors[attr * 3 + 2]];
    }
    setPalette(pal: number[][]) {
        for (let i = 0; i < 256; i++) {
            if (pal.length > i) {
                this.colors[i * 3] = pal[i][0];
                this.colors[i * 3 + 1] = pal[i][1];
                this.colors[i * 3 + 2] = pal[i][2];
            } else {
                this.colors[i * 3] = 0;
                this.colors[i * 3 + 1] = 0;
                this.colors[i * 3 + 2] = 0;
            }
        }
    }
}
