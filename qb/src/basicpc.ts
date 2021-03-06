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

import * as vm from "./vm";
import * as chars from "./chars";
import { Buffer, ICharmap, Palette, Viewport } from "./screen";
import * as S from "./screen";

export interface IInputBuffer {
    setInputEnabled(enabled: boolean);
    inkey(): string;
    lineInput(onChanged: (text: string, done: boolean) => void);
    inkeyWait(chars: number, done: (result: string) => void);
    destroy();
}

// State of a screen buffer. This includes pixels and color state.
class BufferState {
    public x: number = 0;
    public y: number = 0;
    public bgcolor: number = 0;
    public fgcolor: number = 7;
    public printViewTop = 0;
    public printViewBottom = 24;
    constructor(public buffer: Buffer) { }
}

// The primary VirtualPC implementation.
export class BasicPC implements vm.IVirtualPC {
    public textOutput: string = "";
    private graphicsViewport: Viewport;
    // If true, graphics calls are relative to the graphics viewport top-left corner.
    private relativeViewport = false;
    private textViewport: Viewport;
    protected width: number;
    protected height: number;
    private rows: number;
    private cols: number;

    private screenBuffers: BufferState[];
    private activeBufferIndex: number = 0;
    private displayedBufferIndex: number = 0;
    private pal = new Palette();

    private viewCoordinateBox?: [number, number, number, number] = undefined;
    private viewCoordinateInverted = false;

    private viewTranslateX = 0;
    private viewTranslateY = 0;
    private viewScalingX = 1;
    private viewScalingY = 1;

    private charmap: ICharmap;
    protected dirty = true;
    private currentScreen: number = 0;

    private charHeight: number;

    constructor(private inputBuffer: IInputBuffer) { }

    init() {
        this.currentScreen = -1;
        this.screen(0, undefined, undefined, undefined);
        this.charmap = chars.get8x16();
        this.charHeight = this.charmap.height;
    }

    programDone() {
        const buf = this.vbuf();
        buf.x = 0;
        buf.y = this.rows - 1;
        const message = "Press any key to continue";
        this.drawChars(message, true);
        for (let i = 0; i < this.cols - message.length; i++) {
            this.drawChars(" ", true);
        }
    }

    setInputEnabled(enabled: boolean) {
        this.inputBuffer.setInputEnabled(enabled);
    }
    destroy() {
        this.inputBuffer.destroy();
    }

    newline() {
        const buf = this.abuf();
        buf.x = 0;
        buf.y += 1;

    }
    setDims(w: number, h: number, charWidth: number, charHeight: number, bufferCount: number, defaultColor: number) {
        this.viewCoordinateBox = undefined;
        this.charHeight = charHeight;
        this.width = w;
        this.height = h;
        this.cols = Math.trunc(w / charWidth);
        this.rows = Math.trunc(h / charHeight);

        this.activeBufferIndex = 0;
        this.displayedBufferIndex = 0;
        this.screenBuffers = [];
        for (let i = 0; i < bufferCount; i++) {
            const b = new BufferState(new Buffer(this.width, this.height));
            b.fgcolor = defaultColor;
            this.screenBuffers.push(b);
        }
        this.graphicsViewport = this.abuf().buffer.fullViewport.copy();
        this.textViewport = this.abuf().buffer.fullViewport.copy();
        this.abuf().printViewTop = 0;
        this.abuf().printViewBottom = this.rows - 2;
        this.dimsChanged();
    }

    dimsChanged() { }

    cursor(show: boolean) { }
    locate(y?: number, x?: number) {
        const buf = this.abuf();
        if (x !== undefined) buf.x = Math.max(0, Math.min(Math.floor(x - 1), this.cols - 1));
        if (y !== undefined) buf.y = Math.max(0, Math.min(Math.floor(y - 1), this.rows - 1));
    }

    printNewline() {
        this.newline();
        const buf = this.abuf();
        if (buf.y > buf.printViewBottom) {
            this.scroll();
        }
    }

    print(str: string) {
        const charsRemain = this.cols - this.abuf().x;
        if (str.length > charsRemain && this.abuf().x > 0) {
            this.newline();
        }
        this.drawChars(str);
    }


