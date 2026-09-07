import { ChevronDown, Database, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose } from '@/components/ui/drawer';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { MobileDrawerCard } from '@/components/MobileDrawerCard';
import {
  bytesToGibibytes, gibibytesToBytes, readClientSettings, writeClientSettings,
  type ClientSettings, type PlaybackQuality,
} from '@/lib/client-settings';
import { clearMediaCache, getMediaCacheStatus, hasNativeMediaCache, pruneMediaCache, type MediaCacheStatus } from '@/services/media-cache';

const playbackOptions: Array<{ value: PlaybackQuality; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'original', label: '原始质量' },
  { value: 320, label: '320 kbps' },
  { value: 256, label: '256 kbps' },
  { value: 192, label: '192 kbps' },
  { value: 128, label: '128 kbps' },
  { value: 96, label: '96 kbps' },
];

export function ClientSettingsDrawer({ open, onOpenChange, scope }: { open: boolean; onOpenChange: (open: boolean) => void; scope: string }) {
  const [settings, setSettings] = useState<ClientSettings>(() => readClientSettings(scope));
  const [cacheStatus, setCacheStatus] = useState<MediaCacheStatus>({ usedBytes: 0, itemCount: 0 });
  const [cacheError, setCacheError] = useState<string>();
  const native = hasNativeMediaCache();

  useEffect(() => {
    if (!open) return;
    setSettings(readClientSettings(scope));
    setCacheError(undefined);
    void getMediaCacheStatus(scope)
      .then(setCacheStatus)
      .catch((error: unknown) => setCacheError(error instanceof Error ? error.message : '缓存信息读取失败'));
  }, [open, scope]);

  const updateSettings = (next: ClientSettings) => {
    setSettings(next);
    writeClientSettings(scope, next);
  };

  const updateCacheLimit = async (value: number | readonly number[]) => {
    const gibibytes = Array.isArray(value) ? (value[0] ?? 0) : value;
    const next = { ...settings, maxCacheBytes: gibibytesToBytes(gibibytes) };
    updateSettings(next);
    try {
      setCacheStatus(await pruneMediaCache(scope, next.maxCacheBytes));
      setCacheError(undefined);
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : '缓存上限更新失败');
    }
  };

  const clear = async () => {
    try {
      setCacheStatus(await clearMediaCache(scope));
      setCacheError(undefined);
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : '缓存清理失败');
    }
  };

  const cacheLimitGiB = bytesToGibibytes(settings.maxCacheBytes);
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
            <FieldDescription>{native ? '达到上限后自动删除最久未播放的歌曲。' : '网页端的媒体缓存空间由当前浏览器控制。'}</FieldDescription>
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
        </FieldGroup>

        <Separator />
        <section className="flex flex-col gap-4" aria-labelledby="cache-usage-heading">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 id="cache-usage-heading" className="text-sm font-medium">缓存占用</h2>
              <p className="text-sm text-muted-foreground">{native ? `${formatBytes(cacheStatus.usedBytes)} · ${cacheStatus.itemCount} 首歌曲` : '网页端不管理音频缓存'}</p>
            </div>
          </div>
          {cacheError && <p className="text-sm text-destructive">{cacheError}</p>}
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" disabled={!native || cacheStatus.itemCount === 0}><Trash2 data-icon="inline-start" />清理缓存</Button>} />
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>清理客户端缓存？</AlertDialogTitle><AlertDialogDescription>已缓存的歌曲会被删除，账户、歌单和播放设置不会受到影响。</AlertDialogDescription></AlertDialogHeader>
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
