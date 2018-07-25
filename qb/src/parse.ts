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

export function basicType(b: BaseType): Type {
    if (b === BaseType.kInt) return kIntType;
    if (b === BaseType.kString) return kStringType;
    if (b === BaseType.kLongInt) return kLongType;
    if (b === BaseType.kNone || b === BaseType.kSingle) return kSingleType;
    if (b === BaseType.kDouble) return kDoubleType;
    return null;
}

export enum ValKind {
    kNone,
    kLiteral,
    kVar,
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
    static newConst(name: string, ty: Type, val: number | string): Val {
        const v = new Val();
        v.type = ty;
        v.kind = ValKind.kConst;
        v.varName = name;
        if (v.type === kStringType) v.stringValue = val as string;
        else v.numberValue = val as number;
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
    public numberValue: number;
    public stringValue: string;
    public varName: string;
    // When true, this is a variable whos value is known.
    public stackOffset: number;
    public argIndex: number; // Non-null for variables which are arguments to subroutines.
    copy(): Val {
        const v = new Val();
        v.kind = this.kind;
        v.type = this.type;
        v.size = this.size;
        v.isArrayArg = this.isArrayArg;
        v.index = this.index;
        v.numberValue = this.numberValue;
        v.stringValue = this.stringValue;
        v.varName = this.varName;
        v.stackOffset = this.stackOffset;
        v.argIndex = this.argIndex;
        return v;
    }
    isCommaDelim(): boolean { return this.kind === ValKind.kCommaDelim; }
    isSemicolonDelim(): boolean { return this.kind === ValKind.kSemicolonDelim; }
    isVar(): boolean { return this.kind === ValKind.kVar; }
    isConst(): boolean { return this.kind === ValKind.kConst; }
    isLiteral(): boolean { return this.kind === ValKind.kLiteral; }
    isStackValue(): boolean { return this.kind === ValKind.kStackValue; }
    loc(): Location {
        return null; // TODO: might be useful to encode location into some values.
    }
}

export const kNullVal = new Val();
// A QB graphics coordinate.
export class Coord {
    constructor(public step: boolean, public x: Val, public y: Val) { }
}

// The parser is fairly dumb, and just relays information to a context. The primary purpose of the context is to
// generate code, but there are other activities you might perform, like syntax highlighting or autocompletion.
export interface ICtx {
    // Called after parsing the entire program.
    finalize();
    error(message: string, loc: Location);
    defineType(id: Token, t: Type);
    typename(tok: Token): Type;
    label(tok: Token);
    lineNumber(num: number, tok: Token);
    newline(lineNumber: number);
    data(dataArray: Val[]);
    variable(varName: Token, baseType?: BaseType): Val;
    declConst(id: Token, ty: BaseType, value: Val);
    index(v: Val, idx: Val[]): Val;
    dim(name: Token, size: number[], ty?: Type);
    op(name: string, operands: Val[]): Val;
    sub(id: Token, args: Val[]): ICtx;
    declArg(id: Token, isArray: boolean, ty: Type | null): Val;
    endsub();
    declSub(id: Token, args: Val[]);
    isSub(id: string): boolean;
    lookupFunction(id: string): FunctionType;
    callSub(id: Token, args: Val[]);
    callFunction(id: string, args: Val[]): Val;
    input(keepCursor: boolean, prompt: string, args: Val[]);
    ifBegin(cond: Val);
    elseBegin(cond?: Val);
    ifEnd();
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
    color(fore: Val, back: Val);
    line(a: Coord, b: Coord, color: Val, option: string, style?: Val);
    pset(a: Coord, color: Val);
    locate(x: Val, y: Val); // TODO: more parameters
    screen(id: Val);
    palette(attr?: Val, col?: Val);
    sleep(delay?: Val);
    endStmt();
}

// A minimal implementation of ICtx that can parse code.
export class NullCtx implements ICtx {
    private types: Map<string, Type>;
    private dimVars: Map<string, Val>;
    private autoVars: Map<string, Val>;
    private subs: Map<string, Val>;

