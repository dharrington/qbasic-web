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

import { IInputBuffer } from "./canvaspc";

export function eventToInkey(event: KeyboardEvent): string | undefined {
    const code = event.which;
    const key = event.key;
    // From https://qb64.org/wiki/Keyboard_scancodes
    if (event.ctrlKey) {
        if (code >= 65 && code <= 90) {
            return String.fromCodePoint(code - 65 + 1);
        }
    }
    if (event.altKey) {
        if (code >= 65 && code <= 90) {
            return String.fromCodePoint(code - 65 + 30);
        }
    }
    if (code >= 112 && code <= 123) return String.fromCodePoint(0, code - 112 + 59);
    if (code >= 97 && code <= 105) return String.fromCodePoint(code - 97 + 49);
    switch (code) {
        case 45: return String.fromCodePoint(0, 82);
        case 36: return String.fromCodePoint(0, 71);
        case 33: return String.fromCodePoint(0, 73);
        case 46: return String.fromCodePoint(0, 83);
        case 35: return String.fromCodePoint(0, 79);
        case 34: return String.fromCodePoint(0, 81);
        case 37: return String.fromCodePoint(0, 75);
        case 40: return String.fromCodePoint(0, 80);
        case 39: return String.fromCodePoint(0, 77);
        case 38: return String.fromCodePoint(0, 72);
        case 13: case 27: return String.fromCodePoint(code);
    }
    if (event.key.length === 1) return event.key;
    return undefined;
}

export class InputBuffer implements IInputBuffer {
    public input: string = "";
    private inputChanged?: (text: string, done: boolean) => void;

    private inputDone?: (text: string) => void;
    private inputNumberOfChars: number = 0;

    private keyBuffer: KeyboardEvent[] = [];
    private inputEnabled: boolean = false;
    private removeInput: () => void;

    constructor() {
        this.setInputEnabled(true);
    }

    public setInputEnabled(enabled: boolean) {
        if (this.inputEnabled === enabled) return;
        this.inputEnabled = enabled;
        if (enabled) {
            const onkeydown = (e: KeyboardEvent) => {
                if (this.keyBuffer.length > 10) return;
                e.preventDefault();
                if (this.keyBuffer.length > 0 || !this.processEvent(e)) {
                    this.keyBuffer.push(e);
                }
            };
            window.addEventListener("keydown", onkeydown);
            this.removeInput = () => {
                window.removeEventListener("keydown", onkeydown);
            };
        } else {
            this.removeInput();
            this.removeInput = undefined;
        }
    }

    public inkey(): string {
        while (true) {
            const e = this.nextEvent();
            if (!e) return "";
            const inkey = eventToInkey(e);
            if (inkey !== undefined) return inkey;
        }
    }
    public lineInput(onChanged: (text: string, done: boolean) => void) {
        this.input = "";
        this.inputChanged = onChanged;
        this.processEvents();
    }
    public inkeyWait(chars: number, done: (result: string) => void) {
        this.input = "";
        this.inputDone = done;
        this.processEvents();
    }
    public destroy() {
        this.setInputEnabled(false);
    }

    private nextEvent(): KeyboardEvent | undefined {
        if (!this.keyBuffer.length) return undefined;
        return this.keyBuffer.shift();
    }
    private processInput(e: KeyboardEvent) {
        const inkey = eventToInkey(e);
        if (inkey === undefined) return;
        if (inkey.length === 1) this.input += inkey;
        else this.input += String.fromCodePoint(0);
    }
    private processLineInput(e: KeyboardEvent) {
        // TODO: Incomplete. Should handle cursor, arrow left,right, insert, delete, even certain control characters.
        if (e.key.length === 1) {
            this.input += e.key;
            this.inputChanged(this.input, false);
            return;
        }
        if (e.key === "Backspace" && this.input.length > 0) {
            this.input = this.input.substr(0, this.input.length - 1);
            this.inputChanged(this.input, false);
            return;
        }
        if (e.key === "Enter") {
            const input = this.input;
            this.input = "";
            const cb = this.inputChanged;
            this.inputChanged = undefined;
            cb(input, true);
            return;
        }
    }
    private processEvents() {
        while (this.keyBuffer.length) {
            if (!this.inputChanged && !this.inputDone) return;
            this.processEvent(this.keyBuffer.shift());
        }
    }
    private processEvent(e: KeyboardEvent) {
        if (this.inputChanged) {
            this.processLineInput(e);
            return true;
        }
        if (this.inputDone) {
            this.processInput(e);
            if (this.input.length >= this.inputNumberOfChars) {
                const result = this.input;
                this.input = "";
                const done = this.inputDone;
                this.inputDone = undefined;
                done(result);
            }
            return true;
        }
        return false;
    }
}
