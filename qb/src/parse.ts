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

import { lex, Location, Token, TokenType } from "./lex";
export { Location, Token } from "./lex";
import {
    BaseType, baseTypeToSigil, FunctionType, kDoubleType, kIntType, kLongType,
    kSingleType, kStringType, sigilToBaseType, Type, UserTypeField,
} from "./types";

export function basicType(b?: BaseType): Type | undefined {
    if (b === BaseType.kInt) return kIntType;
    if (b === BaseType.kString) return kStringType;
    if (b === BaseType.kLongInt) return kLongType;
    if (b === BaseType.kNone || b === BaseType.kSingle) return kSingleType;
    if (b === BaseType.kDouble) return kDoubleType;
    return undefined;
}

export enum ValKind {
    kNone,
    kLiteral,
    kVar,
    kField,
    kConst,
    kStackValue,
    kCommaDelim,
    kSemicolonDelim,
    kArgument,
}

// A value as understood by the parser.
export class Val {
    static newVar(name: string, ty: Type, size?: number[]): Val {
        const v = new Val();
        v.type = ty;
        v.kind = ValKind.kVar;
        if (size) v.size = size;
        v.varName = name;
        return v;
    }
    static newField(name: string, ty: Type, base: Val): Val {
        const v = new Val();
        v.type = ty;
        v.kind = ValKind.kField;
        v.varName = name;
        v.fieldBase = base;
        return v;
    }
    static newConst(name: string, ty: Type, val: number | string): Val {
        const v = new Val();
        v.type = ty;
        v.kind = ValKind.kConst;
        v.varName = name;
        if (v.type === kStringType) v.stringValue = val as string;
        else v.numberValue = val as number;
        v.shared = true; // constants are always shared.
        return v;
    }
    static newStackValue(ty: Type, offset: number): Val {
        const v = new Val();
        v.kind = ValKind.kStackValue;
        v.type = ty;
        v.stackOffset = offset;
        return v;
    }
    static newStringLiteral(val: string): Val {
        const v = new Val();
        v.kind = ValKind.kLiteral;
        v.type = kStringType;
        v.stringValue = val;
        return v;
    }
    static newNumberLiteral(val: number, ty: Type): Val {
        const v = new Val();
        v.kind = ValKind.kLiteral;
        v.type = ty;
        v.numberValue = val;
        return v;
    }
    static newCommaDelim(): Val {
        const v = new Val();
        v.kind = ValKind.kCommaDelim;
        return v;
    }
    static newSemicolonDelim(): Val {
        const v = new Val();
        v.kind = ValKind.kSemicolonDelim;
        return v;
    }
    public kind: ValKind = 0;
    public type: Type;
    public size: number[];
    public isArrayArg: boolean;
    public index: Val[]; // in expression X$(3,4)
    public fieldBase: Val; // in expression X.field, this is X
    public numberValue: number;
    public stringValue: string;
    public varName: string;
    public dimmed?: boolean;
    public shared?: boolean;
    // When true, this is a variable whos value is known.
    public stackOffset: number;
    public argIndex: number; // Non-null for variables which are arguments to subroutines.
    copy(): Val {
        const v = new Val();
        v.kind = this.kind;
        v.type = this.type;
        if (this.size) v.size = this.size;
        if (this.isArrayArg) v.isArrayArg = this.isArrayArg;
        if (this.index) v.index = this.index;
        if (this.fieldBase) v.fieldBase = this.fieldBase;
        if (this.numberValue) v.numberValue = this.numberValue;
        if (this.stringValue) v.stringValue = this.stringValue;
        if (this.varName) v.varName = this.varName;
        if (this.shared) v.shared = this.shared;
        if (this.dimmed) v.dimmed = this.dimmed;
        if (this.stackOffset) v.stackOffset = this.stackOffset;
        if (this.argIndex) v.argIndex = this.argIndex;
        return v;
    }
    isCommaDelim(): boolean { return this.kind === ValKind.kCommaDelim; }
    isSemicolonDelim(): boolean { return this.kind === ValKind.kSemicolonDelim; }
    isVar(): boolean { return this.kind === ValKind.kVar; }
    isField(): boolean { return this.kind === ValKind.kField; }
    isConst(): boolean { return this.kind === ValKind.kConst; }
    isLiteral(): boolean { return this.kind === ValKind.kLiteral; }
    isStackValue(): boolean { return this.kind === ValKind.kStackValue; }
    constNumberValue(): number | undefined {
        if (this.isConst() || this.isLiteral()) {
            if (this.type.isNumeric()) return this.numberValue;
        }
        return undefined;
    }
    loc(): Location | undefined {
        return undefined; // TODO: might be useful to encode location into some values.
    }
    baseType(): BaseType {
        return this.type ? this.type.type : BaseType.kNone;
    }
}

export const kNullVal = new Val();
// A QB graphics coordinate.
export class Coord {
    constructor(public step: boolean, public x: Val, public y: Val) { }
}

export type MVal = Val | undefined;

// The parser is fairly dumb, and just relays information to a context. The primary purpose of the context is to
// generate code, but there are other activities you might perform, like syntax highlighting or autocompletion.
export interface ICtx {
    // Called after parsing the entire program.
    finalize();
    error(message: string, loc: Location);
    defineType(id: Token, t: Type);
    typename(tok: Token): Type | undefined;
    label(tok: Token);
    lineNumber(num: number, tok: Token);
    newline(lineNumber: number);
    data(dataArray: Val[]);
    read(args: Val[]);
    restore(label: number | string);
    variable(varName: Token, sigil: BaseType, defaultType?: Type): Val | undefined;
    declConst(id: Token, ty: BaseType, value: Val);
    index(v: Val, idx: Val[]): Val | undefined;
    // x.field
    indexField(v: Val, idx: Token): Val | undefined;
    dim(name: Token, size: Val[][] | undefined, ty: Type, shared: boolean);
    op(name: string, operands: Val[]): MVal;
    sub(id: Token, args: Val[]): ICtx;
    subExit();
    functionBegin(id: Token, sigil: BaseType, returnType: Type, args: Val[]): ICtx;
    functionExit();
    declArg(id: Token, isArray: boolean, ty: Type | null): Val;
    endSub();
    endFunction();
    declSub(id: Token, args: Val[]);
    declFunction(id: Token, sigil: BaseType, type: Type, args: Val[]);
    isSub(id: string): boolean;
    lookupFunction(id: string): FunctionType | undefined;
    callSub(id: Token, args: Val[]);
    callFunction(id: string, args: Val[]): MVal;
    input(keepCursor: boolean, prompt: string, args: Val[]);
    ifBegin(cond: Val);
    elseBegin(cond?: Val);
    ifEnd();
    selectBegin(v: Val);
    selectCase(vs: Val[]);
    selectCaseElse();
    selectEnd();
    forBegin(idx: Val, f: Val, t: Val, st: Val);
    forExit();
    forEnd();
    doBegin(whileCond: Val);
    doExit();
    doEnd(whileCond: Val);
    whileBegin(whileCond: Val);
    wend();
    gotoLine(no: number, numberToken: Token);
    gotoLabel(lbl: Token);
    goReturn(token: Token | undefined, lbl: number | string | undefined);
    gosub(token: Token, lbl: number | string);
    color(fore?: Val, back?: Val);
    line(a: Coord, b: Coord, color?: Val, option?: string, style?: Val);
    pset(a: Coord, color: Val | undefined);
    locate(x?: Val, y?: Val); // TODO: more parameters
    screen(id: Val);
    palette(attr?: Val, col?: Val);
    sleep(delay?: Val);
    endStmt();
    randomize(seed: Val);
    end();
}

