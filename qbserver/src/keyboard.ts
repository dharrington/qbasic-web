// From https://qb64.org/wiki/Keyboard_scancodes

export function eventToInkey(event: KeyboardEvent): string | undefined {
    const code = event.which;
    const key = event.key;
    if (event.ctrlKey) {
        if (code >= 65 && code <= 90) {
            return String.fromCodePoint(code - 65 + 1);
        }
    }
    if (event.altKey) {
        if (code >= 65 && code <= 90) {
            return String.fromCodePoint(code - 65 + 30);
        }
    }
    if (code >= 112 && code <= 123) return String.fromCodePoint(0, code - 112 + 59);
    if (code >= 97 && code <= 105) return String.fromCodePoint(code - 97 + 49);
    switch (code) {
        case 45: return String.fromCodePoint(0, 82);
        case 36: return String.fromCodePoint(0, 71);
        case 33: return String.fromCodePoint(0, 73);
        case 46: return String.fromCodePoint(0, 83);
        case 35: return String.fromCodePoint(0, 79);
        case 34: return String.fromCodePoint(0, 81);
        case 37: return String.fromCodePoint(0, 75);
        case 40: return String.fromCodePoint(0, 80);
        case 39: return String.fromCodePoint(0, 77);
        case 38: return String.fromCodePoint(0, 72);
        case 13: case 27: return String.fromCodePoint(code);
    }
    if (event.key.length === 1) return event.key;
    return undefined;
}
