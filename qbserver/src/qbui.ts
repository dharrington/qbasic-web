import * as codegen from "../../qb/src/codegen";
import * as lex from "../../qb/src/lex";
import * as parse from "../../qb/src/parse";
import * as vm from "../../qb/src/vm";
import * as canvaspc from "./canvaspc";
import * as Editor from "./editor";
import * as programstore from "./programstore";
import * as util from "./util";

Editor.Init(document.getElementById("editor") as any);

const defaultProgram = `REM Untitled Program

COLOR 5
PRINT "HELLO ";
COLOR 7
PRINT " WORLD!"
`;

export class AppState {
    public currentProgramID: string = "";
    public exe: vm.Execution | undefined;
    public pc: canvaspc.CanvasPC | undefined;
    public loading = false;
    constructor() {
        window.onload = () => {
            window.onhashchange = () => this.hashChanged();
            this.hashChanged();
            this.newProgram();
        };
        canvaspc.setup();
    }
    hashChanged() {
        const id = window.location.hash.substr(1);
        if (id.length === 0) {
            return;
        }
        if (id === "new") {
            Editor.setText(defaultProgram);
            window.location.hash = "";
            return;
        }
        if (!util.isValidUUID(id)) return;
        if (id !== this.currentProgramID) {
            document.getElementById("opendialog").classList.add("hidden");
            this.loadProgram(id);
        }
    }
    newProgram() {
        this.currentProgramID = "";
        window.location.hash = "new";
    }
    setLoading(loading) {
        if (this.loading === loading) return;
        this.loading = loading;
        if (this.loading) {
            Editor.setDisabled(true);
            document.getElementById("loading").classList.remove("hidden");
        } else {
            Editor.setDisabled(false);
            document.getElementById("loading").classList.add("hidden");
        }
    }
    loadProgram(id: string) {
        Editor.setText("");
        this.setLoading(true);
        programstore.load(id).then((p) => {
            Editor.setText(p.content);
            this.setLoading(false);
        }).catch(() => {
            this.setLoading(false);
            window.alert("failed to load program");
            this.newProgram();
        });
    }
    deleteProgram(cb: (ok: boolean) => void) {
        if (!window.confirm("Really delete this program?")) {
            return;
        }
        if (!this.currentProgramID.length) {
            this.newProgram();
            cb(true);
            return;
        }

        const id = this.currentProgramID;
        programstore.remove(id);
        this.newProgram();
    }
    saveProgram(cb: (ok: boolean) => void) {
        let id = this.currentProgramID;
        if (!id) {
            id = util.newUUID();
        }
        programstore.save(id, Editor.text()).then(() => {
            this.currentProgramID = id;
        });
    }
}

const app = new AppState();

function isMenuShown(name: string) {
    const el = document.getElementById(name);
    return el.classList.contains("menuopen");
}
function showMenuE(menuEl: Element) {
    if (menuEl.classList.contains("menuopen")) {
        menuEl.classList.remove("menuopen");
    } else {
        menuEl.classList.add("menuopen");
    }
}
export function showMenu(name: string) {
    const shown = isMenuShown(name);
    hideMenus();
    if (!shown) showMenuE(document.getElementById(name));
}
export function hideMenus() {
    for (const m of ["filemenu", "runmenu"]) {
        if (isMenuShown(m)) {
            showMenuE(document.getElementById(m));
        }
    }
}
export function save() {
    app.saveProgram((ok) => {
        if (!ok) alert("ERROR SAVING PROGRAM");
    });
}
export function start() {
    const programText = Editor.text();
    const tokens = lex.lex(programText);
    const ctx = new codegen.CodegenCtx();
    parse.parse(ctx, tokens);

    if (ctx.errors().length > 0) {
        const errors = ctx.errors();
        Editor.setCursorPosition(ctx.errorLocations()[0].line);
        window.alert("Program has errors: " + errors[0]);
        return false;
    }
    document.getElementById("program_running").classList.remove("hidden");
    document.getElementById("program_complete").classList.add("hidden");
    document.getElementById("runscreen").classList.remove("hidden");
    document.getElementById("editscreen").classList.add("hidden");

    if (app.pc) {
        app.pc.destroy();
    }
    const pc = new canvaspc.CanvasPC(document.getElementById("canvasholder"));
    app.pc = pc;
    ctx.program().source = programText; // for debugging.
    app.exe = new vm.Execution(ctx.program(), pc);
    app.exe.onEnd = () => {
        document.getElementById("program_running").classList.add("hidden");
        document.getElementById("program_complete").classList.remove("hidden");
        app.pc.setInputEnabled(false);
    };
    app.exe.onException = (error: string, lineNo: number | undefined) => {
        document.getElementById("program_running").classList.add("hidden");
        document.getElementById("program_complete").classList.remove("hidden");
        Editor.setCursorPosition(lineNo);
        window.alert("Exception: " + error + ", on line " + lineNo);
    };
    app.exe.start();
}

export function stop() {
    if (app.exe) {
        app.exe.destroy();
        app.exe = undefined;
    }
    if (app.pc) {
        app.pc.destroy();
        app.pc = undefined;
    }

    document.getElementById("runscreen").classList.add("hidden");
    document.getElementById("editscreen").classList.remove("hidden");
    Editor.setFocus();
}
export function newfile() {
    stop();
    app.newProgram();
}
export function open() {
    programstore.list().then((progs) => {
        const tbl = document.getElementById("openprogramtable");
        const entries = [];
        for (const p of progs) {
            entries.push(`<tr><td><a href='#${p.id}'>${util.escapeHtml(p.title)}</a></td></tr>`);
        }
        tbl.innerHTML = entries.join("\n");
        document.getElementById("opendialog").classList.remove("hidden");
    });
}
export function deleteprogram() {
    app.deleteProgram(() => { });
}
export function closeOpenDialog() {
    document.getElementById("opendialog").classList.add("hidden");
    document.getElementById("openprogramtable").innerHTML = "";
}

window.addEventListener("keypress", (e: KeyboardEvent) => {
    if (app.exe && app.exe.done && !document.getElementById("runscreen").classList.contains("hidden")) {
        stop();
        e.preventDefault();
    }
});

window.addEventListener("keydown", (e) => {
    if (e.key === "/" && e.ctrlKey || e.key === "F5") {
        start();
        e.preventDefault();
    }
});