export function parse(ctx: ICtx, tokens: Token[]) {
    const parser = new Parser(ctx, tokens);
    parser.program();
}

// An active block (IF, FOR, WHILE, ...).
class Block {
    public forLabel: string;
    public usedElse = false;
    public singleLine = false;

    constructor(public beginToken: Token, public kind: string) { }
}

export const kValTrue = Val.newNumberLiteral(-1, kIntType);
export const kValZero = Val.newNumberLiteral(0, kIntType);

// Parses QBasic code, relays information to ctx.
class Parser {
    private tokenIndex = 0;
    private isEnd = false;
    private openBlocks: Block[] = [];
    // DEFINT etc... map from first letter to base type.
    private defaultVarTypes = new Map<string, Type>();
    private moduleCtx: ICtx = this.ctx;
    constructor(private ctx: ICtx, private tokens: Token[]) {
    }
    defaultType(varName: string, sigil?: BaseType): Type {
        return Type.basic(sigil) || this.defaultVarTypes.get(varName[0]) || kSingleType;
    }
    currentBlock(): Block | undefined {
        return this.openBlocks.length ? this.openBlocks[this.openBlocks.length - 1] : undefined;
    }
    findBlock(kind: string): Block | undefined {
        for (let i = this.openBlocks.length - 1; i >= 0; i--) {
            const b = this.openBlocks[i];;
            if (b.kind === kind) { return this.openBlocks[i]; }
        }
        return undefined;
    }
    singleLineBlock(): boolean {
        const b = this.currentBlock();
        return b !== undefined && b.singleLine;
    }
    tok(offset: number = 0): Token {
        if (offset + this.tokenIndex >= this.tokens.length) {
            return this.tokens[this.tokens.length - 1]; // eof
        }
        return this.tokens[offset + this.tokenIndex];
    }
    next(eatCount: number = 1) { this.tokenIndex += eatCount; }
    error(msg: string, loc?: Location) {
        if (!loc) {
            loc = this.tok().loc;
        }
        this.ctx.error(msg, loc);
    }
    nextIf(val: string): Token | undefined {
        const t = this.tok();
        if (t.text === val) {
            this.next();
            return t;
        }
        return undefined;
    }

    expectNewline() {
        const t = this.tok();
        if (t.isOp(":") || t.id === TokenType.kNewline) {
            if (t.id === TokenType.kNewline) {
                if (this.singleLineBlock()) {
                    this.error("newline before END");
                }
                this.ctx.newline(this.tok().loc.line + 1);
            }
            this.next();
            return;
        }
        if (this.isEof()) return;
        this.error("expected newline");
        return;
    }

    eatNewlines() {
        while (this.tok().isOp(":") || this.tok().id === TokenType.kNewline) {
            this.expectNewline();
        }
    }

    eatUntilNewline() {
        while (this.tok().id !== TokenType.kNewline && !this.tok().isOp(":") && this.tok().id !== TokenType.kEOF) {
            this.next();
        }
    }

    expectIdent(val?: string): Token | undefined {
        const t = this.tok();
        if (t.id === TokenType.kIdent) {
            if (!val || t.text === val) {
                this.next();
                return t;
            }
        }
        this.error("expected " + (val ? val : "ident"));
        return undefined;
    }
    nextIdent(): Token | undefined {
        const t = this.tok();
        if (t.id === TokenType.kIdent) {
            this.next();
            return t;
        }
        return undefined;
    }
    expectOp(text: string): Token | undefined {
        const t = this.tok();
        if (t.id === TokenType.kOp && t.text === text) {
            this.next();
            return t;
        }
        this.error("expected '" + text + "'");
    }
    isEof(): boolean {
        return this.tokenIndex >= this.tokens.length - 1;
    }
    isEol(): boolean {
        return this.tok().id === TokenType.kNewline || this.tok().isOp(":") || this.isEof();
    }

    typename(): Type | undefined {
        const id = this.expectIdent();
        if (!id) return undefined;
        return this.ctx.typename(id);
    }

    typeStmt() { // TYPE ... END TYPE
        this.expectIdent("TYPE");
        const r = new Val();
        const typeId = this.expectIdent();
        if (!typeId) return false;
        const userType = new Type();
        userType.type = BaseType.kUserType;
        userType.fields = [];
        while (!this.isEof()) {
            this.eatNewlines();
            if (this.nextIf("END")) {
                if (this.expectIdent("TYPE")) {
                    this.ctx.defineType(typeId, userType);
                }
                return;
            }
            const id = this.expectIdent();
            if (id) {
                if (this.expectIdent("AS")) {
                    const ty = this.typename();
                    if (ty) {
                        userType.fields.push(new UserTypeField(id.text, ty));
                    }
                    this.expectNewline();
                }
            }
        }
    }

    label(): boolean { // LabelName:
        if (!this.tok(1).isOp(":")) return false;
        if (this.tok(0).id !== TokenType.kIdent) return false;
        const id = this.expectIdent();
        if (!id) return false;
        this.ctx.label(id);
        this.next();
        return true;
    }

    maybeStringLiteral(): Val | undefined {
        const tok = this.tok();
        if (tok.id === TokenType.kString) {
            this.next();
            return Val.newStringLiteral(tok.text.substr(1, tok.text.length - 2));
        }
        return undefined;
    }

    abs(): Val | undefined {
        this.expectIdent("ABS");
        const args = this.callArgsWithTypes([kDoubleType]);
        if (!args) return undefined;
        return this.ctx.op("ABS", args);
    }
    maybeFunctionCall(): MVal {
        if (!this.tok(0).isIdent()) return undefined;
        const id = this.tok(0).text;
        let tokenCount: number;
        let sigil: BaseType | undefined;
        if (this.tok(1).isSigil()) {
            sigil = sigilToBaseType(this.tok(1).text);
            tokenCount = 2;
        } else {
            tokenCount = 1;
        }
        const func = this.ctx.lookupFunction(id);
        if (!func) return undefined;
        if (sigil) {
            if (Type.basic(sigil) !== func.resultType) {
                this.error("duplicate definition");
                return undefined;
            }
        }
        this.next(tokenCount);
        const args = this.callArgsWithTypes(func.argTypes, func.argTypes.length - func.optionalParameters);
        if (!args) {
            return undefined;
        }
        return this.ctx.callFunction(id, args);
    }

