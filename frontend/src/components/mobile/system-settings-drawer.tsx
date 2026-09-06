import { ArrowLeft, CalendarClock, ChevronDown, ChevronRight, LoaderCircle, MoreHorizontal, Play, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  createUser as createUserApi, getScheduledTasks, getUsers, resetUserPassword, runScheduledTask, updateUser as updateUserApi,
  type ScheduledTask, type User,
} from '@/api/rime';
import { AppScrollArea } from '@/components/AppScrollArea';
import { UnifiedListRow } from '@/components/UnifiedListRow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * 渲染管理员系统设置抽屉，包括用户管理和计划任务。
 *
 * @param props - 当前抽屉的受控开关状态及其回调。
 * @returns 系统设置的完整 Drawer（抽屉）内容。
 */
export function SystemSettingsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [view, setView] = useState<'root' | 'tasks' | 'users'>('root');
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    if (!open || view !== 'tasks') return;
    const controller = new AbortController();
    let timer: number | undefined;
    setIsLoading(true);
    setError(undefined);

    const load = async () => {
      try {
        const page = await getScheduledTasks(controller.signal);
        if (controller.signal.aborted) return;
        setScheduledTasks(page.items);
        setIsLoading(false);
        if (page.items.some((task) => task.status === 'running')) timer = window.setTimeout(load, 750);
      } catch (loadError: unknown) {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : '计划任务加载失败');
        setIsLoading(false);
      }
    };

    void load();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open, refreshVersion, view]);

  /** 关闭抽屉时复位到设置首页，避免下次打开仍停留在子页。 */
  const changeOpen = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) setView('root');
  };

  /**
   * 立即执行一项计划任务，并在服务端确认后刷新任务状态。
   *
   * @param task - 要执行的计划任务。
   * @returns 无返回值；失败信息显示在任务列表上方。
   */
  const runTask = async (task: ScheduledTask) => {
    setError(undefined);
    setScheduledTasks((items) => items.map((item) => item.id === task.id ? { ...item, status: 'running' } : item));
    try {
      const runningTask = await runScheduledTask(task.id);
      setScheduledTasks((items) => items.map((item) => item.id === task.id ? runningTask : item));
      setRefreshVersion((version) => version + 1);
    } catch (runError: unknown) {
      setError(runError instanceof Error ? runError.message : '计划任务执行失败');
      setRefreshVersion((version) => version + 1);
    }
  };

  return (
    <Drawer open={open} onOpenChange={changeOpen} swipeDirection="down">
      <DrawerContent className="h-[calc(100dvh-0.5rem)] max-h-[calc(100dvh-0.5rem)]">
        <div className="mobile-content-frame">
          <DrawerHeader className="flex-row items-center gap-2 p-0 pb-2 pt-3 text-left">
            {view === 'root' ? (
              <DrawerClose render={<Button variant="ghost" size="icon" aria-label="退出系统设置"><ChevronDown aria-hidden="true" /></Button>} />
            ) : (
              <Button variant="ghost" size="icon" aria-label="返回系统设置" onClick={() => setView('root')}><ArrowLeft aria-hidden="true" /></Button>
            )}
            <DrawerTitle className="min-w-0 flex-1 text-center text-sm">{view === 'root' ? '系统设置' : view === 'tasks' ? '计划任务' : '用户管理'}</DrawerTitle>
            <span className="size-8 shrink-0" aria-hidden="true" />
          </DrawerHeader>
        </div>

        <AppScrollArea className="min-h-0 flex-1">
          <section className="mobile-content-frame pb-[max(env(safe-area-inset-bottom),1.5rem)]" aria-label={view === 'root' ? '系统设置项目' : view === 'tasks' ? '计划任务列表' : '用户列表'}>
            {view === 'root' ? (
              <ItemGroup className="gap-0">
                <UnifiedListRow render={<button type="button" onClick={() => setView('users')} />} className="cursor-pointer py-3" separated>
                  <ItemMedia variant="icon"><Users aria-hidden="true" /></ItemMedia>
                  <ItemContent><ItemTitle>用户管理</ItemTitle></ItemContent>
                  <ItemActions><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></ItemActions>
                </UnifiedListRow>
                <UnifiedListRow render={<button type="button" onClick={() => setView('tasks')} />} className="cursor-pointer py-3" separated>
                  <ItemMedia variant="icon"><CalendarClock aria-hidden="true" /></ItemMedia>
                  <ItemContent><ItemTitle>计划任务</ItemTitle></ItemContent>
                  <ItemActions><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></ItemActions>
                </UnifiedListRow>
              </ItemGroup>
            ) : view === 'tasks' ? (
              <ScheduledTaskList tasks={scheduledTasks} isLoading={isLoading} error={error} onRunTask={runTask} />
            ) : (
              <AdminUserList />
            )}
          </section>
        </AppScrollArea>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * 加载并管理当前系统内的用户。
 *
 * @returns 用户列表、创建用户抽屉和重置密码抽屉。
 */
function AdminUserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState<User>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(undefined);
    getUsers(controller.signal)
      .then((page) => setUsers(page.items))
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : '用户加载失败');
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [refresh]);

  /**
   * 更新用户角色或停用状态。
   *
   * @param user - 要更新的用户。
   * @param input - 允许写入的用户管理字段。
   * @returns 无返回值；成功后触发用户列表刷新。
   */
  const update = async (user: User, input: { role?: User['role']; disabled?: boolean }) => {
    setError(undefined);
    try {
      await updateUserApi(user.id, input);
      setRefresh((value) => value + 1);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '用户更新失败');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{users.length} 个账户</p>
        <Button size="sm" onClick={() => setCreating(true)}><Users data-icon="inline-start" />新建用户</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {isLoading && users.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在加载</div>
      ) : (
        <ItemGroup className="gap-0">
          {users.map((user) => (
            <Item key={user.id} className="rounded-none border-b px-0 py-4 last:border-b-0">
              <ItemContent>
                <ItemTitle className="flex items-center gap-2">{user.displayName}<Badge variant="secondary">{user.role === 'admin' ? '管理员' : '用户'}</Badge></ItemTitle>
                <ItemDescription>@{user.username}{user.disabled ? ' · 已停用' : user.mustChangePassword ? ' · 等待修改密码' : ''}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`管理${user.displayName}`} />}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => void update(user, { role: user.role === 'admin' ? 'user' : 'admin' })}>{user.role === 'admin' ? '设为普通用户' : '设为管理员'}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void update(user, { disabled: !user.disabled })}>{user.disabled ? '重新启用' : '停用账户'}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setResetTarget(user)}>重置密码</DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      <CreateUserDrawer open={creating} onOpenChange={setCreating} onCreated={() => setRefresh((value) => value + 1)} />
      <ResetPasswordDrawer user={resetTarget} onOpenChange={(nextOpen) => { if (!nextOpen) setResetTarget(undefined); }} onReset={() => setRefresh((value) => value + 1)} />
    </div>
  );
}

