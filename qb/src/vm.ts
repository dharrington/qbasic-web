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

import { BaseType, baseTypeToSigil, kDoubleType, kIntType, kLongType, kSingleType, kStringType, Type } from "./types";

// The virtual computer on which the VM executes.
export interface IVirtualPC {
    print(text: string);
    input(completed: (text: string) => void);
    setForeColor(fc: number);
    setBackColor(bc: number);
    line(x1: number, y1: number, x2: number, y2: number, color?: number);
    pset(x: number, y: number, color?: number);
    locate(x?: number, y?: number);
    screen(id: number);
    resetPalette();
    setPaletteAttribute(attr: number, color: number);
    sleep(delay: number, done);
    inkey(): string;
    cls();
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
    setBackColor(bc: number) {
        throw new Error("not implemented");
    }
    line(x1: number, y1: number, x2: number, y2: number, color?: number) {
        throw new Error("not implemented");
    }
    pset(x: number, y: number, color?: number) {
        throw new Error("not implemented");
    }
    locate(x?: number, y?: number) {
        throw new Error("not implemented");
    }
    screen(id: number) {
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
    cls() {
        throw new Error("not implemented");
    }
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
    LOAD_VARVAL, // S name [pos]
    LOAD_ARGVAL, // S name [pos]
    DECLARE_VAR, // name V
    ASSIGN_VAR, // name S [pos]
    ASSIGN_ARG, // arg-index S [pos]
    INPUT, // InputSpec
    TO_INT, // S S
    TO_LONG, // S S
    TO_SINGLE, // S S
    TO_DOUBLE, // S S
    BRANCH_IFNOT, // PC S
    BRANCH, // PC
    CALL_SUB, // PC string[]
    EXIT_SUB, // <no parameters>
    ADD, // S S S
    SUB, // S S S
    NEG, // S S S
    MUL, // S S S
    DIV, // S S S
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
    PRINT, // S ...
    LOCATE, // S|undefined [ S|undefined ]
    ABS, // S S
    MID, // S S S [ S ]
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
    PSET, // S S [ S ]
    CLS, // <no parameters> (TODO)
    SCREEN, // S
    SLEEP, // S
    INKEY, // S
    VAL, // S S
    STR, // S S
    TAN, // S S
    SIN, // S S
    COS, // S S
    ATN, // S S
    CINT, // S S
    CLNG, // S S
    CDBL, // S S
    CSNG, // S S
    EXP, // S S
}

// These instructions produce constant output given constant inputs.
export const ConstExprInstructions = new Set([
    InstructionID.TO_INT, InstructionID.TO_LONG, InstructionID.TO_SINGLE, InstructionID.TO_DOUBLE,
    InstructionID.ADD, InstructionID.SUB, InstructionID.NEG, InstructionID.MUL,
    InstructionID.DIV, InstructionID.IDIV, InstructionID.MOD, InstructionID.EQ,
    InstructionID.NEQ, InstructionID.GTE, InstructionID.LTE, InstructionID.LT,
    InstructionID.GT, InstructionID.OR, InstructionID.AND, InstructionID.XOR,
    InstructionID.NOT, InstructionID.LOGICNOT, InstructionID.ABS, InstructionID.MID,
    InstructionID.RIGHT, InstructionID.LEFT, InstructionID.CHR, InstructionID.ASC,
    InstructionID.INT, InstructionID.FIX, InstructionID.STR, InstructionID.TAN,
    InstructionID.SIN, InstructionID.COS, InstructionID.ATN, InstructionID.CINT,
    InstructionID.CLNG, InstructionID.CDBL, InstructionID.CSNG, InstructionID.EXP,
]);

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
                    const m = /^[+-]?([0-9]+([.][0-9]*[EeDd][+-][0-9]+)?)|(\.[0-9]+([EeDd][+-][0-9]+))/.exec(text);
                    if (!m) return undefined;
                    const i = parseFloat(m[0]);
                    result.push(VariableValue.single(kSingleType, i));
                    text = text.substr(m[0].length);
                    break;
                }
                case BaseType.kDouble: {
                    const m = /^[+-]?([0-9]+([.][0-9]*[EeDd][+-][0-9]+)?)|(\.[0-9]+([EeDd][+-][0-9]+))/.exec(text);
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

// A variable value as understood by vm.
// This can represent temporary values as well as named variables (including arrays).
// In QBasic, the variable X can contain both a single value denoted by 'X', and an array
// denoted by X(). The VM considers both 'single' and 'array' values to be part of the same variable, although
// it may be better to separate the two in the future.
export class VariableValue {
    // Create a single (non-array) value.
    static single(type: Type, val: number | string) {
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
    // Even arrays in basic have an additional non-array value of the same type.
    public val: any;
    public dims?: number[];
    public arrayVals?: any[];
    constructor(public type: Type) { }
    toString(): string {
        const dimStr = this.dims ? "(" + this.dims.map((x) => "" + x).join(", ") + ")" : "";
        return `'${this.val}' ${this.type} ${dimStr}`;
    }
    toShortString(): string {
        const dimStr = this.dims ? "(" + this.dims.map((x) => "" + x).join(", ") + ")" : "";
        let typeStr = "";
        if (this.type.isNumeric()) {
            typeStr = baseTypeToSigil(this.type.type);
        } else if (!this.type.isString()) {
            typeStr = this.type.toString();
        } else {
            return `'${this.val}'${dimStr}`;
        }
        return `${this.val}${typeStr}${dimStr}`;
    }
    // Linearize a multidimensional index.
    indexOffset(index: number[]): number | IndexOutOfRange {
        const dims = this.dims || [10];
        // Array values are initialized lazily...
        let offset = 0;
        for (let i = 0; i < index.length; i++) {
            if (index[i] >= dims[i]) {
                return new IndexOutOfRange();
            }
            offset *= dims[i];
            offset += index[i];
        }
        return offset;
    }
    valAtIndex(index: number[]): VariableValue | IndexOutOfRange {
        // Array values are initialized lazily...
        const offset = this.indexOffset(index);
        if (offset instanceof IndexOutOfRange) return offset;
        if (!this.arrayVals || offset >= this.arrayVals.length) {
            return VariableValue.single(this.type, zeroValue(this.type));
        }
        return VariableValue.single(this.type, this.arrayVals[offset]);
    }
    setVal(val: number | string, index?: number[]) {
        if (!index) {
            this.val = val;
        } else {
            const offset = this.indexOffset(index);
            if (offset instanceof IndexOutOfRange) return offset;
            if (!this.arrayVals) this.arrayVals = [];
            while (offset >= this.arrayVals.length) {
                this.arrayVals.push(zeroValue(this.type));
            }
            this.arrayVals[offset] = val;
        }
    }
    isZero(): boolean {
        return !this.val; // should only be called for numeric types.
    }
    copySingle(): VariableValue {
        return VariableValue.single(this.type, this.val);
    }
    getNumber(): number {
        return this.val as number;
    }
    getString(): string {
        return this.val as string;
    }
}

// Instructions are comprised of an InstructionID and an array of arguments whose type is determined by the
// InstructionID.
export class Instruction {
    static argString(val: any): string {
        if (val instanceof VariableValue) return val.toString();
        return "" + val;
    }
    constructor(public id: InstructionID, public args: any[]) { }
    toString(prog: Program): string {
        return `${InstructionID[this.id]} ${this.args.map((x, idx) => prog.instructionArgToString(this.id, x, idx)).join(", ")}`;
    }
}
export class Program {
    // The program's instructions.
    public inst: Instruction[] = [];
    // The program's const data.
    public data: VariableValue[] = [];
    toString(): string {
        return this.inst.map((inst, idx) => `${idx}\t` + inst.toString(this)).join("\n");
    }
    instructionArgToString(id: InstructionID, arg: any, argIndex: number): string {
        if (typeof (arg) === "number") {
            if ((id === InstructionID.BRANCH || id === InstructionID.BRANCH_IFNOT) && argIndex === 0) {
                return "" + arg; // PC;
            }
            if (id === InstructionID.ASSIGN_ARG && argIndex === 0) {
                return "" + arg;
            }
            if (arg < 0 && -arg < this.data.length) {
                return this.data[-arg].toShortString().replace(/\n/, "\\n");
            }
        }
        if (typeof (arg) === "string") {
            return arg;
        }
        return "" + arg;
    }
}

// A stack frame.
class Frame {
    public parent: Frame | undefined;
    public pc: number = 0;
    public stackOffset: number = 0;
    public vars: Map<string, VariableValue> = new Map<string, VariableValue>();
    // Subroutine arguments are passed by reference. That's accomplished by mapping the argument index
    // onto the calling code's variable name.
    public foreignArgNames: string[];

    readVar(name: string, index?: number[]): VariableValue | IndexOutOfRange {
        const v = this.vars.get(name);
        if (!v) {
            console.log("internal error");
            return zeroValue(kSingleType); // should not happen.
        }
        if (!index) return v;
        return v.valAtIndex(index);
    }
}

export function toInt(v: number): number {
    v = Math.trunc(v) % 65536;
    if (v > 32767) v = -65536 + v;
    return v;
}

export function toLong(v: number): number {
    v = Math.trunc(v) % 4294967296;
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
    public stack: any[] = [];
    public exception: any = null;
    public waiting: boolean = false;
    public onEnd: () => void | undefined;
    public done: boolean = false;

    private frame: Frame = new Frame();
    // Data addressed by negative numbers.
    private data: any[];
    private inRun: boolean;
    private lastPointX: number = 0;
    private lastPointY: number = 0;
    private rnd: Rnd = new Rnd();
    constructor(private prog: Program, private vpc: IVirtualPC) {
        this.data = prog.data;
    }
    destroy() {
        this.exception = "destroyed";
    }
    stackIndex(addr: number): number {
        if (addr < 0) return -addr;
        return this.frame.stackOffset + addr;
    }
    read(addr: number): any {
        if (addr >= 0) {
            return this.stack[this.stackIndex(addr)];
        } else {
            return this.data[-addr];
        }
    }
    readVal(addr: number): VariableValue {
        return this.read(addr);
    }
    save(addr: number, val: any) {
        while (this.stack.length <= addr) {
            this.stack.push(null);
        }
        this.stack[this.stackIndex(addr)] = val;
    }
    pop(): any {
        return this.stack.pop();
    }
    popVal(): VariableValue {
        return this.pop();
    }
    push(v: any) {
        this.stack.push(v);
    }
    run(maxSteps = 100000) {
        this.inRun = true;
        // Run at most this many operations, so that we don't freeze the UI entirely.
        let i = 0;
        for (i = 0; i < maxSteps && !this.exception && !this.waiting && this.step(); i++) {
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
    raise(err) {
        this.exception = err;
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
        const args = inst.args;
        this.frame.pc++;
        switch (inst.id) {
            case InstructionID.LOAD_VARVAL: {
                const idx = args[0];
                const varName = args[1];
                const posStackIndices = args[2] as number[];
                let index: number[] | undefined;
                if (posStackIndices) {
                    index = posStackIndices.map((i) => this.readVal(i).val);
                }
                const value = this.frame.readVar(varName, index);
                if (value instanceof IndexOutOfRange) {
                    this.frame.pc--;
                    this.raise("index out of range");
                } else {
                    this.save(idx, value);
                }
                break;
            }
            case InstructionID.LOAD_ARGVAL: {
                const idx = args[0];
                const varName = this.frame.foreignArgNames[args[1]];
                const posStackIndices = args[2] as number[];
                let index: number[] | undefined;
                if (posStackIndices) {
                    index = posStackIndices.map((i) => this.readVal(i).getNumber());
                }
                const stackParent = this.frame.parent;
                if (!stackParent) {
                    this.raise("LOAD_ARGVAL in module level");
                    break;
                }
                const value = stackParent.readVar(varName, index);
                if (value instanceof IndexOutOfRange) {
                    this.frame.pc--;
                    this.raise("index out of range");
                } else {
                    this.save(idx, value);
                }
                break;
            }
            case InstructionID.DECLARE_VAR:
                this.frame.vars.set(args[0] as string, args[1] as VariableValue);
                break;
            case InstructionID.ASSIGN_VAR: {
                const v = this.frame.vars.get(args[0] as string);
                if (!v) {
                    this.raise("ASSIGN_VAR does not exist");
                    break;
                }
                const val = this.readVal(args[1]);
                const index = args.length > 2 ? args[2] as number[] : null;
                if (!index) v.setVal(val.val);
                else {
                    v.setVal(val.val, index.map((i) => this.readVal(i).getNumber()));
                }
                break;
            }
            case InstructionID.ASSIGN_ARG: {
                const varName = this.frame.foreignArgNames[args[0] as number];
                if (!this.frame.parent) {
                    this.raise("ASSIGN_ARG at module level");
                    break;
                }
                const v = this.frame.parent.vars.get(varName);
                if (!v) {
                    this.raise("no variable");
                    break;
                }
                const val = this.readVal(args[1]);
                const index = args.length > 2 ? args[2] as number[] : null;
                if (!index) v.setVal(val.val);
                else {
                    v.setVal(val.val, index.map((i) => this.readVal(i).getNumber()));
                }
                break;
            }
            case InstructionID.ADD: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.single(a.type, a.val + b.val));
                break;
            }
            case InstructionID.SUB: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.single(a.type, a.val - b.val));
                break;
            }
            case InstructionID.NEG: {
                const a = this.readVal(args[1]);
                this.save(args[0], VariableValue.single(a.type, -a.val));
                break;
            }
            case InstructionID.MUL: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.single(a.type, a.val * b.val));
                break;
            }
            case InstructionID.DIV: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newDouble(a.val / b.val));
                break;
            }
            case InstructionID.IDIV: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newLong(Math.floor(a.val / b.val)));
                break;
            }
            case InstructionID.MOD: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newLong(Math.floor(a.val) % Math.floor(b.val)));
                break;
            }
            case InstructionID.EQ: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newInt((a.val === b.val) ? -1 : 0));
                break;
            }
            case InstructionID.NEQ: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newInt((a.val !== b.val) ? -1 : 0));
                break;
            }
            case InstructionID.GTE: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newInt((a.val >= b.val) ? -1 : 0));
                break;
            }
            case InstructionID.LTE: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newInt((a.val <= b.val) ? -1 : 0));
                break;
            }
            case InstructionID.GT: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newInt((a.val > b.val) ? -1 : 0));
                break;
            }
            case InstructionID.LT: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newInt((a.val < b.val) ? -1 : 0));
                break;
            }
            case InstructionID.OR: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newLong(a.val | b.val));
                break;
            }
            case InstructionID.AND: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newLong(a.val & b.val));
                break;
            }
            case InstructionID.XOR: {
                const a = this.readVal(args[1]);
                const b = this.readVal(args[2]);
                this.save(args[0], VariableValue.newLong(a.val ^ b.val));
                break;
            }
            case InstructionID.NOT: {
                const a = this.readVal(args[1]);
                this.save(args[0], VariableValue.newLong(~a.val));
                break;
            }
            case InstructionID.LOGICNOT: {
                const a = this.readVal(args[1]);
                this.save(args[0], VariableValue.newLong(a.val ? 0 : -1));
                break;
            }
            case InstructionID.TO_INT:
                this.save(args[0], VariableValue.newInt(toInt(this.readVal(args[1]).val)));
                break;
            case InstructionID.TO_LONG:
                this.save(args[0], VariableValue.newLong(toLong(this.readVal(args[1]).val)));
                break;
            case InstructionID.TO_SINGLE:
                this.save(args[0], VariableValue.single(kSingleType, toInt(this.readVal(args[1]).val)));
                break;
            case InstructionID.TO_DOUBLE:
                this.save(args[0], VariableValue.single(kDoubleType, toInt(this.readVal(args[1]).val)));
                break;
            case InstructionID.PRINT: {
                for (const arg of args) {
                    const argVal = this.readVal(arg);
                    switch (argVal.type.type) {
                        case BaseType.kSingle: {
                            this.vpc.print(fixupNumberForPrinting(formatFloatSingle(argVal.val)));
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
                }
                break;
            }
            case InstructionID.LOCATE: {
                this.vpc.locate(args[0] ? this.readVal(args[0]).val : null,
                    args[1] ? this.readVal(args[1]).val : null);
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
            case InstructionID.BRANCH_IFNOT: {
                const val = this.readVal(args[1]);
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
                f.foreignArgNames = args[1] as string[];
                f.pc = args[0] as number;
                this.frame = f;
                break;
            }
            case InstructionID.EXIT_SUB: {
                this.frame = this.frame.parent as Frame;
                break;
            }
            case InstructionID.ABS: {
                const val = this.readVal(args[1]).copySingle();
                if (val.val < 0) {
                    val.val = -val.val;
                }
                this.save(args[0], val); // TODO: Overflow
                break;
            }
            case InstructionID.MID: {
                const val = this.readVal(args[1]).copySingle();
                const offset = this.readVal(args[2]);
                if (args.length > 3) {
                    val.val = (val.val as string).substr(offset.val, this.readVal(args[3]).val);
                } else {
                    val.val = (val.val as string).substr(offset.val);
                }
                this.save(args[0], val);
                break;
            }
            case InstructionID.LEFT: {
                const val = this.readVal(args[1]).copySingle();
                const n = Math.abs(this.readVal(args[2]).val);
                val.val = (val.val as string).substr(0, n);
                this.save(args[0], val);
                break;
            }
            case InstructionID.RIGHT: {
                const val = this.readVal(args[1]).copySingle();
                const n = Math.abs(this.readVal(args[2]).val);
                const str = (val.val as string);
                if (str.length > n) {
                    val.val = str.substr(str.length - n);
                }
                this.save(args[0], val);
                break;
            }
            case InstructionID.CHR: {
                const code = this.readVal(args[1]).val;
                this.save(args[0], VariableValue.single(kStringType, String.fromCharCode(code)));
                break;
            }
            case InstructionID.ASC: {
                const code = this.readVal(args[1]).val as string;
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
                const fc = Math.trunc(this.readVal(args[0]).val);
                const bc = Math.trunc(this.readVal(args[1]).val);
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
                    const attr = Math.trunc(this.readVal(args[0]).val);
                    const color = Math.trunc(this.readVal(args[1]).val);
                    this.vpc.setPaletteAttribute(attr, color);
                }
                break;
            }
            case InstructionID.GET_DRAW_POS: {
                this.save(args[0], VariableValue.newInt(this.lastPointX));
                this.save(args[1], VariableValue.newInt(this.lastPointY));
                break;
            }
            case InstructionID.LINE: {
                const x1 = this.readVal(args[0]).val;
                const y1 = this.readVal(args[1]).val;
                const x2 = this.readVal(args[2]).val;
                const y2 = this.readVal(args[3]).val;
                let color: number | undefined;
                if (args[4] !== null) {
                    color = this.readVal(args[4]).val;
                    color = Math.trunc(color as number);
                }
                this.vpc.line(Math.trunc(x1), Math.trunc(y1), Math.trunc(x2), Math.trunc(y2), color);
                this.lastPointX = Math.trunc(x2);
                this.lastPointY = Math.trunc(y2);
                break;
            }
            case InstructionID.PSET: {
                const x = this.readVal(args[0]).val;
                const y = this.readVal(args[1]).val;
                let color: number | undefined;
                if (args[2] !== null) {
                    color = this.readVal(args[2]).val;
                    color = Math.trunc(color as number);
                }
                this.vpc.pset(Math.trunc(x), Math.trunc(y), color);
                this.lastPointX = Math.trunc(x);
                this.lastPointY = Math.trunc(y);
                break;
            }
            case InstructionID.CLS: {
                this.vpc.cls();
                break;
            }
            case InstructionID.SCREEN: {
                const id = this.readVal(args[0]).val;
                this.vpc.screen(Math.trunc(id));
                break;
            }
            case InstructionID.SLEEP: {
                const delay = this.readVal(args[0]).val;
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
                this.save(args[0], VariableValue.newDouble(parseFloat(this.readVal(args[1]).val)));
                break;
            }
            case InstructionID.STR: {
                this.save(args[0], VariableValue.single(kStringType, "" + this.readVal(args[1]).val));
                break;
            }
            case InstructionID.TAN: {
                this.save(args[0], VariableValue.newDouble(Math.tan(this.readVal(args[1]).val)));
                break;
            }
            case InstructionID.SIN: {
                this.save(args[0], VariableValue.newDouble(Math.sin(this.readVal(args[1]).val)));
                break;
            }
            case InstructionID.COS: {
                this.save(args[0], VariableValue.newDouble(Math.cos(this.readVal(args[1]).val)));
                break;
            }
            case InstructionID.ATN: {
                this.save(args[0], VariableValue.newDouble(Math.atan(this.readVal(args[1]).val)));
                break;
            }
            case InstructionID.CINT: {
                this.save(args[0], VariableValue.newInt(Math.round(toInt(this.readVal(args[1]).val))));
                break;
            }
            case InstructionID.CLNG: {
                this.save(args[0], VariableValue.newLong(Math.round(toLong(this.readVal(args[1]).val))));
                break;
            }
            case InstructionID.CDBL: {
                this.save(args[0], VariableValue.newDouble(this.readVal(args[1]).val));
                break;
            }
            case InstructionID.CSNG: {
                this.save(args[0], VariableValue.single(kSingleType, this.readVal(args[1]).val));
                break;
            }
            case InstructionID.EXP: {
                this.save(args[0], VariableValue.single(kDoubleType, Math.exp(this.readVal(args[1]).val)));
                break;
            }
            case InstructionID.FIX: {
                this.save(args[0], VariableValue.single(kDoubleType, Math.trunc(this.readVal(args[1]).val)));
                break;
            }
            case InstructionID.INT: {
                this.save(args[0], VariableValue.single(kDoubleType, Math.floor(this.readVal(args[1]).val)));
                break;
            }
            case InstructionID.END: {
                this.end();
                return false;
            }
            default: {
                console.log("Not implemented");
                break;
            }
        }
        return true;
    }

}
