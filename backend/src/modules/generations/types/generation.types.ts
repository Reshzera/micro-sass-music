import type { KieTaskState } from '../../../externals/kieClient/types/kie-task.types';

export interface GenerationTrack {
  id: string;
  title?: string;
  tags?: string;
  /** Seconds. */
  duration?: number;
  audioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  modelName?: string;
}

export interface GenerationAccepted {
  taskId: string;
}

export interface GenerationStatus {
  taskId: string;
  state: KieTaskState;
  tracks: GenerationTrack[];
  failReason: string | null;
  /** Seconds spent generating, once finished. */
  costTime: number | null;
  createdAt: number;
  completedAt: number | null;
}

/** Normalized form of one KIE webhook delivery. */
export interface GenerationCallbackEvent {
  taskId: string;
  /** `text` carries lyrics only, `first` one track, `complete` all of them. */
  stage: 'text' | 'first' | 'complete';
  ok: boolean;
  failReason: string | null;
  tracks: GenerationTrack[];
}
