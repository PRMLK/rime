import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { AppScrollArea } from '@/components/AppScrollArea';
import { DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

/**
 * MobileDrawerCard（移动端全屏抽屉卡片）的配置。
 *
 * 抽屉根节点由调用方保留，以便继续使用各页面自身的开关状态、下滑关闭和嵌套抽屉。
 * 本组件只统一全屏卡片内部的页头、安全区与内容框布局。
 */
type MobileDrawerCardProps = Omit<ComponentPropsWithoutRef<typeof DrawerContent>, 'children'> & {
  /** 抽屉标题，同时作为 DrawerTitle（抽屉标题）的可访问名称。 */
  title: ReactNode;
  /** 标题左侧的关闭或返回控件；省略时用等宽占位保持标题居中。 */
  leading?: ReactNode;
  /** 标题右侧的操作控件；省略时用等宽占位保持标题居中。 */
  trailing?: ReactNode;
  /** 标题栏之后的页面正文；组件会将其放入统一的滚动区和内容框。 */
  children: ReactNode;
  /** 对页头追加的布局类名，不用于覆盖颜色或排版令牌。 */
  headerClassName?: string;
  /** 对标题追加的布局类名。 */
  titleClassName?: string;
  /** 正文 section（内容区）的无障碍与语义属性，例如 aria-label。 */
  contentProps?: Omit<ComponentPropsWithoutRef<'section'>, 'children' | 'className'>;
  /** 对正文内容区追加的布局类名，不用于覆盖四边安全区。 */
  contentClassName?: string;
};

/**
 * 渲染带统一安全区的移动端全屏抽屉卡片。
 *
 * 卡片本身从屏幕底部弹出，并将顶部边线放在顶部安全区之后；所有可交互内容则由
 * 本组件在四边统一避让：页头保留卡片内顶部间距，mobile-content-frame（移动端
 * 内容框）处理左右安全区，正文滚动区尾部保留底部手势条安全区。左右两侧始终各
 * 占一个图标按钮的宽度，因此仅有关闭或返回按钮时标题仍处于可用内容区域的水平中心。
 *
 * @param props - 全屏抽屉卡片的标题、两侧控件、正文和底层抽屉属性。
 * @param props.title - 必填的可访问标题内容。
 * @param props.leading - 可选的左侧关闭或返回控件。
 * @param props.trailing - 可选的右侧操作控件。
 * @param props.children - 标题栏下方的页面正文。
 * @param props.contentProps - 正文 section（内容区）的无障碍与语义属性。
 * @param props.contentClassName - 正文内容区的追加布局类名。
 * @returns 已套用移动端安全区和页头布局的 DrawerContent（抽屉内容）。
 *
 * @example
 * <MobileDrawerCard title="客户端设置" contentProps={{ 'aria-label': '客户端设置项目' }}>
 *   ...
 * </MobileDrawerCard>
 */
export function MobileDrawerCard({
  title,
  leading,
  trailing,
  children,
  className,
  headerClassName,
  titleClassName,
  contentProps,
  contentClassName,
  style,
  ...drawerContentProps
}: MobileDrawerCardProps) {
  /*
   * Base UI 的纵向 Drawer（抽屉）默认最多只占视口高度减去 6rem。全屏卡片若仅设置
   * --drawer-height，仍会受该 max-height（最大高度）截断，导致安全区下方出现不该
   * 露出的底层页面。两个变量必须取同一个安全区高度，才能让抽屉从红框后的可用区域
   * 一直铺到屏幕底部。调用方传入的其余行内样式仍会保留。
   */
  const drawerContentStyle = {
    ...style,
    '--drawer-height': 'var(--mobile-drawer-height)',
    '--drawer-content-max-height': 'var(--mobile-drawer-height)',
  };

  return (
    <DrawerContent
      {...drawerContentProps}
      style={drawerContentStyle}
      className={cn(className)}
    >
      <div className="mobile-content-frame">
        <DrawerHeader
          className={cn(
            'flex-row items-center gap-2 p-0 pb-2 pt-[var(--mobile-drawer-header-safe-top)] text-left',
            headerClassName,
          )}
        >
          {leading ?? <span className="size-8 shrink-0" aria-hidden="true" />}
          <DrawerTitle className={cn('min-w-0 flex-1 text-center text-sm', titleClassName)}>{title}</DrawerTitle>
          {trailing ?? <span className="size-8 shrink-0" aria-hidden="true" />}
        </DrawerHeader>
      </div>
      <AppScrollArea className="min-h-0 flex-1">
        <section
          {...contentProps}
          className={cn(
            'mobile-content-frame pb-[var(--mobile-drawer-content-safe-bottom)]',
            contentClassName,
          )}
        >
          {children}
        </section>
      </AppScrollArea>
    </DrawerContent>
  );
}
