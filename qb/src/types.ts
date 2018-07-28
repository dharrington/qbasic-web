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

export enum BaseType {
    kNone,
    kString,
    kInt,
    kLongInt,
    kSingle,
    kDouble,
    kUserType,
}

export function sigilToBaseType(sigil: string): BaseType {
    if (sigil === "$") return BaseType.kString;
    if (sigil === "%") return BaseType.kInt;
    if (sigil === "&") return BaseType.kLongInt;
    if (sigil === "!") return BaseType.kSingle;
    if (sigil === "#") return BaseType.kDouble;
    return BaseType.kNone;
}

export function baseTypeToSigil(b?: BaseType): string {
    if (!b) return "";
    if (b === BaseType.kString) return "$";
    if (b === BaseType.kInt) return "%";
    if (b === BaseType.kLongInt) return "&";
    if (b === BaseType.kSingle) return "!";
    if (b === BaseType.kDouble) return "#";
    return "";
}

export class UserTypeField {
    constructor(public name: string, public type: Type) { }
}

export class FunctionType {
    constructor(public resultType: Type, public argTypes: Type[], public optionalParameters = 0) { }
}

export class Type {
    static makeBasic(baseType: BaseType): Type {
        const t = new Type();
        t.type = baseType;
        return t;
    }
    static basic(baseType: BaseType): Type | null {
        switch (baseType) {
            case BaseType.kInt: return kIntType;
            case BaseType.kString: return kStringType;
            case BaseType.kDouble: return kDoubleType;
            case BaseType.kSingle: return kSingleType;
            case BaseType.kLongInt: return kLongType;
        }
        return null;
    }
    public type: BaseType;
    public fields: UserTypeField[];

    equals(other: Type): boolean {
        if (this.type !== other.type) return false;
        if (this.type === BaseType.kUserType) {
            return false; // TODO
        }
        return true;
    }
    isNumeric(): boolean {
        switch (this.type) {
            case BaseType.kInt:
            case BaseType.kLongInt:
            case BaseType.kSingle:
            case BaseType.kDouble:
                return true;
        }
        return false;
    }
    isString(): boolean {
        return this.type === BaseType.kString;
    }
    isBasic(): boolean {
        return this.isNumeric() || this.isString();
    }
    toString(): string {
        return BaseType[this.type];
    }
}

export const kIntType = Type.makeBasic(BaseType.kInt);
export const kStringType = Type.makeBasic(BaseType.kString);
export const kDoubleType = Type.makeBasic(BaseType.kDouble);
export const kSingleType = Type.makeBasic(BaseType.kSingle);
export const kLongType = Type.makeBasic(BaseType.kLongInt);
