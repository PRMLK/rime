import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * 渲染 shadcn/Base UI 的二元开关控件。
 *
 * @param props - Base UI Switch（开关）的受控状态、变更回调、禁用状态及辅助功能属性。
 * @returns 带有项目主题令牌、键盘焦点和已选状态样式的开关根节点。
 */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input p-0.5 transition-colors outline-none data-checked:bg-primary data-unchecked:bg-input focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-4 rounded-full bg-background shadow-xs transition-transform data-checked:translate-x-4 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
