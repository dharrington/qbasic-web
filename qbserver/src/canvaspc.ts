import * as vm from "../../qb/src/vm";
import * as chars from "./chars";
import { Buffer, Charmap, ScreenDraw } from "./screen";
import * as S from "./screen";

export function setup() {
    chars.setup();
}

class KeyboardMonitor {
    static charCode(e: KeyboardEvent): number {
        if (e.key.length === 1) {
            return e.key.charCodeAt(0);
        }
        return 0;
    }
    public keysDown = new Set<number>();
    public shiftKey: number = 0;
    public controlKey: number = 0;
    constructor() {
        const onup = (e) => {
            const code = KeyboardMonitor.charCode(e);
            this.keysDown.delete(code);
        };

        const ondown = (e) => {
            const code = KeyboardMonitor.charCode(e);
            this.keysDown.add(code);
        };
        window.addEventListener("keyup", onup);
        window.addEventListener("keydown", ondown);

        this.destroy = () => {
            window.removeEventListener("keyup", onup);
            window.removeEventListener("keydown", ondown);
        };
    }

    destroy() { }

    activeKey(): number {
        if (!this.keysDown.size) return 0;
        let code;
        for (code of this.keysDown.entries()) { }
        return code;
    }
}

const keyboard = new KeyboardMonitor();

class InputBuffer {
    public input: string = "";
    public inputChanged: (text: string, done: boolean) => void;
    public keyPressed: (key: string) => void;
    constructor() {
        const onkey = (e: KeyboardEvent) => {
            if (this.keyPressed) {
                this.keyPressed(e.key);
                e.preventDefault();
                return;
            }
            if (e.key.length === 1) {
                this.input += e.key;
                if (this.inputChanged) {
                    this.inputChanged(this.input, false);
                }
                e.preventDefault();
            }
        };
        const onkeydown = (e: KeyboardEvent) => {
            if (this.keyPressed) return;
            if (e.key === "Backspace" && this.input.length > 0) {
                this.input = this.input.substr(0, this.input.length - 1);
                if (this.inputChanged) {
                    this.inputChanged(this.input, false);
                }
                e.preventDefault();
            }
            if (e.key === "Enter") {
                if (this.inputChanged) {
                    this.inputChanged(this.input, true);
                } else {
                    this.input += "\n";
                }
                e.preventDefault();
            }
        };
        window.addEventListener("keypress", onkey);
        window.addEventListener("keydown", onkeydown);
        this.destroy = () => {
            window.removeEventListener("keypress", onkey);
            window.removeEventListener("keydown", onkeydown);
        };
    }
    nextKey(): string {
        if (this.input.length > 0) {
            const result = this.input.substr(0, 1);
            this.input = this.input.substr(1);
            return result;
        }
        return "";
    }
    destroy() { }
}

class BufferState {
    public x: number = 0;
    public y: number = 0;
    public bgcolor: number = 0;
    public fgcolor: number = 15;
    public printViewTop = 0;
    public printViewBottom = 24;
    constructor(public buffer: Buffer) { }
}

export class CanvasPC implements vm.IVirtualPC {
    public textOutput: string = "";
    private graphicsViewport: S.Viewport;
    // If true, graphics calls are relative to the graphics viewport top-left corner.
    private relativeViewport = false;
    private textViewport: S.Viewport;
    private width: number;
    private height: number;
    private rows: number;
    private cols: number;

    private s: ScreenDraw;
    private screenBuffers: BufferState[];
    private activeBufferIndex: number = 0;
    private charmap: Charmap;
    private dirty = true;
    private currentScreen: number = 0;
    private canvas: HTMLCanvasElement;
    private inputBuffer = new InputBuffer();
    private charHeight: number;

