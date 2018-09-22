import * as CodeMirror from "codemirror";
import * as codegen from "../../qb/src/codegen";
import * as lex from "../../qb/src/lex";
import * as parse from "../../qb/src/parse";
import "../node_modules/codemirror/addon/lint/lint";
import "../node_modules/codemirror/addon/mode/simple";

function lint(content: string) {
    const tokens = lex.lex(content);
    const ctx = new codegen.CodegenCtx();
    parse.parse(ctx, tokens);
    const errors = [];
    for (let i = 0; i < ctx.errors().length; i++) {
        errors.push({
            col: ctx.errorLocations()[i].position,
            line: ctx.errorLocations()[i].line + 1,
            message: ctx.errors()[i],
        });
    }
    return errors;
}

CodeMirror.registerHelper("lint", "qbasic", (content: string) => {
    const found = [];
    const errors = lint(content);
    for (const e of errors) {
        found.push({
            from: CodeMirror.Pos(e.line - 1, e.col),
            to: CodeMirror.Pos(e.line - 1, e.col + 1),
            message: e.message,
        });
    }
    return found;
});

(CodeMirror as any).defineSimpleMode("qbasic", {
    // The start state contains the rules that are intially used
    start: [
        { regex: /"[^"]*"/, token: "string" },
        { regex: /(REM\s|').*/, token: "comment" },
    ],
});

let editor: CodeMirror.Editor;

export function Init(element: HTMLTextAreaElement) {
    editor = CodeMirror.fromTextArea(element, {
        theme: "dos",
        mode: "qbasic",
        gutters: ["CodeMirror-lint-markers"],
        viewportMargin: Infinity,
        lint: true,
    });
}

export function text(): string {
    return editor.getValue();
}

export function setText(v: string) {
    return editor.setValue(v);
}

export function setFocus() {
    editor.focus();
}

export function setDisabled(value: boolean) {
    (editor as any).disabled = value;
}

export function setCursorPosition(line: number) {
    (editor as any).setCursor(line, 0);
}