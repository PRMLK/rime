import type { AlbumDetail, ArtistRef } from '@/api/rime';
import { Ellipsis, Heart, Play, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type AlbumDetailHeroInfoAlbum = Pick<AlbumDetail, 'artists' | 'description' | 'title' | 'tracks'>;

/**
 * 渲染专辑详情顶部右侧的名称与操作区域。
 *
 * 父级 `AlbumDetailHero（专辑详情头图）` 负责计算可用画布尺寸，本组件只以父级
 * 容器查询宽度作为缩放基准。因此标题、歌手和按钮会随整个头图等比缩放，同时保持
 * 它们原有的相对大小、顺序和左对齐方式。名称、歌手与操作按钮组成紧凑的信息组：
 * 标题从名称区顶部开始，简介入口和操作行紧跟在歌手下方，避免由上下两端分布产生
 * 过大的空白。文字组采用极小的光学内缩，以补偿粗体中文字形的左侧外扩与圆角按钮
 * 透明角造成的视觉偏差；操作按钮仍以自身外框作为横向锚点。
 *
 * @param props - 名称区域所需的专辑资料与交互回调。
 * @param props.album - 提供标题、歌手与全部播放曲目列表的最小专辑资料。
 * @param props.onOpenArtist - 用户点击歌手文字后打开对应歌手详情的回调。
 * @param props.onPlayAll - 用户点击播放按钮后，以全部曲目建立播放队列的回调。
 * @returns 位于头图第三列、可随父级画布等比缩放的专辑名称区域。
 *
 * @example
 * <AlbumDetailHeroInfo album={detail} onOpenArtist={openArtist} onPlayAll={playAlbumTracks} />
 */
export function AlbumDetailHeroInfo({
  album,
  onOpenArtist,
  onPlayAll,
}: {
  album: AlbumDetailHeroInfoAlbum;
  onOpenArtist: (artistId: string) => void;
  onPlayAll: (tracks: AlbumDetail['tracks']) => void;
}) {
  return (
    <div className="col-start-3 flex h-full min-h-0 min-w-0 flex-col items-start pt-[6.25cqw] text-left">
      {/*
        标题、歌手和简介整体向下留出与封面相称的顶部呼吸空间。0.694cqw 的左内缩
        仅作用于文字，抵消粗体中文字形的视觉外扩；随后三段纵向间距统一为该值，
        保持信息组紧凑且具有一致节奏。
      */}
      <div className="flex w-full min-w-0 flex-col items-start pl-[0.694cqw]">
        <h2 id="album-title" className="line-clamp-2 w-full text-[5cqw] leading-[6.25cqw] font-semibold">
          {album.title}
        </h2>
        <AlbumDetailHeroArtistLinks artists={album.artists} onOpenArtist={onOpenArtist} />
        <AlbumDetailHeroDescriptionEntry description={album.description} />
      </div>
      <div className="mt-[1.389cqw] flex min-w-0 items-center gap-[1.111cqw]">
        {/*
          专辑操作使用不透明的 album-action（专辑操作色）语义令牌，并与页面背景共享封面色：
          播放保留较深基底，收藏与更多保留较浅基底，换专辑时三者会随封面同步变色，同时
          不会退回黑色、白色或透明底面。图标按钮不显示 Tooltip（提示气泡）文字，操作名称
          仅由 aria-label（辅助技术标签）提供给读屏软件，避免遮挡专辑信息。
        */}
        <Button
          variant="album-primary"
          size="icon"
          className="size-[8.333cqw] shrink-0 rounded-lg"
          aria-label="全部播放"
          disabled={album.tracks.length === 0}
          onClick={() => onPlayAll(album.tracks)}
        >
          <Play className="size-[3.472cqw]" data-icon="inline-start" aria-hidden="true" />
        </Button>
        <AlbumDetailHeroUnavailableAction icon={Heart} label="收藏专辑" />
        <AlbumDetailHeroUnavailableAction icon={Ellipsis} label="更多操作" />
      </div>
    </div>
  );
}

/**
 * 渲染用于预览版式的单行专辑简介入口。
 *
 * 入口使用无底色的 `Button（按钮）` 变体，避免在网格画布上形成新的卡片边界；文字
 * 采用 `truncate（单行省略）`，当名称区变窄时由文本自身的省略号提示仍有更多内容。
 * 未传入、为空或仅包含空白字符时改为 `invisible（不可见但保留空间）`，确保默认
 * 没有简介资料的专辑仍保留一行高度和上下间距。当前仅显示入口效果，不传递或执行
 * 简介页跳转逻辑。
 *
 * @param props - 可选的简介文本。
 * @param props.description - 用于入口展示的简介；空值会隐藏入口。
 * @returns 带简介文案、超出后自动省略的单行入口；没有简介时返回不可见占位行。
 */
function AlbumDetailHeroDescriptionEntry({ description }: { description?: string }) {
  const normalizedDescription = description?.trim();
  const shouldShowDescription = Boolean(normalizedDescription);

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'mt-[0.694cqw] h-[3.125cqw] w-full min-w-0 justify-start p-0 text-[2.083cqw] leading-[3.125cqw] text-muted-foreground',
        !shouldShowDescription && 'invisible',
      )}
      aria-hidden={!shouldShowDescription}
      aria-label={shouldShowDescription ? `查看专辑简介：${normalizedDescription}` : undefined}
      tabIndex={shouldShowDescription ? undefined : -1}
    >
      <span className="w-full truncate">{normalizedDescription}</span>
    </Button>
  );
}

