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

// vm.ts implements the virtual machine that runs programs.

import { AssertionError } from "assert";
import { BaseType, baseTypeToSigil, kDoubleType, kIntType, kLongType, kSingleType, kStringType, Type } from "./types";

export const kGlobalBit = 0x80000000;
export function globalAddr(offset: number): number {
    return offset | kGlobalBit;
}
export function globalAddrToOffset(addr: number): number {
    return addr ^ kGlobalBit;
}
export enum LineType {
    kLine,
    kBox,
    kFilledBox,
}
export enum GraphicsAction {
    kPset, kPreset, kAnd, kOr, kXor,
}

// The virtual computer on which the VM executes.
export interface IVirtualPC {
    print(text: string);
    input(completed: (text: string) => void);
    inkeyWait(n: number, callback: (result: string) => void);
    setForeColor(fc: number);
    foreColor(): number;
    setBackColor(bc: number);
    backColor(): number;
    line(x1: number, y1: number, x2: number, y2: number, color: number | undefined, lineType: LineType, style: number);
    circle(x: number, y: number, radius: number, color: number | undefined, start: number, end: number, aspect: number);
    paint(x: number, y: number, paintColor: number | undefined, borderColor: number | undefined);
    pset(x: number, y: number, color?: number);
    point(x: number, y: number): number;
    draw(currentX: number, currentY: number, instructions: DrawInstruction[]);
    getGraphics(x1: number, y1: number, x2: number, y2: number, maxBytes: number): Uint8Array | undefined;
    putGraphics(x: number, y: number, data: Uint8Array, actionVerb: GraphicsAction);
    locate(x?: number, y?: number);
    screen(id: number | undefined, colorswitch: number | undefined, apage: number | undefined, vpage: number | undefined);
    screenLines(): number;
    setViewPrint(top: number, bottom: number);
    setView(x1: number, y1: number, x2: number, y2: number, relative: boolean);
    resetPalette();
    setPaletteAttribute(attr: number, color: number);
    sleep(delay: number, done);
    inkey(): string;
    cls();
    clsGraphics();
    clsText();
}

export enum DrawInstructionID {
    kMove, // a=direction. 0=up, 1=upright ...; b=distance
    kMoveXY, // a=x, b=y
    kRotation, // a=angle*90
    kTurn, // a=angle
    kColor, // a=color
    kScale, // a=scale
    kPaint, // a=fill,b=border
}
export class DrawInstruction {
    public noDraw?: boolean;
    public returnWhenDone?: boolean;
    public id: DrawInstructionID;
    public a?: number;
    public b?: number;
    public c?: number;

    getPosition(oldX: number, oldY: number, rotation: number, scale: number): number[] {
        const rotateScaleAdd = (dx, dy): number[] => {
            const [c, s] = [Math.cos(rotation), Math.sin(rotation)];
            return [oldX + scale * (dx * c - dy * s), oldY + scale * (dx * s + dy * c)];
        };

        if (this.id === DrawInstructionID.kMoveXY) {
            if (this.c) {
                const [dx, dy] = [(this.a as number), (this.b as number)];
                return rotateScaleAdd(dx, dy);
            }
            return [this.a as number, this.b as number];
        }
        if (this.id === DrawInstructionID.kMove) {
            const b = this.b as number;
            switch (this.a) {
                case 0: return rotateScaleAdd(0, -b);
                case 1: return rotateScaleAdd(b, -b);
                case 2: return rotateScaleAdd(b, 0);
                case 3: return rotateScaleAdd(b, b);
                case 4: return rotateScaleAdd(0, b);
                case 5: return rotateScaleAdd(-b, b);
                case 6: return rotateScaleAdd(-b, 0);
                case 7: return rotateScaleAdd(-b, -b);
            }
            throw new AssertionError({ message: "invalid draw instruction" });
        }
        throw new AssertionError();
    }
}
function parseDrawCommand(cmd: string): DrawInstruction[] | undefined {
    const result: DrawInstruction[] = [];
    let i = 0;
    let inst = new DrawInstruction();
    const eatSpace = () => {
        while (i < cmd.length && cmd[i] === " ") {
            ++i;
        }
    };
    const readNum = (): number | undefined => {
        eatSpace();
        const m = /[+-]?\d+/.exec(cmd.slice(i));
        if (!m) return undefined;
        i += m[0].length;
        return parseInt(m[0], 10) as number;
    };
    while (i < cmd.length) {
        switch (cmd[i]) {
            case "B":
                inst.noDraw = true;
                i++;
                break;
            case "N":
                inst.returnWhenDone = true;
                i++;
                break;
            case "U": case "D": case "L": case "R": case "E": case "F": case "G": case "H":
                inst.id = DrawInstructionID.kMove;
                inst.a = "UERFDGLH".indexOf(cmd[i++]);
                inst.b = readNum();
                if (inst.b === undefined) return undefined;
                result.push(inst);
                inst = new DrawInstruction();
                break;
            case "M":
                i++;
                inst.id = DrawInstructionID.kMoveXY;
                eatSpace();
                if (cmd[i] === "+" || cmd[i] === "-") {
                    inst.c = 1;
                }
                inst.a = readNum();
                eatSpace();
                if (cmd[i++] !== ",") return undefined;
                inst.b = readNum();
                if (inst.a === undefined || inst.b === undefined) return undefined;
                result.push(inst);
                inst = new DrawInstruction();
                break;
            case "A":
                i++;
                inst.id = DrawInstructionID.kRotation;
                inst.a = readNum();
                if (inst.a === undefined) return undefined;
                result.push(inst);
                inst = new DrawInstruction();
                break;
            case "T":
                i++;
                inst.id = DrawInstructionID.kTurn;
                if (cmd[i++] !== "A") return undefined;
                inst.a = readNum();
                if (inst.a === undefined) return undefined;
                result.push(inst);
                inst = new DrawInstruction();
                break;
            case "C":
                i++;
                inst.id = DrawInstructionID.kColor;
                inst.a = readNum();
                result.push(inst);
                inst = new DrawInstruction();
                break;
            case "S":
                i++;
                inst.id = DrawInstructionID.kScale;
                inst.a = readNum();
                result.push(inst);
                inst = new DrawInstruction();
                break;
            case "P":
                i++;
                inst.id = DrawInstructionID.kPaint;
                inst.a = readNum();
                eatSpace();
                if (cmd[i++] !== ",") return undefined;
                inst.b = readNum();
                result.push(inst);
                inst = new DrawInstruction();
                break;
            case " ":
                i++;
                break;
            default:
                return undefined;
            // TODO: X and =.
        }
    }
    return result;
}

export class NullPC implements IVirtualPC {
    print(text: string) {
        throw new Error("not implemented");
    }
    input(completed: (text: string) => void) {
        throw new Error("not implemented");
    }
    setForeColor(fc: number) {
        throw new Error("not implemented");
    }
    foreColor() { throw new Error("not implemented"); return 0; }
    setBackColor(bc: number) {
        throw new Error("not implemented");
    }
    backColor() { throw new Error("not implemented"); return 0; }
    line(x1: number, y1: number, x2: number, y2: number, color: number | undefined, lineType: LineType, style: number) {
        throw new Error("not implemented");
    }
    circle(x: number, y: number, radius: number, color: number | undefined) {
        throw new Error("not implemented");
    }
    paint(x: number, y: number, paintColor: number | undefined, borderColor: number | undefined) {
        throw new Error("not implemented");
    }
    draw(currentX: number, currentY: number, instructions: DrawInstruction[]) {
        throw new Error("not implemented");
    }
    pset(x: number, y: number, color?: number) {
        throw new Error("not implemented");
    }
    point(x: number, y: number): number {
        throw new Error("not implemented");
    }
    locate(x?: number, y?: number) {
        throw new Error("not implemented");
    }
    screen() {
        throw new Error("not implemented");
    }
    resetPalette() {
        throw new Error("not implemented");
    }
    setPaletteAttribute(attr: number, color: number) {
        throw new Error("not implemented");
    }
    sleep(delay: number, done) {
        throw new Error("not implemented");
    }
    inkey(): string {
        throw new Error("not implemented");
    }
    inkeyWait(n: number, callback: (result: string) => void) {
        throw new Error("not implemented");
    }
    cls() {
        throw new Error("not implemented");
    }
    clsGraphics() { throw new Error("not implemented"); }
    clsText() { throw new Error("not implemented"); }
    getGraphics(x1: number, y1: number, x2: number, y2: number, maxBytes: number): Uint8Array | undefined {
        return undefined;
    }
    putGraphics(x: number, y: number, data: Uint8Array, actionVerb: GraphicsAction) { }
    screenLines(): number {
        throw new Error("not implemented");
    }
    setViewPrint(top: number, bottom: number) {
        throw new Error("not implemented");
    }
    setView() { throw new Error("not implemented"); }

}