    constructor(private canvasHolder: HTMLElement) {
        this.currentScreen = -1;
        this.screen(0, undefined, undefined, undefined);
        this.charmap = chars.get8x16();
        this.charHeight = this.charmap.height;
        window.setInterval(() => this.refresh(), 100);
    }
    destroy() {
        this.inputBuffer.destroy();
        if (this.canvas) this.canvas.remove();
    }
    bestCanvasSize(): number[] {
        // Output is ugly if it's not a multiple. TODO: Do filtering in shader to fix this.
        const pw = this.canvasHolder.offsetWidth;
        const w = this.width;
        let mult = 1;
        for (let m = 2; m < 10; m++) {
            if (w * m <= pw) {
                mult = m;
            }
        }
        return [mult * w, mult * this.height];
    }
    refresh() {
        if (this.canvas) {
            const [w, h] = this.bestCanvasSize();
            if (w !== this.canvas.width || h !== this.canvas.height) {
                [this.canvas.width, this.canvas.height] = this.bestCanvasSize();
            }
        }
        if (!this.dirty || !this.s) return;
        this.s.draw();
        this.dirty = false;
    }
    newline() {
        this.abuf().x = 0;
        this.abuf().y += 1;
    }
    setDims(w: number, h: number, charWidth: number, charHeight: number, bufferCount: number) {
        this.charHeight = charHeight;
        this.width = w;
        this.height = h;
        this.cols = Math.trunc(w / charWidth);
        this.rows = Math.trunc(h / charHeight);
        if (this.canvas) {
            this.canvas.remove();
            this.s.free();
            this.s = null;
        }
        this.canvas = document.createElement("canvas");
        [this.canvas.width, this.canvas.height] = this.bestCanvasSize();
        this.canvasHolder.appendChild(this.canvas);
        this.s = new ScreenDraw(this.canvas, this.width, this.height);
        this.screenBuffers = [new BufferState(this.s.buffer)];
        this.activeBufferIndex = 0;
        for (let i = 1; i < bufferCount; i++) {
            this.screenBuffers.push(new BufferState(new Buffer(this.s.buffer.width, this.s.buffer.height)));
        }
        this.graphicsViewport = this.s.buffer.fullViewport.copy();
        this.textViewport = this.s.buffer.fullViewport.copy();
        this.abuf().printViewTop = 1;
        this.abuf().printViewBottom = this.rows;
    }
    cursor(show: boolean) { }
    locate(y?: number, x?: number) {
        const buf = this.abuf();
        buf.x = Math.max(0, Math.min(Math.floor(x), this.cols - 1));
        buf.y = Math.max(0, Math.min(Math.floor(y), this.rows - 1));
    }

