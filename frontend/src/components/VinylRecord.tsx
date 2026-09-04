import type { Album } from '@/api/rime';
import { AlbumArtwork } from '@/components/AlbumArtwork';
import { cn } from '@/lib/utils';

/** 黑胶唱片的尺寸策略。 */
type VinylRecordSize = 'fixed' | 'fluid';

/**
 * 渲染专辑详情头图中位于封面后方的黑胶唱片。
 *
 * 组件集中管理唱片直径、内圈和中心标签的比例。中心标签复用同一张专辑封面，
 * 避免调用方手动组合多个元素时出现尺寸或裁切不一致。
 *
 * @param artwork 提供中心标签图片与替代文本的专辑资料。
 * @param size 控制唱片及其内圈、中心封面的尺寸策略；`fluid` 会以专辑组合画布的宽度连续缩放。
 * @param className 用于指定唱片在外部画布中的位置或层级，不应覆盖唱片尺寸与圆形样式。
 * @returns 不参与无障碍朗读的装饰性黑胶唱片元素。
 *
 * @example
 * <VinylRecord artwork={album} className="absolute top-1/2 right-0 -translate-y-1/2" />
 */
export function VinylRecord({
  artwork,
  size = 'fixed',
  className,
}: {
  artwork: Pick<Album, 'artworkId' | 'title'>;
  size?: VinylRecordSize;
  className?: string;
}) {
  const isFluid = size === 'fluid';

  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-full bg-primary',
        isFluid ? 'size-[57.143cqw]' : 'size-32',
        className,
      )}
    >
      {/* 外圈纹路用半透明边框表达唱片的压纹质感。 */}
      <div
        className={cn(
          'absolute rounded-full border border-primary-foreground/20',
          isFluid ? 'inset-[5.357cqw] border-[0.447cqw]' : 'inset-3',
        )}
      />
      {/*
       * 中间细环位于外圈与中心封标之间。流式模式以画布宽度的 8.036% 作为内缩，
       * 因而与唱片直径保持固定比例；使用 primary-foreground（主色前景）可在深浅
       * 主题中始终呈现为克制的白色细线，而不引入固定色值。
       */}
      <div
        className={cn(
          'absolute rounded-full border border-primary-foreground/20',
          isFluid ? 'inset-[8.036cqw] border-[0.447cqw]' : 'inset-[18px]',
        )}
      />
      <AlbumArtwork
        artwork={artwork}
        size="md"
        shape="circle"
        className={cn(
          'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-primary-foreground/20',
          /*
           * 流式模式使用唱片画布宽度的 37.5% 作为中心封标直径；外圈纹路与中心
           * 封标因此会和唱片本体共同缩放，不会在左列宽度变化后显得过大或过小。
           */
          isFluid ? 'size-[37.5cqw] border-[0.447cqw]' : 'size-[84px]',
        )}
      />
    </div>
  );
}
