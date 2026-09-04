import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "@/lib/utils"

type ScrollAreaProps = ScrollAreaPrimitive.Root.Props & {
  scrollbarClassName?: string
  scrollbarStyle?: React.CSSProperties
  thumbClassName?: string
}

type ScrollBarProps = ScrollAreaPrimitive.Scrollbar.Props & {
  thumbClassName?: string
}

/**
 * 渲染由 Base UI 管理滚动状态的滚动区域。
 *
 * @param props - 根容器属性；`scrollbarClassName`、`scrollbarStyle` 和
 * `thumbClassName` 分别定制滚动轨道的类名、内联样式与滑块，避免调用方依赖内部 DOM 结构覆盖样式。
 * @param ref - 指向滚动区域根元素的引用，可用于查询或管理滚动状态。
 * @returns 包含视口、竖向滚动条和转角元素的滚动区域。
 */
const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea({
  className,
  children,
  scrollbarClassName,
  scrollbarStyle,
  thumbClassName,
  ...props
}, ref) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar
        className={scrollbarClassName}
        style={scrollbarStyle}
        thumbClassName={thumbClassName}
      />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
})

/**
 * 渲染滚动区域的单一方向轨道与可拖动滑块。
 *
 * @param props - Base UI 滚动条属性；`thumbClassName` 用于定制滑块视觉样式。
 * @returns 与指定方向同步的滚动条元素。
 */
function ScrollBar({
  className,
  orientation = "vertical",
  thumbClassName,
  ...props
}: ScrollBarProps) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none transition-colors select-none",
        orientation === "horizontal"
          ? "h-2.5 flex-col border-t border-t-transparent p-px"
          : "h-full w-2.5 border-l border-l-transparent p-px",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn("relative flex-1 rounded-full bg-border", thumbClassName)}
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
