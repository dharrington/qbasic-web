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

import * as vm from "../vm";
import { BasicPC, IInputBuffer } from "../basicpc";
import { Buffer, Palette } from "../screen";
import { PNG } from "pngjs";
import { createWriteStream } from "fs";

class InjectedInput {
    public line: string;
    public inkey: string;
}

function screenToPNG(buf: Buffer, pal: Palette) {
    let offset = 0;
    const p = new PNG({ colorType: 2, bitDepth: 8, inputHasAlpha: false, filterType: 4, width: buf.width, height: buf.height });
    for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
            const alias = buf.pget(x, y);
            [p.data[offset], p.data[offset + 1], p.data[offset + 2]] = pal.getEntry(alias);
            offset += 3;
        }
    }
    return p;
}

export class DebugInput implements IInputBuffer {
    private remainingInput: Array<InjectedInput> = [];
    addLine(line: string) {
        const input = new InjectedInput();
        input.line = line + '\r';
        this.remainingInput.push(input);
    }
    addInkey(code: string) {
        const input = new InjectedInput();
        input.inkey = code;
        this.remainingInput.push(input);
    }

    setInputEnabled(enabled: boolean) { }
    inkey(): string {
        if (this.remainingInput.length) {
            const input = this.remainingInput[0];
            if (input.line) {
                const key = input.line[0];
                if (input.line.length === 1) {
                    this.remainingInput.shift();
                } else {
                    input.line = input.line.substr(1);
                }
                return key;
            } else {
                input.inkey === '\r';
                const key = input.inkey;
                this.remainingInput.shift();
                return key;
            }
        }
        return "";
    }
    lineInput(onChanged: (text: string, done: boolean) => void) {
        while (this.remainingInput.length) {
            const input = this.remainingInput[0];
            if (input.line) {
                this.remainingInput.shift();
                onChanged(input.line + '\r', true);
                return;
            } else {
                const done = input.inkey === '\r';
                if (done) {
                    this.remainingInput.shift();
                }
                onChanged(input.inkey, done);
                if (done) return;
            }
        }
        throw new Error("input exhausted");
    }
    inkeyWait(chars: number, done: (result: string) => void) {
        let result = '';
        while (!this.isEmpty()) {
            const key = this.inkey();
            if (key != '') {
                result += key;
                chars--;
                if (chars === 0) {
                    done(result);
                    return;
                }
            }
        }
        throw new Error("input exhausted");
    }
    destroy() { }

    private isEmpty() { return this.remainingInput.length === 0; }
}

// A virtual PC used for running QBasic programs without a real user interface. Primarily used for testing.
export class DebugPC extends BasicPC {
    public textOutput: string;
    public echo: boolean;
    public inputResult: string[];
    public graphicCalls: string[];
    public debugInput: DebugInput;
    private nextInput;
    constructor() {
        const debugInput = new DebugInput();
        super(debugInput);
        this.debugInput = debugInput;
        this.nextInput = 0;
        this.inputResult = [];
        this.graphicCalls = [];
        this.textOutput = "";
    }
    print(text: string) {
        super.print(text);
        if (this.echo) console.log(text);
        this.textOutput += text;
    }
    printNewline() {
        super.printNewline();
        if (this.echo) console.log("\n");
        this.textOutput += "\n";
    }
    pset(x: number, y: number, color?: number) {
        const colorStr = color !== undefined ? ` ${color}` : "";
        this.graphicCalls.push(`PSET ${x} ${y}${colorStr}`);
        super.pset(x, y, color);
    }
    point(x: number, y: number): number {
        this.graphicCalls.push(`POINT ${x} ${y}`);
        return super.point(x, y);
    }
    line(x1: number, y1: number, x2: number, y2: number, color: number | undefined, lineType: vm.LineType, style: number) {
        const colorStr = color !== undefined ? ` ${color}` : "";
        this.graphicCalls.push(`LINE ${x1} ${y1} ${x2} ${y2}${colorStr}`);
        super.line(x1, y1, x2, y2, color, lineType, style);
    }
    circle(x: number, y: number, radius: number, color: number | undefined, start: number, end: number, aspect: number) {
        const colorStr = color !== undefined ? `${color}` : "NA";
        this.graphicCalls.push(`CIRCLE ${x} ${y} ${radius} ${colorStr}`);
        super.circle(x, y, radius, color, start, end, aspect);
    }
    paint(x: number, y: number, paintColor: number | undefined, borderColor: number | undefined) {
        const paintColorStr = paintColor !== undefined ? `${paintColor}` : "NA";
        const borderColorStr = borderColor !== undefined ? `${borderColor}` : "NA";
        this.graphicCalls.push(`PAINT ${x} ${y} ${paintColorStr} ${borderColorStr}`);
        super.paint(x, y, paintColor, borderColor);
    }
    draw(currentX: number, currentY: number, instructions: vm.DrawInstruction[]) {
        const text = instructions.map((inst) => {
            return [vm.DrawInstructionID[inst.id], inst.a, inst.b, inst.c, (inst.noDraw ? "nodraw" : "") + (inst.returnWhenDone ? "returnWhenDone" : "")].join(",");
        }).join("; ");
        this.graphicCalls.push(`DRAW ${text}`);
        super.draw(currentX, currentY, instructions);
    }

    async saveScreenshot(fileName: string) {
        const p = new Promise((notify) => {
            const png = screenToPNG(this.vbuf().buffer, this.palette());
            png.pack().pipe(createWriteStream(fileName)).on("finish", () => {
                notify();
            });
        });
        return p;
    }
}
