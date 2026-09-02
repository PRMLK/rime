import {
  Heart, Home, LibraryBig, ListMusic, LoaderCircle, Pause, Play, Search,
  SkipBack, SkipForward, Sparkles, UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { artworkUrl, searchTracks, type Track } from '@/api/rime';
import nowPlayingCover from '@/assets/now-playing.jpg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HtmlAudioPlayer, type PlayerSnapshot } from '@/services/player/HtmlAudioPlayer';

type NavigationTab = 'home' | 'search' | 'library';

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
  const [isLiked, setIsLiked] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [searchError, setSearchError] = useState<string>();
  const activeLabel = navigationItems.find((item) => item.id === activeTab)?.label ?? '首页';
  const isPlaying = playback.status === 'playing';
  const playbackLabel = isPlaying ? '暂停播放' : '开始播放';
  const currentIndex = playback.track ? results.findIndex((track) => track.id === playback.track?.id) : -1;

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
      setActiveTab('home');
    } catch {
      // The player state exposes the actionable error next to the track.
    }
  };

  const playRelative = (offset: number) => {
    if (currentIndex < 0) return;
    const track = results[currentIndex + offset];
    if (track) void chooseTrack(track);
  };

  return (
    <TooltipProvider>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
        <main className="min-h-0 flex-1 overflow-y-auto px-5 pt-6">
          <div className="mx-auto w-full max-w-xl pb-8">
            <header className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Rime Music</p>
                <h1 className="mt-1 text-xl font-semibold">{activeLabel}</h1>
              </div>
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="播放列表"><ListMusic aria-hidden="true" /></Button>} />
                <TooltipContent>播放列表</TooltipContent>
              </Tooltip>
            </header>

            {activeTab === 'home' && (
              <HomeView
                playback={playback}
                queue={results.filter((track) => track.id !== playback.track?.id).slice(0, 3)}
                isLiked={isLiked}
                onToggleLike={() => setIsLiked((liked) => !liked)}
                onSeek={player.seek.bind(player)}
                onChooseTrack={chooseTrack}
              />
            )}
            {activeTab === 'search' && (
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
            {activeTab === 'library' && <LibraryView />}
          </div>
        </main>

        <footer className="shrink-0 border-t bg-background">
          <section className="mx-auto flex min-h-20 w-full max-w-xl items-center gap-3 px-4 py-3" aria-label="正在播放">
            <ArtworkImage track={playback.track} size={128} className="size-12 shrink-0 rounded-md object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{playback.track?.title ?? '未在播放'}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{artistLine(playback.track)}</p>
            </div>
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
                <Button key={item.id} variant={isActive ? 'secondary' : 'ghost'} className="h-full w-full flex-col gap-1 rounded-md px-0 py-2 text-[0.6875rem]" aria-current={isActive ? 'page' : undefined} onClick={() => setActiveTab(item.id)}>
                  <Icon data-icon="inline-start" aria-hidden="true" />
                  <span>{item.label}</span>
                </Button>
              );
            })}
          </nav>
        </footer>
      </div>
    </TooltipProvider>
  );
}

function HomeView({ playback, queue, isLiked, onToggleLike, onSeek, onChooseTrack }: {
  playback: PlayerSnapshot;
  queue: Track[];
  isLiked: boolean;
  onToggleLike: () => void;
  onSeek: (positionMs: number) => void;
  onChooseTrack: (track: Track) => void;
}) {
  const duration = Math.max(playback.durationMs, 0);
  const position = Math.min(playback.positionMs, duration || playback.positionMs);
  return (
    <section className="mt-10" aria-labelledby="now-playing-heading">
      <p className="text-xs font-medium text-muted-foreground">正在播放</p>
      <div className="mt-4 overflow-hidden rounded-lg bg-muted">
        <ArtworkImage track={playback.track} size={1024} className="aspect-square w-full object-cover" />
      </div>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="now-playing-heading" className="truncate text-lg font-semibold">{playback.track?.title ?? '未在播放'}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">{artistLine(playback.track)}</p>
          {playback.error && <p className="mt-2 text-sm text-destructive">{playback.error}</p>}
        </div>
        <Tooltip>
          <TooltipTrigger render={<Button variant={isLiked ? 'secondary' : 'ghost'} size="icon" aria-label={isLiked ? '取消喜欢' : '喜欢这首歌'} aria-pressed={isLiked} disabled={!playback.track} onClick={onToggleLike}><Heart aria-hidden="true" /></Button>} />
          <TooltipContent>{isLiked ? '取消喜欢' : '喜欢这首歌'}</TooltipContent>
        </Tooltip>
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
      <Separator className="my-8" />
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">接下来</h2><span className="text-xs text-muted-foreground">{queue.length} 首</span></div>
      <div className="mt-2">
        {queue.map((track) => <QueueItem key={track.id} track={track} onChooseTrack={onChooseTrack} />)}
        {queue.length === 0 && <p className="py-6 text-sm text-muted-foreground">暂无曲目</p>}
      </div>
    </section>
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

function LibraryView() {
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
    </section>
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

function PlayerButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function artistLine(track?: Track): string {
  return track?.artists.map((artist) => artist.name).join(' / ') || 'Rime Music';
}

function formatTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '0:00';
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
