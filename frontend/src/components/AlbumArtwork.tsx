import { useState } from 'react';
import { artworkUrl, type Album, type Track } from '@/api/rime';
import nowPlayingCover from '@/assets/now-playing.jpg';
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
 * 将显示尺寸与服务端图片分辨率集中管理。
 *
 * 这样调用方只表达所在界面的视觉规格，组件会请求足够清晰且不过度浪费带宽的图片。
 * `fluid` 作为 AlbumArtworkCard（专辑展示卡片）的唯一内容时，由卡片统一裁切四角；
 * `full` 则由播放器画布裁切，因此这两种规格不在图片元素上重复设置圆角。
 */
const artworkSizeConfig: Record<AlbumArtworkSize, { imageSize: 128 | 256 | 512 | 1024; className: string }> = {
  sm: { imageSize: 128, className: 'size-10 shrink-0 rounded-md' },
  md: { imageSize: 128, className: 'size-14 shrink-0 rounded-md' },
  lg: { imageSize: 512, className: 'size-40 shrink-0 rounded-md' },
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
        shape === 'circle' && 'rounded-full',
        className,
      )}
      src={source && source !== failedSource ? source : nowPlayingCover}
      alt={artwork ? `《${artwork.title}》专辑封面` : '默认专辑封面'}
      onError={() => source && setFailedSource(source)}
    />
  );
}
