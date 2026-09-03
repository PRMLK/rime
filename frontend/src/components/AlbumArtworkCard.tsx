import type { ComponentProps } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * 渲染承载专辑内容的统一圆角卡片。
 *
 * 基于 shadcn Card（卡片）组合，而不是修改通用 Card 的默认样式，避免影响
 * 设置页或其他非专辑内容。组件固定使用 8px 圆角和溢出裁切，使封面图片、
 * 文本及专辑详情中的唱片装饰始终共享同一个可见边界。列表场景只将封面放入本组件，
 * 使封面的四个角都遵循相同规则，标题与歌手资料则显示在卡片外。
 *
 * @param className 仅补充布局、间距或语义化表面样式；不应传入圆角或溢出相关类名。
 * @param props 其余 shadcn Card 属性，包括 `size`、`children` 和原生 div 属性。
 * @returns 使用统一圆角规则的专辑展示卡片。
 *
 * @example
 * <AlbumArtworkCard size="xs" className="w-full gap-0 py-0 ring-0">
 *   <AlbumArtwork artwork={album} size="fluid" />
 * </AlbumArtworkCard>
 */
export function AlbumArtworkCard({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card data-slot="album-artwork-card" className={cn('overflow-hidden rounded-lg', className)} {...props} />;
}
