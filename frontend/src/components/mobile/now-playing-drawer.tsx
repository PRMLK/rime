import {
  ArrowPathRoundedSquareIcon as RepeatOutlineIcon,
  ListBulletIcon as QueueOutlineIcon,
} from '@heroicons/react/24/outline';
import { ChevronDown, Heart, ListPlus, LoaderCircle, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ApiError, addTrackToPlaylist, getAllPlaylists, getTrackLyrics,
  type LyricsDocument, type Track,
} from '@/api/rime';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AlbumArtwork, AlbumArtworkFrame } from '@/components/AlbumArtwork';
import { MobileDrawerCard } from '@/components/MobileDrawerCard';
import { TrackListRow } from '@/components/mobile/track-list';
import { UnifiedListFooterLogo } from '@/components/UnifiedListRow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DrawerClose } from '@/components/ui/drawer';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { type PlayerSnapshot } from '@/services/player/HtmlAudioPlayer';

/**
 * 渲染全屏正在播放抽屉，包含歌词、播放控制和下一首队列。
 *
 * @param props - 来自播放器根状态的快照、队列和控制回调。
 * @returns 用于 Drawer（抽屉）内容区域的播放器界面。
 */
export function NowPlayingDrawer({
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
  playbackMode: 'sequence' | 'repeat';
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
    <MobileDrawerCard
      title="正在播放"
      contentProps={{ 'aria-labelledby': 'now-playing-heading' }}
      leading={
        <DrawerClose
          render={
            <Button variant="ghost" size="icon" aria-label="收起播放器">
              <ChevronDown aria-hidden="true" />
            </Button>
          }
        />
      }
    >
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
          {playback.diagnostics && <PlayerDiagnosticsPanel playback={playback} />}
          <Separator className={playback.diagnostics ? 'my-5' : 'my-8'} />
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">接下来</h2>
            <span className="text-xs text-muted-foreground">{queue.length} 首</span>
          </div>
          <div className="mt-2">
            {queue.map((track) => (
              <TrackListRow
                key={track.id}
                track={track}
                isActive={playback.track?.id === track.id}
                onChooseTrack={onChooseTrack}
                separated
              />
            ))}
            {queue.length > 0 && <UnifiedListFooterLogo />}
            {queue.length === 0 && <p className="py-6 text-sm text-muted-foreground">暂无曲目</p>}
      </div>
    </MobileDrawerCard>
  );
}

/**
 * 加载用户自建歌单，并提供向其中添加当前曲目的菜单。
 *
 * @param props - 当前可添加的曲目；缺失时禁用入口。
 * @returns 挂载在歌曲操作区的歌单下拉菜单。
 */
