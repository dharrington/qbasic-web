import { Buffer, Charmap } from "./screen";

enum CharmapName {
    k8x8,
    k8x16,
    k8x14,
}

const charmapURIs: string[] = [
    // 8x8
    `data:image/webp;base64,UklGRq4EAABXRUJQVlA4TKIEAAAv/8EHAA8w//M///MfePCt/p8jSbZtWdJadw+tZUA+QF0VtH6H
IR+gHqNwp7XOwIdIA4Mc1307rvQwxwOiDX4MG+JKD/9jyfgPPSL4X2QYGPUbwrPUE0T0X2HaNoxC
5yns+3RRLujonpjuOdIbP1N/9BJVlctYSsZStZIkz0YT2cYSRUhlFV53XRkv6KanP++vXF0d3pv8
6iqnSdX4O3WUlMaQqpk3kjnsgalVAGZGA7+56sZS9BP+2hP+nqNpfqn3q8K+11ybnxwldQ2lVZ2M
pL5tOae5ZcCsRs287rquG6enf/LiC96ufqLr1H8xUVW7rrm+pzGJrlnVRUbay1YK8qwyko1Z+eLT
49h109M/eRGTXf3E/JL649T32ufavJto7LJteKnVE6u5yzBkslKN1z5RyrdG/YS/Bt1/cjq81/O4
9JNOat3vnJJMswfNvBmtnRqQAYOaWTTyuru4uLigm55Gvztd3fjZ5I/RqyqXMSYLa2oljXZjjFFe
EzHZmymrse/JUujoRA9NSSWFjreVylukkuRocZq7boK8droLoUSJEoEQ0EmTCxoP3LLwYPmwv+Ri
aauHNYN4n37wAw/Lvr5+mjw8frUQatVCY2VmYiWrXWJLpra5eBm++b/+tcFyqt1J8PDVgJDw82qa
qFIlS12nffaGWTbrzTgCISCaGsvLGJsXadGy1O7lMGI0A75VRKtqIPOIETusLSfrAI91M+BbCX8+
cMv0cly0t2FIP/jW26FukhrQFft+zUpy9A2xwluWJS8GdAVmagwN3qcfVA+D9yGkKh4GeT2Zr2dK
Eh5odfSGZN8CxrHmX0O6NP5mQRCnudu9BJHTLoSy256KRAtBOvmZkFxvZC27fCo4lQCpeTfr2lLI
casHdrzTOC4zk0KS3L3GZWaSJIXbHgdjjwPGQ7AtXxJSyKehBfN720IyTsXIp59W8kdfWanqQA4D
h0EJ8GnS+DTJwGJkAg44QKkJOCa325kpkQxBr+Bf7z91C40yiYhMIvuyT4xHIElyQv8bgcqeJFIy
EqD3izYPnE+G7mSYCeAs59w8YGpBau5EBIBH28XvTdkE8wcvlRrjyyvFlX+9//qi6dlwdjYoBfGl
cRxbH6OpdZAjAFiqFnQ0AJFsLV/5sC7bPJ9088lw0nXzrGgegNTWTC3EeqnGCf1pfFRhADb9iJb9
Qzd7DzoMA0nNvdzT932eRGSSgHj0toj0fVbRaOG8F+kBUkg8quT/3rcgJEkW3jIzqbTP7HmzPPEc
yf+/b06VStVh4KLrQA5KDqp03D3hSDKSjKVseVaEVvU9NRbyCdmTd4HEDvRrS8mYK6KZHautE5mT
XvbA8OF7nnQfdk+6wXF44AEO7pI1kGrvNxKC9n0Do9Zj5WbBpps0M9JILprerG3mluzcK7owrlbz
oqlGFmVOdeIDzj3g3AMfvufD7skPuyedc+6eBx64x7n5Aed2T/AfaKmee0VIWK0aaFVVuabqB0km
krpoHDgMHEhd/AelLmzmlnA+qqSEvq+IJPXcNiQTeTesW0txX9XK68JawBijnhu5/NwFbCTZGEmy
kSSpe5LkliQB`,
    // 8x16
    `data:image/webp;base64,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`,
    // 8x14
    `data:image/webp;base64,UklGRqoFAABXRUJQVlA4TJ4FAAAv/8ENAA8w//M///MfeLCs/p8kR040s+jo3ZaPhgJdvZz2/RX2
B+hX8K2JRPIuKCU5i/7wZ9L7dvWpQUMriAJNQOA4e68iCn7eXSIOpYB0/7xklqpr5gEi+s+wbdsw
FOC22yecZGi4f+Azdz+3mxBkeQZNQwI0NN/yzz3A0yeQB0oA068SHHNJ48sTB+eSzdY5smd1fGTC
1nsamrl85KMYei+zSu9HtpZegjIUgCTZa1a9GaqqAolF+bWZzb6h8Z/4mTz3YHY3b2SW2TRA4d+y
pf+dvboKtSQByXS+6ns/DL0qAEL5yFh3bHAsD38l5aN+eQqZBQJIdQjZ0TMMmlmSB0mcIfVhGJIq
WZqU+MhYe2z8J17/3MqXjx5bC/mAEoC1g3WOYHCpZUmmoWW5AHy8voZryMoe/NwnrDtu/Cde/1zE
ZE6Uk3GZYOixmE69ROltr0V7sjCBD49dBnAsD2Nz+/7Z3bzhSbANGhT7N5tJ2tdKZEkCkIOi9mkE
QAPykclbgMZ/ImJzjKH3cpKthydJuyUYVCIBEsRThWpSLZqAxAI2zZbe09CscHeJp08gJ8kC4Dgw
OG2ZyghdY923nCtuxdKzgpMMDcmBJEllw52B4wr3bmJHjvcEPnMTb8W2LG+yfABue+2X1nr137rc
qOZrd+0aVVWx/qkPBO94w8w79Hd5Yjs2x21LzSJBRBRJ6rcvg6jomJYhKcnKxMCKvmKijAFYUINc
yePHV4oUqr1QUdGfqGqQX5e7xInfsJJ74fZMZZC//GUYsyoqFaqaBeU2kVytnHe1DXkueGPhFu3C
XUdRVQuA+UzdIKvVYJFW9aUzdeoyVF/KvpScSKagQTexRR9gRSW2WqJo0HjLOcOZHc3ZaPRc60sh
jaCWm0TSyRBtjYJ+hZdEJcptifJSVgCgLlSu5HFVRQyPVbWeiUKDDbgq80QyyhCHkTBWb8bKyKAi
QaoooohqqE4Ump1CSz+mUasT9IKXRJ2r2kVvQyMAaJ1e+6Xd/Ej96tKq5k26dN5tg3rrn3iSrXOt
26RLL5dexdW0cTctgvZ2jlvu05z7FUkhSdbEcYmHyUysSE+S3HxrYsm3Zhn7aXf5+he/AKAju45d
B5Jpy5q5ZSWqhkJuWUulKjKXcySAC59JDgPJP/zyHffwETmWwByL+KK58jRrWRVVRZB4UlBKyxAK
OQzYZySWEJEZIkSwJRmCIkIz/W8kopZaFzqiin3miiRJP/mTbYwkSQaV6pcgSV6eZpIxslvfP0N0
q9VqJc65nHMI0kbnXIyqWjf4PVbZxcUFWcj1GiGMZtlxedHZi27JIWpKKVVVBaBaO6uqY7WJTYJG
sY0r1paCdTcd9F3fd+BVtM45J9baEdfEKak4g4NGOSPr0Ffx41kuL+zyoruwdrmUOMQYox+GAYC1
db2Dr01EhEY5J3XoF+d+x+cOXdeRhI8aY4xp+pCJJiguMaEjr33Tk//7fI/UurZt2945571Xtd85
d861bZ8drqFovWtFSUemU5D3T0+SpOe9JZIk19wVeu4zjvu2Grvd6bTnPsPDttcABIGu42jRkR3I
DqDh5m2G+wXu6M2Tybetbw/D0pJscv4WP31DsqQ5yECmsD4MpZJECIV9cRbACTBWDsKprZTWq4JN
VSKVE6DNZArVTRx173ru7eZd5u2mM+yOjtiZiVaHUBpZiGpqZlXZ9BXggmQKf59CVwpZSI4Gu2Zx
PQSsBWL1dDZzapEK0JBgCkvHI2OOjDl613PvMm9/l3m7McY8d3T0nDHLI2M2b+Nah1DWAtEgsw9W
JQCALYE3SEcSo2HHrmNHYvS9A7FDXTt4DdI0VcmSsMaCZDiMxfUQdF2BEIS1qCWJNUjSH0Y7DMHe
VjT5257DjdI0DW5JkjckD4ADSQ7cHbijQ/g37+vg9uhe`,
];