/**
 * 渲染新建系统用户的表单抽屉。
 *
 * @param props - 受控开关和创建成功后的刷新回调。
 * @returns 新建用户表单。
 */
function CreateUserDrawer({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [role, setRole] = useState<User['role']>('user');
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setError(undefined);
    try {
      await createUserApi({
        username: String(form.get('username') ?? ''), displayName: String(form.get('displayName') ?? ''),
        password: String(form.get('password') ?? ''), role,
      });
      onOpenChange(false); onCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '用户创建失败');
    } finally { setPending(false); }
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <DrawerContent>
        <DrawerHeader><DrawerTitle>新建用户</DrawerTitle></DrawerHeader>
        <form className="px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]" onSubmit={submit}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="new-user-username">用户名</FieldLabel><Input id="new-user-username" name="username" minLength={3} maxLength={32} required /></Field>
            <Field><FieldLabel htmlFor="new-user-name">显示名称</FieldLabel><Input id="new-user-name" name="displayName" maxLength={40} /></Field>
            <Field><FieldLabel htmlFor="new-user-password">临时密码</FieldLabel><Input id="new-user-password" name="password" type="password" minLength={8} required /></Field>
            <Field>
              <FieldLabel>角色</FieldLabel>
              <Select value={role} onValueChange={(value) => setRole(value as User['role'])}><SelectTrigger className="w-full"><SelectValue>{role === 'admin' ? '管理员' : '普通用户'}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="user">普通用户</SelectItem><SelectItem value="admin">管理员</SelectItem></SelectGroup></SelectContent></Select>
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" size="lg" disabled={pending}>{pending && <LoaderCircle data-icon="inline-start" className="animate-spin" />}创建用户</Button>
          </FieldGroup>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * 渲染管理员为指定用户重置密码的表单抽屉。
 *
 * @param props - 目标用户、受控开关和重置成功后的刷新回调。
 * @returns 重置用户密码的表单。
 */
function ResetPasswordDrawer({ user, onOpenChange, onReset }: { user?: User; onOpenChange: (open: boolean) => void; onReset: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setPending(true); setError(undefined);
    try {
      await resetUserPassword(user.id, String(new FormData(event.currentTarget).get('password') ?? ''));
      onOpenChange(false); onReset();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '密码重置失败'); }
    finally { setPending(false); }
  };
  return (
    <Drawer open={Boolean(user)} onOpenChange={onOpenChange} swipeDirection="down">
      <DrawerContent>
        <DrawerHeader><DrawerTitle>重置{user ? `“${user.displayName}”` : ''}的密码</DrawerTitle></DrawerHeader>
        <form className="px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]" onSubmit={submit}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="reset-user-password">新临时密码</FieldLabel><Input id="reset-user-password" name="password" type="password" minLength={8} required /></Field>
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" size="lg" disabled={pending}>{pending && <LoaderCircle data-icon="inline-start" className="animate-spin" />}重置密码</Button>
          </FieldGroup>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * 渲染计划任务状态并提供立即执行操作。
 *
 * @param props - 任务列表、加载/错误状态和执行任务的回调。
 * @returns 计划任务列表或其空、加载状态。
 */
function ScheduledTaskList({ tasks, isLoading, error, onRunTask }: {
  tasks: ScheduledTask[];
  isLoading: boolean;
  error?: string;
  onRunTask: (task: ScheduledTask) => void;
}) {
  if (isLoading && tasks.length === 0) {
    return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />正在加载</div>;
  }

  return (
    <>
      {error && <p className="pb-3 text-sm text-destructive">{error}</p>}
      <ItemGroup className="gap-0">
        {tasks.map((task) => (
          <UnifiedListRow key={task.id} className="py-3" separated>
            <ItemContent>
              <ItemTitle className="text-base font-semibold">{task.name}</ItemTitle>
              <ItemDescription className="text-xs">{scheduledTaskDetail(task)}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="secondary" size="icon" aria-label={`立即执行${task.name}`} disabled={task.status === 'running'} onClick={() => onRunTask(task)}>
                      {task.status === 'running' ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
                    </Button>
                  }
                />
                <TooltipContent>{task.status === 'running' ? '正在执行' : '立即执行'}</TooltipContent>
              </Tooltip>
            </ItemActions>
          </UnifiedListRow>
        ))}
      </ItemGroup>
      {!isLoading && !error && tasks.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">暂无计划任务</p>}
    </>
  );
}

/**
 * 格式化计划任务最近一次执行的状态。
 *
 * @param task - 需要展示执行状态的计划任务。
 * @returns 面向用户的执行时间、耗时和失败状态文本。
 */
function scheduledTaskDetail(task: ScheduledTask): string {
  if (!task.lastRunAt || task.lastDurationMs === undefined) return task.status === 'running' ? '正在执行' : '尚未执行';
  const runAt = new Date(task.lastRunAt);
  const formattedRunAt = Number.isNaN(runAt.getTime())
    ? task.lastRunAt
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(runAt);
  const status = task.status === 'running' ? '正在执行 · ' : '';
  const result = task.lastSucceeded === false ? ' · 上次执行失败' : '';
  return `${status}上次执行：${formattedRunAt} · 耗时 ${formatDuration(task.lastDurationMs)}${result}`;
}

/**
 * 将毫秒耗时转换为适合任务列表的文案。
 *
 * @param milliseconds - 任务耗时。
 * @returns 毫秒、秒或分秒形式的文本。
 */
function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} 毫秒`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} 秒`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}
