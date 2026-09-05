import { useCallback, useEffect, useState } from 'react';

/** 移动端主导航可直接显示的页面标识。 */
export type MobileTab = 'home' | 'search' | 'library';

/**
 * MobileRoute（移动端路由）描述能够由 URL 完整恢复的页面状态。
 *
 * 搜索游标只属于当前搜索结果；详情页的来源标签用于在用户点击页头返回时提供
 * 合理的兜底目的地。Hash（哈希）路由不依赖服务器重写规则，因此可以同时运行在
 * /mobile.html 独立入口和 Viewbox 的 iframe（内嵌预览页）中。
 */
export type MobileRoute =
  | { kind: 'tab'; tab: MobileTab }
  | { kind: 'search'; query: string; cursor?: string }
  | { kind: 'recent-albums'; cursor?: string }
  | { kind: 'album'; albumId: string; sourceTab: MobileTab }
  | { kind: 'artist'; artistId: string; sourceTab: MobileTab };

/**
 * 从 location.hash（地址哈希）读取当前移动端页面。
 *
 * 解析时始终回退到首页，避免手工输入错误链接后使应用进入不可恢复状态。cursor
 * 是服务端定义的透明字符串，不能在客户端解码或修改，只负责原样往返 URL。
 *
 * @param hash 浏览器当前的 hash 字符串，包含或不包含开头的 # 都可。
 * @returns 已校验的移动端路由状态。
 */
export function parseMobileRoute(hash: string): MobileRoute {
  const source = hash.startsWith('#') ? hash.slice(1) : hash;
  const [rawPath, rawQuery = ''] = source.split('?', 2);
  const path = rawPath || '/home';
  const parameters = new URLSearchParams(rawQuery);
  const sourceTab = parseTab(parameters.get('from'));

  if (path === '/search') {
    const cursor = parameters.get('cursor') || undefined;
    return { kind: 'search', query: parameters.get('q') ?? '', cursor };
  }
  if (path === '/albums/recent') return { kind: 'recent-albums', cursor: parameters.get('cursor') || undefined };

  const albumMatch = /^\/albums\/([^/]+)$/.exec(path);
  if (albumMatch) return { kind: 'album', albumId: decodeRouteID(albumMatch[1]), sourceTab };

  const artistMatch = /^\/artists\/([^/]+)$/.exec(path);
  if (artistMatch) return { kind: 'artist', artistId: decodeRouteID(artistMatch[1]), sourceTab };

  if (path === '/library') return { kind: 'tab', tab: 'library' };
  return { kind: 'tab', tab: 'home' };
}

/**
 * 将路由状态转换为稳定、可分享的 hash 字符串。
 *
 * @param route 需要写入浏览器地址栏的路由状态。
 * @returns 以 # 开头的 URL 哈希片段。
 */
export function formatMobileRoute(route: MobileRoute): string {
  switch (route.kind) {
    case 'tab':
      return `#/${route.tab}`;
    case 'search': {
      const parameters = new URLSearchParams();
      if (route.query) parameters.set('q', route.query);
      if (route.cursor) parameters.set('cursor', route.cursor);
      const query = parameters.toString();
      return `#/search${query ? `?${query}` : ''}`;
    }
    case 'recent-albums': {
      const parameters = new URLSearchParams();
      if (route.cursor) parameters.set('cursor', route.cursor);
      const query = parameters.toString();
      return `#/albums/recent${query ? `?${query}` : ''}`;
    }
    case 'album':
      return `#/albums/${encodeURIComponent(route.albumId)}?from=${route.sourceTab}`;
    case 'artist':
      return `#/artists/${encodeURIComponent(route.artistId)}?from=${route.sourceTab}`;
  }
}

/**
 * useMobileRoute（移动端路由 Hook）将哈希地址与 React 状态保持同步。
 *
 * 输入搜索词时调用者可传入 replace，避免每一次键入都占用浏览器历史；用户点击
 * 分页、底部导航或详情入口时保留历史记录，浏览器的前进/后退按钮即可正常工作。
 *
 * @returns 当前路由和用于跳转/替换路由的回调。
 */
export function useMobileRoute(): [MobileRoute, (route: MobileRoute, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<MobileRoute>(() => parseMobileRoute(window.location.hash));

  useEffect(() => {
    /** 地址由浏览器前进后退改变时，重新解析并更新界面。 */
    const syncRoute = () => setRoute(parseMobileRoute(window.location.hash));
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  const navigate = useCallback((nextRoute: MobileRoute, options?: { replace?: boolean }) => {
    const nextHash = formatMobileRoute(nextRoute);
    if (nextHash === window.location.hash) return;

    if (options?.replace) {
      // history.replaceState 不会触发 hashchange，因此同步更新 React 状态。
      window.history.replaceState({ rimeMobileRoute: true }, '', nextHash);
      setRoute(nextRoute);
      return;
    }

    window.location.hash = nextHash;
  }, []);

  return [route, navigate];
}

/**
 * 从详情路径读取已编码的 ID，并将错误编码安全地视为无效 ID。
 * @param value 路径中未经解码的 ID 片段。
 * @returns 解码后的 ID，或空字符串。
 */
function decodeRouteID(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

/**
 * 将外部传入的来源标签限制为合法主导航，避免错误 URL 改变详情返回目标。
 * @param value URL 查询参数中的来源标签。
 * @returns 合法标签；不合法时回退首页。
 */
function parseTab(value: string | null): MobileTab {
  return value === 'search' || value === 'library' || value === 'home' ? value : 'home';
}
