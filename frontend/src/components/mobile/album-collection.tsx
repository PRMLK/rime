import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { type Album, type ArtistRef } from '@/api/rime';
import { AlbumArtwork } from '@/components/AlbumArtwork';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Disc3 } from 'lucide-react';

/** 单张专辑封面允许达到的最大边长，超过后才增加一列。 */
const albumGridCardMaximumSizeInRem = 14;

/** 专辑网格在任何宽度下都至少保留两列。 */
const albumGridMinimumColumns = 2;

/** 专辑卡片实际需要的最小资料；列表接口可额外提供入库时间等信息。 */
export type AlbumCardAlbum = Pick<Album, 'id' | 'title' | 'artists' | 'artworkId'>;

/**
 * 将歌手引用格式化为页面上展示的一行名称。
 *
 * @param artists - 专辑或曲目关联的歌手集合。
 * @returns 用斜杠分隔的歌手名称；没有可用名称时返回兜底文案。
 */
export function formatArtistNames(artists: ArtistRef[]): string {
  return artists.map((artist) => artist.name).join(' / ') || 'Unknown Artist';
}

/**
 * 渲染可点击的专辑封面卡片，供首页、最近入库和歌手详情页共用。
 *
 * @param props - 专辑资料与打开对应详情页的回调。
 * @returns 使用现有 Button（按钮）组件呈现的专辑入口。
 */
export function AlbumCard({ album, onOpenAlbum }: { album: AlbumCardAlbum; onOpenAlbum: (albumId: string) => void }) {
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
        <span className="truncate text-xs text-muted-foreground">{formatArtistNames(album.artists)}</span>
      </span>
    </Button>
  );
}

/**
 * 根据实际网格宽度计算“封面不超过上限时的最少列数”。
 *
 * @param gridRef - 指向专辑网格根元素的 React 引用。
 * @returns 当前容器宽度下满足封面最大边长的最少列数，至少为两列。
 */
function useAlbumGridColumns(gridRef: RefObject<HTMLDivElement | null>): number {
  const [columns, setColumns] = useState(albumGridMinimumColumns);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    /** 读取浏览器最终布局值，避免将 Tailwind 的 rem 间距或页面缩放写死为像素。 */
    const updateColumns = () => {
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const gridGap = Number.parseFloat(getComputedStyle(grid).columnGap);
      const maximumArtworkSize = rootFontSize * albumGridCardMaximumSizeInRem;

      if (grid.clientWidth <= 0 || !Number.isFinite(gridGap) || !Number.isFinite(maximumArtworkSize)) return;

      const nextColumns = Math.max(
        albumGridMinimumColumns,
        Math.ceil((grid.clientWidth + gridGap) / (maximumArtworkSize + gridGap)),
      );
      setColumns((currentColumns) => currentColumns === nextColumns ? currentColumns : nextColumns);
    };

    const observer = new ResizeObserver(updateColumns);
    observer.observe(grid);
    updateColumns();
    return () => observer.disconnect();
  }, [gridRef]);

  return columns;
}

/**
 * 渲染列数由实际容器宽度决定的专辑网格。
 *
 * @param props - 要排入网格的专辑卡片或加载骨架。
 * @returns 填满当前宽度、每张封面不超过上限的专辑网格。
 */
export function AlbumGrid({ children }: { children: ReactNode }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useAlbumGridColumns(gridRef);

  return (
    <div
      ref={gridRef}
      className="mt-3 grid gap-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

/**
 * 渲染详情页请求失败或资源不存在时的空状态。
 *
 * @param props - 空状态的标题和简短说明。
 * @returns 使用 shadcn Empty（空状态）组合的错误视图。
 */
export function DetailEmpty({ title, description }: { title: string; description: string }) {
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
