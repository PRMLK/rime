import { Expand, Eye, EyeOff, Shrink } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import './Viewbox.css';

type ViewboxMode = 'phone' | 'tablet';

type ViewboxProps = {
  previewSource?: string;
};

export function Viewbox({ previewSource = import.meta.env.VITE_VIEWBOX_SRC ?? '/mobile.html' }: ViewboxProps) {
  const [isEnabled, setIsEnabled] = useState(true);
  const [mode, setMode] = useState<ViewboxMode>('phone');
  const isTablet = mode === 'tablet';
  const viewportLabel = isTablet ? '4:3 横屏平板视口' : '20:9 手机视口';
  const nextModeLabel = isTablet ? '收缩为 20:9 手机视口' : '展开为 4:3 横屏平板视口';
  const visibilityLabel = isEnabled ? '关闭 Viewbox' : '开启 Viewbox';

  return (
    <TooltipProvider>
      <div className="viewbox-suite" data-device-mode={mode} data-enabled={isEnabled}>
      {isEnabled && (
        <section className="viewbox-stage" aria-label="移动端预览区域">
          <div className={`viewbox-viewport ${isTablet ? 'is-tablet' : ''}`} role="region" aria-label={viewportLabel}>
            <iframe className="viewbox-frame" title={viewportLabel} src={previewSource} allow="autoplay" />
          </div>
        </section>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className="viewbox-control-position viewbox-visibility-toggle"
              variant="outline"
              size="icon-lg"
              aria-label={visibilityLabel}
              aria-pressed={isEnabled}
              onClick={() => setIsEnabled((enabled) => !enabled)}
            >
              {isEnabled ? <EyeOff /> : <Eye />}
            </Button>
          }
        />
        <TooltipContent side="left">{visibilityLabel}</TooltipContent>
      </Tooltip>

      {isEnabled && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                className="viewbox-control-position viewbox-mode-toggle"
                variant="outline"
                size="icon-lg"
                aria-label={nextModeLabel}
                aria-pressed={isTablet}
                onClick={() => setMode(isTablet ? 'phone' : 'tablet')}
              >
                {isTablet ? <Shrink /> : <Expand />}
              </Button>
            }
          />
          <TooltipContent side="left">{nextModeLabel}</TooltipContent>
        </Tooltip>
      )}
      </div>
    </TooltipProvider>
  );
}
