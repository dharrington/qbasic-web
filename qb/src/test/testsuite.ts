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
import * as codegen from "../codegen";
import { lex } from "../lex";
import { parse } from "../parse";
import * as types from "../types";
import * as vm from "../vm";
import { DebugPC } from "./debugpc";

import { AssertionError } from "assert";
import * as fs from "fs";
import * as path from "path";

let passCount = 0;
let failCount = 0;
class Expectation {
    public output?: string;
    public exception?: string;
    public compileErrorLines: number[] = [];
    public psets: Array<{ x, y, color }> = [];
    public graphics: string[];
    constructor() { }
}
function scanREMs(programText: string, command: string): string[] {
    const all: string[] = [];
    const re = new RegExp(`REM ${command} (.*)`, "g");
    while (1) {
        const m = re.exec(programText);
        if (!m) break;
        all.push(m[1].trim());
    }
    return all;
}
function testProgram(programPath: string) {
    console.log(programPath);
    const buf = fs.readFileSync(programPath);
    const fileText = buf.toString();
    const pc = new DebugPC();
    const exp = new Expectation();
    {
        const ex = scanREMs(fileText, "exception");
        if (ex.length === 1) {
            exp.exception = ex[0];
        }
    }
    exp.graphics = scanREMs(fileText, "graphics");
    pc.inputResult = scanREMs(fileText, "input");
    const fileLines = fileText.split("\n");
    for (let i = 0; i < fileLines.length; i++) {
        if (/'COMPILE_ERROR/.test(fileLines[i])) {
            exp.compileErrorLines.push(i);
        }
    }

    const parts = fileText.split("\nREM output\n");
    let programText = fileText;
    if (parts.length === 2) {
        programText = parts[0];
        exp.output = parts[1];
    }
    runSuccess(programText, exp, pc);
}
function testCases(caseDir = process.argv[2]) {
    for (const f of fs.readdirSync(caseDir)) {
        const fPath = path.join(caseDir, f);
        const stat = fs.statSync(fPath);
        if (stat.isDirectory()) {
            testCases(fPath);
        } else if (path.extname(fPath) === ".bas") {
            testProgram(fPath);
        }
    }
}
function visualizeWhitespace(output: string): string {
    return output.replace(/ /g, String.fromCharCode(183));
}
function addLineNumbersToSource(source: string): string {
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; ++i) {
        lines[i] = (i + 1).toString() + "\t" + lines[i];
    }
    return lines.join("\n");
}
function runSuccess(program: string, exp: Expectation, pc = new DebugPC()) {
    const stepQuota = 10000;

    const tokens = lex(program);
    const ctx = new codegen.CodegenCtx();
    parse(ctx, tokens);
    ctx.program().source = program;
    const codeText = ctx.program().toString();
    const exe = new vm.Execution(ctx.program(), pc);
    if (ctx.errors().length > 0) {
        let errorsOK = false;
        if (exp.compileErrorLines) {
            const wantLines = new Set(exp.compileErrorLines);
            const foundLines = new Set();
            for (const e of ctx.errorLocations()) {
                foundLines.add(e.line);
            }
            errorsOK = true;
            for (const want of wantLines) {
                if (!foundLines.has(want)) {
                    console.log(`Wanted compile error at line ${want}, but none was found`);
                    errorsOK = false;
                }
            }
            for (const found of foundLines) {
                if (!wantLines.has(found)) {
                    console.log(`Found compile error at line ${found}`);
                    errorsOK = false;
                }
            }
        }
        if (!errorsOK) {
            console.log(`Compile errors in program:\n${addLineNumbersToSource(program)}\n----\n`);
            for (const e of ctx.errors()) {
                console.log(`  ${e}`);
            }
            failCount++;
        }
        return;
    }
    exe.run(stepQuota);
    pc.textOutput = pc.textOutput.trimRight();
    let failed = false;
    if (exp.exception !== undefined) {
        if (exe.exception !== exp.exception) {
            console.log(`Program should have had exception: ${exp.exception}, but exception was '${exe.exception}'`);
            failed = true;
        }
    } else {
        if (exe.exception) {
            console.log(`Program had exception: ${exe.exception} on line ${exe.currentLine()}`);
            failed = true;
        }
    }
    if (!failed && !exe.exception && !exe.done) {
        console.log(`Program not complete, is there an infinite loop?`);
        failed = true;
    } else if (exp.output !== undefined && exp.output.trimRight() !== pc.textOutput) {
        console.log(`Program complete with incorrect output`);
        failed = true;
    }
    if (!failed && exp.graphics.length) {
        const got = pc.graphicCalls.join("\n");
        const want = exp.graphics.join("\n");
        if (got !== want) {
            console.log(`graphics output not correct:\n--- got ---\n${got}\n--- want ---\n${want}\n`);
        }
    }
    if (!failed) {
        passCount++;
        return;
    }
    failCount++;
    console.log(`Output for program:
${addLineNumbersToSource(program)}
-------------------------------------------------------------------------------
Got:
-------------------------------------------------------------------------------
${visualizeWhitespace(pc.textOutput)}
-------------------------------------------------------------------------------
`);
    if (exp.output !== undefined) {
        console.log(`Want:
-------------------------------------------------------------------------------
${visualizeWhitespace(exp.output.trimRight())}
-------------------------------------------------------------------------------
`);
    }

    console.log(`Debug dump:
${exe.debugDump()}`);
    passCount++;
}

testCases();

if (failCount > 0) {
    console.log(`--FAIL-- ${failCount} tests fail, ${passCount} tests pass`);
} else {
    console.log(`--PASS-- All ${passCount} tests pass`);
}
