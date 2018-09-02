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

export class Location {
    constructor(public line: number, public position: number) { }
    toString() {
        return "" + (this.line + 1) + ":" + (this.position + 1);
    }
    copy(): Location {
        return new Location(this.line, this.position);
    }
}

export enum TokenType {
    kError,
    kIdent,
    kNumber,
    kNewline,
    kOp,
    kString,
    kComment,
    kEOF,
}

export class Token {
    public locus: Location;
    constructor(public id: TokenType, public text: string, public loc: Location) { }
    toString(): string {
        return "Token(" + this.text + ")";
    }
    isOp(text: string): boolean {
        return this.id === TokenType.kOp && this.text === text;
    }
    isSigil(): boolean {
        switch (this.text) {
            case "$": case "%": case "&": case "!": case "#":
                return true;
        }
        return false;
    }
    isIdent(text?: string): boolean {
        return this.id === TokenType.kIdent && (!text || this.text === text);
    }
    isNewline(): boolean {
        return this.id === TokenType.kNewline;
    }
    isNewlineOrColon(): boolean {
        return this.id === TokenType.kNewline || this.isOp(":");
    }
    isString(): boolean {
        return this.id === TokenType.kString;
    }
    isNumber(): boolean {
        return this.id === TokenType.kNumber;
    }
    stringVal(): string {
        return this.text.substr(1, this.text.length - 2);
    }
}

function eatSpace(s: LexState) {
    const m = /^\s+/.exec(s.text);
    if (m) { s.advance(m[0].length); }
}

class LexState {
    constructor(public text: string, public loc: Location) { }
    advance(len: number) {
        this.text = this.text.substr(len);
        this.loc.position += len;
    }
    advanceWithTok(tt: TokenType, len: number): Token {
        const t = new Token(tt, this.text.substr(0, len), this.loc.copy());
        this.advance(len);
        return t;
    }
}

class MatchResult {
    constructor(public tok: Token, public remainingText: string) { }
}

function matchToken(tt: TokenType, re: RegExp, s: LexState): Token | undefined {
    const m = re.exec(s.text);
    if (!m) { return undefined; }
    return s.advanceWithTok(tt, m[0].length);
}

export function lex(text: string): Token[] {
    const lines = text.split("\n");
    const tokens: Token[] = [];
    for (let i = 0; i < lines.length; i++) {
        const s = new LexState(lines[i], new Location(i, 0));
        while (s.text.length > 0) {
            eatSpace(s);
            if (s.text.length === 0) { break; }
            if (!matchToken(TokenType.kComment, /^'.*/, s) &&
                !matchToken(TokenType.kComment, /^(REM(\s|$)|').*/, s)) {
                const tok = matchToken(TokenType.kIdent, /^[a-zA-Z_][a-zA-Z0-9_]*/, s)
                    || matchToken(TokenType.kNumber,
                        /^(([0-9]+([.][0-9]*([ED][+-]?[0-9]+)?)?)|(\.[0-9]+([ED][+-]?[0-9]+)?))/, s)
                    || matchToken(TokenType.kNumber, /^&H[0-9A-F]+/, s)
                    || matchToken(TokenType.kOp, /^(\=?(\=?>=?)|(\=?<[>=]?)|[()[!\]:;&%$=,.#+*/\\?-])/, s)
                    || matchToken(TokenType.kString, /^"([^"\\]|\\.)*"/, s);
                if (tok) {
                    tokens.push(tok);
                } else {
                    tokens.push(s.advanceWithTok(TokenType.kError, 1));
                }
            }
        }
        tokens.push(s.advanceWithTok(TokenType.kNewline, 0));
        if (i === lines.length - 1) {
            tokens.push(s.advanceWithTok(TokenType.kEOF, 0));
        }
    }
    return tokens;
}
