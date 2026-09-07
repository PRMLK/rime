import { ChevronRight, Disc3 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { favoriteAlbumsChangedEvent, getAlbums, getFavoriteAlbums, getPlaylist, getPlaylists, getRecentAlbums, getRecentPlaybackTracks, playbackHistoryChangedEvent, playlistsChangedEvent, type AlbumPage, type Track } from '@/api/rime';
import { AlbumArtworkSkeleton } from '@/components/AlbumArtwork';
import { InfiniteScrollSentinel } from '@/components/InfiniteScrollSentinel';
import { AlbumCard, AlbumGrid, DetailEmpty, type AlbumCardAlbum } from '@/components/mobile/album-collection';
import { TrackListRow } from '@/components/mobile/track-list';
import { Button } from '@/components/ui/button';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { useInfiniteCursorList } from '@/hooks/use-infinite-cursor-list';
import { useCachedResource } from '@/hooks/use-cached-resource';

/** 首页专辑轮播单项的响应式边长变量。 */
const homeAlbumCardSizeVariableClassName =
  '[--home-album-card-size:clamp(8rem,min(40%,30cqh),20rem)]';

/**
 * 渲染首页的最近入库、全部专辑、继续聆听、我的喜欢和我的歌单入口。
 *
 * 最近入库、全部专辑和我的喜欢均使用 AlbumCard（专辑卡片），点击后都通过同一个专辑 ID
 * 进入 AlbumDetailView（专辑详情视图）。继续聆听例外：它按歌曲持久化并直接播放选中歌曲；
 * 我的歌单暂只保留标题，等待歌单页的信息架构明确后再补充具体内容。
 *
 * @param props - 打开专辑、全部专辑和最近入库页面，以及选择继续聆听歌曲的回调。
 * @returns 首页五个内容区块组成的 React 元素。
 */
export function HomeView({
  onOpenAlbum,
  onOpenAllAlbums,
  onOpenRecentAlbums,
  activeTrackId,
  onChooseTrack,
}: {
  onOpenAlbum: (albumId: string) => void;
  onOpenAllAlbums: () => void;
  onOpenRecentAlbums: () => void;
  activeTrackId?: string;
  onChooseTrack: (track: Track) => void;
}) {
  return (
    <div className="mt-8 flex flex-col gap-8">
      <RecentAlbumsSection onOpenAlbum={onOpenAlbum} onOpenRecentAlbums={onOpenRecentAlbums} />
      <AllAlbumsSection onOpenAlbum={onOpenAlbum} onOpenAllAlbums={onOpenAllAlbums} />
      <ContinueListeningSection activeTrackId={activeTrackId} onChooseTrack={onChooseTrack} />
      <FavoriteAlbumsSection onOpenAlbum={onOpenAlbum} />
      <section aria-labelledby="home-playlists-heading">
        <h2 id="home-playlists-heading" className="text-sm font-semibold">我的歌单</h2>
      </section>
    </div>
  );
}

/**
 * 渲染持久化的继续聆听歌曲列表。
 *
 * 只读取服务端最近开始播放的歌曲，不读取或显示进度。没有历史时整个区块隐藏，避免首页
 * 出现无操作价值的空状态；点击歌曲仍复用全局播放器的选择回调。
 *
 * @param props - 当前播放歌曲 ID 与选择历史歌曲播放的回调。
 * @returns 加载、失败或按歌曲显示的继续聆听区块；无历史时不渲染。
 */
function ContinueListeningSection({
  activeTrackId,
  onChooseTrack,
}: {
  activeTrackId?: string;
  onChooseTrack: (track: Track) => void;
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    /** 开始播放落库后刷新，避免已打开的首页停留在旧历史。 */
    const refresh = () => setRefreshKey((value) => value + 1);
    window.addEventListener(playbackHistoryChangedEvent, refresh);
    return () => window.removeEventListener(playbackHistoryChangedEvent, refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(undefined);
    getRecentPlaybackTracks(12, controller.signal)
      .then((page) => setTracks(page.items))
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : '继续聆听加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
    });
    return () => controller.abort();
  }, [refreshKey]);

  if (!isLoading && !error && tracks.length === 0) return null;

  return (
    <section aria-labelledby="continue-listening-heading">
      <h2 id="continue-listening-heading" className="text-sm font-semibold">继续聆听</h2>
      {isLoading ? (
        <div className="mt-2 flex flex-col gap-2" aria-label="正在加载继续聆听">
          {[0, 1, 2].map((index) => <Skeleton key={index} className="h-14 w-full" />)}
        </div>
      ) : error ? (
        <Empty className="mt-2 border border-dashed py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Disc3 aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>继续聆听加载失败</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="mt-2 gap-0">
          {tracks.map((track, index) => (
            <TrackListRow
              key={`${track.id}-${index}`}
              track={track}
              isActive={activeTrackId === track.id}
              showAlbum
              separated={index < tracks.length - 1}
              onChooseTrack={onChooseTrack}
            />
          ))}
        </ItemGroup>
      )}
    </section>
  );
}

