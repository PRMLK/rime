import type { AlbumDetail } from '@/api/rime';
import { AlbumArtworkSkeleton } from '@/components/AlbumArtwork';
import { AlbumDetailHeroInfo } from '@/components/AlbumDetailHeroInfo';
import { AlbumVinylArtwork } from '@/components/AlbumVinylArtwork';
import { Skeleton } from '@/components/ui/skeleton';

type AlbumDetailHeroAlbum = Pick<AlbumDetail, 'artworkId' | 'artists' | 'description' | 'title' | 'tracks'>;

/*
 * 封面画布的宽高比是 7:5，三列比例为 60%:5%:35%，合计正好为 100%。据此可
 * 得到整个头图画布的宽高比为 7:3。
 *
 * 先以 `min(可用宽度, 30cqh * 7 / 3)` 推导画布宽度，再由固定宽高比计算高度：
 * 宽度先触顶时，高度会自然小于 30% 的上限；高度先触顶时，封面列宽、留白列宽和
 * 名称列宽均由同一个画布宽度按 60:5:35 反推。这样没有任何子组件需要以最大宽度
 * 或最大高度截断，也不会超出顶部大组件。
 */
const albumDetailHeroClassName =
  '@container/album-detail-hero grid min-h-0 w-[min(100%,70cqh)] aspect-[7/3] grid-cols-[60%_5%_35%]';

/**
 * 渲染专辑详情顶部的封面与信息区域。
 *
 * 组件最多占用顶栏、底部播放器之外的可滚动内容高度的 30%。横向按 60:5:35 的
 * 相对权重分为封面黑胶区、留白和名称区：当页面宽度不足时，画布以宽度为准并降低
 * 高度；当页面高度先达到 30% 时，画布按封面比例反推全部三列宽度并整体靠左。
 * 该组件保持在普通文档流中，不使用固定或粘性定位，因此会随着曲目列表一起滚动。
 *
 * @param props - 专辑头图所需的资料和打开歌手页的回调。
 * @param props.album - 用于封面、标题、歌手与播放操作的专辑详情最小资料。
 * @param props.isPlaying - 当前是否正在播放该专辑的任一曲目；为真时黑胶盘面旋转。
 * @param props.onOpenArtist - 用户选择歌手文字后打开对应歌手详情的回调。
 * @param props.onPlayAll - 用户选择全部播放后，以当前专辑全部曲目建立播放队列的回调。
 * @returns 不超过可滚动内容区 30%、横向按 60:5:35 分配的专辑详情头图。
 *
 * @example
 * <AlbumDetailHero album={detail} onOpenArtist={openArtist} onPlayAll={playAlbumTracks} />
 */
export function AlbumDetailHero({
  album,
  isPlaying = false,
  onOpenArtist,
  onPlayAll,
}: {
  album: AlbumDetailHeroAlbum;
  isPlaying?: boolean;
  onOpenArtist: (artistId: string) => void;
  onPlayAll: (tracks: AlbumDetail['tracks']) => void;
}) {
  return (
    <section className={albumDetailHeroClassName} aria-labelledby="album-title">
      <div className="flex min-h-0 min-w-0 items-center justify-start">
        <AlbumVinylArtwork artwork={album} size="fluid" isPlaying={isPlaying} />
      </div>
      {/* 第二列由网格的 5fr 留白承担，名称组件从第三列开始，避免缩放时挤压左右内容。 */}
      <AlbumDetailHeroInfo album={album} onOpenArtist={onOpenArtist} onPlayAll={onPlayAll} />
    </section>
  );
}

/**
 * 渲染专辑详情头图的加载骨架。
 *
 * 骨架与 `AlbumDetailHero（专辑详情头图）` 共用同一套由宽高比例推导的尺寸和
 * 60:5:35 列比例，以及与名称组件一致的紧凑信息组间距；网络请求完成后不会使
 * 曲目标题或列表产生垂直跳动。
 *
 * @returns 用于专辑详情加载状态的自适应头图骨架。
 */
export function AlbumDetailHeroSkeleton() {
  return (
    <section className={albumDetailHeroClassName} aria-label="正在加载专辑" role="status">
      <div className="flex min-h-0 min-w-0 items-center justify-start">
        <div className="@container/album-artwork-skeleton relative aspect-[7/5] w-full" aria-hidden="true">
          <Skeleton className="absolute top-1/2 right-[5.714cqw] size-[57.143cqw] -translate-y-1/2 rounded-full" />
          <AlbumArtworkSkeleton className="relative size-[71.429cqw]" />
        </div>
      </div>
      <div className="col-start-3 flex h-full min-h-0 min-w-0 flex-col items-start pt-[6.25cqw]" aria-hidden="true">
        <Skeleton className="ml-[0.694cqw] h-[5cqw] w-4/5" />
        <Skeleton className="mt-[0.694cqw] ml-[0.694cqw] h-[2.778cqw] w-2/5" />
        {/* 默认隐藏的简介槽位仍保留一行高度，加载完成后操作行不会向上跳动。 */}
        <div className="mt-[0.694cqw] h-[3.125cqw]" />
        <div className="mt-[0.694cqw] flex items-center gap-[1.389cqw]">
          <Skeleton className="size-[9.722cqw] rounded-lg" />
          <Skeleton className="size-[8.333cqw] rounded-full" />
          <Skeleton className="size-[8.333cqw] rounded-full" />
        </div>
      </div>
    </section>
  );
}
