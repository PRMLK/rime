import { ArrowLeft, Heart, KeyRound, LibraryBig, ListMusic, LoaderCircle, LogOut, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createPlaylist,
  changePassword,
  deletePlaylist,
  getPlaylist,
  getPlaylists,
  logout,
  playlistsChangedEvent,
  removeTrackFromPlaylist,
  renamePlaylist,
  type Playlist,
  type PlaylistDetail,
  type Track,
  type User,
} from '@/api/rime';
import { AlbumArtwork } from '@/components/AlbumArtwork';
import { UnifiedListFooterLogo, UnifiedListRow } from '@/components/UnifiedListRow';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type Props = {
  user: User;
  onChooseTrack: (track: Track) => void;
  onOpenSystemSettings: () => void;
  onSignedOut: () => void;
};

export function LibraryView({ user, onChooseTrack, onOpenSystemSettings, onSignedOut }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedID, setSelectedID] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    getPlaylists(controller.signal)
      .then((page) => setPlaylists(page.items))
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : '歌单加载失败');
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [refresh]);

  const reload = useCallback(() => setRefresh((value) => value + 1), []);
  useEffect(() => {
    window.addEventListener(playlistsChangedEvent, reload);
    return () => window.removeEventListener(playlistsChangedEvent, reload);
  }, [reload]);

  if (selectedID) {
    return <PlaylistPanel playlistID={selectedID} onBack={() => { setSelectedID(undefined); reload(); }} onChooseTrack={onChooseTrack} />;
  }

  return (
    <section className="mt-8" aria-labelledby="library-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="library-heading" className="text-sm font-semibold">我的音乐</h2>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="新建歌单" onClick={() => setCreating(true)} />}>
            <Plus aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>新建歌单</TooltipContent>
        </Tooltip>
      </div>
      {error && <p className="py-4 text-sm text-destructive">{error}</p>}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在加载</div>
      ) : (
        <ItemGroup className="mt-3 gap-0">
          {playlists.map((playlist) => (
            <UnifiedListRow key={playlist.id} render={<button type="button" onClick={() => setSelectedID(playlist.id)} />} className="cursor-pointer px-5 py-3" separated>
              <ItemMedia variant="icon">{playlist.kind === 'favorites' ? <Heart fill="currentColor" aria-hidden="true" /> : <ListMusic aria-hidden="true" />}</ItemMedia>
              <ItemContent>
                <ItemTitle>{playlist.name}</ItemTitle>
                <ItemDescription>{playlist.trackCount} 首歌曲</ItemDescription>
              </ItemContent>
            </UnifiedListRow>
          ))}
        </ItemGroup>
      )}
      <Separator className="my-8" />
      <h2 className="text-sm font-semibold">账户</h2>
      <ItemGroup className="mt-3 gap-0">
        <Item className="rounded-none px-5 py-3">
          <ItemMedia variant="icon"><LibraryBig aria-hidden="true" /></ItemMedia>
          <ItemContent><ItemTitle>{user.displayName}</ItemTitle><ItemDescription>@{user.username}</ItemDescription></ItemContent>
          <ItemActions><Badge variant="secondary">{user.role === 'admin' ? '管理员' : '用户'}</Badge></ItemActions>
        </Item>
        {user.role === 'admin' && (
          <UnifiedListRow render={<button type="button" onClick={onOpenSystemSettings} />} className="cursor-pointer px-5 py-3" separated>
            <ItemMedia variant="icon"><Settings aria-hidden="true" /></ItemMedia>
            <ItemContent><ItemTitle>系统设置</ItemTitle></ItemContent>
          </UnifiedListRow>
        )}
        <UnifiedListRow render={<button type="button" onClick={() => setChangingPassword(true)} />} className="cursor-pointer px-5 py-3" separated>
          <ItemMedia variant="icon"><KeyRound aria-hidden="true" /></ItemMedia>
          <ItemContent><ItemTitle>修改密码</ItemTitle></ItemContent>
        </UnifiedListRow>
        <UnifiedListRow
          render={<button type="button" onClick={() => void logout().finally(onSignedOut)} />}
          className="cursor-pointer px-5 py-3"
          separated
        >
          <ItemMedia variant="icon"><LogOut aria-hidden="true" /></ItemMedia>
          <ItemContent><ItemTitle>退出登录</ItemTitle></ItemContent>
        </UnifiedListRow>
      </ItemGroup>
      <UnifiedListFooterLogo />
      <PlaylistNameDrawer
        open={creating}
        title="新建歌单"
        submitLabel="创建"
        onOpenChange={setCreating}
        onSubmit={async (name) => { const playlist = await createPlaylist(name); setCreating(false); reload(); setSelectedID(playlist.id); }}
      />
      <OwnPasswordDrawer open={changingPassword} onOpenChange={setChangingPassword} onChanged={onSignedOut} />
    </section>
  );
}

