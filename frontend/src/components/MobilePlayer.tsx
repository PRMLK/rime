import {
  ArrowPathRoundedSquareIcon as RepeatOutlineIcon,
  BackwardIcon as BackwardOutlineIcon,
  ForwardIcon as ForwardOutlineIcon,
  HomeIcon as HomeOutlineIcon,
  ListBulletIcon as QueueOutlineIcon,
  MagnifyingGlassIcon as SearchOutlineIcon,
  UserIcon as UserOutlineIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolidIcon,
  PauseIcon as PauseSolidIcon,
  PlayIcon as PlaySolidIcon,
  UserIcon as UserSolidIcon,
} from '@heroicons/react/24/solid';
import {
  ArrowLeft, CalendarClock, ChevronDown, ChevronRight, Disc3, Heart, LibraryBig,
  LoaderCircle, MoreHorizontal, Pause, Play, Settings, SkipBack, SkipForward, Sparkles, UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import {
  ApiError, artworkUrl, getAlbumDetail, getArtistDetail, getRecentAlbums, getScheduledTasks, getTrackLyrics, runScheduledTask, searchTracks,
  type Album, type AlbumDetail, type ArtistDetail, type ArtistRef, type LyricsDocument, type ScheduledTask, type Track,
} from '@/api/rime';
import { AlbumArtwork, AlbumArtworkFrame, AlbumArtworkSkeleton } from '@/components/AlbumArtwork';
import { AlbumArtworkCard } from '@/components/AlbumArtworkCard';
import { AlbumVinylArtwork } from '@/components/AlbumVinylArtwork';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle,
} from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getArtworkAccentColor } from '@/lib/artwork-color';
import { cn } from '@/lib/utils';
import { HtmlAudioPlayer, type PlayerSnapshot } from '@/services/player/HtmlAudioPlayer';

type NavigationTab = 'home' | 'search' | 'library';
type PlaybackMode = 'sequence' | 'repeat';

type DetailView =
  | { kind: 'album'; id: string }
  | { kind: 'artist'; id: string }
  | { kind: 'recent-albums' };

const navigationItems = [
  { id: 'home', label: '首页', icon: HomeOutlineIcon, activeIcon: HomeSolidIcon, activeStrokeWidth: undefined },
  { id: 'search', label: '搜索', icon: SearchOutlineIcon, activeIcon: SearchOutlineIcon, activeStrokeWidth: 2.75 },
  { id: 'library', label: '我的', icon: UserOutlineIcon, activeIcon: UserSolidIcon, activeStrokeWidth: undefined },
] as const;

