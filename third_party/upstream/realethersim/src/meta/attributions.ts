// Third-party attributions + the project's own license, shown in the About panel. ETHERSIM is fully
// self-contained (no network calls, no external resources at runtime) and MIT-licensed; this credits
// the open-source libraries it is built on. Data gathered from package.json + each dependency's
// installed package.json. three.js is the headline dependency (the renderer).

export interface Attribution {
  name: string;
  version: string;
  license: string;
  url: string;
  role: string; // one-line plain-English role in this app
}

export const ATTRIBUTIONS: Attribution[] = [
  {
    "name": "three",
    "version": "0.184.0",
    "license": "MIT",
    "url": "https://threejs.org/",
    "role": "WebGPU/WebGL renderer + TSL node materials — the core 3D engine that draws every system"
  },
  {
    "name": "lit",
    "version": "3.3.3",
    "license": "BSD-3-Clause",
    "url": "https://lit.dev/",
    "role": "web components for the control UI"
  },
  {
    "name": "nanostores",
    "version": "1.3.0",
    "license": "MIT",
    "url": "https://github.com/nanostores/nanostores",
    "role": "reactive state store"
  },
  {
    "name": "@nanostores/lit",
    "version": "0.2.3",
    "license": "MIT",
    "url": "https://github.com/nanostores/lit",
    "role": "binds nanostores state into Lit components"
  },
  {
    "name": "katex",
    "version": "0.17.0",
    "license": "MIT",
    "url": "https://katex.org",
    "role": "math typesetting in the Learn panel"
  },
  {
    "name": "tweakpane",
    "version": "4.0.5",
    "license": "MIT",
    "url": "https://tweakpane.github.io/docs/",
    "role": "parameter sliders"
  },
  {
    "name": "zod",
    "version": "4.4.3",
    "license": "MIT",
    "url": "https://zod.dev",
    "role": "snapshot schema validation"
  },
  {
    "name": "vite",
    "version": "8.0.16",
    "license": "MIT",
    "url": "https://vite.dev",
    "role": "build tooling (dev only)"
  },
  {
    "name": "typescript",
    "version": "6.0.3",
    "license": "Apache-2.0",
    "url": "https://www.typescriptlang.org/",
    "role": "build tooling (dev only)"
  }
];

export const LICENSE_SPDX = "MIT";
export const COPYRIGHT = "Copyright (c) 2026 realethersim authors";
export const LICENSE_TEXT = "MIT License\n\nCopyright (c) 2026 realethersim authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.";