    maybeNumberLiteral(): Val | undefined {
        let idx = 0;
        if (this.tok().isOp("-")) {
            idx = 1;
        }
        const numTok = this.tok(idx);
        if (numTok.id !== TokenType.kNumber) return undefined;
        this.tokenIndex += idx + 1;
        const v = new Val();
        v.kind = ValKind.kLiteral;
        const numTxt: string = numTok.text;
        const isHex = numTxt.startsWith("&H");
        if (!isHex && numTxt.includes("D")) { // 1.0D2
            v.numberValue = parseFloat(numTxt.replace("D", "E"));
            v.type = kDoubleType;
        } else if (!isHex && numTxt.includes("E")) {
            v.numberValue = parseFloat(numTxt);
            v.type = kSingleType;
        } else if (!isHex && numTxt.includes(".")) {
            v.numberValue = parseFloat(numTxt);
            v.type = kSingleType;
            if (this.tok().isOp("#")) {
                v.type = kDoubleType;
                this.next();
            } else if (this.tok().isOp("!")) {
                this.next();
            }
        } else {
            if (isHex) {
                v.numberValue = parseInt(numTxt.substr(2), 16);
            } else {
                v.numberValue = parseInt(numTxt, 10);
            }

            if (this.nextIf("#")) {
                v.type = kDoubleType;
            } else if (this.nextIf("!")) {
                v.type = kSingleType;
                this.next();
            } else if (this.nextIf("%")) {
                v.type = kIntType;
                this.next();
            } else {
                v.type = kSingleType;
            }
        }

        if (idx !== 0) {
            v.numberValue = -v.numberValue;
        }
        return v;
    }
    isModuleLevel(): boolean {
        return this.moduleCtx === this.ctx;
    }
    expectModuleLevel() {
        if (!this.isModuleLevel()) {
            this.error("not in module level");
        }
    }
    dataStmt() { // DATA [value, ...]
        this.expectIdent("DATA");
        this.expectModuleLevel();
        const datas: Val[] = [];
        while (1) {
            let v = this.maybeStringLiteral() || this.maybeNumberLiteral();
            if (!v) {
                if (this.tok().id === TokenType.kIdent) { // unquoted string
                    v = new Val();
                    v.stringValue = this.tok().text;
                } else {
                    this.error("expected data literal");
                    this.eatUntilNewline();
                    return true;
                }
            }
            datas.push(v);
            if (!this.nextIf(",")) break;
        }
        this.ctx.data(datas);
    }
    readStmt() {
        this.expectIdent("READ");
        const args = this.varRefsUntilNewline();
        if (args) this.ctx.read(args);
        return true;
    }
    restoreStmt() {
        this.expectIdent("RESTORE");
        const lbl = this.labelOrLineNumber();
        if (lbl === undefined) return;
        this.ctx.restore(lbl);
    }
    maybeSigil(): BaseType {
        const next = this.tok();
        if (next.id === TokenType.kOp) {
            const baseType = sigilToBaseType(next.text);
            if (baseType !== BaseType.kNone) {
                ++this.tokenIndex;
                return baseType;
            }
        }
        return BaseType.kNone;
    }

    maybeVarname(allowIndex?: boolean): Val | undefined { // <ident>[type-sigil]
        if (this.tok().id !== TokenType.kIdent) return undefined;
        return this.varname(allowIndex);
    }

    maybeArrayReference(): Val | undefined { // X%()
        if (this.tok().id !== TokenType.kIdent) return undefined;
        const oldTokenIndex = this.tokenIndex;
        const id = this.expectIdent() as Token;
        const sigil = this.maybeSigil();
        if (!this.nextIf("(") || !this.nextIf(")")) {
            this.tokenIndex = oldTokenIndex;
            return undefined;
        }
        // TODO: There is currently no distinction between passing parameters by array or not.
        return this.ctx.variable(id, sigil, undefined);
    }

    varname(allowIndex?: boolean): Val | undefined { // <ident>[type-sigil]
        const id = this.expectIdent();
        if (!id) return undefined;
        const sig = this.maybeSigil();
        let v = this.ctx.variable(id, sig, this.defaultType(id.text, sig));
        if (!allowIndex) return v;
        if (v && this.tok().isOp("(")) {
            v = this.ctx.index(v, this.arrayIndex());
        }
        while (v && this.nextIf(".")) {
            const field = this.expectIdent();
            if (!field) return undefined;
            v = this.ctx.indexField(v, field);
        }
        return v;
    }

    arrayIndex(): Val[] {
        this.expectOp("(");
        const idx: Val[] = [];
        while (!this.isEol()) {
            const v = this.numericExpr();
            if (!v) break;
            idx.push(v);
            if (this.nextIf(")")) return idx;
            if (!this.expectOp(",")) return [];
        }
        this.expectOp(")");
        return [];
    }
    sizeOrRange(): Val[] | undefined {
        const i = this.numericExpr();
        if (!i) { // TODO: CONST
            this.error("expected number");
            return undefined;
        }
        if (this.nextIf("TO")) {
            const to = this.numericExpr();
            if (!to) {
                this.error("expected number");
                return undefined;
            }
            return [i, to];
        }
        return [i];
    }
    maybeArraySize(): Val[][] | undefined {
        if (!this.nextIf("(")) return undefined;
        const result: Val[][] = [];
        while (1) {
            const d = this.sizeOrRange();
            if (!d) return undefined;
            result.push(d);
            if (!this.nextIf(",")) break;
        }
        if (!this.expectOp(")")) return undefined;
        return result;
    }

