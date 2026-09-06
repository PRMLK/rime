import { useCallback, useEffect, useRef, useState } from 'react';
import { appendItemsWithoutDuplicates } from '@/hooks/use-progressive-display';

/** 单个游标批次的通用响应形状。 */
type CursorPage<T> = {
  items: T[];
  nextCursor?: string;
};

/** useInfiniteCursorList（无限游标列表）所需的请求配置。 */
type InfiniteCursorListOptions<T extends { id: string }> = {
  /** 是否应加载列表；搜索视图离开时为 false，但可按需要保留已加载项目作为播放队列。 */
  enabled: boolean;
  /** 搜索词等会使整个数据集失效的稳定标识。变化后必须从第一批重新加载。 */
  resetKey: string;
  /** 首次请求前的延迟毫秒数；搜索输入使用延迟避免每次按键都请求。 */
  delayMs?: number;
  /** 禁用时是否保留项目；搜索离开页面后需要保留，避免中断当前播放队列。 */
  preserveItemsWhenDisabled?: boolean;
  /** 接收可选续页游标和中止信号，返回一批项目及下一批游标。 */
  loadPage: (cursor: string | undefined, signal: AbortSignal) => Promise<CursorPage<T>>;
};

/**
 * useInfiniteCursorList（无限游标列表）把按游标请求的 API 转换成“首次替换、后续追加”的状态。
 *
 * 每次 resetKey（重置键）变化都递增请求代次并中止未完成请求。这样输入新搜索词或离开
 * 页面后，即使旧请求较晚返回，也无法覆盖新列表。续页阶段另有同步加载锁，防止观察器
 * 在同一可见区域内多次回调时重复请求同一个游标。
 *
 * @template T - 项目类型，必须提供稳定的字符串 ID。
 * @param options - 控制启用状态、重置条件和批次加载函数的配置。
 * @returns 已累计项目、首次与续页加载状态、错误信息和加载下一批的回调。
 */
export function useInfiniteCursorList<T extends { id: string }>({
  enabled,
  resetKey,
  delayMs = 0,
  preserveItemsWhenDisabled = false,
  loadPage,
}: InfiniteCursorListOptions<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [isInitialLoading, setIsInitialLoading] = useState(enabled);
  const [initialError, setInitialError] = useState<string>();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string>();
  const requestGenerationRef = useRef(0);
  const loadedResetKeyRef = useRef<string | undefined>(undefined);
  const moreControllerRef = useRef<AbortController | undefined>(undefined);
  const isLoadingMoreRef = useRef(false);

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    moreControllerRef.current?.abort();
    moreControllerRef.current = undefined;
    isLoadingMoreRef.current = false;
    loadedResetKeyRef.current = undefined;
    setNextCursor(undefined);
    setInitialError(undefined);
    setLoadMoreError(undefined);
    setIsLoadingMore(false);

    if (!enabled) {
      setIsInitialLoading(false);
      if (!preserveItemsWhenDisabled) setItems([]);
      return undefined;
    }

    const controller = new AbortController();
    let timer: number | undefined;
    setItems([]);
    setIsInitialLoading(true);

    const loadInitialPage = () => {
      void loadPage(undefined, controller.signal)
        .then((page) => {
          if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
          setItems(page.items);
          setNextCursor(page.nextCursor);
          loadedResetKeyRef.current = resetKey;
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
          setInitialError(error instanceof Error ? error.message : '列表加载失败');
        })
        .finally(() => {
          if (!controller.signal.aborted && requestGenerationRef.current === generation) setIsInitialLoading(false);
        });
    };

    if (delayMs > 0) timer = window.setTimeout(loadInitialPage, delayMs);
    else loadInitialPage();

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      controller.abort();
    };
  }, [delayMs, enabled, loadPage, preserveItemsWhenDisabled, resetKey]);

  const loadMore = useCallback(() => {
    /*
     * loadedResetKeyRef（已加载重置键）确保搜索词刚变化、但 React 尚未执行重置 effect
     * 的短暂窗口内，旧列表尾部观察器不会将旧游标错误带入新搜索。
     */
    if (!enabled || !nextCursor || isInitialLoading || isLoadingMoreRef.current || loadedResetKeyRef.current !== resetKey) return;

    const generation = requestGenerationRef.current;
    const controller = new AbortController();
    moreControllerRef.current?.abort();
    moreControllerRef.current = controller;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(undefined);

    void loadPage(nextCursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted || requestGenerationRef.current !== generation || loadedResetKeyRef.current !== resetKey) return;
        setItems((currentItems) => appendItemsWithoutDuplicates(currentItems, page.items));
        setNextCursor(page.nextCursor);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestGenerationRef.current !== generation || loadedResetKeyRef.current !== resetKey) return;
        setLoadMoreError(error instanceof Error ? error.message : '加载更多失败');
      })
      .finally(() => {
        if (controller.signal.aborted || requestGenerationRef.current !== generation || loadedResetKeyRef.current !== resetKey) return;
        if (moreControllerRef.current === controller) moreControllerRef.current = undefined;
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  }, [enabled, isInitialLoading, loadPage, nextCursor, resetKey]);

  return {
    items,
    isInitialLoading,
    initialError,
    hasMore: Boolean(nextCursor),
    isLoadingMore,
    loadMoreError,
    loadMore,
  };
}
