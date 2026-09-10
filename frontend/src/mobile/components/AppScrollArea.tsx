import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type AppScrollAreaProps = ComponentPropsWithoutRef<typeof ScrollArea>;

/*
 * Base UI 会把轨道的 insetInlineEnd（行内结束侧偏移）以内联样式设为 0。
 * 该变量由全局内容框的右侧比例留白与安全区共同计算。正文允许使用完整视口宽度，
 * 因此不能在组件内另行引入固定最大宽度，否则宽屏会重新出现居中的窄列。
 */
const mobileScrollbarInset = 'var(--mobile-scrollbar-inset)';

/**
 * 应用页面使用的统一滚动区域。
 *
 * 使用 Base UI 的滚动状态与拖动行为，将竖向滑块悬浮在正文右侧留白，不占用内容宽度；
 * 水平轨道始终隐藏，避免窄屏页面出现横向滚动入口。
 *
 * @param props - `ScrollArea（滚动区域）` 的根容器属性与内容。
 * @param ref - 指向滚动区域根元素的引用，供歌词跟随等功能读取滚动位置。
 * @returns 带统一悬浮滚动条样式的应用滚动区域。
 */
export const AppScrollArea = forwardRef<HTMLDivElement, AppScrollAreaProps>(function AppScrollArea({
  className,
  scrollbarClassName,
  scrollbarStyle,
  thumbClassName,
  ...props
}, ref) {
  return (
    <ScrollArea
      ref={ref}
      className={cn('min-h-0 overflow-hidden', className)}
      scrollbarClassName={cn(
        'absolute inset-y-3 h-auto w-2 border-0 bg-transparent p-0.5',
        scrollbarClassName,
      )}
      // 轨道始终为绝对定位：滑块出现或隐藏均不会改变正文列宽。
      scrollbarStyle={{ width: 'var(--mobile-scrollbar-width)', ...scrollbarStyle, insetInlineEnd: mobileScrollbarInset }}
      thumbClassName={cn(
        'bg-muted-foreground/70 transition-colors hover:bg-foreground/70 active:bg-foreground/80',
        thumbClassName,
      )}
      {...props}
    />
  );
});
