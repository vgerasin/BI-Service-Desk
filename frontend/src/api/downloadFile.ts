import api from './client';

export async function downloadFile(path: string, filename: string, mimeType: string, params?: Record<string, any>) {
  const response = await api.get(path, {
    responseType: 'blob',
    params,
  });
  const url = URL.createObjectURL(new Blob([response.data], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