function convertNumber(n: number, baseType: BaseType): number | string {
    switch (baseType) {
        case BaseType.kString:
            return "" + n;
            break;
        case BaseType.kInt:
            return toInt(n);
            break;
        case BaseType.kLongInt:
            return toLong(n);
            break;
        case BaseType.kSingle:
            return Math.fround(n);
            break;
        case BaseType.kDouble:
            return n;
            break;
    }
    return n;
}

export enum InstructionID {
    // Annotation:
    // S = stack index (number)
    //     Non-negative stack indices reference the stack. The stack is just a buffer of VariableValue values.
    //     The stack grows upon access if necessary.
    //     Negative stack indices reference the program's constant data.
    // V = VariableValue
    // PC = Program Counter
    // name = variable name (string)
    // pos = array index: array of stack index (number[])
    // For instructions that write to a stack value, the output is the first parameter.
    ADDRESS, // S S
    INPUT, // InputSpec
    LINE_INPUT, // S S S
    INPUT_FUNC, // S S
    TO_INT, // S S
    TO_LONG, // S S
    TO_SINGLE, // S S
    TO_DOUBLE, // S S
    BRANCH_IFNOT, // PC S
    BRANCH, // PC
    CALL_SUB, // PC stack-size [S...]
    GOSUB, // PC stack-size
    CALL_FUNCTION, // PC stack-size S string[]
    EXIT_SUB, // <no parameters>
    RETURN, // PC
    DECLARE, // S V
    DECLARE_REDIM, // S V S...
    LOAD, // S S [index] [fieldIndex]
    ASSIGN, // S S [index] [fieldIndex]
    COPY, // S S
    ADD, // S S S
    SUB, // S S S
    NEG, // S S S
    MUL, // S S S
    DIV, // S S S
    POW, // S S S
    IDIV, // S S S
    MOD, // S S S
    EQ, // S S S
    NEQ, // S S S
    GTE, // S S S
    LTE, // S S S
    LT, // S S S
    GT, // S S S
    OR, // S S S
    AND, // S S S
    XOR, // S S S
    NOT, // S S
    LOGICNOT, // S S
    PRINT, // S
    LOCATE, // S|undefined [ S|undefined ]
    ABS, // S S
    MID, // S S S [ S ]
    PEEK, // S S
    RIGHT, // S S S
    LEFT, // S S S
    CHR, // S S
    ASC, // S S
    RND, // S [ S ]
    INT, // S S
    FIX, // S S
    END, // <no parameters>
    COLOR, // S S
    PALETTE, // [ S S ]
    GET_DRAW_POS, // S S
    LINE, // S S S S [S [OptionString [StyleString]]]
    CIRCLE, // S S S S
    PAINT, // S S S S
    DRAW, // S
    GET_GRAPHICS, // S S S S S
    PUT_GRAPHICS, // S S S ActionVerb
    PSET, // S S [ S ]
    PRESET, // S S
    POINT, // S S S
    CURRENT_POINT, // S S
    CLS, // S
    SCREEN, // S
    SLEEP, // S
    INKEY, // S
    VAL, // S S
    STR, // S S
    TAN, // S S
    SIN, // S S
    LOG, // S S
    COS, // S S
    ATN, // S S
    CINT, // S S
    CLNG, // S S
    CDBL, // S S
    CSNG, // S S
    EXP, // S S
    TIMER, // S
    RANDOMIZE, // S
    READ, // S BaseType
    RESTORE, // DP
    LEN, // S S
    LTRIM, // S S
    RTRIM, // S S
    LCASE, // S S
    UCASE, // S S
    INSTR, // S S S
    SPACE, // S S
    DEBUGLOG, // S
    ON_ERROR_GOTO, // PC
    RESUME,
    RESUME_NEXT,
    RESUME_GOTO,
    VIEW, // <screen-bool> S S S S S S
    VIEW_PRINT, // S S
    STRING, // S S
    NOP,
}

// These instructions produce constant output given constant inputs.
export const ConstExprInstructions = new Set([
    InstructionID.TO_INT, InstructionID.TO_LONG, InstructionID.TO_SINGLE, InstructionID.TO_DOUBLE,
    InstructionID.ASSIGN, InstructionID.COPY,
    InstructionID.ADD, InstructionID.SUB, InstructionID.NEG, InstructionID.MUL,
    InstructionID.DIV, InstructionID.POW, InstructionID.IDIV, InstructionID.MOD, InstructionID.EQ,
    InstructionID.NEQ, InstructionID.GTE, InstructionID.LTE, InstructionID.LT,
    InstructionID.GT, InstructionID.OR, InstructionID.AND, InstructionID.XOR,
    InstructionID.NOT, InstructionID.LOGICNOT, InstructionID.ABS, InstructionID.MID,
    InstructionID.RIGHT, InstructionID.LEFT, InstructionID.CHR, InstructionID.ASC,
    InstructionID.INT, InstructionID.FIX, InstructionID.STR, InstructionID.TAN,
    InstructionID.SIN, InstructionID.LOG, InstructionID.COS, InstructionID.ATN, InstructionID.CINT,
    InstructionID.CLNG, InstructionID.CDBL, InstructionID.CSNG, InstructionID.EXP,
]);

export const BranchInstructions = new Set([InstructionID.BRANCH_IFNOT, InstructionID.BRANCH, InstructionID.CALL_SUB,
InstructionID.GOSUB, InstructionID.CALL_FUNCTION, InstructionID.RETURN, InstructionID.ON_ERROR_GOTO, InstructionID.RESUME_GOTO]);

const kIntMax = 32767;
const kIntMin = -32768;
const kLongMax = 2147483647;
const kLongMin = -2147483648;

// Structures for the INPUT instruction.
export class SingleInput {
    constructor(public type: BaseType, public stackOffset: number) { }
}
export class InputSpec {
    constructor(public keepCursor: boolean, public prompt: string, public inputs: SingleInput[]) { }

    parseInput(text: string): VariableValue[] | undefined {
        const result: VariableValue[] = [];
        let first = true;
        for (const input of this.inputs) {
            text = text.trim();
            if (!first) {
                if (text[0] !== ",") {
                    return undefined;
                }
                text = text.substr(1).trim();
            }
            first = false;
            switch (input.type) {
                case BaseType.kString: {
                    const m = /[^,]*/.exec(text);
                    if (!m) return undefined;
                    result.push(VariableValue.single(kStringType, m[0]));
                    text = text.substr(m[0].length);
                    break;
                }
                case BaseType.kInt: {
                    const m = /[+-]?[0-9]*/.exec(text);
                    if (!m) return undefined;
                    const i = parseInt(m[0], 10);
                    if (i > kIntMax || i < kIntMin) return undefined;
                    result.push(VariableValue.newInt(i));
                    text = text.substr(m[0].length);
                    break;
                }
                case BaseType.kLongInt: {
                    const m = /[+-]?[0-9]*/.exec(text);
                    if (!m) return undefined;
                    const i = parseInt(m[0], 10);
                    if (i > kLongMax || i < kLongMin) return undefined;
                    result.push(VariableValue.newLong(i));
                    text = text.substr(m[0].length);
                    break;
                }
                case BaseType.kSingle: {
                    const m = /^[+-]?([0-9]+([.][0-9]*([EeDd][+-][0-9]+)?)?)|(\.[0-9]+([EeDd][+-][0-9]+)?)/.exec(text);
                    if (!m) return undefined;
                    const i = parseFloat(m[0]);
                    result.push(VariableValue.single(kSingleType, i));
                    text = text.substr(m[0].length);
                    break;
                }
                case BaseType.kDouble: {
                    const m = /^[+-]?([0-9]+([.][0-9]*([EeDd][+-][0-9]+)?)?)|(\.[0-9]+([EeDd][+-][0-9]+)?)/.exec(text);
                    if (!m) return undefined;
                    const i = parseFloat(m[0]);
                    result.push(VariableValue.single(kDoubleType, i));
                    text = text.substr(m[0].length);
                    break;
                }
            }
        }
        if (text.trim() !== "") {
            return undefined;
        }
        return result;
    }
}

