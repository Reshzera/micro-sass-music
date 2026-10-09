/** Every KIE endpoint answers with this envelope, even on failure. */
export interface KieEnvelope<TData> {
  code: number;
  msg?: string;
  data: TData;
}

export interface KieCreateTaskData {
  taskId: string;
}
