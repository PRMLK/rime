import {
  ArrowPathRoundedSquareIcon as RepeatOutlineIcon,
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
  ArrowLeft, CalendarClock, ChevronDown, ChevronRight, Disc3, Heart,
  ListPlus, LoaderCircle, MoreHorizontal, Pause, Play, SkipBack, SkipForward, Sparkles, UserRound, Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  ApiError, addTrackToPlaylist, artworkUrl, createUser as createUserApi, getAlbumDetail, getArtistDetail, getFavoriteStatus, getPlaylists, getRecentAlbums, getScheduledTasks, getTrackLyrics, getUsers, resetUserPassword, runScheduledTask, searchTracks, setFavorite, updateUser as updateUserApi,
  type Album, type AlbumDetail, type ArtistDetail, type ArtistRef, type LyricsDocument, type ScheduledTask, type Track, type User,
} from '@/api/rime';
import { AlbumArtwork, AlbumArtworkFrame, AlbumArtworkSkeleton } from '@/components/AlbumArtwork';
import { AlbumDetailHero, AlbumDetailHeroSkeleton } from '@/components/AlbumDetailHero';
import { AppScrollArea } from '@/components/AppScrollArea';
import { PageHeader } from '@/components/PageHeader';
import { LibraryView } from '@/components/LibraryView';
import { UnifiedListFooterLogo, UnifiedListRow } from '@/components/UnifiedListRow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle,
} from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getArtworkAccentColor,
  prefersLightArtworkForeground,
  prefersLightArtworkForegroundForPixels,
} from '@/lib/artwork-color';
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
  'relative size-10 rounded-full border-transparent bg-transparent text-background hover:bg-transparent active:!translate-y-0 active:scale-96',
  'focus-visible:border-transparent focus-visible:ring-0 focus-visible:before:ring-2 focus-visible:before:ring-background/50',
  'before:pointer-events-none before:absolute before:inset-1 before:rounded-full before:bg-background/12',
  'before:scale-75 before:opacity-0 before:transition-[opacity,transform] before:duration-150 before:ease-out',
  'hover:before:opacity-100 active:before:scale-100 active:before:opacity-100',
  'focus-visible:before:scale-100 focus-visible:before:opacity-100',
  'motion-reduce:before:transition-none [&_svg]:relative [&_svg]:z-10',
].join(' ');

const miniPlayerPrimaryControlClassName = [
  'size-12 rounded-2xl bg-background text-foreground hover:bg-background/90 active:!translate-y-0 active:scale-96',
  'focus-visible:border-background focus-visible:ring-2 focus-visible:ring-background/50',
  'motion-reduce:transition-none',
].join(' ');

const miniPlayerTextToneCache = new Map<string, boolean>();

