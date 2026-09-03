import type { ComponentProps } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type AlbumArtworkCardOverflow = 'clip' | 'visible';

/**
 * 渲染承载专辑详情头图内容的统一圆角卡片。
 *
 * 基于 shadcn Card（卡片）组合，而不是修改通用 Card 的默认样式，避免影响
 * 设置页或其他非专辑内容。它只定义详情头图的容器轮廓；正方形专辑封面的圆角
 * 始终由 AlbumArtwork 组件按边长比例统一处理。专辑详情头图可显式允许唱片与
 * 封面跨出卡片边界，以建立与下方标题区分层的视觉关系。
 *
 * @param artworkOverflow 控制专辑视觉元素是否可跨出卡片边界；详情头图使用 `visible`，其余场景保持 `clip`。
 * @param className 仅补充布局、间距或语义化表面样式；不应传入圆角或溢出相关类名。
 * @param props 其余 shadcn Card 属性，包括 `size`、`children` 和原生 div 属性。
 * @returns 使用统一圆角规则的专辑展示卡片。
 *
 * @example
 * <AlbumArtworkCard size="xs" className="w-full gap-0 py-0 ring-0">
 *   <AlbumArtwork artwork={album} size="fluid" />
 * </AlbumArtworkCard>
 */
export function AlbumArtworkCard({
  artworkOverflow = 'clip',
  className,
  ...props
}: ComponentProps<typeof Card> & { artworkOverflow?: AlbumArtworkCardOverflow }) {
  return (
    <Card
      data-slot="album-artwork-card"
      className={cn(
        'rounded-lg',
        artworkOverflow === 'visible' ? 'overflow-visible' : 'overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}
