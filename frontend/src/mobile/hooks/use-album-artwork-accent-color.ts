import { useEffect, useState } from 'react';
import { getArtworkAccentColor } from '@/mobile/lib/artwork-color';
import { useClientCacheScope } from '@/mobile/lib/client-cache-context';
import { subscribeArtworkSource } from '@/mobile/services/artwork-cache';

/**
 * 根据当前专辑封面异步取得页面背景需要的主色。
 *
 * 专辑切换时会先清空旧颜色；异步请求返回后再次确认组件仍处于当前请求范围内，
 * 防止较慢的旧请求覆盖新专辑或迷你播放器的背景颜色。
 *
 * @param artworkId - 当前专辑封面的唯一标识；没有封面时返回 `undefined`。
 * @returns 可用于 CSS 自定义属性的 `rgb()` 颜色字符串；提取失败时返回 `undefined`。
 */
export function useAlbumArtworkAccentColor(artworkId?: string) {
  const cacheScope = useClientCacheScope();
  const [accentColor, setAccentColor] = useState<string>();

  useEffect(() => {
    let isCurrent = true;
    setAccentColor(undefined);

    if (!artworkId) {
      return () => {
        isCurrent = false;
      };
    }

    const unsubscribe = subscribeArtworkSource(cacheScope, artworkId, 128, {
      onSource: (source) => {
        void getArtworkAccentColor(source).then((color) => {
          if (isCurrent) setAccentColor(color);
        });
      },
    });

    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, [artworkId, cacheScope]);

  return accentColor;
}
