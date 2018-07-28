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
    basicType, Coord, ICtx, kNullVal, kValTrue, Location, Token, Val, ValKind,
} from "./parse";
import {
    BaseType, baseTypeToSigil, FunctionType, kDoubleType, kIntType, kLongType,
    kSingleType, kStringType, sigilToBaseType, Type,
} from "./types";
import * as vm from "./vm";

enum CtrlFlowType {
    kIF,
    kFOR,
    kDO,
    kWHILE,
}
class CtrlFlow {
    public branchInst?: vm.Instruction;
    public endInstructions: vm.Instruction[] = [];
    public loopStart: number;
    constructor(public type: CtrlFlowType) { }
}
class GotoInfo {
    public lineNumber: number;
    public label: string;
    public token: Token;
    constructor(public inst: vm.Instruction) { }
}

class SubroutineInfo {
    public exits: vm.Instruction[] = [];
    public calls: vm.Instruction[] = [];
    constructor(public name: string, public args: Val[], public startPc: number) {
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
    public builtinOp: vm.InstructionID;
    constructor(public type: FunctionType, public builtin: boolean) { }
}

// Data shared by all instances of CodegenCtx when parsing a program.
class GlobalCtx {
    public functions = new Map<string, FunctionInfo>();
    public types: Map<string, Type> = new Map<string, Type>();
    public subs: Map<string, SubroutineInfo> = new Map<string, SubroutineInfo>();
    public constantVals = new Map<string, Val>();
    public lineNumbers: Map<number, number> = new Map<number, number>();
    public labels: Map<string, number> = new Map<string, number>();
    public program: vm.Program = new vm.Program();
    public errors: string[] = [];
    public errorLocations: Location[] = [];
    public gotos: GotoInfo[] = [];
    public currentLine = 0;
    // Has the END instruction been written?
    public isEnd = false;
    constructor() {
        this.program.data.push(vm.VariableValue.single(kIntType, 0)); // this slot isn't used, so addr=-1 addresses data[1].
        this.functions.set("MID$",
            FunctionInfo.builtin(new FunctionType(kStringType, [kStringType, kLongType, kLongType], 1), vm.InstructionID.MID));
        this.functions.set("RIGHT$",
            FunctionInfo.builtin(new FunctionType(kStringType, [kStringType, kLongType]), vm.InstructionID.RIGHT));
        this.functions.set("LEFT$",
            FunctionInfo.builtin(new FunctionType(kStringType, [kStringType, kLongType]), vm.InstructionID.LEFT));
        this.functions.set("CHR$",
            FunctionInfo.builtin(new FunctionType(kStringType, [kLongType]), vm.InstructionID.CHR));
        this.functions.set("ASC",
            FunctionInfo.builtin(new FunctionType(kIntType, [kStringType]), vm.InstructionID.ASC));
        this.functions.set("RND",
            FunctionInfo.builtin(new FunctionType(kSingleType, [kIntType], 1), vm.InstructionID.RND));
        this.functions.set("INT",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType]), vm.InstructionID.INT));
        this.functions.set("FIX",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kDoubleType]), vm.InstructionID.FIX));
        this.functions.set("INKEY$",
            FunctionInfo.builtin(new FunctionType(kStringType, []), vm.InstructionID.INKEY));
        this.functions.set("VAL",
            FunctionInfo.builtin(new FunctionType(kDoubleType, [kStringType]), vm.InstructionID.VAL));
        this.functions.set("STR$",
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
    private stackOffset: number = 0;
    private ctrlFlowStack: CtrlFlow[] = [];
    private tempVarCount = 0;

    constructor() { }
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
        this.g.labels.set(tok.text, this.g.program.inst.length);
    }
    lineNumber(num: number, tok: Token) {
        if (this.g.lineNumbers.has(num)) {
            this.error("duplicate label", tok.loc);
            return;
        }
        this.g.lineNumbers.set(num, this.g.program.inst.length);
    }
    newline(lineNumber: number) {
        this.g.currentLine = lineNumber;
    }
    data(dataArray: Val[]) { /*TODO*/ }
    endStmt() {
        // It's not possible for a stack variable to be referenced in more than one statement, so we can
        // reuse the stack offsets after each statement.
        this.stackOffset = 0;
    }
    // Returns a Val that represents a named variable.
    variable(varName: Token, sigil: BaseType, defaultType: Type): Val {
        // If a variable is defined by DIM or CONST, only a single variable can use that name.
        // Otherwise, an 'auto' variable of each basic type can be used with the same name (X%, X$, etc...)
        {
            const dimVar = this.dimVars.get(varName.text);
            if (dimVar) {
                if (sigil === BaseType.kNone || dimVar.baseType() === sigil) {
                    return dimVar;
                } else {
                    this.error("duplicate definition", varName.loc);
                    return kNullVal;
                }
            }
        }
        {
            const constVar = this.constVars.get(varName.text);
            if (constVar) {
                if (sigil === BaseType.kNone || constVar.baseType() === sigil) {
                    return constVar;
                } else {
                    this.error("duplicate definition", varName.loc);
                    return kNullVal;
                }
            }
        }
        const key = varName.text + baseTypeToSigil(sigil);
        const autoVar = this.autoVars.get(key);
        if (autoVar) return autoVar;
        const v = Val.newVar(varName.text, defaultType);
        this.autoVars.set(key, v);

        // Write declaration instruction.
        const varVal = vm.VariableValue.single(v.type, vm.zeroValue(v.type));
        this.write(vm.InstructionID.DECLARE_VAR, key, varVal);
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
    index(v: Val, idx: Val[]): Val {
        if (v.isVar()) {
            if (!idx) {
                return kNullVal;
            }
            const dims = v.size ? v.size.length : 1;
            if (idx.length !== dims) {
                this.error("wrong number of dimensions");
                return kNullVal;
            }
            v = v.copy();
            v.index = idx;
            return v;
        }
        this.error("index of this kind not implemented");
        return kNullVal;
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
    dim(name: Token, size: number[], ty?: Type) {
        if (this.dimVars.has(name.text)) {
            this.error("duplicate definition", name.loc);
            return;
        }
        for (const suffix of ["$", "%", "&", "!", "#", ""]) {
            if (this.autoVars.has(name.text + suffix)) {
                this.error("duplicate definition", name.loc);
                return;
            }
        }
        const v = Val.newVar(name.text, ty ? ty : kIntType, size);
        this.dimVars.set(name.text, v);
        const vv = vm.VariableValue.single(v.type, vm.zeroValue(v.type));
        vv.dims = size;
        this.write(vm.InstructionID.DECLARE_VAR, name.text, vv);
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
    convert(v: Val, ty: Type): Val {
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
                return kNullVal;
            }
            this.error("cannot convert value");
            return kNullVal;
        }
    }
    pushCompatibleOperands(a: Val, b: Val): Val[] {
        // TODO: This is kind of half-baked, need to ensure operators work like they're supposed to with mixed types.
        const type = this.binaryOpType(a.type, b.type);
        return [this.convert(a, type), this.convert(b, type)];
    }

    op(name: string, O: Val[]): Val {
        switch (name) {
            // TODO: ^, EQV, IMP.
            case "CLS": {
                this.write(vm.InstructionID.CLS);
                return kNullVal;
            }
            case "=": { // equality
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.EQ, r, a, b);
                return r;
            }
            case ">=": {
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.GTE, r, a, b);
                return r;
            }
            case "<=": {
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.LTE, r, a, b);
                return r;
            }
            case ">": {
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.GT, r, a, b);
                return r;
            }
            case "<": {
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.LT, r, a, b);
                return r;
            }
            case "<>": {
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(kIntType);
                this.write(vm.InstructionID.NEQ, r, a, b);
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
                return kNullVal;
            }
            case "+": {
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(a.type);
                this.write(vm.InstructionID.ADD, r, a, b);
                return r;
            }
            case "-": {
                if (O.length === 1) {
                    // unary
                    const unaryResult = this.newStackValue(O[0].type);
                    this.write(vm.InstructionID.NEG, unaryResult, O[0]);
                    return unaryResult;
                }
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(a.type);
                this.write(vm.InstructionID.SUB, r, a, b);
                return r;
            }
            case "*": {
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(a.type);
                this.write(vm.InstructionID.MUL, r, a, b);
                return r;
            }
            case "/": {
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(kDoubleType);
                this.write(vm.InstructionID.DIV, r, a, b);
                return r;
            }
            case "\\": {
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(kLongType);
                this.write(vm.InstructionID.IDIV, r, a, b);
                return r;
            }
            case "MOD": {
                const [a, b] = this.pushCompatibleOperands(O[0], O[1]);
                const r = this.newStackValue(kLongType);
                this.write(vm.InstructionID.MOD, r, a, b);
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
        return kNullVal;
    }

    declSub(id: Token, args: Val[]) {
        this.g.subs.set(id.text, new SubroutineInfo(id.text, args, -1));
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
        } else if (sub.startPc >= 0) {
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
            argVal.argIndex = i;
            subCtx.autoVars.set(this.autoVarKey(argVal), argVal);
        }
        sub.startPc = this.program().inst.length;
        subCtx.g = this.g;
        subCtx.parent = this;
        subCtx.subInfo = sub;
        return subCtx;
    }

    declArg(id: Token, isArray: boolean, ty: Type | null): Val {
        const v = new Val();
        v.type = ty || kIntType;
        v.kind = ValKind.kArgument;
        v.varName = id.text;
        v.isArrayArg = isArray;
        return v;
    }
    endsub() {
        if (!this.subInfo) {
            this.error("internal error");
            return;
        }
        for (const e of this.subInfo.exits) {
            e.args[0] = this.program().inst.length;
        }
        this.write(vm.InstructionID.EXIT_SUB);
    }
    isSub(id: string): boolean {
        return this.g.subs.has(id);
    }
    lookupFunction(id: string): FunctionType | undefined {
        const f = this.g.functions.get(id);
        if (f) return f.type;
        return undefined;
    }
    callSub(id: Token, args: Val[]) {
        const sub = this.g.subs.get(id.text);
        if (!sub) {
            this.error("not a subroutine");
            return;
        }
        // TODO: check args
        // Parameters are passed by reference. We need to create temporary variables for non-variable parameters.
        const argNames: string[] = [];
        let tempArgCount = 0;
        for (const arg of args) {
            if (!arg) return;
            if (arg.isVar()) {
                argNames.push(this.varAddr(arg));
            } else {
                const v = new Val();
                const newVar = Val.newVar("__t" + this.tempVarCount++, arg.type, arg.size);
                const varAddr = this.varAddr(newVar);
                this.assign(newVar, this.stackify(arg).stackOffset);
                argNames.push(varAddr);
                tempArgCount++;
            }
        }
        sub.calls.push(this.emit(vm.InstructionID.CALL_SUB, 0/*pc*/, argNames));
        this.tempVarCount -= tempArgCount;
    }
    callFunction(id: string, args: Val[]): Val {
        const f = this.g.functions.get(id);
        if (!f) return kNullVal;
        if (f.builtin && f.builtinOp) {
            const r = this.newStackValue(f.type.resultType);
            this.write(f.builtinOp, r, ...args);
            return r;
        }
        switch (id) {
            case "FRE": {
                return this.constNumber(47724, kLongType); // free memory: just fake it!
            }
        }
        this.error("not implemented");
        return kNullVal;
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
        if (flow.branchInst) flow.branchInst.args[0] = this.g.program.inst.length;
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
            flow.branchInst.args[0] = this.g.program.inst.length;
        }
        for (const ei of flow.endInstructions) {
            ei.args[0] = this.g.program.inst.length;
        }
        this.ctrlFlowStack.pop();
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
        ctrlFlow.loopStart = this.g.program.inst.length;
        const idxOnStack = this.stackify(idx);
        this.write(vm.InstructionID.ADD, idxOnStack, idxOnStack, step);
        this.assign(idx, idxOnStack.stackOffset);
        branch0.args[0] = this.g.program.inst.length;
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
        if (flow.branchInst) flow.branchInst.args[0] = this.g.program.inst.length;
        for (const ei of flow.endInstructions) {
            ei.args[0] = this.g.program.inst.length;
        }
    }
    doBegin(whileCond: Val) {
        const ctrlFlow = new CtrlFlow(CtrlFlowType.kDO);
        ctrlFlow.loopStart = this.program().inst.length;
        ctrlFlow.branchInst = this.write(vm.InstructionID.BRANCH_IFNOT, 0, whileCond);
        this.ctrlFlowStack.push(ctrlFlow);
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
    whileBegin(whileCond: Val) {
        const ctrlFlow = new CtrlFlow(CtrlFlowType.kWHILE);
        ctrlFlow.loopStart = this.program().inst.length;
        ctrlFlow.branchInst = this.write(vm.InstructionID.BRANCH_IFNOT, 0, whileCond);
        this.ctrlFlowStack.push(ctrlFlow);
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

    finalize() {
        for (const [name, sub] of this.g.subs) {
            for (const call of sub.calls) {
                call.args[0] = sub.startPc;
            }
        }
        for (const g of this.g.gotos) {
            if (g.label) {
                if (!this.g.labels.has(g.label)) {
                    this.error("label not found", g.token.loc);
                    continue;
                }
                g.inst.args[0] = this.g.labels.get(g.label);
            } else {
                if (!this.g.lineNumbers.has(g.lineNumber)) {
                    this.error("line number not found", g.token.loc);
                    continue;
                }
                g.inst.args[0] = this.g.lineNumbers.get(g.lineNumber);
            }
        }
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

        if (baseVar.argIndex !== undefined) {
            this.write(vm.InstructionID.ASSIGN_ARG, baseVar.argIndex, stackPos, index, fieldIndex);
        } else {
            this.write(vm.InstructionID.ASSIGN_VAR, this.varAddr(baseVar), stackPos, index, fieldIndex);
        }
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
    private nextStackOffset(): number {
        return this.stackOffset++;
    }
    private autoVarKey(v: Val): string {
        return v.baseType() === BaseType.kSingle ? v.varName : v.varName + baseTypeToSigil(v.baseType());
    }
    private varAddr(v: Val): string {
        if (v.isVar()) {
            const dimVar = this.dimVars.get(v.varName);
            if (dimVar) return v.varName;
            const autoKey = this.autoVarKey(v);
            const autoVar = this.autoVars.get(autoKey);
            if (autoVar) return autoKey;
            this.autoVars.set(autoKey, Val.newVar(v.varName, v.type));
            this.write(vm.InstructionID.DECLARE_VAR, autoKey, vm.VariableValue.single(v.type, vm.zeroValue(v.type)));
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
        if (baseVar.argIndex !== undefined) {
            this.write(vm.InstructionID.LOAD_ARGVAL, stackIndex, baseVar.argIndex, index, fieldIndex);
        } else {
            this.write(vm.InstructionID.LOAD_VARVAL, stackIndex, this.varAddr(baseVar), index, fieldIndex);
        }
        return Val.newStackValue(variable.type, stackIndex);
    }
    // Convert v to a value that is on the stack.
    private stackify(v?: Val): Val {
        if (!v) return kNullVal;
        if (v.isStackValue()) return v;
        if (v.isLiteral() || v.isConst()) {
            // Literals and const values can be converted to a const data offset.
            const key = CodegenCtx.valConstKey(v);
            const constVal = this.g.constantVals.get(key);
            if (constVal) return constVal;
            const vv = CodegenCtx.literalVarVal(v);
            const addr = -this.g.program.data.length;
            this.g.program.data.push(vv);
            const r = Val.newStackValue(v.type, addr);
            this.g.constantVals.set(key, r);
            return r;
        }
        if (v.isVar() || v.isField()) {
            return this.loadVar(this.nextStackOffset(), v) || kNullVal;
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
        const instArgs = [0];
        program.data.push(vm.VariableValue.single(kIntType, 0));
        for (let i = 1; i < args.length; i++) {
            const a = args[i] as Val;
            program.data.push(CodegenCtx.literalVarVal(a));
            instArgs.push(-i);
        }
        program.inst.push(new vm.Instruction(id, instArgs));
        const exe = new vm.Execution(program, new vm.NullPC());
        exe.run();
        const result = exe.stack[0] as vm.VariableValue;
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
        return inst;
    }
    private expectNumeric(v: Val): boolean {
        if (!v.type.isNumeric()) {
            this.error("expected numeric type", v.loc());
            return false;
        }
        return true;
    }
}
