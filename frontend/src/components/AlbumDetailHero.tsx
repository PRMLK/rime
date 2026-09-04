import type { AlbumDetail } from '@/api/rime';
import { AlbumArtworkSkeleton } from '@/components/AlbumArtwork';
import { AlbumDetailHeroInfo } from '@/components/AlbumDetailHeroInfo';
import { AlbumVinylArtwork } from '@/components/AlbumVinylArtwork';
import { Skeleton } from '@/components/ui/skeleton';

type AlbumDetailHeroAlbum = Pick<AlbumDetail, 'artworkId' | 'artists' | 'title' | 'tracks'>;

/*
 * 封面画布的宽高比是 7:5，三列权重是 65:5:35。三项合计为 105，因此使用 `fr`
 * 归一化权重而不是会溢出的百分比；据此可得到整个头图画布的宽高比为 147:65。
 *
 * 先以 `min(可用宽度, 30cqh * 147 / 65)` 推导画布宽度，再由固定宽高比计算高度：
 * 宽度先触顶时，高度会自然小于 30% 的上限；高度先触顶时，封面列宽、留白列宽和
 * 名称列宽均由同一个画布宽度按 65:5:35 反推。这样没有任何子组件需要以最大宽度
 * 或最大高度截断，也不会超出顶部大组件。
 */
const albumDetailHeroClassName =
  '@container/album-detail-hero grid min-h-0 w-[min(100%,67.846cqh)] aspect-[147/65] grid-cols-[65fr_5fr_35fr]';

/**
 * 渲染专辑详情顶部的封面与信息区域。
 *
 * 组件最多占用顶栏、底部播放器之外的可滚动内容高度的 30%。横向按 65:5:35 的
 * 相对权重分为封面黑胶区、留白和名称区：当页面宽度不足时，画布以宽度为准并降低
 * 高度；当页面高度先达到 30% 时，画布按封面比例反推全部三列宽度并整体靠左。
 * 该组件保持在普通文档流中，不使用固定或粘性定位，因此会随着曲目列表一起滚动。
 *
 * @param props - 专辑头图所需的资料和打开歌手页的回调。
 * @param props.album - 用于封面、标题、歌手与播放操作的专辑详情最小资料。
 * @param props.onOpenArtist - 用户选择歌手文字后打开对应歌手详情的回调。
 * @param props.onPlayAll - 用户选择全部播放后，以当前专辑全部曲目建立播放队列的回调。
 * @returns 不超过可滚动内容区 30%、横向按 65:5:35 分配的专辑详情头图。
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
      <div className="flex min-h-0 min-w-0 items-center justify-start">
        <AlbumVinylArtwork artwork={album} size="fluid" />
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
 * 65:5:35 列权重；网络请求完成后不会使曲目标题或列表产生垂直跳动。
 *
 * @returns 用于专辑详情加载状态的自适应头图骨架。
 */
export function AlbumDetailHeroSkeleton() {
  return (
    <section className={albumDetailHeroClassName} aria-label="正在加载专辑" role="status">
      <div className="flex min-h-0 min-w-0 items-center justify-start">
        <div className="@container/album-artwork-skeleton relative aspect-[7/5] w-full" aria-hidden="true">
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
