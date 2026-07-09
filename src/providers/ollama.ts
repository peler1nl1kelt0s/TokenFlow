import { ProviderRequest } from './types.js';

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(500)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export class OllamaProvider {
  private ollamaUrl: string;
  private defaultModel: string;

  constructor(ollamaUrl: string = 'http://localhost:11434', defaultModel: string = 'llama3') {
    this.ollamaUrl = ollamaUrl;
    this.defaultModel = defaultModel;
  }

  private translateMessages(requestBody: ProviderRequest) {
    const messages = [];

    // Prepend system prompt if exists
    if (requestBody.system) {
      if (typeof requestBody.system === 'string') {
        messages.push({ role: 'system', content: requestBody.system });
      } else if (Array.isArray(requestBody.system)) {
        const text = requestBody.system.map((s: any) => s.text || '').join('\n');
        messages.push({ role: 'system', content: text });
      }
    }

    // Append history messages
    if (Array.isArray(requestBody.messages)) {
      for (const msg of requestBody.messages) {
        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = msg.content.map((c: any) => c.text || '').join('\n');
        }
        messages.push({ role: msg.role, content });
      }
    }

    return messages;
  }

  public async execute(
    requestBody: ProviderRequest,
    format: 'openai' | 'anthropic',
    signal?: AbortSignal
  ): Promise<Response> {
    const messages = this.translateMessages(requestBody);
    const model = requestBody.model && !requestBody.model.includes('claude') && !requestBody.model.includes('gpt')
      ? requestBody.model
      : this.defaultModel;

    const ollamaRequest = {
      model,
      messages,
      stream: requestBody.stream ?? true,
    };

    const res = await fetch(`${this.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ollamaRequest),
      signal
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Ollama error: ${res.status} - ${errorText}`);
    }

    if (!ollamaRequest.stream) {
      // Non-streaming response translation
      const data = await res.json();
      const assistantText = data.message?.content || '';

      if (format === 'openai') {
        const translated = {
          id: `chatcmpl-ollama-${Math.random().toString(36).substring(7)}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: assistantText },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
            completion_tokens: Math.ceil(assistantText.length / 4),
            total_tokens: Math.ceil((JSON.stringify(messages).length + assistantText.length) / 4)
          }
        };
        return new Response(JSON.stringify(translated), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        const translated = {
          id: `msg_ollama_${Math.random().toString(36).substring(7)}`,
          type: 'message',
          role: 'assistant',
          model,
          content: [{ type: 'text', text: assistantText }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
            output_tokens: Math.ceil(assistantText.length / 4)
          }
        };
        return new Response(JSON.stringify(translated), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Streaming Response Translation via ReadableStream
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              const parsed = JSON.parse(line);
              const deltaText = parsed.message?.content || '';

              if (format === 'openai') {
                const chunk = `data: ${JSON.stringify({
                  choices: [{ index: 0, delta: { content: deltaText }, finish_reason: parsed.done ? 'stop' : null }]
                })}\n\n`;
                controller.enqueue(encoder.encode(chunk));
              } else {
                // Anthropic message SSE protocol
                if (parsed.message?.role === 'assistant' && deltaText) {
                  const chunk = `event: content_block_delta\ndata: ${JSON.stringify({
                    index: 0,
                    delta: { type: 'text_delta', text: deltaText }
                  })}\n\n`;
                  controller.enqueue(encoder.encode(chunk));
                }
              }
            }
          }

          if (format === 'openai') {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } else {
            const finishChunk = `event: message_delta\ndata: ${JSON.stringify({
              delta: { stop_reason: 'end_turn' }
            })}\n\nevent: message_stop\ndata: {}\n\n`;
            controller.enqueue(encoder.encode(finishChunk));
          }
          controller.close();
        } catch (err: any) {
          controller.error(err);
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });
  }
}