    input(completed: (text: string) => void) {
        const inputx = this.abuf().x;
        const inputy = this.abuf().y;
        let prevText = "";
        const updatefn = (text: string, done: boolean) => {
            this.abuf().x = inputx;
            this.abuf().y = inputy;
            while (prevText && prevText.length > text.length) {
                text += " "; // make backspace clear text.
            }
            this.drawChars(text);
            prevText = text;
            if (done) completed(text);
        };
        this.inputBuffer.lineInput(updatefn);
    }

    inkeyWait(n: number, callback: (result: string) => void) {
        this.inputBuffer.inkeyWait(n, callback);
    }

    setForeColor(fc: number) {
        const buf = this.abuf();
        buf.fgcolor = fc;
    }

    setBackColor(bc: number) {
        const buf = this.abuf();
        buf.bgcolor = bc;
    }

    foreColor(): number { return this.abuf().fgcolor; }
    backColor(): number { return this.abuf().bgcolor; }
    resetPalette() {
        const pal = S.kScreenPalettes.get(this.currentScreen);
        if (pal) {
            this.pal.setPalette(pal);
            this.dirty = true;
        }
    }
    setPaletteAttribute(attr: number, color: number) {
        const rgb = [color % 256, Math.trunc(color / 256) % 256, Math.trunc(color / 65536) % 256];
        this.pal.setPaletteEntry(attr, rgb);
        this.dirty = true;
    }
    inkey(): string {
        return this.inputBuffer.inkey();
    }
    pset(x: number, y: number, color?: number) {
        const buf = this.abuf();
        if (!color) {
            color = buf.fgcolor;
        }
        [x, y] = this.toScreenSpaceRounded(x, y);
        buf.buffer.pset(x, y, color, this.graphicsViewport);
        this.dirty = true;
    }

    point(x: number, y: number): number {
        return this.abuf().buffer.pget(x, y);
    }
    setViewPrint(top: number, bottom: number) {
        this.abuf().y = top - 1;
        this.abuf().x = 0;
        this.abuf().printViewTop = top - 1;
        this.abuf().printViewBottom = bottom - 1;
    }
    setView(x1: number, y1: number, x2: number, y2: number, relative: boolean) {
        const buf = this.abuf().buffer;
        [this.graphicsViewport.left, this.graphicsViewport.top] = buf.fullViewport.clamp(Math.min(x1, x2), Math.min(y1, y2));
        [this.graphicsViewport.right, this.graphicsViewport.bottom] = buf.fullViewport.clamp(Math.max(x1, x2), Math.max(y1, y2));
        this.relativeViewport = relative;
        this.updateViewTransform();
    }
    setViewCoordinates(x1: number, y1: number, x2: number, y2: number, screen: boolean) {
        this.viewCoordinateBox = [x1, y1, x2, y2];
        this.viewCoordinateInverted = !screen;
        this.updateViewTransform();
    }
    screenLines(): number {
        return this.rows;
    }
    circle(x: number, y: number, radius: number, color: number | undefined, start: number, end: number, aspect: number) {
        const buf = this.abuf();
        [x, y] = this.toScreenSpaceRounded(x, y); // TODO: is radius scaled too?
        const screenRadiusX = radius * this.viewScalingX;
        // View coordinates do not affect aspect. Radius respects view coordinate X-scaling.
        const screenR = Math.round(screenRadiusX);
        const screenAspect = aspect;

        if (color === undefined) {
            color = buf.fgcolor;
        }
        buf.buffer.drawCircle(x, y, screenR, color, start, end, screenAspect, this.graphicsViewport);
        this.dirty = true;
    }

    paint(x: number, y: number, paintColor: number | undefined, borderColor: number | undefined) {
        const buf = this.abuf();
        [x, y] = this.toScreenSpaceRounded(x, y);
        if (paintColor === undefined) {
            paintColor = buf.fgcolor;
        }
        if (borderColor === undefined) {
            borderColor = paintColor;
        }
        buf.buffer.paint(x, y, paintColor, borderColor, this.graphicsViewport);
    }

