import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** 项目的本地手写签章标识，包含字体与倾斜视觉规范。 */
export function RimeLogo({ className, ...props }: Omit<ComponentProps<'span'>, 'children'>) {
  return (
    <span
      data-slot="rime-logo"
      role="img"
      aria-label="Rime"
      className={cn('rime-logo', className)}
      {...props}
    >
      Rime
    </span>
  );
}
