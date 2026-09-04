import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * 渲染项目本地手写签章 RimeLogo（Rime 标识），统一使用品牌字体与倾斜视觉规范。
 * 标识不是可复制正文，默认禁止文本选中，避免浏览器为旋转后的选区定位时横向滚动页面。
 *
 * @param props - 原生 span（行内容器）属性；可通过 className（样式类名）补充布局。
 * @returns 带无障碍名称、不可选中的 Rime 品牌标识元素。
 */
export function RimeLogo({ className, ...props }: Omit<ComponentProps<'span'>, 'children'>) {
  return (
    <span
      data-slot="rime-logo"
      role="img"
      aria-label="Rime"
      className={cn('rime-logo select-none', className)}
      {...props}
    >
      Rime
    </span>
  );
}