function AddToPlaylistMenu({ track }: { track?: Track }) {
  const [playlists, setPlaylists] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = (open: boolean) => {
    if (!open || !track) return;
    setIsLoading(true);
    getAllPlaylists()
      .then((items) => setPlaylists(items.filter((playlist) => playlist.kind === 'custom')))
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

/**
 * 加载并跟随当前播放进度滚动显示歌词。
 *
 * @param props - 当前曲目与播放器进度。
 * @returns 歌词加载、空状态或同步滚动的歌词内容。
 */
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
    if (isFollowing && activeLineIndex >= 0) scrollToLine(activeLineIndex, 'smooth');
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

/**
 * 渲染带悬浮提示的播放器控制按钮。
 *
 * @param props - 按钮文字、禁用状态、点击回调和图标内容。
 * @returns 可供上一首与下一首复用的图标按钮。
 */
function PlayerButton({ label, disabled, onClick, children, className }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" className={className} aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 渲染管理员开启调试模式后可见的播放协商、传输和错误记录。
 *
 * @param props - 当前播放器快照；诊断状态不存在时由调用方不渲染本组件。
 * @returns 位于播放控制区下方的有界滚动诊断框，不展示含会话令牌的播放地址。
 */
function PlayerDiagnosticsPanel({ playback }: { playback: PlayerSnapshot }) {
  const diagnostics = playback.diagnostics;
  if (!diagnostics) return null;
  const transport = playback.source
    ? `${playback.source.kind} · ${playback.source.contentType}${playback.source.bitrateKbps ? ` · ${playback.source.bitrateKbps} kbps` : ''}`
    : '等待服务端选源';

  return (
    <section className="mt-5 overflow-hidden rounded-md border border-border bg-muted/30" aria-labelledby="player-debug-heading">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h3 id="player-debug-heading" className="text-sm font-medium">播放调试</h3>
        <Badge variant={playback.status === 'error' ? 'destructive' : 'secondary'}>{playerStatusLabel(playback.status)}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-2 text-xs">
        <DebugDetail label="内核" value={diagnostics.engine === 'native' ? '原生播放器' : '网页音频'} />
        <DebugDetail label="原生服务" value={diagnostics.nativeAvailable === undefined ? '未检测' : diagnostics.nativeAvailable ? '可用' : '不可用'} />
        <DebugDetail label="客户端标签" value={diagnostics.clientTags.join(', ') || '无'} />
        <DebugDetail label="缓存" value={cacheStateLabel(diagnostics.cacheState)} />
        <DebugDetail label="传输" value={transport} className="col-span-2" />
        <DebugDetail label="播放进度" value={`${formatTime(playback.positionMs)} / ${formatTime(playback.durationMs)}`} />
        <DebugDetail label="状态" value={playerStatusLabel(playback.status)} />
      </dl>
      <Separator />
      <AppScrollArea className="h-32" aria-label="播放调试事件">
        <div className="flex flex-col gap-1.5 px-3 py-2" role="log" aria-live="polite">
          {diagnostics.events.map((event, index) => (
            <p key={`${event.occurredAt}-${index}`} className={cn('break-words text-xs leading-5', event.level === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
              <time className="mr-1 tabular-nums text-foreground/70" dateTime={event.occurredAt}>{formatDiagnosticTime(event.occurredAt)}</time>
              {event.message}
            </p>
          ))}
        </div>
      </AppScrollArea>
    </section>
  );
}

/**
 * 渲染诊断框中的一个名称和值。
 *
 * @param props - 名称、可换行的值和可选网格布局类名。
 * @returns 语义化的 definition（定义）列表项。
 */
function DebugDetail({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-foreground">{value}</dd>
    </div>
  );
}

/**
 * 将播放器状态转换成中文短标签。
 *
 * @param status - HtmlAudioPlayer（网页音频播放器）发布的当前状态。
 * @returns 适合状态徽章和诊断字段展示的中文文本。
 */
function playerStatusLabel(status: PlayerSnapshot['status']): string {
  return { idle: '空闲', loading: '加载中', playing: '播放中', paused: '已暂停', error: '错误' }[status];
}

/**
 * 将媒体缓存解析结果转换成中文短标签。
 *
 * @param state - 播放器记录的缓存命中状态。
 * @returns 面向管理员的缓存状态说明。
 */
function cacheStateLabel(state: NonNullable<PlayerSnapshot['diagnostics']>['cacheState']): string {
  return { 'not-used': '未使用', hit: '命中', miss: '未命中' }[state];
}

/**
 * 格式化诊断事件的本地时间。
 *
 * @param occurredAt - ISO（国际标准化组织）格式事件时间。
 * @returns 有效时间显示为时分秒；无效值回退为原始文本，避免隐藏服务端或原生异常数据。
 */
function formatDiagnosticTime(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return occurredAt;
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}

/**
 * 取得曲目的歌手展示名称。
 *
 * @param track - 当前曲目；缺失时用于空播放器状态。
 * @returns 歌手名称或播放器默认文案。
 */
function artistLine(track?: Track): string {
  return track ? track.artists.map((artist) => artist.name).join(' / ') || 'Unknown Artist' : 'Rime Music';
}

/**
 * 将毫秒转换为分秒显示。
 *
 * @param milliseconds - 要格式化的时长或进度。
 * @returns `分:秒` 字符串；无效输入回退为 `0:00`。
 */
function formatTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '0:00';
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

/**
 * 格式化音频源容器和码率。
 *
 * @param source - 播放器已解析的音频源资料。
 * @returns 例如 `MP3 · 320 kbps` 的展示文案。
 */
function playbackSourceLabel(source: NonNullable<PlayerSnapshot['source']>): string {
  const format = source.container.toUpperCase();
  return source.bitrateKbps ? `${format} · ${source.bitrateKbps} kbps` : format;
}
