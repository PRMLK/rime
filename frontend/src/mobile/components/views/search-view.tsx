import { LoaderCircle, Sparkles } from 'lucide-react';
import { type Track } from '@/mobile/api/rime';
import { InfiniteScrollSentinel } from '@/mobile/components/InfiniteScrollSentinel';
import { TrackListRow } from '@/mobile/components/views/track-list';
import { UnifiedListFooterLogo } from '@/mobile/components/UnifiedListRow';
import { Input } from '@/components/ui/input';

/**
 * 渲染搜索输入、搜索结果和续页状态。
 *
 * 搜索请求状态由外层维护，使切换到其他页面后仍可保留结果作为播放器队列。
 *
 * @param props - 搜索关键字、分页状态及用户交互回调。
 * @returns 可搜索曲库并触发无限续页的页面内容。
 */
export function SearchView({
  query,
  results,
  isSearching,
  error,
  hasMore,
  isLoadingMore,
  loadMoreError,
  activeTrackId,
  onQueryChange,
  onLoadMore,
  onChooseTrack,
}: {
  query: string;
  results: Track[];
  isSearching: boolean;
  error?: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreError?: string;
  activeTrackId?: string;
  onQueryChange: (query: string) => void;
  onLoadMore: () => void;
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
      {!error && !isSearching && results.length > 0 && (
        <InfiniteScrollSentinel
          hasMore={hasMore}
          isLoading={isLoadingMore}
          error={loadMoreError}
          observationKey={results.length}
          onLoadMore={onLoadMore}
        />
      )}
    </section>
  );
}