    private currentSubDecl: string;
    finalize() { }
    error(message: string, loc: Location) {
        console.log(message + " at " + loc.toString());
    }
    defineType(id: Token, t: Type) {
        if (this.types.has(id.text)) {
            this.error("duplicate definition", id.loc);
            return;
        }
        if (!t) return;
        this.types.set(id.text, t);
    }
    typename(tok: Token): Type {
        if (tok.text === "INTEGER") { return kIntType; }
        if (tok.text === "STRING") { return kStringType; }
        if (tok.text === "DOUBLE") { return kDoubleType; }
        if (tok.text === "SINGLE") { return kSingleType; }
        if (tok.text === "LONG") { return kLongType; }
        return this.types.get(tok.text);
    }
    label(tok: Token) { }
    lineNumber(num: number, tok: Token) { }
    newline(num: number) { }
    data(dataArray: Val[]) {

    }
    variable(varName: Token, baseType?: BaseType): Val {
        const dimVar = this.dimVars.get(varName.text);
        if (dimVar) {
            if (baseType === BaseType.kNone || dimVar.type.type === baseType) {
                return dimVar;
            } else {
                this.error("duplicate definition", varName.loc);
                return null;
            }
        }
        const key = varName.text + baseTypeToSigil(baseType);
        const autoVar = this.autoVars.get(key);
        if (autoVar) return autoVar;
        const v = Val.newVar(varName.text, basicType(baseType));
        this.autoVars.set(key, v);
        return v;
    }
    declConst(id: Token, ty: BaseType, value: Val) { }
    index(v: Val, idx: Val[]): Val {
        return v;
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
    }

