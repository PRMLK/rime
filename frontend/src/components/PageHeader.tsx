import { ArrowLeft } from 'lucide-react';
import { RimeLogo } from '@/components/RimeLogo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  /** 页面主标题；返回按钮显示时会自动隐藏。 */
  title: string;
  /** 是否显示返回按钮。默认关闭；开启时必须同时传入 onBack（返回回调）。 */
  showBackButton?: boolean;
  /** 用户点击返回按钮时执行的回调；仅在 showBackButton（显示返回按钮）开启时生效。 */
  onBack?: () => void;
  /** 供页面在不改变组件结构的前提下补充布局类名。 */
  className?: string;
};

/**
 * 渲染普通页面共用的顶部栏，统一标题、可选返回入口与 Rime 品牌标识的位置。
 * 为避免详情页的返回入口与页面标题重复占据视觉焦点，返回按钮显示时自动隐藏标题。
 *
 * @param props - 页面顶部栏的配置。
 * @param props.title - 显示在顶部栏左侧的页面标题；显示返回按钮时不渲染。
 * @param props.showBackButton - 控制是否显示返回按钮；默认不显示。
 * @param props.onBack - 返回按钮的点击回调。未提供时不渲染按钮，避免产生无效操作。
 * @param props.className - 追加到顶部栏根元素的布局类名。
 * @returns 包含标题、可选返回按钮和品牌标识的语义化 header（页头）元素。
 *
 * @example
 * <PageHeader title="搜索" />
 * <PageHeader title="歌手" showBackButton onBack={closeDetail} />
 */
export function PageHeader({ title, showBackButton = false, onBack, className }: PageHeaderProps) {
  const canGoBack = showBackButton && onBack;
  const isTitleVisible = !canGoBack;

  return (
    <header className={cn('@container/page-header grid min-w-0 grid-cols-[clamp(4.286rem,8.571cqw,6rem)_minmax(0,1fr)_clamp(4.286rem,8.571cqw,6rem)] items-center', className)}>
      {canGoBack && (
        <Button variant="ghost" size="navigation-icon" className="col-start-1 row-start-1" aria-label="返回上一页" onClick={onBack}>
          {/*
           * 页头本身是容器查询基准。按钮外框从内容轨道起排，导航图标规格与两侧网格
           * 使用相同宽度公式；Lucide 箭头画布的透明左边距只在按钮内补偿，实际尖端、
           * 按钮外框和首页标题始终共用同一条左对齐线。
           */}
          <ArrowLeft data-icon="inline-start" strokeWidth={2.5} aria-hidden="true" />
        </Button>
      )}
      {/* 两端列按容器宽度在 68.6 至 96px 内伸缩，标题或品牌标识不会推动彼此的位置。 */}
      <div className="col-start-1 row-start-1 min-w-0">
        {isTitleVisible && <h1 className="text-[clamp(1.25rem,2.5cqw,1.75rem)] leading-[clamp(1.75rem,3.5cqw,2.45rem)] font-semibold">{title}</h1>}
      </div>
      <RimeLogo className="col-start-3 row-start-1 justify-self-end text-[clamp(0.875rem,1.75cqw,1.25rem)]" />
    </header>
  );
}