    line(x1: number, y1: number, x2: number, y2: number, color: number | undefined, lineType: vm.LineType, style: number) {
        const buf = this.abuf();
        [x1, y1] = this.toScreenSpaceRounded(x1, y1);
        [x2, y2] = this.toScreenSpaceRounded(x2, y2);
        if (color === undefined) {
            color = buf.fgcolor;
        }
        switch (lineType) {
            case vm.LineType.kLine:
                buf.buffer.line(x1, y1, x2, y2, color, style, this.graphicsViewport);
                break;
            case vm.LineType.kBox:
                buf.buffer.rect(x1, y1, x2, y2, color, style, this.graphicsViewport);
                break;
            case vm.LineType.kFilledBox:
                buf.buffer.filledRect(x1, y1, x2, y2, color, this.graphicsViewport);
                break;
        }
        this.dirty = true;
    }

    draw(currentX: number, currentY: number, instructions: vm.DrawInstruction[]) {
        const buf = this.abuf();
        [currentX, currentY] = this.toScreenSpaceRounded(currentX, currentY);

        let rotation = 0;
        let scale = 1;
        for (const inst of instructions) {
            switch (inst.id) {
                case vm.DrawInstructionID.kMove:
                case vm.DrawInstructionID.kMoveXY: {
                    const [x, y] = inst.getPosition(currentX, currentY, rotation, scale);
                    if (!inst.noDraw) {
                        buf.buffer.line(currentX, currentY, x, y, buf.fgcolor, 0xffff, this.graphicsViewport);
                    }
                    if (!inst.returnWhenDone) {
                        currentX = x;
                        currentY = y;
                    }
                    break;
                }
                case vm.DrawInstructionID.kRotation: // a=angle*90
                    rotation = (inst.a as number) * (Math.PI / 2);
                    break;
                case vm.DrawInstructionID.kTurn: // a=angle
                    rotation = (inst.a as number) * (Math.PI / 180);
                    break;
                case vm.DrawInstructionID.kColor: // a=color
                    buf.fgcolor = inst.a as number;
                case vm.DrawInstructionID.kScale: // a=scale
                    scale = (inst.a as number) / 4.0;
                    break;
                case vm.DrawInstructionID.kPaint: // a=fill,b=border
                    // TODO
                    break;
            }
        }
    }
    bitsPerPixel(): number {
        const pal = S.kScreenPalettes.get(this.currentScreen);
        if (!pal) return 8;
        const colorsCount = pal.length;
        let bitsPerPixel = 1;
        while (1 << (bitsPerPixel) < colorsCount) {
            ++bitsPerPixel;
        }
        return bitsPerPixel;
    }
    getGraphics(x1: number, y1: number, x2: number, y2: number, maxBytes: number): Uint8Array | undefined {
        const buf = this.abuf();
        [x1, y1] = this.toScreenSpaceRounded(x1, y1);
        [x2, y2] = this.toScreenSpaceRounded(x2, y2);
        // The format for QB GET is the following:
        // Bits per scan line <16-bit integer>
        // Rows <16-bit integer>
        // Pixel data, packed low-to-high bit order.
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const right = Math.max(x1, x2);
        const bottom = Math.max(y1, y2);
        const width = right - left + 1;
        const height = bottom - top + 1;

        const bitsPerPixel = this.bitsPerPixel();
        const scanLineBits = width * bitsPerPixel;
        const scanLineBytes = Math.floor((scanLineBits + 7) / 8);
        const headerSizeBytes = 4;
        const bufferSize = headerSizeBytes + scanLineBytes * height;
        if (bufferSize > maxBytes) {
            return undefined;
        }
        const result = new Uint8Array(bufferSize);
        let writePos = 0;
        let writeHalfPos = 0;
        const write = (n: number) => {
            result[writePos++] = n;
        };
        const write16 = (n: number) => {
            write(n % 256);
            write((n / 256) % 256);
        };
        const write4 = (n: number) => {
            if (writeHalfPos) {
                result[writePos++] += n << 4;
                writeHalfPos = 0;
            } else {
                result[writePos] = n;
                writeHalfPos = 1;
            }
        };
        write16(scanLineBits);
        write16(height);
        if (bitsPerPixel === 8) {
            for (let y = top; y <= bottom; ++y) {
                const offset = buf.buffer.offsetAt(left, y);
                result.set(buf.buffer.data.slice(offset, offset + width), writePos);
                writePos += width;
            }
        } else if (bitsPerPixel === 4) { // TODO: implement bit planes
            for (let y = top; y <= bottom; ++y) {
                const offset = buf.buffer.offsetAt(left, y);
                for (let x = left; x <= right; ++x) {
                    write4(buf.buffer.data[offset + x - left] % 16);
                }
                if (writeHalfPos) { // scanlines end on byte boundary
                    writeHalfPos = 0;
                    ++writePos;
                }
            }
        } else {
            console.log("not yet implemented: " + bitsPerPixel + " bits per pixel");
            return undefined;
        }
        return result;
    }
    putGraphics(x: number, y: number, data: Uint8Array, actionVerb: vm.GraphicsAction) {
        const buf = this.abuf();
        // TODO: actionVerb
        [x, y] = this.toScreenSpaceRounded(x, y);
        if (data.length < 4) return;
        let dataPos = 0;
        let halfPos = 0;
        const read = (): number => {
            return data[dataPos++];
        };
        const read16 = (): number => {
            return read() + (read() << 8);
        };
        const read4 = (): number => {
            if (halfPos) {
                halfPos = 0;
                return data[dataPos++] >> 4;
            } else {
                halfPos = 1;
                return data[dataPos] % 16;
            }
        };
        const scanLineBits = read16();
        const rows = read16();
        const bitsPerPixel = this.bitsPerPixel();
        if (bitsPerPixel === 8) {
            // TODO: Crop?
            const width = Math.floor(scanLineBits / 8);
            for (let i = 0; i < rows; ++i) {
                buf.buffer.data.set(data.slice(dataPos, dataPos + width), buf.buffer.offsetAt(x, y + i));
                dataPos += width;
            }
        } else if (bitsPerPixel === 4) {
            const width = Math.floor(scanLineBits / 4);
            for (let i = 0; i < rows; ++i) {
                const offset = buf.buffer.offsetAt(x, y + i);
                for (let j = 0; j < width; ++j) {
                    buf.buffer.data[offset + j] = read4();
                }
                if (halfPos) { // scanlines end on byte boundary.
                    read4();
                }
            }
        } else {
            // TODO: Other bits per pixel
            console.log("not yet implemented: " + bitsPerPixel + " bits per pixel");
            return undefined;
        }
    }
    screen(id: number | undefined, colorswitch: number | undefined, apage: number | undefined, vpage: number | undefined) {
        if (id !== undefined) {
            if (!S.kScreenDims.has(id)) return;
            const [w, h] = S.kScreenDims.get(id) as any;
            switch (id) {
                case 1: case 2: case 7: case 8: case 13:
                    this.charmap = chars.get8x8();
                    break;
                case 0: case 4: case 11: case 12: default:
                    this.charmap = chars.get8x16();
                    break;
                case 9:
                    this.charmap = chars.get8x14();
                    break;
            }
            let bufferCount = 1;
            switch (id) {
                case 0: case 7: bufferCount = 8; break;
                case 8: bufferCount = 4; break;
                case 9: bufferCount = 2; break;
            }
            if (id !== this.currentScreen) {
                const defaultColor = (id === 0) ? 7 : 15;
                this.setDims(w, h, this.charmap.width, this.charmap.height, bufferCount, defaultColor);
                this.pal.setPalette(S.kScreenPalettes.get(id) as any);
                this.currentScreen = id;
            }
        }
        if (apage !== undefined && apage >= 0 && apage < this.screenBuffers.length) {
            this.activeBufferIndex = apage;
        }
        if (vpage !== undefined && vpage >= 0 && vpage < this.screenBuffers.length) {
            this.displayedBufferIndex = vpage;
            this.dirty = true;
        }
        // TODO: colorswitch
    }
    sleep(delay: number, done) {
        setTimeout(() => {
            done();
        }, delay * 1000.0);
    }
    cls() {
        const buf = this.abuf();
        buf.buffer.clear(buf.bgcolor);
        this.dirty = true;
        buf.x = 0;
        buf.y = buf.printViewTop;
    }