export function zeroValue(ty: Type): any {
    switch (ty.type) {
        case BaseType.kString: return "";
        case BaseType.kInt:
        case BaseType.kLongInt:
        case BaseType.kSingle:
        case BaseType.kDouble: return 0;
        case BaseType.kUserType: return [];
    }
    return null;
}

class IndexOutOfRange { }
class InternalError { }
type UserTypeValue = any[];
type RawValue = number | string | UserTypeValue | undefined;

// A variable value as understood by vm.
// This can represent temporary values as well as named variables (including arrays).
// In QBasic, the variable X can contain both a single value denoted by 'X', and an array
// denoted by X(). The VM considers both 'single' and 'array' values to be part of the same variable, although
// it may be better to separate the two in the future.
export class VariableValue {
    // Create a single (non-array) value.
    static single(type: Type, val: RawValue) {
        const v = new VariableValue(type);
        v.val = val;
        return v;
    }
    static newDouble(val: number): VariableValue {
        return VariableValue.single(kDoubleType, val);
    }
    static newString(val: string): VariableValue {
        return VariableValue.single(kStringType, val);
    }
    static newInt(val: number): VariableValue {
        return VariableValue.single(kIntType, val);
    }
    static newLong(val: number): VariableValue {
        return VariableValue.single(kLongType, val);
    }
    private static valToType(val: RawValue, type: Type) {
        // TODO: Maybe move this work over to codegen so that inputs here are guaranteed to be the right type.
        if (type === kIntType) {
            return toInt(val as number);
        } else if (type === kLongType) {
            return toLong(val as number);
        } else if (type === kSingleType) {
            return Math.fround(val as number);
        }
        return val;
    }
    private static fieldType(type: Type, fieldIndex: number[]): Type {
        let t = type;
        for (let i = 0; i < fieldIndex.length - 1; i++) {
            const idx = fieldIndex[i];
            t = t.fields[idx].type;
        }
        return t.fields[fieldIndex[fieldIndex.length - 1]].type;
    }
    // Even arrays in basic have an additional non-array value of the same type.
    public val: RawValue;
    public dims?: number[];
    public arrayVals?: any[];
    constructor(public type: Type) { }
    toString(): string {
        const dimStr = this.dims ? "(" + this.dims.map((x) => "" + x).join(", ") + ")" : "";
        return `'${this.val}' ${this.type} ${dimStr}`;
    }
    anyval(): any { return this.val; }
    numVal(): number { return this.val as number; }
    strVal(): string { return this.val as string; }
    toShortString(): string {
        const dimStr = this.dims ? "(" + this.dims.map((x) => "" + x).join(", ") + ")" : "";
        let typeStr = "";
        if (this.type.isNumeric()) {
            typeStr = baseTypeToSigil(this.type.type);
        } else if (!this.type.isString()) {
            typeStr = this.type.toString();
        } else {
            return `'${(this.val as string).replace(/\n/, "\\n")}'${dimStr}`;
        }
        return `${this.val}${typeStr}${dimStr}`;
    }
    // Linearize a multidimensional index.
    indexOffset(index: number[]): number | IndexOutOfRange {
        const dims = this.dims || [10];
        // Array values are initialized lazily...
        let offset = 0;
        for (let i = 0; i < index.length; i++) {
            if (index[i] > dims[i]) {
                return new IndexOutOfRange();
            }
            offset *= 1 + dims[i];
            offset += index[i];
        }
        return offset;
    }
    valAtIndex(index?: number[], fieldIndex?: number[]): VariableValue | IndexOutOfRange {
        // Array values are initialized lazily...
        if (!index) {
            if (fieldIndex) {
                return this.getField(this.val as RawValue[], fieldIndex);
            } else {
                return new IndexOutOfRange();
            }
        }
        const offset = this.indexOffset(index);
        if (offset instanceof IndexOutOfRange) return offset;
        if (!this.arrayVals || offset >= this.arrayVals.length) {
            const lhs = zeroValue(this.type);
            if (fieldIndex) return this.getField(lhs as RawValue[], fieldIndex);
            return VariableValue.single(this.type, lhs);
        }
        if (fieldIndex) return this.getField(this.arrayVals[offset] as RawValue[], fieldIndex);
        return VariableValue.single(this.type, this.arrayVals[offset]);
    }
    setVal(val: RawValue, index?: number[], fieldIndex?: number[]) {
        if (!index) {
            if (fieldIndex) this.setField(this.val as RawValue[], val, fieldIndex);
            else this.val = VariableValue.valToType(val, this.type);
        } else {
            const offset = this.indexOffset(index);
            if (offset instanceof IndexOutOfRange) return offset;
            if (!this.arrayVals) this.arrayVals = [];
            while (offset >= this.arrayVals.length) {
                this.arrayVals.push(zeroValue(this.type));
            }
            if (fieldIndex) this.setField(this.arrayVals[offset], val, fieldIndex);
            else this.arrayVals[offset] = VariableValue.valToType(val, this.type);
        }
    }

    isZero(): boolean {
        return !this.val; // should only be called for numeric types.
    }
    copySingle(): VariableValue {
        return VariableValue.single(this.type, this.val);
    }
    copyDecl(): VariableValue {
        const clone = new VariableValue(this.type);
        clone.val = this.val;
        if (this.dims !== undefined) clone.dims = this.dims;
        return clone;
    }
    getNumber(): number {
        return this.val as number;
    }
    getString(): string {
        return this.val as string;
    }
    private getField(lhs: RawValue[], fieldIndex: number[]): VariableValue {
        let t = this.type;
        for (let i = 0; i < fieldIndex.length; i++) {
            const idx = fieldIndex[i];
            if (lhs.length <= idx) {
                break;
            }
            if (i === fieldIndex.length - 1) {
                return VariableValue.single(t.fields[idx].type, lhs[idx]);
            } else {
                t = t.fields[idx].type;
                lhs = lhs[idx] as RawValue[];
            }
        }
        const ft = VariableValue.fieldType(this.type, fieldIndex);
        return VariableValue.single(ft, zeroValue(ft));
    }
    private setField(lhs: RawValue[], val: RawValue, fieldIndex: number[]) {
        let t = this.type;
        for (let i = 0; i < fieldIndex.length; i++) {
            const idx = fieldIndex[i];
            while (lhs.length <= idx) {
                lhs.push(zeroValue(t.fields[lhs.length].type));
            }
            if (i === fieldIndex.length - 1) {
                lhs[idx] = VariableValue.valToType(val, t.fields[idx].type);
            } else {
                t = t.fields[idx].type;
                lhs = lhs[idx] as RawValue[];
            }
        }
    }
}

function roundOrUndefined(v: VariableValue | undefined) {
    if (v === undefined) return undefined;
    return Math.round(v.numVal());
}

