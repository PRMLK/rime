import {
  ArrowLeft, CalendarClock, ChevronDown, ChevronRight, Disc3, Heart, Home, LibraryBig,
  LoaderCircle, Pause, Play, Search, Settings, SkipBack, SkipForward, Sparkles, UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  ApiError, artworkUrl, getAlbumDetail, getArtistDetail, getRecentAlbums, getScheduledTasks, getTrackLyrics, runScheduledTask, searchTracks,
  type Album, type AlbumDetail, type ArtistDetail, type ArtistRef, type LyricsDocument, type ScheduledTask, type Track,
} from '@/api/rime';
import nowPlayingCover from '@/assets/now-playing.jpg';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle,
} from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { HtmlAudioPlayer, type PlayerSnapshot } from '@/services/player/HtmlAudioPlayer';

type NavigationTab = 'home' | 'search' | 'library';

type DetailView =
  | { kind: 'album'; id: string }
  | { kind: 'artist'; id: string };

const navigationItems = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'search', label: '搜索', icon: Search },
  { id: 'library', label: '我的', icon: UserRound },
] as const;

const libraryItems = [
  { title: '我喜欢的音乐', detail: '尚未同步' },
  { title: '最近播放', detail: '尚未同步' },
  { title: '我的歌单', detail: '尚未同步' },
];

