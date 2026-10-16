/**
 * WCAG contrast helpers for Playwright's `locator.evaluate()`.
 *
 * Each exported function below is passed directly as the page-function
 * argument to `locator.evaluate(fn)` — Playwright serializes the function
 * source and runs it inside the browser context. That means every helper
 * MUST be fully self-contained (no references to anything outside its own
 * body, including other exports in this file): all nested helpers are
 * declared inline inside each function.
 *
 * Colour normalisation never assumes `getComputedStyle` already returns
 * `rgb()`/`rgba()` — this project's tokens are authored in `oklch()`, and
 * depending on the engine, computed style strings can come back as
 * `oklch()`/`lab()`/`color()` unchanged. A 1x1 canvas's `fillStyle` +
 * `getImageData` round-trip accepts any valid CSS colour syntax and always
 * yields quantised sRGB bytes, so every colour (and every alpha composite)
 * is resolved that way instead of parsing the string ourselves.
 */

export type TextContrastResult = {
  ratio: number;
  fontSize: number;
  fontWeight: number;
  isLarge: boolean;
  fg: string;
  bg: string;
  text: string;
};

export type FocusRingContrastResult = {
  ratio: number;
  bg: string;
  detail: string;
};

export type RadioIndicatorContrastResult = {
  circleVsRow: number;
  dotVsCircle: number | null;
  rowBackdrop: string;
  circleEffective: string;
};

/**
 * Normal/large-text contrast (WCAG 1.4.3): the element's own `color`
 * against the first non-transparent background found by walking up the
 * ancestor chain (compositing any semi-transparent layers along the way).
 * "Large" text is >=24px, or >=18.66px when bold (>=700) — the WCAG 2.1
 * 1.4.3 definition (18pt / 14pt bold at the CSS 96dpi px equivalence).
 */
export function collectTextContrast(el: HTMLElement): TextContrastResult {
  function toRGBA(colorStr: string): {
    r: number;
    g: number;
    b: number;
    a: number;
  } {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = colorStr;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
  }

  function compositeOver(backdropStr: string, paintStr: string): string {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = backdropStr;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = paintStr;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${data[0]},${data[1]},${data[2]})`;
  }

  function relLuminance(c: { r: number; g: number; b: number }): number {
    function chan(v: number): number {
      const cs = v / 255;
      return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
  }

  function contrastRatio(
    c1: { r: number; g: number; b: number },
    c2: { r: number; g: number; b: number }
  ): number {
    const l1 = relLuminance(c1);
    const l2 = relLuminance(c2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function resolveBackdrop(start: HTMLElement): string {
    let node: HTMLElement | null = start;
    let composed = "rgb(255,255,255)";
    const layers: string[] = [];
    while (node) {
      const cs = getComputedStyle(node);
      const rgba = toRGBA(cs.backgroundColor);
      if (rgba.a > 0) {
        layers.unshift(cs.backgroundColor);
        if (rgba.a >= 0.999) break;
      }
      node = node.parentElement;
    }
    for (const layer of layers) {
      composed = compositeOver(composed, layer);
    }
    return composed;
  }

  const backdrop = resolveBackdrop(el);
  const style = getComputedStyle(el);
  const fgRGBA = toRGBA(style.color);
  const bgRGBA = toRGBA(backdrop);
  const ratio = contrastRatio(fgRGBA, bgRGBA);
  const fontSize = parseFloat(style.fontSize);
  const fontWeight = parseInt(style.fontWeight, 10) || 400;
  const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);

  return {
    ratio,
    fontSize,
    fontWeight,
    isLarge,
    fg: style.color,
    bg: backdrop,
    text: (el.textContent ?? "").trim().slice(0, 80),
  };
}

/**
 * Non-text contrast for a keyboard focus indicator (WCAG 1.4.11): reads
 * whichever of `box-shadow` / `outline` is actually visible on the
 * (already-focused) element, composites its colour over the element's
 * PARENT background (the indicator paints outside the element's own box,
 * against whatever sits behind it — not the element's own fill), and
 * returns the contrast of that effective colour against the same backdrop.
 */
export function collectFocusRingContrast(
  el: HTMLElement
): FocusRingContrastResult {
  function toRGBA(colorStr: string): {
    r: number;
    g: number;
    b: number;
    a: number;
  } {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = colorStr;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
  }

  function compositeOver(backdropStr: string, paintStr: string): string {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = backdropStr;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = paintStr;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${data[0]},${data[1]},${data[2]})`;
  }

  function relLuminance(c: { r: number; g: number; b: number }): number {
    function chan(v: number): number {
      const cs = v / 255;
      return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
  }

  function contrastRatio(
    c1: { r: number; g: number; b: number },
    c2: { r: number; g: number; b: number }
  ): number {
    const l1 = relLuminance(c1);
    const l2 = relLuminance(c2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function resolveBackdrop(start: HTMLElement | null): string {
    let node: HTMLElement | null = start;
    let composed = "rgb(255,255,255)";
    const layers: string[] = [];
    while (node) {
      const cs = getComputedStyle(node);
      const rgba = toRGBA(cs.backgroundColor);
      if (rgba.a > 0) {
        layers.unshift(cs.backgroundColor);
        if (rgba.a >= 0.999) break;
      }
      node = node.parentElement;
    }
    for (const layer of layers) {
      composed = compositeOver(composed, layer);
    }
    return composed;
  }

  const backdrop = resolveBackdrop(el.parentElement);
  const style = getComputedStyle(el);

  // WCAG 1.4.11 only requires AT LEAST ONE sufficiently-contrasting visual
  // change to signal focus — this component can change both its border
  // colour (solid, full-opacity) AND paint a semi-transparent ring halo
  // (the `ring-*/50` utility) at the same time, and either one alone can
  // be the compliant signal. Score every candidate independently and keep
  // the best, rather than asserting on a single arbitrarily-chosen layer.
  const candidates: { label: string; ratio: number; effective: string }[] = [];

  if (style.boxShadow && style.boxShadow !== "none") {
    // Tailwind's ring utilities stack several box-shadow layers — several
    // fully-transparent placeholders (for ring-offset/inset slots that
    // aren't used) plus exactly one layer that's the actual visible ring.
    // Taking the FIRST colour match in the string is wrong: it's often one
    // of the zero-alpha placeholders, not the real ring. Score every
    // matched colour by its own alpha (via the same canvas normalisation)
    // and keep whichever is most opaque — that is the layer actually
    // painted on screen.
    const matches = style.boxShadow.match(
      /rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|oklch\([^)]+\)|oklab\([^)]+\)|lab\([^)]+\)|lch\([^)]+\)|color\([^)]+\)/g
    );
    if (matches) {
      let bestAlpha = 0;
      let bestColor: string | null = null;
      for (const candidate of matches) {
        const alpha = toRGBA(candidate).a;
        if (alpha > bestAlpha) {
          bestAlpha = alpha;
          bestColor = candidate;
        }
      }
      if (bestColor) {
        const effective = compositeOver(backdrop, bestColor);
        candidates.push({
          label: `box-shadow:${style.boxShadow} -> effective:${effective}`,
          ratio: contrastRatio(toRGBA(effective), toRGBA(backdrop)),
          effective,
        });
      }
    }
  }

  if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) {
    const effective = compositeOver(backdrop, style.outlineColor);
    candidates.push({
      label: `outline:${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} -> effective:${effective}`,
      ratio: contrastRatio(toRGBA(effective), toRGBA(backdrop)),
      effective,
    });
  }

  if (parseFloat(style.borderWidth) > 0 && style.borderStyle !== "none") {
    const borderRGBA = toRGBA(style.borderColor);
    if (borderRGBA.a > 0) {
      const effective = compositeOver(backdrop, style.borderColor);
      candidates.push({
        label: `border:${style.borderStyle} ${style.borderWidth} ${style.borderColor} -> effective:${effective}`,
        ratio: contrastRatio(toRGBA(effective), toRGBA(backdrop)),
        effective,
      });
    }
  }

  if (candidates.length === 0) {
    return { ratio: 0, bg: backdrop, detail: "no-visible-indicator" };
  }

  const best = candidates.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  const detail = candidates.map((c) => c.label).join(" | ");
  return { ratio: best.ratio, bg: backdrop, detail };
}

