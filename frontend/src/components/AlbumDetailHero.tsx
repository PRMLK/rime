import type { AlbumDetail, ArtistRef } from '@/api/rime';
import { Ellipsis, Heart, Play, type LucideIcon } from 'lucide-react';
import { AlbumArtworkSkeleton } from '@/components/AlbumArtwork';
import { AlbumVinylArtwork } from '@/components/AlbumVinylArtwork';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type AlbumDetailHeroAlbum = Pick<AlbumDetail, 'artworkId' | 'artists' | 'title' | 'tracks'>;

/*
 * `cqh（容器查询高度）` 读取最近的 `.mobile-content-scroll` 尺寸容器，它恰好是
 * 顶栏与底部播放器之间的剩余高度。因此组件高度严格占用这段区域的 30%，不再
 * 额外引入固定最小值或最大值。横向网格按左侧视觉区 60%、中间留白 5%、右侧
 * 信息区 35% 分配，确保封面与文字之间始终存在可感知的呼吸空间。
 */
const albumDetailHeroClassName = '@container/album-detail-hero grid h-[30cqh] grid-cols-[60%_5%_35%]';

/**
 * 渲染专辑详情顶部的封面与信息区域。
 *
 * 组件默认占用顶栏、底部播放器之外的可滚动内容高度的 30%，横向依次为 60% 的
 * 封面黑胶区、5% 的固定留白和 35% 的信息区。右侧使用左对齐的标题、歌手与操作
 * 区域，保持信息阅读顺序明确。该组件保持在普通文档流中，不使用固定或粘性定位，
 * 因此会随着曲目列表一起滚动。
 *
 * @param props - 专辑头图所需的资料和打开歌手页的回调。
 * @param props.album - 用于封面、标题、歌手与播放操作的专辑详情最小资料。
 * @param props.onOpenArtist - 用户选择歌手文字后打开对应歌手详情的回调。
 * @param props.onPlayAll - 用户选择全部播放后，以当前专辑全部曲目建立播放队列的回调。
 * @returns 高度随可滚动内容区响应、横向按 60/5/35 分配的专辑详情头图。
 *
 * @example
 * <AlbumDetailHero album={detail} onOpenArtist={openArtist} onPlayAll={playAlbumTracks} />
 */
export function AlbumDetailHero({
  album,
  onOpenArtist,
  onPlayAll,
}: {
  album: AlbumDetailHeroAlbum;
  onOpenArtist: (artistId: string) => void;
  onPlayAll: (tracks: AlbumDetail['tracks']) => void;
}) {
  return (
    <section className={albumDetailHeroClassName} aria-labelledby="album-title">
      <div className="flex min-w-0 items-center justify-start">
        <AlbumVinylArtwork artwork={album} size="fluid" />
      </div>
      {/* 第二列由网格留白承担；信息区从第三列开始，防止缩放时挤压左右内容。 */}
      <div className="col-start-3 flex min-w-0 flex-col items-start justify-center gap-[1.389cqw] text-left">
        <h2 id="album-title" className="line-clamp-2 w-full text-[5.556cqw] leading-[6.944cqw] font-semibold">{album.title}</h2>
        <AlbumDetailHeroArtistLinks artists={album.artists} onOpenArtist={onOpenArtist} />
        <div className="mt-[1.389cqw] flex min-w-0 items-center gap-[1.389cqw]">
          <Button
            size="icon"
            className="size-[9.722cqw]"
            aria-label="全部播放"
            disabled={album.tracks.length === 0}
            onClick={() => onPlayAll(album.tracks)}
          >
            <Play data-icon="inline-start" aria-hidden="true" />
          </Button>
          <AlbumDetailHeroUnavailableAction icon={Heart} label="收藏专辑" />
          <AlbumDetailHeroUnavailableAction icon={Ellipsis} label="更多操作" />
        </div>
      </div>
    </section>
  );
}

/**
 * 渲染专辑详情头图的加载骨架。
 *
 * 骨架与 `AlbumDetailHero（专辑详情头图）` 共用完全相同的高度、两列比例与内部
 * 封面占位尺寸，网络请求完成后不会使曲目标题或列表产生垂直跳动。
 *
 * @returns 用于专辑详情加载状态的等宽双列头图骨架。
 */