    dimStmt() { // DIM [SHARED] <ident> [AS <type>]
        this.expectIdent("DIM");
        const shared = this.nextIf("SHARED");
        let id = this.expectIdent();
        let sigil = this.maybeSigil();
        if (!id) return;
        let size = this.maybeArraySize();
        while (true) {
            let ty = this.defaultType(id.text, sigil);
            if (this.nextIf("AS")) {
                const result = this.typename();
                if (!result) return;
                ty = result;
            }
            this.ctx.dim(id, size, ty, shared !== undefined);
            if (this.tok().isOp(",")) {
                ++this.tokenIndex;
                id = this.expectIdent();
                size = this.maybeArraySize();
                if (!id) {
                    this.eatUntilNewline();
                    break;
                }
                continue;
            }
            break;
        }
        return true;
    }
    expr6(): Val | undefined {
        if (this.nextIf("(")) {
            const expr = this.expr();
            if (this.expectOp(")")) return expr;
            return undefined;
        }
        if (this.tok().isIdent("ABS")) return this.abs();
        const unaryNeg = this.nextIf("-");
        const r = this.maybeFunctionCall() || this.maybeVarname(true) || this.maybeNumberLiteral() || this.maybeStringLiteral();
        if (r) {
            if (unaryNeg) {
                if (r.isLiteral() && r.type.isNumeric()) {
                    r.numberValue = -r.numberValue;
                } else {
                    return this.ctx.op("-", [r]);
                }
            }
            return r;
        }
        this.error("expected value");
        this.eatUntilNewline();
        return undefined;
    }
    // There are many layers to QBasic's operator precedence, which implies many functions for a recursive descent
    // parser. This template is used to create methods for most operators.
    binaryExprTemplate(ops: string[], nextFunc: () => Val): Val | undefined {
        let lhs = nextFunc();
        while (lhs) {
            const op = this.tok();
            let matches = false;
            for (const o of ops) {
                if (op.text === o) {
                    this.next();
                    const rhs = nextFunc();
                    if (!rhs) return undefined;
                    const result = this.ctx.op(op.text, [lhs, rhs]);
                    if (!result) return undefined;
                    lhs = result;
                    matches = true;
                    break;
                }
            }
            if (!matches) break;
        }
        return lhs;
    }
    expr5 = () => this.binaryExprTemplate(["^"], this.expr6.bind(this));
    expr4 = () => this.binaryExprTemplate(["*", "/"], this.expr5.bind(this));
    expr3 = () => this.binaryExprTemplate(["MOD", "\\"], this.expr4.bind(this));
    expr2 = () => this.binaryExprTemplate(["+", "-"], this.expr3.bind(this));
    expr1 = () => this.binaryExprTemplate([">", "<", ">=", "<=", "=", "<>"], this.expr2.bind(this));
    exprL6(): Val | undefined {
        while (!this.isEol()) {
            if (this.nextIf("NOT")) {
                const rhs = this.exprL6();
                if (!rhs) return undefined;
                return this.ctx.op("NOT", [rhs]);
            }
            return this.expr1();
        }
    }
    exprL5 = () => this.binaryExprTemplate(["AND"], this.exprL6.bind(this));
    exprL4 = () => this.binaryExprTemplate(["OR"], this.exprL5.bind(this));
    exprL3 = () => this.binaryExprTemplate(["XOR"], this.exprL4.bind(this));
    exprL2 = () => this.binaryExprTemplate(["EQV"], this.exprL3.bind(this));
    exprL1 = () => this.binaryExprTemplate(["IMP"], this.exprL2.bind(this));

    expr(): Val | undefined {
        return this.exprL1();
    }
    numericExpr(): Val | undefined {
        const v = this.expr();
        if (v && v.type && !v.type.isNumeric()) {
            this.error("expected numeric");
            return undefined;
        }
        return v;
    }
    printStmt() {
        if (this.nextIf("PRINT")) { } else this.expectOp("?");
        if (this.nextIf("USING")) {            // TODO:
            this.eatUntilNewline();
            return;
        }
        const vals: Val[] = [];
        while (!this.isEol()) {
            const v = this.expr();
            if (!v) {
                this.eatUntilNewline();
                return true;
            }
            vals.push(v);
            if (this.tok().isOp(",")) {
                this.next();
                vals.push(Val.newCommaDelim());
                continue;
            }
            if (this.tok().isOp(";")) {
                this.next();
                vals.push(Val.newSemicolonDelim());
                continue;
            }
            break;
        }
        this.ctx.op("PRINT", vals);
    }

    locateStmt() {
        this.expectIdent("LOCATE");
        let x: Val | undefined;
        let y: Val | undefined;
        if (this.tok().isOp(",")) {
            this.next();
            y = this.numericExpr();
        } else {
            x = this.numericExpr();
            if (this.tok().isOp(",")) {
                this.next();
                y = this.numericExpr();
            }
        }
        this.ctx.locate(x, y);
    }

    letStmt(): boolean {
        this.nextIf("LET");
        const v = this.maybeVarname(true);
        if (!v) return false;
        if (this.expectOp("=")) {
            const rhs = this.expr();
            if (!rhs) return true;
            this.ctx.op("assign", [v, rhs]);
        }
        return true;
    }

    clsStmt() {
        this.expectIdent("CLS");
        this.ctx.op("CLS", []);
    }

    declArgs(): Val[] {
        if (!this.tok().isOp("(")) { return []; }
        this.next();
        const args: Val[] = [];
        while (!this.isEol() && !this.tok().isOp(")")) {
            if (args.length) {
                this.expectOp(",");
            }
            const id = this.expectIdent();
            const sig = this.maybeSigil();
            let isArray = false;
            if (this.nextIf("(")) {
                isArray = true;
                this.expectOp(")");
            }
            let ty = Type.basic(sig);
            if (this.nextIf("AS")) {
                const declType = this.typename();
                if (declType && sig !== BaseType.kNone && declType.type !== sig) {
                    this.error("mismatched type");
                } else if (declType) {
                    ty = declType;
                }
            }
            if (!ty) {
                ty = kSingleType;
            }
            if (id) {
                args.push(this.ctx.declArg(id, isArray, ty));
            } else { break; }
        }
        this.expectOp(")");
        return args;
    }