const charmapImageData: ImageData[] = [undefined, undefined];
// TODO: Maybe skip this step and store images as monochrome bitmaps.
function beginLoadImage(uri: string, index: number) {
    const img = document.createElement("img");
    img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d").drawImage(img, 0, 0, img.width, img.height);
        charmapImageData[index] = canvas.getContext("2d").getImageData(0, 0, img.width, img.height);
    };
    img.setAttribute("src", uri);
}

export function setup() {
    for (let i = 0; i < charmapURIs.length; i++) {
        beginLoadImage(charmapURIs[i], i);
    }
}

class CharMap implements Charmap {
    constructor(public width: number, public height: number, private data_: Buffer) { }
    data() { return this.data_; }
    charOffset(code: number): number[] {
        // Images have 4 rows of 64 characters each.
        return [this.width * (code % 64), this.height * Math.floor(code / 64)];
    }
}

function newCharmap(name: CharmapName) {
    const pc = charmapImageData[name];
    const data = new Uint8ClampedArray(pc.data);
    let charHeight: number = 0;
    switch (name) {
        case CharmapName.k8x8:
            charHeight = 8;
            break;
        case CharmapName.k8x16:
            charHeight = 16;
            break;
        case CharmapName.k8x14:
            charHeight = 14;
            break;
    }
    const buf = new Buffer(512, charHeight * 4);
    for (let i = 0; i + 3 < data.length; i += 4) {
        buf.data[i / 4] = (data[i] === 0) ? 255 : 0;
    }
    return new CharMap(8, charHeight, buf);
}

export function get8x16(): Charmap { return newCharmap(CharmapName.k8x16); }
export function get8x8(): Charmap { return newCharmap(CharmapName.k8x8); }
export function get8x14(): Charmap { return newCharmap(CharmapName.k8x14); }
