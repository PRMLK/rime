import { useCallback, useEffect, useRef, useState } from 'react';
import { getAlbumDetail, getFavoriteAlbumStatus, setFavoriteAlbum, type AlbumDetail, type Track } from '@/mobile/api/rime';
import { AlbumDetailHero, AlbumDetailHeroSkeleton } from '@/mobile/components/AlbumDetailHero';
import { InfiniteScrollSentinel } from '@/mobile/components/InfiniteScrollSentinel';
import { DetailEmpty } from '@/mobile/components/views/album-collection';
import { TrackListRow } from '@/mobile/components/views/track-list';
import { UnifiedListFooterLogo } from '@/mobile/components/UnifiedListRow';
import { ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { useAlbumArtworkAccentColor } from '@/mobile/hooks/use-album-artwork-accent-color';
import { useCachedResource } from '@/mobile/hooks/use-cached-resource';
import { useProgressiveDisplay } from '@/mobile/hooks/use-progressive-display';

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
  const loadAlbum = useCallback((signal: AbortSignal) => getAlbumDetail(albumId, signal), [albumId]);
  const album = useCachedResource<AlbumDetail>({
    cacheKey: `album:${albumId}:v1`,
    load: loadAlbum,
    errorMessage: '专辑加载失败',
  });
  const detail = album.data;
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoadingFavorite, setIsLoadingFavorite] = useState(true);
  const [updatingFavoriteAlbumID, setUpdatingFavoriteAlbumID] = useState<string>();
  const activeAlbumIDRef = useRef(albumId);
  activeAlbumIDRef.current = albumId;
  const isUpdatingFavorite = isLoadingFavorite || updatingFavoriteAlbumID === albumId;
  const artworkAccentColor = useAlbumArtworkAccentColor(detail?.artworkId);
  const displayedTracks = useProgressiveDisplay(detail?.tracks ?? [], albumId, 50);

  useEffect(() => {
    onBackgroundColorChange(artworkAccentColor);
  }, [artworkAccentColor, onBackgroundColorChange]);

  useEffect(() => {
    const controller = new AbortController();
    setIsFavorite(false);
    setIsLoadingFavorite(true);
    getFavoriteAlbumStatus(albumId, controller.signal)
      .then((status) => {
        if (!controller.signal.aborted && activeAlbumIDRef.current === albumId) setIsFavorite(status.favorite);
      })
      .catch((loadError: unknown) => {
        // 专辑资料本身仍可正常使用；状态读取失败时只按未收藏展示，避免阻塞详情页。
        if (!controller.signal.aborted && activeAlbumIDRef.current === albumId && !(loadError instanceof DOMException && loadError.name === 'AbortError')) setIsFavorite(false);
      })
      .finally(() => {
        if (!controller.signal.aborted && activeAlbumIDRef.current === albumId) setIsLoadingFavorite(false);
      });
    return () => controller.abort();
  }, [albumId]);

  /**
   * 乐观更新当前专辑的喜欢状态，并在服务端写入失败时还原。
   *
   * 详情页只管理专辑喜欢；歌曲喜欢由底部播放器和正在播放抽屉各自连接歌曲接口，二者
   * 保持独立，避免用户喜欢专辑时误收藏其中全部歌曲。请求完成后会比对当前专辑 ID，
   * 防止用户导航到另一张专辑时，旧请求的回滚或加载状态覆盖新专辑。
   *
   * @returns 无返回值；写入失败时仅回滚当前仍显示的目标专辑。
   */
  const toggleFavorite = async () => {
    if (isLoadingFavorite || isUpdatingFavorite) return;
    const targetAlbumID = albumId;
    const next = !isFavorite;
    setIsFavorite(next);
    setUpdatingFavoriteAlbumID(targetAlbumID);
    try {
      await setFavoriteAlbum(targetAlbumID, next);
    } catch {
      // 请求失败时只回滚仍显示的原专辑，不能覆盖用户已经导航到的下一张专辑。
      if (activeAlbumIDRef.current === targetAlbumID) setIsFavorite(!next);
    } finally {
      // 只清除本次目标的写入状态；另一张专辑可能已开始新的喜欢操作。
      setUpdatingFavoriteAlbumID((currentAlbumID) => currentAlbumID === targetAlbumID ? undefined : currentAlbumID);
    }
  };

  if (album.isLoading) return <AlbumDetailLoading />;
  if (album.error || !detail) {
    return (
      <section className="mt-0">
        <DetailEmpty title="专辑加载失败" description={album.error ?? '未找到可播放的专辑'} />
      </section>
    );
  }

  return (
    <section className="mt-8" aria-labelledby="album-title">
      <AlbumDetailHero
        album={detail}
        isPlaying={isPlaying}
        isFavorite={isFavorite}
        isUpdatingFavorite={isUpdatingFavorite}
        onOpenArtist={onOpenArtist}
        onPlayAll={onPlayAll}
        onToggleFavorite={() => void toggleFavorite()}
      />

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