/**
 * Non-text contrast for the checked-radio state indicator (WCAG 1.4.11):
 * `circleVsRow` is the checked radio's own background against its parent
 * row's background (the control's state boundary against adjacent
 * colour); `dotVsCircle` is the inner dot's colour against the circle it
 * sits on (a graphical object against its own background), or `null` if
 * no dot element is present (e.g. the radio isn't checked).
 */
export function collectRadioIndicatorContrast(
  el: HTMLElement
): RadioIndicatorContrastResult {
  function toRGBA(colorStr: string): {
    r: number;
    g: number;
    b: number;
    a: number;
  } {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = colorStr;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
  }

  function compositeOver(backdropStr: string, paintStr: string): string {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = backdropStr;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = paintStr;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${data[0]},${data[1]},${data[2]})`;
  }

  function relLuminance(c: { r: number; g: number; b: number }): number {
    function chan(v: number): number {
      const cs = v / 255;
      return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
  }

  function contrastRatio(
    c1: { r: number; g: number; b: number },
    c2: { r: number; g: number; b: number }
  ): number {
    const l1 = relLuminance(c1);
    const l2 = relLuminance(c2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function resolveBackdrop(start: HTMLElement | null): string {
    let node: HTMLElement | null = start;
    let composed = "rgb(255,255,255)";
    const layers: string[] = [];
    while (node) {
      const cs = getComputedStyle(node);
      const rgba = toRGBA(cs.backgroundColor);
      if (rgba.a > 0) {
        layers.unshift(cs.backgroundColor);
        if (rgba.a >= 0.999) break;
      }
      node = node.parentElement;
    }
    for (const layer of layers) {
      composed = compositeOver(composed, layer);
    }
    return composed;
  }

  const rowBackdrop = resolveBackdrop(el.parentElement);
  const ownStyle = getComputedStyle(el);
  const circleEffective = compositeOver(rowBackdrop, ownStyle.backgroundColor);
  const circleVsRow = contrastRatio(
    toRGBA(circleEffective),
    toRGBA(rowBackdrop)
  );

  // The dot can be nested inside a wrapper span (base-ui's Indicator) that
  // itself paints no background — walk every descendant span and use the
  // first one that actually carries an opaque/semi-opaque fill, which is
  // the real visual dot, not its layout wrapper.
  const spans = Array.from(el.querySelectorAll("span"));
  let dotVsCircle: number | null = null;
  for (const candidate of spans) {
    const dotStyle = getComputedStyle(candidate);
    const dotRGBA = toRGBA(dotStyle.backgroundColor);
    if (dotRGBA.a > 0) {
      const dotEffective = compositeOver(
        circleEffective,
        dotStyle.backgroundColor
      );
      dotVsCircle = contrastRatio(
        toRGBA(dotEffective),
        toRGBA(circleEffective)
      );
      break;
    }
  }

  return { circleVsRow, dotVsCircle, rowBackdrop, circleEffective };
}
