export type KieTaskState =
  'waiting' | 'queuing' | 'generating' | 'success' | 'fail';

/** Payload of `GET /api/v1/jobs/recordInfo`. */
export interface KieTaskRecord<TResponse = unknown> {
  taskId: string;
  model: string;
  state: KieTaskState;
  /** JSON string echoing the request that created the task. */
  param: string;
  /** JSON string holding the model output; shape varies per model. */
  resultJson: string;
  /** Parsed model output, when KIE inlines it. */
  response: TResponse;
  failCode: string | null;
  failMsg: string | null;
  /** Seconds spent generating. */
  costTime: number | null;
  /** Unix epoch milliseconds. */
  completeTime: number | null;
  createTime: number;
  creditsConsumed: number | null;
}