/**
 * 渲染首页“全部专辑”入口，并按标题取得一小批专辑供横向浏览。
 *
 * @param props - 打开专辑详情和全部专辑列表的回调。
 * @returns 专辑轮播的加载、空状态或可横向浏览的内容区。
 */
function AllAlbumsSection({
  onOpenAlbum,
  onOpenAllAlbums,
}: {
  onOpenAlbum: (albumId: string) => void;
  onOpenAllAlbums: () => void;
}) {
  const loadAlbums = useCallback(
    (signal: AbortSignal) => getAlbums(12, undefined, signal),
    [],
  );

  return (
    <AlbumCarouselSection
      title="全部专辑"
      headingID="all-albums-heading"
      loadingLabel="正在加载全部专辑"
      carouselLabel="全部专辑"
      loadAlbums={loadAlbums}
      onOpenAlbum={onOpenAlbum}
      onOpenList={onOpenAllAlbums}
    />
  );
}

/**
 * 渲染首页“最近入库”入口，并保留原有的按入库时间倒序逻辑。
 *
 * @param props - 打开专辑详情和最近入库完整列表的回调。
 * @returns 专辑轮播的加载、空状态或可横向浏览的内容区。
 */
function RecentAlbumsSection({
  onOpenAlbum,
  onOpenRecentAlbums,
}: {
  onOpenAlbum: (albumId: string) => void;
  onOpenRecentAlbums: () => void;
}) {
  const loadRecentAlbums = useCallback(
    (signal: AbortSignal) => getRecentAlbums(12, undefined, signal),
    [],
  );

  return (
    <AlbumCarouselSection
      title="最近入库"
      headingID="recent-albums-heading"
      loadingLabel="正在加载最近入库的专辑"
      carouselLabel="最近入库专辑"
      loadAlbums={loadRecentAlbums}
      onOpenAlbum={onOpenAlbum}
      onOpenList={onOpenRecentAlbums}
    />
  );
}

/**
 * 渲染“我的喜欢”的专辑入口。
 *
 * 收藏支持独立喜欢专辑和喜欢歌曲，但首页统一按专辑浏览。直接喜欢的专辑优先展示，
 * 再合并收藏歌单内歌曲所属的专辑；同一专辑无论被喜欢几次都只显示一张卡片。
 *
 * @param props - 打开去重后任一收藏专辑详情的回调。
 * @returns 收藏专辑的加载、空状态或可横向浏览的轮播元素。
 */
function FavoriteAlbumsSection({ onOpenAlbum }: { onOpenAlbum: (albumId: string) => void }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const loadFavoriteAlbums = useCallback(async (signal: AbortSignal) => {
    const directFavoriteAlbums = await getFavoriteAlbums(12, signal);
    // 收藏歌单在服务端排序中始终置顶；只取一项即可避免额外读取用户的全部歌单。
    const playlists = await getPlaylists(1, undefined, signal);
    const favorites = playlists.items.find((playlist) => playlist.kind === 'favorites');
    if (!favorites) return { items: directFavoriteAlbums.items };

    const detail = await getPlaylist(favorites.id, signal);
    // 歌单会保留历史收藏；只给仍可播放的曲目生成入口，确保详情页一定存在可用内容。
    return {
      items: mergeFavoriteAlbums(
        directFavoriteAlbums.items,
        albumsFromFavoriteTracks(detail.tracks.filter((track) => track.available)),
      ).slice(0, 12),
    };
  }, []);

  useEffect(() => {
    /** 歌曲或专辑的喜欢状态改变后重新读取，避免首页保留过期的去重专辑集合。 */
    const refresh = () => setRefreshKey((value) => value + 1);
    window.addEventListener(playlistsChangedEvent, refresh);
    window.addEventListener(favoriteAlbumsChangedEvent, refresh);
    return () => {
      window.removeEventListener(playlistsChangedEvent, refresh);
      window.removeEventListener(favoriteAlbumsChangedEvent, refresh);
    };
  }, []);

  return (
    <AlbumCarouselSection
      title="我的喜欢"
      headingID="favorite-albums-heading"
      loadingLabel="正在加载我喜欢的专辑"
      carouselLabel="我喜欢的专辑"
      loadAlbums={loadFavoriteAlbums}
      onOpenAlbum={onOpenAlbum}
      refreshKey={refreshKey}
      hideWhenEmpty
    />
  );
}