// Instructions are comprised of an InstructionID and an array of arguments whose type is determined by the
// InstructionID.
export class Instruction {
    static argString(val: any): string {
        if (val instanceof VariableValue) return val.toString();
        return "" + val;
    }
    static parameterTypeFromList(offset: number, list: string[], otherwise: string = ""): string {
        if (offset < list.length) {
            return list[offset];
        }
        return otherwise;
    }
    constructor(public id: InstructionID, public args: any[]) { }
    toString(prog: Program): string {
        return `${InstructionID[this.id]} ${this.args.map((x, idx) => prog.instructionArgToString(this, x, idx)).join(", ")}`;
    }
    parameterType(offset: number): string {
        switch (this.id) {
            case InstructionID.ASSIGN:  // S S [index] [fieldIndex]
            case InstructionID.LOAD: // S S [index] [fieldIndex]
                if (offset === 0) return "S";
                if (offset === 1) return "S";
                if (offset === 2) return "index";
                return "fieldIndex";
            case InstructionID.INPUT:  // InputSpec
                return "InputSpec";
            case InstructionID.BRANCH_IFNOT:  // PC S
                if (offset === 0) return "PC";
                return "S";
            case InstructionID.CALL_SUB:  // PC stack-size
                if (offset === 0) return "PC";
                if (offset === 1) return "stacksize";
                return "S";
            case InstructionID.GOSUB:  // PC stack-size
                if (offset === 0) return "PC";
                return "stacksize";
            case InstructionID.CALL_FUNCTION:  // PC stack-size S string[]
                if (offset === 0) return "PC";
                if (offset === 1) return "stacksize";
                if (offset === 2) return "S";
                return "argnames";
            case InstructionID.EXIT_SUB:  // <no parameters>
                return "";
            case InstructionID.RETURN:  // PC
            case InstructionID.ON_ERROR_GOTO: // PC
            case InstructionID.RESUME_GOTO:
            case InstructionID.BRANCH:  // PC
                return "PC";
            case InstructionID.READ:  // S BaseType
                if (offset === 0) return "S";
                return "baseType";
            case InstructionID.RESTORE:  // DP
                return "DP";
            case InstructionID.LINE:  // S S S S [S [OptionString [StyleString]]]
                if (offset <= 4) return "S";
                if (offset === 5) return "option";
                return "style";
            case InstructionID.DECLARE:  // S V
                if (offset === 0) return "S";
                return "V";
            case InstructionID.DECLARE_REDIM: // S V S...
                if (offset === 1) return "V";
                return "S";
            case InstructionID.PUT_GRAPHICS: // S S S ActionVerb
                if (offset < 3) return "S";
                return "ActionVerb";
            case InstructionID.VIEW:
                if (offset === 0) return "screen";
                return "S";
            case InstructionID.VIEW_PRINT: // S S
            case InstructionID.STRING: // S S
            case InstructionID.COPY: // S S
            case InstructionID.CIRCLE: // S S S S S? S? S?
            case InstructionID.PAINT: // S S S S
            case InstructionID.DRAW: // S
            case InstructionID.ADDRESS:  // S S
            case InstructionID.TO_INT:  // S S
            case InstructionID.TO_LONG:  // S S
            case InstructionID.TO_SINGLE:  // S S
            case InstructionID.TO_DOUBLE:  // S S
            case InstructionID.ADD:  // S S S
            case InstructionID.ADD:  // S S S
            case InstructionID.SUB:  // S S S
            case InstructionID.NEG:  // S S S
            case InstructionID.MUL:  // S S S
            case InstructionID.DIV:  // S S S
            case InstructionID.POW:  // S S S
            case InstructionID.IDIV:  // S S S
            case InstructionID.MOD:  // S S S
            case InstructionID.EQ:  // S S S
            case InstructionID.NEQ:  // S S S
            case InstructionID.GTE:  // S S S
            case InstructionID.LTE:  // S S S
            case InstructionID.LT:  // S S S
            case InstructionID.GT:  // S S S
            case InstructionID.OR:  // S S S
            case InstructionID.AND:  // S S S
            case InstructionID.XOR:  // S S S
            case InstructionID.NOT:  // S S
            case InstructionID.LOGICNOT:  // S S
            case InstructionID.PRINT:  // S
            case InstructionID.LOCATE:  // S|undefined [ S|undefined ]
            case InstructionID.ABS:  // S S
            case InstructionID.MID:  // S S S [ S ]
            case InstructionID.PEEK: // S S
            case InstructionID.RIGHT:  // S S S
            case InstructionID.LEFT:  // S S S
            case InstructionID.CHR:  // S S
            case InstructionID.ASC:  // S S
            case InstructionID.RND:  // S [ S ]
            case InstructionID.INT:  // S S
            case InstructionID.FIX:  // S S
            case InstructionID.END:  // <no parameters>
            case InstructionID.COLOR:  // S S
            case InstructionID.PALETTE:  // [ S S ]
            case InstructionID.GET_DRAW_POS:  // S S
            case InstructionID.GET_GRAPHICS: // S S S S S
            case InstructionID.PSET:  // S S [ S ]
            case InstructionID.PRESET:  // S S
            case InstructionID.POINT:  // S S S
            case InstructionID.CURRENT_POINT: // S S
            case InstructionID.CLS:  // S
            case InstructionID.SCREEN:  // S S S S
            case InstructionID.SLEEP:  // S
            case InstructionID.INKEY:  // S
            case InstructionID.VAL:  // S S
            case InstructionID.STR:  // S S
            case InstructionID.TAN:  // S S
            case InstructionID.SIN:  // S S
            case InstructionID.LOG:  // S S
            case InstructionID.COS:  // S S
            case InstructionID.ATN:  // S S
            case InstructionID.CINT:  // S S
            case InstructionID.CLNG:  // S S
            case InstructionID.CDBL:  // S S
            case InstructionID.CSNG:  // S S
            case InstructionID.EXP:  // S S
            case InstructionID.TIMER:  // S
            case InstructionID.RANDOMIZE:  // S
            case InstructionID.LEN:  // S S
            case InstructionID.LTRIM:  // S S
            case InstructionID.RTRIM:  // S S
            case InstructionID.LCASE:  // S S
            case InstructionID.UCASE:  // S S
            case InstructionID.INSTR:  // S S S
            case InstructionID.SPACE:  // S S
            case InstructionID.DEBUGLOG:  // S
            case InstructionID.INPUT_FUNC: // S S
            case InstructionID.LINE_INPUT: // S S S
            case InstructionID.NOP:
                if (this.args[offset] !== undefined) {
                    return "S";
                }
                return "";
            default:
                throw new Error("missing case " + this.id);
        }
    }
    shiftStackOffset(add: number, includeNegative: boolean) {
        for (let i = 0; i < this.args.length; i++) {
            const pt = this.parameterType(i);
            if (pt === "S" || pt === "stack-size") {
                if (includeNegative || this.args[i] >= 0) {
                    this.args[i] = this.args[i] + add;
                }
            }
        }
    }
    mapStackOffset(oldToNew: (s: number) => number) {
        for (let i = 0; i < this.args.length; i++) {
            if (this.parameterType(i) === "S" && this.args[i] !== undefined) {
                this.args[i] = oldToNew(this.args[i]);
            }
        }
        // TODO: I don't like this.
        if ((this.id === InstructionID.ASSIGN || this.id === InstructionID.LOAD) && this.args[2] !== undefined) {
            for (let i = 0; i < this.args[2].length; i++) {
                this.args[2][i] = oldToNew(this.args[2][i]);
            }
        }
        if (this.id === InstructionID.INPUT) {
            const inpustSpec = this.args[0] as InputSpec;
            for (const input of inpustSpec.inputs) {
                input.stackOffset = oldToNew(input.stackOffset);
            }
        }
    }
}

export class Program {
    // The program's instructions.
    public inst: Instruction[] = [];
    // The program's const data. The stack is initialized with these values.
    public data: VariableValue[] = [];
    // Contains an entry for each DATA statement value. Each is an offset into data.
    public dataList: number[] = [];
    public statementOffsets: number[] = [];
    public instToLine = new Map<number, number>();