    ifStmt() {
        // TODO: IF <numeric-expr> GOTO line
        const ifTok = this.expectIdent("IF");
        if (!ifTok) return;
        const cond = this.expr();
        if (!cond) return;
        const wasSingleLine = this.singleLineBlock();
        const block = new Block(ifTok, "IF");
        block.singleLine = wasSingleLine;
        this.openBlocks.push(block);
        if (!this.expectIdent("THEN")) return;
        this.ctx.ifBegin(cond);
        if (!block.singleLine && this.tok().isNewlineOrColon()) {
            return;
        }
        block.singleLine = true;
        const readSomeStatements = () => {
            while (1) {
                if (!this.tok().isIdent("ELSE") && !this.tok().isIdent("ELSEIF")) {
                    this.statement();
                    if (this.nextIf(":")) continue;
                    break;
                } else {
                    break;
                }
            }
        };
        readSomeStatements();
        while (1) {
            if (this.tok().isIdent("ELSE")) {
                this.elseStmt();
                readSomeStatements();
            } else if (this.tok().isIdent("ELSEIF")) {
                this.elseIfStmt();
                readSomeStatements();
            } else if (this.tok().isNewline()) {
                break;
            } else {
                this.error("expected ELSE, ELSEIF, or newline");
                break;
            }
        }
        if (this.currentBlock() !== block) {
            this.error("cannot open block within single line if-statement");
            return;
        }
        this.openBlocks.pop();
        this.ctx.ifEnd();
    }
    elseStmt() {
        const elseTok = this.expectIdent("ELSE");
        if (!elseTok) return;
        const block = this.currentBlock();
        if (!block || block.kind !== "IF") {
            this.error("ELSE without IF", elseTok.loc);
            return;
        }
        if (block.usedElse) {
            this.error("ELSE after ELSE", elseTok.loc);
            return;
        }
        this.ctx.elseBegin();
    }
    elseIfStmt() {
        const elseifTok = this.expectIdent("ELSEIF");
        if (!elseifTok) return;
        const block = this.currentBlock();
        if (!block || block.kind !== "IF") {
            this.error("ELSEIF without IF", elseifTok.loc);
            return;
        }
        if (block.usedElse) {
            this.error("ELSEIF after ELSE", elseifTok.loc);
            return;
        }
        const cond = this.expr();
        if (!cond) return;
        this.expectIdent("THEN");
        this.ctx.elseBegin(cond);
    }
    selectStmt() {
        const beginTok = this.expectIdent("SELECT");
        const v = beginTok && this.expectIdent("CASE") && this.expr();
        if (!v) return;
        this.openBlocks.push(new Block(beginTok as Token, "SELECT"));
        this.ctx.selectBegin(v);
    }
    caseStmt() {
        this.expectIdent("CASE");
        const block = this.currentBlock();
        if (!block || block.kind !== "SELECT") {
            this.error("CASE without SELECT");
            return;
        }
        if (block.usedElse) {
            this.error("CASE ELSE must be last");
            return;
        }
        if (this.nextIf("ELSE")) {
            block.usedElse = true;
            this.ctx.selectCaseElse();
        } else {
            let cases: Val[] = [];
            do {
                const next = this.expr();
                if (!next) return;
                cases.push(next);
            } while (this.nextIf(","));
            this.ctx.selectCase(cases);
        }
    }
    screenStmt() {
        this.expectIdent("SCREEN");
        const id = this.numericExpr();
        if (id) this.ctx.screen(id);
    }
    letter(): string | undefined {
        if (!this.tok(0).isIdent()) { this.error("expected letter"); return undefined; }
        const txt = this.tok(0).text;
        if (!/[A-Z]/.test(txt)) { this.error("expected letter"); return undefined; }
        this.next();
        return txt;
    }
    letterRange(): Set<string> | undefined { // A[-Z]
        const a = this.letter();
        if (!a) return undefined;
        if (!this.nextIf("-")) return new Set([a]);
        const z = this.letter();
        if (!z) return undefined;
        if (z.charCodeAt(0) < a.charCodeAt(0)) {
            this.error("invalid range");
            return undefined;
        }
        const result = new Set<string>();
        for (let i = a.charCodeAt(0); i <= z.charCodeAt(0); i++) {
            result.add(String.fromCharCode(i));
        }
        return result;
    }
    letterRanges(): Set<string> | undefined { // A-C, G-H
        let range: Set<string> | undefined;
        while (true) {
            const r = this.letterRange();
            if (!r) return undefined;
            if (range) {
                for (const v of r) range.add(v);
            } else range = r;
            if (!this.nextIf(",")) return range;
        }
    }
    defABCStmt() {
        let ty: Type | undefined;
        switch (this.tok().text) {
            case "DEFINT": ty = kIntType; break;
            case "DEFLNG": ty = kLongType; break;
            case "DEFSNG": ty = kSingleType; break;
            case "DEFDBL": ty = kDoubleType; break;
            case "DEFSTR": ty = kStringType; break;
            default: {
                this.error("expected DEFXYZ"); // should not happen.
                return;
            }
        }
        this.next();
        const range = this.letterRanges();
        if (!range) return;
        for (const c of range) {
            this.defaultVarTypes.set(c, ty);
        }
    }
    colorStmt() { // COLOR [<fore>][, <back>]
        this.expectIdent("COLOR");
        let fore: Val | undefined;
        let back: Val | undefined;
        if (this.tok().isOp(",")) {
            this.next();
            back = this.expr();
        } else {
            fore = this.numericExpr();
            if (this.tok().isOp(",")) {
                this.next();
                back = this.numericExpr();
            }
        }
        this.ctx.color(fore, back);
    }
    paletteStmt() { // PALETTE [attr, color]
        this.expectIdent("PALETTE");
        if (this.tok().isNewlineOrColon()) {
            this.ctx.palette();
            return;
        }
        const attr = this.numericExpr();
        this.expectOp(",");
        this.ctx.palette(attr, this.numericExpr());
    }
    subStmt() { // SUB <name> [(<args>)] ... END SUB
        const begin = this.expectIdent("SUB");
        if (!begin) { return; }
        this.expectModuleLevel();
        this.isEnd = true;
        const id = this.expectIdent();
        if (!id) { return; }
        const subCtx = this.ctx.sub(id, this.declArgs());
        this.ctx = subCtx;
        this.nextIf("STATIC"); // TODO: Ignore for now
        this.openBlocks.push(new Block(begin, "SUB"));
    }
    functionStmt() {
        const begin = this.expectIdent("FUNCTION");
        if (!begin) { return; }
        this.expectModuleLevel();
        this.isEnd = true;
        const id = this.expectIdent();
        if (!id) { return; }
        const sig = this.maybeSigil();
        const subCtx = this.ctx.functionBegin(id, sig, this.defaultType(id.text, sig), this.declArgs());
        this.ctx = subCtx;
        this.openBlocks.push(new Block(begin, "FUNCTION"));
    }

    declareStmt() { // DECLARE SUB <name> (<args>)
        this.expectIdent("DECLARE");
        this.expectModuleLevel();
        if (this.nextIf("SUB")) {
            const id = this.expectIdent();
            if (!id) { return; }
            this.ctx.declSub(id, this.declArgs());
            return;
        }
        if (this.nextIf("FUNCTION")) {
            const id = this.expectIdent();
            if (!id) { return; }
            const sig = this.maybeSigil();
            this.ctx.declFunction(id, sig, this.defaultType(id.text, sig), this.declArgs());
            return;
        }
        this.error("expected SUB or FUNCTION");
        return;
    }

    callArgsWithTypes(types: Type[], requiredArgsCount: number = -1): Val[] | undefined {
        if (requiredArgsCount === -1) { requiredArgsCount = types.length; }
        const args = this.callArgs(true, requiredArgsCount);
        if (!args || args.length > types.length) { return undefined; }
        if (args.length < requiredArgsCount) {
            this.error(`expected ${requiredArgsCount} arguments`);
            return undefined;
        }
        for (let i = 0; i < args.length; i++) {
            if (types[i].isNumeric()) {
                if (!args[i].type || !args[i].type.isNumeric()) {
                    this.error(`expected numeric for argument ${i + 1}`);
                    return undefined;
                }
            }
            if (types[i].isString()) {
                if (!args[i].type || !args[i].type.isString()) {
                    this.error(`expected string for argument ${i + 1}`);
                    return undefined;
                }
            }
        }
        return args;
    }
    callArgs(wantParen: boolean, expectedCount = -1): Val[] | undefined {
        if (wantParen && !this.tok().isOp("(")) {
            if (expectedCount >= 1) {
                this.error(`expected ${expectedCount} arguments`);
            }
            return [];
        }
        if (wantParen) { this.expectOp("("); }
        const args: Val[] = [];
        while (true) {
            if (wantParen ? this.tok().isOp(")") : this.isEol()) {
                if (expectedCount >= 0 && args.length < expectedCount) {
                    this.error(`expected ${expectedCount} arguments`);
                    return args;
                }
                if (wantParen) { this.expectOp(")"); }
                return args;
            }
            if (this.isEol()) { break; }
            const e = this.maybeArrayReference() || this.expr();
            if (!e) return undefined;
            args.push(e);
            if (wantParen ? this.tok().isOp(")") : this.isEol()) { continue; }
            if (!this.tok().isOp(",")) {
                this.error("expected ',' or )");
                return args;
            }
            this.next();
        }
        this.error("expected argument");
        return args;
    }

