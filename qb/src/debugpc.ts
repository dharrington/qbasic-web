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

// A virtual PC used for running QBasic programs without a real user interface. Primarily used for testing.
export class DebugPC implements vm.IVirtualPC {
    public textOutput: string = "";
    public echo: boolean;
    public inputResult: string[] = [];
    public graphicCalls: string[] = [];
    private nextInput = 0;
    print(text: string) {
        if (this.echo) console.log(text);
        this.textOutput += text;
    }
    input(complete: (text: string) => void) {
        if (this.nextInput >= this.inputResult.length) complete("");
        else complete(this.inputResult[this.nextInput++]);
    }
    setForeColor(fc: number) { }
    setBackColor(bc: number) { }
    pset(x: number, y: number, color?: number) {
        const colorStr = color !== undefined ? ` ${color}` : "";
        this.graphicCalls.push(`PSET ${x} ${y}${colorStr}`);
    }
    point(x: number, y: number): number {
        this.graphicCalls.push(`POINT ${x} ${y}`);
        return 0;
    }
    line(x1: number, y1: number, x2: number, y2: number, color: number | undefined, lineType: vm.LineType, style: number) {
        const colorStr = color !== undefined ? ` ${color}` : "";
        this.graphicCalls.push(`LINE ${x1} ${y1} ${x2} ${y2}${colorStr}`);
    }
    circle(x: number, y: number, radius: number, color: number | undefined) {
        const colorStr = color !== undefined ? `${color}` : "NA";
        this.graphicCalls.push(`CIRCLE ${x} ${y} ${radius} ${colorStr}`);
    }
    paint(x: number, y: number, paintColor: number | undefined, borderColor: number | undefined) {
        const paintColorStr = paintColor !== undefined ? `${paintColor}` : "NA";
        const borderColorStr = borderColor !== undefined ? `${borderColor}` : "NA";
        this.graphicCalls.push(`PAINT ${x} ${y} ${paintColorStr} ${borderColorStr}`);
    }
    draw(currentX: number, currentY: number, instructions: vm.DrawInstruction[]) {
        const text = instructions.map((inst) => {
            return [vm.DrawInstructionID[inst.id], inst.a, inst.b, inst.c, (inst.noDraw ? "nodraw" : "") + (inst.returnWhenDone ? "returnWhenDone" : "")].join(",");
        }).join("; ");
        this.graphicCalls.push(`DRAW ${text}`);
    }
    locate(x?: number, y?: number) { }
    screen(id: number) { }
    resetPalette() { }
    setPaletteAttribute(attr: number, color: number) { }
    sleep(delay: number, done) {
        done();
    }
    inkey(): string { return ""; }
    inkeyWait(n: number, callback: (result: string) => void) {
        callback("");
    }
    cls() { }
    getGraphics(x1: number, y1: number, x2: number, y2: number, maxBytes: number): Uint8Array | undefined {
        return undefined;
    }
    putGraphics(x: number, y: number, data: Uint8Array, actionVerb: string) {
    }
    screenLines(): number {
        return 25;
    }
    setViewPrint(top: number, bottom: number) { }
}
