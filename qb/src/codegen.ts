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

import { basicType, CaseCondition, Coord, ICtx, ILocator, kNullVal, Location, MVal, Token, Val, ValKind } from "./parse";
import { BaseType, baseTypeToSigil, FunctionType, kDoubleType, kIntType, kLongType, kSingleType, kStringType, Type } from "./types";
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
    public loopStart: BranchTarget;
    selectValue: Val;
    // SELECT CASE is implemented as a chain of conditionals.
    // For each case, stores two instruction offsets. First is the place to jump to to start the case.
    // Second is the branch instruction that skips over the case when the test fails.
    caseInstOffset: (BranchTarget | undefined)[][] = [];
    endCaseInstructions: vm.Instruction[] = [];

    constructor(public type: CtrlFlowType) { }
}
class GotoInfo {
    public lineNumber: number | undefined;
    public label: string | undefined;
    public target: BranchTarget | undefined;
    public token: Token;
    public globalLabel?: boolean;
    constructor(public sourceBlock: BlockInfo, public inst: vm.Instruction) { }
    setLabelOrLineNumber(target: string | number) {
        if (typeof (target) === 'string') {
            this.label = target;
        } else {
            this.lineNumber = target;
        }
    }
}

class SubroutineInfo {
    public calls: vm.Instruction[] = [];
    public blockInfo = new BlockInfo();
    constructor(public name: string, public args: Val[]) {
    }
}

class BlockInfo {
    public startPc: number = -1;
    public argCount: number = 0;
    public declareInstructions: vm.Instruction[] = [];
    public inst: vm.Instruction[] = [];
    public instToLine = new Map<number, number>();
    public startShift = 0;
    public statementOffsets: number[] = [];

    setStartPC(pc: number) {
        for (const i of this.inst) {
            if (vm.BranchInstructions.has(i.id) && i.args.length > 0) {
                i.args[0] += pc - this.startPc;
            }
        }
        for (let i = 0; i < this.statementOffsets.length; i++) {
            this.statementOffsets[i] += pc - this.startPc;
        }
        this.startPc = pc;
    }

    insertInstructions(pos: number, count: number) {
        if (count <= 0) return;
        for (let i = 0; i < count; i++) {
            this.inst.push(undefined as any);
        }
        for (let i = this.inst.length - 1; i >= pos + count; i--) {
            this.inst[i] = this.inst[i - count];
            this.inst[i - count] = undefined as any;
            const line = this.instToLine.get(i - count);
            if (line !== undefined) {
                this.instToLine.delete(i - count);
                this.instToLine.set(i, line);
            }
        }
        for (let i = 0; i < this.statementOffsets.length; i++) {
            this.statementOffsets[i] += count;
        }
    }

    insertDeclareInstructions() {
        if (!this.declareInstructions.length) return;
        this.insertInstructions(0, this.declareInstructions.length);
        for (let i = 0; i < this.declareInstructions.length; i++) {
            this.inst[i] = this.declareInstructions[i];
        }
        this.startShift = this.declareInstructions.length;
        this.declareInstructions = [];
    }
}