    argsUntilNewline(): Val[] | undefined {
        const args = [];
        while (!this.isEol()) {
            const e = this.expr();
            if (!e) return undefined;
            args.push();
            if (this.isEol()) {
                this.expectNewline();
                return args;
            }
            if (!this.tok().isOp(",")) {
                this.error("expected ',' or newline");
                return args;
            }
        }
        this.expectNewline();
        return args;
    }

    varRefsUntilNewline(): Val[] | undefined {
        const args: Val[] = [];
        while (!this.isEol()) {
            // TODO: This is pretty ugly. Single-line IF statements force checking additional terminals...
            if (this.tok().text === "END" || this.tok().text === "ELSE" || this.tok().text === "ELSEIF") {
                break;
            }
            const v = this.maybeVarname(true);
            if (!v) { this.expectIdent(); return undefined; }
            args.push(v);
            if (this.isEol()) {
                return args;
            }
            if (!this.expectOp(",")) {
                return undefined;
            }
        }
        return args;
    }

    maybeCallSubStmt(): boolean { // <name> [(<args>)]
        const call = this.nextIf("CALL");
        if (!this.tok().isIdent()) {
            if (call) {
                this.error("expected identifier");
                return true;
            }
            return false;
        }
        const subNameTok = this.tok();
        const subName = subNameTok.text;
        if (!this.ctx.isSub(subName)) { return false; }
        this.next();
        const args = this.callArgs(!!call);
        if (args) this.ctx.callSub(subNameTok, args);
        return true;
    }

    inputStmt(): boolean { // INPUT [;] [<prompt> :|,] <variable, list>
        this.expectIdent("INPUT");
        let keepCursor = false;
        if (this.tok().isOp(";")) {
            this.next();
            keepCursor = true;
        }
        let prompt: string;
        if (this.tok().isString()) {
            prompt = this.tok().stringVal();
            this.next();
            if (this.tok().isOp(";")) {
                prompt += "? ";
                this.next();
            } else if (this.tok().isOp(",")) {
                this.next();
            } else {
                this.error("expected ; or ,");
                this.eatUntilNewline();
                return true;
            }
        } else {
            prompt = "? ";
        }
        const args = this.varRefsUntilNewline();
        if (args) this.ctx.input(keepCursor, prompt, args);
        return true;
    }

    maybeLabels(): boolean {
        let hadLabels = false;
        if (this.tok().isNumber() && /^[0-9]+$/.test(this.tok().text)) {
            this.ctx.lineNumber(parseInt(this.tok().text, 10), this.tok());
            this.next();
            hadLabels = true;
        }
        return this.label() || hadLabels;
    }

