// Runs in the page before its own scripts. Sites read canvas, audio and graphics details to tell
// browsers apart. This makes those readings differ from site to site, and stay the same on one site
// so that pages keep working. Canvases in workers are not covered.
//
// The level comes from level-standard.js or level-strict.js, which run just before this file.

(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const strict = globals.__orbitFingerprintLevel === "strict";
  delete globals.__orbitFingerprintLevel;

  const SALT = "orbit-fingerprint-v1";
  const MAX_CANVAS_PIXELS = 16_000_000;

  function hash(text: string): number {
    let value = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      value ^= text.charCodeAt(i);
      value = Math.imul(value, 0x01000193);
    }
    return value >>> 0;
  }

  function generator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The site in the address bar is part of the seed, so a tracker embedded on two sites sees two values.
  function topOrigin(): string {
    const ancestors = location.ancestorOrigins;
    return ancestors && ancestors.length > 0 ? ancestors[ancestors.length - 1]! : location.origin;
  }
  const pageSeed = hash(`${SALT}|${topOrigin()}|${location.origin === "null" ? "" : location.origin}`);

  function wrapMethod(owner: object | undefined, name: string, handler: (target: Function, self: unknown, args: unknown[]) => unknown): void {
    if (!owner) return;
    const original = (owner as Record<string, unknown>)[name];
    if (typeof original !== "function") return;
    (owner as Record<string, unknown>)[name] = new Proxy(original, {
      apply: (target, self, args) => handler(target, self, args as unknown[]),
    });
  }

  function wrapGetter(owner: object | undefined, name: string, change: (value: unknown) => unknown): void {
    if (!owner) return;
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (!descriptor?.get) return;
    Object.defineProperty(owner, name, {
      ...descriptor,
      get: new Proxy(descriptor.get, {
        apply: (target, self, args) => change(Reflect.apply(target, self, args)),
      }),
    });
  }

  // Canvas
  function disturb(data: Uint8ClampedArray | Uint8Array, width: number, height: number): void {
    const pixels = Math.floor(data.length / 4);
    if (pixels === 0) return;
    const random = generator(pageSeed ^ Math.imul(width, 31) ^ height);
    const count = strict ? Math.ceil(pixels / 8) : Math.max(16, Math.ceil(pixels / 256));
    for (let i = 0; i < count; i++) {
      const at = Math.floor(random() * pixels) * 4;
      const channel = Math.floor(random() * 3);
      if (data[at + 3] !== 0) data[at + channel]! ^= 1;
    }
  }

  const getImageData = CanvasRenderingContext2D.prototype.getImageData;
  const putImageData = CanvasRenderingContext2D.prototype.putImageData;
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  const createElement = Document.prototype.createElement;
  const getContext = HTMLCanvasElement.prototype.getContext;

  function disturbedCopy(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
    const { width, height } = canvas;
    if (!width || !height || width * height > MAX_CANVAS_PIXELS) return null;
    const copy = Reflect.apply(createElement, document, ["canvas"]) as HTMLCanvasElement;
    copy.width = width;
    copy.height = height;
    const context = Reflect.apply(getContext, copy, ["2d", { willReadFrequently: true }]) as CanvasRenderingContext2D | null;
    if (!context) return null;
    Reflect.apply(drawImage, context, [canvas, 0, 0]);
    const image = Reflect.apply(getImageData, context, [0, 0, width, height]) as ImageData;
    disturb(image.data, width, height);
    Reflect.apply(putImageData, context, [image, 0, 0]);
    return copy;
  }

  wrapMethod(CanvasRenderingContext2D.prototype, "getImageData", (target, self, args) => {
    const image = Reflect.apply(target, self, args) as ImageData;
    if (image.width * image.height <= MAX_CANVAS_PIXELS) disturb(image.data, image.width, image.height);
    return image;
  });
  for (const name of ["toDataURL", "toBlob"]) {
    wrapMethod(HTMLCanvasElement.prototype, name, (target, self, args) => {
      let source = self;
      try {
        source = disturbedCopy(self as HTMLCanvasElement) ?? self;
      } catch {
        // A canvas holding cross-origin images cannot be read at all, and the original call reports that.
      }
      return Reflect.apply(target, source, args);
    });
  }

  // Graphics card details
  const UNMASKED_VENDOR = 0x9245;
  const UNMASKED_RENDERER = 0x9246;
  for (const prototype of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype]) {
    wrapMethod(prototype, "getParameter", (target, self, args) => {
      if (args[0] === UNMASKED_VENDOR) return "Google Inc.";
      if (args[0] === UNMASKED_RENDERER) return "ANGLE (Generic Renderer)";
      return Reflect.apply(target, self, args);
    });
    wrapMethod(prototype, "readPixels", (target, self, args) => {
      const result = Reflect.apply(target, self, args);
      const pixels = args[6];
      const context = self as WebGLRenderingContext;
      if (pixels instanceof Uint8Array) disturb(pixels, context.drawingBufferWidth, context.drawingBufferHeight);
      return result;
    });
  }

  // Audio
  const disturbedBuffers = new WeakSet<object>();
  function disturbAudio(samples: Float32Array, length: number): void {
    const random = generator(pageSeed ^ length);
    const scale = strict ? 1e-5 : 1e-7;
    for (let i = 0; i < samples.length; i += 97) {
      samples[i]! += (random() - 0.5) * scale;
    }
  }
  wrapMethod(globalThis.AudioBuffer?.prototype, "getChannelData", (target, self, args) => {
    const samples = Reflect.apply(target, self, args) as Float32Array;
    if (!disturbedBuffers.has(samples)) {
      disturbedBuffers.add(samples);
      disturbAudio(samples, samples.length);
    }
    return samples;
  });
  wrapMethod(globalThis.AudioBuffer?.prototype, "copyFromChannel", (target, self, args) => {
    const result = Reflect.apply(target, self, args);
    const destination = args[0];
    if (destination instanceof Float32Array) disturbAudio(destination, destination.length);
    return result;
  });
  wrapMethod(globalThis.AnalyserNode?.prototype, "getFloatFrequencyData", (target, self, args) => {
    const result = Reflect.apply(target, self, args);
    const destination = args[0];
    if (destination instanceof Float32Array) disturbAudio(destination, destination.length);
    return result;
  });

  // Hardware details, rounded to common values
  wrapGetter(Navigator.prototype, "hardwareConcurrency", (value) => ((value as number) > 4 ? 8 : 4));
  wrapGetter(Navigator.prototype, "deviceMemory", (value) => (value === undefined ? value : (value as number) >= 8 ? 8 : 4));

  if (!strict) return;

  // Strict level: these can affect how some sites lay out or size things.
  const textRandom = generator(pageSeed ^ 0x5bd1e995);
  const textJitter = 1 + (textRandom() - 0.5) * 0.0004;
  wrapGetter(globalThis.TextMetrics?.prototype, "width", (value) => (value as number) * textJitter);
  for (const name of ["width", "availWidth"]) {
    wrapGetter(globalThis.Screen?.prototype, name, (value) => Math.max(1024, Math.floor((value as number) / 200) * 200));
  }
  for (const name of ["height", "availHeight"]) {
    wrapGetter(globalThis.Screen?.prototype, name, (value) => Math.max(600, Math.floor((value as number) / 100) * 100));
  }
})();
