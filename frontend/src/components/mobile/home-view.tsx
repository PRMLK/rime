import { ChevronRight, Disc3 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getRecentAlbums, type Album } from '@/api/rime';
import { AlbumArtworkSkeleton } from '@/components/AlbumArtwork';
import { InfiniteScrollSentinel } from '@/components/InfiniteScrollSentinel';
import { AlbumCard, AlbumGrid, DetailEmpty } from '@/components/mobile/album-collection';
import { Button } from '@/components/ui/button';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useInfiniteCursorList } from '@/hooks/use-infinite-cursor-list';
import { cn } from '@/lib/utils';

/** 首页最近入库轮播单项的响应式边长变量。 */
const homeRecentAlbumCardSizeVariableClassName =
  '[--home-recent-album-card-size:clamp(8rem,min(40%,30cqh),20rem)]';

/**
 * 渲染首页的最近入库专辑，并允许用户打开任一专辑详情。
 *
 * @param props - 打开专辑详情和最近入库完整列表的回调。
 * @returns 首页最近专辑区域的 React 元素。
 */
export function HomeView({
  onOpenAlbum,
  onOpenRecentAlbums,
}: {
  onOpenAlbum: (albumId: string) => void;
  onOpenRecentAlbums: () => void;
}) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(undefined);
    getRecentAlbums(12, undefined, controller.signal)
      .then((page) => setAlbums(page.items))
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : '最近入库加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <section className={cn('mt-8', homeRecentAlbumCardSizeVariableClassName)} aria-labelledby="recent-albums-heading">
      <h2 id="recent-albums-heading">
        <Button variant="ghost" className="h-auto gap-0 p-0 text-sm font-semibold" onClick={onOpenRecentAlbums}>
          最近入库
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        </Button>
      </h2>
      {isLoading ? (
        <div className="mt-3 flex gap-3 overflow-hidden" role="status" aria-label="正在加载最近入库的专辑">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="w-[var(--home-recent-album-card-size)] shrink-0">
              <AlbumArtworkSkeleton className="aspect-square w-full" />
              <Skeleton className="mt-3 h-3 w-4/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
            </div>
          ))}
        </div>
      ) : error || albums.length === 0 ? (
        <Empty className="mt-3 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Disc3 aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>{error ? '最近入库加载失败' : '暂无最近入库的专辑'}</EmptyTitle>
            {error && <EmptyDescription>{error}</EmptyDescription>}
          </EmptyHeader>
        </Empty>
      ) : (
        <Carousel className="mt-3" opts={{ align: 'start', dragFree: true, containScroll: 'trimSnaps' }} aria-label="最近入库专辑" tabIndex={0}>
          <CarouselContent className="-ml-3">
            {albums.map((album) => (
              <CarouselItem key={album.id} className="basis-[var(--home-recent-album-card-size)] pl-3">
                <AlbumCard album={album} onOpenAlbum={onOpenAlbum} />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      )}
    </section>
  );
}

/**
 * 渲染最近入库的完整专辑网格，并在用户接近末尾时持续追加下一批。
 *
 * @param props - 打开对应专辑详情页的回调。
 * @returns 最近入库的加载、空状态或可无限续页的专辑网格。
 */
export function RecentAlbumsView({ onOpenAlbum }: { onOpenAlbum: (albumId: string) => void }) {
  const loadAlbumPage = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => getRecentAlbums(24, cursor, signal),
    [],
  );
  const albumsFeed = useInfiniteCursorList({
    enabled: true,
    resetKey: 'recent-albums',
    loadPage: loadAlbumPage,
  });

  if (albumsFeed.isInitialLoading) {
    return (
      <section className="mt-8" aria-label="正在加载最近入库的专辑" role="status">
        <AlbumGrid>
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item}>
              <AlbumArtworkSkeleton className="aspect-square w-full" />
              <Skeleton className="mt-3 h-3 w-4/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
            </div>
          ))}
        </AlbumGrid>
      </section>
    );
  }

  if (albumsFeed.initialError || albumsFeed.items.length === 0) {
    return <DetailEmpty title={albumsFeed.initialError ? '最近入库加载失败' : '暂无最近入库的专辑'} description={albumsFeed.initialError ?? '新入库的专辑将显示在这里'} />;
  }

  return (
    <section className="mt-8" aria-label="最近入库专辑">
      <AlbumGrid>
        {albumsFeed.items.map((album) => <AlbumCard key={album.id} album={album} onOpenAlbum={onOpenAlbum} />)}
      </AlbumGrid>
      <InfiniteScrollSentinel
        hasMore={albumsFeed.hasMore}
        isLoading={albumsFeed.isLoadingMore}
        error={albumsFeed.loadMoreError}
        observationKey={albumsFeed.items.length}
        onLoadMore={albumsFeed.loadMore}
      />
    </section>
  );
}