export function MobilePlayer({ user, onAuthChanged }: { user: User; onAuthChanged: () => void }) {
  const player = useMemo(() => new HtmlAudioPlayer(), []);
  const playback = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const miniPlayerSurfaceRef = useRef<HTMLElement>(null);
  const miniPlayerTitleRef = useRef<HTMLSpanElement>(null);
  const miniPlayerArtistRef = useRef<HTMLSpanElement>(null);
  const [activeTab, setActiveTab] = useState<NavigationTab>('home');
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [isUpdatingLike, setIsUpdatingLike] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('sequence');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [playbackQueue, setPlaybackQueue] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [searchError, setSearchError] = useState<string>();
  const [detailStack, setDetailStack] = useState<DetailView[]>([]);
  const [albumBackgroundColor, setAlbumBackgroundColor] = useState<string>();
  const activeLabel = navigationItems.find((item) => item.id === activeTab)?.label ?? '首页';
  const activeDetail = detailStack[detailStack.length - 1];
  const pageLabel = activeDetail?.kind === 'album'
    ? '专辑'
    : activeDetail?.kind === 'artist'
      ? '歌手'
      : activeDetail?.kind === 'recent-albums'
        ? '最近入库'
        : activeLabel;
  /*
   * Base UI 的滚动区域仅在视口尺寸变化时重新测量溢出。主内容切页只会替换子节点，
   * 不一定改变视口尺寸，因此使用当前页面身份作为 key（重建标识）强制重新挂载，
   * 防止长列表的滑块状态残留到首页等短内容页面。
   */
  const contentScrollAreaKey = activeDetail
    ? `${activeTab}:${activeDetail.kind}:${'id' in activeDetail ? activeDetail.id : ''}`
    : activeTab;
  const isPlaying = playback.status === 'playing';
  const playbackLabel = isPlaying ? '暂停播放' : '开始播放';
  const miniPlayerArtworkColor = useAlbumArtworkAccentColor(playback.track?.artworkId);
  const miniPlayerArtworkFocus = artworkFocusForMiniPlayer(playback.track);
  const useLightMiniPlayerText = useMiniPlayerTextTone(
    playback.track?.artworkId,
    miniPlayerArtworkColor,
    miniPlayerSurfaceRef,
    miniPlayerTitleRef,
    miniPlayerArtistRef,
  );
  // 封面解码和 Canvas 采样是异步的。先用主题强调色起笔，避免采样尚未返回时退回纯色。
  const miniPlayerStyle = {
    '--mini-player-artwork-color': miniPlayerArtworkColor ?? 'var(--primary)',
    '--mini-player-artwork-focus-x-offset': `${(0.5 - miniPlayerArtworkFocus.x) * 15}rem`,
    '--mini-player-artwork-focus-y-offset': `${-miniPlayerArtworkFocus.y * 15}rem`,
    '--mini-player-copy-color': useLightMiniPlayerText ? 'var(--background)' : 'var(--foreground)',
    '--mini-player-copy-shadow': useLightMiniPlayerText ? 'var(--foreground)' : 'var(--background)',
  } as CSSProperties;
  const playbackProgress = playback.durationMs > 0
    ? Math.min((playback.positionMs / playback.durationMs) * 100, 100)
    : 0;
  /*
   * 搜索结果仍是默认播放来源；从专辑头图选择“全部播放”后，专辑曲目会临时成为
   * 当前队列。这样歌曲结束时可按专辑曲序继续，而不会错误地跳回搜索列表。
   */
  const activePlaybackQueue = playbackQueue.length > 0 ? playbackQueue : results;
  const currentIndex = playback.track ? activePlaybackQueue.findIndex((track) => track.id === playback.track?.id) : -1;
  const queue = currentIndex >= 0 ? activePlaybackQueue.slice(currentIndex + 1) : activePlaybackQueue.slice(0, 3);

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

  useEffect(() => {
    if (!playback.track) {
      setIsLiked(false);
      return;
    }
    const controller = new AbortController();
    getFavoriteStatus(playback.track.id, controller.signal)
      .then((status) => setIsLiked(status.favorite))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setIsLiked(false);
      });
    return () => controller.abort();
  }, [playback.track?.id]);

  const toggleLike = useCallback(async () => {
    if (!playback.track || isUpdatingLike) return;
    const next = !isLiked;
    setIsLiked(next);
    setIsUpdatingLike(true);
    try {
      await setFavorite(playback.track.id, next);
    } catch {
      setIsLiked(!next);
    } finally {
      setIsUpdatingLike(false);
    }
  }, [isLiked, isUpdatingLike, playback.track]);

  const chooseTrack = useCallback(async (track: Track) => {
    try {
      await player.load(track);
    } catch {
      // The player state exposes the actionable error next to the track.
    }
  }, [player]);

  /**
   * 播放独立选择的曲目，并清除先前的专辑连续播放队列。
   *
   * @param track - 用户在搜索结果或单个曲目列表中选中的曲目。
   * @returns 无返回值；播放器异步加载错误由播放器快照统一呈现。
   */
  const chooseStandaloneTrack = useCallback((track: Track) => {
    setPlaybackQueue([]);
    void chooseTrack(track);
  }, [chooseTrack]);

  /**
   * 从专辑第一首开始播放，并将整张专辑设为连续播放队列。
   *
   * 空专辑不会触发播放器请求。队列先写入状态，再加载第一首；歌曲自然结束时，
   * `playRelative（相对切歌）` 会基于此队列选择下一首。
   *
   * @param tracks - 已按专辑曲序排列的曲目集合。
   * @returns 无返回值；播放器异步加载错误由播放器快照统一呈现。
   */
  const playAlbumTracks = useCallback((tracks: Track[]) => {
    if (tracks.length === 0) return;
    setPlaybackQueue(tracks);
    void chooseTrack(tracks[0]);
  }, [chooseTrack]);

  const playRelative = useCallback((offset: number) => {
    if (currentIndex < 0) return;
    const track = activePlaybackQueue[currentIndex + offset];
    if (track) void chooseTrack(track);
  }, [activePlaybackQueue, chooseTrack, currentIndex]);

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
    // 在新封面取色完成前先显示默认色，避免上一张专辑的主色短暂残留。
    setAlbumBackgroundColor(undefined);
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
            setAlbumBackgroundColor(undefined);
          }}
          className="relative isolate h-[100dvh] min-h-0 min-w-0 gap-0 overflow-hidden bg-background text-foreground"
        >
          {/*
           * 根布局固定为“页头 / 内容 / 底部”三段：页头与底部均不参与压缩，
           * 中间滚动区独占剩余高度。这样详情页的绝对定位元素只能在内容段内排布，
           * 不会覆盖顶部栏或底部播放器与导航。
           */}
          {activeDetail?.kind === 'album' && (
            /*
             * 专辑颜色只作为页面根层的背景，覆盖页头与内容区的共同底色；
             * 前景组件不依赖这个节点参与尺寸计算，因此不会被背景层顶开或裁切。
             */
            <div
              aria-hidden="true"
              className="album-page-background pointer-events-none absolute inset-0 z-0"
              data-artwork-color={albumBackgroundColor ? '' : undefined}
              style={albumBackgroundColor
                ? { '--album-page-artwork-color': albumBackgroundColor } as CSSProperties
                : undefined}
            />
          )}

          <div className="mobile-content-frame relative z-10 shrink-0 pt-6">
            <PageHeader
              title={pageLabel}
              showBackButton={Boolean(activeDetail)}
              onBack={closeDetail}
            />
          </div>

          <AppScrollArea
            key={contentScrollAreaKey}
            render={<main />}
            className="mobile-content-scroll relative z-10 min-h-0 flex-1"
          >
            <div className="mobile-content-frame w-full pb-8">
              {activeDetail ? (
                <TabsContent value={activeTab}>
                  {activeDetail.kind === 'album' && (
                    <AlbumDetailView
                      albumId={activeDetail.id}
                      activeTrackId={playback.track?.id}
                      isPlaying={isPlaying && playback.track?.album.id === activeDetail.id}
                      onChooseTrack={chooseStandaloneTrack}
                      onPlayAll={playAlbumTracks}
                      onOpenArtist={openArtist}
                      onBackgroundColorChange={setAlbumBackgroundColor}
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
                      onChooseTrack={chooseStandaloneTrack}
                    />
                  </TabsContent>
                  <TabsContent value="library">
                    <LibraryView user={user} onChooseTrack={chooseTrack} onOpenSystemSettings={() => setIsSettingsOpen(true)} onSignedOut={onAuthChanged} />
                  </TabsContent>
                </>
              )}
            </div>
          </AppScrollArea>

          <footer className="relative z-10 shrink-0 bg-background">
            <section
              ref={miniPlayerSurfaceRef}
              className="mini-player-surface relative isolate flex min-h-22 min-w-0 items-center gap-3 overflow-hidden rounded-t-2xl ps-[var(--mobile-content-gutter-start)] pe-[var(--mobile-content-gutter-end)] pb-7 pt-3 text-background"
              data-artwork-color={playback.track ? '' : undefined}
              data-copy-tone={useLightMiniPlayerText ? 'light' : 'dark'}
              style={miniPlayerStyle}
              aria-label="正在播放"
            >
              <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
                <AlbumArtwork
                  artwork={playback.track}
                  size="full"
                  className="mini-player-artwork-ambient absolute h-[15rem] w-auto max-w-none rounded-none object-contain object-left opacity-70"
                />
                <AlbumArtwork
                  artwork={playback.track}
                  size="full"
                  className="mini-player-artwork-base absolute h-[15rem] w-auto max-w-none rounded-none object-contain object-left opacity-100"
                />
                <span className="absolute inset-0 bg-linear-to-r from-foreground/10 via-foreground/4 to-transparent" />
                <span className="mini-player-grain" />
              </div>
              <DrawerTrigger
                render={
                  <Button
                    variant="ghost"
                    className="relative z-10 min-w-0 flex-1 justify-start gap-3 rounded-none px-0 py-0 text-left text-foreground hover:bg-transparent hover:text-foreground active:!translate-y-0 focus-visible:border-transparent focus-visible:ring-0"
                    disabled={!playback.track}
                    aria-label={playback.track ? `展开《${playback.track.title}》播放器` : '暂无播放曲目'}
                  />
                }
              >
                <AlbumArtwork artwork={playback.track} size="sm" className="outline outline-1 outline-background/10" />
                <span className="mini-player-copy min-w-0 flex-1 self-center">
                  <span ref={miniPlayerTitleRef} className="block w-fit max-w-full truncate text-sm leading-5 font-semibold">
                    {playback.track?.title ?? '未在播放'}
                  </span>
                  <span ref={miniPlayerArtistRef} className="block w-fit max-w-full truncate text-xs leading-4 opacity-82">
                    {artistLine(playback.track)}
                  </span>
                </span>
              </DrawerTrigger>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(miniPlayerControlClassName, 'z-10')}
                      aria-label={isLiked ? '取消喜欢' : '喜欢这首歌'}
                      aria-pressed={isLiked}
                      disabled={!playback.track}
                      onClick={() => setIsLiked((liked) => !liked)}
                    >
                      <Heart fill={isLiked ? 'currentColor' : 'none'} aria-hidden="true" />
                    </Button>
                  }
                />
                <TooltipContent>{isLiked ? '取消喜欢' : '喜欢这首歌'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-lg"
                      className={cn(miniPlayerPrimaryControlClassName, 'z-10')}
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
              <span className="pointer-events-none absolute bottom-5 start-[var(--mobile-content-gutter-start)] end-[var(--mobile-content-gutter-end)] h-0.5 overflow-hidden rounded-full bg-background/25" aria-hidden="true">
                <span className="block h-full rounded-full bg-background" style={{ width: `${playbackProgress}%` }} />
              </span>
            </section>
            <nav className="mobile-navigation relative z-10 -mt-3 w-full rounded-t-2xl bg-background pb-[max(env(safe-area-inset-bottom),0rem)] pt-2 shadow-[0_-1px_0_var(--border)]" aria-label="主导航">
              <TabsList variant="line" size="mobile" className="h-16 bg-transparent group-data-horizontal/tabs:h-16">
                {navigationItems.map((item) => {
                  const isActive = activeTab === item.id;
                  const Icon = isActive ? item.activeIcon : item.icon;
                  return (
                    <TabsTrigger key={item.id} value={item.id} variant="mobile" className="h-14 min-h-14">
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
          playbackMode={playbackMode}
          canPlayPrevious={currentIndex > 0}
          canPlayNext={currentIndex >= 0 && currentIndex < activePlaybackQueue.length - 1}
          isUpdatingLike={isUpdatingLike}
          onToggleLike={() => void toggleLike()}
          onTogglePlaybackMode={() => setPlaybackMode((mode) => mode === 'sequence' ? 'repeat' : 'sequence')}
          onTogglePlayback={() => void player.toggle()}
          onSeek={player.seek.bind(player)}
          onPlayPrevious={() => playRelative(-1)}
          onPlayNext={() => playRelative(1)}
          onChooseTrack={chooseTrack}
        />
      </Drawer>
      {user.role === 'admin' && <SystemSettingsDrawer open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />}
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
    <section className="mt-8" aria-labelledby="recent-albums-heading">
      {/* 主导航页面统一在页头下保留 2rem 间距，与各详情页保持一致。 */}
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
  /*
   * 轮播使用 -ml-3 / pl-3 抵消项目间距，使首项刚好落在页面内容轨上。
   * 卡片不能再额外添加 p-1，否则首页首张封面、专辑网格首列和加载骨架
   * 会分别拥有不同的左边界。
   */
  return (
    <Button
      variant="ghost"
      className="h-auto w-full flex-col items-start justify-start gap-2 rounded-[calc(clamp(0.5rem,10%,2rem)+4px)] border-0 p-0 text-left"
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
 * @param isPlaying 当前是否正在播放该专辑的曲目，用于驱动头图黑胶旋转。
 * @param onChooseTrack 选择一首曲目开始播放的回调。
 * @param onPlayAll 从第一首开始播放整张专辑的回调。
 * @param onOpenArtist 打开歌手详情页的回调。
 * @param onBackgroundColorChange 将封面主色传给页面根背景层的回调。
 * @returns 专辑详情的 React 元素，包含加载、错误和正常状态。
 */
function AlbumDetailView({
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
        {detail.tracks.map((track, index) => (
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
    </section>
  );
}

/**
 * 根据当前专辑封面异步取得页面背景需要的主色。
 *
 * 专辑切换时会先清空旧颜色；异步请求返回后再次确认组件仍处于当前请求范围内，
 * 防止较慢的旧请求覆盖新专辑的背景颜色。
 *
 * @param artworkId 当前专辑封面的唯一标识；没有封面时返回 `undefined`。
 * @returns 可用于 CSS 自定义属性的 `rgb()` 颜色字符串；提取失败时返回 `undefined`。
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
 * 根据迷你播放器中文字实际覆盖的封面区域选择浅色或深色文字。
 *
 * 先以莫奈主色作为异步采样前的兜底；封面完成渲染后，分别将标题和歌手的实际
 * 文字矩形映射回原图并合并分析。结果包含裁切区域坐标并按专辑封面缓存。
 */
function useMiniPlayerTextTone(
  artworkId: string | undefined,
  accentColor: string | undefined,
  surfaceRef: RefObject<HTMLElement | null>,
  titleRef: RefObject<HTMLSpanElement | null>,
  artistRef: RefObject<HTMLSpanElement | null>,
): boolean {
  const fallback = prefersLightArtworkForeground(accentColor);
  const [useLightText, setUseLightText] = useState(fallback);

  useEffect(() => {
    const surface = surfaceRef.current;
    const title = titleRef.current;
    const artist = artistRef.current;
    const artwork = surface?.querySelector<HTMLImageElement>('.mini-player-artwork-base');
    let frame = 0;
    let isCurrent = true;
    setUseLightText(fallback);

    if (!artworkId || !surface || !title || !artist || !artwork) {
      return () => {
        isCurrent = false;
      };
    }

    const analyze = () => {
      frame = 0;
      if (!artwork.complete || artwork.naturalWidth <= 0 || artwork.naturalHeight <= 0) return;

      const artworkRect = artwork.getBoundingClientRect();
      if (artworkRect.width <= 0 || artworkRect.height <= 0) return;

      const sourceRegions = [title, artist].flatMap((copy) => {
        const copyRect = copy.getBoundingClientRect();
        const padding = 2;
        const left = Math.max(artworkRect.left, copyRect.left - padding);
        const top = Math.max(artworkRect.top, copyRect.top - padding);
        const right = Math.min(artworkRect.right, copyRect.right + padding);
        const bottom = Math.min(artworkRect.bottom, copyRect.bottom + padding);
        if (right <= left || bottom <= top) return [];
        return [{
          x: ((left - artworkRect.left) / artworkRect.width) * artwork.naturalWidth,
          y: ((top - artworkRect.top) / artworkRect.height) * artwork.naturalHeight,
          width: ((right - left) / artworkRect.width) * artwork.naturalWidth,
          height: ((bottom - top) / artworkRect.height) * artwork.naturalHeight,
        }];
      });
      if (sourceRegions.length === 0) return;

      const cacheKey = [artworkId, ...sourceRegions.flatMap((region) => [
        region.x / artwork.naturalWidth,
        region.y / artwork.naturalHeight,
        region.width / artwork.naturalWidth,
        region.height / artwork.naturalHeight,
      ])].map((value) => typeof value === 'number' ? value.toFixed(3) : value).join(':');
      const cachedTone = miniPlayerTextToneCache.get(cacheKey);
      if (cachedTone !== undefined) {
        if (isCurrent) setUseLightText(cachedTone);
        return;
      }

      try {
        const sampledPixels: number[] = [];
        for (const region of sourceRegions) {
          const canvas = document.createElement('canvas');
          canvas.width = 96;
          canvas.height = Math.max(1, Math.min(64, Math.round(96 * region.height / region.width)));
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) continue;
          context.drawImage(
            artwork,
            region.x,
            region.y,
            region.width,
            region.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          sampledPixels.push(...context.getImageData(0, 0, canvas.width, canvas.height).data);
        }
        if (sampledPixels.length === 0) return;
        const useLight = prefersLightArtworkForegroundForPixels(
          new Uint8ClampedArray(sampledPixels),
        );
        miniPlayerTextToneCache.set(cacheKey, useLight);
        if (isCurrent) setUseLightText(useLight);
      } catch {
        // 跨域或图像解码限制下保留莫奈主色的前景判断。
      }
    };

    const scheduleAnalysis = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(analyze);
    };
    artwork.addEventListener('load', scheduleAnalysis);
    const observer = new ResizeObserver(scheduleAnalysis);
    observer.observe(surface);
    observer.observe(title);
    observer.observe(artist);
    scheduleAnalysis();

    return () => {
      isCurrent = false;
      if (frame) cancelAnimationFrame(frame);
      artwork.removeEventListener('load', scheduleAnalysis);
      observer.disconnect();
    };
  }, [accentColor, artistRef, artworkId, fallback, surfaceRef, titleRef]);

  return useLightText;
}

/**
 * 渲染专辑详情加载时的头图骨架；返回入口由页面根层的统一顶部栏提供。
 * @returns 与加载完成后尺寸一致的专辑头图和曲目骨架元素。
 */
function AlbumDetailLoading() {
  /*
   * 骨架由 AlbumDetailHeroSkeleton（专辑详情头图骨架）负责高度和分栏，确保
   * 请求完成后曲目标题保持在相同的纵向位置。
   */
  return (
    <section className="mt-8">
      <AlbumDetailHeroSkeleton />
      <div className="mt-8 flex flex-col gap-1">
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

function NowPlayingDrawer({
  playback,
  queue,
  isLiked,
  playbackMode,
  isUpdatingLike,
  canPlayPrevious,
  canPlayNext,
  onToggleLike,
  onTogglePlaybackMode,
  onTogglePlayback,
  onSeek,
  onPlayPrevious,
  onPlayNext,
  onChooseTrack,
}: {
  playback: PlayerSnapshot;
  queue: Track[];
  isLiked: boolean;
  playbackMode: PlaybackMode;
  isUpdatingLike: boolean;
  canPlayPrevious: boolean;
  canPlayNext: boolean;
  onToggleLike: () => void;
  onTogglePlaybackMode: () => void;
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
  const playbackModeLabel = playbackMode === 'sequence' ? '顺序播放' : '单曲循环';
  const PlaybackModeIcon = playbackMode === 'sequence' ? QueueOutlineIcon : RepeatOutlineIcon;
  return (
    <DrawerContent className="h-[calc(100dvh-0.5rem)] max-h-[calc(100dvh-0.5rem)]">
      <div className="mobile-content-frame">
        <DrawerHeader className="flex-row items-center gap-2 p-0 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)] text-left">
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
      </div>

      <AppScrollArea className="min-h-0 flex-1">
        <section className="mobile-content-frame pb-[max(env(safe-area-inset-bottom),1.5rem)]" aria-labelledby="now-playing-heading">
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
                <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={isLiked ? '取消喜欢' : '喜欢这首歌'} aria-pressed={isLiked} disabled={!playback.track || isUpdatingLike} onClick={onToggleLike}><Heart fill={isLiked ? 'currentColor' : 'none'} aria-hidden="true" /></Button>} />
                <TooltipContent>{isLiked ? '取消喜欢' : '喜欢这首歌'}</TooltipContent>
              </Tooltip>
              <AddToPlaylistMenu track={playback.track} />
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
            <div className="flex items-center justify-center gap-4">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label={playbackModeLabel} aria-pressed={playbackMode === 'repeat'} onClick={onTogglePlaybackMode}>
                      <PlaybackModeIcon aria-hidden="true" strokeWidth={2} />
                    </Button>
                  }
                />
                <TooltipContent>{playbackModeLabel}</TooltipContent>
              </Tooltip>
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
            {queue.map((track) => (
              <QueueItem
                key={track.id}
                track={track}
                isActive={playback.track?.id === track.id}
                onChooseTrack={onChooseTrack}
              />
            ))}
            {queue.length > 0 && <UnifiedListFooterLogo />}
            {queue.length === 0 && <p className="py-6 text-sm text-muted-foreground">暂无曲目</p>}
          </div>
        </section>
      </AppScrollArea>
    </DrawerContent>
  );
}

function AddToPlaylistMenu({ track }: { track?: Track }) {
  const [playlists, setPlaylists] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = (open: boolean) => {
    if (!open || !track) return;
    setIsLoading(true);
    getPlaylists()
      .then((page) => setPlaylists(page.items.filter((playlist) => playlist.kind === 'custom')))
      .finally(() => setIsLoading(false));
  };

  return (
    <DropdownMenu onOpenChange={load}>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="添加到歌单" disabled={!track} />} />}>
          <ListPlus aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>添加到歌单</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>添加到歌单</DropdownMenuLabel>
          {isLoading && <DropdownMenuItem disabled><LoaderCircle className="animate-spin" aria-hidden="true" />正在加载</DropdownMenuItem>}
          {!isLoading && playlists.length === 0 && <DropdownMenuItem disabled>暂无自建歌单</DropdownMenuItem>}
          {!isLoading && playlists.map((playlist) => (
            <DropdownMenuItem key={playlist.id} onClick={() => { if (track) void addTrackToPlaylist(playlist.id, track.id).catch(() => undefined); }}>
              {playlist.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <AppScrollArea
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
    </AppScrollArea>
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
          <TrackListRow
            key={track.id}
            track={track}
            isActive={activeTrackId === track.id}
            showAlbum
            onChooseTrack={onChooseTrack}
          />
        ))}
        {!error && results.length > 0 && <UnifiedListFooterLogo />}
      </div>
    </section>
  );
}

function SystemSettingsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [view, setView] = useState<'root' | 'tasks' | 'users'>('root');
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
        <div className="mobile-content-frame">
          <DrawerHeader className="flex-row items-center gap-2 p-0 pb-2 pt-3 text-left">
            {view === 'root' ? (
              <DrawerClose
                render={<Button variant="ghost" size="icon" aria-label="退出系统设置"><ChevronDown aria-hidden="true" /></Button>}
              />
            ) : (
              <Button variant="ghost" size="icon" aria-label="返回系统设置" onClick={() => setView('root')}>
                <ArrowLeft aria-hidden="true" />
              </Button>
            )}
            <DrawerTitle className="min-w-0 flex-1 text-center text-sm">{view === 'root' ? '系统设置' : view === 'tasks' ? '计划任务' : '用户管理'}</DrawerTitle>
            <span className="size-8 shrink-0" aria-hidden="true" />
          </DrawerHeader>
        </div>

        <AppScrollArea className="min-h-0 flex-1">
          <section className="mobile-content-frame pb-[max(env(safe-area-inset-bottom),1.5rem)]" aria-label={view === 'root' ? '系统设置项目' : view === 'tasks' ? '计划任务列表' : '用户列表'}>
            {view === 'root' ? (
              <ItemGroup className="gap-0">
                <UnifiedListRow
                  render={<button type="button" onClick={() => setView('users')} />}
                  className="cursor-pointer py-3"
                  separated
                >
                  <ItemMedia variant="icon"><Users aria-hidden="true" /></ItemMedia>
                  <ItemContent><ItemTitle>用户管理</ItemTitle></ItemContent>
                  <ItemActions><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></ItemActions>
                </UnifiedListRow>
                <UnifiedListRow
                  render={<button type="button" onClick={() => setView('tasks')} />}
                  className="cursor-pointer py-3"
                  separated
                >
                  <ItemMedia variant="icon"><CalendarClock aria-hidden="true" /></ItemMedia>
                  <ItemContent><ItemTitle>计划任务</ItemTitle></ItemContent>
                  <ItemActions><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></ItemActions>
                </UnifiedListRow>
              </ItemGroup>
            ) : view === 'tasks' ? (
              <ScheduledTaskList tasks={scheduledTasks} isLoading={isLoading} error={error} onRunTask={runTask} />
            ) : (
              <AdminUserList />
            )}
          </section>
        </AppScrollArea>
      </DrawerContent>
    </Drawer>
  );
}

function AdminUserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState<User>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(undefined);
    getUsers(controller.signal)
      .then((page) => setUsers(page.items))
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : '用户加载失败');
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [refresh]);

  const update = async (user: User, input: { role?: User['role']; disabled?: boolean }) => {
    setError(undefined);
    try {
      await updateUserApi(user.id, input);
      setRefresh((value) => value + 1);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '用户更新失败');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{users.length} 个账户</p>
        <Button size="sm" onClick={() => setCreating(true)}><Users data-icon="inline-start" />新建用户</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {isLoading && users.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在加载</div>
      ) : (
        <ItemGroup className="gap-0">
          {users.map((user) => (
            <Item key={user.id} className="rounded-none border-b px-0 py-4 last:border-b-0">
              <ItemContent>
                <ItemTitle className="flex items-center gap-2">{user.displayName}<Badge variant="secondary">{user.role === 'admin' ? '管理员' : '用户'}</Badge></ItemTitle>
                <ItemDescription>@{user.username}{user.disabled ? ' · 已停用' : user.mustChangePassword ? ' · 等待修改密码' : ''}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`管理${user.displayName}`} />}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => void update(user, { role: user.role === 'admin' ? 'user' : 'admin' })}>{user.role === 'admin' ? '设为普通用户' : '设为管理员'}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void update(user, { disabled: !user.disabled })}>{user.disabled ? '重新启用' : '停用账户'}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setResetTarget(user)}>重置密码</DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      <CreateUserDrawer open={creating} onOpenChange={setCreating} onCreated={() => setRefresh((value) => value + 1)} />
      <ResetPasswordDrawer user={resetTarget} onOpenChange={(open) => { if (!open) setResetTarget(undefined); }} onReset={() => setRefresh((value) => value + 1)} />
    </div>
  );
}

function CreateUserDrawer({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [role, setRole] = useState<User['role']>('user');
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setError(undefined);
    try {
      await createUserApi({
        username: String(form.get('username') ?? ''), displayName: String(form.get('displayName') ?? ''),
        password: String(form.get('password') ?? ''), role,
      });
      onOpenChange(false); onCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '用户创建失败');
    } finally { setPending(false); }
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <DrawerContent>
        <DrawerHeader><DrawerTitle>新建用户</DrawerTitle></DrawerHeader>
        <form className="px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]" onSubmit={submit}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="new-user-username">用户名</FieldLabel><Input id="new-user-username" name="username" minLength={3} maxLength={32} required /></Field>
            <Field><FieldLabel htmlFor="new-user-name">显示名称</FieldLabel><Input id="new-user-name" name="displayName" maxLength={40} /></Field>
            <Field><FieldLabel htmlFor="new-user-password">临时密码</FieldLabel><Input id="new-user-password" name="password" type="password" minLength={8} required /></Field>
            <Field>
              <FieldLabel>角色</FieldLabel>
              <Select value={role} onValueChange={(value) => setRole(value as User['role'])}><SelectTrigger className="w-full"><SelectValue>{role === 'admin' ? '管理员' : '普通用户'}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="user">普通用户</SelectItem><SelectItem value="admin">管理员</SelectItem></SelectGroup></SelectContent></Select>
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" size="lg" disabled={pending}>{pending && <LoaderCircle data-icon="inline-start" className="animate-spin" />}创建用户</Button>
          </FieldGroup>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function ResetPasswordDrawer({ user, onOpenChange, onReset }: { user?: User; onOpenChange: (open: boolean) => void; onReset: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setPending(true); setError(undefined);
    try {
      await resetUserPassword(user.id, String(new FormData(event.currentTarget).get('password') ?? ''));
      onOpenChange(false); onReset();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '密码重置失败'); }
    finally { setPending(false); }
  };
  return (
    <Drawer open={Boolean(user)} onOpenChange={onOpenChange} swipeDirection="down">
      <DrawerContent>
        <DrawerHeader><DrawerTitle>重置{user ? `“${user.displayName}”` : ''}的密码</DrawerTitle></DrawerHeader>
        <form className="px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]" onSubmit={submit}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="reset-user-password">新临时密码</FieldLabel><Input id="reset-user-password" name="password" type="password" minLength={8} required /></Field>
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" size="lg" disabled={pending}>{pending && <LoaderCircle data-icon="inline-start" className="animate-spin" />}重置密码</Button>
          </FieldGroup>
        </form>
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
          <UnifiedListRow key={task.id} className="py-3" separated>
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
          </UnifiedListRow>
        ))}
      </ItemGroup>
      {!isLoading && !error && tasks.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">暂无计划任务</p>}
    </>
  );
}

