import { PlayIcon as PlaySolidIcon } from '@heroicons/react/24/solid';
import { type ArtistRef, type Track } from '@/mobile/api/rime';
import { AlbumArtwork } from '@/mobile/components/AlbumArtwork';
import { UnifiedListRow } from '@/mobile/components/UnifiedListRow';
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';

/**
 * 取得曲目或专辑上的歌手展示名称。
 *
 * @param artists - 关联歌手的引用集合。
 * @returns 用斜杠分隔的名称；空集合时返回兜底文案。
 */
export function formatArtistNames(artists: ArtistRef[]): string {
  return artists.map((artist) => artist.name).join(' / ') || 'Unknown Artist';
}

/**
 * 格式化曲目时长。
 *
 * @param milliseconds - 曲目的毫秒时长。
 * @returns `分:秒` 形式的时长；无效值回退为 `0:00`。
 */
function formatTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '0:00';
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

/**
 * 渲染可播放的通用曲目列表行。
 *
 * @param props - 曲目资料、显示列选项和选中曲目的回调。
 * @returns 可用于搜索、专辑详情和播放队列的列表行。
 */
export function TrackListRow({
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
  const artistLine = formatArtistNames(track.artists);

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
        <ItemDescription>{showAlbum ? `${artistLine} · ${track.album.title}` : artistLine}</ItemDescription>
      </ItemContent>
      {/* 时长固定在行尾，播放状态则使用左侧的曲目编号区域。 */}
      <ItemActions className="shrink-0 gap-0">
        {showDuration && <span className="text-xs text-muted-foreground">{formatTime(track.durationMs)}</span>}
      </ItemActions>
    </UnifiedListRow>
  );
}