    clsText() {
        const buf = this.abuf();
        buf.buffer.filledRect(0, this.abuf().printViewTop * this.charHeight, this.width, buf.printViewBottom * this.charHeight + this.charHeight, buf.bgcolor, this.textViewport);
        buf.y = buf.printViewTop;
        buf.x = 0;
    }
    clsGraphics() {
        const buf = this.abuf();
        buf.buffer.filledRect(this.graphicsViewport.left, this.graphicsViewport.top, this.graphicsViewport.right, this.graphicsViewport.bottom, buf.bgcolor, this.graphicsViewport);
    }

    scroll() {
        const buf = this.abuf();
        const lines = (buf.printViewBottom - buf.printViewTop);
        if (lines > 0) {
            const top = this.charHeight * buf.printViewTop;
            buf.buffer.blt(buf.buffer, 0, this.charHeight + top, this.width, lines * this.charHeight, 0, top);
            buf.buffer.filledRect(0, buf.printViewBottom * this.charHeight, this.width, buf.printViewBottom * this.charHeight + this.charHeight, buf.bgcolor, this.textViewport);
            this.dirty = true;
        }
        this.abuf().y -= 1;
    }

    mapToScreen(x: number, y: number): [number, number] {
        return this.toScreenSpace(x, y);
    }