function TrackListRow({
  track,
  isActive = false,
  trackNumber,
  showAlbum = false,
  showDuration = false,
  separated = false,
  onChooseTrack,
}: {
  track: Track;
  isActive?: boolean;
  trackNumber?: number;
  showAlbum?: boolean;
  showDuration?: boolean;
  separated?: boolean;
  onChooseTrack: (track: Track) => void;
}) {
  return (
    <UnifiedListRow
      render={<button type="button" onClick={() => onChooseTrack(track)} aria-label={isActive ? `正在播放《${track.title}》` : `播放《${track.title}》`} />}
      active={isActive}
      aria-current={isActive ? 'true' : undefined}
      className="cursor-pointer py-2"
      separated={separated}
    >
      {trackNumber === undefined ? (
        <AlbumArtwork artwork={track} size="sm" />
      ) : (
        <span className="flex w-8 shrink-0 items-center text-xs tabular-nums text-muted-foreground">
          {isActive ? <PlaySolidIcon className="size-3.5" aria-hidden="true" /> : `#${String(trackNumber).padStart(2, '0')}`}
        </span>
      )}
      <ItemContent className="gap-0.5">
        <ItemTitle>{track.title}</ItemTitle>
        <ItemDescription>{showAlbum ? `${artistLine(track)} · ${track.album.title}` : artistNames(track.artists)}</ItemDescription>
      </ItemContent>
      {/*
       * 时长是该行最后一个可见列，直接贴齐内容框结束侧。播放状态移入左侧编号
       * 区，避免为不存在的尾部图标预留固定空位而破坏所有时长的右对齐。
       */}
      <ItemActions className="shrink-0 gap-0">
        {showDuration && <span className="text-xs text-muted-foreground">{formatTime(track.durationMs)}</span>}
      </ItemActions>
    </UnifiedListRow>
  );
}

function QueueItem({ track, isActive, onChooseTrack }: { track: Track; isActive: boolean; onChooseTrack: (track: Track) => void }) {
  return <TrackListRow track={track} isActive={isActive} onChooseTrack={onChooseTrack} separated />;
}

function PlayerButton({ label, disabled, onClick, children, className }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" className={className} aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function artworkFocusForMiniPlayer(track?: Track): { x: number; y: number } {
  return {
    x: clampArtworkFocus(track?.artworkFocus?.x, 0.5),
    y: clampArtworkFocus(track?.artworkFocus?.y, 0.35),
  };
}

function clampArtworkFocus(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
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
