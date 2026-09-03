import { useState, type ComponentProps } from 'react';
import { artworkUrl, type Album, type Track } from '@/api/rime';
import nowPlayingCover from '@/assets/now-playing.jpg';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** 可被专辑封面组件读取的最小资料集合。曲目会使用其所属专辑的封面。 */
type ArtworkSource = Pick<Album, 'artworkId' | 'title'> | Pick<Track, 'artworkId' | 'title'>;

/**
 * 专辑封面的统一视觉尺寸。
 *
 * `sm` 用于曲目列表和迷你播放器；`md` 用于唱片中心标签；
 * `lg` 用于专辑详情头图；`fluid` 填满响应式卡片宽度；`full` 填满已确定尺寸的播放器容器。
 */
export type AlbumArtworkSize = 'sm' | 'md' | 'lg' | 'fluid' | 'full';

/** 专辑封面可选的裁切形状。 */
type AlbumArtworkShape = 'square' | 'circle';

/**
 * 专辑封面圆角规范。
 *
 * 正方形封面以边长的 10% 作为主比例，并设定 8px 最小圆角：40px 的迷你封面
 * 若只按比例计算会得到难以辨识的 4px，因此以最小值维持与大封面一致的视觉曲率。
 * 唱片中心标签是例外，保持圆形。
 */
const albumArtworkCornerClassName = 'rounded-[clamp(0.5rem,10%,2rem)]';

/**
 * 为歌词与全尺寸封面提供相同的裁切轮廓。
 *
 * 完整播放器会在封面和歌词之间切换；由此容器统一裁切，切换时不会改变外轮廓。
 */
export function AlbumArtworkFrame({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="album-artwork-frame"
      className={cn('overflow-hidden', albumArtworkCornerClassName, className)}
      {...props}
    />
  );
}

/** 加载中的专辑封面占位，复用与真实封面相同的轮廓。 */
export function AlbumArtworkSkeleton({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn(albumArtworkCornerClassName, className)} {...props} />;
}

/**
 * 将显示尺寸与服务端图片分辨率集中管理。
 *
 * 这样调用方只表达所在界面的视觉规格，组件会请求足够清晰且不过度浪费带宽的图片。
 * 无论显示规格如何，正方形封面均由组件统一应用边长 10% 的圆角；`full` 在
 * 播放器中可配合 AlbumArtworkFrame 让歌词面板保持同一轮廓。
 */
const artworkSizeConfig: Record<AlbumArtworkSize, { imageSize: 128 | 256 | 512 | 1024; className: string }> = {
  sm: { imageSize: 128, className: 'size-10 shrink-0' },
  md: { imageSize: 128, className: 'size-14 shrink-0' },
  lg: { imageSize: 512, className: 'size-40 shrink-0' },
  fluid: { imageSize: 512, className: 'aspect-square w-full' },
  full: { imageSize: 1024, className: 'size-full' },
};

/**
 * 统一渲染专辑封面，并在远程图片不可用时显示本地默认封面。
 *
 * @param artwork 包含封面 ID 与标题的专辑或曲目资料；省略时显示默认封面。
 * @param size 封面的标准显示规格，同时控制请求的图片分辨率。
 * @param shape 封面裁切形状；唱片中心标签使用 `circle`，其余场景默认方形圆角。
 * @param className 仅用于补充定位、层级或阴影等上下文布局，不用于控制封面尺寸。
 * @returns 带有一致尺寸、替代文本与加载失败回退行为的专辑封面图片元素。
 *
 * @example
 * <AlbumArtwork artwork={album} size="lg" />
 * <AlbumArtwork artwork={track} size="md" shape="circle" />
 */
export function AlbumArtwork({
  artwork,
  size,
  shape = 'square',
  className,
}: {
  artwork?: ArtworkSource;
  size: AlbumArtworkSize;
  shape?: AlbumArtworkShape;
  className?: string;
}) {
  const config = artworkSizeConfig[size];
  const source = artworkUrl(artwork?.artworkId, config.imageSize);
  const [failedSource, setFailedSource] = useState<string>();

  return (
    <img
      className={cn(
        config.className,
        'bg-muted object-cover',
        shape === 'circle' ? 'rounded-full' : albumArtworkCornerClassName,
        className,
      )}
      src={source && source !== failedSource ? source : nowPlayingCover}
      alt={artwork ? `《${artwork.title}》专辑封面` : '默认专辑封面'}
      onError={() => source && setFailedSource(source)}
    />
  );
}