/**
 * 渲染头图中的歌手文本链接。
 *
 * @param props - 歌手列表与打开歌手详情的回调。
 * @param props.artists - 专辑关联的歌手资料；为空时显示只读的未知歌手文本。
 * @param props.onOpenArtist - 点击任一歌手后的页面跳转回调。
 * @returns 左对齐、随头图容器宽度缩放的歌手链接列表。
 */
function AlbumDetailHeroArtistLinks({
  artists,
  onOpenArtist,
}: {
  artists: ArtistRef[];
  onOpenArtist: (artistId: string) => void;
}) {
  const textClassName = 'text-[2.222cqw] leading-[3.125cqw]';
  const layoutClassName = 'mt-[0.694cqw] gap-x-[0.694cqw] gap-y-[0.694cqw]';
  const artistToneClassName = 'opacity-70';

  if (artists.length === 0) {
    return <p className={cn(layoutClassName, textClassName, artistToneClassName)}>未知歌手</p>;
  }

  return (
    <div className={cn('flex flex-wrap items-center justify-start', layoutClassName)}>
      {artists.map((artist, index) => (
        <span key={artist.id} className="flex items-center gap-[0.694cqw]">
          {index > 0 && <span className={cn(textClassName, artistToneClassName)}>/</span>}
          <Button
            variant="ghost"
            className={cn('h-auto p-0', textClassName, artistToneClassName)}
            onClick={() => onOpenArtist(artist.id)}
          >
            {artist.name}
          </Button>
        </span>
      ))}
    </div>
  );
}

/**
 * 渲染当前版本尚未接入服务端能力的专辑操作。
 *
 * 收藏与更多操作保留完整的可点击外观和按压反馈，但当前没有可调用的业务接口；
 * 不可用的技术原因仅保留在代码内，界面不额外显示说明或提示气泡。
 *
 * @param props - 图标与操作名称。
 * @param props.icon - 用于该不可用操作的 Lucide 图标组件。
 * @param props.label - 面向辅助技术的操作名称。
 * 图标以 2.778cqw 随 `AlbumDetailHero（专辑详情头图）` 缩放；辅助按钮略小于主播放
 * 按钮，使用户优先识别“播放全部”，但仍保持清晰可辨的图标比例。
 *
 * @returns 可点击但当前不产生副作用的次要圆形图标按钮。
 */
function AlbumDetailHeroUnavailableAction({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Button
      variant="album-secondary"
      size="icon"
      className="size-[6.944cqw] shrink-0 rounded-full"
      aria-label={label}
      onClick={handleReservedAlbumAction}
    >
      <Icon className="size-[2.778cqw]" data-icon="inline-start" aria-hidden="true" />
    </Button>
  );
}

/**
 * 接收尚未接入业务能力的专辑操作点击。
 *
 * 用户需要这些按钮保持完整亮度与可点击状态，但收藏和更多操作尚无接口，因此此处
 * 故意不修改状态、不发送请求。后续接入对应能力时，应在此函数中调用明确的领域操作。
 *
 * @returns 无返回值，也不产生任何副作用。
 */
function handleReservedAlbumAction(): void {
  return;
}
