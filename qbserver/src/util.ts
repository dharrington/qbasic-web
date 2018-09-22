const entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#x2F;",
    "`": "&#x60;",
    "=": "&#x3D;",
};

export function escapeHtml(s): string {
    return String(s).replace(/[&<>"'`=\/]/g, (z) => {
        return entityMap[z];
    });
}

export function newUUID() {
    let id = "";
    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (let i = 0; i < 64; i++) {
        const x = Math.trunc(Math.random() * 64);
        if (!charset[x]) {
            console.log(x);
        }
        id += charset[x];
    }
    id = btoa(atob(id).substr(0, 32));
    id = id.replace(/\+/g, "-");
    id = id.replace(/\//g, "_");
    return id;
}

export function isValidUUID(id) {
    if (!id) return false;
    try {
        id = id.replace(/-/g, "+");
        id = id.replace(/_/g, "/");
        const data = atob(id);
        return data.length === 32;
    } catch (err) {
        return false;
    }
}