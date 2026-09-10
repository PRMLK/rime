import { ChevronDown, Database, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose } from '@/components/ui/drawer';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { MobileDrawerCard } from '@/mobile/components/MobileDrawerCard';
import { getAccountSettings, updateAccountSettings } from '@/mobile/api/rime';
import {
  bytesToGibibytes, gibibytesToBytes, readClientSettings, writeClientSettings,
  type ClientSettings, type PlaybackQuality,
} from '@/mobile/lib/client-settings';
import { clearArtworkRuntimeCache } from '@/mobile/services/artwork-cache';
import { clearClientCache, getClientCacheStatus, type ClientCacheStatus } from '@/mobile/services/client-cache';
import { clearMediaCache, getMediaCacheStatus, hasNativeMediaCache, pruneMediaCache, type MediaCacheStatus } from '@/mobile/services/media-cache';

const playbackOptions: Array<{ value: PlaybackQuality; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'original', label: '原始质量' },
  { value: 320, label: '320 kbps' },
  { value: 256, label: '256 kbps' },
  { value: 192, label: '192 kbps' },
  { value: 128, label: '128 kbps' },
  { value: 96, label: '96 kbps' },
];

/**
 * 渲染当前设备的播放与缓存设置，并为管理员提供账号专属的播放器诊断开关。
 *
 * @param props - 抽屉开关、客户端设置作用域、管理员身份及诊断模式的受控状态。
 * @returns 包含本地客户端设置和管理员诊断设置的 Drawer（抽屉）内容。
 */
