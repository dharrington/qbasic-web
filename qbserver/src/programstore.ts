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

function readProgramTitle(content: string): string {
    for (let line of content.substr(0, 200).split("\n")) {
        line = line.trim();
        if (line.startsWith("REM")) {
            line = line.substr(3).trim();
        }
        if (line.length > 2) {
            return line.substr(0, 50);
        }
    }
    return "Untitled";
}

export class Program {
    constructor(public id: string, public title: string, public content?: string) { }
}

async function IDBRequestToPromise(req: IDBRequest) {
    return new Promise((accept, reject) => {
        req.onsuccess = accept;
        req.onerror = reject;
    });
}

class ProgramStore {
    private db: IDBDatabase;
    private queuedBeforeLoad: Array<() => void> = [];
    constructor() {
        const req = window.indexedDB.open("programs", 1);
        req.onerror = () => {
            console.error("failed to open indexdb");
        };
        req.onsuccess = () => this.loaded(req.result);
        req.onupgradeneeded = (e) => {
            this.db = (e.target as any).result as IDBDatabase;
            const store = this.db.createObjectStore("programs", {
                keyPath: "program_id",
            });
            store.createIndex("program_id", "program_id", { unique: true });
        };
    }
    loaded(db) {
        this.db = db;
        for (const p of this.queuedBeforeLoad) p();
    }

    whenLoaded(): Promise<{}> {
        if (this.db) return new Promise<{}>((accept) => accept());
        return new Promise((accept) => {
            this.queuedBeforeLoad.push(accept);
        });
    }

    async waitForLoad() {
        if (this.db) return;
        return new Promise((accept) => {
            this.queuedBeforeLoad.push(accept);
        });
    }

    save(id: string, content: string) {
        return this.whenLoaded().then(
            () => {
                const trans = this.db.transaction(["programs"], "readwrite");
                const store = trans.objectStore("programs");
                content.substr(0, 200);
                const req = store.add({
                    program_id: id,
                    title: readProgramTitle(content),
                    content,
                });
                return new Promise<{}>(((accept, reject) => {
                    req.onsuccess = accept;
                    req.onerror = reject;
                }));
            });
    }

    async load(id: string): Promise<Program> {
        await this.waitForLoad();
        const trans = this.db.transaction(["programs"], "readonly");
        const store = trans.objectStore("programs");
        const req = store.get(id);
        return IDBRequestToPromise(req).then(() => {
            return new Program(id, req.result.title, req.result.content);
        });
    }

    async list(): Promise<Program[]> {
        await this.waitForLoad();
        const trans = this.db.transaction(["programs"], "readonly");
        const store = trans.objectStore("programs");
        const req = store.openCursor();
        const resultList = [];

        const result = new Promise((accept, reject) => {
            req.onerror = () => reject();
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    resultList.push(new Program(cursor.value.program_id, cursor.value.title));
                    cursor.continue();
                } else {
                    accept(resultList);
                }
            };
        });
        return result as Promise<Program[]>;
    }

    async remove(id: string) {
        await this.waitForLoad();

        const trans = this.db.transaction(["programs"], "readwrite");
        const store = trans.objectStore("programs");
        const req = store.delete(id);
        return IDBRequestToPromise(req);
    }
}

const globalStore = new ProgramStore();

export function save(id: string, content: string): Promise<{}> {
    return globalStore.save(id, content);
}

export function list(): Promise<Program[]> {
    return globalStore.list();
}

export function load(id: string): Promise<Program> {
    return globalStore.load(id);
}

export function remove(id: string): Promise<{}> {
    return globalStore.remove(id);
}