export function MobilePlayer() {
  const player = useMemo(() => new HtmlAudioPlayer(), []);
  const playback = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const [activeTab, setActiveTab] = useState<NavigationTab>('home');
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [searchError, setSearchError] = useState<string>();
  const [detailStack, setDetailStack] = useState<DetailView[]>([]);
  const activeLabel = navigationItems.find((item) => item.id === activeTab)?.label ?? '首页';
  const activeDetail = detailStack[detailStack.length - 1];
  const pageLabel = activeDetail?.kind === 'album' ? '专辑' : activeDetail?.kind === 'artist' ? '歌手' : activeLabel;
  const isPlaying = playback.status === 'playing';
  const playbackLabel = isPlaying ? '暂停播放' : '开始播放';
  const currentIndex = playback.track ? results.findIndex((track) => track.id === playback.track?.id) : -1;
  const queue = currentIndex >= 0 ? results.slice(currentIndex + 1) : results.slice(0, 3);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setIsSearching(true);
      setSearchError(undefined);
      searchTracks(query.trim(), controller.signal)
        .then((page) => setResults(page.items))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setSearchError(error instanceof Error ? error.message : '搜索失败');
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  useEffect(() => () => player.dispose(), [player]);

  const chooseTrack = async (track: Track) => {
    try {
      await player.load(track);
    } catch {
      // The player state exposes the actionable error next to the track.
    }
  };

  const playRelative = (offset: number) => {
    if (currentIndex < 0) return;
    const track = results[currentIndex + offset];
    if (track) void chooseTrack(track);
  };

  /**
   * 将专辑详情压入当前浏览栈，使从歌手页进入专辑后能逐层返回。
   * @param albumId 专辑的唯一标识。
   * @returns 无返回值；状态更新后界面显示对应的专辑详情。
   */
  const openAlbum = useCallback((albumId: string) => {
    setDetailStack((stack) => [...stack, { kind: 'album', id: albumId }]);
  }, []);

  /**
   * 将歌手详情压入当前浏览栈，使返回按钮能回到来源专辑。
   * @param artistId 歌手的唯一标识。
   * @returns 无返回值；状态更新后界面显示对应的歌手详情。
   */
  const openArtist = useCallback((artistId: string) => {
    setDetailStack((stack) => [...stack, { kind: 'artist', id: artistId }]);
  }, []);

  /**
   * 关闭当前详情视图，并恢复到浏览栈中的上一页。
   * @returns 无返回值；位于栈底时回到当前主导航页面。
   */
  const closeDetail = useCallback(() => {
    setDetailStack((stack) => stack.slice(0, -1));
  }, []);

  return (
    <TooltipProvider>
      <Drawer open={isPlayerOpen} onOpenChange={setIsPlayerOpen} swipeDirection="down">
        <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
        <main className="min-h-0 flex-1 overflow-y-auto px-5 pt-6">
          <div className="mx-auto w-full max-w-xl pb-8">
            <header className="flex items-center gap-2">
              {activeDetail && (
                <Button variant="ghost" size="icon" aria-label="返回上一页" onClick={closeDetail}>
                  <ArrowLeft aria-hidden="true" />
                </Button>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Rime Music</p>
                <h1 className="mt-1 text-xl font-semibold">{pageLabel}</h1>
              </div>
            </header>

            {activeDetail?.kind === 'album' && (
              <AlbumDetailView
                albumId={activeDetail.id}
                activeTrackId={playback.track?.id}
                onChooseTrack={chooseTrack}
                onOpenArtist={openArtist}
              />
            )}
            {activeDetail?.kind === 'artist' && <ArtistDetailView artistId={activeDetail.id} onOpenAlbum={openAlbum} />}
            {!activeDetail && activeTab === 'home' && <HomeView onOpenAlbum={openAlbum} />}
            {!activeDetail && activeTab === 'search' && (
              <SearchView
                query={query}
                results={results}
                isSearching={isSearching}
                error={searchError}
                activeTrackId={playback.track?.id}
                onQueryChange={setQuery}
                onChooseTrack={chooseTrack}
              />
            )}
            {!activeDetail && activeTab === 'library' && <LibraryView onOpenSystemSettings={() => setIsSettingsOpen(true)} />}
          </div>
        </main>

        <footer className="shrink-0 border-t bg-background">
          <section className="mx-auto flex min-h-20 w-full max-w-xl items-center gap-3 px-4 py-3" aria-label="正在播放">
            <DrawerTrigger
              render={
                <Button
                  variant="ghost"
                  className="h-auto min-w-0 flex-1 justify-start px-0 py-0 text-left"
                  disabled={!playback.track}
                  aria-label={playback.track ? `展开《${playback.track.title}》播放器` : '暂无播放曲目'}
                />
              }
            >
              <ArtworkImage track={playback.track} size={128} className="size-12 shrink-0 rounded-md object-cover" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{playback.track?.title ?? '未在播放'}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{artistLine(playback.track)}</span>
              </span>
            </DrawerTrigger>
            <div className="flex shrink-0 items-center">
              <PlayerButton label="上一首" disabled={currentIndex <= 0} onClick={() => playRelative(-1)}><SkipBack aria-hidden="true" /></PlayerButton>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="secondary" size="icon" aria-label={playbackLabel} aria-pressed={isPlaying} disabled={!playback.track || playback.status === 'loading'} onClick={() => void player.toggle()}>
                      {playback.status === 'loading' ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                    </Button>
                  }
                />
                <TooltipContent>{playbackLabel}</TooltipContent>
              </Tooltip>
              <PlayerButton label="下一首" disabled={currentIndex < 0 || currentIndex >= results.length - 1} onClick={() => playRelative(1)}><SkipForward aria-hidden="true" /></PlayerButton>
            </div>
          </section>
          <Separator />
          <nav className="mx-auto grid h-[4.75rem] w-full max-w-xl grid-cols-3 px-2 pb-[max(env(safe-area-inset-bottom),0.25rem)]" aria-label="主导航">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <Button
                  key={item.id}
                  variant={isActive ? 'secondary' : 'ghost'}
                  className="h-full w-full flex-col gap-1 rounded-md px-0 py-2 text-[0.6875rem]"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => {
                    setActiveTab(item.id);
                    setDetailStack([]);
                  }}
                >
                  <Icon data-icon="inline-start" aria-hidden="true" />
                  <span>{item.label}</span>
                </Button>
              );
            })}
          </nav>
        </footer>
        </div>

        <NowPlayingDrawer
          playback={playback}
          queue={queue}
          isLiked={isLiked}
          canPlayPrevious={currentIndex > 0}
          canPlayNext={currentIndex >= 0 && currentIndex < results.length - 1}
          onToggleLike={() => setIsLiked((liked) => !liked)}
          onTogglePlayback={() => void player.toggle()}
          onSeek={player.seek.bind(player)}
          onPlayPrevious={() => playRelative(-1)}
          onPlayNext={() => playRelative(1)}
          onChooseTrack={chooseTrack}
        />
      </Drawer>
      <SystemSettingsDrawer open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </TooltipProvider>
  );
}

/**
 * 渲染首页的最近入库专辑，并允许用户打开任一专辑详情。
 * @param onOpenAlbum 收到专辑 ID 后切换到专辑详情页的回调。
 * @returns 首页最近专辑区域的 React 元素。
 */
