import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type AppScrollAreaProps = ComponentPropsWithoutRef<typeof ScrollArea>;

/*
 * Base UI 会把轨道的 insetInlineEnd（行内结束侧偏移）以内联样式设为 0。
 * 因此必须通过同一内联属性覆盖，普通 right（右侧偏移）样式无法改变轨道位置。
 */
const mobileScrollbarInset = 'max(0rem, calc((100% - 36rem) / 2 - 1.25rem))';

/**
 * 应用页面使用的统一滚动区域。
 *
 * 使用 Base UI 的滚动状态与拖动行为，将竖向滑块悬浮在内容右侧；宽屏时对齐
 * `max-w-xl（最大宽度限制）` 内容区外侧的留白，不占用内容宽度；
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
      // 宽屏按 36rem 内容列右缘定位；窄屏贴近容器右边，并保留轨道自身的透明内边距。
      scrollbarStyle={{ ...scrollbarStyle, insetInlineEnd: mobileScrollbarInset }}
      thumbClassName={cn(
        'bg-muted-foreground/70 transition-colors hover:bg-foreground/70 active:bg-foreground/80',
        thumbClassName,
      )}
      {...props}
    />
  );
});