export function ClientSettingsDrawer({
  open,
  onOpenChange,
  scope,
  isAdmin,
  debugEnabled,
  onDebugEnabledChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: string;
  isAdmin: boolean;
  debugEnabled: boolean;
  onDebugEnabledChange: (enabled: boolean) => void;
}) {
  const [settings, setSettings] = useState<ClientSettings>(() => readClientSettings(scope));
  const [mediaCacheStatus, setMediaCacheStatus] = useState<MediaCacheStatus>({ usedBytes: 0, itemCount: 0 });
  const [clientCacheStatus, setClientCacheStatus] = useState<ClientCacheStatus>({ usedBytes: 0, itemCount: 0, artworkCount: 0, responseCount: 0 });
  const [cacheError, setCacheError] = useState<string>();
  const [currentDebugEnabled, setCurrentDebugEnabled] = useState(debugEnabled);
  const [isLoadingDebugSetting, setIsLoadingDebugSetting] = useState(false);
  const [isUpdatingDebugSetting, setIsUpdatingDebugSetting] = useState(false);
  const [debugSettingError, setDebugSettingError] = useState<string>();
  const native = hasNativeMediaCache();

  useEffect(() => {
    if (!open) return;
    setSettings(readClientSettings(scope));
    setCacheError(undefined);
    void Promise.all([getMediaCacheStatus(scope), getClientCacheStatus(scope)])
      .then(([mediaStatus, clientStatus]) => {
        setMediaCacheStatus(mediaStatus);
        setClientCacheStatus(clientStatus);
      })
      .catch((error: unknown) => setCacheError(error instanceof Error ? error.message : '缓存信息读取失败'));
  }, [open, scope]);

  useEffect(() => setCurrentDebugEnabled(debugEnabled), [debugEnabled]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    const controller = new AbortController();
    setIsLoadingDebugSetting(true);
    setDebugSettingError(undefined);
    getAccountSettings(controller.signal)
      .then((accountSettings) => {
        if (controller.signal.aborted) return;
        setCurrentDebugEnabled(accountSettings.debugEnabled);
        onDebugEnabledChange(accountSettings.debugEnabled);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setDebugSettingError(loadError instanceof Error ? loadError.message : '调试模式读取失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingDebugSetting(false);
      });
    return () => controller.abort();
  }, [isAdmin, onDebugEnabledChange, open]);

  const updateSettings = (next: ClientSettings) => {
    setSettings(next);
    writeClientSettings(scope, next);
  };

  const updateCacheLimit = async (value: number | readonly number[]) => {
    const gibibytes = Array.isArray(value) ? (value[0] ?? 0) : value;
    const next = { ...settings, maxCacheBytes: gibibytesToBytes(gibibytes) };
    updateSettings(next);
    try {
      setMediaCacheStatus(await pruneMediaCache(scope, next.maxCacheBytes));
      setCacheError(undefined);
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : '缓存上限更新失败');
    }
  };

  const clear = async () => {
    try {
      const [mediaStatus, clientStatus] = await Promise.all([clearMediaCache(scope), clearClientCache(scope)]);
      clearArtworkRuntimeCache(scope);
      setMediaCacheStatus(mediaStatus);
      setClientCacheStatus(clientStatus);
      setCacheError(undefined);
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : '缓存清理失败');
    }
  };

  /**
   * 更新当前管理员账号的播放调试开关，并在服务端确认后同步播放器状态。
   *
   * @param enabled - true 表示采集并展示播放器诊断，false 表示停止采集并隐藏诊断框。
   * @returns 无返回值；写入失败时恢复已确认的旧状态并显示接口错误。
   */
  const changeDebugEnabled = async (enabled: boolean) => {
    const previous = currentDebugEnabled;
    setCurrentDebugEnabled(enabled);
    setIsUpdatingDebugSetting(true);
    setDebugSettingError(undefined);
    try {
      const accountSettings = await updateAccountSettings({ debugEnabled: enabled });
      setCurrentDebugEnabled(accountSettings.debugEnabled);
      onDebugEnabledChange(accountSettings.debugEnabled);
    } catch (updateError: unknown) {
      setCurrentDebugEnabled(previous);
      setDebugSettingError(updateError instanceof Error ? updateError.message : '调试模式更新失败');
    } finally {
      setIsUpdatingDebugSetting(false);
    }
  };

  const cacheLimitGiB = bytesToGibibytes(settings.maxCacheBytes);
  const totalCacheBytes = mediaCacheStatus.usedBytes + clientCacheStatus.usedBytes;
  const totalCacheItems = mediaCacheStatus.itemCount + clientCacheStatus.itemCount;
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <MobileDrawerCard
        title="客户端设置"
        leading={<DrawerClose render={<Button variant="ghost" size="icon" aria-label="退出客户端设置"><ChevronDown aria-hidden="true" /></Button>} />}
        contentProps={{ 'aria-label': '客户端设置项目' }}
        contentClassName="flex flex-col gap-8"
      >
        <FieldGroup>
          <Field data-disabled={!native || undefined}>
            <div className="flex items-center justify-between gap-4">
              <FieldLabel htmlFor="cache-limit">最大缓存大小</FieldLabel>
              <output className="shrink-0 text-sm tabular-nums text-muted-foreground" htmlFor="cache-limit">
                {native ? (cacheLimitGiB === 0 ? '关闭' : `${cacheLimitGiB} GB`) : '由浏览器管理'}
              </output>
            </div>
            <Slider
              id="cache-limit"
              min={0}
              max={50}
              step={1}
              value={[cacheLimitGiB]}
              disabled={!native}
              aria-label="最大缓存大小"
              onValueChange={(value) => {
                const gibibytes = Array.isArray(value) ? (value[0] ?? 0) : value;
                updateSettings({ ...settings, maxCacheBytes: gibibytesToBytes(gibibytes) });
              }}
              onValueCommitted={(value) => void updateCacheLimit(value)}
            />
            <FieldDescription>{native ? '达到上限后自动删除最久未播放的歌曲；列表和封面会自动管理。' : '网页端的列表和封面缓存空间由当前浏览器自动管理。'}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="playback-quality">播放码率</FieldLabel>
            <Select
              value={String(settings.playbackQuality)}
              onValueChange={(value) => {
                const parsed = value === 'auto' || value === 'original' ? value : Number(value) as PlaybackQuality;
                updateSettings({ ...settings, playbackQuality: parsed });
              }}
            >
              <SelectTrigger id="playback-quality" className="w-full">
                <SelectValue>{playbackOptions.find((option) => option.value === settings.playbackQuality)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {playbackOptions.map((option) => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>从下一首歌曲开始应用；低码率音源不会被放大。</FieldDescription>
          </Field>
          {isAdmin && (
            <Field orientation="horizontal" data-disabled={isLoadingDebugSetting || isUpdatingDebugSetting || undefined}>
              <FieldContent>
                <FieldLabel htmlFor="player-debug-enabled">播放器调试模式</FieldLabel>
                <FieldDescription>显示当前账号的播放源协商、传输状态和错误信息。</FieldDescription>
              </FieldContent>
              <Switch
                id="player-debug-enabled"
                checked={currentDebugEnabled}
                disabled={isLoadingDebugSetting || isUpdatingDebugSetting}
                aria-label="播放器调试模式"
                onCheckedChange={changeDebugEnabled}
              />
            </Field>
          )}
          {isAdmin && debugSettingError && <FieldError>{debugSettingError}</FieldError>}
        </FieldGroup>

        <Separator />
        <section className="flex flex-col gap-4" aria-labelledby="cache-usage-heading">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 id="cache-usage-heading" className="text-sm font-medium">缓存占用</h2>
              <p className="text-sm text-muted-foreground">
                {native
                  ? `${formatBytes(totalCacheBytes)} · ${mediaCacheStatus.itemCount} 首歌曲 · ${clientCacheStatus.artworkCount} 张封面 · ${clientCacheStatus.responseCount} 组列表`
                  : `${formatBytes(clientCacheStatus.usedBytes)} · ${clientCacheStatus.artworkCount} 张封面 · ${clientCacheStatus.responseCount} 组列表`}
              </p>
            </div>
          </div>
          {cacheError && <p className="text-sm text-destructive">{cacheError}</p>}
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" disabled={totalCacheItems === 0}><Trash2 data-icon="inline-start" />清理缓存</Button>} />
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>清理客户端缓存？</AlertDialogTitle><AlertDialogDescription>已缓存的歌曲、封面和列表数据会被删除，账户、歌单内容和播放设置不会受到影响。</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void clear()}>清理</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      </MobileDrawerCard>
    </Drawer>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