    mapFromScreen(x: number, y: number): [number, number] {
        return [(x - this.viewTranslateX) / this.viewScalingX, (y - this.viewTranslateY) / this.viewScalingY];
    }

    protected palette(): Palette { return this.pal; }

    private drawChars(str: string, disableScroll?: boolean) {
        const buf = this.abuf();
        this.cursor(false);
        for (const c of str) {
            if (buf.y > buf.printViewBottom) {
                if (!disableScroll) this.scroll();
            }
            if (c === "\t") {
                const tabSize = 8;
                buf.x = Math.floor((buf.x + tabSize) / tabSize) * tabSize;
                if (buf.x > this.cols) {
                    buf.x = 0;
                    this.newline();
                }
            } else if (c === "\n" || c === "\r") {
                this.newline();
            } else {
                if (buf.x >= this.cols) {
                    this.newline();
                }
                const ch = c.charCodeAt(0);
                buf.buffer.drawChar(buf.x, buf.y, ch, buf.fgcolor, buf.bgcolor, this.charmap, this.textViewport);
                this.dirty = true;
                buf.x += 1;
            }
        }
    }

    private updateViewTransform() {
        const [x1, y1, x2, y2] = this.viewCoordinateBox ? this.viewCoordinateBox : [0, 0, this.width, this.height];
        let viewWidth;
        let viewHeight;
        let Ox = 0;
        let Oy = 0;
        if (this.relativeViewport) {
            Ox = this.graphicsViewport.left;
            Oy = this.viewCoordinateInverted ? this.graphicsViewport.bottom : this.graphicsViewport.top;
            viewWidth = this.graphicsViewport.right - this.graphicsViewport.left;
            viewHeight = this.graphicsViewport.bottom - this.graphicsViewport.top;
        } else {
            Oy = this.viewCoordinateInverted ? this.height : 0;
            viewWidth = this.width;
            viewHeight = this.height;
        }
        const coordWidth = Math.abs(x1 - x2);
        const coordHeight = Math.abs(y1 - y2);

        const Mneg = (this.viewCoordinateInverted ? -1 : 1);
        this.viewScalingX = viewWidth / coordWidth;
        this.viewScalingY = viewHeight / coordHeight * Mneg;
        this.viewTranslateX = (-Math.min(x1, x2)) / coordWidth * viewWidth + Ox;
        this.viewTranslateY = (-Math.min(y1, y2)) / coordHeight * viewHeight * Mneg + Oy;
    }

    private toScreenSpace(x, y): [number, number] {
        return [this.viewScalingX * x + this.viewTranslateX, this.viewScalingY * y + this.viewTranslateY];
    }

    private toScreenSpaceRounded(x, y): [number, number] {
        return [Math.round(this.viewScalingX * x + this.viewTranslateX), Math.round(this.viewScalingY * y + this.viewTranslateY)];
    }

    private abuf(): BufferState {
        return this.screenBuffers[this.activeBufferIndex];
    }
    protected vbuf(): BufferState {
        return this.screenBuffers[this.displayedBufferIndex];
    }
}
