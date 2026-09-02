import {
  createPlaybackSession,
  deletePlaybackSession,
  recordPlaybackEvent,
  type PlaybackSession,
  type Track,
} from '@/api/rime';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type PlayerSnapshot = {
  track?: Track;
  status: PlayerStatus;
  positionMs: number;
  durationMs: number;
  error?: string;
};

type Listener = () => void;

export class HtmlAudioPlayer {
  private readonly audio = new Audio();
  private readonly listeners = new Set<Listener>();
  private readonly playerId = getPlayerId();
  private snapshot: PlayerSnapshot = { status: 'idle', positionMs: 0, durationMs: 0 };
  private session?: PlaybackSession;
  private loadGeneration = 0;
  private lastProgressEventAt = 0;

  constructor() {
    this.audio.preload = 'metadata';
    this.audio.addEventListener('playing', this.handlePlaying);
    this.audio.addEventListener('pause', this.handlePause);
    this.audio.addEventListener('ended', this.handleEnded);
    this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
    this.audio.addEventListener('durationchange', this.handleDurationChange);
    this.audio.addEventListener('error', this.handleError);
  }

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async load(track: Track): Promise<void> {
    const generation = ++this.loadGeneration;
    this.publish({ track, status: 'loading', positionMs: 0, durationMs: track.durationMs, error: undefined });
    try {
      const nextSession = await createPlaybackSession(track.id, this.playerId);
      if (generation !== this.loadGeneration) {
        void deletePlaybackSession(nextSession.sessionId);
        return;
      }
      const previousSession = this.session;
      this.audio.pause();
      this.session = nextSession;
      this.audio.src = nextSession.source.href;
      this.audio.load();
      if (previousSession) {
        void deletePlaybackSession(previousSession.sessionId);
      }
      await this.audio.play();
    } catch (error) {
      if (generation === this.loadGeneration) {
        this.publish({ status: 'error', error: messageFrom(error) });
      }
      throw error;
    }
  }

  async toggle(): Promise<void> {
    if (!this.session) return;
    if (this.audio.paused) {
      try {
        await this.audio.play();
      } catch (error) {
        this.publish({ status: 'error', error: messageFrom(error) });
      }
    } else {
      this.audio.pause();
    }
  }

  seek(positionMs: number): void {
    if (!this.session || !Number.isFinite(positionMs)) return;
    this.audio.currentTime = Math.max(0, positionMs) / 1000;
    this.publish({ positionMs: this.audio.currentTime * 1000 });
  }

  dispose(): void {
    this.loadGeneration++;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.session) {
      void deletePlaybackSession(this.session.sessionId);
    }
    this.session = undefined;
    this.listeners.clear();
  }

  private publish(update: Partial<PlayerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach((listener) => listener());
  }

  private report(type: 'started' | 'progress' | 'paused' | 'ended'): void {
    if (!this.session) return;
    void recordPlaybackEvent(this.session.sessionId, type, this.audio.currentTime * 1000);
  }

  private handlePlaying = (): void => {
    this.publish({ status: 'playing', error: undefined });
    this.report('started');
  };

  private handlePause = (): void => {
    if (!this.audio.ended && this.session) {
      this.publish({ status: 'paused' });
      this.report('paused');
    }
  };

  private handleEnded = (): void => {
    this.publish({ status: 'paused', positionMs: this.snapshot.durationMs });
    this.report('ended');
  };

  private handleTimeUpdate = (): void => {
    const now = Date.now();
    this.publish({ positionMs: this.audio.currentTime * 1000 });
    if (now - this.lastProgressEventAt >= 15_000) {
      this.lastProgressEventAt = now;
      this.report('progress');
    }
  };

  private handleDurationChange = (): void => {
    if (Number.isFinite(this.audio.duration)) {
      this.publish({ durationMs: this.audio.duration * 1000 });
    }
  };

  private handleError = (): void => {
    this.publish({ status: 'error', error: '音频加载失败' });
  };
}

function getPlayerId(): string {
  const key = 'rime.playerId';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const playerId = `web-${crypto.randomUUID()}`;
    localStorage.setItem(key, playerId);
    return playerId;
  } catch {
    return `web-${crypto.randomUUID()}`;
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : '播放失败';
}