const miniPlayerControlClassName = [
  'relative size-11 rounded-full border-transparent bg-transparent hover:bg-transparent active:!translate-y-0',
  'focus-visible:border-transparent focus-visible:ring-0',
  'before:pointer-events-none before:absolute before:inset-2 before:rounded-full before:bg-foreground/8',
  'before:scale-75 before:opacity-0 before:transition-[opacity,transform] before:duration-150 before:ease-out',
  'hover:before:opacity-100 active:before:scale-95 active:before:opacity-100',
  'focus-visible:before:scale-100 focus-visible:before:opacity-100 focus-visible:before:ring-2 focus-visible:before:ring-ring/50',
  'motion-reduce:before:transition-none [&_svg]:relative [&_svg]:z-10',
].join(' ');

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
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('sequence');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [searchError, setSearchError] = useState<string>();
  const [detailStack, setDetailStack] = useState<DetailView[]>([]);
  const activeLabel = navigationItems.find((item) => item.id === activeTab)?.label ?? '首页';
  const activeDetail = detailStack[detailStack.length - 1];
  const pageLabel = activeDetail?.kind === 'album'
    ? '专辑'
    : activeDetail?.kind === 'artist'
      ? '歌手'
      : activeDetail?.kind === 'recent-albums'
        ? '最近入库'
        : activeLabel;
  const isPlaying = playback.status === 'playing';
  const playbackLabel = isPlaying ? '暂停播放' : '开始播放';
  const playbackModeLabel = playbackMode === 'sequence' ? '顺序播放' : '单曲循环';
  const PlaybackModeIcon = playbackMode === 'sequence' ? QueueOutlineIcon : RepeatOutlineIcon;
  const playbackProgress = playback.durationMs > 0
    ? Math.min((playback.positionMs / playback.durationMs) * 100, 100)
    : 0;
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

  const chooseTrack = useCallback(async (track: Track) => {
    try {
      await player.load(track);
    } catch {
      // The player state exposes the actionable error next to the track.
    }
  }, [player]);

  const playRelative = useCallback((offset: number) => {
    if (currentIndex < 0) return;
    const track = results[currentIndex + offset];
    if (track) void chooseTrack(track);
  }, [chooseTrack, currentIndex, results]);

  useEffect(() => player.subscribeToEnded(() => {
    if (playbackMode === 'repeat' && playback.track) {
      void chooseTrack(playback.track);
      return;
    }
    playRelative(1);
  }), [chooseTrack, playback.track, playbackMode, playRelative, player]);

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
   * 打开最近入库完整列表，保留首页在浏览栈中以支持返回。
   * @returns 无返回值；状态更新后界面显示最多 50 张最近入库专辑。
   */
  const openRecentAlbums = useCallback(() => {
    setDetailStack((stack) => [...stack, { kind: 'recent-albums' }]);
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
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as NavigationTab);
            setDetailStack([]);
          }}
          className="h-[100dvh] gap-0 overflow-hidden bg-background text-foreground"
        >
          <main className="min-h-0 flex-1 overflow-y-auto px-5 pt-6">
            <div className="mx-auto w-full max-w-xl pb-8">
              {activeDetail?.kind !== 'album' && (
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
              )}

              {activeDetail ? (
                <TabsContent value={activeTab}>
                  {activeDetail.kind === 'album' && (
                    <AlbumDetailView
                      albumId={activeDetail.id}
                      activeTrackId={playback.track?.id}
                      onChooseTrack={chooseTrack}
                      onOpenArtist={openArtist}
                      onClose={closeDetail}
                    />
                  )}
                  {activeDetail.kind === 'artist' && <ArtistDetailView artistId={activeDetail.id} onOpenAlbum={openAlbum} />}
                  {activeDetail.kind === 'recent-albums' && <RecentAlbumsView onOpenAlbum={openAlbum} />}
                </TabsContent>
              ) : (
                <>
                  <TabsContent value="home"><HomeView onOpenAlbum={openAlbum} onOpenRecentAlbums={openRecentAlbums} /></TabsContent>
                  <TabsContent value="search">
                    <SearchView
                      query={query}
                      results={results}
                      isSearching={isSearching}
                      error={searchError}
                      activeTrackId={playback.track?.id}
                      onQueryChange={setQuery}
                      onChooseTrack={chooseTrack}
                    />
                  </TabsContent>
                  <TabsContent value="library">
                    <LibraryView onOpenSystemSettings={() => setIsSettingsOpen(true)} />
                  </TabsContent>
                </>
              )}
            </div>
          </main>

          <footer className="shrink-0 border-t bg-background">
            <section className="mx-auto grid w-full max-w-xl grid-rows-[2.75rem_2.75rem] px-4" aria-label="正在播放">
              <div className="flex min-w-0 items-center gap-3">
                <DrawerTrigger
                  render={
                    <Button
                      variant="ghost"
                      className="relative h-11 min-w-0 flex-1 items-center justify-start px-0 py-0 text-left hover:bg-transparent active:!translate-y-0 focus-visible:border-transparent focus-visible:ring-0 before:pointer-events-none before:absolute before:left-0 before:top-1.5 before:z-0 before:size-10 before:rounded-[clamp(0.5rem,10%,2rem)] before:bg-foreground/8 before:scale-90 before:opacity-0 before:transition-[opacity,transform] before:duration-150 before:ease-out active:before:scale-100 active:before:opacity-100 focus-visible:before:scale-100 focus-visible:before:ring-2 focus-visible:before:ring-ring/50 motion-reduce:before:transition-none"
                      disabled={!playback.track}
                      aria-label={playback.track ? `展开《${playback.track.title}》播放器` : '暂无播放曲目'}
                    />
                  }
                >
                  <AlbumArtwork artwork={playback.track} size="sm" className="relative z-10 translate-y-1" />
                  <span className="relative z-10 min-w-0 translate-y-1 flex-1 self-center">
                    <span className="block truncate text-[0.8125rem] leading-4 font-medium">{playback.track?.title ?? '未在播放'}</span>
                    <span className="block truncate text-[0.625rem] leading-3 text-muted-foreground">{artistLine(playback.track)}</span>
                    <span className="block truncate text-[0.625rem] leading-3 text-muted-foreground">No lyrics</span>
                  </span>
                </DrawerTrigger>
                <div className="flex shrink-0 items-center">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          className={miniPlayerControlClassName}
                          aria-label={playbackModeLabel}
                          aria-pressed={playbackMode === 'repeat'}
                          onClick={() => setPlaybackMode((mode) => mode === 'sequence' ? 'repeat' : 'sequence')}
                        >
                          <PlaybackModeIcon aria-hidden="true" strokeWidth={2} />
                        </Button>
                      }
                    />
                    <TooltipContent>{playbackModeLabel}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          className={miniPlayerControlClassName}
                          aria-label={playbackLabel}
                          aria-pressed={isPlaying}
                          disabled={!playback.track || playback.status === 'loading'}
                          onClick={() => void player.toggle()}
                        >
                          {playback.status === 'loading'
                            ? <LoaderCircle className="animate-spin" aria-hidden="true" />
                            : isPlaying
                              ? <PauseSolidIcon aria-hidden="true" />
                              : <PlaySolidIcon aria-hidden="true" />}
                        </Button>
                      }
                    />
                    <TooltipContent>{playbackLabel}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="grid grid-cols-[2.75rem_auto_minmax(0,1fr)_auto_2.75rem] items-center gap-2">
                <PlayerButton className={cn(miniPlayerControlClassName, 'before:translate-y-2 [&_svg]:translate-y-2')} label="上一首" disabled={currentIndex <= 0} onClick={() => playRelative(-1)}><BackwardOutlineIcon aria-hidden="true" strokeWidth={2} /></PlayerButton>
                <span className="translate-y-2 text-right text-[0.625rem] tabular-nums text-muted-foreground">{formatTime(playback.positionMs)}</span>
                <span className="h-0.5 translate-y-2 rounded-full bg-border" aria-hidden="true">
                  <span className="block h-full rounded-full bg-foreground" style={{ width: `${playbackProgress}%` }} />
                </span>
                <span className="translate-y-2 text-[0.625rem] tabular-nums text-muted-foreground">{formatTime(playback.durationMs)}</span>
                <PlayerButton className={cn(miniPlayerControlClassName, 'before:translate-y-2 [&_svg]:translate-y-2')} label="下一首" disabled={currentIndex < 0 || currentIndex >= results.length - 1} onClick={() => playRelative(1)}><ForwardOutlineIcon aria-hidden="true" strokeWidth={2} /></PlayerButton>
              </div>
            </section>
            <Separator />
            <nav className="mx-auto w-full max-w-xl pb-[max(env(safe-area-inset-bottom),0rem)]" aria-label="主导航">
              <TabsList variant="line" size="mobile">
                {navigationItems.map((item) => {
                  const isActive = activeTab === item.id;
                  const Icon = isActive ? item.activeIcon : item.icon;
                  return (
                    <TabsTrigger key={item.id} value={item.id} variant="mobile">
                      <span data-slot="mobile-tab-icon"><Icon aria-hidden="true" strokeWidth={isActive ? item.activeStrokeWidth : 2} /></span>
                      <span data-slot="mobile-tab-label">{item.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </nav>
          </footer>
        </Tabs>

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
 * @param onOpenRecentAlbums 打开最近入库完整列表的回调。
 * @returns 首页最近专辑区域的 React 元素。
 */
function HomeView({
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
    getRecentAlbums(12, controller.signal)
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
    <section className="mt-6" aria-labelledby="recent-albums-heading">
      <h2 id="recent-albums-heading">
        <Button variant="ghost" className="h-auto gap-0 p-0 text-sm font-semibold" onClick={onOpenRecentAlbums}>
          最近入库
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        </Button>
      </h2>
      {isLoading ? (
        <div className="mt-3 flex gap-3 overflow-hidden" role="status" aria-label="正在加载最近入库的专辑">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="w-2/5 shrink-0">
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
 * 渲染最近入库的完整专辑网格，供首页标题入口打开。
 * @param onOpenAlbum 收到专辑 ID 后打开对应专辑详情页的回调。
 * @returns 最近入库的加载、空状态或最多 50 张专辑的网格。
 */
function RecentAlbumsView({ onOpenAlbum }: { onOpenAlbum: (albumId: string) => void }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(undefined);
    getRecentAlbums(50, controller.signal)
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

  if (isLoading) {
    return (
      <section className="mt-8" aria-label="正在加载最近入库的专辑" role="status">
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item}>
              <AlbumArtworkSkeleton className="aspect-square w-full" />
              <Skeleton className="mt-3 h-3 w-4/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (error || albums.length === 0) {
    return <DetailEmpty title={error ? '最近入库加载失败' : '暂无最近入库的专辑'} description={error ?? '新入库的专辑将显示在这里'} />;
  }

  return (
    <section className="mt-8" aria-label="最近入库专辑">
      <div className="grid grid-cols-2 gap-3">
        {albums.map((album) => <AlbumCard key={album.id} album={album} onOpenAlbum={onOpenAlbum} />)}
      </div>
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
      className="h-auto w-full flex-col items-start justify-start gap-2 rounded-[calc(clamp(0.5rem,10%,2rem)+4px)] border-0 p-1 text-left"
      aria-label={`打开专辑《${album.title}》`}
      onClick={() => onOpenAlbum(album.id)}
    >
      <AlbumArtwork artwork={album} size="fluid" />
      <span className="flex w-full flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{album.title}</span>
        <span className="truncate text-xs text-muted-foreground">{artistNames(album.artists)}</span>
      </span>
    </Button>
  );
}

/**
 * 请求并渲染一个专辑的基础资料与曲目列表。
 * @param albumId 需要加载的专辑 ID。
 * @param activeTrackId 当前正在播放曲目的 ID，用于突出显示列表项。
 * @param onChooseTrack 选择一首曲目开始播放的回调。
 * @param onOpenArtist 打开歌手详情页的回调。
 * @param onClose 关闭当前专辑详情并返回浏览栈上一页的回调。
 * @returns 专辑详情的 React 元素，包含加载、错误和正常状态。
 */
function AlbumDetailView({
  albumId,
  activeTrackId,
  onChooseTrack,
  onOpenArtist,
  onClose,
}: {
  albumId: string;
  activeTrackId?: string;
  onChooseTrack: (track: Track) => void;
  onOpenArtist: (artistId: string) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AlbumDetail>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const artworkAccentColor = useAlbumArtworkAccentColor(detail?.artworkId);
  const albumHeroStyle = artworkAccentColor
    ? { '--album-detail-artwork-color': artworkAccentColor } as CSSProperties
    : undefined;

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

  if (isLoading) return <AlbumDetailLoading onClose={onClose} />;
  if (error || !detail) {
    return (
      <section className="mt-0">
        <AlbumDetailToolbar onClose={onClose} />
        <DetailEmpty title="专辑加载失败" description={error ?? '未找到可播放的专辑'} />
      </section>
    );
  }

  /*
   * 容器查询单位让头图的高度、封面、信息区起点及后续间距都以实际内容宽度为基准。
   * 576px 宽时与图二的横向比例一致；缩窄时所有关键位置连续等比收缩，
   * 不再通过 sm（小屏断点）切换到另一套纵向布局。
   */
  return (
    <section className="@container/album-detail mt-0 grid" aria-labelledby="album-title">
      <AlbumArtworkCard
        artworkOverflow="visible"
        className="album-detail-hero relative col-start-1 row-start-1 h-[33.333cqw] w-full gap-0 rounded-[1.736cqw] border py-0 ring-0"
        data-artwork-color={artworkAccentColor ? '' : undefined}
        style={albumHeroStyle}
      >
        <CardHeader className="gap-0 px-4 pt-0 pb-0">
          <AlbumDetailToolbar
            detail={detail}
            onClose={onClose}
            onChooseTrack={onChooseTrack}
            onOpenArtist={onOpenArtist}
            size="fluid"
          />
        </CardHeader>
        <CardContent className="absolute inset-x-0 bottom-0 translate-y-[9.722cqw] px-[2.778cqw] py-0">
          {/* 视觉区锚定在头图底部并下移；外层定位左对齐，组件内部保持封面与黑胶的相对布局。 */}
          <AlbumVinylArtwork artwork={detail} size="fluid" className="ml-[2.083cqw] mr-auto" />
        </CardContent>
      </AlbumArtworkCard>

      <div className="relative z-10 col-start-1 row-start-1 mt-[15.278cqw] mr-[2.778cqw] ml-[44.444cqw] flex min-w-0 self-start flex-col items-center gap-[1.389cqw] px-0 pt-0 text-center">
        <h2 id="album-title" className="line-clamp-2 text-[4.167cqw] leading-[5.556cqw] font-semibold">{detail.title}</h2>
        <div className="flex justify-center">
          <ArtistLinks artists={detail.artists} onOpenArtist={onOpenArtist} size="fluid" />
        </div>
        <Badge variant="secondary" className="h-[3.472cqw] px-[1.389cqw] py-[0.347cqw] text-[2.083cqw]">
          {detail.tracks.length} 首
        </Badge>
      </div>

      <Separator className="col-start-1 row-start-2 mt-[16.667cqw] mb-[5.556cqw]" />
      <h3 className="col-start-1 row-start-3 text-sm font-semibold">曲目</h3>
      <ItemGroup className="col-start-1 row-start-4 mt-2 gap-0">
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
 * 根据当前专辑封面异步取得头图渐变需要的强调色。
 *
 * 专辑切换时会先清空旧颜色，避免前一张封面的色彩短暂显示在新专辑上；异步请求返回后
 * 会再次确认组件仍处于当前请求范围内，防止较慢的旧请求覆盖新专辑的颜色。
 *
 * @param artworkId 当前专辑封面的唯一标识；没有封面时返回 `undefined`。
 * @returns 可作为 CSS 自定义属性值的 `rgb()` 颜色字符串；提取失败时返回 `undefined`。
 */
function useAlbumArtworkAccentColor(artworkId?: string) {
  const [accentColor, setAccentColor] = useState<string>();

  useEffect(() => {
    const source = artworkUrl(artworkId, 128);
    let isCurrent = true;
    setAccentColor(undefined);

    if (!source) {
      return () => {
        isCurrent = false;
      };
    }

    void getArtworkAccentColor(source).then((color) => {
      if (isCurrent) setAccentColor(color);
    });

    return () => {
      isCurrent = false;
    };
  }, [artworkId]);

  return accentColor;
}

/**
 * 渲染专辑头图顶部的导航与可执行操作。
 * @param detail 已加载的专辑资料；缺省时仅显示返回与不可用的更多按钮。
 * @param onClose 关闭当前专辑详情并返回浏览栈上一页的回调。
 * @param onChooseTrack 选择菜单中“播放第一首”时调用的播放回调。
 * @param onOpenArtist 选择菜单中某位歌手时调用的详情跳转回调。
 * @param size 控制工具栏是否跟随专辑头图流式缩放；详情头图传入 `fluid`，其他场景保持 `fixed`。
 * @returns 与专辑头图、加载态和失败态共用的工具栏元素。
 */
function AlbumDetailToolbar({
  detail,
  onClose,
  onChooseTrack,
  onOpenArtist,
  size = 'fixed',
}: {
  detail?: AlbumDetail;
  onClose: () => void;
  onChooseTrack?: (track: Track) => void;
  onOpenArtist?: (artistId: string) => void;
  size?: 'fixed' | 'fluid';
}) {
  const firstTrack = detail?.tracks[0];
  const isFluid = size === 'fluid';
  const toolbarClassName = isFluid ? 'pt-[2.083cqw]' : 'pt-3';
  const toolbarButtonClassName = isFluid
    ? 'size-[5.556cqw] rounded-[1.389cqw] [&_svg]:size-[2.778cqw]!'
    : undefined;

  return (
    <div className={cn('flex items-center justify-between', toolbarClassName)}>
      <Button variant="ghost" size="icon" className={toolbarButtonClassName} aria-label="返回上一页" onClick={onClose}>
        <ArrowLeft aria-hidden="true" />
      </Button>
      {detail && onChooseTrack && onOpenArtist ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={toolbarButtonClassName} aria-label="专辑更多操作" />} />}>
              <MoreHorizontal aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>更多操作</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={!firstTrack}
                onClick={() => {
                  if (firstTrack) onChooseTrack(firstTrack);
                }}
              >
                <Play aria-hidden="true" />
                播放第一首
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {detail.artists.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>歌手</DropdownMenuLabel>
                  {detail.artists.map((artist) => (
                    <DropdownMenuItem key={artist.id} onClick={() => onOpenArtist(artist.id)}>
                      <UserRound aria-hidden="true" />
                      {artist.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button variant="ghost" size="icon" className={toolbarButtonClassName} aria-label="专辑更多操作" disabled>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/**
 * 渲染专辑详情加载时的头图骨架，保留返回入口以便用户随时离开页面。
 * @param onClose 关闭当前专辑详情并返回浏览栈上一页的回调。
 * @returns 与加载完成后尺寸一致的专辑头图和曲目骨架元素。
 */
function AlbumDetailLoading({ onClose }: { onClose: () => void }) {
  /*
   * 加载态与内容态复用同一组容器比例，避免数据到达前后发生布局跳变。
   */
  return (
    <section className="@container/album-detail mt-0 grid" aria-label="正在加载专辑" role="status">
      <AlbumArtworkCard
        artworkOverflow="visible"
        className="album-detail-hero relative col-start-1 row-start-1 h-[33.333cqw] w-full gap-0 rounded-[1.736cqw] border py-0 ring-0"
      >
        <CardHeader className="gap-0 px-4 pt-0 pb-0">
          <AlbumDetailToolbar onClose={onClose} size="fluid" />
        </CardHeader>
        <CardContent className="absolute inset-x-0 bottom-0 translate-y-[9.722cqw] px-[2.778cqw] py-0">
          <div className="relative ml-[4.514cqw] mr-auto h-[27.778cqw] w-[38.889cqw] max-w-full" aria-hidden="true">
            <Skeleton className="absolute top-1/2 right-0 size-[22.222cqw] -translate-y-1/2 rounded-full" />
            <AlbumArtworkSkeleton className="relative size-[27.778cqw]" />
          </div>
        </CardContent>
      </AlbumArtworkCard>
      <div className="relative z-10 col-start-1 row-start-1 mt-[15.278cqw] mr-[2.778cqw] ml-[44.444cqw] flex min-w-0 self-start flex-col items-center gap-[1.389cqw] px-0 pt-0">
        <Skeleton className="h-[4.861cqw] w-4/5" />
        <Skeleton className="h-[2.778cqw] w-2/5" />
      </div>
      <div className="col-start-1 row-start-2 mt-[16.667cqw] flex flex-col gap-1">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-14 w-full" />)}
      </div>
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
 * @param size 控制文字与间距是否跟随专辑头图流式缩放；默认保持其他调用位置的固定规格。
 * @returns 可换行的歌手导航元素。
 */
function ArtistLinks({
  artists,
  onOpenArtist,
  size = 'fixed',
}: {
  artists: ArtistRef[];
  onOpenArtist: (artistId: string) => void;
  size?: 'fixed' | 'fluid';
}) {
  const isFluid = size === 'fluid';
  const textClassName = isFluid ? 'text-[2.431cqw] leading-[3.472cqw]' : 'text-sm';
  const layoutClassName = isFluid
    ? 'mt-[1.389cqw] gap-x-[0.694cqw] gap-y-[0.694cqw]'
    : 'mt-2 gap-x-1 gap-y-1';

  if (artists.length === 0) return <p className={cn(layoutClassName, textClassName, 'text-muted-foreground')}>未知歌手</p>;
  return (
    <div className={cn('flex flex-wrap items-center', layoutClassName)}>
      {artists.map((artist, index) => (
        <span key={artist.id} className={cn('flex items-center', isFluid ? 'gap-[0.694cqw]' : 'gap-1')}>
          {index > 0 && <span className={cn(textClassName, 'text-muted-foreground')}>/</span>}
          <Button variant="link" className={cn('h-auto p-0', textClassName)} onClick={() => onOpenArtist(artist.id)}>
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
          <AlbumArtworkFrame className="mx-auto mt-2 aspect-square w-full max-w-md bg-muted">
            {showLyrics ? (
              <LyricsPanel track={playback.track} positionMs={position} />
            ) : (
              <AlbumArtwork artwork={playback.track} size="full" />
            )}
          </AlbumArtworkFrame>
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
            <AlbumArtwork artwork={track} size="sm" />
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
      <AlbumArtwork artwork={track} size="sm" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{track.title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{artistLine(track)}</span></span>
    </Button>
  );
}

function PlayerButton({ label, disabled, onClick, children, className }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" className={className} aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>} />
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