function HomeView({ onOpenAlbum }: { onOpenAlbum: (albumId: string) => void }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(undefined);
    getRecentAlbums(controller.signal)
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
    <section className="mt-8" aria-labelledby="recent-albums-heading">
      <h2 id="recent-albums-heading" className="text-sm font-semibold">最近入库</h2>
      {isLoading ? (
        <div className="mt-3 flex gap-3 overflow-hidden" role="status" aria-label="正在加载最近入库的专辑">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="w-2/5 shrink-0">
              <Skeleton className="aspect-square w-full" />
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
              <CarouselItem key={album.id} className="basis-2/5 pl-3">
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
 * 渲染可点击的专辑封面卡片，供首页和歌手详情页共用。
 * @param album 要展示的专辑资料。
 * @param onOpenAlbum 收到专辑 ID 后打开详情页的回调。
 * @returns 使用 shadcn Card（卡片）组合的专辑入口。
 */
function AlbumCard({ album, onOpenAlbum }: { album: Album; onOpenAlbum: (albumId: string) => void }) {
  return (
    <Button
      variant="ghost"
      className="h-auto w-full p-0 text-left"
      aria-label={`打开专辑《${album.title}》`}
      onClick={() => onOpenAlbum(album.id)}
    >
      <Card size="xs" className="h-full w-full rounded-md py-0 ring-0">
        <AlbumArtworkImage album={album} />
        <CardHeader className="gap-0.5 px-0 pb-3">
          <CardTitle className="truncate">{album.title}</CardTitle>
          <CardDescription className="truncate">{artistNames(album.artists)}</CardDescription>
        </CardHeader>
      </Card>
    </Button>
  );
}

/**
 * 请求并渲染一个专辑的基础资料与曲目列表。
 * @param albumId 需要加载的专辑 ID。
 * @param activeTrackId 当前正在播放曲目的 ID，用于突出显示列表项。
 * @param onChooseTrack 选择一首曲目开始播放的回调。
 * @param onOpenArtist 打开歌手详情页的回调。
 * @returns 专辑详情的 React 元素，包含加载、错误和正常状态。
 */
function AlbumDetailView({
  albumId,
  activeTrackId,
  onChooseTrack,
  onOpenArtist,
}: {
  albumId: string;
  activeTrackId?: string;
  onChooseTrack: (track: Track) => void;
  onOpenArtist: (artistId: string) => void;
}) {
  const [detail, setDetail] = useState<AlbumDetail>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

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

  if (isLoading) return <DetailLoading label="正在加载专辑" />;
  if (error || !detail) return <DetailEmpty title="专辑加载失败" description={error ?? '未找到可播放的专辑'} />;

  return (
    <section className="mt-8" aria-labelledby="album-title">
      <div className="flex items-start gap-4">
        <AlbumArtworkImage album={detail} className="size-32 shrink-0 rounded-md object-cover" />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-xs text-muted-foreground">专辑</p>
          <h2 id="album-title" className="mt-1 line-clamp-2 text-xl font-semibold">{detail.title}</h2>
          <ArtistLinks artists={detail.artists} onOpenArtist={onOpenArtist} />
          <Badge className="mt-3" variant="secondary">{detail.tracks.length} 首</Badge>
        </div>
      </div>

      <Separator className="my-6" />
      <h3 className="text-sm font-semibold">曲目</h3>
      <ItemGroup className="mt-2 gap-0">
        {detail.tracks.map((track) => (
          <Item
            key={track.id}
            render={<button type="button" onClick={() => onChooseTrack(track)} aria-label={`播放《${track.title}》`} />}
            variant={activeTrackId === track.id ? 'muted' : 'default'}
            className="cursor-pointer rounded-none border-b px-0 py-3 last:border-b-0"
          >
            <ItemMedia variant="icon"><Disc3 aria-hidden="true" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{track.title}</ItemTitle>
              <ItemDescription>{artistNames(track.artists)}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <span className="text-xs text-muted-foreground">{formatTime(track.durationMs)}</span>
              <Play aria-hidden="true" />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
}

/**
 * 请求并渲染一个歌手及其参与的专辑。
 * @param artistId 需要加载的歌手 ID。
 * @param onOpenAlbum 收到专辑 ID 后打开详情页的回调。
 * @returns 歌手详情的 React 元素，包含加载、错误和正常状态。
 */
function ArtistDetailView({ artistId, onOpenAlbum }: { artistId: string; onOpenAlbum: (albumId: string) => void }) {
  const [detail, setDetail] = useState<ArtistDetail>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(undefined);
    setDetail(undefined);
    getArtistDetail(artistId, controller.signal)
      .then(setDetail)
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : '歌手加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [artistId]);

  if (isLoading) return <DetailLoading label="正在加载歌手" />;
  if (error || !detail) return <DetailEmpty title="歌手加载失败" description={error ?? '未找到可播放的作品'} />;

  return (
    <section className="mt-8" aria-labelledby="artist-name">
      <div className="flex items-center gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden="true">
          <UserRound />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">歌手</p>
          <h2 id="artist-name" className="mt-1 truncate text-xl font-semibold">{detail.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{detail.albums.length} 张专辑</p>
        </div>
      </div>

      <Separator className="my-6" />
      <h3 className="text-sm font-semibold">专辑</h3>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {detail.albums.map((album) => <AlbumCard key={album.id} album={album} onOpenAlbum={onOpenAlbum} />)}
      </div>
    </section>
  );
}

/**
 * 渲染详情页请求期间的固定尺寸骨架屏，避免内容加载后发生布局跳动。
 * @param label 供辅助技术读取的加载状态说明。
 * @returns 详情页骨架屏的 React 元素。
 */
function DetailLoading({ label }: { label: string }) {
  return (
    <section className="mt-8" aria-label={label} role="status">
      <div className="flex items-start gap-4">
        <Skeleton className="size-32 shrink-0 rounded-md" />
        <div className="flex flex-1 flex-col gap-3 pt-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-4 w-2/5" />
        </div>
      </div>
      <div className="mt-8 flex flex-col gap-1">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-14 w-full" />)}
      </div>
    </section>
  );
}

/**
 * 渲染详情页请求失败或资源不存在时的空状态。
 * @param title 空状态的标题。
 * @param description 对失败原因或下一步的简短说明。
 * @returns 使用 shadcn Empty（空状态）组合的 React 元素。
 */
function DetailEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="mt-8 border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Disc3 aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * 将专辑歌手渲染为可打开的文本按钮，并在多位歌手之间提供分隔符。
 * @param artists 要显示的歌手引用列表。
 * @param onOpenArtist 收到歌手 ID 后打开详情页的回调。
 * @returns 可换行的歌手导航元素。
 */
function ArtistLinks({ artists, onOpenArtist }: { artists: ArtistRef[]; onOpenArtist: (artistId: string) => void }) {
  if (artists.length === 0) return <p className="mt-2 text-sm text-muted-foreground">未知歌手</p>;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
      {artists.map((artist, index) => (
        <span key={artist.id} className="flex items-center gap-1">
          {index > 0 && <span className="text-sm text-muted-foreground">/</span>}
          <Button variant="link" className="h-auto p-0 text-sm" onClick={() => onOpenArtist(artist.id)}>
            {artist.name}
          </Button>
        </span>
      ))}
    </div>
  );
}

function NowPlayingDrawer({
  playback,
  queue,
  isLiked,
  canPlayPrevious,
  canPlayNext,
  onToggleLike,
  onTogglePlayback,
  onSeek,
  onPlayPrevious,
  onPlayNext,
  onChooseTrack,
}: {
  playback: PlayerSnapshot;
  queue: Track[];
  isLiked: boolean;
  canPlayPrevious: boolean;
  canPlayNext: boolean;
  onToggleLike: () => void;
  onTogglePlayback: () => void;
  onSeek: (positionMs: number) => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onChooseTrack: (track: Track) => void;
}) {
  const [showLyrics, setShowLyrics] = useState(false);
  const duration = Math.max(playback.durationMs, 0);
  const position = Math.min(playback.positionMs, duration || playback.positionMs);
  const isPlaying = playback.status === 'playing';
  const playbackLabel = isPlaying ? '暂停播放' : '开始播放';
  return (
    <DrawerContent className="h-[calc(100dvh-0.5rem)] max-h-[calc(100dvh-0.5rem)]">
      <DrawerHeader className="mx-auto w-full max-w-xl flex-row items-center gap-2 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)] text-left">
        <DrawerClose
          render={
            <Button variant="ghost" size="icon" aria-label="收起播放器">
              <ChevronDown aria-hidden="true" />
            </Button>
          }
        />
        <DrawerTitle className="min-w-0 flex-1 text-center text-sm">正在播放</DrawerTitle>
        <span className="size-8 shrink-0" aria-hidden="true" />
      </DrawerHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <section className="mx-auto w-full max-w-xl" aria-labelledby="now-playing-heading">
          <div className="mx-auto mt-2 aspect-square w-full max-w-md overflow-hidden rounded-lg bg-muted">
            {showLyrics ? (
              <LyricsPanel track={playback.track} positionMs={position} />
            ) : (
              <ArtworkImage track={playback.track} size={1024} className="size-full object-cover" />
            )}
          </div>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="now-playing-heading" className="truncate text-lg font-semibold">{playback.track?.title ?? '未在播放'}</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">{artistLine(playback.track)}</p>
              {playback.error && <p className="mt-2 text-sm text-destructive">{playback.error}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Tooltip>
                <TooltipTrigger render={<Button variant={isLiked ? 'secondary' : 'ghost'} size="icon" aria-label={isLiked ? '取消喜欢' : '喜欢这首歌'} aria-pressed={isLiked} disabled={!playback.track} onClick={onToggleLike}><Heart aria-hidden="true" /></Button>} />
                <TooltipContent>{isLiked ? '取消喜欢' : '喜欢这首歌'}</TooltipContent>
              </Tooltip>
              <div className="h-5">
                {playback.source && <Badge variant="secondary">{playbackSourceLabel(playback.source)}</Badge>}
              </div>
            </div>
          </div>
          <div className="mt-6">
            <Slider
              aria-label="播放进度"
              min={0}
              max={Math.max(duration, 1)}
              step={1000}
              value={position}
              disabled={!playback.track || duration <= 0}
              onValueChange={(value) => onSeek(Array.isArray(value) ? (value[0] ?? 0) : value)}
            />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{formatTime(position)}</span><span>{formatTime(duration)}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center">
            <span aria-hidden="true" />
            <div className="flex items-center justify-center gap-6">
              <PlayerButton label="上一首" disabled={!canPlayPrevious} onClick={onPlayPrevious}><SkipBack aria-hidden="true" /></PlayerButton>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="secondary" size="icon-lg" aria-label={playbackLabel} aria-pressed={isPlaying} disabled={!playback.track || playback.status === 'loading'} onClick={onTogglePlayback}>
                      {playback.status === 'loading' ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                    </Button>
                  }
                />
                <TooltipContent>{playbackLabel}</TooltipContent>
              </Tooltip>
              <PlayerButton label="下一首" disabled={!canPlayNext} onClick={onPlayNext}><SkipForward aria-hidden="true" /></PlayerButton>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant={showLyrics ? 'secondary' : 'ghost'}
                    size="icon"
                    className="justify-self-end"
                    aria-label={showLyrics ? '显示专辑封面' : '显示歌词'}
                    aria-pressed={showLyrics}
                    disabled={!playback.track}
                    onClick={() => setShowLyrics((visible) => !visible)}
                  >
                    词
                  </Button>
                }
              />
              <TooltipContent>{showLyrics ? '显示专辑封面' : '显示歌词'}</TooltipContent>
            </Tooltip>
          </div>
          <Separator className="my-8" />
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">接下来</h2>
            <span className="text-xs text-muted-foreground">{queue.length} 首</span>
          </div>
          <div className="mt-2">
            {queue.map((track) => <QueueItem key={track.id} track={track} onChooseTrack={onChooseTrack} />)}
            {queue.length === 0 && <p className="py-6 text-sm text-muted-foreground">暂无曲目</p>}
          </div>
        </section>
      </div>
    </DrawerContent>
  );
}

function LyricsPanel({ track, positionMs }: { track?: Track; positionMs: number }) {
  const [document, setDocument] = useState<LyricsDocument>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [isFollowing, setIsFollowing] = useState(true);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef(new Map<number, HTMLParagraphElement>());
  const resumeTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    lineRefs.current.clear();
    setDocument(undefined);
    setError(undefined);
    setIsFollowing(true);
    if (resumeTimerRef.current !== undefined) window.clearTimeout(resumeTimerRef.current);
    if (!track) {
      setIsLoading(false);
      return () => controller.abort();
    }
    setIsLoading(true);
    getTrackLyrics(track.id, controller.signal)
      .then(setDocument)
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        if (loadError instanceof ApiError && loadError.status === 404) {
          setError('暂无歌词');
          return;
        }
        setError(loadError instanceof Error ? loadError.message : '歌词加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [track]);

  useEffect(() => () => {
    if (resumeTimerRef.current !== undefined) window.clearTimeout(resumeTimerRef.current);
  }, []);

  const activeLineIndex = useMemo(() => {
    if (!document?.synced) return -1;
    let active = -1;
    for (let index = 0; index < document.lines.length; index += 1) {
      const startMs = document.lines[index].startMs;
      if (startMs === undefined || startMs > positionMs) break;
      active = index;
    }
    return active;
  }, [document, positionMs]);

  const scrollToLine = useCallback((index: number, behavior: ScrollBehavior) => {
    const root = scrollAreaRef.current;
    const line = lineRefs.current.get(index);
    const viewport = root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport || !line) return;
    const viewportBounds = viewport.getBoundingClientRect();
    const lineBounds = line.getBoundingClientRect();
    viewport.scrollTo({
      top: viewport.scrollTop + lineBounds.top - viewportBounds.top - (viewport.clientHeight - lineBounds.height) / 2,
      behavior,
    });
  }, []);

  useEffect(() => {
    if (isFollowing && activeLineIndex >= 0) {
      scrollToLine(activeLineIndex, 'smooth');
    }
  }, [activeLineIndex, isFollowing, scrollToLine]);

  const pauseFollowing = useCallback(() => {
    setIsFollowing(false);
    if (resumeTimerRef.current !== undefined) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => setIsFollowing(true), 3_000);
  }, []);

  if (isLoading) {
    return (
      <div className="flex size-full flex-col justify-center gap-5 px-6" role="status" aria-label="正在加载歌词">
        {[0, 1, 2, 3, 4].map((item) => <Skeleton key={item} className="mx-auto h-5 w-4/5" />)}
      </div>
    );
  }

  if (error || !document || document.lines.length === 0) {
    return (
      <Empty className="size-full border-0 p-6">
        <EmptyHeader>
          <EmptyTitle>{error ?? '暂无歌词'}</EmptyTitle>
          <EmptyDescription>可以在系统设置中运行歌词扫描</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ScrollArea
      ref={scrollAreaRef}
      className="size-full"
      aria-label={`${track?.title ?? ''}歌词`}
      onPointerDown={pauseFollowing}
      onTouchMove={pauseFollowing}
      onWheel={pauseFollowing}
    >
      <div className="flex min-h-full flex-col gap-5 px-6 py-[42%] text-center">
        {document.lines.map((line, index) => (
          <p
            key={`${line.startMs ?? 'plain'}-${index}`}
            ref={(element) => {
              if (element) lineRefs.current.set(index, element);
              else lineRefs.current.delete(index);
            }}
            className={cn(
              'text-base leading-relaxed transition-colors',
              index === activeLineIndex ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
            aria-current={index === activeLineIndex ? 'true' : undefined}
          >
            {line.text}
          </p>
        ))}
      </div>
    </ScrollArea>
  );
}

function SearchView({ query, results, isSearching, error, activeTrackId, onQueryChange, onChooseTrack }: {
  query: string;
  results: Track[];
  isSearching: boolean;
  error?: string;
  activeTrackId?: string;
  onQueryChange: (query: string) => void;
  onChooseTrack: (track: Track) => void;
}) {
  return (
    <section className="mt-8" aria-labelledby="search-heading">
      <h2 id="search-heading" className="sr-only">搜索音乐</h2>
      <label className="sr-only" htmlFor="music-search">搜索歌曲、专辑或艺人</label>
      <Input id="music-search" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索歌曲、专辑或艺人" />
      <div className="mt-8 flex items-center gap-2">
        {isSearching ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" /> : <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />}
        <h2 className="text-sm font-semibold">{query.trim() ? '搜索结果' : '曲库'}</h2>
      </div>
      <div className="mt-2">
        {error ? <p className="py-8 text-center text-sm text-destructive">{error}</p> : !isSearching && results.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">没有找到匹配的音乐</p> : results.map((track) => (
          <Button key={track.id} variant={activeTrackId === track.id ? 'secondary' : 'ghost'} className="h-auto w-full justify-start rounded-none px-2 py-3 text-left" onClick={() => onChooseTrack(track)}>
            <ArtworkImage track={track} size={128} className="size-10 shrink-0 rounded-md object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{track.title}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{artistLine(track)} · {track.album.title}</span>
            </span>
            <Play data-icon="inline-end" aria-hidden="true" />
          </Button>
        ))}
      </div>
    </section>
  );
}

function LibraryView({ onOpenSystemSettings }: { onOpenSystemSettings: () => void }) {
  return (
    <section className="mt-8" aria-labelledby="library-heading">
      <h2 id="library-heading" className="text-sm font-semibold">我的音乐</h2>
      <div className="mt-3">
        {libraryItems.map((item) => (
          <Button key={item.title} variant="ghost" className="h-auto w-full justify-start rounded-none px-0 py-4 text-left" disabled>
            <LibraryBig data-icon="inline-start" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span></span>
          </Button>
        ))}
      </div>
      <Separator className="my-8" />
      <h2 className="text-sm font-semibold">设置</h2>
      <ItemGroup className="mt-3 gap-0">
        <Item
          render={<button type="button" onClick={onOpenSystemSettings} />}
          className="cursor-pointer rounded-none px-0 py-4 hover:bg-muted/50"
        >
          <ItemMedia variant="icon"><Settings aria-hidden="true" /></ItemMedia>
          <ItemContent><ItemTitle>系统设置</ItemTitle></ItemContent>
          <ItemActions><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></ItemActions>
        </Item>
      </ItemGroup>
    </section>
  );
}

function SystemSettingsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [view, setView] = useState<'root' | 'tasks'>('root');
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    if (!open || view !== 'tasks') return;
    const controller = new AbortController();
    let timer: number | undefined;
    setIsLoading(true);
    setError(undefined);

    const load = async () => {
      try {
        const page = await getScheduledTasks(controller.signal);
        if (controller.signal.aborted) return;
        setScheduledTasks(page.items);
        setIsLoading(false);
        if (page.items.some((task) => task.status === 'running')) {
          timer = window.setTimeout(load, 750);
        }
      } catch (loadError: unknown) {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : '计划任务加载失败');
        setIsLoading(false);
      }
    };

    void load();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open, refreshVersion, view]);

  const changeOpen = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) setView('root');
  };

  const runTask = async (task: ScheduledTask) => {
    setError(undefined);
    setScheduledTasks((items) => items.map((item) => item.id === task.id ? { ...item, status: 'running' } : item));
    try {
      const runningTask = await runScheduledTask(task.id);
      setScheduledTasks((items) => items.map((item) => item.id === task.id ? runningTask : item));
      setRefreshVersion((version) => version + 1);
    } catch (runError: unknown) {
      setError(runError instanceof Error ? runError.message : '计划任务执行失败');
      setRefreshVersion((version) => version + 1);
    }
  };

  return (
    <Drawer open={open} onOpenChange={changeOpen} swipeDirection="down">
      <DrawerContent className="h-[calc(100dvh-0.5rem)] max-h-[calc(100dvh-0.5rem)]">
        <DrawerHeader className="mx-auto w-full max-w-xl flex-row items-center gap-2 px-4 pb-2 pt-3 text-left">
          {view === 'root' ? (
            <DrawerClose
              render={<Button variant="ghost" size="icon" aria-label="退出系统设置"><ChevronDown aria-hidden="true" /></Button>}
            />
          ) : (
            <Button variant="ghost" size="icon" aria-label="返回系统设置" onClick={() => setView('root')}>
              <ArrowLeft aria-hidden="true" />
            </Button>
          )}
          <DrawerTitle className="min-w-0 flex-1 text-center text-sm">{view === 'root' ? '系统设置' : '计划任务'}</DrawerTitle>
          <span className="size-8 shrink-0" aria-hidden="true" />
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
          <section className="mx-auto w-full max-w-xl" aria-label={view === 'root' ? '系统设置项目' : '计划任务列表'}>
            {view === 'root' ? (
              <ItemGroup className="gap-0">
                <Item
                  render={<button type="button" onClick={() => setView('tasks')} />}
                  className="cursor-pointer rounded-none px-0 py-4 hover:bg-muted/50"
                >
                  <ItemMedia variant="icon"><CalendarClock aria-hidden="true" /></ItemMedia>
                  <ItemContent><ItemTitle>计划任务</ItemTitle></ItemContent>
                  <ItemActions><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></ItemActions>
                </Item>
              </ItemGroup>
            ) : (
              <ScheduledTaskList tasks={scheduledTasks} isLoading={isLoading} error={error} onRunTask={runTask} />
            )}
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function ScheduledTaskList({ tasks, isLoading, error, onRunTask }: {
  tasks: ScheduledTask[];
  isLoading: boolean;
  error?: string;
  onRunTask: (task: ScheduledTask) => void;
}) {
  if (isLoading && tasks.length === 0) {
    return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />正在加载</div>;
  }

  return (
    <>
      {error && <p className="pb-3 text-sm text-destructive">{error}</p>}
      <ItemGroup className="gap-0">
        {tasks.map((task) => (
          <Item key={task.id} className="rounded-none border-b px-0 py-4 last:border-b-0">
            <ItemContent>
              <ItemTitle className="text-base font-semibold">{task.name}</ItemTitle>
              <ItemDescription className="text-xs">{scheduledTaskDetail(task)}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label={`立即执行${task.name}`}
                      disabled={task.status === 'running'}
                      onClick={() => onRunTask(task)}
                    >
                      {task.status === 'running' ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
                    </Button>
                  }
                />
                <TooltipContent>{task.status === 'running' ? '正在执行' : '立即执行'}</TooltipContent>
              </Tooltip>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {!isLoading && !error && tasks.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">暂无计划任务</p>}
    </>
  );
}

function QueueItem({ track, onChooseTrack }: { track: Track; onChooseTrack: (track: Track) => void }) {
  return (
    <Button variant="ghost" className="h-auto w-full justify-start rounded-none border-b px-0 py-3 text-left last:border-b-0" onClick={() => onChooseTrack(track)}>
      <ArtworkImage track={track} size={128} className="size-10 shrink-0 rounded-md object-cover" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{track.title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{artistLine(track)}</span></span>
    </Button>
  );
}

function ArtworkImage({ track, size, className }: { track?: Track; size: 128 | 256 | 512 | 1024; className: string }) {
  const source = artworkUrl(track?.artworkId, size);
  const [failedSource, setFailedSource] = useState<string>();
  return (
    <img
      className={className}
      src={source && source !== failedSource ? source : nowPlayingCover}
      alt={track ? `《${track.title}》专辑封面` : '默认专辑封面'}
      onError={() => source && setFailedSource(source)}
    />
  );
}

/**
 * 渲染专辑封面，并在服务端封面不可用时回退到本地默认图片。
 * @param album 要展示的专辑资料。
 * @param className 用于约束封面尺寸和圆角的可选布局类名。
 * @returns 专辑封面的 img 元素。
 */
function AlbumArtworkImage({ album, className = 'aspect-square w-full bg-muted object-cover' }: { album: Album; className?: string }) {
  const source = artworkUrl(album.artworkId, 512);
  const [failedSource, setFailedSource] = useState<string>();
  return (
    <img
      className={className}
      src={source && source !== failedSource ? source : nowPlayingCover}
      alt={`《${album.title}》专辑封面`}
      onError={() => source && setFailedSource(source)}
    />
  );
}

function PlayerButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function artistLine(track?: Track): string {
  return track ? artistNames(track.artists) : 'Rime Music';
}

function artistNames(artists: ArtistRef[]): string {
  return artists.map((artist) => artist.name).join(' / ') || 'Unknown Artist';
}

function formatTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '0:00';
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function scheduledTaskDetail(task: ScheduledTask): string {
  if (!task.lastRunAt || task.lastDurationMs === undefined) {
    return task.status === 'running' ? '正在执行' : '尚未执行';
  }
  const runAt = new Date(task.lastRunAt);
  const formattedRunAt = Number.isNaN(runAt.getTime())
    ? task.lastRunAt
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(runAt);
  const status = task.status === 'running' ? '正在执行 · ' : '';
  const result = task.lastSucceeded === false ? ' · 上次执行失败' : '';
  return `${status}上次执行：${formattedRunAt} · 耗时 ${formatDuration(task.lastDurationMs)}${result}`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} 毫秒`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} 秒`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

function playbackSourceLabel(source: NonNullable<PlayerSnapshot['source']>): string {
  const format = source.container.toUpperCase();
  return source.bitrateKbps ? `${format} · ${source.bitrateKbps} kbps` : format;
}
