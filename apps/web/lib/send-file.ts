import { digitalFileType } from '@curios/core/digital';
import { API_BASE, ApiError } from './api.js';

/**
 * Sends one file as the raw body of a POST, the way the store's file route takes it, and
 * says how far along it is. fetch cannot report upload progress, so this is XMLHttpRequest.
 * `headers` go out as given. Failures come back as the same ApiError apiFetch throws, with the API's own words.
 */
export function sendFile<T>(path: string, file: File | Blob, onProgress: (done: number) => void, headers: Record<string, string> = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_BASE}${path}`);
    request.withCredentials = true;
    // Windows says a ZIP is application/x-zip-compressed, and some files have no type: send what the API stores.
    // A picture's Blob has no name: its own type is what the API reads, and the headers say the rest.
    if (file instanceof File) {
      request.setRequestHeader('content-type', digitalFileType(file.name, file.type) ?? file.type);
      request.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    } else {
      request.setRequestHeader('content-type', file.type);
    }
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onerror = () => reject(new ApiError(0, 'NETWORK', 'The upload was cut off. Check your connection and try again.'));
    request.onabort = () => reject(new ApiError(0, 'NETWORK', 'The upload was stopped.'));
    request.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = null;
      }
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve(body as T);
        return;
      }
      const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
      reject(new ApiError(request.status, error?.code ?? 'INTERNAL_ERROR', error?.message ?? 'Something failed. Try again.', body));
    };
    request.send(file);
  });
}
