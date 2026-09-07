import {
  HomeIcon as HomeOutlineIcon,
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
  Heart, LoaderCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import { getFavoriteStatus, searchTracks, setFavorite, type ArtistRef, type Track, type User } from '@/api/rime';
import { AlbumArtwork } from '@/components/AlbumArtwork';
import { AppScrollArea } from '@/components/AppScrollArea';
import { ClientSettingsDrawer } from '@/components/ClientSettingsDrawer';
import { LibraryView } from '@/components/LibraryView';
import { AlbumDetailView } from '@/components/mobile/album-detail-view';
import { ArtistDetailView } from '@/components/mobile/artist-detail-view';
import { AllAlbumsView, HomeView, RecentAlbumsView } from '@/components/mobile/home-view';
import { NowPlayingDrawer } from '@/components/mobile/now-playing-drawer';
import { SearchView } from '@/components/mobile/search-view';
import { SystemSettingsDrawer } from '@/components/mobile/system-settings-drawer';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerTrigger } from '@/components/ui/drawer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  prefersLightArtworkForeground,
  prefersLightArtworkForegroundForPixels,
} from '@/lib/artwork-color';
import { cn } from '@/lib/utils';
import { clientSettingsScope } from '@/lib/client-settings';
import type { SavedServer } from '@/lib/mobile-server';
import { formatMobileRoute, useMobileRoute } from '@/lib/mobile-route';
import { useAlbumArtworkAccentColor } from '@/hooks/use-album-artwork-accent-color';
import { useInfiniteCursorList } from '@/hooks/use-infinite-cursor-list';
import { HtmlAudioPlayer } from '@/services/player/HtmlAudioPlayer';

type NavigationTab = 'home' | 'search' | 'library';
type PlaybackMode = 'sequence' | 'repeat';

type DetailView =
  | { kind: 'album'; id: string }
  | { kind: 'artist'; id: string }
  | { kind: 'albums' }
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

