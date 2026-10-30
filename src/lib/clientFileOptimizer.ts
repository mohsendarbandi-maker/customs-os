export type FileOptimizationResult = {
  file: File;
  originalBytes: number;
  optimizedBytes: number;
  savedPercent: number;
  optimized: boolean;
  method: 'png-lossless' | 'pdf-structure' | 'none';
};

type WorkerResponse = {
  id: string;
  blob?: Blob;
  method?: 'png-lossless' | 'pdf-structure';
  reason?: string;
  error?: string;
};

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<string, { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }>();

const getWorker = () => {
  if (worker) return worker;
  const instance = new Worker(new URL('../workers/fileOptimizer.worker.ts', import.meta.url), { type: 'module' });
  instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const result = event.data;
    const pending = waiting.get(result.id);
    if (!pending) return;
    waiting.delete(result.id);
    pending.resolve(result);
  };
  instance.onerror = () => {
    for (const pending of waiting.values()) pending.reject(new Error('File optimization worker failed.'));
    waiting.clear();
    instance.terminate();
    if (worker === instance) worker = null;
  };
  worker = instance;
  return instance;
};

const processInWorker = (file: File): Promise<WorkerResponse> => new Promise((resolve, reject) => {
  const id = 'file-opt-' + (++nextId);
  waiting.set(id, { resolve, reject });
  try {
    getWorker().postMessage({ id, file });
  } catch (error) {
    waiting.delete(id);
    reject(error instanceof Error ? error : new Error('Unable to start file optimization.'));
  }
});

export async function optimizeFileForUpload(file: File): Promise<FileOptimizationResult> {
  const unchanged: FileOptimizationResult = {
    file,
    originalBytes: file.size,
    optimizedBytes: file.size,
    savedPercent: 0,
    optimized: false,
    method: 'none',
  };

  // Avoid wasting CPU on tiny files, formats already compressed by design, and
  // very large files that are better sent through resumable multipart upload.
  if (file.size < 180 * 1024 || file.size > 40 * 1024 * 1024) return unchanged;
  const type = (file.type || '').toLowerCase();
  if (type !== 'application/pdf' && type !== 'image/png') return unchanged;

  try {
    const result = await processInWorker(file);
    if (!result.blob || !result.method || result.blob.size >= file.size * 0.985) return unchanged;
    const optimized = new File([result.blob], file.name, {
      type: result.blob.type || file.type,
      lastModified: file.lastModified,
    });
    return {
      file: optimized,
      originalBytes: file.size,
      optimizedBytes: optimized.size,
      savedPercent: Math.max(0, Math.round((1 - optimized.size / file.size) * 100)),
      optimized: true,
      method: result.method,
    };
  } catch {
    // The original file is always a safe fallback; an optimization failure must
    // never block an ordinary upload.
    return unchanged;
  }
}