function OwnPasswordDrawer({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = String(form.get('newPassword') ?? '');
    if (next !== String(form.get('confirmPassword') ?? '')) { setError('两次输入的密码不一致'); return; }
    setPending(true); setError(undefined);
    try {
      await changePassword(String(form.get('currentPassword') ?? ''), next);
      onOpenChange(false); onChanged();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '密码修改失败'); }
    finally { setPending(false); }
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <DrawerContent>
        <DrawerHeader><DrawerTitle>修改密码</DrawerTitle></DrawerHeader>
        <form className="px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]" onSubmit={submit}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="own-current-password">当前密码</FieldLabel><Input id="own-current-password" name="currentPassword" type="password" autoComplete="current-password" required /></Field>
            <Field><FieldLabel htmlFor="own-new-password">新密码</FieldLabel><Input id="own-new-password" name="newPassword" type="password" autoComplete="new-password" minLength={8} required /></Field>
            <Field><FieldLabel htmlFor="own-confirm-password">确认新密码</FieldLabel><Input id="own-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required /></Field>
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" size="lg" disabled={pending}>{pending && <LoaderCircle data-icon="inline-start" className="animate-spin" />}保存并重新登录</Button>
          </FieldGroup>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function PlaylistPanel({ playlistID, onBack, onChooseTrack }: { playlistID: string; onBack: () => void; onChooseTrack: (track: Track) => void }) {
  const [playlist, setPlaylist] = useState<PlaylistDetail>();
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getPlaylist(playlistID, controller.signal)
      .then(setPlaylist)
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : '歌单加载失败');
      });
    return () => controller.abort();
  }, [playlistID, refresh]);

  if (!playlist && !error) return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在加载</div>;
  if (!playlist) return <Empty className="mt-8 border"><EmptyHeader><EmptyTitle>无法打开歌单</EmptyTitle><EmptyDescription>{error}</EmptyDescription></EmptyHeader><Button variant="outline" onClick={onBack}>返回</Button></Empty>;

  return (
    <section className="mt-2" aria-labelledby="playlist-title">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="返回我的音乐" onClick={onBack}><ArrowLeft aria-hidden="true" /></Button>
        <div className="min-w-0 flex-1"><h2 id="playlist-title" className="truncate text-base font-semibold">{playlist.name}</h2><p className="text-xs text-muted-foreground">{playlist.trackCount} 首歌曲</p></div>
        {playlist.kind === 'custom' && (
          <>
            <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="重命名歌单" onClick={() => setRenaming(true)} />}><Pencil aria-hidden="true" /></TooltipTrigger><TooltipContent>重命名</TooltipContent></Tooltip>
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="ghost" size="icon" aria-label="删除歌单" />}><Trash2 aria-hidden="true" /></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>删除“{playlist.name}”？</AlertDialogTitle><AlertDialogDescription>歌单中的歌曲不会从音乐库删除。</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void deletePlaylist(playlist.id).then(onBack).catch((deleteError: unknown) => setError(deleteError instanceof Error ? deleteError.message : '删除失败'))}>删除</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
      {error && <p className="py-3 text-sm text-destructive">{error}</p>}
      {playlist.tracks.length === 0 ? (
        <Empty className="mt-8 border"><EmptyHeader><EmptyMedia variant="icon"><ListMusic aria-hidden="true" /></EmptyMedia><EmptyTitle>歌单还是空的</EmptyTitle><EmptyDescription>播放歌曲时可从更多菜单添加到这里。</EmptyDescription></EmptyHeader></Empty>
      ) : (
        <ItemGroup className="mt-5 gap-0">
          {playlist.tracks.map((track) => (
            <Item key={track.id} className="rounded-none border-b px-0 py-2 last:border-b-0">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50" disabled={!track.available} onClick={() => onChooseTrack(track)}>
                <AlbumArtwork artwork={track} size="sm" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{track.title}</span><span className="block truncate text-xs text-muted-foreground">{track.available ? artistNames(track) : '当前不可播放'}</span></span>
              </button>
              <ItemActions><Button variant="ghost" size="icon" aria-label={`从歌单移除《${track.title}》`} onClick={() => void removeTrackFromPlaylist(playlist.id, track.id).then(() => setRefresh((value) => value + 1)).catch((removeError: unknown) => setError(removeError instanceof Error ? removeError.message : '移除失败'))}><Trash2 aria-hidden="true" /></Button></ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      <PlaylistNameDrawer open={renaming} title="重命名歌单" submitLabel="保存" initialName={playlist.name} onOpenChange={setRenaming} onSubmit={async (name) => { await renamePlaylist(playlist.id, name); setRenaming(false); setRefresh((value) => value + 1); }} />
    </section>
  );
}

function PlaylistNameDrawer({ open, title, submitLabel, initialName = '', onOpenChange, onSubmit }: {
  open: boolean; title: string; submitLabel: string; initialName?: string; onOpenChange: (open: boolean) => void; onSubmit: (name: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true); setError(undefined);
    try { await onSubmit(String(new FormData(event.currentTarget).get('name') ?? '')); }
    catch (submitError) { setError(submitError instanceof Error ? submitError.message : '保存失败'); }
    finally { setPending(false); }
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <DrawerContent>
        <DrawerHeader><DrawerTitle>{title}</DrawerTitle></DrawerHeader>
        <form className="px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]" onSubmit={submit}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="playlist-name">歌单名称</FieldLabel><Input id="playlist-name" name="name" defaultValue={initialName} maxLength={80} autoFocus required /></Field>
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" size="lg" disabled={pending}>{pending && <LoaderCircle data-icon="inline-start" className="animate-spin" />}{submitLabel}</Button>
          </FieldGroup>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function artistNames(track: Track): string {
  return track.artists.map((artist) => artist.name).join(' / ') || '未知歌手';
}
