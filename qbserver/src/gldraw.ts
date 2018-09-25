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

import { Buffer, Palette } from "./screen";

// Vertex shader program
const vsSource = `
    attribute vec4 aVertexPosition;
    void main(void) {
      gl_Position =  aVertexPosition;
    }
  `;

// Fragment shader program
const fsSource = `
    precision highp float;
    uniform sampler2D tex;
    uniform sampler2D pal;
    uniform vec2 WindowSize;
    void main(void) {
        float WW = WindowSize.x;
        float WH = WindowSize.y;
        // +0.5 reduces effect of precision loss
        float y = floor(WH-gl_FragCoord.y)+0.5;
        float x = floor(gl_FragCoord.x)+0.5;

        float cc = texture2D(tex, vec2(x/WW, y/WH)).w;
        vec4 c = texture2D(pal, vec2(cc+(0.5/255.0), 0.5));
        gl_FragColor.r=c.x;
        gl_FragColor.g=c.y;
        gl_FragColor.b=c.z;
        gl_FragColor.w=1.0;
    }
  `;


export class GLScreenDraw {
    //public buffer: Buffer;
    private positionBuffer: WebGLBuffer;
    private shaderProgram: WebGLShader;
    private gl: WebGLRenderingContext;
    private dtors: any[] = [];
    constructor(private canvas: HTMLCanvasElement) {
        const gl = this.canvas.getContext("webgl");
        if (!gl) {
            window.alert("Can't get WebGL context");
            return;
        }
        this.gl = gl;
        this.positionBuffer = gl.createBuffer() as WebGLBuffer;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        const positions = [
            1.0, 1.0,
            -1.0, 1.0,
            1.0, -1.0,
            -1.0, -1.0,
        ];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
        const s = initShaderProgram(gl);
        if (!s) return;
        this.dtors.push(s.dtor);
        this.shaderProgram = s.program as WebGLShader;
    }
    destroy() {
        for (const d of this.dtors) {
            d();
        }
    }
    draw(buffer: Buffer, palette: Palette) {
        const gl = this.gl;
        gl.clearColor(0.0, 0.0, 0.0, 1.0);  // Clear to black, fully opaque
        gl.disable(gl.DEPTH_TEST);           // Enable depth testing

        // Clear the canvas before we start drawing on it.

        gl.clear(gl.COLOR_BUFFER_BIT);

        {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.vertexAttribPointer(
                gl.getAttribLocation(this.shaderProgram, "aVertexPosition"),
                2,
                gl.FLOAT,
                false,
                0,
                0);
            gl.enableVertexAttribArray(
                gl.getAttribLocation(this.shaderProgram, "aVertexPosition"));
        }

        const txtPix = gl.createTexture();
        {
            const data = buffer.data;

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, txtPix);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, buffer.width, buffer.height, 0, gl.ALPHA, gl.UNSIGNED_BYTE, data);
        }

        const txtPal = gl.createTexture();
        {
            const data = palette.colors;

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, txtPal);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
        }

        gl.useProgram(this.shaderProgram);
        gl.uniform1i(gl.getUniformLocation(this.shaderProgram, "tex"), 0);
        gl.uniform1i(gl.getUniformLocation(this.shaderProgram, "pal"), 1);
        gl.uniform2f(gl.getUniformLocation(this.shaderProgram, "WindowSize"), this.canvas.width, this.canvas.height);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}

function initShaderProgram(gl: WebGLRenderingContext) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vertexShader || !fragmentShader) return;
    // Create the shader program

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader.shader);
    gl.attachShader(shaderProgram, fragmentShader.shader);
    gl.linkProgram(shaderProgram);

    // If creating the shader program failed, alert
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        alert("Unable to initialize the shader program: " + gl.getProgramInfoLog(shaderProgram));
        return null;
    }

    return {
        program: shaderProgram,
        dtor: () => {
            vertexShader.dtor();
            fragmentShader.dtor();
            gl.deleteProgram(shaderProgram);
        },
    };
}

function loadShader(gl: WebGLRenderingContext, type, source) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return undefined;
    }

    return {
        shader,
        dtor: () => gl.deleteShader(shader),
    };
}
