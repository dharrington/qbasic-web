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

// codegen.ts - Generates code for QBasic programs.

import {
    basicType, Coord, ICtx, ILocator, kNullVal, kValTrue, Location, MVal, Token, Val, ValKind,
} from "./parse";
import {
    BaseType, baseTypeToSigil, FunctionType, kDoubleType, kIntType, kLongType,
    kSingleType, kStringType, sigilToBaseType, Type,
} from "./types";
import * as vm from "./vm";

// While writing the program, these bits are added to stack offsets to indicate the type of variable.
// Temporaries have no special bit (start at 0).
const kGlobalBit = 0x40000000;
const kLocalBit = 0x20000000;
const kConstBit = 0x10000000;
const kSpecialBits = kGlobalBit | kLocalBit | kConstBit;

enum CtrlFlowType {
    kIF,
    kFOR,
    kDO,
    kWHILE,
    kSELECT,
}
class CtrlFlow {
    public branchInst?: vm.Instruction;
    public endInstructions: vm.Instruction[] = [];
    public loopStart: number;
    selectValue: Val;
    // SELECT CASE is implemented as a chain of conditionals.
    // For each case, stores two instruction offsets. First is the place to jump to to start the case.
    // Second is the branch instruction that skips over the case when the test fails.
    caseInstOffset: number[][] = [];
    endCaseInstructions: vm.Instruction[] = [];

    constructor(public type: CtrlFlowType) { }
}
class GotoInfo {
    public lineNumber: number;
    public label: string;
    public token: Token;
    constructor(public inst: vm.Instruction) { }
}

class SubroutineInfo {
    public calls: vm.Instruction[] = [];
    public blockInfo = new BlockInfo();
    constructor(public name: string, public args: Val[]) {
    }
}

class BlockInfo {
    public startPc: number = -1;
    public endPC: number = -1;
    public argCount: number = 0;
    public declareInstructions: vm.Instruction[] = [];
}
class FunctionInfo {
    // Many built-in functions are simply passing stack indexes to op-codes.
    // This creates a new FunctionInfo for that case.
    static builtin(type: FunctionType, op?: vm.InstructionID): FunctionInfo {
        const f = new FunctionInfo(type, true);
        if (op) f.builtinOp = op;
        return f;
    }
    public name: string;
    public calls: vm.Instruction[] = [];
    public builtinOp?: vm.InstructionID;
    public blockInfo = new BlockInfo();
    constructor(public type: FunctionType, public builtin: boolean) { }
}
class DataStmtOffset {
    constructor(public instructionIndex: number, public dataOffset: number) { }
}
class RestoreInfo {
    constructor(public restoreInst: vm.Instruction, public lbl: number | string) { }
}
// Data shared by all instances of CodegenCtx when parsing a program.
class GlobalCtx {
    public functions = new Map<string, FunctionInfo>();
    public types: Map<string, Type> = new Map<string, Type>();
    public subs: Map<string, SubroutineInfo> = new Map<string, SubroutineInfo>();
    public constantVals = new Map<string, Val>();
    // Line number label -> instruction offset.
    public lineNumbers: Map<number, number> = new Map<number, number>();
    public labels: Map<string, number> = new Map<string, number>();
    public program: vm.Program = new vm.Program();
    public errors: string[] = [];
    public errorLocations: Location[] = [];
    public gotos: GotoInfo[] = []; // goto, gosub, and return
    public restores: RestoreInfo[] = [];
    public currentLine = 0;
    public dataOffsets: DataStmtOffset[] = [];
    public locator?: ILocator;
    // Has the END instruction been written?
    public isEnd = false;
    public globalVarCount = 0;
    public constCount = 0;

    constructor() {
        this.functions.set("MID",
            FunctionInfo.builtin(new FunctionType(kStringType, [kStringType, kLongType, kLongType], 1), vm.InstructionID.MID));
        this.functions.set("RIGHT",
            FunctionInfo.builtin(new FunctionType(kStringType, [kStringType, kLongType]), vm.InstructionID.RIGHT));
        this.functions.set("LEFT",
            FunctionInfo.builtin(new FunctionType(kStringType, [kStringType, kLongType]), vm.InstructionID.LEFT));
        this.functions.set("CHR",
            FunctionInfo.builtin(new FunctionType(kStringType, [kLongType]), vm.InstructionID.CHR));
        this.functions.set("ASC",
            FunctionInfo.builtin(new FunctionType(kIntType, [kStringType]), vm.InstructionID.ASC));
        this.functions.set("RND",
            FunctionInfo.builtin(new FunctionType(kSingleType, [kIntType], 1), vm.InstructionID.RND));
        this.functions.set("INT",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType]), vm.InstructionID.INT));
        this.functions.set("FIX",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType]), vm.InstructionID.FIX));
        this.functions.set("INKEY",
            FunctionInfo.builtin(new FunctionType(kStringType, []), vm.InstructionID.INKEY));
        this.functions.set("VAL",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kStringType]), vm.InstructionID.VAL));
        this.functions.set("STR",
            FunctionInfo.builtin(new FunctionType(kStringType, [kDoubleType]), vm.InstructionID.STR));
        this.functions.set("TAN",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType]), vm.InstructionID.TAN));
        this.functions.set("SIN",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType]), vm.InstructionID.SIN));
        this.functions.set("COS",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType]), vm.InstructionID.COS));
        this.functions.set("ATN",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType]), vm.InstructionID.ATN));
        this.functions.set("CINT",
            FunctionInfo.builtin(new FunctionType(kIntType, [kDoubleType]), vm.InstructionID.CINT));
        this.functions.set("CLNG",
            FunctionInfo.builtin(new FunctionType(kLongType, [kDoubleType]), vm.InstructionID.CLNG));
        this.functions.set("CDBL",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType]), vm.InstructionID.CDBL));
        this.functions.set("CSNG",
            FunctionInfo.builtin(new FunctionType(kSingleType, [kDoubleType]), vm.InstructionID.CSNG));
        this.functions.set("EXP",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType]), vm.InstructionID.EXP));
        this.functions.set("TIMER",
            FunctionInfo.builtin(new FunctionType(kDoubleType, []), vm.InstructionID.TIMER));
        this.functions.set("LEN",
            FunctionInfo.builtin(new FunctionType(kLongType, [kStringType]), vm.InstructionID.LEN));
        this.functions.set("UCASE",
            FunctionInfo.builtin(new FunctionType(kStringType, [kStringType]), vm.InstructionID.UCASE));
        this.functions.set("LCASE",
            FunctionInfo.builtin(new FunctionType(kStringType, [kStringType]), vm.InstructionID.LCASE));
        this.functions.set("SPACE",
            FunctionInfo.builtin(new FunctionType(kStringType, [kIntType]), vm.InstructionID.SPACE));
        this.functions.set("PEEK",
            FunctionInfo.builtin(new FunctionType(kIntType, [kIntType]), vm.InstructionID.NOP));

        this.functions.set("FRE",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType])));
    }
}

// A parser context that generates bytecode for vm. This is instantiated once for the module-level program,
// and again for each subroutine.
export class CodegenCtx implements ICtx {
    static valConstKey(v: Val): string {
        if (!v.isLiteral() && !v.isConst()) return "";
        return `${v.type}${v.type.isString() ? v.stringValue : v.numberValue}`;
    }