class BranchTarget {
    constructor(public block: BlockInfo, public instOffset: number) { }
    getPC(): number {
        return this.block.startPc + this.instOffset + this.block.startShift;
    }
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
    constructor(public instructionIndex: BranchTarget, public dataOffset: number) { }
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
    public lineNumbers: Map<number, BranchTarget> = new Map<number, BranchTarget>();
    public labels: Map<string, BranchTarget> = new Map<string, BranchTarget>();
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
    setLocator(locator: ILocator): void {
        this.g.locator = locator;
    }
    program(): vm.Program { return this.g.program; }
    errors(): string[] { return this.g.errors; }
    errorLocations(): Location[] { return this.g.errorLocations; }
    error(message: string, loc?: Location | Token) {
        if (loc instanceof Token) {
            loc = loc.loc;
        }
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
        this.g.labels.set(tok.text, this.branchTargetHere());
    }
    lineNumber(num: number, tok: Token) {
        if (this.g.lineNumbers.has(num)) {
            this.error("duplicate label", tok.loc);
            return;
        }
        this.g.lineNumbers.set(num, this.branchTargetHere());
    }
    newline(lineNumber: number) {
        this.g.currentLine = lineNumber;
    }
    newStmt() {
        const offset = this.blockInfo.inst.length;
        if (this.blockInfo.statementOffsets.length === 0 || this.blockInfo.statementOffsets[this.blockInfo.statementOffsets.length - 1] !== offset) {
            this.blockInfo.statementOffsets.push(offset);
        }
    }
    data(dataArray: Val[]) {
        this.g.dataOffsets.push(new DataStmtOffset(this.branchTargetHere(), this.program().dataList.length));
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
        this.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE, [v.stackOffset, varVal]));
        return v;
    }
    declConst(id: Token, ty: BaseType, value: Val) {
        if (!value.isLiteral() && !value.isConst()) {
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

    dim(name: Token | string, size: Val[][] | undefined, ty: Type, shared: boolean, dynamic: boolean) {
        const nameText = name instanceof Token ? name.text : name as string;
        const loc = name instanceof Token ? name.loc : undefined;
        const existingDefinition = this.dimVars.get(nameText);
        if (existingDefinition !== undefined && !dynamic) {
            this.error("duplicate definition", loc);
            return;
        }
        for (const suffix of ["$", "%", "&", "!", "#", ""]) {
            if (this.autoVars.has(nameText + suffix)) {
                this.error("duplicate definition", loc);
                return;
            }
        }
        if (existingDefinition !== undefined) {
            if (!existingDefinition.type.equals(ty)) {
                this.error("mismatched types", loc);
                return;
            }
            if (existingDefinition.size === undefined) {
                if (size !== undefined) {
                    this.error("dimension mismatch", loc);
                    return;
                }
            } else {
                if (size === undefined || size.length != existingDefinition.size.length) {
                    this.error("dimension mismatch", loc);
                    return;
                }
            }
            if (!existingDefinition.dynamic) {
                this.error("array already dimensioned", loc);
                return;
            }
        }

        let numericSize: number[] | undefined;
        let dynamicDims: Val[] = [];
        let dynamicSize = false;
        if (size) {
            numericSize = [];
            for (const s of size) {
                const sAsNumeric: number[] = [];
                for (const sv of s) {
                    if ((sv.isLiteral() || sv.isConst()) && sv.type.isNumeric()) {
                        sAsNumeric.push(sv.numberValue);
                    } else if (sv.kind === ValKind.kUnspecifiedDimSize) {
                        dynamicSize = true;
                        sAsNumeric.push(0);
                    } else {
                        if (!dynamic) {
                            this.error("expected constant numeric value", sv.loc());
                            return;
                        } else {
                            dynamicSize = true;
                        }
                    }
                }
                numericSize.push(sAsNumeric[sAsNumeric.length - 1]);
            }
            if (dynamicSize) {
                for (const s of size) {
                    const val = s[s.length - 1];
                    if (val.kind == ValKind.kUnspecifiedDimSize) {
                        dynamicDims.push(this.constNumber(0, kIntType));
                    } else {
                        dynamicDims.push(val);
                    }
                }
                numericSize = dynamicDims.map(() => 0);
            }
        }
        let v = existingDefinition;
        if (!v) {
            v = Val.newVar(nameText, ty, numericSize);
            if (!this.parent || shared) {
                v.stackOffset = kGlobalBit | this.g.globalVarCount++;
            } else {
                v.stackOffset = kLocalBit | this.localVarCount++;
            }
            v.dimmed = true;
            if (dynamicSize || dynamic) v.dynamic = true;
            if (shared) v.shared = true;
            this.dimVars.set(nameText, v);
        }
        if (!dynamic) {
            const vv = vm.VariableValue.single(v.type, vm.zeroValue(v.type));
            vv.dims = numericSize;
            // this.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE_VAR, [name.text, vv]));
            this.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE, [v.stackOffset, vv]));
        } else {
            const vv = vm.VariableValue.single(v.type, vm.zeroValue(v.type));
            vv.dims = numericSize;
            this.write(vm.InstructionID.DECLARE_REDIM, v.stackOffset, vv, ...dynamicDims);
        }
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
                this.assignVal(v, val);
                return kNullVal;
            }
            case "ABS": {
                const r = Val.newStackValue(O[0].type, this.nextStackOffset());
                this.write(vm.InstructionID.ABS, r, O[0]);
                return r;
            }
            case "PRINT": {
                let endsWithSeparator = false;
                for (const arg of O) {
                    endsWithSeparator = false;
                    if (arg.isCommaDelim()) {
                        endsWithSeparator = true;
                        this.write(vm.InstructionID.PRINT, Val.newStringLiteral("\t"));
                    } else if (arg.isSemicolonDelim()) {
                        endsWithSeparator = true;
                    } else {
                        this.write(vm.InstructionID.PRINT, arg);
                    }
                }
                if (!endsWithSeparator) {
                    this.write(vm.InstructionID.PRINT, Val.newStringLiteral("\n"));
                }
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
            case "^": {
                const C = this.pushCompatibleOperands(O[0], O[1]);
                if (!C) return undefined;
                const r = this.newStackValue(kDoubleType);
                this.write(vm.InstructionID.POW, r, C[0], C[1]);
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
        sub.blockInfo.startPc = 0;
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

    functionBegin(id: Token, sigil: BaseType, returnType: Type, args: Val[], singleLine: boolean): ICtx {
        if (!singleLine) {
            this.setEnd();
        }
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
        fn.blockInfo.startPc = 0;

        const retVal = Val.newVar(id.text, returnType);
        retVal.dimmed = true;
        retVal.stackOffset = 0;
        // fnCtx.stackOffset = this.stackOffset;
        fnCtx.blockInfo.declareInstructions.push(new vm.Instruction(vm.InstructionID.DECLARE, [retVal.stackOffset, vm.VariableValue.single(retVal.type, vm.zeroValue(retVal.type))]));
        fnCtx.dimVars.set(retVal.varName, retVal);
        // fnCtx.dim(id, undefined, returnType, false);
        // const retVal = fnCtx.dimVars.get(id.text);
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
    }
    endFunction() {
        if (!this.fnInfo) {
            this.error("internal error");
            return;
        }
        this.write(vm.InstructionID.EXIT_SUB);
    }
    isSub(id: string): boolean {
        return this.g.subs.has(id);
    }
    isConst(id: string): boolean {
        return (this.parent && this.parent.isConst(id)) || this.constVars.has(id);
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
        for (const arg of args) {
            if (!arg) return;
        }
        args = this.stackifyAll(args);
        const callStackOffset = this.stackOffset;
        // Parameters are passed by reference.
        for (const arg of args) {
            const s = arg.stackOffset;
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

    callBuiltin(id: string, args: (MVal | boolean | number)[]): MVal {
        const callWithReturn = (instId: vm.InstructionID, returnType: Type, args: (MVal | boolean | number)[]) => {
            const result = this.newStackValue(returnType);
            this.write(instId, result, ...args);
            return result;
        };
        const callNoReturn = (instId: vm.InstructionID, args: (MVal | boolean | number)[]) => {
            this.write(instId, ...args);
            return undefined;
        };
        switch (id) {
            case "__LOG": return callNoReturn(vm.InstructionID.LOG, args);
            case "ASC": return callWithReturn(vm.InstructionID.ASC, kIntType, args);
            case "ATN": return callWithReturn(vm.InstructionID.ATN, kDoubleType, args);
            case "CDBL": return callWithReturn(vm.InstructionID.CDBL, kDoubleType, args);
            case "CHR": return callWithReturn(vm.InstructionID.CHR, kStringType, args);
            case "CINT": return callWithReturn(vm.InstructionID.CINT, kIntType, args);
            case "CLNG": return callWithReturn(vm.InstructionID.CLNG, kLongType, args);
            case "COS": return callWithReturn(vm.InstructionID.COS, kDoubleType, args);
            case "CSNG": return callWithReturn(vm.InstructionID.CSNG, kSingleType, args);
            case "EXP": return callWithReturn(vm.InstructionID.EXP, kDoubleType, args);
            case "FIX": return callWithReturn(vm.InstructionID.FIX, kDoubleType, args);
            case "FIX": return callWithReturn(vm.InstructionID.FIX, kDoubleType, args);
            case "FRE": return undefined;
            case "INKEY": return callWithReturn(vm.InstructionID.INKEY, kStringType, args);
            case "INPUT": return callWithReturn(vm.InstructionID.INPUT_FUNC, kStringType, args);
            case "INSTR": return callWithReturn(vm.InstructionID.INSTR, kIntType, args);
            case "INT": return callWithReturn(vm.InstructionID.INT, kDoubleType, args);
            case "LCASE": return callWithReturn(vm.InstructionID.LCASE, kStringType, args);
            case "LEFT": return callWithReturn(vm.InstructionID.LEFT, kStringType, args);
            case "LEN": return callWithReturn(vm.InstructionID.LEN, kLongType, args);
            case "LTRIM": return callWithReturn(vm.InstructionID.LTRIM, kStringType, args);
            case "MID": return callWithReturn(vm.InstructionID.MID, kStringType, args);
            case "PEEK": return callWithReturn(vm.InstructionID.NOP, kIntType, args);
            case "RIGHT": return callWithReturn(vm.InstructionID.RIGHT, kStringType, args);
            case "RND": return callWithReturn(vm.InstructionID.RND, kSingleType, args);
            case "RTRIM": return callWithReturn(vm.InstructionID.RTRIM, kStringType, args);
            case "SIN": return callWithReturn(vm.InstructionID.SIN, kDoubleType, args);
            case "SPACE": return callWithReturn(vm.InstructionID.SPACE, kStringType, args);
            case "STR": return callWithReturn(vm.InstructionID.STR, kStringType, args);
            case "TAN": return callWithReturn(vm.InstructionID.TAN, kDoubleType, args);
            case "TIMER": return callWithReturn(vm.InstructionID.TIMER, kDoubleType, args);
            case "UCASE": return callWithReturn(vm.InstructionID.UCASE, kStringType, args);
            case "VAL": return callWithReturn(vm.InstructionID.VAL, kDoubleType, args);
            case "LINE_INPUT": return callNoReturn(vm.InstructionID.LINE_INPUT, args);
            case "POINT": return callWithReturn(vm.InstructionID.POINT, kIntType, args);
            case "CURRENT_POINT": return callWithReturn(vm.InstructionID.CURRENT_POINT, kIntType, args);
            case "VIEW": return callNoReturn(vm.InstructionID.VIEW, args);
            case "VIEW_PRINT": return callNoReturn(vm.InstructionID.VIEW_PRINT, args);
            case "BEEP": return undefined; // TODO
        }
        this.error("not implemented");
        return undefined;
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
        for (const arg of args) {
            if (!arg) return;
        }
        args = this.stackifyAll(args);
        const callStackOffset = this.stackOffset;
        // make the return variable
        const returnVal = this.newStackValue(f.type.resultType);
        // Parameters are passed by reference.
        for (const arg of args) {
            const s = arg.stackOffset;
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
        if (flow.branchInst) {
            this.recordBranchTarget(this.branchTargetHere(), flow.branchInst);
        }
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
            this.recordBranchTarget(this.branchTargetHere(), flow.branchInst);
        }
        for (const ei of flow.endInstructions) {
            this.recordBranchTarget(this.branchTargetHere(), ei);
        }
        this.ctrlFlowStack.pop();
    }
    selectBegin(v: Val) {
        const flow = new CtrlFlow(CtrlFlowType.kSELECT);
        this.ctrlFlowStack.push(flow);
        flow.selectValue = this.stackify(v, true);
    }
    selectCase(vs: CaseCondition[]) {
        const flow = this.ctrlFlow();
        if (!flow) return;
        if (flow.caseInstOffset.length > 0) {
            flow.endCaseInstructions.push(this.emit(vm.InstructionID.BRANCH, 0));
        }
        const testpc = this.branchTargetHere();
        let testResult: Val | undefined;
        for (const v of vs) {
            let condResult: Val | undefined;
            if (v.single) {
                condResult = this.op("=", [flow.selectValue, v.single]);
            } else if (v.range) {
                const a = this.op(">=", [flow.selectValue, v.range[0]]);
                const b = this.op("<=", [flow.selectValue, v.range[1]]);
                if (!a || !b) return;
                condResult = this.op("AND", [a, b]);
            } else if (v.isExpr) {
                condResult = this.op(v.isExpr[0].text, [flow.selectValue, v.isExpr[1]]);
            }
            if (!condResult) return;
            if (testResult === undefined) {
                testResult = condResult;
            } else {
                testResult = this.op("OR", [testResult, condResult]);
            }
        }

        const branchpc = this.branchTargetHere();
        this.write(vm.InstructionID.BRANCH_IFNOT, 0, testResult);
        flow.caseInstOffset.push([testpc, branchpc]);
    }
    selectCaseElse() {
        const flow = this.ctrlFlow();
        if (!flow) return;
        flow.endCaseInstructions.push(this.emit(vm.InstructionID.BRANCH, 0));
        const offset = this.branchTargetHere();
        this.emit(vm.InstructionID.NOP);
        flow.caseInstOffset.push([offset, undefined]);
    }
    selectEnd() {
        const flow = this.ctrlFlow();
        if (!flow) return;
        const endPos = this.branchTargetHere();
        for (const inst of flow.endCaseInstructions) {
            this.recordBranchTarget(endPos, inst);
        }
        for (let i = 0; i < flow.caseInstOffset.length; ++i) {
            const [testOffset, branchOffset] = flow.caseInstOffset[i];
            if (branchOffset !== undefined) {
                const branch = this.blockInfo.inst[branchOffset.instOffset];
                if (i + 1 < flow.caseInstOffset.length) {
                    this.recordBranchTarget(flow.caseInstOffset[i + 1][0] as BranchTarget, branch);
                } else {
                    this.recordBranchTarget(endPos, branch);
                }
            }
        }
        this.ctrlFlowStack.pop();
        if (flow.selectValue.stackOffset + 1 === this.reservedStackSlots) {
            this.reservedStackSlots--;
        }
    }
    forBegin(idx: Val, from: Val, to: Val, step: Val | null) {
        if (!idx.isVar() || !idx.type.isNumeric()) {
            this.error("invalid index");
            return;
        }
        to = this.stackify(to, true);
        const ctrlFlow = new CtrlFlow(CtrlFlowType.kFOR);
        this.assignVal(idx, from);
        step = step ? this.stackify(step) : this.constNumber(1, idx.type);
        const condVal = this.newStackValue(kIntType);
        const branch0 = this.emit(vm.InstructionID.BRANCH, 0);
        ctrlFlow.loopStart = this.branchTargetHere();
        const idxOnStack = this.stackify(idx);
        this.write(vm.InstructionID.ADD, idxOnStack, idxOnStack, step);
        this.assign(idx, idxOnStack.stackOffset);
        this.recordBranchTarget(this.branchTargetHere(), branch0);
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
        if (flow.branchInst) {
            this.recordBranchTarget(this.branchTargetHere(), flow.branchInst);
        }
        for (const ei of flow.endInstructions) {
            this.recordBranchTarget(this.branchTargetHere(), ei);
        }
    }
    doBegin() {
        const ctrlFlow = new CtrlFlow(CtrlFlowType.kDO);
        ctrlFlow.loopStart = this.branchTargetHere();
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
        const endPos = this.branchTargetHere();
        if (flow.branchInst) {
            this.recordBranchTarget(endPos, flow.branchInst);
        }
        for (const ei of flow.endInstructions) {
            this.recordBranchTarget(endPos, ei);
        }
        this.ctrlFlowStack.pop();
    }
    whileBegin() {
        const ctrlFlow = new CtrlFlow(CtrlFlowType.kWHILE);
        ctrlFlow.loopStart = this.branchTargetHere();
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
        const endPos = this.branchTargetHere();
        if (flow.branchInst) {
            this.recordBranchTarget(endPos, flow.branchInst);
        }
        this.ctrlFlowStack.pop();
    }
    onErrorGoto(target: number | string, tok: Token) {
        const g = new GotoInfo(this.blockInfo, this.emit(vm.InstructionID.ON_ERROR_GOTO, 0));
        if (typeof target === 'string') {
            g.label = target;
        } else {
            g.lineNumber = target;
        }
        g.token = tok;
        this.g.gotos.push(g);
    }
    gotoLine(no: number, tok: Token) {
        const g = new GotoInfo(this.blockInfo, this.emit(vm.InstructionID.BRANCH, 0));
        g.lineNumber = no;
        g.token = tok;
        this.g.gotos.push(g);
    }
    gotoLabel(lbl: Token) {
        const g = new GotoInfo(this.blockInfo, this.emit(vm.InstructionID.BRANCH, 0));
        g.label = lbl.text;
        g.token = lbl;
        this.g.gotos.push(g);
    }
    resumeNext(): void {
        this.write(vm.InstructionID.RESUME_NEXT);
    }
    resume(): void {
        this.write(vm.InstructionID.RESUME);
    }
    resumeGoto(target: string | number, tok: Token): void {
        const g = new GotoInfo(this.blockInfo, this.emit(vm.InstructionID.RESUME_GOTO, 0))
        g.setLabelOrLineNumber(target);
        g.globalLabel = true;
        this.g.gotos.push(g);
    }
    goReturn(token: Token | undefined, lbl: number | string | undefined) {
        if (lbl === undefined) {
            this.emit(vm.InstructionID.EXIT_SUB);
            return;
        }
        const g = new GotoInfo(this.blockInfo, this.emit(vm.InstructionID.RETURN, 0/*pc*/));
        if (token) g.token = token;
        g.setLabelOrLineNumber(lbl);
        this.g.gotos.push(g);
    }
    gosub(token: Token, lbl: number | string) {
        const g = new GotoInfo(this.blockInfo, this.emit(vm.InstructionID.GOSUB, 0/*pc*/, this.stackOffset));
        g.token = token;
        g.setLabelOrLineNumber(lbl);
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
    pset(a: Coord, color?: Val) {
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

        const args: any[] = [x1, y1, undefined];
        if (color) {
            args[2] = color;
        }
        this.write(vm.InstructionID.PSET, ...args);
    }
    circle(center: Coord, radius: Val, color?: Val, start?: Val, end?: Val, aspect?: Val) {
        let x: Val;
        let y: Val;
        if (center.step) {
            const oldx = this.newStackValue(kIntType);
            const oldy = this.newStackValue(kIntType);
            this.write(vm.InstructionID.GET_DRAW_POS, oldx, oldy);
            x = this.newStackValue(kIntType);
            y = this.newStackValue(kIntType);
            this.write(vm.InstructionID.ADD, x, oldx, center.x);
            this.write(vm.InstructionID.ADD, y, oldy, center.y);
        } else {
            x = center.x;
            y = center.y;
        }
        this.write(vm.InstructionID.CIRCLE, x, y, radius, color, start, end, aspect);
    }
    paint(a: Coord, paintColor: MVal, borderColor: MVal, background: MVal) {
        // TODO: background
        let x: Val;
        let y: Val;
        if (a.step) {
            const oldx = this.newStackValue(kIntType);
            const oldy = this.newStackValue(kIntType);
            this.write(vm.InstructionID.GET_DRAW_POS, oldx, oldy);
            x = this.newStackValue(kIntType);
            y = this.newStackValue(kIntType);
            this.write(vm.InstructionID.ADD, x, oldx, a.x);
            this.write(vm.InstructionID.ADD, y, oldy, a.y);
        } else {
            x = a.x;
            y = a.y;
        }
        this.write(vm.InstructionID.PAINT, x, y, paintColor, borderColor);
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
        const args: any[] = [x1, y1, x2, y2, undefined, undefined, undefined];
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
    draw(expr: Val) {
        this.write(vm.InstructionID.DRAW, expr);
    }
    getGraphics(a: Coord, b: Coord, id: Token, sig: BaseType) {
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
        const variable = this.findVariable(id.text, sig);
        if (!variable) {
            this.error("undefined variable", id.loc);
            return;
        }
        this.write(vm.InstructionID.GET_GRAPHICS, x1, y1, x2, y2, variable);
    }
    putGraphics(a: Coord, id: Token, sig: BaseType, verb: string) {
        if (verb !== "PSET") {
            this.error("not implemented");
        }
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
        const variable = this.findVariable(id.text, sig);
        if (!variable) {
            this.error("undefined variable", id.loc);
            return;
        }
        this.write(vm.InstructionID.PUT_GRAPHICS, x1, y1, variable);
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

    finalize() {
        if (!this.g.isEnd) this.setEnd();
        if (this.finalized) {
            throw new Error("already finalized");
        }
        const allBlocks = this.allBlocks();

        // DECLARE_VAR instructions need to be first in the main module, and in each sub/function.
        // Insert these instructions now, starting with the last block.
        // This is only safe at the end of finalize, since some instruction indices are not updated.
        for (let i = allBlocks.length - 1; i >= 0; i--) {
            const b = allBlocks[i];
            b.insertDeclareInstructions();
        }


        // Shift stack offsets to make room for constant, global, and local variables.
        const constCount = this.g.program.data.length;
        const globalCount = this.g.globalVarCount;
        for (const b of allBlocks) {
            let shiftCount = b.startShift;
            if (b === this.blockInfo) {
                shiftCount += constCount + globalCount;
            }
            for (const inst of b.inst) {
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
            for (const inst of b.inst) {
                if (inst.id === vm.InstructionID.CALL_SUB || inst.id === vm.InstructionID.CALL_FUNCTION) {
                    inst.args[1] += shiftCount;
                }
            }
        }

        // Linearize the blocks.
        let finalPC = 0;
        for (const b of allBlocks) {
            b.setStartPC(finalPC);
            finalPC += b.inst.length;
        }

        // Finalize PCs referenced in instructions.
        for (const r of this.g.restores) {
            let target: BranchTarget | undefined;
            if (typeof (r.lbl) === "string") {
                target = this.g.labels.get(r.lbl);
                if (target === undefined) {
                    this.error("label not found");
                    continue;
                }
            } else {
                target = this.g.lineNumbers.get(r.lbl);
                if (target === undefined) {
                    this.error("line number not found");
                    continue;
                }
            }
            r.restoreInst.args[0] = 1 << 32;
            for (const d of this.g.dataOffsets) {
                if (target.block === d.instructionIndex.block &&
                    target.instOffset <= d.instructionIndex.instOffset) {
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
            let target: BranchTarget | undefined;
            if (g.label) {
                target = this.g.labels.get(g.label);
                if (target === undefined) {
                    this.error("label not found", g.token);
                    continue;
                }
                if (g.globalLabel) {
                    if (target.block !== this.blockInfo) {
                        this.error("label not at module level", g.token);
                    }
                } else {
                    if (target.block !== g.sourceBlock) {
                        this.error("label not in this block"), g.token;
                    }
                }
            } else if (g.lineNumber !== undefined) {
                target = this.g.lineNumbers.get(g.lineNumber);
                if (target === undefined) {
                    this.error("line number not found", g.token);
                    continue;
                }
            } else if (g.target !== undefined) {
                target = g.target;
            }
            if (target) {
                g.inst.args[0] = target.getPC();
            } else {
                this.error("internal error");
            }
        }
        const prog = this.program();
        for (const b of allBlocks) {
            for (const inst of b.inst) {
                prog.inst.push(inst);
            }
            for (const offset of b.statementOffsets) {
                prog.statementOffsets.push(offset);
            }
            for (const instToLine of b.instToLine) {
                prog.instToLine.set(instToLine[0], instToLine[1]);
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
        //allBlocks.sort((a, b) => a.startPc - b.startPc);
        return allBlocks;
    }
    private assignVal(variable: Val, value: Val) {
        const convertedValue = this.convert(value, variable.type);
        this.assign(variable, this.stackify(convertedValue).stackOffset);
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
    private stackifyAll(args: Val[]): Val[] {
        return args.map((v) => this.stackify(v));
    }

    // Convert v to a value that is on the stack.
    private stackify(v: Val | undefined, reservedSlot = false): Val {
        if (!v) return kNullVal;
        const constVal = this.constDataVal(v);
        if (constVal !== undefined) {
            return constVal;
        }
        if (v.isStackValue()) {
            if (!reservedSlot || reservedSlot && v.stackOffset < this.reservedStackSlots) return v;
            const stackOffset = this.reservedStackSlots++;
            this.write(vm.InstructionID.COPY, stackOffset, v.stackOffset);
            return Val.newStackValue(v.type, stackOffset);
        }
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
        if (id === vm.InstructionID.COPY && args[0] === args[1]) {
            return undefined;
        }
        if (id === vm.InstructionID.ASSIGN && args[0] === args[1] && args[2] === undefined && args[3] === undefined) {
            return undefined;
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
        let bt: BranchTarget | undefined;
        for (let i = 0; i < args.length; i++) {
            // convenience conversion
            if (args[i] instanceof Val) {
                args[i] = this.stackify(args[i]).stackOffset;
            }
        }
        if (args.length >= 0 && args[0] instanceof BranchTarget) {
            bt = args[0];
            args[0] = 0;
        }
        const inst = new vm.Instruction(id, args);
        if (bt) {
            this.recordBranchTarget(bt, inst);
        }
        this.blockInfo.inst.push(inst);
        // Map instruction offset to source line number.
        if (this.g.locator) {
            const loc = this.g.locator.currentLocation();
            if (loc) {
                this.blockInfo.instToLine.set(this.blockInfo.inst.length - 1, loc.line);
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
    private branchTargetHere(): BranchTarget {
        return new BranchTarget(this.blockInfo, this.blockInfo.inst.length);
    }
    private recordBranchTarget(target: BranchTarget, inst: vm.Instruction): void {
        const info = new GotoInfo(this.blockInfo, inst);
        info.target = target;
        this.g.gotos.push(info);
    }
}