    gotoStmt() {
        this.expectIdent("GOTO");
        if (this.tok().isNumber() && /^[0-9]+$/.test(this.tok().text)) {
            this.ctx.gotoLine(parseInt(this.tok().text, 10), this.tok());
            this.next();
        } else {
            const lbl = this.expectIdent();
            if (lbl) {
                this.ctx.gotoLabel(lbl);
            }
        }
    }
    labelOrLineNumber(): number | string | undefined {
        if (this.tok().isNumber() && /^[0-9]+$/.test(this.tok().text)) {
            const result = parseInt(this.tok().text, 10);
            this.next();
            return result;
        } else {
            const lbl = this.expectIdent();
            if (lbl) return lbl.text;
        }
        this.error("expected line number or label");
        return undefined;
    }
    gosubStmt() {
        this.expectIdent("GOSUB");
        const tok = this.tok();
        const lbl = this.labelOrLineNumber();
        if (lbl === undefined) return;
        this.ctx.gosub(tok, lbl);
    }
    returnStmt() {
        this.expectIdent("RETURN");
        let lbl: number | string | undefined;
        let tok: Token | undefined;
        if (!this.isEol()) {
            tok = this.tok();
            lbl = this.labelOrLineNumber();
            if (lbl === undefined) return;
        }
        this.ctx.goReturn(tok, lbl);
    }
    nextStmt() {
        this.expectIdent("NEXT");
        const block = this.currentBlock();
        if (!block || block.kind !== "FOR") {
            this.error("next without for");
            return;
        }
        const forLabel = block.forLabel;
        if (this.tok().isNewlineOrColon()) {
            this.ctx.forEnd();
            this.openBlocks.pop();
            return;
        }
        const nextVar = this.maybeVarname();
        if (!nextVar) return;
        if (nextVar.varName !== forLabel) {
            this.error("NEXT variable does not match FOR");
        } else {
            this.ctx.forEnd();
            this.openBlocks.pop();
        }
    }
    forStmt() {
        // FOR i = 100 TO 500 STEP 50
        const forTok = this.expectIdent("FOR");
        if (!forTok) return;
        const idx = this.varname();
        if (!idx) return;
        this.expectOp("=");
        const f = this.numericExpr();
        if (!f) return;
        if (!this.expectIdent("TO")) return;
        const t = this.numericExpr();
        if (!t) return;
        let st;
        if (this.nextIf("STEP")) {
            st = this.numericExpr();
        }
        this.ctx.forBegin(idx, f, t, st);
        const forLabel = idx.varName;
        const b = new Block(forTok, "FOR");
        b.forLabel = forLabel;
        this.openBlocks.push(b);
        return true;
    }
    doStmt() {
        const doTok = this.expectIdent("DO");
        if (!doTok) return;
        let whileCond: MVal = kValTrue;
        if (this.nextIf("UNTIL")) {
            const until = this.expr();
            if (!until) return;
            whileCond = this.ctx.op("LNOT", [until]);
        } else if (this.nextIf("WHILE")) {
            const cond = this.expr();
            if (!cond) return;
            whileCond = cond;
        }
        if (!whileCond) return;
        this.openBlocks.push(new Block(doTok, "DO"));
        this.ctx.doBegin(whileCond);
    }
    loopStmt() {
        this.expectIdent("LOOP");
        const block = this.currentBlock();
        if (!block || block.kind !== "DO") {
            this.error("LOOP without DO");
            return;
        }
        this.openBlocks.pop();
        let untilCond: MVal = kValZero;
        if (this.nextIf("UNTIL")) {
            const cond = this.expr();
            if (!cond) return;
            untilCond = cond;
        } else if (this.nextIf("WHILE")) {
            const cond = this.expr();
            if (!cond) return;
            untilCond = this.ctx.op("LNOT", [cond]);
        }
        if (!untilCond) return;
        this.ctx.doEnd(untilCond);
    }
    whileStmt() {
        const whileTok = this.expectIdent("WHILE");
        if (!whileTok) return;
        this.openBlocks.push(new Block(whileTok, "WHILE"));
        const e = this.expr();
        if (!e) return;
        this.ctx.whileBegin(e);
    }
    wendStmt() {
        this.expectIdent("WEND");
        const block = this.currentBlock();
        if (!block || block.kind !== "WHILE") {
            this.error("WEND without WHILE");
            return;
        }
        this.ctx.wend();
        this.openBlocks.pop();
    }
    exitStmt() {
        this.expectIdent("EXIT");
        const block = this.currentBlock();
        if (!block) {
            this.error("EXIT without FOR, DO, or SUB");
            return;
        }
        switch (this.tok().text) {
            case "FOR": {
                this.expectIdent("FOR");
                if (!this.findBlock("FOR")) {
                    this.error("EXIT FOR without FOR");
                    break;
                }
                this.ctx.forExit();
                break;
            }
            case "DO": {
                this.expectIdent("DO");
                if (!this.findBlock("DO")) {
                    this.error("EXIT DO without DO");
                    break;
                }
                this.ctx.doExit();
                break;
            }
            case "SUB": {
                this.expectIdent("SUB");
                if (!this.findBlock("SUB")) {
                    this.error("EXIT SUB without SUB");
                    break;
                }
                this.ctx.subExit();
                break;
            }
            case "FUNCTION": {
                this.expectIdent("FUNCTION");
                if (!this.findBlock("FUNCTION")) {
                    this.error("EXIT FUNCTION without FUNCTION");
                    break;
                }
                this.ctx.functionExit();
                break;
            }
        }
    }
    coord(): Coord | undefined {
        let step = false;
        if (this.nextIf("STEP")) {
            step = true;
        }
        if (!this.tok().isOp("(")) {
            if (step) {
                this.error("expected (coordinate)");
            }
            return undefined;
        }
        this.next();
        const x = this.numericExpr();
        this.expectOp(",");
        const y = this.numericExpr();
        this.expectOp(")");
        if (x && y) return new Coord(step, x, y);
    }
    psetStmt() {
        this.expectIdent("PSET");
        const a = this.coord();
        if (!a) return;
        let color: Val | undefined;
        if (this.tok().isOp(",")) {
            this.next();
            if (!this.tok().isOp(",")) {
                color = this.numericExpr();
            }
        }
        this.ctx.pset(a, color);
    }
    lineStmt() {
        this.expectIdent("LINE");
        const a = this.coord();
        this.expectOp("-");
        const b = this.coord();
        if (!a || !b) return;
        let color: Val | undefined;
        let option = "";
        let style: Val | undefined;
        if (this.tok().isOp(",")) {
            this.next();
            if (!this.tok().isOp(",")) {
                color = this.numericExpr();
                if (!color) return;
            }
            if (this.tok().isOp(",")) {
                this.next();
                if (this.nextIf("B")) {
                    option = "B";
                } else if (this.nextIf("BF")) {
                    option = "BF";
                } else if (!this.tok().isOp(",")) {
                    this.error("expected B, BF, or ','");
                }
                if (this.tok().isOp(",")) {
                    this.next();
                    style = this.numericExpr();
                    if (!style) return;
                }
            }
        }
        this.ctx.line(a, b, color, option, style);
    }
    circleStmt() {
        this.expectIdent("CIRCLE"); // TODO
        this.eatUntilNewline();
    }
    paintStmt() {
        this.expectIdent("PAINT"); // TODO
        this.eatUntilNewline();
    }
    sleepStmt() {
        this.expectIdent("SLEEP");
        if (!this.isEol()) {
            this.ctx.sleep(this.numericExpr());
        } else {
            this.ctx.sleep(undefined);
        }
    }
    constStmt() {
        this.expectIdent("CONST");
        do {
            const id = this.expectIdent();
            if (!id) return;
            const sig = this.maybeSigil();
            this.expectOp("=");
            const rhs = this.expr();
            if (!rhs) return;
            this.ctx.declConst(id, sig, rhs);
        } while (this.nextIf(","));
    }
    randomizeStmt() {
        this.expectIdent("RANDOMIZE");
        const expr = this.numericExpr();
        if (!expr) return;
        this.ctx.randomize(expr);
    }
    endStmt() {
        this.expectIdent("END");
        switch (this.tok().text) {
            case "SUB": {
                this.next();
                const block = this.currentBlock();
                if (!block || block.kind !== "SUB") {
                    this.error("END SUB without SUB");
                    return;
                }
                this.ctx.endSub();
                this.ctx = this.moduleCtx;
                this.openBlocks.pop();
                break;
            }
            case "FUNCTION": {
                this.next();
                const block = this.currentBlock();
                if (!block || block.kind !== "FUNCTION") {
                    this.error("END FUNCTION without FUNCTION");
                    return;
                }
                this.ctx.endFunction();
                this.ctx = this.moduleCtx;
                this.openBlocks.pop();
                break;
            }
            case "IF": {
                this.next();
                const block = this.currentBlock();
                if (!block || block.kind !== "IF") {
                    this.error("END IF without IF");
                    return;
                }
                this.ctx.ifEnd();
                this.openBlocks.pop();
                break;
            }
            case "SELECT": {
                this.next();
                const block = this.currentBlock();
                if (!block || block.kind !== "SELECT") {
                    this.error("END SELECT without SELECT");
                    return;
                }
                this.ctx.selectEnd();
                this.openBlocks.pop();
                break;
            }
            default:
                this.ctx.end();
        }
    }
    statement(): boolean {
        if (this.isEof()) { return false; }
        const hasLabels = !this.singleLineBlock() && this.maybeLabels();
        while (1) {
            const moduleLevel = this.isModuleLevel();

            if (this.isEnd && moduleLevel) {
                if (this.tok().text != "SUB" && this.tok().text != "FUNCTION") {
                    this.error("expected SUB, FUNCTION, or EOF");
                    return false;
                }
            }
            let handled = true;
            switch (this.tok().text) {
                case "DECLARE": this.declareStmt(); break;
                case "SUB": this.subStmt(); break;
                case "FUNCTION": this.functionStmt(); break;
                case "IF": this.ifStmt(); break;
                case "ELSE": this.elseStmt(); break;
                case "ELSEIF": this.elseIfStmt(); break;
                case "SCREEN": this.screenStmt(); break;
                case "DEFINT": case "DEFSTR": case "DEFSNG": case "DEFLNG": case "DEFDBL": this.defABCStmt(); break;
                case "SELECT": this.selectStmt(); break;
                case "CASE": this.caseStmt(); break;
                case "GOSUB": this.gosubStmt(); break;
                case "RETURN": this.returnStmt(); break;
                case "FOR": this.forStmt(); break;
                case "NEXT": this.nextStmt(); break;
                case "EXIT": this.exitStmt(); break;
                case "COLOR": this.colorStmt(); break;
                case "PRINT": case "?": this.printStmt(); break;
                case "LINE": this.lineStmt(); break;
                case "GOTO": this.gotoStmt(); break;
                case "LOCATE": this.locateStmt(); break;
                case "PALETTE": this.paletteStmt(); break;
                case "SLEEP": this.sleepStmt(); break;
                case "DIM": this.dimStmt(); break;
                case "INPUT": this.inputStmt(); break;
                case "CLS": this.clsStmt(); break;
                case "CIRCLE": this.circleStmt(); break;
                case "PAINT": this.paintStmt(); break;
                case "PSET": this.psetStmt(); break;
                case "DO": this.doStmt(); break;
                case "TYPE": this.typeStmt(); break;
                case "LOOP": this.loopStmt(); break;
                case "WHILE": this.whileStmt(); break;
                case "WEND": this.wendStmt(); break;
                case "CONST": this.constStmt(); break;
                case "RANDOMIZE": this.randomizeStmt(); break;
                case "END": this.endStmt(); break;
                case "DATA": this.dataStmt(); break;
                case "READ": this.readStmt(); break;
                case "RESTORE": this.restoreStmt(); break;
                // TODO:
                case "PLAY": case "WIDTH": case "VIEW": case "POKE": case "PEEK": this.eatUntilNewline(); break;
                case "DEF": this.expectIdent("DEF"); this.expectIdent("SEG"); this.eatUntilNewline(); break;
                default: handled = false;
            }
            if (handled) { break; }
            if (this.maybeCallSubStmt()) { break; }
            if (this.letStmt()) { break; }
            // Should only have empty statement when labels are used (since newlines are eaten).
            if (hasLabels) { break; }
            this.error("expected statement");
            return false;
        }
        this.ctx.endStmt();
        return true;
    }
    statementAndNewline() {
        if (!this.statement()) {
            this.eatUntilNewline();
            this.next();
            return;
        }
        this.expectNewline();
    }
    program() {
        while (!this.isEof()) {
            this.eatNewlines();
            this.statementAndNewline();
        }
        if (this.openBlocks.length) {
            const block = this.openBlocks[this.openBlocks.length - 1];
            this.error(`${block.kind} without END`, block.beginToken.loc);
        }
        this.ctx.finalize();
    }
}