    public source?: string;
    toString(): string {
        return this.inst.map((inst, idx) => `${idx}\t` + inst.toString(this)).join("\n");
    }
    instructionLineNumber(instOffset: number): number | undefined {
        return this.instToLine.get(instOffset);
    }
    instructionArgToString(inst: Instruction, arg: any, argIndex: number): string {
        switch (inst.parameterType(argIndex)) {
            case "S": {
                const v = arg as number;
                if (v & kGlobalBit) {
                    const offset = v ^ kGlobalBit;
                    if (offset < this.data.length) {
                        return this.data[offset].toShortString().replace(/\n/, "\\n");
                    }
                    return "g" + (v ^ kGlobalBit);
                }
                return "s" + v;
                break;
            }
        }
        if (typeof (arg) === "string") {
            return arg;
        }
        return "" + arg;
    }
    sourceListingWithByteCode(source?: string, instAnnotations?: Map<number, string>): string {
        const lineToInst = new Map<number, number[]>();
        let previousLine = 0;
        for (let i = 0; i < this.inst.length; i++) {
            let line: number | undefined = this.instToLine.get(i);
            if (line === undefined) {
                line = previousLine;
            } else {
                previousLine = line;
            }
            const current = lineToInst.get(line + 1);
            if (current) {
                lineToInst.set(line + 1, [current[0], i]);
            } else {
                lineToInst.set(line + 1, [i, i]);
            }
        }
        const sourceLines = (source || "").split("\n");
        const output: string[] = [];
        const instOffset = 0;
        const addInstRange = (min, max) => {
            for (let instOffset = min; instOffset <= max; instOffset++) {
                const annotation = instAnnotations && instAnnotations.get(instOffset) || "";
                output.push(`${annotation}\t[${instOffset}]${this.inst[instOffset].toString(this)}`);
            }
        };
        for (let i = 0; i < sourceLines.length; i++) {
            const instRange = lineToInst.get(i);
            if (instRange !== undefined) {
                addInstRange(instRange[0], instRange[1]);
            }
            output.push(`${i}\t${sourceLines[i]}`);
        }
        return output.join("\n");
    }
    instructionOffsetToStatementIndex(instOffset: number): number {
        for (let i = 1; i < this.statementOffsets.length; i++) {
            if (this.statementOffsets[i] > instOffset) {
                return i - 1;
            }
        }
        return this.statementOffsets.length - 1;
    }
    statementIndexToInstructionOffset(statementIndex: number): number {
        if (statementIndex >= this.statementOffsets.length) {
            return 0;
        }
        return this.statementOffsets[statementIndex];
    }
}

// A stack frame.
class Frame {
    public parent: Frame | undefined;
    public pc: number = 0;
    public stackOffset: number = 0;
}

export function toInt(v: number): number {
    v = Math.round(v) % 65536;
    if (v > 32767) v = -65536 + v;
    return v;
}

export function intToUnsigned(v: number): number {
    if (v >= 0) return v;
    return v + 65536;
}

export function toLong(v: number): number {
    v = Math.round(v) % 4294967296;
    if (v > 2147483647) v = -4294967296 + v;
    return v;
}

class Rnd {
    public seed: number = 327680;
    next() {
        this.seed = (this.seed * 16598013 + 12820163) & 0xFFFFFF;
    }
    float(): number {
        return Math.fround(this.seed / 0x1000000);
    }
}

function formatFloatSingle(n: number): string {
    const s = "" + n;
    if (s.length < 8) return s;
    return n.toPrecision(7);
}

function fixupNumberForPrinting(n: string): string {
    if (n.startsWith("-0.")) n = "-." + n.substr(2);
    else if (n.startsWith("0.")) n = n.substr(1);
    if (!n.startsWith("-")) {
        n = " " + n;
    }
    return n + " ";
}

export class Execution {
    // Stack addressed by non-negative numbers.
    public stack: VariableValue[] = [];
    public exception: any = null;
    public waiting: boolean = false;
    public onEnd: () => void | undefined;
    public onException: (error: string, lineNo: number | undefined) => void;
    public done: boolean = false;