    op(name: string, operands: Val[]): Val {
        console.log("OP " + name + operands);
        return kNullVal;
    }
    sub(id: Token): ICtx {
        return this;
    }
    declArg(id: Token, isArray: boolean, ty: Type | null): Val {
        return kNullVal;
    }
    endsub() {

    }
    declSub(id: Token, args: Val[]) {
        this.currentSubDecl = id.text;
    }
    isSub(id: string): boolean {
        return this.subs.has(id);
    }
    callSub(id: Token, args: Val[]) { }
    callFunction(id: string, args: Val[]): Val { return kNullVal; }
    lookupFunction(id: string): FunctionType {
        return null;
    }
    input(keepCursor: boolean, prompt: string, args: Val[]) { }
    ifBegin(cond: Val) { }
    elseBegin(cond?: Val) { }
    ifEnd() { }
    forBegin(idx: Val, f: Val, t: Val, st: Val) { }
    forExit() { }
    forEnd() { }
    doBegin(whileCond: Val) { }
    doExit() { }
    doEnd(untilCond: Val) { }
    whileBegin(whileCond: Val) { }
    wend() { }
    gotoLine(no: number, tok: Token) { }
    gotoLabel(lbl: Token) { }
    color(fore: Val, back: Val) { }
    line(a: Coord, b: Coord, color: Val, option: string, style?: Val) { }
    pset(a: Coord, color: Val) { }
    locate(x: Val, y: Val) { }
    screen(id: Val) { }
    palette(attr: Val, col: Val) { }
    sleep(delay?: Val) { }
    endStmt() { }
}

export function parse(ctx: ICtx, tokens: Token[]) {
    const parser = new Parser(ctx, tokens);
    parser.program();
}

// An active block (IF, FOR, WHILE, ...).
class Block {
    public forLabel: string;
    constructor(public beginToken: Token, public kind: string) { }
}

// Parses QBasic code, relays information to ctx.
class Parser {
    private tokenIndex = 0;
    private controlNesting = 0;
    private isEnd = false;
    private openBlocks: Block[] = [];
    constructor(private ctx: ICtx, private tokens: Token[]) {
    }
    currentBlock(): Block | null {
        return this.openBlocks.length ? this.openBlocks[this.openBlocks.length - 1] : null;
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
    nextIf(val: string): Token {
        const t = this.tok();
        if (t.text === val) {
            this.next();
            return t;
        }
        return null;
    }

    expectNewline(allowHardNewline: boolean = true): boolean {
        const t = this.tok();
        if (t.isOp(":") || t.id === TokenType.kNewline) {
            if (t.id === TokenType.kNewline) {
                if (!allowHardNewline) {
                    this.error("newline before END...");
                }
                this.ctx.newline(this.tok().loc.line + 1);
            }
            this.next();
            return true;
        }
        if (this.isEof()) return true;
        this.error("expected newline");
        return false;
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

    expectIdent(val?: string): Token {
        const t = this.tok();
        if (t.id === TokenType.kIdent) {
            if (!val || t.text === val) {
                this.next();
                return t;
            }
        }
        this.error("expected " + (val ? val : "ident"));
        return null;
    }
    nextIdent(): Token {
        const t = this.tok();
        if (t.id === TokenType.kIdent) {
            this.next();
            return t;
        }
        return null;
    }
    expectOp(text: string): Token {
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

    typename(): Type {
        const id = this.expectIdent();
        if (!id) return null;
        return this.ctx.typename(id);
    }

    type(): boolean { // TYPE ... END TYPE
        if (!this.nextIf("TYPE")) return false;
        const r = new Val();
        const typeId = this.expectIdent();
        const userType = new Type();
        userType.type = BaseType.kUserType;
        while (!this.isEof()) {
            this.eatNewlines();
            if (this.nextIf("END")) {
                if (this.expectIdent("TYPE")) {
                    this.ctx.defineType(typeId, userType);
                }
                return true;
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
        return true;
    }

    label(): boolean { // LabelName:
        if (!this.tok(1).isOp(":")) return false;
        if (this.tok(0).id !== TokenType.kIdent) return false;
        this.ctx.label(this.expectIdent());
        this.next();
        return true;
    }

    stringLiteral(): Val {
        const tok = this.tok();
        if (tok.id === TokenType.kString) {
            this.next();
            return Val.newStringLiteral(tok.text.substr(1, tok.text.length - 2));
        }
        return null;
    }

    abs(): Val {
        this.expectIdent("ABS");
        const args = this.callArgsWithTypes([kDoubleType]);
        if (!args) return kNullVal;
        return this.ctx.op("ABS", args);
    }
    maybeFunctionCall(): Val {
        let id: string;
        let tokenCount: number;
        if (this.tok(0).isIdent() && this.tok(1).isSigil()) {
            id = this.tok(0).text + this.tok(1).text;
            tokenCount = 2;
        } else if (this.tok(0).isIdent()) {
            id = this.tok(0).text;
            tokenCount = 1;
        }
        if (!id) return null;
        const func = this.ctx.lookupFunction(id);
        if (!func) return null;
        this.next(tokenCount);
        const args = this.callArgsWithTypes(func.argTypes, func.argTypes.length - func.optionalParameters);
        if (!args) {
            return kNullVal;
        }
        return this.ctx.callFunction(id, args);
    }

    numberLiteral(): Val {
        let idx = 0;
        if (this.tok().isOp("-")) {
            idx = 1;
        }
        const numTok = this.tok(idx);
        if (numTok.id !== TokenType.kNumber) return null;
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

    data(): boolean { // DATA [value, ...]
        if (!this.tok().isIdent("DATA")) return;
        this.next();
        const datas = [];
        while (this.tok().id !== TokenType.kNewline) {
            let v = this.stringLiteral() || this.numberLiteral();
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
            this.expectOp(",");
            datas.push(v);
        }
        this.ctx.data(datas);
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

    varname(allowIndex?: boolean): Val { // <ident>[type-sigil]
        if (this.tok().id !== TokenType.kIdent) return null;
        const id = this.expectIdent();
        let v = this.ctx.variable(id, this.maybeSigil());
        if (v && allowIndex && this.tok().isOp("(")) {
            v = this.ctx.index(v, this.arrayIndex());
        }
        return v;
    }

    arrayIndex(): Val[] {
        if (!this.expectOp("(")) return null;
        const idx: Val[] = [];
        while (!this.isEol()) {
            if (this.nextIf(")")) {
                return idx;
            }
            const v = this.numericExpr();
            if (!v) break;
            idx.push(v);
        }
        this.expectOp(")");
    }

    arraySize(): number[] {
        if (!this.nextIf("(")) return null;
        const i = this.numberLiteral();
        if (!i) { // TODO: CONST
            this.error("expected number");
            return null;
        }
        if (this.nextIf("TO")) {
            const to = this.numberLiteral();
            if (!to) {
                this.error("expected number");
                return null;
            }
            this.expectOp(")");
            return [i.numberValue, to.numberValue];
        }
        this.expectOp(")");
        return [i.numberValue];
    }

    dim() { // DIM <ident> [AS <type>]
        this.expectIdent("DIM");
        let id = this.expectIdent();
        let size = this.arraySize();
        while (true) {
            if (this.nextIf("AS")) {
                this.ctx.dim(id, size, this.typename());
            } else {
                this.ctx.dim(id, size);
            }
            if (this.tok().isOp(",")) {
                ++this.tokenIndex;
                id = this.expectIdent();
                size = this.arraySize();
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
    expr6(): Val {
        if (this.nextIf("(")) {
            const expr = this.expr();
            if (this.expectOp(")")) return expr;
            return null;
        }
        if (this.tok().isIdent("ABS")) return this.abs();
        const unaryNeg = this.nextIf("-");
        const r = this.maybeFunctionCall() || this.varname(true) || this.numberLiteral() || this.stringLiteral();
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
        return kNullVal;
    }
    // There are many layers to QBasic's operator precedence, which implies many functions for a recursive descent
    // parser. This template is used to create methods for most operators.
    binaryExprTemplate(ops: string[], nextFunc: () => Val): Val {
        let lhs = nextFunc();
        while (lhs) {
            const op = this.tok();
            let matches = false;
            for (const o of ops) {
                if (op.text === o) {
                    this.next();
                    lhs = this.ctx.op(op.text, [lhs, nextFunc()]);
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
    exprL6(): Val {
        while (!this.isEol()) {
            if (this.nextIf("NOT")) {
                return this.ctx.op("NOT", [this.exprL6()]);
            }
            return this.expr1();
        }
    }
    exprL5 = () => this.binaryExprTemplate(["AND"], this.exprL6.bind(this));
    exprL4 = () => this.binaryExprTemplate(["OR"], this.exprL5.bind(this));
    exprL3 = () => this.binaryExprTemplate(["XOR"], this.exprL4.bind(this));
    exprL2 = () => this.binaryExprTemplate(["EQV"], this.exprL3.bind(this));
    exprL1 = () => this.binaryExprTemplate(["IMP"], this.exprL2.bind(this));

    expr(): Val {
        return this.exprL1();
    }
    numericExpr(): Val {
        const v = this.expr();
        if (v && v.type && !v.type.isNumeric()) {
            this.error("expected numeric");
            return kNullVal;
        }
        return v;
    }
    print() {
        if (this.nextIf("PRINT")) { } else this.expectOp("?");
        const vals = [];
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

    locate() {
        this.expectIdent("LOCATE");
        let x: Val;
        let y: Val;
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

    let(): boolean {
        this.nextIf("LET");
        const v = this.varname(true);
        if (!v) return false;
        if (this.expectOp("=")) {
            this.ctx.op("assign", [v, this.expr()]);
        }
        return true;
    }

    cls() {
        this.expectIdent("CLS");
        this.ctx.op("CLS", []);
    }

    declArgs(): Val[] {
        if (!this.tok().isOp("(")) { return []; }
        this.next();
        const args = [];
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
                ty = this.typename();
                if (sig !== BaseType.kNone && ty.type !== sig) {
                    this.error("mismatched type");
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

    ifstmt(moduleLevel: boolean, allowHardNewline: boolean) {
        // TODO: IF <numeric-expr> GOTO line
        this.expectIdent("IF");
        const nesting = ++this.controlNesting; // TODO: probably not necessary
        const cond = this.expr();
        let hitElse = false;
        let singleLine = false;
        if (this.nextIf("THEN")) {
            if (this.tok().isNewline()) {
                if (!allowHardNewline) {
                    this.error("newline before END...");
                    --this.controlNesting;
                    return true;
                }
            }
            singleLine = !allowHardNewline || !this.tok().isNewlineOrColon();
            if (!singleLine) {
                this.expectNewline(); // TODO: handle single-line statements
            }

            this.ctx.ifBegin(cond);
            // TODO: Probably want to remove statement parsing from this function.
            let stmtCount = 0;
            while (true) {
                if (nesting === this.controlNesting) {
                    if (!singleLine && this.tok().isIdent("END") && this.tok(1).isIdent("IF")) {
                        this.next(2);
                        this.ctx.ifEnd();
                        break;
                    }
                    if (singleLine && this.tok().isNewline()) {
                        this.ctx.ifEnd();
                        break;
                    }
                    if (!hitElse && this.nextIf("ELSEIF")) {
                        stmtCount = 0;
                        this.ctx.elseBegin(this.expr());
                        this.expectIdent("THEN");
                        if (!singleLine) {
                            if (!this.tok().isNewlineOrColon()) {
                                singleLine = true;
                            } else {
                                this.expectNewline();
                            }
                        }
                        continue;
                    }
                    if (!hitElse && this.nextIf("ELSE")) {
                        stmtCount = 0;
                        if (!singleLine) {
                            if (!this.tok().isNewlineOrColon()) {
                                singleLine = true;
                            } else {
                                this.expectNewline();
                            }
                        }
                        hitElse = true;
                        this.ctx.elseBegin();
                        continue;
                    }
                }
                if (this.isEof()) {
                    this.ctx.ifEnd();
                    break;
                }

                if (singleLine) {
                    if (stmtCount > 0) {
                        this.expectOp(":");
                    }
                    if (!this.statement(moduleLevel, singleLine)) {
                        this.error("expected statement");
                        break;
                    }
                    stmtCount++;
                } else {
                    this.eatNewlines();
                    this.statementAndNewline(moduleLevel);
                }
            }
        }
        --this.controlNesting;
    }
    screenstmt() {
        this.expectIdent("SCREEN");
        const id = this.numericExpr();
        this.ctx.screen(id);
    }
    color() { // COLOR [<fore>][, <back>]
        this.expectIdent("COLOR");
        let fore: Val;
        let back: Val;
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
    palette() { // PALETTE [attr, color]
        this.expectIdent("PALETTE");
        if (this.tok().isNewlineOrColon()) {
            this.ctx.palette();
            return;
        }
        const attr = this.numericExpr();
        this.expectOp(",");
        this.ctx.palette(attr, this.numericExpr());
    }
    sub(): boolean { // SUB <name> [(<args>)] ... END SUB
        const begin = this.nextIf("SUB");
        if (!begin) { return false; }
        this.isEnd = true;
        const id = this.expectIdent();
        if (!id) { return true; }
        const moduleCtx = this.ctx;
        const subCtx = this.ctx.sub(id, this.declArgs());
        this.ctx = subCtx;
        this.nextIf("STATIC"); // TODO: Ignore for now
        this.expectNewline();
        while (!this.isEof()) {
            this.eatNewlines();
            if (this.tok().isIdent("END") && this.tok(1).isIdent("SUB")) {
                this.next(2);
                break;
            }
            this.statementAndNewline(false);
        }
        this.ctx.endsub();
        this.ctx = moduleCtx;
        return true;
    }

    declare(): boolean { // DECLARE SUB <name> (<args>)
        if (!this.nextIf("DECLARE")) { return false; }
        if (!this.expectIdent("SUB")) { this.eatUntilNewline(); return true; }
        const id = this.expectIdent();
        if (!id) { this.eatUntilNewline(); return true; }
        this.ctx.declSub(id, this.declArgs());
        return true;
    }
    callArgsWithTypes(types: Type[], requiredArgsCount: number = -1): Val[] {
        if (requiredArgsCount === -1) { requiredArgsCount = types.length; }
        const args = this.callArgs(true, requiredArgsCount);
        if (!args || args.length > types.length) { return null; }
        if (args.length < requiredArgsCount) {
            this.error(`expected ${requiredArgsCount} arguments`);
            return null;
        }
        for (let i = 0; i < args.length; i++) {
            if (types[i].isNumeric()) {
                if (!args[i].type || !args[i].type.isNumeric()) {
                    this.error(`expected numeric for argument ${i + 1}`);
                    return null;
                }
            }
            if (types[i].isString()) {
                if (!args[i].type || !args[i].type.isString()) {
                    this.error(`expected string for argument ${i + 1}`);
                    return null;
                }
            }
        }
        return args;
    }
    callArgs(wantParen: boolean, expectedCount = -1): Val[] {
        if (wantParen && !this.tok().isOp("(")) {
            if (expectedCount >= 1) {
                this.error(`expected ${expectedCount} arguments`);
            }
            return [];
        }
        if (wantParen) { this.expectOp("("); }
        const args = [];
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
            args.push(this.expr());
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

    argsUntilNewline(): Val[] {
        const args = [];
        while (!this.isEol()) {
            args.push(this.expr());
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

    varRefsUntilNewline(): Val[] {
        const args = [];
        while (!this.isEol()) {
            // TODO: This is pretty ugly. Single-line IF statements force checking additional terminals...
            if (this.tok().text === "END" || this.tok().text === "ELSE" || this.tok().text === "ELSEIF") {
                break;
            }
            args.push(this.varname(true));
            if (this.isEol()) {
                return args;
            }
            if (!this.tok().isOp(",")) {
                this.error("expected ',' or newline");
                return args;
            }
        }
        return args;
    }

    callsub(): boolean { // <name> [(<args>)]
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
        if (!this.ctx.isSub(subName)) { return; }
        this.next();
        this.ctx.callSub(subNameTok, this.callArgs(!!call));
        return true;
    }

    input(): boolean { // INPUT [;] [<prompt> :|,] <variable, list>
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
        this.ctx.input(keepCursor, prompt, args);
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

    goto() {
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
    nextStmt() {
        this.expectIdent("NEXT");
        if (!this.currentBlock() || this.currentBlock().kind !== "FOR") {
            this.error("next without for");
            return;
        }
        const forLabel = this.currentBlock().forLabel;
        if (this.tok().isNewlineOrColon()) {
            this.ctx.forEnd();
            this.openBlocks.pop();
            return;
        }
        const nextVar = this.varname();
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
        const idx = this.varname();
        this.expectOp("=");
        const f = this.numericExpr();
        this.expectIdent("TO");
        const t = this.numericExpr();
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
    doloop() {
        const doTok = this.expectIdent("DO");
        let whileCond: Val;
        if (this.nextIf("UNTIL")) {
            const until = this.expr();
            whileCond = this.ctx.op("LNOT", [until]);
        } else if (this.nextIf("WHILE")) {
            whileCond = this.expr();
        }
        this.openBlocks.push(new Block(doTok, "DO"));
        this.ctx.doBegin(whileCond);
    }
    loop() {
        this.expectIdent("LOOP");
        if (this.currentBlock().kind !== "DO") {
            this.error("LOOP without DO");
            return;
        }
        this.openBlocks.pop();
        let untilCond: Val;
        if (this.nextIf("UNTIL")) {
            untilCond = this.expr();

        } else if (this.nextIf("WHILE")) {
            untilCond = this.ctx.op("LNOT", [this.expr()]);
        }
        this.ctx.doEnd(untilCond);
    }
    whileStmt() {
        const whileTok = this.expectIdent("WHILE");
        this.openBlocks.push(new Block(whileTok, "WHILE"));
        this.ctx.whileBegin(this.expr());
    }
    wendStmt() {
        this.expectIdent("WEND");
        if (!this.currentBlock() || this.currentBlock().kind !== "WHILE") {
            this.error("WEND without WHILE");
            return;
        }
        this.ctx.wend();
        this.openBlocks.pop();
    }
    exit() {
        this.expectIdent("EXIT");
        if (!this.currentBlock()) {
            this.error("EXIT without FOR, DO, or SUB");
            return;
        }
        switch (this.currentBlock().kind) {
            case "FOR": this.expectIdent("FOR"); this.ctx.forExit(); break;
            case "DO": this.expectIdent("DO"); this.ctx.doExit(); break;
            default:
                this.error("expected FOR, DO, or SUB");
                break;
        }
    }
    coord(): Coord {
        let step = false;
        if (this.nextIf("STEP")) {
            step = true;
        }
        if (!this.tok().isOp("(")) {
            if (step) {
                this.error("expected (coordinate)");
            }
            return null;
        }
        this.next();
        const x = this.numericExpr();
        this.expectOp(",");
        const y = this.numericExpr();
        this.expectOp(")");
        return new Coord(step, x, y);
    }
    pset() {
        this.expectIdent("PSET");
        const a = this.coord();
        let color: Val | null;
        if (this.tok().isOp(",")) {
            this.next();
            if (!this.tok().isOp(",")) {
                color = this.numericExpr();
            }
        }
        this.ctx.pset(a, color);
    }
    line() {
        this.expectIdent("LINE");
        const a = this.coord();
        this.expectOp("-");
        const b = this.coord();
        let color: Val;
        let option = "";
        let style: Val = null;
        if (this.tok().isOp(",")) {
            this.next();
            if (!this.tok().isOp(",")) {
                color = this.numericExpr();
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
                }
            }
        }
        this.ctx.line(a, b, color, option, style);
    }
    circle() {
        this.expectIdent("CIRCLE"); // TODO
        this.eatUntilNewline();
    }
    paint() {
        this.expectIdent("PAINT"); // TODO
        this.eatUntilNewline();
    }
    sleep() {
        this.expectIdent("SLEEP");
        if (!this.isEol()) {
            this.ctx.sleep(this.numericExpr());
        } else {
            this.ctx.sleep(null);
        }
    }
    constStmt() {
        this.expectIdent("CONST");
        do {
            const id = this.expectIdent();
            const sig = this.maybeSigil();
            this.expectOp("=");
            this.ctx.declConst(id, sig, this.expr());
        } while (this.nextIf(","));
    }
    statement(moduleLevel: boolean, allowHardNewline: boolean = true): boolean {
        if (this.isEof()) { return false; }
        const hasLabels = this.maybeLabels();
        while (1) {
            if (moduleLevel && this.declare()) { break; }
            if (moduleLevel && this.sub()) { break; }
            if (this.isEnd && moduleLevel) {
                this.error("expected SUB or EOF");
                return false;
            }
            const handled = ((): boolean => {
                switch (this.tok().text) {
                    case "IF": this.ifstmt(moduleLevel, allowHardNewline); break;
                    case "SCREEN": this.screenstmt(); break;
                    case "FOR": this.forStmt(); break;
                    case "NEXT": this.nextStmt(); break;
                    case "EXIT": this.exit(); break;
                    case "COLOR": this.color(); break;
                    case "PRINT": case "?": this.print(); break;
                    case "LINE": this.line(); break;
                    case "GOTO": this.goto(); break;
                    case "LOCATE": this.locate(); break;
                    case "PALETTE": this.palette(); break;
                    case "SLEEP": this.sleep(); break;
                    case "DIM": this.dim(); break;
                    case "INPUT": this.input(); break;
                    case "CLS": this.cls(); break;
                    case "CIRCLE": this.circle(); break;
                    case "PAINT": this.paint(); break;
                    case "PSET": this.pset(); break;
                    case "DO": this.doloop(); break;
                    case "LOOP": this.loop(); break;
                    case "WHILE": this.whileStmt(); break;
                    case "WEND": this.wendStmt(); break;
                    case "CONST": this.constStmt(); break;
                    default: return false;
                }
                return true;
            })();
            if (handled) { break; }
            if (this.callsub()) { break; }
            if (this.let()) { break; }
            // Should only have empty statement when labels are used (since newlines are eaten).
            if (hasLabels) { break; }
            this.error("expected statement");
            return false;
        }
        this.ctx.endStmt();
        return true;
    }
    statementAndNewline(moduleLevel: boolean, allowHardNewline: boolean = true) {
        if (!this.statement(moduleLevel, allowHardNewline)) {
            this.eatUntilNewline();
            this.next();
            return;
        }
        this.expectNewline(allowHardNewline);
    }
    program() {
        while (!this.isEof()) {
            this.eatNewlines();
            this.statementAndNewline(true);
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
// DATA Statement
// DECLARE FUNCTION
// DEF FN Statement
// DEFtype Statements - Set the default data type for variables, DEF FN functions, and FUNCTION procedures
// DIM SHARED
// END -- end program?
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
