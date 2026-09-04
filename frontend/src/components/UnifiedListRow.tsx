import type { ComponentProps } from 'react';
import { RimeLogo } from '@/components/RimeLogo';
import { Item } from '@/components/ui/item';
import { cn } from '@/lib/utils';

type UnifiedListRowProps = ComponentProps<typeof Item> & {
  active?: boolean;
  separated?: boolean;
};

/**
 * 应用内列表行的统一交互表面。
 *
 * 行本体向两侧延展至内容框的外缘，文本和操作区则始终对齐比例内容轨。hover 与
 * active 状态使用内容下方的半透明遮罩，因此不会影响文字和图标的可读性。
 *
 * @param props - `Item（项目）` 的全部属性，以及 `active（激活状态）` 与
 * `separated（分隔线）` 两个列表行专用属性。
 * @returns 带统一状态层和可选底部分隔线的 `Item（项目）` 元素。
 */
export function UnifiedListRow({
  active = false,
  separated = false,
  size = 'xs',
  variant = 'default',
  className,
  ...props
}: UnifiedListRowProps) {
  return (
    <Item
      size={size}
      variant={variant}
      data-unified-list-row=""
      data-active={active ? '' : undefined}
      className={cn(
        /*
         * 内容框的两侧可能因安全区而不同，不能使用 -mx-* 这样的对称固定值。
         * 行背景扩展到内容框外缘，内部再补回同一对留白，使可点击面和文字基线
         * 同时保持稳定。
         */
        'relative isolate [margin-inline-start:calc(0px_-_var(--mobile-content-gutter-start))] [margin-inline-end:calc(0px_-_var(--mobile-content-gutter-end))] [width:calc(100%_+_var(--mobile-content-gutter-start)_+_var(--mobile-content-gutter-end))] ps-[var(--mobile-content-gutter-start)] pe-[var(--mobile-content-gutter-end)] rounded-none border-0 bg-transparent',
        'before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-muted/45 before:opacity-0',
        'before:transition-opacity before:duration-150 before:ease-out hover:bg-transparent hover:before:opacity-100',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:before:transition-none',
        active && 'before:bg-muted/70 before:opacity-100',
        separated && 'border-b last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 渲染列表末尾的只读品牌尾签，用于标识列表内容已经结束。
 *
 * @param props - `className（样式类名）` 可用于将尾签放入特定网格位置。
 * @returns 不参与鼠标和键盘交互的 Rime 标志元素。
 */
export function UnifiedListFooterLogo({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('pointer-events-none flex select-none justify-center pt-3 pb-1 text-muted-foreground/60', className)}>
      <RimeLogo className="text-[0.625rem]" />
    </div>
  );
}