    private static literalVarVal(lit: Val): vm.VariableValue {
        const vv = new vm.VariableValue(lit.type);
        switch (lit.baseType()) {
            case BaseType.kString:
                vv.val = lit.stringValue;
                break;
            case BaseType.kInt:
                vv.val = vm.toInt(lit.numberValue);
                break;
            case BaseType.kLongInt:
                vv.val = vm.toLong(lit.numberValue);
                break;
            case BaseType.kSingle:
                vv.val = Math.fround(lit.numberValue);
                break;
            case BaseType.kDouble:
                vv.val = lit.numberValue;
                break;
        }
        return vv;
    }

    private g: GlobalCtx = new GlobalCtx();
    private dimVars: Map<string, Val> = new Map<string, Val>();
    private autoVars: Map<string, Val> = new Map<string, Val>();
    private constVars: Map<string, Val> = new Map<string, Val>();
    private parent?: CodegenCtx;
    private subInfo?: SubroutineInfo;
    private fnInfo?: FunctionInfo;
    private stackOffset: number = 0;
    private blockInfo = new BlockInfo();
    // Some stack slots can be reserved for use across multiple statements.
    // We assume the other stack slots can be freed at the start of a statement.
    private reservedStackSlots: number = 0;
    private ctrlFlowStack: CtrlFlow[] = [];
    private tempVarCount = 0;
    private finalized: boolean = false;

    private localVarCount = 0;

    constructor() {
        this.blockInfo.startPc = 0;
    }
    setLocator(locator: ILocator) {
        this.g.locator = locator;
    }
    program(): vm.Program { return this.g.program; }
    errors(): string[] { return this.g.errors; }
    errorLocations(): Location[] { return this.g.errorLocations; }
    error(message: string, loc?: Location) {
        if (loc) {
            this.g.errors.push(message + " at " + loc.toString());
            this.g.errorLocations.push(loc);
        } else {
            this.g.errors.push(message);
            this.g.errorLocations.push(new Location(this.g.currentLine, 0));
        }
    }
    defineType(id: Token, t: Type) {
        if (this.g.types.has(id.text)) {
            this.error("duplicate definition", id.loc);
            return;
        }
        if (!t) return;
        this.g.types.set(id.text, t);
    }
    typename(tok: Token): Type | undefined {
        if (tok.text === "INTEGER") { return kIntType; }
        if (tok.text === "STRING") { return kStringType; }
        if (tok.text === "DOUBLE") { return kDoubleType; }
        if (tok.text === "SINGLE") { return kSingleType; }
        if (tok.text === "LONG") { return kLongType; }
        return this.g.types.get(tok.text);
    }
    label(tok: Token) {
        this.g.labels.set(tok.text, this.instructionCount());
    }
    lineNumber(num: number, tok: Token) {
        if (this.g.lineNumbers.has(num)) {
            this.error("duplicate label", tok.loc);
            return;
        }
        this.g.lineNumbers.set(num, this.instructionCount());
    }
    newline(lineNumber: number) {
        this.g.currentLine = lineNumber;
    }
    data(dataArray: Val[]) {
        this.g.dataOffsets.push(new DataStmtOffset(this.program().inst.length, this.program().dataList.length));
        // I've got line numbers and labels mapping to instruction offsets. Since DATA doesn't really need an
        // instruction I instead write a NOP.
        this.emit(vm.InstructionID.NOP);
        for (const v of dataArray) {
            const c = this.constDataVal(v);
            if (!c) {
                this.error("internal error");
                break;
            }
            this.g.program.dataList.push(c.stackOffset & (~kConstBit));
        }
    }
    restore(lbl: string | number) {
        this.g.restores.push(new RestoreInfo(this.emit(vm.InstructionID.RESTORE, 0), lbl));
    }

    read(args: Val[]) {
        const inputs: vm.SingleInput[] = [];
        const S = this.nextStackOffset();
        for (const v of args) {
            if (!v.isVar) {
                this.error("READ parameter not a variable");
                return;
            }
            if (!v.type.isBasic()) {
                this.error("Expected basic type");
                return;
            }
            this.write(vm.InstructionID.READ, S, v.baseType());
            this.assign(v, S);
        }
    }

    endStmt() {
        // It's not possible for a stack variable to be referenced in more than one statement, so we can
        // reuse the stack offsets after each statement.
        this.stackOffset = this.reservedStackSlots;
    }

    findVariable(name: string, sigil: BaseType): Val | undefined {
        // If a variable is defined by DIM or CONST, only a single variable can use that name.
        // Otherwise, an 'auto' variable of each basic type can be used with the same name (X%, X$, etc...)
        {
            const dimVar = this.dimVars.get(name);
            if (dimVar) {
                return dimVar;
            }
        }
        {
            const constVar = this.constVars.get(name);
            if (constVar) {
                return constVar;
            }
        }
        const key = name + baseTypeToSigil(sigil);
        const autoVar = this.autoVars.get(key);
        if (autoVar) return autoVar;
        if (this.parent) {
            const v = this.parent.findVariable(name, sigil);
            if (v && v.shared) return v;
        }
        return undefined;
    }

