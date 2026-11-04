// Wails rejects Go errors as strings; browser errors usually have a message.
export function errorMessage(error: unknown): string {
  const message = typeof error === 'string'
    ? error
    : error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '';
  return message.trim().slice(0, 800) || '未知错误，请检查服务商配置与网络连接。';
}
