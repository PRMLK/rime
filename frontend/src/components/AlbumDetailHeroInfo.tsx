import type { AlbumDetail, ArtistRef } from '@/api/rime';
import { Ellipsis, Heart, Play, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type AlbumDetailHeroInfoAlbum = Pick<AlbumDetail, 'artists' | 'title' | 'tracks'>;

/**
 * 渲染专辑详情顶部右侧的名称与操作区域。
 *
 * 父级 `AlbumDetailHero（专辑详情头图）` 负责计算可用画布尺寸，本组件只以父级
 * 容器查询宽度作为缩放基准。因此标题、歌手和按钮会随整个头图等比缩放，同时保持
 * 它们原有的相对大小、顺序和左对齐方式。
 *
 * @param props - 名称区域所需的专辑资料与交互回调。
 * @param props.album - 提供标题、歌手与全部播放曲目列表的最小专辑资料。
 * @param props.onOpenArtist - 用户点击歌手文字后打开对应歌手详情的回调。
 * @param props.onPlayAll - 用户点击播放按钮后，以全部曲目建立播放队列的回调。
 * @returns 位于头图第三列、可随父级画布等比缩放的专辑名称区域。
 *
 * @example
 * <AlbumDetailHeroInfo album={detail} onOpenArtist={openArtist} onPlayAll={playAlbumTracks} />
 */
export function AlbumDetailHeroInfo({
  album,
  onOpenArtist,
  onPlayAll,
}: {
  album: AlbumDetailHeroInfoAlbum;
  onOpenArtist: (artistId: string) => void;
  onPlayAll: (tracks: AlbumDetail['tracks']) => void;
}) {
  return (
    <div className="col-start-3 flex min-w-0 flex-col items-start justify-center gap-[1.389cqw] text-left">
      <h2 id="album-title" className="line-clamp-2 w-full text-[5.556cqw] leading-[6.944cqw] font-semibold">
        {album.title}
      </h2>
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

  if (artists.length === 0) {
    return <p className={cn(layoutClassName, textClassName, 'text-muted-foreground')}>未知歌手</p>;
  }

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
 * 收藏与更多操作保留完整的可点击外观和按压反馈，但当前没有可调用的业务接口；
 * 不可用的技术原因仅保留在代码内，界面不额外显示说明或提示气泡。
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
    <Button
      variant="outline"
      size="icon"
      className="size-[9.722cqw] rounded-full"
      aria-label={label}
      onClick={handleReservedAlbumAction}
    >
      <Icon data-icon="inline-start" aria-hidden="true" />
    </Button>
  );
}

/**
 * 接收尚未接入业务能力的专辑操作点击。
 *
 * 用户需要这些按钮保持完整亮度与可点击状态，但收藏和更多操作尚无接口，因此此处
 * 故意不修改状态、不发送请求。后续接入对应能力时，应在此函数中调用明确的领域操作。
 *
 * @returns 无返回值，也不产生任何副作用。
 */
function handleReservedAlbumAction(): void {
  return;
}