export function MobilePlayer({
  user,
  onAuthChanged,
  server,
  onSwitchServer,
}: {
  user: User;
  onAuthChanged: () => void;
  server?: SavedServer;
  onSwitchServer?: () => void;
}) {
  const settingsScope = clientSettingsScope(server?.id, user.id);
  const player = useMemo(() => new HtmlAudioPlayer(settingsScope), [settingsScope]);
  const playback = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const miniPlayerSurfaceRef = useRef<HTMLElement>(null);
  const miniPlayerTitleRef = useRef<HTMLSpanElement>(null);
  const miniPlayerArtistRef = useRef<HTMLSpanElement>(null);
  const [route, navigate] = useMobileRoute();
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isClientSettingsOpen, setIsClientSettingsOpen] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [isLoadingLike, setIsLoadingLike] = useState(false);
  const [updatingLikeTrackID, setUpdatingLikeTrackID] = useState<string>();
  // 当前曲目在首次渲染前可能不存在；显式初始化为 undefined，避免 Ref（引用）错误地承诺始终有曲目 ID。
  const activeTrackIDRef = useRef<string | undefined>(undefined);
  activeTrackIDRef.current = playback.track?.id;
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('sequence');
  const [playbackQueue, setPlaybackQueue] = useState<Track[]>([]);
  const [albumBackgroundColor, setAlbumBackgroundColor] = useState<string>();
  const activeTab: NavigationTab = route.kind === 'tab'
    ? route.tab
    : route.kind === 'search'
      ? 'search'
      : route.kind === 'albums'
        ? 'home'
      : route.kind === 'recent-albums'
        ? 'home'
        : route.sourceTab;
  const query = route.kind === 'search' ? route.query : '';
  const loadSearchPage = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => searchTracks(query.trim(), cursor, signal),
    [query],
  );
  const searchFeed = useInfiniteCursorList({
    enabled: route.kind === 'search',
    resetKey: query,
    delayMs: 250,
    preserveItemsWhenDisabled: true,
    loadPage: loadSearchPage,
  });
  const results = searchFeed.items;
  const activeLabel = navigationItems.find((item) => item.id === activeTab)?.label ?? '首页';
  const activeDetail: DetailView | undefined = route.kind === 'album'
    ? { kind: 'album', id: route.albumId }
    : route.kind === 'artist'
      ? { kind: 'artist', id: route.artistId }
      : route.kind === 'albums'
        ? { kind: 'albums' }
      : route.kind === 'recent-albums'
        ? { kind: 'recent-albums' }
        : undefined;
  const pageLabel = activeDetail?.kind === 'album'
    ? '专辑'
    : activeDetail?.kind === 'artist'
      ? '歌手'
      : activeDetail?.kind === 'albums'
        ? '全部专辑'
      : activeDetail?.kind === 'recent-albums'
        ? '最近入库'
        : activeLabel;
  /*
   * Base UI 的滚动区域仅在视口尺寸变化时重新测量溢出。主内容切页只会替换子节点，
   * 不一定改变视口尺寸，因此使用当前页面身份作为 key（重建标识）强制重新挂载，
   * 防止长列表的滑块状态残留到首页等短内容页面。
   */
  const contentScrollAreaKey = formatMobileRoute(route);
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
  const isUpdatingLike = isLoadingLike || (playback.track !== undefined && updatingLikeTrackID === playback.track.id);

  useEffect(() => () => player.dispose(), [player]);

  useEffect(() => {
    if (!playback.track) {
      setIsLiked(false);
      setIsLoadingLike(false);
      return;
    }
    const trackID = playback.track.id;
    const controller = new AbortController();
    // 切歌后先清空旧状态并禁用操作，避免旧曲目的喜欢状态被误写到新曲目。
    setIsLiked(false);
    setIsLoadingLike(true);
    getFavoriteStatus(trackID, controller.signal)
      .then((status) => {
        if (!controller.signal.aborted && activeTrackIDRef.current === trackID) setIsLiked(status.favorite);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && activeTrackIDRef.current === trackID && !(error instanceof DOMException && error.name === 'AbortError')) setIsLiked(false);
      })
      .finally(() => {
        if (!controller.signal.aborted && activeTrackIDRef.current === trackID) setIsLoadingLike(false);
      });
    return () => controller.abort();
  }, [playback.track?.id]);

  /**
   * 乐观切换当前歌曲的喜欢状态，并将异步结果绑定到发起请求时的曲目。
   *
   * 曲目切换后，旧请求无论成功或失败都不能回写新曲目的状态；写入标识同样按曲目 ID
   * 清理，避免旧请求完成时解除新曲目的禁用状态。
   *
   * @returns 无返回值；服务端写入失败时仅回滚仍处于当前播放器中的原曲目。
   */
  const toggleLike = useCallback(async () => {
    const trackID = playback.track?.id;
    if (!trackID || isUpdatingLike) return;
    const next = !isLiked;
    setIsLiked(next);
    setUpdatingLikeTrackID(trackID);
    try {
      await setFavorite(trackID, next);
    } catch {
      // 请求失败时只回滚仍在播放的原曲目，切歌后的状态由新曲目的查询决定。
      if (activeTrackIDRef.current === trackID) setIsLiked(!next);
    } finally {
      // 不能清除另一首曲目的写入状态；请求可能在切歌后才完成。
      setUpdatingLikeTrackID((currentTrackID) => currentTrackID === trackID ? undefined : currentTrackID);
    }
  }, [isLiked, isUpdatingLike, playback.track?.id]);

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

  /*
   * 通知栏、锁屏、耳机和桌面媒体键并不了解 React 页面维护的播放队列。播放器服务
   * 只负责把系统命令转发出来；此处仍由拥有队列状态的页面决定切歌策略。上一首采用
   * 常见播放器规则：当前曲目已播放超过三秒时回到开头，否则切到队列中的前一首。
   */
  useEffect(() => player.subscribeToSystemMediaCommands((command) => {
    switch (command.type) {
      case 'play':
        void player.play();
        return;
      case 'pause':
        void player.pause();
        return;
      case 'toggle':
        void player.toggle();
        return;
      case 'seek':
        player.seek(command.positionMs);
        return;
      case 'next':
        playRelative(1);
        return;
      case 'previous':
        if (playback.positionMs > 3_000) {
          player.seek(0);
          return;
        }
        playRelative(-1);
    }
  }), [playRelative, playback.positionMs, player]);

  /**
   * 打开专辑详情，并将来源标签保存在路由中。
   * @param albumId 专辑的唯一标识。
   * @returns 无返回值；地址栏更新为可直接分享的专辑链接。
   */
  const openAlbum = useCallback((albumId: string) => {
    // 在新封面取色完成前先显示默认色，避免上一张专辑的主色短暂残留。
    setAlbumBackgroundColor(undefined);
    navigate({ kind: 'album', albumId, sourceTab: activeTab });
  }, [activeTab, navigate]);

  /**
   * 打开歌手详情，并保留当前主标签作为直接链接的返回目标。
   * @param artistId 歌手的唯一标识。
   * @returns 无返回值；地址栏更新为可直接分享的歌手链接。
   */
  const openArtist = useCallback((artistId: string) => {
    navigate({ kind: 'artist', artistId, sourceTab: activeTab });
  }, [activeTab, navigate]);

  /**
   * 打开全部专辑完整列表。
   *
   * 列表按专辑标题稳定排序，供用户从曲库完整浏览或定位目标专辑。
   *
   * @returns 无返回值；地址栏更新为全部专辑路由。
   */
  const openAllAlbums = useCallback(() => {
    navigate({ kind: 'albums' });
  }, [navigate]);

  /**
   * 打开最近入库完整列表。
   *
   * 该路由保留原有地址和按入库时间倒序的内容，使已有链接与用户预期保持不变。
   *
   * @returns 无返回值；地址栏更新为最近入库路由。
   */
  const openRecentAlbums = useCallback(() => {
    navigate({ kind: 'recent-albums' });
  }, [navigate]);

  /**
   * 关闭当前详情视图，并回到路由记录的来源主标签。
   *
   * 浏览器硬件返回和手势仍由 hashchange（哈希变更）监听器处理；页头按钮使用
   * 路由中的来源标签作为兜底，因此用户直接打开详情链接时不会离开应用。
   *
   * @returns 无返回值；地址栏切换到来源主标签。
   */
  const closeDetail = useCallback(() => {
    navigate({ kind: 'tab', tab: activeTab });
  }, [activeTab, navigate]);

  return (
    <TooltipProvider>
      <Drawer open={isPlayerOpen} onOpenChange={setIsPlayerOpen} swipeDirection="down">
        {/*
         * 封面色放在 Tabs（标签页容器）而不是背景兄弟节点上，使页头、详情内容中的
         * album-action（专辑操作色）令牌都能继承同一颜色。离开专辑页时移除该变量，
         * 各组件将自动回退到自身主题默认值。
         */}
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setAlbumBackgroundColor(undefined);
            navigate({ kind: 'tab', tab: value as NavigationTab });
          }}
          className="relative isolate h-[100dvh] min-h-0 min-w-0 gap-0 overflow-hidden bg-background text-foreground"
          style={activeDetail?.kind === 'album' && albumBackgroundColor
            ? { '--album-page-artwork-color': albumBackgroundColor } as CSSProperties
            : undefined}
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
            />
          )}

          {/*
           * 专辑根背景保持 absolute inset-0（绝对定位并铺满）以延续至状态栏下方；
           * 页头本身则在原有 16px 上间距之上叠加真实顶部安全区，避免被状态栏、
           * 刘海或挖孔遮挡。普通网页中的安全区为 0px，因此视觉间距保持不变。
           */}
          <div className="mobile-content-frame relative z-10 shrink-0 pt-[calc(1rem+var(--mobile-safe-area-top))] pb-2">
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
                      key={activeDetail.id}
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
                  {activeDetail.kind === 'albums' && <AllAlbumsView onOpenAlbum={openAlbum} />}
                  {activeDetail.kind === 'recent-albums' && (
                    <RecentAlbumsView onOpenAlbum={openAlbum} />
                  )}
                </TabsContent>
              ) : (
                <>
                  <TabsContent value="home">
                    <HomeView
                      onOpenAlbum={openAlbum}
                      onOpenAllAlbums={openAllAlbums}
                      onOpenRecentAlbums={openRecentAlbums}
                      activeTrackId={playback.track?.id}
                      onChooseTrack={chooseStandaloneTrack}
                    />
                  </TabsContent>
                  <TabsContent value="search">
                    <SearchView
                      query={query}
                      results={results}
                      isSearching={searchFeed.isInitialLoading}
                      error={searchFeed.initialError}
                      hasMore={searchFeed.hasMore}
                      isLoadingMore={searchFeed.isLoadingMore}
                      loadMoreError={searchFeed.loadMoreError}
                      activeTrackId={playback.track?.id}
                      onQueryChange={(nextQuery) => navigate({ kind: 'search', query: nextQuery }, { replace: true })}
                      onLoadMore={searchFeed.loadMore}
                      onChooseTrack={chooseStandaloneTrack}
                    />
                  </TabsContent>
                  <TabsContent value="library">
                    <LibraryView
                      user={user}
                      onChooseTrack={chooseTrack}
                      onOpenClientSettings={() => setIsClientSettingsOpen(true)}
                      onOpenSystemSettings={() => setIsSettingsOpen(true)}
                      onSignedOut={onAuthChanged}
                      server={server}
                      onSwitchServer={onSwitchServer}
                    />
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
                      disabled={!playback.track || isUpdatingLike}
                      onClick={() => void toggleLike()}
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
      <ClientSettingsDrawer open={isClientSettingsOpen} onOpenChange={setIsClientSettingsOpen} scope={settingsScope} />
      {user.role === 'admin' && <SystemSettingsDrawer open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />}
    </TooltipProvider>
  );
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
