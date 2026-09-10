import { UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getArtistDetail, type Album, type ArtistDetail } from '@/mobile/api/rime';
import { AlbumArtworkSkeleton } from '@/mobile/components/AlbumArtwork';
import { InfiniteScrollSentinel } from '@/mobile/components/InfiniteScrollSentinel';
import { AlbumCard, AlbumGrid, DetailEmpty } from '@/mobile/components/views/album-collection';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useCachedResource } from '@/mobile/hooks/use-cached-resource';
import { appendItemsWithoutDuplicates } from '@/mobile/hooks/use-progressive-display';

/**
 * 请求并渲染一个歌手及其参与的专辑；专辑按 30 张一批向后续加载。
 *
 * @param props - 歌手 ID 与打开专辑详情页的回调。
 * @returns 歌手详情的 React 元素，包含首次加载、续页和错误状态。
 */
export function ArtistDetailView({ artistId, onOpenAlbum }: { artistId: string; onOpenAlbum: (albumId: string) => void }) {
  const loadArtist = useCallback((signal: AbortSignal) => getArtistDetail(artistId, 30, undefined, signal), [artistId]);
  const artistResource = useCachedResource<ArtistDetail>({
    cacheKey: `artist:${artistId}:v1`,
    load: loadArtist,
    errorMessage: '歌手加载失败',
  });
  const artist = artistResource.data;
  const [pagination, setPagination] = useState<{ artistId: string; albums: Album[]; nextCursor?: string }>();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string>();
  const requestGenerationRef = useRef(0);
  const moreControllerRef = useRef<AbortController | undefined>(undefined);
  const isLoadingMoreRef = useRef(false);
  const albums = pagination?.artistId === artistId ? pagination.albums : artist?.albums ?? [];
  const nextCursor = pagination?.artistId === artistId ? pagination.nextCursor : artist?.nextCursor;

  useEffect(() => {
    requestGenerationRef.current += 1;
    moreControllerRef.current?.abort();
    moreControllerRef.current = undefined;
    isLoadingMoreRef.current = false;
    setIsLoadingMore(false);
    setLoadMoreError(undefined);
    return () => {
      moreControllerRef.current?.abort();
    };
  }, [artistId]);

  useEffect(() => {
    if (!artist) return;
    requestGenerationRef.current += 1;
    moreControllerRef.current?.abort();
    moreControllerRef.current = undefined;
    isLoadingMoreRef.current = false;
    setPagination({ artistId, albums: artist.albums, nextCursor: artist.nextCursor });
    setIsLoadingMore(false);
    setLoadMoreError(undefined);
  }, [artist, artistId]);

  /**
   * 加载当前歌手专辑的下一批，代次检查防止旧响应进入新歌手页面。
   * @returns 无返回值；请求结果会直接更新本页状态。
   */
  const loadMore = useCallback(() => {
    if (!nextCursor || artistResource.isLoading || isLoadingMoreRef.current) return;

    const generation = requestGenerationRef.current;
    const controller = new AbortController();
    moreControllerRef.current?.abort();
    moreControllerRef.current = controller;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(undefined);

    getArtistDetail(artistId, 30, nextCursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        setPagination((current) => ({
          artistId,
          albums: appendItemsWithoutDuplicates(current?.artistId === artistId ? current.albums : albums, page.albums),
          nextCursor: page.nextCursor,
        }));
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        setLoadMoreError(loadError instanceof Error ? loadError.message : '专辑加载失败');
      })
      .finally(() => {
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        if (moreControllerRef.current === controller) moreControllerRef.current = undefined;
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  }, [albums, artistId, artistResource.isLoading, nextCursor]);

  if (artistResource.isLoading) return <ArtistDetailLoading />;
  if (artistResource.error || !artist) return <DetailEmpty title="歌手加载失败" description={artistResource.error ?? '未找到可播放的作品'} />;

  return (
    <section className="mt-8" aria-labelledby="artist-name">
      <div className="flex items-center gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden="true">
          <UserRound />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">歌手</p>
          <h2 id="artist-name" className="mt-1 truncate text-xl font-semibold">{artist.name}</h2>
        </div>
      </div>

      <Separator className="my-6" />
      <h3 className="text-sm font-semibold">专辑</h3>
      <AlbumGrid>
        {albums.map((album) => <AlbumCard key={album.id} album={album} onOpenAlbum={onOpenAlbum} />)}
      </AlbumGrid>
      <InfiniteScrollSentinel
        hasMore={Boolean(nextCursor)}
        isLoading={isLoadingMore}
        error={loadMoreError}
        observationKey={albums.length}
        onLoadMore={loadMore}
      />
    </section>
  );
}

/**
 * 渲染歌手详情请求期间的自适应骨架屏。
 *
 * @returns 带有歌手资料和响应式专辑网格的加载状态元素。
 */
function ArtistDetailLoading() {
  return (
    <section className="mt-8" aria-label="正在加载歌手" role="status">
      <div className="flex items-center gap-3">
        <Skeleton className="size-14 shrink-0 rounded-md" />
        <div className="flex min-w-0 flex-col gap-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-6 w-40 max-w-full" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
      <Separator className="my-6" />
      <Skeleton className="h-3 w-12" />
      <AlbumGrid>
        {[0, 1, 2, 3].map((item) => (
          <div key={item}>
            <AlbumArtworkSkeleton className="aspect-square w-full" />
            <Skeleton className="mt-2 h-3 w-4/5" />
            <Skeleton className="mt-1 h-3 w-3/5" />
          </div>
        ))}
      </AlbumGrid>
    </section>
  );
}
