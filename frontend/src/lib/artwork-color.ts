type ColorBucket = {
  redTotal: number;
  greenTotal: number;
  blueTotal: number;
  weight: number;
};

const sampleSize = 24;
const colorBucketSize = 32;
const accentColorCache = new Map<string, string | undefined>();
const pendingColorRequests = new Map<string, Promise<string | undefined>>();

/**
 * 从封面图片中提取适合作为界面强调色的主色。
 *
 * 图片会先缩小到固定尺寸再采样，并按量化后的色彩分桶选择权重最高的一组，
 * 这样可以避开黑白边框、阴影和少量噪点，优先得到封面的主要色彩。结果按图片地址
 * 缓存；同一封面在列表、详情或反复进入页面时不会重复创建图片和读取画布。
 *
 * @param source 用于加载封面的同源图片地址。
 * @returns CSS `rgb()` 颜色字符串；图片加载或画布读取失败时返回 `undefined`，由调用方使用主题默认色。
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
 * 读取封面像素并计算权重最高的颜色分桶。
 *
 * 低透明度、接近纯黑和接近纯白的像素不会参与统计，避免封面边框或留白主导结果；
 * 饱和度更高的像素获得更大权重，使提取结果更接近用户感知的专辑主色。
 *
 * @param source 用于加载封面的同源图片地址。
 * @returns 采样得到的 CSS `rgb()` 颜色字符串；没有有效像素时返回 `undefined`。
 */
async function sampleArtworkAccentColor(source: string): Promise<string | undefined> {
  const image = await loadArtworkImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = sampleSize;
  canvas.height = sampleSize;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;

  context.drawImage(image, 0, 0, sampleSize, sampleSize);
  const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
  const buckets = new Map<string, ColorBucket>();

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    const brightest = Math.max(red, green, blue);
    const darkest = Math.min(red, green, blue);
    const lightness = (brightest + darkest) / 510;
    const vividness = (brightest - darkest) / 255;

    // 透明、纯暗和纯亮区域通常是边框、留白或透明底，不代表封面主题。
    if (alpha < 128 || lightness < 0.08 || lightness > 0.94) continue;

    const key = [
      Math.floor(red / colorBucketSize),
      Math.floor(green / colorBucketSize),
      Math.floor(blue / colorBucketSize),
    ].join(':');
    const weight = (0.12 + vividness * 0.88) * (vividness < 0.06 ? 0.35 : 1);
    const bucket = buckets.get(key) ?? { redTotal: 0, greenTotal: 0, blueTotal: 0, weight: 0 };

    bucket.redTotal += red * weight;
    bucket.greenTotal += green * weight;
    bucket.blueTotal += blue * weight;
    bucket.weight += weight;
    buckets.set(key, bucket);
  }

  let dominantBucket: ColorBucket | undefined;
  for (const bucket of buckets.values()) {
    if (!dominantBucket || bucket.weight > dominantBucket.weight) dominantBucket = bucket;
  }
  if (!dominantBucket) return undefined;

  const red = Math.round(dominantBucket.redTotal / dominantBucket.weight);
  const green = Math.round(dominantBucket.greenTotal / dominantBucket.weight);
  const blue = Math.round(dominantBucket.blueTotal / dominantBucket.weight);
  return `rgb(${red} ${green} ${blue})`;
}

/**
 * 异步加载可供 Canvas（画布）绘制的封面图片。
 *
 * 事件监听在设置 `src` 前完成，以兼容浏览器从缓存中同步命中图片的场景。封面接口为
 * 同源地址，因此后续 `getImageData` 可以正常读取像素；网络或解码错误会交由上层回退。
 *
 * @param source 用于加载封面的同源图片地址。
 * @returns 已完成解码并可绘制的 HTMLImageElement（图片元素）。
 */
function loadArtworkImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法加载封面颜色样本'));
    image.src = source;
  });
}
