import {
  Heart,
  Home,
  LibraryBig,
  ListMusic,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import nowPlayingCover from '@/assets/now-playing.jpg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type NavigationTab = 'home' | 'search' | 'library';

const navigationItems = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'search', label: '搜索', icon: Search },
  { id: 'library', label: '我的', icon: UserRound },
] as const;

const searchResults = [
  { title: '海风里的留白', artist: 'Solstice' },
  { title: 'Orange at 5:40', artist: 'Mellow Park' },
  { title: '慢一点，再慢一点', artist: '夜航' },
];

const libraryItems = [
  { title: '我喜欢的音乐', detail: '48 首' },
  { title: '最近播放', detail: '12 首' },
  { title: '我的歌单', detail: '3 个' },
];

export function MobilePlayer() {
  const [activeTab, setActiveTab] = useState<NavigationTab>('home');
  const [isPlaying, setIsPlaying] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [query, setQuery] = useState('');
  const activeLabel = navigationItems.find((item) => item.id === activeTab)?.label ?? '首页';
  const filteredResults = useMemo(
    () =>
      searchResults.filter((item) => `${item.title}${item.artist}`.toLowerCase().includes(query.trim().toLowerCase())),
    [query],
  );
  const playbackLabel = isPlaying ? '暂停播放' : '开始播放';

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
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="播放列表">
                      <ListMusic aria-hidden="true" />
                    </Button>
                  }
                />
                <TooltipContent>播放列表</TooltipContent>
              </Tooltip>
            </header>

            {activeTab === 'home' && (
              <HomeView isPlaying={isPlaying} isLiked={isLiked} onToggleLike={() => setIsLiked((liked) => !liked)} />
            )}
            {activeTab === 'search' && (
              <SearchView
                query={query}
                results={filteredResults}
                onQueryChange={setQuery}
                onChooseTrack={() => setIsPlaying(true)}
              />
            )}
            {activeTab === 'library' && <LibraryView />}
          </div>
        </main>

        <footer className="shrink-0 border-t bg-background">
          <section className="mx-auto flex min-h-20 w-full max-w-xl items-center gap-3 px-4 py-3" aria-label="正在播放">
            <img
              className="size-12 shrink-0 rounded-md object-cover"
              src={nowPlayingCover}
              alt="《余温》专辑封面"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">余温</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">Rime Radio</p>
            </div>
            <div className="flex shrink-0 items-center">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="上一首">
                      <SkipBack aria-hidden="true" />
                    </Button>
                  }
                />
                <TooltipContent>上一首</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label={playbackLabel}
                      aria-pressed={isPlaying}
                      onClick={() => setIsPlaying((playing) => !playing)}
                    >
                      {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                    </Button>
                  }
                />
                <TooltipContent>{playbackLabel}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="下一首">
                      <SkipForward aria-hidden="true" />
                    </Button>
                  }
                />
                <TooltipContent>下一首</TooltipContent>
              </Tooltip>
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
                  onClick={() => setActiveTab(item.id)}
                >
                  <Icon aria-hidden="true" />
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

function HomeView({
  isPlaying,
  isLiked,
  onToggleLike,
}: {
  isPlaying: boolean;
  isLiked: boolean;
  onToggleLike: () => void;
}) {
  return (
    <section className="mt-10" aria-labelledby="now-playing-heading">
      <p className="text-xs font-medium text-muted-foreground">正在播放</p>
      <div className="mt-4 overflow-hidden rounded-lg bg-muted">
        <img
          className="aspect-square w-full object-cover"
          src={nowPlayingCover}
          alt="《余温》专辑封面"
        />
      </div>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="now-playing-heading" className="truncate text-lg font-semibold">
            余温
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Rime Radio</p>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={isLiked ? 'secondary' : 'ghost'}
                size="icon"
                aria-label={isLiked ? '取消喜欢' : '喜欢这首歌'}
                aria-pressed={isLiked}
                onClick={onToggleLike}
              >
                <Heart aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent>{isLiked ? '取消喜欢' : '喜欢这首歌'}</TooltipContent>
        </Tooltip>
      </div>
      <div className="mt-6" aria-label={isPlaying ? '播放进度 42%' : '已暂停，播放进度 42%'}>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[42%] rounded-full bg-primary" />
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>1:46</span>
          <span>4:08</span>
        </div>
      </div>
      <Separator className="my-8" />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">接下来</h2>
        <span className="text-xs text-muted-foreground">3 首</span>
      </div>
      <div className="mt-2">
        <QueueItem title="海风里的留白" artist="Solstice" />
        <QueueItem title="Orange at 5:40" artist="Mellow Park" />
        <QueueItem title="慢一点，再慢一点" artist="夜航" />
      </div>
    </section>
  );
}

function SearchView({
  query,
  results,
  onQueryChange,
  onChooseTrack,
}: {
  query: string;
  results: typeof searchResults;
  onQueryChange: (query: string) => void;
  onChooseTrack: () => void;
}) {
  return (
    <section className="mt-8" aria-labelledby="search-heading">
      <h2 id="search-heading" className="sr-only">
        搜索音乐
      </h2>
      <label className="sr-only" htmlFor="music-search">
        搜索歌曲、专辑或艺人
      </label>
      <Input
        id="music-search"
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="搜索歌曲、专辑或艺人"
      />
      <div className="mt-8 flex items-center gap-2">
        <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">此刻推荐</h2>
      </div>
      <div className="mt-2">
        {results.length > 0 ? (
          results.map((item) => (
            <Button
              key={item.title}
              variant="ghost"
              className="h-auto w-full justify-start rounded-none px-0 py-3 text-left"
              onClick={onChooseTrack}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{item.artist}</span>
              </span>
              <Play className="size-4 text-muted-foreground" aria-hidden="true" />
            </Button>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">没有找到匹配的音乐</p>
        )}
      </div>
    </section>
  );
}

function LibraryView() {
  return (
    <section className="mt-8" aria-labelledby="library-heading">
      <h2 id="library-heading" className="text-sm font-semibold">
        我的音乐
      </h2>
      <div className="mt-3">
        {libraryItems.map((item) => (
          <Button
            key={item.title}
            variant="ghost"
            className="h-auto w-full justify-start rounded-none px-0 py-4 text-left"
          >
            <LibraryBig className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{item.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
            </span>
          </Button>
        ))}
      </div>
    </section>
  );
}

function QueueItem({ title, artist }: { title: string; artist: string }) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-b py-2 last:border-b-0">
      <Play className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{artist}</p>
      </div>
    </div>
  );
}
