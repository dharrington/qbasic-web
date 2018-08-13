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
    pset(x: number, y: number, color?: number) { }
    line(x1: number, y1: number, x2: number, y2: number, color?: number) { }
    locate(x?: number, y?: number) { }
    screen(id: number) { }
    resetPalette() { }
    setPaletteAttribute(attr: number, color: number) { }
    sleep(delay: number, done) {
        done();
    }
    inkey(): string { return ""; }
    cls() { }
}