/**
 * 将收藏曲目转换为唯一的专辑卡片资料。
 *
 * @param tracks - 收藏歌单按用户收藏顺序返回的曲目集合。
 * @returns 保留首次出现顺序、不会重复的专辑卡片资料。
 */
function albumsFromFavoriteTracks(tracks: Track[]): AlbumCardAlbum[] {
  const albumsByID = new Map<string, AlbumCardAlbum>();
  for (const track of tracks) {
    if (albumsByID.has(track.album.id)) continue;
    albumsByID.set(track.album.id, {
      id: track.album.id,
      title: track.album.title,
      artists: track.artists,
      artworkId: track.artworkId,
    });
  }
  return [...albumsByID.values()];
}

/**
 * 合并直接喜欢的专辑与喜欢歌曲推导出的专辑。
 *
 * @param directAlbums 用户显式点击专辑喜欢得到的专辑，顺序按最近喜欢时间排列。
 * @param trackAlbums 用户喜欢歌曲所属的专辑，顺序按歌曲在收藏歌单中的顺序排列。
 * @returns 保留直接专辑优先级、按专辑 ID 去重后的卡片资料。
 */
function mergeFavoriteAlbums(directAlbums: AlbumCardAlbum[], trackAlbums: AlbumCardAlbum[]): AlbumCardAlbum[] {
  const albumsByID = new Map<string, AlbumCardAlbum>();
  for (const album of [...directAlbums, ...trackAlbums]) {
    if (!albumsByID.has(album.id)) albumsByID.set(album.id, album);
  }
  return [...albumsByID.values()];
}

/**
 * 渲染首页共用的专辑轮播区，并隔离每个数据源的加载、空状态与错误状态。
 *
 * 标题存在完整列表页面时显示为带箭头的按钮；我的喜欢没有独立列表页，因而只渲染普通标题。
 * 无论入口来源如何，所有卡片均调用 onOpenAlbum（打开专辑）。hideWhenEmpty（空时隐藏）
 * 仅用于可选内容区：请求成功但没有专辑时，整个区块不会占用首页空间。
 *
 * @param props - 标题与无障碍标签、读取专辑首批数据的函数，以及可选列表导航回调。
 * @returns 对应专辑维度的加载、空状态或可横向浏览的轮播元素。
 */
