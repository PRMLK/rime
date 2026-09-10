import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * useProgressiveDisplay（渐进显示）只限制列表的可见项目数，不改变原始数据。
 *
 * 歌曲详情必须在一次请求中保留全部曲目，供“全部播放”等业务逻辑构建完整播放队列；
 * 此 Hook 仅把渲染工作分成固定大小的批次，用户下滑时逐批扩大显示范围。
 *
 * @template T 列表项目类型。
 * @param items 已完整加载的原始项目数组。
 * @param resetKey 列表身份，例如专辑或歌单 ID；变化时恢复到首批显示。
 * @param batchSize 单次新增的可见项目数量。
 * @returns 当前可见项目、是否还有未显示项目及展示下一批的回调。
 */
export function useProgressiveDisplay<T>(items: T[], resetKey: string, batchSize: number) {
  const [visibleCount, setVisibleCount] = useState(batchSize);

  useEffect(() => {
    setVisibleCount(batchSize);
  }, [batchSize, resetKey]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const showMore = useCallback(() => {
    setVisibleCount((count) => Math.min(count + batchSize, items.length));
  }, [batchSize, items.length]);

  return {
    visibleItems,
    visibleCount: visibleItems.length,
    hasMore: visibleItems.length < items.length,
    showMore,
  };
}

/**
 * appendItemsWithoutDuplicates（追加去重）将后续网络批次加入现有列表。
 *
 * 数据在滚动期间发生扫描或排序变化时，OFFSET（偏移量）游标可能返回已出现项目；按稳定
 * ID 去重可防止界面重复显示同一专辑或歌单，同时保持已展示项目和新项目各自的顺序。
 *
 * @template T 必须含有稳定字符串 ID 的项目类型。
 * @param currentItems 当前已显示项目。
 * @param nextItems 新加载项目。
 * @returns 去除重复后的合并列表。
 */
export function appendItemsWithoutDuplicates<T extends { id: string }>(currentItems: T[], nextItems: T[]): T[] {
  const knownIDs = new Set(currentItems.map((item) => item.id));
  const uniqueItems = nextItems.filter((item) => {
    if (knownIDs.has(item.id)) return false;
    knownIDs.add(item.id);
    return true;
  });
  return uniqueItems.length > 0 ? [...currentItems, ...uniqueItems] : currentItems;
}
