import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"

import { cn } from "@/lib/utils"

/**
 * 为一组互斥或多选切换项提供共享状态与键盘导航。
 * @param props - Base UI ToggleGroup（分段选择组）的配置；通过 multiple 控制单选或多选。
 * @returns 带有项目默认布局与语义状态属性的切换组根节点。
 */
function ToggleGroup<Value extends string>({ className, ...props }: ToggleGroupPrimitive.Props<Value>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        "flex items-center gap-1 data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
        className
      )}
      {...props}
    />
  )
}

/**
 * 渲染 ToggleGroup（分段选择组）中的单个可选项。
 * @param props - Base UI Toggle（切换按钮）的值、禁用状态与内容。
 * @returns 可访问的按钮；被选中时使用语义化 secondary（次级）主题样式。
 */
function ToggleGroupItem<Value extends string>({ className, ...props }: TogglePrimitive.Props<Value>) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-transparent px-2.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-pressed:bg-secondary data-pressed:text-secondary-foreground hover:bg-muted hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
