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
import * as vm from "../vm";
import { DebugPC } from "./debugpc";

import * as fs from "fs";
import * as path from "path";
import * as BlinkDiff from "../../node_modules/blink-diff/index";

let passCount = 0;
let failCount = 0;
class Expectation {
    public output?: string;
    public exception?: string;
    public compileErrorLines: number[] = [];
    public psets: Array<{ x, y, color }> = [];
    public graphics: string[];
    public compareScreenshotTo = "";
    public screenshotDiffThreshold: number;
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

function firstMismatchedLine(got: string, want: string): number | undefined {
    const gotLines = got.split('\n');
    const wantLines = want.split('\n');
    for (let i = 0; i < wantLines.length; i++) {
        if (gotLines.length <= i) return i;
        if (wantLines[i].trim() === gotLines[i].trim()) continue;
        return i + 1;
    }
    return undefined;
}

async function testProgram(programPath: string) {
    console.log(programPath);
    const buf = fs.readFileSync(programPath);
    const fileText = buf.toString();
    const pc = new DebugPC();
    pc.init();
    const exp = new Expectation();
    {
        const ex = scanREMs(fileText, "exception");
        if (ex.length === 1) {
            exp.exception = ex[0];
        }
    }
    exp.graphics = scanREMs(fileText, "graphics");
    for (const inputLine of scanREMs(fileText, "input")) {
        pc.debugInput.addLine(inputLine);
    }
    const compareScreenshot = scanREMs(fileText, "compare_screenshot");
    if (compareScreenshot.length) {
        exp.screenshotDiffThreshold = parseFloat(compareScreenshot[0]);
        if (exp.screenshotDiffThreshold > .5 || exp.screenshotDiffThreshold < 0) {
            console.log(`compare_screenshot invalid threshold: ${compareScreenshot[0]}`);
            failCount++;
        }
        exp.compareScreenshotTo = path.join(path.dirname(programPath), path.basename(programPath, ".bas") + ".png");
    }
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
    await runSuccess(programText, exp, pc);
}

async function testCases(caseDir = process.argv[2]) {
    for (const f of fs.readdirSync(caseDir)) {
        const fPath = path.join(caseDir, f);
        const stat = fs.statSync(fPath);
        if (stat.isDirectory()) {
            await testCases(fPath);
        } else if (path.extname(fPath) === ".bas") {
            await testProgram(fPath);
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


function diffScreenshot(diffThreshold, got, want, diff) {
    var diff = new BlinkDiff({
        imageAPath: got,
        imageBPath: want,

        thresholdType: BlinkDiff.THRESHOLD_PERCENT,
        threshold: diffThreshold, // 1% threshold

        imageOutputPath: diff,
    });

    const result = diff.runSync();
    return diff.hasPassed(result.code);
}

async function runSuccess(program: string, exp: Expectation, pc = new DebugPC()) {
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
    } else if (exp.output !== undefined) {
        const mismatch = firstMismatchedLine(pc.textOutput, exp.output.trimRight());
        if (mismatch !== undefined) {
            console.log(`Program complete with incorrect output at line ${mismatch}`);
            failed = true;
        }
    }
    if (!failed && exp.graphics.length) {
        const got = pc.graphicCalls.join("\n");
        const want = exp.graphics.join("\n");
        if (got !== want) {
            console.log(`graphics output not correct:\n--- got ---\n${got}\n--- want ---\n${want}\n`);
        }
    }
    if (!failed && exp.compareScreenshotTo) {
        const base = path.join(path.dirname(exp.compareScreenshotTo), path.basename(exp.compareScreenshotTo, ".png"));
        const got = path.join(base + ".got.png");
        const diff = path.join(base + ".diff.png");
        await pc.saveScreenshot(got);
        if (!diffScreenshot(exp.screenshotDiffThreshold, got, exp.compareScreenshotTo, diff)) {
            failed = true;
            console.log(`screen diff failed: ${diff}`);
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

testCases().then(() => {
    if (failCount > 0) {
        console.log(`--FAIL-- ${failCount} tests fail, ${passCount} tests pass`);
    } else {
        console.log(`--PASS-- All ${passCount} tests pass`);
    }
})
