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

import { GLScreenDraw } from "./gldraw";
import { BasicPC } from "../../qb/src/basicpc";
import { InputBuffer } from "./keyboard";

export class CanvasPC extends BasicPC {
    private canvas: HTMLCanvasElement;
    private screenDraw: GLScreenDraw | undefined;

    constructor(private canvasHolder: HTMLElement) {
        super(new InputBuffer());
        window.setInterval(() => this.refresh(), 100);
    }

    destroy() {
        super.destroy();
        if (this.canvas) this.canvas.remove();
    }

    dimsChanged() {
        if (this.canvas) {
            this.canvas.remove();
            this.screenDraw.destroy();
            this.screenDraw = undefined;
            this.canvas = undefined;
        }

        this.canvas = document.createElement("canvas");
        [this.canvas.width, this.canvas.height] = this.bestCanvasSize();
        this.canvasHolder.appendChild(this.canvas);
        this.screenDraw = new GLScreenDraw(this.canvas);
    }

    private bestCanvasSize(): number[] {
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
    private refresh() {
        if (this.canvas) {
            const [w, h] = this.bestCanvasSize();
            if (w !== this.canvas.width || h !== this.canvas.height) {
                [this.canvas.width, this.canvas.height] = this.bestCanvasSize();
            }
        }
        if (!this.dirty || !this.screenDraw) return;
        this.screenDraw.draw(this.vbuf().buffer, this.palette());
        this.dirty = false;
    }
}