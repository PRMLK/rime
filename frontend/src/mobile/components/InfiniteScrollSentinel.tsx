import { LoaderCircle, RotateCw } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';
import { Button } from '@/components/ui/button';

/**
 * InfiniteScrollSentinel（无限滚动哨兵）在列表末尾接近内部滚动视口时触发下一批加载。
 *
 * 应用正文由 AppScrollArea（应用滚动区域）而非浏览器窗口滚动，因此观察器根节点必须
 * 指向最近的 scroll-area-viewport（滚动区域视口）。320px 的预加载距离使请求在用户
 * 到达末尾之前开始；网络请求失败时自动观察暂停，只保留明确的重试命令避免循环请求。
 *
 * @param hasMore 是否仍存在可加载项目。
 * @param isLoading 是否正在加载后续项目。
 * @param error 后续加载错误；提供时停止自动观察。
 * @param observationKey 每次追加或展示更多项目后变化的标识，用于重新测量哨兵位置。
 * @param onLoadMore 请求或展示下一批项目的回调。
 * @returns 列表尾部的观察目标及加载、重试反馈。
 */
export function InfiniteScrollSentinel({
  hasMore,
  isLoading,
  error,
  observationKey,
  onLoadMore,
}: {
  hasMore: boolean;
  isLoading: boolean;
  error?: string;
  observationKey?: number | string;
  onLoadMore: () => void;
}) {
  const sentinelRef = useInfiniteScrollTrigger({
    enabled: hasMore && !error,
    isLoading,
    observationKey,
    onIntersect: onLoadMore,
  });

  if (!hasMore && !error) return null;

  return (
    <div
      ref={sentinelRef}
      className="flex min-h-12 items-center justify-center"
      role={isLoading ? 'status' : undefined}
      aria-live="polite"
    >
      {isLoading && (
        <>
          <LoaderCircle className="animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">正在加载更多</span>
        </>
      )}
      {error && (
        <Button variant="outline" size="sm" onClick={onLoadMore}>
          <RotateCw data-icon="inline-start" aria-hidden="true" />
          重试加载
        </Button>
      )}
    </div>
  );
}

/**
 * useInfiniteScrollTrigger（无限滚动触发器）为列表末尾建立交叉观察。
 *
 * @param options.enabled 是否允许观察；加载中或加载失败时关闭。
 * @param options.isLoading 是否正在加载；状态变化后重新观察当前位置。
 * @param options.observationKey 项目数量变化时重新观察，支持本地显示分段。
 * @param options.onIntersect 哨兵进入预加载范围时调用的回调。
 * @returns 应挂载到列表尾部元素的 ref。
 */
function useInfiniteScrollTrigger({
  enabled,
  isLoading,
  observationKey,
  onIntersect,
}: {
  enabled: boolean;
  isLoading: boolean;
  observationKey?: number | string;
  onIntersect: () => void;
}): RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onIntersectRef = useRef(onIntersect);

  useEffect(() => {
    onIntersectRef.current = onIntersect;
  }, [onIntersect]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!enabled || isLoading || !sentinel) return undefined;

    const viewport = sentinel.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onIntersectRef.current();
    }, {
      root: viewport,
      rootMargin: '0px 0px 320px',
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, isLoading, observationKey]);

  return sentinelRef;
}
