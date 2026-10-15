import api from './client';

export async function downloadExcel(path: string, filename: string, params?: Record<string, any>) {
  const response = await api.get(path, {
    responseType: 'blob',
    params,
  });
  const url = URL.createObjectURL(new Blob([response.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
