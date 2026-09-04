import { Vibrant } from 'node-vibrant/browser';

const accentColorCache = new Map<string, string | undefined>();
const pendingColorRequests = new Map<string, Promise<string | undefined>>();

/**
 * 从封面中提取适合氛围背景的鲜明主色。
 *
 * 使用 node-vibrant 的浏览器量化器生成语义化色板。它将鲜明色与柔和色分离，避免
 * 大面积留白、灰阶或阴影仅因像素数量多而主导播放器背景。结果按图片地址缓存；同一
 * 封面在列表、详情或反复进入页面时不会重复量化。
 *
 * @param source 用于加载封面的同源图片地址。
 * @returns CSS `rgb()` 颜色字符串；图片加载或量化失败时返回 `undefined`，由调用方使用主题默认色。
 */
export function getArtworkAccentColor(source: string): Promise<string | undefined> {
  if (accentColorCache.has(source)) {
    return Promise.resolve(accentColorCache.get(source));
  }

  const pendingRequest = pendingColorRequests.get(source);
  if (pendingRequest) return pendingRequest;

  const request = sampleArtworkAccentColor(source)
    .catch(() => undefined)
    .then((color) => {
      accentColorCache.set(source, color);
      return color;
    })
    .finally(() => pendingColorRequests.delete(source));

  pendingColorRequests.set(source, request);
  return request;
}

/**
 * 根据莫奈主色选择对比度更高的浅色或深色前景。
 *
 * 使用 WCAG 相对亮度公式比较黑、白两种前景的对比度，不额外改变已经确定的
 * 封面取色结果。
 */
export function prefersLightArtworkForeground(color?: string): boolean {
  const channels = color?.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    return false;
  }

  const [red, green, blue] = channels.map((channel) => {
    const normalized = Math.min(255, Math.max(0, channel)) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const lightContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.05;
  return lightContrast >= darkContrast;
}

/**
 * 根据文字实际覆盖区域的像素分布选择浅色或深色前景。
 *
 * 使用第 10 百分位的对比度而非平均亮度，避免少量极亮或极暗像素导致误判。
 */
export function prefersLightArtworkForegroundForPixels(pixels: Uint8ClampedArray): boolean {
  const lightContrasts: number[] = [];
  const darkContrasts: number[] = [];

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const luminance = relativeLuminance(pixels[index], pixels[index + 1], pixels[index + 2]);
    lightContrasts.push(1.05 / (luminance + 0.05));
    darkContrasts.push((luminance + 0.05) / 0.05);
  }

  if (lightContrasts.length === 0) return false;
  lightContrasts.sort((left, right) => left - right);
  darkContrasts.sort((left, right) => left - right);
  const index = Math.floor((lightContrasts.length - 1) * 0.1);
  return lightContrasts[index] >= darkContrasts[index];
}

function relativeLuminance(red: number, green: number, blue: number): number {
  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map((channel) => {
    const normalized = Math.min(255, Math.max(0, channel)) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue;
}

async function sampleArtworkAccentColor(source: string): Promise<string | undefined> {
  const palette = await Vibrant.from(source)
    .maxColorCount(32)
    .quality(3)
    .getPalette();
  const swatch = palette.Vibrant
    ?? palette.DarkVibrant
    ?? palette.LightVibrant
    ?? palette.Muted
    ?? palette.DarkMuted
    ?? palette.LightMuted;

  if (!swatch) return undefined;

  return `rgb(${swatch.rgb.join(' ')})`;
}
