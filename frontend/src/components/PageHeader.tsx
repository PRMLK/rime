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
    <header className={cn('grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center', className)}>
      {canGoBack && (
        <Button variant="ghost" size="sm" className="col-start-1 row-start-1 w-10 justify-start px-0" aria-label="返回上一页" onClick={onBack}>
          {/* 40×28px 与 text-xl（20px）双中文字的默认排版框一致；仅横向拉长箭头以提升识别度。 */}
          <ArrowLeft className="origin-left scale-x-110" aria-hidden="true" />
        </Button>
      )}
      {/* 两端固定为 40px，避免返回按钮、标题或品牌标识的自然宽度推动彼此的位置。 */}
      <div className="col-start-1 row-start-1 min-w-0">
        {isTitleVisible && <h1 className="text-xl font-semibold">{title}</h1>}
      </div>
      <RimeLogo className="col-start-3 row-start-1 justify-self-end" />
    </header>
  );
}