export function AlbumDetailHeroSkeleton() {
  return (
    <section className={albumDetailHeroClassName} aria-label="正在加载专辑" role="status">
      <div className="flex min-w-0 items-center justify-start">
        <div className="@container/album-artwork-skeleton relative aspect-[7/5] w-full max-w-full" aria-hidden="true">
          <Skeleton className="absolute top-1/2 right-0 size-[57.143cqw] -translate-y-1/2 rounded-full" />
          <AlbumArtworkSkeleton className="relative size-[71.429cqw]" />
        </div>
      </div>
      <div className="col-start-3 flex min-w-0 flex-col items-start justify-center gap-[1.389cqw]" aria-hidden="true">
        <Skeleton className="h-[5.556cqw] w-4/5" />
        <Skeleton className="h-[2.778cqw] w-2/5" />
        <div className="mt-[1.389cqw] flex items-center gap-[1.389cqw]">
          <Skeleton className="size-[9.722cqw] rounded-lg" />
          <Skeleton className="size-[9.722cqw] rounded-full" />
          <Skeleton className="size-[9.722cqw] rounded-full" />
        </div>
      </div>
    </section>
  );
}

/**
 * 渲染头图中的歌手文本链接。
 *
 * @param props - 歌手列表与打开歌手详情的回调。
 * @param props.artists - 专辑关联的歌手资料；为空时显示只读的未知歌手文本。
 * @param props.onOpenArtist - 点击任一歌手后的页面跳转回调。
 * @returns 左对齐、随头图容器宽度缩放的歌手链接列表。
 */
function AlbumDetailHeroArtistLinks({
  artists,
  onOpenArtist,
}: {
  artists: ArtistRef[];
  onOpenArtist: (artistId: string) => void;
}) {
  const textClassName = 'text-[2.431cqw] leading-[3.472cqw]';
  const layoutClassName = 'mt-[1.389cqw] gap-x-[0.694cqw] gap-y-[0.694cqw]';

  if (artists.length === 0) return <p className={cn(layoutClassName, textClassName, 'text-muted-foreground')}>未知歌手</p>;
  return (
    <div className={cn('flex flex-wrap items-center justify-start', layoutClassName)}>
      {artists.map((artist, index) => (
        <span key={artist.id} className="flex items-center gap-[0.694cqw]">
          {index > 0 && <span className={cn(textClassName, 'text-muted-foreground')}>/</span>}
          <Button variant="ghost" className={cn('h-auto p-0', textClassName)} onClick={() => onOpenArtist(artist.id)}>
            {artist.name}
          </Button>
        </span>
      ))}
    </div>
  );
}

/**
 * 渲染当前版本尚未接入服务端能力的专辑操作。
 *
 * 收藏与更多操作的图形控件保留在信息区，令布局与目标设计一致；但由于后端当前不支持
 * 专辑级收藏和更多操作，点击不会产生副作用。按钮仍保持可点击和完整亮度，避免禁用态
 * 破坏操作行的视觉层级；不可用原因只记录在此注释中，不向用户显示额外提示气泡。
 *
 * @param props - 图标与操作名称。
 * @param props.icon - 用于该不可用操作的 Lucide 图标组件。
 * @param props.label - 面向辅助技术的操作名称。
 * @returns 可点击但当前不产生副作用的圆形图标按钮。
 */
function AlbumDetailHeroUnavailableAction({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Button variant="outline" size="icon" className="size-[9.722cqw] rounded-full" aria-label={label} onClick={handleReservedAlbumAction}>
      <Icon data-icon="inline-start" aria-hidden="true" />
    </Button>
  );
}

/**
 * 接收尚未接入业务能力的专辑操作点击。
 *
 * 用户当前需要这些按钮保持可点击的外观和交互反馈，但收藏与更多操作尚无可调用的
 * 接口，因此此处故意不修改状态、不发送请求。后续接入对应能力时，应在此函数中
 * 调用明确的领域操作，而不是在视图组件内分散处理。
 *
 * @returns 无返回值，也不产生任何副作用。
 */
function handleReservedAlbumAction(): void {
  return;
}
