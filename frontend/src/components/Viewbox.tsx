import {
  Eye,
  EyeOff,
  Grid3X3,
  Maximize,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Ruler,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { mobileRouteChangeEvent } from '@/lib/mobile-route';
import './Viewbox.css';

type ViewboxDevicePresetId = 'phone-compact' | 'phone' | 'phone-tall' | 'tablet-portrait' | 'tablet-landscape';
type ViewboxZoomMode = 'fit' | 'manual';

type ViewboxDevicePreset = {
  id: ViewboxDevicePresetId;
  label: string;
  width: number;
  height: number;
};

type ViewboxProps = {
  previewSource?: string;
};

type StageSize = {
  width: number;
  height: number;
};

type ViewboxInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type ViewboxCanvasPosition = {
  x: number;
  y: number;
};

type ViewboxPreferences = {
  deviceId: ViewboxDevicePresetId;
  zoomMode: ViewboxZoomMode;
  manualZoom: number;
  canvasPosition: ViewboxCanvasPosition;
  showRuler: boolean;
  showGrid: boolean;
};

const VIEWBOX_DEVICE_PRESETS: ViewboxDevicePreset[] = [
  { id: 'phone-compact', label: '紧凑手机', width: 360, height: 800 },
  { id: 'phone', label: '标准手机', width: 390, height: 844 },
  { id: 'phone-tall', label: '长屏手机', width: 430, height: 932 },
  { id: 'tablet-portrait', label: '平板竖屏', width: 768, height: 1024 },
  { id: 'tablet-landscape', label: '平板横屏', width: 1024, height: 768 },
];

const VIEWBOX_MIN_ZOOM = 40;
const VIEWBOX_MAX_ZOOM = 300;
const VIEWBOX_ZOOM_STEP = 5;
const VIEWBOX_RULER_TOP_SIZE = 18;
const VIEWBOX_RULER_LEFT_SIZE = 24;
const VIEWBOX_DEFAULT_ZOOM = 70;
const VIEWBOX_STAGE_BASE_INSETS: ViewboxInsets = { top: 70, right: 110, bottom: 70, left: 110 };
const VIEWBOX_CANVAS_POSITION_MIN = -500;
const VIEWBOX_CANVAS_POSITION_MAX = 500;
const VIEWBOX_CANVAS_POSITION_STEP = 1;
const VIEWBOX_LEGACY_CANVAS_INSET_MAX = 3600;
const VIEWBOX_DEFAULT_CANVAS_POSITION: ViewboxCanvasPosition = { x: 0, y: 0 };
const VIEWBOX_PREFERENCES_STORAGE_KEY = 'rime.viewbox.preferences.v3';
const VIEWBOX_V2_PREFERENCES_STORAGE_KEY = 'rime.viewbox.preferences.v2';
const VIEWBOX_LEGACY_PREFERENCES_STORAGE_KEY = 'rime.viewbox.preferences.v1';
const VIEWBOX_DEFAULT_PREFERENCES: ViewboxPreferences = {
  deviceId: 'phone',
  zoomMode: 'manual',
  manualZoom: VIEWBOX_DEFAULT_ZOOM,
  canvasPosition: VIEWBOX_DEFAULT_CANVAS_POSITION,
  showRuler: false,
  showGrid: false,
};

/**
 * 将哈希值规范化为移动端可识别的路由。
 *
 * @param hash - 原始哈希值，可为空或缺少 `#/` 前缀。
 * @returns 以 `#/` 开头的路由；无效值会回退至首页。
 */
function normalizePreviewRouteHash(hash: string): string {
  return hash.startsWith('#/') ? hash : '#/home';
}

/**
 * 从预览页面地址中提取初始移动端路由。
 *
 * @param previewSource - iframe（内嵌预览页）原始地址。
 * @returns 地址中已有的路由，或首页路由。
 */
function getPreviewRouteFromSource(previewSource: string): string {
  const hashIndex = previewSource.indexOf('#');
  return normalizePreviewRouteHash(hashIndex === -1 ? '' : previewSource.slice(hashIndex));
}

/**
 * 将移动端路由附加到预览页面地址。
 *
 * @param previewSource - 不含或包含旧哈希的预览页面地址。
 * @param routeHash - 需要写入的新移动端哈希路由。
 * @returns 可直接赋给 iframe `src` 的完整地址。
 */
function createPreviewSource(previewSource: string, routeHash: string): string {
  const hashIndex = previewSource.indexOf('#');
  const sourceWithoutHash = hashIndex === -1 ? previewSource : previewSource.slice(0, hashIndex);
  return `${sourceWithoutHash}${normalizePreviewRouteHash(routeHash)}`;
}

/**
 * 读取同源预览页当前的哈希路由。
 *
 * 当预览地址跨域时，浏览器会拒绝读取 iframe 的 `location`；此时返回 `undefined`，
 * 编辑器仍可把外层路由传入预览页，但不会尝试反向读取子页状态。
 *
 * @param frame - 预览 iframe 元素。
 * @returns 规范化后的移动端路由；不可读取时返回 `undefined`。
 */
function readFrameRouteHash(frame: HTMLIFrameElement | null): string | undefined {
  try {
    const frameWindow = frame?.contentWindow;
    return frameWindow ? normalizePreviewRouteHash(frameWindow.location.hash) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 判断页面地址栏是否已有合法的移动端哈希路由。
 *
 * @param previewSource - 预览页面原始地址，用于在地址栏为空时提供回退值。
 * @returns 外层编辑器应使用的初始移动端路由。
 */
function getEditorRoute(previewSource: string): string {
  return window.location.hash.startsWith('#/')
    ? normalizePreviewRouteHash(window.location.hash)
    : getPreviewRouteFromSource(previewSource);
}

/**
 * 提供独立于移动端播放器的响应式预览与视觉检查工具。
 *
 * 该组件只控制 iframe（内嵌预览页）的显示尺寸和辅助叠层，不读取或修改
 * MobilePlayer（移动播放器）的页面状态，因此 /mobile.html 仍可作为正式入口独立使用。
 *
 * @param props.previewSource - 需要加载的预览页面地址，默认使用 Vite 配置的移动端入口。
 * @returns 包含设备选择、缩放、刷新、状态条及视觉辅助工具的预览画布。
 * @example
 * <Viewbox previewSource="/mobile.html" />
 */
export function Viewbox({ previewSource = import.meta.env.VITE_VIEWBOX_SRC ?? '/mobile.html' }: ViewboxProps) {
  const stageRef = useRef<HTMLElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const frameListenerCleanupRef = useRef<(() => void) | undefined>(undefined);
  const initialPreferencesRef = useRef<ViewboxPreferences | null>(null);
  if (initialPreferencesRef.current === null) {
    initialPreferencesRef.current = readViewboxPreferences();
  }
  const initialPreferences = initialPreferencesRef.current;
  const [isEnabled, setIsEnabled] = useState(true);
  const [isDevicePickerOpen, setIsDevicePickerOpen] = useState(false);
  const [isCanvasControlVisible, setIsCanvasControlVisible] = useState(true);
  const [deviceId, setDeviceId] = useState<ViewboxDevicePresetId>(initialPreferences.deviceId);
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 });
  const [zoomMode, setZoomMode] = useState<ViewboxZoomMode>(initialPreferences.zoomMode);
  const [manualZoom, setManualZoom] = useState(initialPreferences.manualZoom);
  const [canvasPosition, setCanvasPosition] = useState<ViewboxCanvasPosition>(initialPreferences.canvasPosition);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const [previewRouteHash, setPreviewRouteHash] = useState(() => getEditorRoute(previewSource));
  const [frameSource, setFrameSource] = useState(() => createPreviewSource(previewSource, getEditorRoute(previewSource)));
  const [showRuler, setShowRuler] = useState(initialPreferences.showRuler);
  const [showGrid, setShowGrid] = useState(initialPreferences.showGrid);
  const device = useMemo(
    () => VIEWBOX_DEVICE_PRESETS.find((preset) => preset.id === deviceId) ?? VIEWBOX_DEVICE_PRESETS[1],
    [deviceId],
  );
  const fitZoom = getFittedZoom(stageSize, device, showRuler, VIEWBOX_STAGE_BASE_INSETS);
  const zoomPercent = zoomMode === 'fit' ? fitZoom : manualZoom;
  const zoom = zoomPercent / 100;
  const rulerTopSize = showRuler ? VIEWBOX_RULER_TOP_SIZE : 0;
  const rulerLeftSize = showRuler ? VIEWBOX_RULER_LEFT_SIZE : 0;
  const viewportLabel = `${device.label}，${device.width} × ${device.height} CSS 像素`;
  const visibilityLabel = isEnabled ? '关闭预览' : '开启预览';
  const canvasControlLabel = isCanvasControlVisible ? '隐藏画布控制' : '显示画布控制';
  const zoomLabel = zoomMode === 'fit' ? `适配画布 · ${zoomPercent}%` : `${zoomPercent}%`;
  const viewportShellStyle = {
    width: `${Math.round(device.width * zoom) + rulerLeftSize}px`,
    height: `${Math.round(device.height * zoom) + rulerTopSize}px`,
    transform: `translate(${canvasPosition.x}px, ${canvasPosition.y}px)`,
  } satisfies CSSProperties;
  const viewportStyle = {
    top: `${rulerTopSize}px`,
    left: `${rulerLeftSize}px`,
    width: `${device.width}px`,
    height: `${device.height}px`,
    transform: `scale(${zoom})`,
  } satisfies CSSProperties;
  const stageStyle = {
    paddingTop: `${VIEWBOX_STAGE_BASE_INSETS.top}px`,
    paddingRight: `${VIEWBOX_STAGE_BASE_INSETS.right}px`,
    paddingBottom: `${VIEWBOX_STAGE_BASE_INSETS.bottom}px`,
    paddingLeft: `${VIEWBOX_STAGE_BASE_INSETS.left}px`,
  } satisfies CSSProperties;

  useEffect(() => {
    writeViewboxPreferences({
      deviceId,
      zoomMode,
      manualZoom,
      canvasPosition,
      showRuler,
      showGrid,
    });
  }, [canvasPosition, deviceId, manualZoom, showGrid, showRuler, zoomMode]);

  /**
   * 将预览页路由写入编辑器地址栏。
   *
   * 搜索输入通过 replaceState（替换历史）更新时，不应为每个字符新增一条历史记录；
   * 其他跳转继续使用浏览器原生哈希历史，确保编辑器页的前进和后退可以控制预览页。
   *
   * @param routeHash - 来自预览页的规范化哈希路由。
   * @param replace - 是否替换当前编辑器历史记录。
   * @returns 无返回值。
   */
  const writeEditorRoute = useCallback((routeHash: string, replace: boolean) => {
    const nextRouteHash = normalizePreviewRouteHash(routeHash);
    setPreviewRouteHash(nextRouteHash);
    if (window.location.hash === nextRouteHash) return;

    if (replace) {
      window.history.replaceState(window.history.state, '', nextRouteHash);
      return;
    }

    window.location.hash = nextRouteHash;
  }, []);

  useEffect(() => {
    const nextRouteHash = getEditorRoute(previewSource);
    setPreviewRouteHash(nextRouteHash);
    setFrameSource(createPreviewSource(previewSource, nextRouteHash));
  }, [previewSource]);

  useEffect(() => {
    /**
     * 响应编辑器自身的前进、后退或直达哈希链接。
     *
     * 仅在子页面确实处于不同路由时更新 iframe src，避免移动端主动跳转后被
     * 父页面重新加载，进而丢失播放队列等仅存在于内存中的状态。
     */
    const syncFrameFromEditor = () => {
      const nextRouteHash = getEditorRoute(previewSource);
      setPreviewRouteHash(nextRouteHash);
      if (readFrameRouteHash(previewFrameRef.current) !== nextRouteHash) {
        setFrameSource(createPreviewSource(previewSource, nextRouteHash));
      }
    };

    window.addEventListener('hashchange', syncFrameFromEditor);
    window.addEventListener('popstate', syncFrameFromEditor);
    return () => {
      window.removeEventListener('hashchange', syncFrameFromEditor);
      window.removeEventListener('popstate', syncFrameFromEditor);
    };
  }, [previewSource]);

  useEffect(() => {
    return () => frameListenerCleanupRef.current?.();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    /**
     * 同步预览区域可用尺寸，使“适配画布”在窗口大小改变后重新计算缩放比例。
     * ResizeObserver（尺寸观察器）监听元素本身，避免只依赖窗口尺寸而遗漏侧栏或浏览器缩放变化。
     */
    const updateStageSize = () => {
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    };
    const observer = new ResizeObserver(updateStageSize);
    updateStageSize();
    observer.observe(stage);
    return () => observer.disconnect();
  }, [isEnabled]);

  /**
   * 将缩放滑块的单值同步到手动缩放状态。
   * @param value - shadcn Slider（滑块）返回的只读缩放数组，范围为 40 至 300。
   * @returns 无返回值；切换为手动模式并更新实际缩放。
   */
  const handleZoomChange = (value: number | readonly number[]) => {
    const nextZoom = Array.isArray(value) ? value[0] : value;
    if (typeof nextZoom !== 'number') return;
    setManualZoom(nextZoom);
    setZoomMode('manual');
  };

  /**
   * 重新创建 iframe（内嵌预览页），确保页面从初始状态加载。
   * @returns 无返回值；刷新会清空预览页中的临时状态，但不会影响外层工具设置。
   */
  const reloadPreview = () => {
    setFrameSource(createPreviewSource(previewSource, previewRouteHash));
    setReloadGeneration((generation) => generation + 1);
  };

  /**
   * 在 iframe 加载完成后建立同源双向路由同步。
   *
   * 子页普通导航会触发 hashchange（哈希变化）；搜索输入使用 replaceState（替换历史），
   * 则由 mobileRouteChangeEvent（移动端路由变化事件）补充通知。跨域预览无法读取子页
   * 地址栏时会自动降级为单向同步，不影响预览页面加载。
   *
   * @returns 无返回值；监听器会在 iframe 重载或组件卸载时清理。
   */
  const handlePreviewLoad = useCallback(() => {
    frameListenerCleanupRef.current?.();
    frameListenerCleanupRef.current = undefined;

    const frame = previewFrameRef.current;
    const frameWindow = frame?.contentWindow;
    if (!frame || !frameWindow || readFrameRouteHash(frame) === undefined) return;

    /**
     * 把子页当前路由同步到编辑器地址栏。
     * @param event - 可选的子页路由事件，用于识别是否替换历史。
     * @param replaceFallback - 首次加载时使用替换，避免编辑器初始化额外新增历史记录。
     * @returns 无返回值。
     */
    const syncEditorFromFrame = (event?: Event, replaceFallback = false) => {
      const routeHash = readFrameRouteHash(frame);
      if (!routeHash) return;
      const detail = (event as CustomEvent<{ replace?: unknown }> | undefined)?.detail;
      writeEditorRoute(routeHash, detail?.replace === true || replaceFallback);
    };

    try {
      frameWindow.addEventListener('hashchange', syncEditorFromFrame);
      frameWindow.addEventListener('popstate', syncEditorFromFrame);
      frameWindow.addEventListener(mobileRouteChangeEvent, syncEditorFromFrame);
      frameListenerCleanupRef.current = () => {
        frameWindow.removeEventListener('hashchange', syncEditorFromFrame);
        frameWindow.removeEventListener('popstate', syncEditorFromFrame);
        frameWindow.removeEventListener(mobileRouteChangeEvent, syncEditorFromFrame);
      };
      syncEditorFromFrame(undefined, true);
    } catch {
      // 跨域 iframe 无法监听子页面事件，保留外层路由驱动预览页的能力。
    }
  }, [writeEditorRoute]);

  /**
   * 切换预览设备并恢复“适配画布”缩放。
   * @param nextDeviceId - 用户在设备菜单中选择的设备预设标识。
   * @returns 无返回值；设备的逻辑尺寸改变后由适配模式重新计算可见缩放。
   */
  const chooseDevice = (nextDeviceId: ViewboxDevicePresetId) => {
    setDeviceId(nextDeviceId);
    setIsDevicePickerOpen(false);
  };

  /**
   * 响应设备选择组的互斥选择结果。
   * @param values - ToggleGroup（分段选择组）当前处于选中状态的设备标识数组。
   * @returns 无返回值；忽略取消当前项的空选择，确保预览始终对应一个设备。
   */
  const handleDevicePickerChange = (values: ViewboxDevicePresetId[]) => {
    const nextDeviceId = values[0];
    if (!nextDeviceId) return;
    chooseDevice(nextDeviceId);
  };

  /**
   * 按摇杆传入的连续位移平移画布，并以舞台中心作为坐标原点。
   *
   * x 轴和 y 轴均可在 -500px 至 500px 间移动；正 x 表示向右，正 y 表示向下。
   * 位置通过 transform（变换）应用到视口外壳，不会挤占预览舞台的可用尺寸，
   * 因而不会影响“适配画布”的缩放计算。
   *
   * @param deltaX - 水平拖动距离；正数向右移动画布，负数向左移动画布。
   * @param deltaY - 垂直拖动距离；正数向下移动画布，负数向上移动画布。
   * @returns 无返回值；坐标状态更新后会同步写入本地缓存。
   */
  const moveCanvas = (deltaX: number, deltaY: number) => {
    const horizontalDistance = Math.round(deltaX);
    const verticalDistance = Math.round(deltaY);
    if (horizontalDistance === 0 && verticalDistance === 0) return;

    setCanvasPosition((position) => {
      return {
        x: clampCanvasPosition(position.x + horizontalDistance),
        y: clampCanvasPosition(position.y + verticalDistance),
      };
    });
  };

  /**
   * 恢复画布默认坐标，使预览回到初始居中位置。
   * @returns 无返回值；使用新对象避免修改共享的默认配置。
   */
  const resetCanvasPosition = () => {
    setCanvasPosition({ ...VIEWBOX_DEFAULT_CANVAS_POSITION });
  };

  /**
   * 让设备以当前可用区域的最大比例重新适配，并消除摇杆带来的方向偏移。
   *
   * 适配时同步将 x/y 坐标归零，使画布回到舞台中心并保持完整的双向移动范围。
   *
   * @returns 无返回值；同步更新适配模式与居中的画布位置。
   */
  const fitAndCenterCanvas = () => {
    setCanvasPosition({ ...VIEWBOX_DEFAULT_CANVAS_POSITION });
    setZoomMode('fit');
  };

  return (
    <TooltipProvider>
      <div className="viewbox-suite" data-enabled={isEnabled}>
        {isEnabled && (
          <section ref={stageRef} className="viewbox-stage" style={stageStyle} aria-label="移动端预览区域">
            <div className="viewbox-viewport-shell" style={viewportShellStyle}>
              {showRuler && <ViewboxRulers width={device.width} height={device.height} zoom={zoom} />}
              <div className="viewbox-viewport" role="region" aria-label={viewportLabel} style={viewportStyle}>
                <iframe
                  key={reloadGeneration}
                  ref={previewFrameRef}
                  className="viewbox-frame"
                  title={viewportLabel}
                  src={frameSource}
                  allow="autoplay"
                  onLoad={handlePreviewLoad}
                />
                <ViewboxOverlays showGrid={showGrid} />
              </div>
            </div>
          </section>
        )}

        <aside className="viewbox-toolbar" aria-label="预览控制">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={isDevicePickerOpen ? 'secondary' : 'outline'}
                  size="icon-lg"
                  aria-label="选择预览设备"
                  aria-pressed={isDevicePickerOpen}
                  onClick={() => setIsDevicePickerOpen((open) => !open)}
                >
                  <MonitorSmartphone data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent side="left">{isDevicePickerOpen ? '关闭设备选择' : '选择预览设备'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={zoomMode === 'fit' ? 'secondary' : 'outline'}
                  size="icon-lg"
                  aria-label="适配预览画布"
                  aria-pressed={zoomMode === 'fit'}
                  onClick={fitAndCenterCanvas}
                >
                  <Maximize data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent side="left">适配预览画布</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="outline" size="icon-lg" aria-label="刷新预览" onClick={reloadPreview}>
                  <RefreshCw data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent side="left">刷新预览</TooltipContent>
          </Tooltip>

          <span className="viewbox-toolbar-separator" aria-hidden="true" />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={isCanvasControlVisible ? 'outline' : 'secondary'}
                  size="icon-lg"
                  aria-label={canvasControlLabel}
                  aria-pressed={isCanvasControlVisible}
                  onClick={() => setIsCanvasControlVisible((visible) => !visible)}
                >
                  {isCanvasControlVisible ? <PanelLeftClose data-icon="inline-start" /> : <PanelLeftOpen data-icon="inline-start" />}
                </Button>
              }
            />
            <TooltipContent side="left">{canvasControlLabel}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={showRuler ? 'secondary' : 'outline'}
                  size="icon-lg"
                  aria-label="切换标尺"
                  aria-pressed={showRuler}
                  onClick={() => setShowRuler((visible) => !visible)}
                >
                  <Ruler data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent side="left">{showRuler ? '关闭标尺' : '显示标尺'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={showGrid ? 'secondary' : 'outline'}
                  size="icon-lg"
                  aria-label="切换 8 像素网格"
                  aria-pressed={showGrid}
                  onClick={() => setShowGrid((visible) => !visible)}
                >
                  <Grid3X3 data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent side="left">{showGrid ? '关闭 8px 网格' : '显示 8px 网格'}</TooltipContent>
          </Tooltip>

          <span className="viewbox-toolbar-separator" aria-hidden="true" />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-lg"
                  aria-label={visibilityLabel}
                  aria-pressed={isEnabled}
                  onClick={() => setIsEnabled((enabled) => !enabled)}
                >
                  {isEnabled ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                </Button>
              }
            />
            <TooltipContent side="left">{visibilityLabel}</TooltipContent>
          </Tooltip>
        </aside>

        {isDevicePickerOpen && (
          <Card className="viewbox-device-picker" size="xs" aria-label="预览设备选择">
            <CardHeader>
              <CardTitle>预览设备</CardTitle>
            </CardHeader>
            <CardContent>
              <ToggleGroup
                className="viewbox-device-toggle-group"
                value={[deviceId]}
                onValueChange={handleDevicePickerChange}
                orientation="vertical"
              >
                {VIEWBOX_DEVICE_PRESETS.map((preset) => (
                  <ToggleGroupItem key={preset.id} className="viewbox-device-toggle-item" value={preset.id}>
                    {`${preset.label} · ${preset.width} × ${preset.height}`}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </CardContent>
          </Card>
        )}

        {isEnabled && isCanvasControlVisible && (
          <Card className="viewbox-zoom-control" size="xs" aria-label="画布布局">
            <CardHeader>
              <CardTitle>画布</CardTitle>
              <CardAction>
                <div className="viewbox-device-summary" aria-live="polite">
                  <Badge variant="secondary">{device.label}</Badge>
                  <Badge variant="outline">{device.width} × {device.height}</Badge>
                </div>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="viewbox-control-list">
                <ViewboxRangeControl
                  label="缩放"
                  value={zoomPercent}
                  min={VIEWBOX_MIN_ZOOM}
                  max={VIEWBOX_MAX_ZOOM}
                  step={VIEWBOX_ZOOM_STEP}
                  onValueChange={handleZoomChange}
                  valueLabel={zoomLabel}
                />
                <span className="viewbox-control-section-label">画布位置</span>
                <div className="viewbox-canvas-position-control">
                  <ViewboxJoystick onMove={moveCanvas} />
                  <div className="viewbox-inset-readout" aria-label="当前画布位置，范围为正负五百像素">
                    <span>上 <output>{-canvasPosition.y}px</output></span>
                    <span>右 <output>{canvasPosition.x}px</output></span>
                    <span>下 <output>{canvasPosition.y}px</output></span>
                    <span>左 <output>{-canvasPosition.x}px</output></span>
                  </div>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button variant="outline" size="icon-sm" aria-label="复位画布位置" onClick={resetCanvasPosition}>
                          <RotateCcw data-icon="inline-start" />
                        </Button>
                      }
                    />
                    <TooltipContent side="top">复位画布位置</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}

type ViewboxOverlaysProps = {
  showGrid: boolean;
};

/**
 * 在预览页上方绘制不会拦截触控的 8px 网格。
 * @param props.showGrid - 是否绘制 8px 网格。
 * @returns 叠加在 iframe 上方的只读网格；关闭时不渲染内容。
 */
function ViewboxOverlays({ showGrid }: ViewboxOverlaysProps) {
  if (!showGrid) return null;

  return (
    <div className="viewbox-overlays" aria-hidden="true">
      {showGrid && <div className="viewbox-grid-overlay" />}
    </div>
  );
}

type ViewboxRulersProps = {
  width: number;
  height: number;
  zoom: number;
};

/**
 * 在预览框外侧绘制与当前缩放同步的坐标标尺。
 * @param props.width - 设备视口的逻辑宽度，单位为 CSS 像素。
 * @param props.height - 设备视口的逻辑高度，单位为 CSS 像素。
 * @param props.zoom - 当前预览缩放倍数，用于将逻辑刻度映射到外层实际显示尺寸。
 * @returns 位于顶部和左侧边框的只读标尺，不会覆盖 iframe（内嵌预览页）。
 */
function ViewboxRulers({ width, height, zoom }: ViewboxRulersProps) {
  const horizontalMarks = createRulerMarks(width);
  const verticalMarks = createRulerMarks(height);
  const scaledWidth = Math.round(width * zoom);
  const scaledHeight = Math.round(height * zoom);

  return (
    <div className="viewbox-external-rulers" aria-hidden="true">
      <div
        className="viewbox-external-ruler viewbox-external-ruler-top"
        style={{ left: `${VIEWBOX_RULER_LEFT_SIZE}px`, width: `${scaledWidth}px` }}
      >
        {horizontalMarks.map((mark) => (
          <span key={mark} className="viewbox-external-ruler-mark" style={{ left: `${Math.round(mark * zoom)}px` }}>
            <span>{mark}</span>
          </span>
        ))}
      </div>
      <div
        className="viewbox-external-ruler viewbox-external-ruler-left"
        style={{ top: `${VIEWBOX_RULER_TOP_SIZE}px`, height: `${scaledHeight}px` }}
      >
        {verticalMarks.map((mark) => (
          <span key={mark} className="viewbox-external-ruler-mark" style={{ top: `${Math.round(mark * zoom)}px` }}>
            <span>{mark}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

type ViewboxRangeControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number | readonly number[]) => void;
  valueLabel?: string;
};

type ViewboxJoystickProps = {
  onMove: (deltaX: number, deltaY: number) => void;
};

type ViewboxJoystickPosition = {
  x: number;
  y: number;
};

const VIEWBOX_JOYSTICK_MAX_OFFSET = 21;

/**
 * 将单轴画布坐标限制在允许的双向移动范围内。
 *
 * 统一在状态写入前截断，避免指针高速移动或键盘连续按键使坐标越过 -500px 至 500px。
 *
 * @param value - 尚未限制的 x 或 y 坐标，单位为 CSS 像素。
 * @returns 位于 -500px 至 500px 范围内的整数坐标。
 */
function clampCanvasPosition(value: number): number {
  const roundedValue = Math.round(value);
  return Math.min(VIEWBOX_CANVAS_POSITION_MAX, Math.max(VIEWBOX_CANVAS_POSITION_MIN, roundedValue));
}

/**
 * 渲染可拖拽的二维画布摇杆，并将每一段鼠标或触摸位移立即传给上层。
 *
 * 摇杆旋钮在释放时回到中心，但画布保留当前位置。方向键支持 1px 微调，
 * 因此既能拖动完成大范围移动，也能通过键盘进行精确校正。
 *
 * @param props.onMove - 接收本次水平和垂直位移的回调，单位为 CSS 像素。
 * @returns 可访问的二维摇杆控制区。
 */
function ViewboxJoystick({ onMove }: ViewboxJoystickProps) {
  const [knobPosition, setKnobPosition] = useState<ViewboxJoystickPosition>({ x: 0, y: 0 });
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointerPositionRef = useRef<ViewboxJoystickPosition | null>(null);
  const joystickStyle = {
    '--viewbox-joystick-x': `${knobPosition.x}px`,
    '--viewbox-joystick-y': `${knobPosition.y}px`,
  } as CSSProperties;

  /**
   * 清理本次拖动状态并使摇杆旋钮回到视觉中心。
   * @returns 无返回值；不会重置外层保存的画布位置。
   */
  const resetJoystick = () => {
    activePointerIdRef.current = null;
    lastPointerPositionRef.current = null;
    setKnobPosition({ x: 0, y: 0 });
  };

  /**
   * 开始追踪当前指针，并使用 Pointer Capture（指针捕获）保证拖出圆盘后仍能连续调整。
   * @param event - 触发拖拽开始的 React 指针事件。
   * @returns 无返回值；仅记录起点，不在按下瞬间移动画布。
   */
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    activePointerIdRef.current = event.pointerId;
    lastPointerPositionRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /**
   * 将指针的增量位移同步到画布，并将摇杆旋钮限制在圆盘半径范围内。
   * @param event - 当前 React 指针移动事件。
   * @returns 无返回值；非活动指针会被忽略。
   */
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId || !lastPointerPositionRef.current) return;

    const deltaX = event.clientX - lastPointerPositionRef.current.x;
    const deltaY = event.clientY - lastPointerPositionRef.current.y;
    lastPointerPositionRef.current = { x: event.clientX, y: event.clientY };
    onMove(deltaX, deltaY);

    setKnobPosition((position) => clampJoystickPosition({ x: position.x + deltaX, y: position.y + deltaY }));
  };

  /**
   * 在指针释放、取消或失去捕获时结束拖拽并回正旋钮。
   * @param event - 结束当前拖拽的 React 指针事件。
   * @returns 无返回值；其他指针不会影响正在进行的拖拽。
   */
  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resetJoystick();
  };

  /**
   * 允许键盘以单像素精度微调画布，满足无法或不便进行指针拖拽的场景。
   * @param event - 当前 React 键盘事件。
   * @returns 无返回值；方向键以外的按键保持默认行为。
   */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keyMoves: Record<string, ViewboxJoystickPosition> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowRight: { x: 1, y: 0 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
    };
    const move = keyMoves[event.key];
    if (!move) return;

    event.preventDefault();
    onMove(move.x, move.y);
  };

  return (
    <div
      className="viewbox-joystick"
      role="group"
      tabIndex={0}
      aria-label="精准移动画布"
      style={joystickStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      <span className="viewbox-joystick-knob" aria-hidden="true" />
    </div>
  );
}

/**
 * 将摇杆旋钮约束在可视圆盘内，避免高速拖动使旋钮越出边界。
 * @param position - 尚未限制的旋钮二维坐标。
 * @returns 距离中心不超过预设半径的二维坐标。
 */
function clampJoystickPosition(position: ViewboxJoystickPosition): ViewboxJoystickPosition {
  const distance = Math.hypot(position.x, position.y);
  if (distance <= VIEWBOX_JOYSTICK_MAX_OFFSET) return position;

  const scale = VIEWBOX_JOYSTICK_MAX_OFFSET / distance;
  return { x: position.x * scale, y: position.y * scale };
}

/**
 * 渲染单个画布数值滑块及其当前读数。
 * @param props.label - 控件的可见方向或数值名称。
 * @param props.value - 当前滑块数值。
 * @param props.min - 允许的最小数值。
 * @param props.max - 允许的最大数值。
 * @param props.step - 每次键盘或拖动调整的步进值。
 * @param props.onValueChange - 数值变化时通知上层状态的回调。
 * @param props.valueLabel - 可选的替代显示文本；未提供时以像素显示数值。
 * @returns 包含标签、Slider（滑块）与当前读数的紧凑控制行。
 */
function ViewboxRangeControl({ label, value, min, max, step, onValueChange, valueLabel }: ViewboxRangeControlProps) {
  return (
    <div className="viewbox-range-control">
      <span>{label}</span>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={onValueChange}
        aria-label={`${label}数值`}
      />
      <output>{valueLabel ?? `${value}px`}</output>
    </div>
  );
}

/**
 * 从浏览器本地存储读取并校验预览工具偏好。
 * @returns 有效的 ViewboxPreferences（预览框偏好）；存储不可用或内容异常时返回默认值。
 */
function readViewboxPreferences(): ViewboxPreferences {
  try {
    const currentSerializedPreferences = localStorage.getItem(VIEWBOX_PREFERENCES_STORAGE_KEY);
    const serializedPreferences = currentSerializedPreferences
      ?? localStorage.getItem(VIEWBOX_V2_PREFERENCES_STORAGE_KEY)
      ?? localStorage.getItem(VIEWBOX_LEGACY_PREFERENCES_STORAGE_KEY);
    if (!serializedPreferences) return createDefaultViewboxPreferences();

    const parsedPreferences: unknown = JSON.parse(serializedPreferences);
    if (!isRecord(parsedPreferences)) return createDefaultViewboxPreferences();

    // v1/v2 使用四边读数；v3 改用以中心为零点的 x/y 坐标。
    const canvasPosition = currentSerializedPreferences === null
      ? readLegacyCanvasPosition(parsedPreferences.canvasInsets)
      : readStoredCanvasPosition(parsedPreferences.canvasPosition);
    return {
      deviceId: isViewboxDevicePresetId(parsedPreferences.deviceId)
        ? parsedPreferences.deviceId
        : VIEWBOX_DEFAULT_PREFERENCES.deviceId,
      zoomMode: parsedPreferences.zoomMode === 'fit' ? 'fit' : 'manual',
      manualZoom: readBoundedNumber(
        parsedPreferences.manualZoom,
        VIEWBOX_MIN_ZOOM,
        VIEWBOX_MAX_ZOOM,
        VIEWBOX_ZOOM_STEP,
        VIEWBOX_DEFAULT_PREFERENCES.manualZoom,
      ),
      canvasPosition,
      showRuler: typeof parsedPreferences.showRuler === 'boolean' ? parsedPreferences.showRuler : false,
      showGrid: typeof parsedPreferences.showGrid === 'boolean' ? parsedPreferences.showGrid : false,
    };
  } catch {
    // 隐私模式、配额限制或手动写入的损坏 JSON 都不应阻止预览页正常打开。
    return createDefaultViewboxPreferences();
  }
}

/**
 * 将当前预览工具偏好写入浏览器本地存储。
 * @param preferences - 已完成数值校验的 ViewboxPreferences（预览框偏好）。
 * @returns 无返回值；存储不可用时静默跳过，保留当前内存状态。
 */
function writeViewboxPreferences(preferences: ViewboxPreferences): void {
  try {
    localStorage.setItem(VIEWBOX_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 本地存储是渐进增强能力，写入失败不影响本次预览操作。
  }
}

/**
 * 生成不会与可变状态共享引用的默认预览工具偏好。
 * @returns 包含独立画布坐标对象的默认 ViewboxPreferences（预览框偏好）。
 */
function createDefaultViewboxPreferences(): ViewboxPreferences {
  return {
    ...VIEWBOX_DEFAULT_PREFERENCES,
    canvasPosition: { ...VIEWBOX_DEFAULT_PREFERENCES.canvasPosition },
  };
}

/**
 * 判断未知 JSON 字段是否是可安全读取键值的普通对象。
 * @param value - JSON.parse（JSON 解析）得到的未知值。
 * @returns 当 value 为非空对象且不是数组时返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断值是否为当前设备菜单支持的预设标识。
 * @param value - 本地存储中读取的未知设备标识。
 * @returns 当值存在于 VIEWBOX_DEVICE_PRESETS（设备预设列表）时返回 true。
 */
function isViewboxDevicePresetId(value: unknown): value is ViewboxDevicePresetId {
  return typeof value === 'string' && VIEWBOX_DEVICE_PRESETS.some((preset) => preset.id === value);
}

/**
 * 读取并校验 v3 本地存储中的画布坐标。
 *
 * x 轴和 y 轴以舞台中心为零点，均限制为 -500px 至 500px。损坏或缺失的字段
 * 会分别回退为 0，保证预览始终从可预测的位置开始渲染。
 *
 * @param value - 本地存储中读取的未知坐标对象。
 * @returns 位于双向边界内且已对齐步进的画布坐标。
 */
function readStoredCanvasPosition(value: unknown): ViewboxCanvasPosition {
  const parsedPosition = isRecord(value) ? value : {};
  return {
    x: readBoundedNumber(
      parsedPosition.x,
      VIEWBOX_CANVAS_POSITION_MIN,
      VIEWBOX_CANVAS_POSITION_MAX,
      VIEWBOX_CANVAS_POSITION_STEP,
      VIEWBOX_DEFAULT_CANVAS_POSITION.x,
    ),
    y: readBoundedNumber(
      parsedPosition.y,
      VIEWBOX_CANVAS_POSITION_MIN,
      VIEWBOX_CANVAS_POSITION_MAX,
      VIEWBOX_CANVAS_POSITION_STEP,
      VIEWBOX_DEFAULT_CANVAS_POSITION.y,
    ),
  };
}

/**
 * 将 v1/v2 四边读数转换为以舞台中心为零点的 x/y 坐标。
 *
 * 旧版通过相对边距的差值移动画布，因此左右、上下读数之差的一半就是实际位移。
 * 转换后再使用当前的双向坐标边界截断，避免异常缓存将画布移出允许范围。
 *
 * @param value - v1/v2 本地存储中的未知四边读数对象。
 * @returns 换算并限制后的画布坐标。
 */
function readLegacyCanvasPosition(value: unknown): ViewboxCanvasPosition {
  const parsedInsets = isRecord(value) ? value : {};
  const top = readBoundedNumber(parsedInsets.top, 0, VIEWBOX_LEGACY_CANVAS_INSET_MAX, 1, 0);
  const right = readBoundedNumber(parsedInsets.right, 0, VIEWBOX_LEGACY_CANVAS_INSET_MAX, 1, 0);
  const bottom = readBoundedNumber(parsedInsets.bottom, 0, VIEWBOX_LEGACY_CANVAS_INSET_MAX, 1, 0);
  const left = readBoundedNumber(parsedInsets.left, 0, VIEWBOX_LEGACY_CANVAS_INSET_MAX, 1, 0);

  return {
    x: clampCanvasPosition((left - right) / 2),
    y: clampCanvasPosition((top - bottom) / 2),
  };
}

/**
 * 校验、限制并对齐缓存中的数值，避免损坏或旧版本缓存将画布推到异常比例。
 * @param value - 缓存中读取的未知数值。
 * @param minimum - 当前控件允许的最小值。
 * @param maximum - 当前控件允许的最大值。
 * @param step - 控件要求的数值步进。
 * @param fallback - 值无效时采用的默认数值。
 * @returns 位于范围内且对齐步进的有效数值。
 */
function readBoundedNumber(value: unknown, minimum: number, maximum: number, step: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const boundedValue = Math.min(maximum, Math.max(minimum, value));
  return Math.round(boundedValue / step) * step;
}

/**
 * 计算可完整容纳设备视口的最大缩放比例。
 * @param stageSize - 预览舞台的当前宽高。
 * @param device - 当前选中的设备预设及其逻辑尺寸。
 * @param includeRulers - 是否为外置标尺预留顶部与左侧空间。
 * @param insets - 预览舞台固定的四边留白，用于从可用预览面积中扣除。
 * @returns 介于 40% 和 300% 的整数缩放比例；舞台尚未完成测量时返回 100%。
 */
function getFittedZoom(
  stageSize: StageSize,
  device: ViewboxDevicePreset,
  includeRulers: boolean,
  insets: ViewboxInsets,
): number {
  if (stageSize.width === 0 || stageSize.height === 0) return 100;

  // 为状态条、控制栏和预览阴影留出空间，避免适配后的设备边缘紧贴画布。
  const rulerWidth = includeRulers ? VIEWBOX_RULER_LEFT_SIZE : 0;
  const rulerHeight = includeRulers ? VIEWBOX_RULER_TOP_SIZE : 0;
  const availableWidth = Math.max(0, stageSize.width - insets.left - insets.right - 48 - rulerWidth);
  const availableHeight = Math.max(0, stageSize.height - insets.top - insets.bottom - 48 - rulerHeight);
  const zoom = Math.min(availableWidth / device.width, availableHeight / device.height) * 100;
  const boundedZoom = Math.min(VIEWBOX_MAX_ZOOM, Math.max(VIEWBOX_MIN_ZOOM, zoom));
  return Math.round(boundedZoom / VIEWBOX_ZOOM_STEP) * VIEWBOX_ZOOM_STEP;
}

/**
 * 创建每 100 CSS 像素一个标签的标尺刻度。
 * @param length - 需要标记的轴向长度，单位为 CSS 像素。
 * @returns 从 0 开始且不超过轴向长度的刻度值数组。
 */
function createRulerMarks(length: number): number[] {
  const interval = 100;
  return Array.from({ length: Math.floor(length / interval) + 1 }, (_, index) => index * interval);
}
