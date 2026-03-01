import type { SSEEvent } from '../types';

export async function* parseSSE(response: Response): AsyncGenerator<SSEEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = 'message';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6));
          yield { event: eventType, data: parsed };
        } catch (e) {
          console.error('SSE JSON parse error for event:', eventType, 'line length:', line.length, 'error:', e);
        }
        eventType = 'message';
      }
    }
  }
}