// I need to either implement, or decide to not implement the following:

// Basic language constructs
// DEF FN Statement
// DEFtype Statements - Set the default data type for variables, DEF FN functions, and FUNCTION procedures
// DIM SHARED
// ERASE Statement
// ERROR Statement - raise errors
// EXIT Statement
// FUNCTION Statement
// GOSUB...RETURN Statements
// HEX$ Function
// INSTR Function - Returns the character position of the first occurrence of a string in another string
//      INSTR([[start,]]stringexpression1,stringexpression2)
// SPC Function
// SPACE$ Function
// SQR Function
// LBOUND Function
// LCASE$ Function
// LEFT$ Function
// LEN Function
// LINE INPUT Statement
// INPUT$ Function
// LOCATE Statement
// LOG Function
// LTRIM$ Function
// MID$ Function
// MID$ Statement
// MKSMBF$, MKDMBF$ Functions
// OCT$ Function
// ON ERROR Statement
// ON event Statements
// ON UEVENT GOSUB Statement
// ON...GOSUB, ON...GOTO Statements
// OPTION BASE Statement
// CVI, CVS, CVL, CVD Functions  - Convert strings containing numeric values to numbers
//   SYNTAX  CVI(2-byte-string)
//   CVS(4-byte-string)
//   CVL(4-byte-string)
//   CVD(8-byte-string)
// CSRLIN Function  -  Returns the current line (row) position of the cursor
// CVSMBF, CVDMBF Functions - Convert strings containing Microsoft Binary format numbers to IEEE-format numbers
// DATE$ Function - Returns a string containing the current date
// DATE$ Statement - Sets the current date
// POS Function
// PRINT USING Statement
// RANDOMIZE Statement
// READ Statement
// REDIM Statement
// RESTORE Statement
// RESUME Statement
// RETURN Statement
// RIGHT$ Function
// RTRIM$ Function
// RUN Statement
// SCREEN Function
// SCREEN Statement
// SELECT CASE Statement
// SGN Function
// SHARED Statement
// STATIC Statement
// SWAP Statement
// TYPE Statement
// UCASE$ Function
// STOP Statement
// STRING$ Function
// VIEW Statement
// VIEW PRINT Statement
// TAB Function
// TIME$ Function
// TIME$ Statement
// TIMER Function
// TIMER ON, OFF, and STOP Statements
// TRON/TROFF Statements
// UBOUND Function
// UEVENT Statement
// KEY Statements
// KEY(n) Statements

// Graphics
// WIDTH Statement
// CIRCLE Statement
// WINDOW Statement
// DRAW Statement
// GET Statement──Graphics
// PUT Statement──Graphics
// MKD$, MKI$, MKL$, MKS$ Functions
// PAINT Statement
// PALETTE USING Statements
// PCOPY Statement
// PMAP Function
// POINT Function
// PRESET Statement

// Sound
// BEEP Statement
// PLAY Function
// PLAY Statement
// PLAY ON, OFF, and STOP Statements
// SOUND Statement

// Joystick
// STICK Function
// STRIG Function and Statement
// STRIG ON, OFF, and STOP Statements

// COMMON Statement

// FILE / IO support
// UNLOCK Statement
// WRITE Statement
// WRITE # Statement
// CHDIR Statement
// BLOAD Statement
// BSAVE Statement
// CLOSE Statement
// COM Statements
// EOF Function
// ERDEV, ERDEV$ Functions
// ERR, ERL Functions
// FIELD Statement - Allocates space for variables in a random-access file buffer
// FILEATTR Function
// FILES Statement
// FREEFILE Function
// GET Statement──File I/O
// INP Function
// INPUT # Statement
// PRINT #, PRINT # USING Statements
// PUT Statement──File I/O
// LOF Function
// KILL Statement -- delete a file
// LINE INPUT # Statement
// LOC Function
// LPOS Function
// LPRINT, LPRINT USING Statements
// LSET Statement
// MKDIR Statement
// NAME Statement
// OPEN Statement
// OPEN COM Statement
// OUT Statement
// RESET Statement
// RMDIR Statement
// RSET Statement
// SEEK Function
// SEEK Statement
// WAIT Statement

// Direct Memory access
// DEF SEG Statement
// PEEK Function
// POKE Statement
// VARPTR, VARSEG Functions
// VARPTR$ Function

// web-unfriendly functions
// COMMAND$ Function -- Command-line access
// CHAIN Statement -- call other programs... maybe someday
// CLEAR Statement -- clear all vars and resize stack. It blows my mind that this is a thing.
// ENVIRON$ Function
// ENVIRON Statement
// IOCTL$ Function
// IOCTL Statement
// SHELL Statement
// LOCK...UNLOCK Statement
// PEN Function - lightpen!
// PEN ON, OFF, and STOP Statements
// SADD Function
// SETMEM Function
// SYSTEM Statement