    print(str: string) {
        const buf = this.abuf();
        this.cursor(false);
        for (const c of str) {
            if (buf.y >= buf.printViewBottom) {
                this.scroll();
            }
            if (c === "\t") {
                buf.x = Math.floor((buf.x + 14) / 14) * 14;
                if (buf.x >= this.cols) {
                    buf.x = 0;
                    this.newline();
                }
            } else if (c === "\n") {
                this.newline();
            } else {
                const ch = c.charCodeAt(0);
                buf.buffer.drawChar(buf.x, buf.y, ch, buf.fgcolor, buf.bgcolor, this.charmap, this.textViewport);
                this.dirty = true;
                buf.x += 1;
                if (buf.x === this.cols) {
                    this.newline();
                }
            }
        }
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
            this.print(text);
            prevText = text;
            if (done) {
                this.inputBuffer.inputChanged = null;
                this.inputBuffer.input = "";
                completed(text);
            }
        };
        this.inputBuffer.inputChanged = updatefn;
        updatefn(this.inputBuffer.input, false);
    }

    inkeyWait(n: number, callback: (result: string) => void) {
        let result = "";
        let count = 0;
        const updatefn = (text: string) => {
            result += text;
            count++;
            if (count === n) {
                this.inputBuffer.keyPressed = null;
                callback(result);
            }
        };
        this.inputBuffer.keyPressed = updatefn;
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
            this.s.setPalette(pal);
            this.dirty = true;
        }
    }
    setPaletteAttribute(attr: number, color: number) {
        const rgb = [color % 256, Math.trunc(color / 256) % 256, Math.trunc(color / 65536) % 256];
        this.s.setPaletteEntry(attr, rgb);
        this.dirty = true;
    }
    inkey(): string {
        return this.inputBuffer.nextKey();
    }
    pset(x: number, y: number, color?: number) {
        const buf = this.abuf();
        if (!color) {
            color = buf.fgcolor;
        }
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
        [this.graphicsViewport.left, this.graphicsViewport.top] = this.s.buffer.fullViewport.clamp(Math.min(x1, x2), Math.min(y1, y2));
        [this.graphicsViewport.right, this.graphicsViewport.bottom] = this.s.buffer.fullViewport.clamp(Math.max(x1, x2), Math.max(y1, y2));
        this.relativeViewport = relative;
    }
    screenLines(): number {
        return this.rows;
    }
    circle(x: number, y: number, radius: number, color: number | undefined, start: number, end: number, aspect: number) {
        const buf = this.abuf();
        if (this.relativeViewport) {
            x += this.graphicsViewport.left;
            y += this.graphicsViewport.top;
        }
        if (color === undefined) {
            color = buf.fgcolor;
        }
        buf.buffer.drawCircle(x, y, radius, color, start, end, aspect, this.graphicsViewport);
        this.dirty = true;
    }

    paint(x: number, y: number, paintColor: number | undefined, borderColor: number | undefined) {
        const buf = this.abuf();
        if (this.relativeViewport) {
            x += this.graphicsViewport.left;
            y += this.graphicsViewport.top;
        }
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
        if (this.relativeViewport) {
            x1 += this.graphicsViewport.left;
            y1 += this.graphicsViewport.top;
            x2 += this.graphicsViewport.left;
            y2 += this.graphicsViewport.top;
        }
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
        if (this.relativeViewport) {
            currentX += this.graphicsViewport.left;
            currentY += this.graphicsViewport.top;
        }
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
                    rotation = inst.a * (Math.PI / 2);
                    break;
                case vm.DrawInstructionID.kTurn: // a=angle
                    rotation = inst.a * (Math.PI / 180);
                    break;
                case vm.DrawInstructionID.kColor: // a=color
                    buf.fgcolor = inst.a;
                case vm.DrawInstructionID.kScale: // a=scale
                    scale = inst.a / 4.0;
                    break;
                case vm.DrawInstructionID.kPaint: // a=fill,b=border
                    // TODO
                    break;
            }
        }
    }
    bitsPerPixel(): number {
        const pal = S.kScreenPalettes.get(this.currentScreen);
        const colorsCount = pal.length;
        let bitsPerPixel = 1;
        while (1 << (bitsPerPixel) < colorsCount) {
            ++bitsPerPixel;
        }
        return bitsPerPixel;
    }
    getGraphics(x1: number, y1: number, x2: number, y2: number, maxBytes: number): Uint8Array | undefined {
        const buf = this.abuf();
        if (this.relativeViewport) {
            x1 += this.graphicsViewport.left;
            y1 += this.graphicsViewport.top;
            x2 += this.graphicsViewport.left;
            y2 += this.graphicsViewport.top;
        }
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
        if (this.relativeViewport) {
            x += this.graphicsViewport.left;
            y += this.graphicsViewport.top;
        }
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
            const [w, h] = S.kScreenDims.get(id);
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
                this.setDims(w, h, this.charmap.width, this.charmap.height, bufferCount);
                this.s.setPalette(S.kScreenPalettes.get(id));
                this.currentScreen = id;
            }
        }
        if (apage !== undefined && apage >= 0 && apage < this.screenBuffers.length) {
            this.activeBufferIndex = apage;
        }
        if (vpage !== undefined && vpage >= 0 && vpage < this.screenBuffers.length) {
            this.s.buffer = this.screenBuffers[vpage].buffer;
            this.dirty = true;
        }
        // TODO: colorswitch
    }
    sleep(delay: number, done) {
        window.setTimeout(() => {
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

    private abuf(): BufferState {
        return this.screenBuffers[this.activeBufferIndex];
    }
}
