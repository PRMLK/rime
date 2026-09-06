import { useEffect, useState } from 'react';
import { getAlbumDetail, type AlbumDetail, type Track } from '@/api/rime';
import { AlbumDetailHero, AlbumDetailHeroSkeleton } from '@/components/AlbumDetailHero';
import { InfiniteScrollSentinel } from '@/components/InfiniteScrollSentinel';
import { DetailEmpty } from '@/components/mobile/album-collection';
import { TrackListRow } from '@/components/mobile/track-list';
import { UnifiedListFooterLogo } from '@/components/UnifiedListRow';
import { ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { useAlbumArtworkAccentColor } from '@/hooks/use-album-artwork-accent-color';
import { useProgressiveDisplay } from '@/hooks/use-progressive-display';

/**
 * 请求并渲染一个专辑的基础资料与曲目列表。
 *
 * @param props - 当前专辑、播放状态和页面级事件回调。
 * @returns 专辑详情的 React 元素，包含加载、错误和正常状态。
 */
export function AlbumDetailView({
  albumId,
  activeTrackId,
  isPlaying,
  onChooseTrack,
  onPlayAll,
  onOpenArtist,
  onBackgroundColorChange,
}: {
  albumId: string;
  activeTrackId?: string;
  isPlaying: boolean;
  onChooseTrack: (track: Track) => void;
  onPlayAll: (tracks: Track[]) => void;
  onOpenArtist: (artistId: string) => void;
  onBackgroundColorChange: (color: string | undefined) => void;
}) {
  const [detail, setDetail] = useState<AlbumDetail>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const artworkAccentColor = useAlbumArtworkAccentColor(detail?.artworkId);
  const displayedTracks = useProgressiveDisplay(detail?.tracks ?? [], albumId, 50);

  useEffect(() => {
    onBackgroundColorChange(artworkAccentColor);
  }, [artworkAccentColor, onBackgroundColorChange]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(undefined);
    setDetail(undefined);
    getAlbumDetail(albumId, controller.signal)
      .then(setDetail)
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : '专辑加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [albumId]);

  if (isLoading) return <AlbumDetailLoading />;
  if (error || !detail) {
    return (
      <section className="mt-0">
        <DetailEmpty title="专辑加载失败" description={error ?? '未找到可播放的专辑'} />
      </section>
    );
  }

  return (
    <section className="mt-8" aria-labelledby="album-title">
      <AlbumDetailHero album={detail} isPlaying={isPlaying} onOpenArtist={onOpenArtist} onPlayAll={onPlayAll} />

      <h3 className="mt-8 text-sm font-semibold">曲目{detail.tracks.length}</h3>
      <ItemGroup className="mt-2 gap-0">
        {displayedTracks.visibleItems.map((track, index) => (
          <TrackListRow
            key={track.id}
            track={track}
            isActive={activeTrackId === track.id}
            trackNumber={index + 1}
            showDuration
            separated
            onChooseTrack={onChooseTrack}
          />
        ))}
      </ItemGroup>
      <UnifiedListFooterLogo />
      <InfiniteScrollSentinel
        hasMore={displayedTracks.hasMore}
        isLoading={false}
        observationKey={displayedTracks.visibleCount}
        onLoadMore={displayedTracks.showMore}
      />
    </section>
  );
}

/**
 * 渲染专辑详情请求期间的头图和曲目骨架。
 *
 * @returns 与加载完成后尺寸一致的专辑详情占位内容。
 */
function AlbumDetailLoading() {
  return (
    <section className="mt-8">
      <AlbumDetailHeroSkeleton />
      <div className="mt-8 flex flex-col gap-1">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-14 w-full" />)}
      </div>
    </section>
  );
}