    // Returns a Val that represents a named variable.
    // If defaultType is provided, creates variable if it doesn't exist.
    variable(varName: Token | string, sigil: BaseType, defaultType?: Type): Val | undefined {
        let name = "";
        let location: Location | undefined;
        if (varName instanceof Token) {
            name = varName.text;
            location = varName.loc;
        } else {
            name = varName as string;
        }
        const existing = this.findVariable(name, sigil);
        if (existing) {
            if (sigil !== BaseType.kNone) {
                if (existing.baseType() !== sigil) {
                    this.error("duplicate definition", location);
                    return undefined;
                }
            }
            return existing;
        }

        if (defaultType === undefined) return undefined;
        const key = name + baseTypeToSigil(sigil);
        const v = Val.newVar(name, defaultType);
        if (!this.parent) {
            v.stackOffset = kGlobalBit | this.g.globalVarCount++;
        } else {
            v.stackOffset = kLocalBit | this.localVarCount++;
        }
        this.autoVars.set(key, v);

        // Write declaration instruction.
        const varVal = vm.VariableValue.single(v.type, vm.zeroValue(v.type));
        // this.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE_VAR, [key, varVal]));
        this.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE, [v.stackOffset, varVal]));
        return v;
    }
    declConst(id: Token, ty: BaseType, value: Val) {
        if (!value.isLiteral()) {
            this.error("cannot assign const to dynamic value");
            return;
        }
        if (ty) {
            if (basicType(ty) !== value.type) {
                this.error("type mismatch");
                return;
            }
        }
        const v = Val.newConst(id.text, value.type, value.type === kStringType ? value.stringValue : value.numberValue);
        this.constVars.set(id.text, v);
    }
    index(v: Val, idx: Val[]): MVal {
        if (v.isVar()) {
            if (!idx) {
                return undefined;
            }
            if (v.argIndex !== undefined) {
                if (!v.isArrayArg) {
                    this.error("not an array variable");
                    return undefined;
                }
            }
            const dims = v.size ? v.size.length : 1;
            // Array arguments can be any number of dimentions :-/
            if (!v.isArrayArg && idx.length !== dims) {
                this.error("wrong number of dimensions");
                return undefined;
            }
            v = v.copy();
            v.index = idx;
            return v;
        }
        this.error("index of this kind not implemented");
        return undefined;
    }

    indexField(v: Val, idx: Token): Val | undefined {
        if (!v.isVar() && !v.isField()) {
            this.error("syntax error");
            return undefined;
        }
        const field = v.type.lookupField(idx.text);
        if (!field) {
            this.error("invalid field");
            return undefined;
        }
        return Val.newField(field.name, field.type, v);
    }

    dim(name: Token | string, size: Val[][] | undefined, ty: Type, shared: boolean) {
        const nameText = name instanceof Token ? name.text : name as string;
        const loc = name instanceof Token ? name.loc : undefined;
        if (this.dimVars.has(nameText)) {
            this.error("duplicate definition", loc);
            return;
        }
        for (const suffix of ["$", "%", "&", "!", "#", ""]) {
            if (this.autoVars.has(nameText + suffix)) {
                this.error("duplicate definition", loc);
                return;
            }
        }
        let numericSize: number[] | undefined;
        if (size) {
            numericSize = [];
            for (const s of size) {
                const sAsNumeric: number[] = [];
                for (const sv of s) {
                    if ((sv.isLiteral() || sv.isConst()) && sv.type.isNumeric()) {
                        sAsNumeric.push(sv.numberValue);
                    } else {
                        this.error("expected constant numeric value", sv.loc());
                    }
                }
                numericSize.push(sAsNumeric[sAsNumeric.length - 1]);
            }
        }
        const v = Val.newVar(nameText, ty, numericSize);
        if (!this.parent || shared) {
            v.stackOffset = kGlobalBit | this.g.globalVarCount++;
        } else {
            v.stackOffset = kLocalBit | this.localVarCount++;
        }
        v.dimmed = true;
        if (shared) v.shared = true;
        this.dimVars.set(nameText, v);
        const vv = vm.VariableValue.single(v.type, vm.zeroValue(v.type));
        vv.dims = numericSize;
        // this.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE_VAR, [name.text, vv]));
        this.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE, [v.stackOffset, vv]));
    }

    binaryOpType(a: Type, b: Type): Type {
        if (a.type === BaseType.kString && b.type === BaseType.kString) {
            return kStringType;
        }
        if (a.type === BaseType.kString || b.type === BaseType.kString || a.type === BaseType.kUserType || b.type === BaseType.kUserType) {
            this.error("invalid type");
            return a;
        }
        if (a.type === BaseType.kDouble || b.type === BaseType.kDouble) return kDoubleType;
        if (a.type === BaseType.kSingle || b.type === BaseType.kSingle) return kSingleType;
        if (a.type === BaseType.kLongInt || b.type === BaseType.kLongInt) return kLongType;
        if (a.type === BaseType.kInt || b.type === BaseType.kInt) return kIntType;
        this.error("invalid type");
        return a;
    }
    convert(v: Val, ty: Type): MVal {
        if (v.type.equals(ty)) {
            return v;
        } else {
            if (v.type.isNumeric() && ty.isNumeric()) {
                switch (ty.type) {
                    case BaseType.kInt: {
                        const result = Val.newStackValue(kIntType, this.nextStackOffset());
                        this.write(vm.InstructionID.TO_INT, result, v);
                        return result;
                    }
                    case BaseType.kLongInt: {
                        const result = Val.newStackValue(kLongType, this.nextStackOffset());
                        this.write(vm.InstructionID.TO_LONG, result, v);
                        return result;
                    }
                    case BaseType.kSingle: {
                        const result = Val.newStackValue(kSingleType, this.nextStackOffset());
                        this.write(vm.InstructionID.TO_SINGLE, result, v);
                        return result;
                    }
                    case BaseType.kDouble: {
                        const result = Val.newStackValue(kDoubleType, this.nextStackOffset());
                        this.write(vm.InstructionID.TO_DOUBLE, result, v);
                        return result;
                    }
                }
                return undefined;
            }
            this.error("cannot convert value");
            return undefined;
        }
    }
    pushCompatibleOperands(a: Val, b: Val): Val[] | undefined {
        // TODO: This is kind of half-baked, need to ensure operators work like they're supposed to with mixed types.
        const type = this.binaryOpType(a.type, b.type);
        const aa = this.convert(a, type);
        const bb = this.convert(b, type);
        if (aa && bb) return [aa, bb];
        return undefined;
    }

    op(name: string, O: Val[]): MVal {
        switch (name) {
            // TODO: ^, EQV, IMP.
            case "CLS": {
                this.write(vm.InstructionID.CLS);
                return undefined;
            }
            case "=": { // equality
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.EQ, r, C[0], C[1]);
                return r;
            }
            case ">=": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.GTE, r, C[0], C[1]);
                return r;
            }
            case "<=": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.LTE, r, C[0], C[1]);
                return r;
            }
            case ">": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.GT, r, C[0], C[1]);
                return r;
            }
            case "<": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.LT, r, C[0], C[1]);
                return r;
            }
            case "<>": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.NEQ, r, C[0], C[1]);
                return r;
            }
            case "OR": {
                if (!this.expectNumeric(O[0]) || !this.expectNumeric(O[1])) return kNullVal;
                const a = O[0];
                const b = O[1];
                const r = this.newStackValue(kLongType);
                this.write(vm.InstructionID.OR, r, a, b);
                return r;
            }
            case "AND": {
                if (!this.expectNumeric(O[0]) || !this.expectNumeric(O[1])) return kNullVal;
                const a = O[0];
                const b = O[1];
                const r = this.newStackValue(kLongType);
                this.write(vm.InstructionID.AND, r, a, b);
                return r;
            }
            case "XOR": {
                if (!this.expectNumeric(O[0]) || !this.expectNumeric(O[1])) return kNullVal;
                const a = O[0];
                const b = O[1];
                const r = this.newStackValue(kLongType);
                this.write(vm.InstructionID.XOR, r, a, b);
                return r;
            }
            case "assign": {
                // TODO: Check types
                const v = O[0];
                const val = O[1];
                this.assign(v, this.stackify(val).stackOffset);
                return kNullVal;
            }
            case "ABS": {
                const r = Val.newStackValue(O[0].type, this.nextStackOffset());
                this.write(vm.InstructionID.ABS, r, O[0]);
                return r;
            }
            case "PRINT": {
                let endsWithSeparator = false;
                const printArgs: any[] = [];
                for (const arg of O) {
                    endsWithSeparator = false;
                    if (arg.isCommaDelim()) {
                        endsWithSeparator = true;
                        printArgs.push(Val.newStringLiteral("\t"));
                    } else if (arg.isSemicolonDelim()) {
                        endsWithSeparator = true;
                    } else {
                        printArgs.push(arg);
                    }
                }
                if (!endsWithSeparator) {
                    printArgs.push(Val.newStringLiteral("\n"));
                }
                this.write(vm.InstructionID.PRINT, ...printArgs);
                return undefined;
            }
            case "SWAP": {
                if (O[0].type !== O[1].type) {
                    this.error("SWAP with mismatched types");
                    return undefined;
                }
                const [a, b] = O;
                const as = this.nextStackOffset();
                const bs = this.nextStackOffset();
                const av = this.loadVar(as, a);
                const bv = this.loadVar(bs, b);
                this.assign(a, bs);
                this.assign(b, as);
                return undefined;
            }
            case "+": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(C[0].type);
                this.write(vm.InstructionID.ADD, r, C[0], C[1]);
                return r;
            }
            case "-": {
                if (O.length === 1) {
                    // unary
                    const unaryResult = this.newStackValue(O[0].type);
                    this.write(vm.InstructionID.NEG, unaryResult, O[0]);
                    return unaryResult;
                }
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(C[0].type);
                this.write(vm.InstructionID.SUB, r, C[0], C[1]);
                return r;
            }
            case "*": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(C[0].type);
                this.write(vm.InstructionID.MUL, r, C[0], C[1]);
                return r;
            }
            case "/": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(kDoubleType);
                this.write(vm.InstructionID.DIV, r, C[0], C[1]);
                return r;
            }
            case "\\": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(kLongType);
                this.write(vm.InstructionID.IDIV, r, C[0], C[1]);
                return r;
            }
            case "MOD": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(kLongType);
                this.write(vm.InstructionID.MOD, r, C[0], C[1]);
                return r;
            }
            case "NOT": {
                const r = this.newStackValue(kLongType);
                this.write(vm.InstructionID.NOT, r, O[0]);
                return r;
            }
            case "LNOT": {
                const r = this.newStackValue(kLongType);
                this.write(vm.InstructionID.LOGICNOT, r, O[0]);
                return r;
            }
            default: {
                this.error("internal: operator not implemented");
            }
        }
        return undefined;
    }

    declSub(id: Token, args: Val[]) {
        this.g.subs.set(id.text, new SubroutineInfo(id.text, args));
    }
    declFunction(id: Token, sigil: BaseType, type: Type, args: Val[]) {
        const argTypes = args.map((a) => a.type);
        const fn = new FunctionInfo(new FunctionType(type, argTypes), false);
        fn.name = id.text;
        this.g.functions.set(fn.name, fn);
    }
    // At the end of the program lies the END instruction. Below that point, only subroutine code is present.
    // Defining a subroutine will implicitly mark the end of the program.
    setEnd() {
        if (!this.g.isEnd) {
            this.g.isEnd = true;
            this.write(vm.InstructionID.END);
            this.blockInfo.endPC = this.program().inst.length - 1;
        }
    }
    sub(id: Token, args: Val[]): ICtx {
        this.setEnd();
        let sub = this.g.subs.get(id.text);
        if (!sub) {
            this.declSub(id, args);
            sub = this.g.subs.get(id.text) as SubroutineInfo;
        } else if (sub.blockInfo.startPc >= 0) {
            this.error("duplicate subroutine name", id.loc);
            return this;
        }
        if (this.parent) {
            this.error("subroutine must be at the module level");
            return this;
        }
        const subCtx = new CodegenCtx();
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a.kind !== ValKind.kArgument) {
                this.error("internal error");
                return this;
            }
            const argVal = Val.newVar(a.varName, a.type, a.size);
            // argVal.argIndex = i;
            argVal.stackOffset = i;
            if (a.isArrayArg) argVal.isArrayArg = true;
            if (a.dimmed) {
                argVal.dimmed = true;
                subCtx.dimVars.set(argVal.varName, argVal);
            } else {
                subCtx.autoVars.set(this.autoVarKey(argVal), argVal);
            }
        }
        subCtx.reservedStackSlots = args.length;
        subCtx.stackOffset = args.length;
        sub.blockInfo.argCount = args.length;
        sub.blockInfo.startPc = this.instructionCount();
        subCtx.g = this.g;
        subCtx.parent = this;
        subCtx.subInfo = sub;
        subCtx.blockInfo = sub.blockInfo;
        return subCtx;
    }

    subExit() {
        if (!this.subInfo) {
            this.error("EXIT outside of sub");
            return;
        }
        this.write(vm.InstructionID.EXIT_SUB);
    }

    functionBegin(id: Token, sigil: BaseType, returnType: Type, args: Val[]): ICtx {
        this.setEnd();
        let fn = this.g.functions.get(id.text);
        if (!fn) {
            this.declFunction(id, sigil, returnType, args);
            fn = this.g.functions.get(id.text) as FunctionInfo;
        } else if (fn.blockInfo.startPc >= 0) {
            this.error("function already defined");
            return this;
        }
        if (this.parent) {
            this.error("function must be at the module level");
            return this;
        }
        const fnCtx = new CodegenCtx();
        fnCtx.g = this.g;
        fnCtx.parent = this;
        fnCtx.blockInfo = fn.blockInfo;
        fn.blockInfo.argCount = args.length + 1;
        fn.blockInfo.startPc = this.instructionCount();

        const retVal = Val.newVar(id.text, returnType);
        retVal.dimmed = true;
        retVal.stackOffset = 0;
        // fnCtx.stackOffset = this.stackOffset;
        fnCtx.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE, [retVal.stackOffset, vm.VariableValue.single(retVal.type, vm.zeroValue(retVal.type))]));
        fnCtx.dimVars.set(retVal.varName, retVal);
        //fnCtx.dim(id, undefined, returnType, false);
        //const retVal = fnCtx.dimVars.get(id.text);
        // fnCtx.dimVars.set(retVal.varName, retVal);
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a.kind !== ValKind.kArgument) {
                this.error("internal error");
                return this;
            }
            const argVal = Val.newVar(a.varName, a.type, a.size);
            argVal.stackOffset = i + 1;
            if (a.isArrayArg) argVal.isArrayArg = true;
            if (a.dimmed) {
                argVal.dimmed = true;
                fnCtx.dimVars.set(argVal.varName, argVal);
            } else {
                fnCtx.autoVars.set(this.autoVarKey(argVal), argVal);
            }
        }
        fnCtx.reservedStackSlots = args.length + 1;
        fnCtx.stackOffset = args.length + 1;
        fnCtx.localVarCount = args.length + 1;
        fnCtx.fnInfo = fn;

        // fnCtx.dim(id, undefined, returnType, false);
        return fnCtx;
    }

    functionExit() {
        if (!this.fnInfo) {
            this.error("EXIT FUNCTION outside of FUNCTION");
            return;
        }
        this.write(vm.InstructionID.EXIT_SUB);
    }

    declArg(id: Token, isArray: boolean, ty: Type | undefined, dimmedType: boolean): Val {
        const v = new Val();
        v.type = ty || kIntType;
        v.kind = ValKind.kArgument;
        v.varName = id.text;
        v.isArrayArg = isArray;
        if (dimmedType) v.dimmed = true;
        return v;
    }

    endSub() {
        if (!this.subInfo) {
            this.error("internal error");
            return;
        }
        this.write(vm.InstructionID.EXIT_SUB);
        this.subInfo.blockInfo.endPC = this.instructionCount() - 1;
    }
    endFunction() {
        if (!this.fnInfo) {
            this.error("internal error");
            return;
        }
        this.write(vm.InstructionID.EXIT_SUB);
        this.fnInfo.blockInfo.endPC = this.instructionCount() - 1;
    }
    isSub(id: string): boolean {
        return this.g.subs.has(id);
    }
    isFunction(id: string): boolean {
        return this.g.functions.has(id);
    }
    lookupFunction(id: string): FunctionType | undefined {
        const f = this.g.functions.get(id);
        if (!f) return undefined;
        return f.type;
    }
    callSub(id: Token, args: Val[]) {
        const sub = this.g.subs.get(id.text);
        if (!sub) {
            this.error("not a subroutine");
            return;
        }
        // TODO: check args
        const callStackOffset = this.stackOffset;
        // Parameters are passed by reference.
        for (const arg of args) {
            if (!arg) return;
            const s = this.stackify(arg).stackOffset;
            const addrS = this.stackOffset++;
            if (s & kConstBit) {
                this.write(vm.InstructionID.COPY, addrS, s);
            } else {
                this.write(vm.InstructionID.ADDRESS, addrS, s);
            }
        }
        // The VM doesn't know how much stack is actually in-use, so we have to tell it when calling a function.
        sub.calls.push(this.emit(vm.InstructionID.CALL_SUB, 0/*pc*/, callStackOffset));
    }

    callFunction(id: string, args: Val[]): MVal {
        const f = this.g.functions.get(id);
        if (!f) return undefined;
        if (f.builtin && f.builtinOp) {
            const r = this.newStackValue(f.type.resultType);
            this.write(f.builtinOp, r, ...args);
            return r;
        }
        if (f.builtin) {
            switch (id) {
                case "FRE": {
                    return this.constNumber(47724, kLongType); // free memory: just fake it!
                }
            }
            this.error("not implemented");
            return undefined;
        }

        // TODO: check args
        // make the return variable
        const callStackOffset = this.stackOffset;
        const returnVal = this.newStackValue(f.type.resultType);

        // Parameters are passed by reference.
        for (const arg of args) {
            if (!arg) return;
            const s = this.stackify(arg).stackOffset;
            const addrS = this.stackOffset++;
            if (s & kConstBit) {
                this.write(vm.InstructionID.COPY, addrS, s);
            } else {
                this.write(vm.InstructionID.ADDRESS, addrS, s);
            }
        }

        f.calls.push(this.emit(vm.InstructionID.CALL_FUNCTION, 0/*pc*/, callStackOffset));
        this.stackOffset = callStackOffset + 1;
        return returnVal;
    }

    input(keepCursor: boolean, prompt: string, args: Val[]) {
        const inputs: vm.SingleInput[] = [];
        for (const v of args) {
            if (!v.isVar) {
                this.error("INPUT parameter not a variable");
                return;
            }
            if (!v.type.isBasic()) {
                this.error("Expected basic type");
                return;
            }
            inputs.push(new vm.SingleInput(v.baseType(), this.nextStackOffset()));
        }
        this.write(vm.InstructionID.INPUT, new vm.InputSpec(keepCursor, prompt, inputs));
        for (let i = 0; i < args.length; i++) {
            this.assign(args[i], inputs[i].stackOffset);
        }
    }
    ifBegin(cond: Val) {
        cond = this.stackify(cond);
        const flow = new CtrlFlow(CtrlFlowType.kIF);
        flow.branchInst = this.write(vm.InstructionID.BRANCH_IFNOT, 0/*filled in later*/, cond);
        this.ctrlFlowStack.push(flow);
    }
    elseBegin(cond?: Val) {
        const flow = this.ctrlFlow(CtrlFlowType.kIF);
        if (!flow) return; // should be caught by parser.
        flow.endInstructions.push(this.emit(vm.InstructionID.BRANCH, 0/*filled in later*/));
        if (flow.branchInst) flow.branchInst.args[0] = this.instructionCount();
        if (cond) {
            flow.branchInst = this.write(vm.InstructionID.BRANCH_IFNOT, 0/*filled in later*/, cond);
        } else {
            flow.branchInst = undefined;
        }
    }
    ifEnd() {
        const flow = this.ctrlFlow(CtrlFlowType.kIF);
        if (!flow) return;
        if (flow.branchInst) {
            flow.branchInst.args[0] = this.instructionCount();
        }
        for (const ei of flow.endInstructions) {
            ei.args[0] = this.instructionCount();
        }
        this.ctrlFlowStack.pop();
    }
    selectBegin(v: Val) {
        const flow = new CtrlFlow(CtrlFlowType.kSELECT);
        this.ctrlFlowStack.push(flow);
        flow.selectValue = this.stackify(v, true);
    }
    selectCase(vs: Val[]) {
        const flow = this.ctrlFlow();
        if (!flow) return;
        if (flow.caseInstOffset.length > 0) {
            flow.endCaseInstructions.push(this.emit(vm.InstructionID.BRANCH, 0));
        }
        const testpc = this.program().inst.length;
        let testResult = this.op("=", [flow.selectValue, vs[0]]);
        if (!testResult) return;
        for (let i = 1; i < vs.length; ++i) {
            const next = this.op("=", [flow.selectValue, vs[i]]);
            if (!next || !testResult) return;
            testResult = this.op("OR", [testResult, next]);
        }

        const branchpc = this.program().inst.length;
        this.write(vm.InstructionID.BRANCH_IFNOT, 0, testResult);
        flow.caseInstOffset.push([testpc, branchpc]);
    }
    selectCaseElse() {
        const flow = this.ctrlFlow();
        if (!flow) return;
        flow.endCaseInstructions.push(this.emit(vm.InstructionID.BRANCH, 0));
        const offset = this.program().inst.length;
        this.emit(vm.InstructionID.NOP);
        flow.caseInstOffset.push([offset, -1]);
    }
    selectEnd() {
        const flow = this.ctrlFlow();
        if (!flow) return;
        const endPos = this.program().inst.length;
        for (const inst of flow.endCaseInstructions) {
            inst.args[0] = endPos;
        }
        for (let i = 0; i < flow.caseInstOffset.length; ++i) {
            const [testOffset, branchOffset] = flow.caseInstOffset[i];
            if (branchOffset >= 0) {
                const branch = this.program().inst[branchOffset];
                if (i + 1 < flow.caseInstOffset.length) {
                    branch.args[0] = flow.caseInstOffset[i + 1][0];
                } else {
                    branch.args[0] = endPos;
                }
            }
        }
        this.ctrlFlowStack.pop();
        if (flow.selectValue.stackOffset >= 0) {
            this.reservedStackSlots--;
        }
    }
    forBegin(idx: Val, from: Val, to: Val, step: Val | null) {
        if (!idx.isVar() || !idx.type.isNumeric()) {
            this.error("invalid index");
            return;
        }
        const ctrlFlow = new CtrlFlow(CtrlFlowType.kFOR);
        this.assign(idx, this.stackify(from).stackOffset);
        step = step ? this.stackify(step) : this.constNumber(1, idx.type);
        to = this.stackify(to);
        const condVal = this.newStackValue(kIntType);
        const branch0 = this.emit(vm.InstructionID.BRANCH, 0);
        ctrlFlow.loopStart = this.instructionCount();
        const idxOnStack = this.stackify(idx);
        this.write(vm.InstructionID.ADD, idxOnStack, idxOnStack, step);
        this.assign(idx, idxOnStack.stackOffset);
        branch0.args[0] = this.instructionCount();
        this.loadVar(idxOnStack.stackOffset, idx); // This has no effect except for first pass where STEP isn't applied.
        this.write(vm.InstructionID.LTE, condVal, idxOnStack, to);
        ctrlFlow.branchInst = this.write(vm.InstructionID.BRANCH_IFNOT, 0, condVal);
        this.ctrlFlowStack.push(ctrlFlow);
    }
    forExit() {
        const flow = this.ctrlFlow(CtrlFlowType.kFOR);
        if (flow) {
            flow.endInstructions.push(this.emit(vm.InstructionID.BRANCH, 0));
        }
    }
    forEnd() {
        const flow = this.ctrlFlow(CtrlFlowType.kFOR);
        if (!flow) return;
        this.ctrlFlowStack.pop();
        this.write(vm.InstructionID.BRANCH, flow.loopStart);
        if (flow.branchInst) flow.branchInst.args[0] = this.instructionCount();
        for (const ei of flow.endInstructions) {
            ei.args[0] = this.instructionCount();
        }
    }
    doBegin() {
        const ctrlFlow = new CtrlFlow(CtrlFlowType.kDO);
        ctrlFlow.loopStart = this.program().inst.length;
        this.ctrlFlowStack.push(ctrlFlow);
    }
    doWhileCond(cond: Val) {
        const ctrlFlow = this.ctrlFlow() as CtrlFlow;
        ctrlFlow.branchInst = this.write(vm.InstructionID.BRANCH_IFNOT, 0, cond);
    }
    doExit() {
        const flow = this.ctrlFlow(CtrlFlowType.kDO);
        if (!flow) return;
        flow.endInstructions.push(this.emit(vm.InstructionID.BRANCH, 0));
    }
    doEnd(untilCond: Val) {
        const flow = this.ctrlFlow();
        if (!flow || flow.type !== CtrlFlowType.kDO) {
            return; // should be caught by parser.
        }
        if (untilCond) {
            this.write(vm.InstructionID.BRANCH_IFNOT, flow.loopStart, untilCond);
        } else {
            this.write(vm.InstructionID.BRANCH, flow.loopStart);
        }
        const endPC = this.program().inst.length;
        if (flow.branchInst) {
            flow.branchInst.args[0] = endPC;
        }
        for (const ei of flow.endInstructions) {
            ei.args[0] = endPC;
        }
        this.ctrlFlowStack.pop();
    }
    whileBegin() {
        const ctrlFlow = new CtrlFlow(CtrlFlowType.kWHILE);
        ctrlFlow.loopStart = this.program().inst.length;
        this.ctrlFlowStack.push(ctrlFlow);
    }
    whileCond(cond: Val) {
        const ctrlFlow = this.ctrlFlow();
        if (!ctrlFlow) return;
        ctrlFlow.branchInst = this.write(vm.InstructionID.BRANCH_IFNOT, 0, cond);
    }
    wend() {
        const flow = this.ctrlFlow();
        if (!flow || flow.type !== CtrlFlowType.kWHILE) {
            return; // should be caught by parser.
        }
        this.write(vm.InstructionID.BRANCH, flow.loopStart);
        const endPC = this.program().inst.length;
        if (flow.branchInst) {
            flow.branchInst.args[0] = endPC;
        }
        this.ctrlFlowStack.pop();
    }
    gotoLine(no: number, tok: Token) {
        const g = new GotoInfo(this.emit(vm.InstructionID.BRANCH, 0));
        g.lineNumber = no;
        g.token = tok;
        this.g.gotos.push(g);
    }
    gotoLabel(lbl: Token) {
        const g = new GotoInfo(this.emit(vm.InstructionID.BRANCH, 0));
        g.label = lbl.text;
        g.token = lbl;
        this.g.gotos.push(g);
    }
    goReturn(token: Token | undefined, lbl: number | string | undefined) {
        if (lbl === undefined) {
            this.emit(vm.InstructionID.EXIT_SUB);
            return;
        }
        const g = new GotoInfo(this.emit(vm.InstructionID.RETURN, 0/*pc*/));
        if (token) g.token = token;
        if (typeof (lbl) === "number") {
            g.lineNumber = lbl;
        } else if (lbl !== undefined) {
            g.label = lbl;
        }
        this.g.gotos.push(g);
    }
    gosub(token: Token, lbl: number | string) {
        const g = new GotoInfo(this.emit(vm.InstructionID.GOSUB, 0/*pc*/, this.stackOffset));
        g.token = token;
        if (typeof (lbl) === "number") {
            g.lineNumber = lbl;
        } else {
            g.label = lbl;
        }
        this.g.gotos.push(g);
    }
    locate(x: Val, y: Val) {
        this.write(vm.InstructionID.LOCATE, x, y);
    }
    color(fore: Val, back: Val) {
        if (!fore) {
            fore = this.constNumber(-1, kIntType);
        }
        if (!back) {
            back = this.constNumber(-1, kIntType);
        }
        this.write(vm.InstructionID.COLOR, fore, back);
    }
    palette(attr: Val, col: Val) {
        if (!attr) {
            this.write(vm.InstructionID.PALETTE);
            return;
        }
        this.write(vm.InstructionID.PALETTE, attr, col);
    }
    sleep(delay?: Val) {
        if (delay) this.write(vm.InstructionID.SLEEP, delay);
        else this.write(vm.InstructionID.SLEEP);
    }
    pset(a: Coord, color: Val) {
        if (!a) return;
        let x1: Val;
        let y1: Val;
        if (a.step) {
            const oldx = this.newStackValue(kIntType);
            const oldy = this.newStackValue(kIntType);
            this.write(vm.InstructionID.GET_DRAW_POS, oldx, oldy);
            x1 = this.newStackValue(kIntType);
            y1 = this.newStackValue(kIntType);
            this.write(vm.InstructionID.ADD, x1, oldx, a.x);
            this.write(vm.InstructionID.ADD, y1, oldy, a.y);
        } else {
            x1 = a.x;
            y1 = a.y;
        }

        const args: any[] = [x1, y1, null];
        if (color) {
            args[2] = color;
        }
        this.write(vm.InstructionID.PSET, ...args);
    }
    line(a: Coord, b: Coord, color: Val, option: string, style?: Val) {
        let x1: Val;
        let y1: Val;
        if (!a) {
            x1 = this.newStackValue(kIntType);
            y1 = this.newStackValue(kIntType);
            this.write(vm.InstructionID.GET_DRAW_POS, x1, y1);
        } else {
            if (a.step) {
                const oldx = this.newStackValue(kIntType);
                const oldy = this.newStackValue(kIntType);
                this.write(vm.InstructionID.GET_DRAW_POS, oldx, oldy);
                x1 = this.newStackValue(kIntType);
                y1 = this.newStackValue(kIntType);
                this.write(vm.InstructionID.ADD, x1, oldx, a.x);
                this.write(vm.InstructionID.ADD, y1, oldy, a.y);
            } else {
                x1 = a.x;
                y1 = a.y;
            }
        }
        if (!b) {
            this.error("to-coordinate missing");
            return;
        }
        let x2: Val;
        let y2: Val;
        if (b.step) {
            x2 = this.newStackValue(kIntType);
            y2 = this.newStackValue(kIntType);
            this.write(vm.InstructionID.ADD, x2, x1, b.x);
            this.write(vm.InstructionID.ADD, y2, y1, b.y);
        } else {
            x2 = b.x;
            y2 = b.y;
        }
        const args: any[] = [x1, y1, x2, y2, null, null, null];
        if (color) {
            args[4] = color;
        }
        if (option) {
            args[5] = option;
        }
        if (style !== null) {
            args[6] = style;
        }
        this.write(vm.InstructionID.LINE, ...args);
    }
    screen(id: Val) {
        if (!id || !id.type.isNumeric()) {
            this.error("expected number");
            return;
        }
        this.write(vm.InstructionID.SCREEN, id);
    }
    randomize(seed: Val) {
        this.write(vm.InstructionID.RANDOMIZE, seed);
    }
    insertInstructions(pos: number, count: number) {
        if (count <= 0) return;
        const prog = this.program();
        for (const inst of prog.inst) {
            if (!vm.BranchInstructions.has(inst.id)) continue;
            const n = inst.args[0] as number;
            if (n > pos) {
                inst.args[0] = n + count;
            }
        }
        for (let i = 0; i < count; i++) {
            prog.inst.push(undefined as any);
        }
        for (let i = prog.inst.length - 1; i >= pos + count; i--) {
            prog.inst[i] = prog.inst[i - count];
            prog.inst[i - count] = undefined as any;
            const line = this.g.program.instToLine.get(i - count);
            if (line !== undefined) {
                this.g.program.instToLine.delete(i - count);
                this.g.program.instToLine.set(i, line);
            }
        }
        for (const b of this.allBlocks()) {
            if (b.startPc > pos) {
                b.startPc += count;
            }
            if (b.endPC >= pos) {
                b.endPC += count;
            }
        }
    }
    insertDeclareInstructions(pos: number, declares: vm.Instruction[]) {
        this.insertInstructions(pos, declares.length);
        const prog = this.program();
        for (let i = 0; i < declares.length; i++) {
            prog.inst[i + pos] = declares[i];
        }
    }

    finalize() {
        if (!this.g.isEnd) this.setEnd();
        if (this.finalized) {
            throw new Error("already finalized");
        }
        for (const r of this.g.restores) {
            let pc;
            if (typeof (r.lbl) === "string") {
                pc = this.g.labels.get(r.lbl);
                if (pc === undefined) {
                    this.error("label not found");
                    continue;
                }
            } else {
                pc = this.g.lineNumbers.get(r.lbl);
                if (pc === undefined) {
                    this.error("line number not found");
                    continue;
                }
            }
            r.restoreInst.args[0] = 1 << 32;
            for (const d of this.g.dataOffsets) {
                if (pc <= d.instructionIndex) {
                    r.restoreInst.args[0] = d.dataOffset;
                    break;
                }
            }
        }
        for (const [name, sub] of this.g.subs) {
            for (const call of sub.calls) {
                call.args[0] = sub.blockInfo.startPc;
            }
        }
        for (const [name, fn] of this.g.functions) {
            for (const call of fn.calls) {
                call.args[0] = fn.blockInfo.startPc;
            }
        }
        for (const g of this.g.gotos) {
            let pc: number | undefined;
            if (g.label) {
                pc = this.g.labels.get(g.label);
                if (pc === undefined) {
                    this.error("label not found", g.token.loc);
                    continue;
                }
            } else {
                pc = this.g.lineNumbers.get(g.lineNumber);
                if (pc === undefined) {
                    this.error("line number not found", g.token.loc);
                    continue;
                }
            }
            g.inst.args[0] = pc;
        }
        // DECLARE_VAR instructions need to be first in the main module, and in each sub/function.
        // Insert these instructions now, starting with the last block.
        // This is only safe at the end of finalize, since some instruction indices are not updated.
        const allBlocks = this.allBlocks();
        for (let i = allBlocks.length - 1; i >= 0; i--) {
            const b = allBlocks[i];
            if (b.declareInstructions.length) {
                this.insertDeclareInstructions(b.startPc, b.declareInstructions);
            }
        }

        // Shift stack offsets to make room for constant, global, and local variables.
        const constCount = this.g.program.data.length;
        const globalCount = this.g.globalVarCount;
        for (const b of allBlocks) {
            let shiftCount = b.declareInstructions.length;
            if (b === this.blockInfo) {
                shiftCount += constCount + globalCount;
            }
            for (let i = b.startPc; i <= b.endPC; i++) {
                const inst = this.program().inst[i];
                inst.mapStackOffset((s) => {
                    switch ((s & kSpecialBits)) {
                        case 0: return s < b.argCount ? s : s + shiftCount;
                        case kGlobalBit: return (s ^ kGlobalBit) + constCount | vm.kGlobalBit;
                        case kConstBit: return s ^ (kConstBit | vm.kGlobalBit);
                        case kLocalBit: return (s ^ kLocalBit) + b.argCount;
                    }
                    return s;
                });
            }
            for (let i = b.startPc; i <= b.endPC; i++) {
                const inst = this.program().inst[i];
                if (inst.id === vm.InstructionID.CALL_SUB || inst.id === vm.InstructionID.CALL_FUNCTION) {
                    inst.args[1] += shiftCount;
                }
            }
        }

        this.finalized = true;
    }

    end() {
        this.write(vm.InstructionID.END);
    }
    private allBlocks(): BlockInfo[] {
        const allBlocks: BlockInfo[] = [this.blockInfo];
        for (const [name, f] of this.g.functions) {
            if (f.blockInfo.startPc >= 0) allBlocks.push(f.blockInfo);
        }
        for (const [name, s] of this.g.subs) {
            if (s.blockInfo.startPc >= 0) allBlocks.push(s.blockInfo);
        }
        allBlocks.sort((a, b) => a.startPc - b.startPc);
        return allBlocks;
    }
    private assign(variable: Val, stackPos: number) {
        let index: number[] | undefined;
        let fieldIndex: number[] | undefined;
        let baseVar = variable;
        if (variable.isField()) {
            fieldIndex = [];
            const result = this.fieldToVarAndIndex(variable, fieldIndex);
            if (!result) return;
            baseVar = result;
        }
        if (baseVar.index) {
            index = baseVar.index.map((i) => this.stackify(i).stackOffset);
        }

        this.write(vm.InstructionID.ASSIGN, baseVar.stackOffset, stackPos, index, fieldIndex);
    }
    private constNumber(n: number, ty: Type): Val {
        return this.stackify(Val.newNumberLiteral(n, ty));
    }
    private ctrlFlow(type?: CtrlFlowType): CtrlFlow | undefined {
        if (!type && this.ctrlFlowStack.length) return this.ctrlFlowStack[this.ctrlFlowStack.length - 1];
        for (let i = this.ctrlFlowStack.length - 1; i >= 0; i--) {
            if (this.ctrlFlowStack[i].type === type) return this.ctrlFlowStack[i];
        }
        return undefined;
    }
    private reserveStackSlot(): number {
        if (this.stackOffset !== this.reservedStackSlots) {
            this.error("internal error");
            return 0;
        }
        return this.reservedStackSlots++;
    }
    private nextStackOffset(): number {
        return this.stackOffset++;
    }
    private autoVarKey(v: Val): string {
        return v.baseType() === BaseType.kSingle ? v.varName : v.varName + baseTypeToSigil(v.baseType());
    }
    private varAddr(v: Val): string {
        if (v.isVar()) {
            if (v.dimmed) return v.varName;
            const autoKey = this.autoVarKey(v);
            const autoVar = this.autoVars.get(autoKey);
            if (autoVar) return autoKey;
            this.autoVars.set(autoKey, Val.newVar(v.varName, v.type));
            // this.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE_VAR, [autoKey, vm.VariableValue.single(v.type, vm.zeroValue(v.type))]));
            //            v.stackOffset = this.nextVarNumber++;

            if (!this.parent) {
                v.stackOffset = kGlobalBit | this.g.globalVarCount++;
            } else {
                v.stackOffset = kLocalBit | this.localVarCount++;
            }
            this.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE, [v.stackOffset, vm.VariableValue.single(v.type, vm.zeroValue(v.type))]));
            return autoKey;
        }
        return "";
    }
    private newStackValue(ty: Type): Val {
        return Val.newStackValue(ty, this.nextStackOffset());
    }
    private fieldToVarAndIndex(field: Val, fieldIndex: number[]): Val | undefined {
        let base = field.fieldBase;
        if (!base) return undefined;
        const idx = base.type.lookupFieldOffset(field.varName);
        if (idx === undefined) return undefined;
        if (base.isField()) {
            const result = this.fieldToVarAndIndex(base, fieldIndex);
            if (!result) return undefined;
            base = result;
        } else if (!base.isVar()) {
            this.error("internal error");
            return undefined;
        }
        fieldIndex.push(idx);
        return base;
    }
    private loadVar(stackIndex: number, variable: Val): Val | undefined {
        let index: number[] | undefined;
        let fieldIndex: number[] | undefined;
        let baseVar = variable;
        if (variable.isField()) {
            fieldIndex = [];
            const result = this.fieldToVarAndIndex(variable, fieldIndex);
            if (!result) return;
            baseVar = result;
        }
        if (baseVar.index) {
            index = baseVar.index.map((i) => this.stackify(i).stackOffset);
        }
        this.write(vm.InstructionID.LOAD, stackIndex, baseVar.stackOffset, index, fieldIndex);
        return Val.newStackValue(variable.type, stackIndex);
    }
    private constDataVal(v: Val): Val | undefined {
        if (v.isLiteral() || v.isConst()) {
            const key = CodegenCtx.valConstKey(v);
            const constVal = this.g.constantVals.get(key);
            if (constVal) return constVal;
            const vv = CodegenCtx.literalVarVal(v);
            const addr = this.g.program.data.length | kConstBit;
            this.g.program.data.push(vv);
            const r = Val.newStackValue(v.type, addr);
            this.g.constantVals.set(key, r);
            return r;
        }
        return undefined;
    }
    // Convert v to a value that is on the stack.
    private stackify(v: Val | undefined, reservedSlot = false): Val {
        if (!v) return kNullVal;
        const constVal = this.constDataVal(v);
        if (constVal !== undefined) {
            return constVal;
        }
        if (v.isStackValue()) return v;
        if (v.isVar() && !v.global && !v.index && !v.isField()) {
            return v;
        }
        if (v.isVar() || v.isField()) {
            return this.loadVar(reservedSlot ? this.reserveStackSlot() : this.nextStackOffset(), v) || kNullVal;
        }
        this.error("invalid value");
        return kNullVal;
    }
    // Evaluate a constant expression. Return null if it cannot be evaluated at 'compile' time.
    private constExpr(id: vm.InstructionID, ...args: any[]): Val | undefined {
        // Args must be literals, and instruction must be 'const expr'.
        if (!vm.ConstExprInstructions.has(id)) return undefined;
        const lhs = args[0] as Val;
        for (let i = 1; i < args.length; i++) {
            const a = args[i];
            if (a instanceof Val) {
                if (!a.isLiteral() && !a.isConst()) return undefined;
            } else return undefined;
        }
        // Make a new program. In all cases, the output is the first instruction argument,
        // and we'll store it to stack position 0. Convert input literal values to vm.VariableValue
        // values and store them as constants in the program. Finally, execute the program and
        // harvest the output.
        const program = new vm.Program();
        const instArgs = [args.length - 1];
        for (let i = 1; i < args.length; i++) {
            const a = args[i] as Val;
            program.data.push(CodegenCtx.literalVarVal(a));
            instArgs.push(i - 1);
        }
        program.inst.push(new vm.Instruction(id, instArgs));
        const exe = new vm.Execution(program, new vm.NullPC());
        exe.run();
        const result = exe.stack[instArgs[0]] as vm.VariableValue;
        if (lhs.type === kStringType) {
            return Val.newStringLiteral(result.strVal());
        } else {
            return Val.newNumberLiteral(result.numVal(), lhs.type);
        }
    }
    // Write an instruction to the program. Because many instructions take stack indices as arguments,
    // as a convenience, args of type Val are automatically pushed to the stack and converted to stack indices.
    private write(id: vm.InstructionID, ...args: any[]): vm.Instruction | undefined {
        // Attempt a compile time eval.
        const constResult = this.constExpr(id, ...args);
        if (constResult) {
            const lhs = args[0] as Val;
            // If successful, update args[0].
            if (lhs.kind === ValKind.kStackValue) {
                lhs.kind = constResult.kind;
                lhs.stringValue = constResult.stringValue;
                lhs.numberValue = constResult.numberValue;
                return undefined;
            }
        }
        if (id === vm.InstructionID.BRANCH_IFNOT) { // optimize for fun
            const v = args[1] as Val;
            const val = v.constNumberValue();
            if (val !== undefined) {
                if (!v.numberValue) {
                    id = vm.InstructionID.BRANCH;
                    args.pop();
                } else {
                    return undefined;
                }
            }
        }
        return this.emit(id, ...args);
    }
    // Like write, but ensures the instruction is not optimized away.
    private emit(id: vm.InstructionID, ...args: any[]): vm.Instruction {
        for (let i = 0; i < args.length; i++) {
            // convenience conversion
            if (args[i] instanceof Val) {
                args[i] = this.stackify(args[i]).stackOffset;
            }
        }
        const inst = new vm.Instruction(id, args);
        this.g.program.inst.push(inst);
        // Map instruction offset to source line number.
        if (this.g.locator) {
            const loc = this.g.locator.currentLocation();
            if (loc) {
                this.g.program.instToLine.set(this.instructionCount() - 1, loc.line);
            }
        }
        return inst;
    }
    private expectNumeric(v: Val): boolean {
        if (!v.type.isNumeric()) {
            this.error("expected numeric type", v.loc());
            return false;
        }
        return true;
    }
    private instructionCount(): number {
        return this.program().inst.length;
    }
}
