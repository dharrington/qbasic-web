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
import { DebugPC } from "../debugpc";
import { lex } from "../lex";
import { parse } from "../parse";
import * as types from "../types";
import * as vm from "../vm";

import * as fs from "fs";
import * as path from "path";

let passCount = 0;
let failCount = 0;
function testProgram(programPath: string) {
    console.log(programPath);
    const buf = fs.readFileSync(programPath);
    const fileText = buf.toString();
    const parts = fileText.split("\nREM output\n");
    let programText = fileText;
    let desiredOutput: string | undefined;
    if (parts.length === 2) {
        [programText, desiredOutput] = parts;
    }
    if (desiredOutput !== undefined) {
        runSuccess(programText, desiredOutput);
    } else {
        compileSuccess(programText);
    }
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
function runSuccess(program: string, expectOutput: string) {
    const stepQuota = 1000;

    expectOutput = expectOutput.trimRight();
    const tokens = lex(program);
    const ctx = new codegen.CodegenCtx();
    parse(ctx, tokens);
    const pc = new DebugPC();
    const exe = new vm.Execution(ctx.program(), pc);
    if (ctx.errors().length > 0) {
        console.log(`Compile errors in program:\n${program}\n----\n`);
        for (const e of ctx.errors()) {
            console.log(`  ${e}`);
        }
        failCount++;
        return;
    }
    exe.run(stepQuota);
    pc.textOutput = pc.textOutput.trimRight();
    let failed = false;
    if (!exe.done) {
        console.log(`Program not complete, is there an infinite loop?`);
        failed = true;
    }
    if (!failed && expectOutput !== pc.textOutput) {
        console.log(`Program complete with incorrect output`);
        failed = true;
    }
    if (!failed) {
        passCount++;
        return;
    }
    failCount++;
    console.log(`Output for program:
${program}
-------------------------------------------------------------------------------
Got:
-------------------------------------------------------------------------------
${visualizeWhitespace(pc.textOutput)}
-------------------------------------------------------------------------------
Want:
-------------------------------------------------------------------------------
${visualizeWhitespace(expectOutput)}
-------------------------------------------------------------------------------
Program code:
${ctx.program().toString()}`);
    passCount++;
}

function compileSuccess(program: string) {
    const tokens = lex(program);
    const ctx = new codegen.CodegenCtx();
    parse(ctx, tokens);
    const pc = new DebugPC();
    if (ctx.errors.length > 0) {
        console.log(`Compile errors in program:\n${program}\n----\n`);
        for (const e of ctx.errors()) {
            console.log(`  ${e}`);
        }
        failCount++;
        return;
    }
}

testCases();

if (failCount > 0) {
    console.log(`--FAIL-- ${failCount} tests fail, ${passCount} tests pass`);
} else {
    console.log(`--PASS-- All ${passCount} tests pass`);
}
