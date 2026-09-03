import type { Album } from '@/api/rime';
import { AlbumArtwork } from '@/components/AlbumArtwork';
import { VinylRecord } from '@/components/VinylRecord';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * 渲染专辑封面与黑胶唱片组成的装饰性视觉单元。
 *
 * 黑胶始终先于封面渲染，并固定在容器右侧的垂直中线；封面位于前景左侧，
 * 因此右侧会稳定露出 64px 唱片。`2026` 窄竖签固定在画布左缘，默认被封面遮住；
 * 当带有指针设备的用户将鼠标移入该视觉单元时，仅封面右移 16px 露出竖签，
 * 唱片则保持原位。组件内部不读取或推导专辑日期，避免产生额外的数据依赖。
 * 组件内部只负责这组元素的相对位置，调用方可通过 `className` 决定整个视觉单元
 * 在头图中的水平对齐方式，不会破坏内部层次。
 *
 * @param artwork 提供封面、中心标签和替代文本的专辑资料。
 * @param className 用于指定整个组合组件的外部位置；不应覆盖其固定尺寸或内部定位。
 * @returns 不参与无障碍朗读的专辑封面与黑胶组合元素。
 *
 * @example
 * <AlbumVinylArtwork artwork={album} className="mr-auto" />
 */
export function AlbumVinylArtwork({
  artwork,
  className,
}: {
  artwork: Pick<Album, 'artworkId' | 'title'>;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn('group/album-artwork relative h-40 w-56 max-w-full', className)}>
      {/*
        竖签以画布左缘为锚点而非封面左缘：静止时前景封面会完整覆盖它，
        悬停位移后才恰好露出 16px 宽度，避免页面初始状态出现难读的竖排文字。
      */}
      <Badge variant="secondary" className="absolute top-[20%] left-0 z-0 h-12 w-4 -scale-x-100 -scale-y-100 rounded-l-none rounded-r-sm px-0.5 py-1.5 text-[0.5625rem] leading-none [writing-mode:vertical-rl]">
        2026
      </Badge>
      {/*
        唱片固定在画布右侧，悬停时绝不参与位移。封面右移 16px 后，唱片右缘仍在
        同一坐标上，仅被封面多遮住 16px；这既保留了三者的原始尺寸，也避免唱片跟随
        封面横移造成整个视觉单元重心漂移。
      */}
      <VinylRecord artwork={artwork} className="absolute top-1/2 right-0 z-0 -translate-y-1/2" />
      {/*
        motion-safe（允许动效）仅控制过渡动画。无论用户是否选择减少动态效果，悬停状态
        都会移动到最终位置，确保便签展开的内容表达保持一致。
      */}
      <AlbumArtwork
        artwork={artwork}
        size="lg"
        className="relative z-10 shadow-sm group-hover/album-artwork:translate-x-4 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out"
      />
    </div>
  );
}
