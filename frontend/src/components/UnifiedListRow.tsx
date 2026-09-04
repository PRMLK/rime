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
 * 行本体向两侧延展至页面内容边缘，内容仍由调用方的内边距对齐。hover 与 active
 * 状态使用内容下方的半透明遮罩，因此不会影响文字和图标的可读性。
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
        'relative isolate -mx-5 w-[calc(100%+2.5rem)] rounded-none border-0 bg-transparent',
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

/** 可选的列表尾部签章，仅作装饰，不参与鼠标或键盘交互。 */
export function UnifiedListFooterLogo({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('pointer-events-none flex select-none justify-center pt-3 pb-1 text-muted-foreground/60', className)}>
      <RimeLogo className="text-[0.625rem]" />
    </div>
  );
}
