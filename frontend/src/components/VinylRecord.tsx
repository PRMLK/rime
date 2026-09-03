import type { Album } from '@/api/rime';
import { AlbumArtwork } from '@/components/AlbumArtwork';
import { cn } from '@/lib/utils';

/**
 * 渲染专辑详情头图中位于封面后方的黑胶唱片。
 *
 * 组件集中管理唱片直径、内圈和中心标签的比例。中心标签复用同一张专辑封面，
 * 避免调用方手动组合多个元素时出现尺寸或裁切不一致。
 *
 * @param artwork 提供中心标签图片与替代文本的专辑资料。
 * @param className 用于指定唱片在外部画布中的位置或层级，不应覆盖唱片尺寸与圆形样式。
 * @returns 不参与无障碍朗读的装饰性黑胶唱片元素。
 *
 * @example
 * <VinylRecord artwork={album} className="absolute top-1/2 right-0 -translate-y-1/2" />
 */
export function VinylRecord({
  artwork,
  className,
}: {
  artwork: Pick<Album, 'artworkId' | 'title'>;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn('size-32 rounded-full bg-primary', className)}
    >
      {/* 内圈用半透明边框表达唱片纹路，中心标签维持唱片与封面的视觉关联。 */}
      <div className="absolute inset-3 rounded-full border border-primary-foreground/20" />
      <AlbumArtwork
        artwork={artwork}
        size="md"
        shape="circle"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-primary-foreground/20"
      />
    </div>
  );
}