function AlbumCarouselSection({
  title,
  headingID,
  loadingLabel,
  carouselLabel,
  loadAlbums,
  onOpenAlbum,
  onOpenList,
  refreshKey,
  hideWhenEmpty = false,
}: {
  title: string;
  headingID: string;
  loadingLabel: string;
  carouselLabel: string;
  loadAlbums: (signal: AbortSignal) => Promise<{ items: AlbumCardAlbum[] }>;
  onOpenAlbum: (albumId: string) => void;
  onOpenList?: () => void;
  refreshKey?: number;
  hideWhenEmpty?: boolean;
}) {
  const resource = useCachedResource({
    cacheKey: `home:${headingID}:v1`,
    refreshKey,
    load: loadAlbums,
    errorMessage: `${title}加载失败`,
  });
  const albums = resource.data?.items ?? [];

  // “我的喜欢”等可选区块没有内容时直接收起，不用空状态打断首页的专辑浏览节奏。
  if (!resource.isLoading && !resource.error && albums.length === 0 && hideWhenEmpty) return null;

  return (
    <section className={homeAlbumCardSizeVariableClassName} aria-labelledby={headingID}>
      <h2 id={headingID}>
        {onOpenList ? (
          <Button variant="ghost" className="h-auto gap-0 p-0 text-sm font-semibold" onClick={onOpenList}>
            {title}
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        ) : <span className="text-sm font-semibold">{title}</span>}
      </h2>
      {resource.isLoading ? (
        <div className="mt-3 flex gap-3 overflow-hidden" role="status" aria-label={loadingLabel}>
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="w-[var(--home-album-card-size)] shrink-0">
              <AlbumArtworkSkeleton className="aspect-square w-full" />
              <Skeleton className="mt-3 h-3 w-4/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
            </div>
          ))}
        </div>
      ) : resource.error || albums.length === 0 ? (
        <Empty className="mt-3 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Disc3 aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>{resource.error ? `${title}加载失败` : `暂无${title}`}</EmptyTitle>
            {resource.error && <EmptyDescription>{resource.error}</EmptyDescription>}
          </EmptyHeader>
        </Empty>
      ) : (
        <Carousel className="mt-3" opts={{ align: 'start', dragFree: true, containScroll: 'trimSnaps' }} aria-label={carouselLabel} tabIndex={0}>
          <CarouselContent className="-ml-3">
            {albums.map((album) => (
              <CarouselItem key={album.id} className="basis-[var(--home-album-card-size)] pl-3">
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
 * 渲染全部专辑网格，并在用户接近末尾时持续追加下一批。
 *
 * 全部专辑按标题稳定排序；列表会持续加载至曲库末尾，适合按名称查找和浏览。
 *
 * @param props - 打开对应专辑详情页的回调。
 * @returns 全部专辑的加载、空状态或可无限续页的专辑网格。
 */
export function AllAlbumsView({ onOpenAlbum }: { onOpenAlbum: (albumId: string) => void }) {
  const loadAlbumPage = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => getAlbums(24, cursor, signal),
    [],
  );

  return (
    <AlbumGridView
      ariaLabel="全部专辑"
      loadingLabel="正在加载全部专辑"
      resetKey="albums"
      errorTitle="全部专辑加载失败"
      emptyTitle="暂无专辑"
      emptyDescription="专辑将显示在这里"
      loadAlbumPage={loadAlbumPage}
      onOpenAlbum={onOpenAlbum}
    />
  );
}

/**
 * 渲染最近入库专辑网格，并在用户接近末尾时持续追加下一批。
 *
 * 该视图保留原有按入库时间倒序的逻辑，用于优先发现刚扫描进入音乐库的内容。
 *
 * @param props - 打开对应专辑详情页的回调。
 * @returns 最近入库的加载、空状态或可无限续页的专辑网格。
 */
export function RecentAlbumsView({ onOpenAlbum }: { onOpenAlbum: (albumId: string) => void }) {
  const loadAlbumPage = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => getRecentAlbums(24, cursor, signal),
    [],
  );

  return (
    <AlbumGridView
      ariaLabel="最近入库专辑"
      loadingLabel="正在加载最近入库的专辑"
      resetKey="recent-albums"
      errorTitle="最近入库加载失败"
      emptyTitle="暂无最近入库的专辑"
      emptyDescription="新入库的专辑将显示在这里"
      loadAlbumPage={loadAlbumPage}
      onOpenAlbum={onOpenAlbum}
    />
  );
}

/**
 * 渲染可无限续页的通用专辑网格，并让“全部专辑”与“最近入库”共享交互状态。
 *
 * @param props - 页面文案、稳定的续页键、请求函数，以及打开专辑详情的回调。
 * @returns 专辑网格的初始加载、空状态、错误状态和后续加载入口。
 */
function AlbumGridView({
  ariaLabel,
  loadingLabel,
  resetKey,
  errorTitle,
  emptyTitle,
  emptyDescription,
  loadAlbumPage,
  onOpenAlbum,
}: {
  ariaLabel: string;
  loadingLabel: string;
  resetKey: string;
  errorTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  loadAlbumPage: (cursor: string | undefined, signal: AbortSignal) => Promise<AlbumPage>;
  onOpenAlbum: (albumId: string) => void;
}) {
  const albumsFeed = useInfiniteCursorList({
    enabled: true,
    resetKey,
    cacheKey: `${resetKey}:list:v1`,
    loadPage: loadAlbumPage,
  });

  if (albumsFeed.isInitialLoading) {
    return (
      <section className="mt-8" aria-label={loadingLabel} role="status">
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
    return <DetailEmpty title={albumsFeed.initialError ? errorTitle : emptyTitle} description={albumsFeed.initialError ?? emptyDescription} />;
  }

  return (
    <section className="mt-8" aria-label={ariaLabel}>
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