    private frame: Frame = new Frame();
    private moduleFrame: Frame = this.frame;
    private onErrorPC: number | undefined;
    private inRun: boolean;
    private lastPointX: number = 0;
    private lastPointY: number = 0;
    private rnd: Rnd = new Rnd();
    private readPos = 0;
    private errorInstructionOffset: number | undefined;
    constructor(private prog: Program, private vpc: IVirtualPC) {
        for (const d of prog.data) {
            this.stack.push(d.copySingle());
        }
    }
    dumpStack(): string {
        const entries: string[] = [];
        for (let i = 0; i < this.stack.length; i++) {
            const s = this.stack[i];
            if (s instanceof VariableValue) {
                entries.push(`${i}\t${s.toShortString()}`);
            }
        }
        return entries.join("\n");
    }
    debugDump(): string {
        const annotations = new Map<number, string>();
        let f: Frame | undefined = this.frame;
        let frameIndex = 0;
        while (f) {
            annotations.set(f.pc - 1, "" + frameIndex++);
            f = f.parent;
        }
        const listing = this.prog.sourceListingWithByteCode(this.prog.source, annotations);

        return `---- STACK ----
${this.dumpStack()}
---- PROGRAM ----
${listing}
`;
    }
    destroy() {
        this.exception = "destroyed";
    }
    readValOrUndefined(addr: number | undefined): VariableValue | undefined {
        if (addr === undefined) return undefined;
        return this.read(addr);
    }
    read(addr: number): VariableValue {
        if (addr & kGlobalBit) {
            return this.stack[addr ^ kGlobalBit];
        } else {
            return this.stack[addr + this.frame.stackOffset];
        }
    }
    readShared(addr: number): any {
        return this.stack[addr];
    }
    readValShared(addr: number): VariableValue {
        return this.readShared(addr);
    }
    save(addr: number, val: VariableValue) {
        if (addr & kGlobalBit) {
            this.stack[addr ^ kGlobalBit] = val;
        } else {
            while (this.stack.length <= addr) {
                this.stack.push(VariableValue.single(kIntType, 0));
            }
            this.stack[addr + this.frame.stackOffset] = val;
        }
    }
    run(maxSteps = 10000) {
        this.inRun = true;
        // Run at most this many operations, so that we don't freeze the UI entirely.
        let i = 0;
        for (i = 0; i < maxSteps && !this.exception && !this.waiting; i++) {
            try {
                if (!this.step()) break;
            } catch (e) {
                this.raise("internal error: " + e);
            }
        }
        if (i === maxSteps) {
            this.vpc.sleep(0.001, () => {
                this.waiting = false;
                this.unpause();
            });
        }
        this.inRun = false;
    }
    start() {
        this.run();
    }
    currentLine(): number | undefined {
        return this.prog.instructionLineNumber(this.frame.pc);
    }
    raise(err) {
        if (this.onErrorPC !== undefined) {
            while (this.frame.parent) {
                this.frame = this.frame.parent;
            }
            this.errorInstructionOffset = this.frame.pc;
            this.frame.pc = this.onErrorPC;
            return;
        }
        this.exception = err;
        if (this.onException) { this.onException(err, this.currentLine()); }
    }
    end() {
        this.done = true;
        if (this.onEnd) this.onEnd();
    }
    unpause() {
        if (this.inRun) return;
        this.run();
    }
    step() {
        if (this.frame.pc >= this.prog.inst.length) {
            this.end();
            return false;
        }
        if (this.waiting) {
            console.error("called step while in wait");
        }
        const inst = this.prog.inst[this.frame.pc];
        // console.log(inst.toString(this.prog));
        const args = inst.args;
        this.frame.pc++;
        switch (inst.id) {
            case InstructionID.LOAD: {
                const idx = args[0];
                const varOffset = args[1];
                const posStackIndices = args[2] as number[] | undefined;
                const fieldIndices = args[3] as number[] | undefined;
                let index: number[] | undefined;
                if (posStackIndices) {
                    index = posStackIndices.map((i) => this.read(i).val as number);
                }
                const value = this.read(varOffset);
                if (index || fieldIndices) {
                    const v = value.valAtIndex(index, fieldIndices);
                    if (v instanceof InternalError) {
                        this.raise("internal error");
                    } else if (v instanceof IndexOutOfRange) {
                        this.frame.pc--;
                        this.raise("index out of range");
                    } else {
                        this.save(idx, v);
                    }
                } else {
                    this.save(idx, value);
                }
                break;
            }
            case InstructionID.ADDRESS: {
                this.save(args[0], this.read(args[1]));
                break;
            }
            case InstructionID.DECLARE: {
                this.save(args[0], (args[1] as VariableValue).copyDecl());
                break;
            }
            case InstructionID.DECLARE_REDIM: {
                const dims: number[] = [];
                for (let i = 2; i < args.length; i++) {
                    dims.push(this.read(args[i]).numVal());
                }
                const val = (args[1] as VariableValue).copyDecl();
                val.dims = dims;
                this.save(args[0], val);
                break;
            }
            case InstructionID.ASSIGN: {
                const val = this.read(args[1]);

                let index = args.length > 2 ? args[2] as number[] : undefined;
                if (index) index = index.map((i) => this.read(i).getNumber());
                const fieldIndex = args.length > 3 ? args[3] as number[] : undefined;
                this.read(args[0]).setVal(val.val, index, fieldIndex);
                break;
            }
            case InstructionID.COPY: {
                const val = this.read(args[1]);
                this.save(args[0], val.copySingle());
                break;
            }
            case InstructionID.ADD: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.single(a.type, a.anyval() + b.anyval()));
                break;
            }
            case InstructionID.SUB: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.single(a.type, a.anyval() - b.anyval()));
                break;
            }
            case InstructionID.NEG: {
                const a = this.read(args[1]);
                this.save(args[0], VariableValue.single(a.type, -a.anyval()));
                break;
            }
            case InstructionID.MUL: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.single(a.type, a.anyval() * b.anyval()));
                break;
            }
            case InstructionID.DIV: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newDouble(a.anyval() / b.anyval()));
                break;
            }
            case InstructionID.POW: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newDouble(Math.pow(a.anyval(), b.anyval())));
                break;
            }
            case InstructionID.IDIV: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newLong(Math.floor(a.anyval() / b.anyval())));
                break;
            }
            case InstructionID.MOD: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newLong(Math.floor(a.anyval()) % Math.floor(b.anyval())));
                break;
            }
            case InstructionID.EQ: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newInt((a.val === b.val) ? -1 : 0));
                break;
            }
            case InstructionID.NEQ: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newInt((a.val !== b.val) ? -1 : 0));
                break;
            }
            case InstructionID.GTE: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newInt((a.anyval() >= b.anyval()) ? -1 : 0));
                break;
            }
            case InstructionID.LTE: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newInt((a.anyval() <= b.anyval()) ? -1 : 0));
                break;
            }
            case InstructionID.GT: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newInt((a.anyval() > b.anyval()) ? -1 : 0));
                break;
            }
            case InstructionID.LT: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newInt((a.anyval() < b.anyval()) ? -1 : 0));
                break;
            }
            case InstructionID.OR: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newLong(a.anyval() | b.anyval()));
                break;
            }
            case InstructionID.AND: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newLong(a.anyval() & b.anyval()));
                break;
            }
            case InstructionID.XOR: {
                const a = this.read(args[1]);
                const b = this.read(args[2]);
                this.save(args[0], VariableValue.newLong(a.anyval() ^ b.anyval()));
                break;
            }
            case InstructionID.NOT: {
                const a = this.read(args[1]);
                this.save(args[0], VariableValue.newLong(~a.anyval()));
                break;
            }
            case InstructionID.LOGICNOT: {
                const a = this.read(args[1]);
                this.save(args[0], VariableValue.newLong(a.val ? 0 : -1));
                break;
            }
            case InstructionID.TO_INT:
                this.save(args[0], VariableValue.newInt(toInt(this.read(args[1]).val as number)));
                break;
            case InstructionID.TO_LONG:
                this.save(args[0], VariableValue.newLong(toLong(this.read(args[1]).val as number)));
                break;
            case InstructionID.TO_SINGLE:
                this.save(args[0], VariableValue.single(kSingleType, Math.fround((this.read(args[1]).val as number))));
                break;
            case InstructionID.TO_DOUBLE:
                this.save(args[0], VariableValue.single(kDoubleType, this.read(args[1]).val as number));
                break;
            case InstructionID.PRINT: {
                const argVal = this.read(args[0]);
                switch (argVal.type.type) {
                    case BaseType.kSingle: {
                        this.vpc.print(fixupNumberForPrinting(formatFloatSingle(argVal.val as number)));
                        break;
                    }
                    case BaseType.kString: {
                        this.vpc.print("" + argVal.val);
                        break;
                    }
                    default: {
                        this.vpc.print(fixupNumberForPrinting("" + argVal.val));
                        break;
                    }
                }
                break;
            }
            case InstructionID.LOCATE: {
                this.vpc.locate(args[0] !== undefined ? this.read(args[0]).anyval() : null,
                    args[1] !== undefined ? this.read(args[1]).anyval() : null);
                break;
            }
            case InstructionID.INPUT_FUNC: {
                this.waiting = true;
                const done = (result) => {
                    this.save(args[0], VariableValue.single(kStringType, result));
                    this.waiting = false;
                    this.unpause();
                };
                this.vpc.inkeyWait(this.read(args[1]).numVal(), done);
                break;
            }
            case InstructionID.INPUT: {
                const spec: InputSpec = args[0];
                this.vpc.print(spec.prompt || "");
                this.waiting = true;
                const inputReady = (text: string) => {
                    const result = spec.parseInput(text);
                    if (!result) {
                        this.vpc.print("Redo from start\n");
                        this.vpc.input(inputReady);
                        return;
                    }
                    this.waiting = false;
                    this.vpc.print("\n");
                    for (let i = 0; i < result.length; i++) {
                        this.save(spec.inputs[i].stackOffset, result[i]);
                    }
                    this.unpause();
                };
                this.vpc.input(inputReady);
                break;
            }
            case InstructionID.LINE_INPUT: {
                const sameLine = this.readValOrUndefined(args[0]);
                const prompt = this.readValOrUndefined(args[1]);
                const inputReady = (text: string) => {
                    this.waiting = false;
                    if (sameLine !== undefined && sameLine) {
                    } else {
                        this.vpc.print("\n");
                    }
                    this.save(args[2], VariableValue.newString(text));
                    this.unpause();
                };
                if (prompt) this.vpc.print(prompt.strVal());
                this.vpc.input(inputReady);
                break;
            }
            case InstructionID.BRANCH_IFNOT: {
                const val = this.read(args[1]);
                if (val.isZero()) {
                    this.frame.pc = args[0];
                }
                break;
            }
            case InstructionID.BRANCH:
                this.frame.pc = args[0];
                break;
            case InstructionID.CALL_SUB: {
                const f = new Frame();
                f.parent = this.frame;
                f.stackOffset = this.frame.stackOffset + args[1] as number;
                f.pc = args[0] as number;
                this.frame = f;
                break;
            }
            case InstructionID.GOSUB: {
                const f = new Frame();
                f.parent = this.frame;
                f.stackOffset = this.frame.stackOffset + args[1] as number;
                f.pc = args[0] as number;
                this.frame = f;
                break;
            }
            case InstructionID.CALL_FUNCTION: {
                const f = new Frame();
                f.parent = this.frame;
                f.stackOffset = this.frame.stackOffset + args[1] as number;
                f.pc = args[0] as number;
                this.frame = f;
                break;
            }
            case InstructionID.EXIT_SUB: {
                this.frame = this.frame.parent as Frame;
                break;
            }
            case InstructionID.RETURN: {
                this.frame = this.frame.parent as Frame;
                this.frame.pc = args[0] as number;
                break;
            }
            case InstructionID.ABS: {
                const val = this.read(args[1]).copySingle();
                if (val.anyval() < 0) {
                    val.val = -val.anyval();
                }
                this.save(args[0], val); // TODO: Overflow
                break;
            }
            case InstructionID.MID: {
                const val = this.read(args[1]).copySingle();
                const offset = this.read(args[2]);
                if (args.length > 3) {
                    val.val = (val.val as string).substr(Math.max(0, offset.numVal() - 1), this.read(args[3]).numVal());
                } else {
                    val.val = (val.val as string).substr(Math.max(0, offset.numVal() - 1));
                }
                this.save(args[0], val);
                break;
            }
            case InstructionID.PEEK: { // TODO
                this.save(args[0], VariableValue.newInt(0));
                break;
            }
            case InstructionID.LEFT: {
                const val = this.read(args[1]).copySingle();
                const n = Math.abs(this.read(args[2]).anyval());
                val.val = (val.val as string).substr(0, n);
                this.save(args[0], val);
                break;
            }
            case InstructionID.RIGHT: {
                const val = this.read(args[1]).copySingle();
                const n = Math.abs(this.read(args[2]).anyval());
                const str = (val.val as string);
                if (str.length > n) {
                    val.val = str.substr(str.length - n);
                }
                this.save(args[0], val);
                break;
            }
            case InstructionID.CHR: {
                const code = this.read(args[1]).val as number;
                this.save(args[0], VariableValue.single(kStringType, String.fromCharCode(code)));
                break;
            }
            case InstructionID.ASC: {
                const code = this.read(args[1]).val as string;
                this.save(args[0], VariableValue.newInt(code.charCodeAt(0)));
                break;
            }
            case InstructionID.RND: {
                if (args.length) { // TODO: handle parameters... who uses these!?
                }
                this.rnd.next();
                this.save(args[0], VariableValue.single(kSingleType, this.rnd.float()));
                break;
            }
            case InstructionID.COLOR: {
                const fc = Math.round(this.read(args[0]).numVal());
                const bc = Math.round(this.read(args[1]).numVal());
                if (fc >= 0) {
                    this.vpc.setForeColor(fc);
                }
                if (bc >= 0) {
                    this.vpc.setBackColor(bc);
                }
                break;
            }
            case InstructionID.PALETTE: {
                if (args.length < 2) {
                    this.vpc.resetPalette();
                } else {
                    const attr = Math.round(this.read(args[0]).numVal());
                    const color = Math.round(this.read(args[1]).numVal());
                    this.vpc.setPaletteAttribute(attr, color);
                }
                break;
            }
            case InstructionID.GET_DRAW_POS: {
                this.save(args[0], VariableValue.newInt(this.lastPointX));
                this.save(args[1], VariableValue.newInt(this.lastPointY));
                break;
            }
            case InstructionID.PAINT: {
                const x = this.read(args[0]).numVal();
                const y = this.read(args[1]).numVal();
                let paintColor: number | undefined;
                let borderColor: number | undefined;
                if (args[2] !== undefined) paintColor = this.read(args[2]).numVal();
                if (args[3] !== undefined) borderColor = this.read(args[3]).numVal();

                this.vpc.paint(Math.round(x), Math.round(y), paintColor, borderColor);
                this.lastPointX = Math.round(x);
                this.lastPointY = Math.round(y);
                break;
            }
            case InstructionID.CIRCLE: {
                const x = this.read(args[0]).numVal();
                const y = this.read(args[1]).numVal();
                const r = this.read(args[2]).numVal();
                let color: number | undefined;
                let start = 0;
                let end = Math.PI * 2;
                let aspect = 1;
                if (args[3] !== undefined) {
                    color = this.read(args[3]).numVal();
                    color = Math.round(color as number);
                }
                if (args[4] !== undefined) {
                    start = this.read(args[4]).numVal();
                    if (start > Math.PI * 2 || start < -Math.PI * 2) {
                        this.raise("invalid call");
                        break;
                    }
                }
                if (args[5] !== undefined) {
                    end = this.read(args[5]).numVal();
                    if (end > Math.PI * 2 || end < -Math.PI * 2) {
                        this.raise("invalid call");
                        break;
                    }
                }
                if (args[6] !== undefined) {
                    aspect = this.read(args[6]).numVal();
                }

                this.vpc.circle(Math.round(x), Math.round(y), Math.round(r), color, start, end, aspect);
                this.lastPointX = Math.round(x);
                this.lastPointY = Math.round(y);
                break;
            }
            case InstructionID.LINE: {
                const x1 = this.read(args[0]).numVal();
                const y1 = this.read(args[1]).numVal();
                const x2 = this.read(args[2]).numVal();
                const y2 = this.read(args[3]).numVal();
                let color: number | undefined;
                if (args[4] !== undefined) {
                    color = this.read(args[4]).numVal();
                    color = Math.round(color as number);
                }
                let type = LineType.kLine;
                if (args[5] !== undefined) {
                    if ((args[5] as string) === "B") {
                        type = LineType.kBox;
                    } else {
                        type = LineType.kFilledBox;
                    }
                }
                let style = 0xffff;
                if (args[6] !== undefined) {
                    style = this.read(args[6]).numVal();
                }
                this.vpc.line(Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2), color, type, style);
                this.lastPointX = Math.round(x2);
                this.lastPointY = Math.round(y2);
                break;
            }
            case InstructionID.DRAW: {
                const cmd = this.read(args[0]).strVal();
                const instructions = parseDrawCommand(cmd);
                if (instructions) this.vpc.draw(this.lastPointX, this.lastPointY, instructions);
                else this.raise("invalid draw command");
                break;
            }
            case InstructionID.GET_GRAPHICS: {
                const x1 = this.read(args[0]).numVal();
                const y1 = this.read(args[1]).numVal();
                const x2 = this.read(args[2]).numVal();
                const y2 = this.read(args[3]).numVal();
                const arrayVar = this.read(args[4]);
                const dims = arrayVar.dims;
                if (!dims) {
                    this.raise("invalid array");
                    break;
                }
                if (dims.length !== 1) {
                    this.raise("not implemented");
                    break;
                }
                if (arrayVar.type !== kIntType) {
                    this.raise("not implemented");
                    break;
                }
                const data = this.vpc.getGraphics(Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2), dims[0] * 2);
                if (!data) {
                    this.raise("invalid call");
                    break;
                }
                for (let i = 0; i < data.length; i += 2) {
                    const a = data[i];
                    const b = (i + 1) < data.length ? data[i + 1] : 0;
                    arrayVar.setVal(a + (b << 8), [Math.trunc(i / 2)], undefined);
                }
                break;
            }
            case InstructionID.PUT_GRAPHICS: {
                const x = this.read(args[0]).numVal();
                const y = this.read(args[1]).numVal();
                const arrayVar = this.read(args[2]);
                const actionVerb = args[3] as GraphicsAction;
                const dims = arrayVar.dims;
                if (!dims) {
                    this.raise("invalid array");
                    break;
                }
                if (dims.length !== 1) {
                    this.raise("not implemented");
                    break;
                }
                if (arrayVar.type !== kIntType) {
                    this.raise("not implemented");
                    break;
                }
                const data = new Uint8Array(dims[0] * 2);
                for (let i = 0; i < data.length; i += 2) {
                    const n = intToUnsigned((arrayVar as any).arrayVals[Math.trunc(i / 2)] as number);
                    data[i] = n % 256;
                    if (i + 1 < data.length) {
                        data[i + 1] = (n >> 8) % 256;
                    }
                }
                this.vpc.putGraphics(Math.round(x), Math.round(y), data, actionVerb);
                break;
            }
            case InstructionID.PSET: {
                const x = this.read(args[0]).numVal();
                const y = this.read(args[1]).numVal();
                let color: number | undefined;
                if (args[2] !== undefined) {
                    color = this.read(args[2]).numVal();
                    color = Math.round(color as number);
                }
                this.vpc.pset(Math.round(x), Math.round(y), color);
                this.lastPointX = Math.round(x);
                this.lastPointY = Math.round(y);
                break;
            }
            case InstructionID.PRESET: {
                const x = this.read(args[0]).numVal();
                const y = this.read(args[1]).numVal();
                this.vpc.pset(Math.round(x), Math.round(y), this.vpc.backColor());
                this.lastPointX = Math.round(x);
                this.lastPointY = Math.round(y);
                break;
            }
            case InstructionID.POINT: {
                this.save(args[0], VariableValue.newInt(
                    this.vpc.point(Math.round(this.read(args[1]).numVal()), Math.round(this.read(args[2]).numVal()))));
                break;
            }
            case InstructionID.CURRENT_POINT: {
                switch (this.read(args[1]).numVal()) {
                    case 0: this.save(args[0], VariableValue.newInt(this.lastPointX)); break;
                    case 1: this.save(args[0], VariableValue.newInt(this.lastPointX)); break;
                    case 2: case 3: this.raise("not implemented"); break;
                    default: this.raise("invalid call");
                }
                break;
            }
            case InstructionID.CLS: {
                const arg = this.readValOrUndefined(args[0]);
                if (arg && arg.numVal() === 1) {
                    this.vpc.clsGraphics();
                } else if (arg && arg.numVal() === 2) {
                    this.vpc.clsText();
                } else {
                    this.vpc.cls();
                }
                break;
            }
            case InstructionID.SCREEN: {
                const apage = roundOrUndefined(this.readValOrUndefined(args[2]));
                let vpage = roundOrUndefined(this.readValOrUndefined(args[3]));
                if (vpage === undefined && apage !== undefined) {
                    vpage = apage;
                }
                this.vpc.screen(
                    roundOrUndefined(this.readValOrUndefined(args[0])),
                    roundOrUndefined(this.readValOrUndefined(args[1])),
                    apage, vpage,
                );
                break;
            }
            case InstructionID.SLEEP: {
                const delay = this.read(args[0]).numVal();
                this.waiting = true;
                this.vpc.sleep(delay, () => {
                    this.waiting = false;
                    this.unpause();
                });
                break;
            }
            case InstructionID.INKEY: {
                this.save(args[0], VariableValue.single(kStringType, this.vpc.inkey()));
                break;
            }
            case InstructionID.VAL: {
                this.save(args[0], VariableValue.newDouble(parseFloat(this.read(args[1]).strVal())));
                break;
            }
            case InstructionID.STR: {
                const val = this.read(args[1]).val;
                let valStr;
                if (typeof (val) === "number") {
                    if (val >= 0) valStr = " " + val;
                    else valStr = "" + val;
                } else {
                    valStr = "" + val;
                }
                this.save(args[0], VariableValue.single(kStringType, "" + valStr));
                break;
            }
            case InstructionID.TAN: {
                this.save(args[0], VariableValue.newDouble(Math.tan(this.read(args[1]).numVal())));
                break;
            }
            case InstructionID.SIN: {
                this.save(args[0], VariableValue.newDouble(Math.sin(this.read(args[1]).numVal())));
                break;
            }
            case InstructionID.COS: {
                this.save(args[0], VariableValue.newDouble(Math.cos(this.read(args[1]).numVal())));
                break;
            }
            case InstructionID.LOG: {
                const param = this.read(args[1]).numVal();
                if (param <= 0) {
                    this.raise("Illegal function call");
                    break;
                }
                this.save(args[0], VariableValue.newDouble(Math.log(param)));
                break;
            }
            case InstructionID.ATN: {
                this.save(args[0], VariableValue.newDouble(Math.atan(this.read(args[1]).numVal())));
                break;
            }
            case InstructionID.CINT: {
                this.save(args[0], VariableValue.newInt(Math.round(toInt(this.read(args[1]).numVal()))));
                break;
            }
            case InstructionID.CLNG: {
                this.save(args[0], VariableValue.newLong(Math.round(toLong(this.read(args[1]).numVal()))));
                break;
            }
            case InstructionID.CDBL: {
                this.save(args[0], VariableValue.newDouble(this.read(args[1]).numVal()));
                break;
            }
            case InstructionID.CSNG: {
                this.save(args[0], VariableValue.single(kSingleType, this.read(args[1]).numVal()));
                break;
            }
            case InstructionID.EXP: {
                this.save(args[0], VariableValue.single(kDoubleType, Math.exp(this.read(args[1]).numVal())));
                break;
            }
            case InstructionID.FIX: {
                this.save(args[0], VariableValue.single(kDoubleType, Math.trunc(this.read(args[1]).numVal())));
                break;
            }
            case InstructionID.INT: {
                this.save(args[0], VariableValue.single(kDoubleType, Math.floor(this.read(args[1]).numVal())));
                break;
            }
            case InstructionID.TIMER: {
                const now = new Date();
                const then = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
                const diff = now.getTime() - then.getTime();
                this.save(args[0], VariableValue.single(kDoubleType, diff / 1000.0));
                break;
            }
            case InstructionID.RANDOMIZE: {
                this.rnd.seed = toLong(this.read(args[0]).numVal());
                break;
            }
            case InstructionID.READ: {
                if (this.readPos >= this.prog.dataList.length) {
                    this.raise("Out of DATA");
                    break;
                }
                const dataVal = this.prog.data[this.prog.dataList[this.readPos++]];
                const readType: BaseType = args[1];
                let readVal: any;
                if (dataVal.type === kStringType) {
                    if (readType === BaseType.kString) {
                        readVal = dataVal.val;
                    } else {
                        this.raise("syntax error");
                        break;
                    }
                } else {
                    readVal = convertNumber(dataVal.numVal(), readType);
                }
                this.save(args[0], VariableValue.single(Type.basic(readType) as Type, readVal));
                break;
            }
            case InstructionID.RESTORE: {
                this.readPos = args[0];
                break;
            }
            case InstructionID.LEN: {
                this.save(args[0], VariableValue.newLong(this.read(args[1]).strVal().length));
                break;
            }
            case InstructionID.LTRIM: {
                this.save(args[0], VariableValue.newString(this.read(args[1]).strVal().trimLeft()));
                break;
            }
            case InstructionID.RTRIM: {
                this.save(args[0], VariableValue.newString(this.read(args[1]).strVal().trimRight()));
                break;
            }
            case InstructionID.UCASE: {
                this.save(args[0], VariableValue.newString(this.read(args[1]).strVal().toUpperCase()));
                break;
            }
            case InstructionID.INSTR: {
                const start = this.read(args[1]).numVal();
                const str = this.read(args[2]).strVal();
                const search = this.read(args[3]).strVal();
                if (search === "") {
                    this.save(args[0], VariableValue.newInt(start));
                } else {
                    this.save(args[0], VariableValue.newInt(str.indexOf(search, start - 1) + 1));
                }
                break;
            }
            case InstructionID.LCASE: {
                this.save(args[0], VariableValue.newString(this.read(args[1]).strVal().toLowerCase()));
                break;
            }
            case InstructionID.SPACE: {
                const n = this.read(args[1]).numVal();
                this.save(args[0], VariableValue.newString(" ".repeat(n)));
                break;
            }
            case InstructionID.ON_ERROR_GOTO: {
                this.onErrorPC = args[0];
                break;
            }
            case InstructionID.RESUME: {
                if (this.errorInstructionOffset !== undefined) {
                    const statementOffset = this.prog.instructionOffsetToStatementIndex(this.errorInstructionOffset);
                    this.frame.pc = this.prog.statementIndexToInstructionOffset(statementOffset);
                    this.errorInstructionOffset = undefined;
                }
                break;
            }
            case InstructionID.RESUME_NEXT: {
                if (this.errorInstructionOffset !== undefined) {
                    const statementOffset = this.prog.instructionOffsetToStatementIndex(this.errorInstructionOffset);
                    this.frame.pc = this.prog.statementIndexToInstructionOffset(statementOffset + 1);
                    this.errorInstructionOffset = undefined;
                }
                break;
            }
            case InstructionID.RESUME_GOTO: {
                if (this.errorInstructionOffset !== undefined) {
                    this.frame.pc = args[0];
                    this.errorInstructionOffset = undefined;
                }
                break;
            }
            case InstructionID.VIEW: {
                const screen = args[0] as boolean;
                const x1 = this.read(args[1]).numVal();
                const y1 = this.read(args[2]).numVal();
                const x2 = this.read(args[3]).numVal();
                const y2 = this.read(args[4]).numVal();
                const fillColor = this.readValOrUndefined(args[6]);
                const borderColor = this.readValOrUndefined(args[7]);
                if (borderColor !== undefined) {
                    this.vpc.line(x1 - 1, y1 - 1, x2 + 1, y2 + 1, borderColor.numVal(), LineType.kBox, 0xffff);
                }
                if (fillColor !== undefined) {
                    this.vpc.line(x1, y1, x2, y2, fillColor.numVal(), LineType.kFilledBox, 0xffff);
                }
                this.vpc.setView(x1, y1, x2, y2, screen);
                break;
            }
            case InstructionID.VIEW_PRINT: {
                const maxValue = this.vpc.screenLines();
                const top = this.read(args[0]).numVal();
                const bottom = this.read(args[1]).numVal();
                if (top < 1 || bottom < 1 || top > bottom || bottom > maxValue || top > maxValue) {
                    this.raise("invalid call");
                    break;
                }
                this.vpc.setViewPrint(top, bottom);
                break;
            }
            case InstructionID.STRING: {
                const times = this.read(args[1]).numVal();
                const toRepeat = this.read(args[2]).strVal();
                this.save(args[0], VariableValue.newString(toRepeat.substr(0, 1).repeat(times)));
                break;
            }
            case InstructionID.NOP: {
                break;
            }
            case InstructionID.DEBUGLOG: {
                console.log(this.read(args[0]).strVal());
                break;
            }
            case InstructionID.END: {
                this.end();
                return false;
            }

            default: {
                console.log("Not implemented: " + InstructionID[inst.id]);
                break;
            }
        }
        return true;
    }
    private resume(previousPC: number) {
        const statementOffset = this.prog.instructionOffsetToStatementIndex(previousPC);
        this.frame.pc = this.prog.statementIndexToInstructionOffset(statementOffset);
        this.errorInstructionOffset = undefined;
    }
    private resumeNext(previousPC: number) {

        this.errorInstructionOffset = undefined;
    }
}
