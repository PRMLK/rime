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
 * @param props - 名称区域所需的专辑资料、喜欢状态与交互回调。
 * @param props.album - 提供标题、歌手与全部播放曲目列表的最小专辑资料。
 * @param props.onOpenArtist - 用户点击歌手文字后打开对应歌手详情的回调。
 * @param props.onPlayAll - 用户点击播放按钮后，以全部曲目建立播放队列的回调。
 * @param props.onToggleFavorite - 用户点击心形按钮切换专辑喜欢状态的回调。
 * @returns 位于头图第三列、可随父级画布等比缩放的专辑名称区域。
 *
 * @example
 * <AlbumDetailHeroInfo album={detail} onOpenArtist={openArtist} onPlayAll={playAlbumTracks} />
 */
export function AlbumDetailHeroInfo({
  album,
  isFavorite,
  isUpdatingFavorite,
  onOpenArtist,
  onPlayAll,
  onToggleFavorite,
}: {
  album: AlbumDetailHeroInfoAlbum;
  isFavorite: boolean;
  isUpdatingFavorite: boolean;
  onOpenArtist: (artistId: string) => void;
  onPlayAll: (tracks: AlbumDetail['tracks']) => void;
  onToggleFavorite: () => void;
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
      {/*
        三个操作以 1:1:1 的比例填满名称列，并统一使用圆角方形外观，消除右侧闲置空间与
        按钮形状差异；主次操作颜色仍由各自的语义变体保留。列宽随头图容器连续变化，按钮
        和图标由 album-action（专辑操作）尺寸同步保持正方形，避免在不同屏宽下出现比例失衡。
      */}
      <div className="mt-[1.389cqw] grid w-full min-w-0 grid-cols-3 items-center gap-[1.111cqw]">
        {/*
          专辑操作使用不透明的 album-primary（专辑主操作）和 album-secondary（专辑次操作）
          语义变体，并与页面背景共享封面色；换专辑时三者会同步变色，同时不会退回黑色、白色
          或透明底面。图标按钮不显示 Tooltip（提示气泡）文字，操作名称仅由 aria-label（辅助
          技术标签）提供给读屏软件，避免遮挡专辑信息。
        */}
        <Button
          variant="album-primary"
          size="album-action"
          aria-label="全部播放"
          disabled={album.tracks.length === 0}
          onClick={() => onPlayAll(album.tracks)}
        >
          <Play data-icon="inline-start" aria-hidden="true" />
        </Button>
        <AlbumDetailHeroFavoriteAction
          favorite={isFavorite}
          isUpdating={isUpdatingFavorite}
          onToggle={onToggleFavorite}
        />
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
  // 歌手文字比说明入口大一档，确保在专辑头图缩放到紧凑手机宽度时仍可舒适辨认。
  const textClassName = 'text-[2.778cqw] leading-[3.472cqw]';
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
 * 更多操作保留完整的可点击外观和按压反馈，但当前没有可调用的业务接口；
 * 不可用的技术原因仅保留在代码内，界面不额外显示说明或提示气泡。
 *
 * @param props - 图标与操作名称。
 * @param props.icon - 用于该不可用操作的 Lucide 图标组件。
 * @param props.label - 面向辅助技术的操作名称。
 * `album-action（专辑操作）` 尺寸会令按钮与图标随所在网格列等比伸缩；三个操作使用
 * 相同的圆角方形外观与列宽，并保留次操作颜色，使其在任意屏宽下保持一致的图标比例与点击区域。
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
      size="album-action"
      aria-label={label}
      onClick={handleReservedAlbumAction}
    >
      <Icon data-icon="inline-start" aria-hidden="true" />
    </Button>
  );
}

/**
 * 接收尚未接入业务能力的专辑更多操作点击。
 *
 * 用户需要该按钮保持完整亮度与可点击状态，但更多操作尚无接口，因此此处故意不修改
 * 状态、不发送请求。后续接入对应能力时，应在此函数中调用明确的领域操作。
 *
 * @returns 无返回值，也不产生任何副作用。
 */
function handleReservedAlbumAction(): void {
  return;
}

/**
 * 渲染可持久化的专辑喜欢操作。
 *
 * @param props.favorite - 当前用户是否直接喜欢该专辑。
 * @param props.isUpdating - 读取或写入状态期间为 true，用于阻止错误操作与重复提交。
 * @param props.onToggle - 切换喜欢状态的回调。
 * @returns 带语义化状态与辅助技术标签的心形图标按钮。
 */
function AlbumDetailHeroFavoriteAction({
  favorite,
  isUpdating,
  onToggle,
}: {
  favorite: boolean;
  isUpdating: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="album-secondary"
      size="album-action"
      aria-label={favorite ? '取消喜欢专辑' : '喜欢专辑'}
      aria-pressed={favorite}
      disabled={isUpdating}
      onClick={onToggle}
    >
      {/*
        填充后的心形在上半部具有较大的视觉面积，几何居中时会显得偏上；按图标自身
        边长下移 4%，在按钮随网格缩放时仍维持一致的光学居中效果。
      */}
      <Heart fill={favorite ? 'currentColor' : 'none'} className="translate-y-[4%]" data-icon="inline-start" aria-hidden="true" />
    </Button>
  );
}
