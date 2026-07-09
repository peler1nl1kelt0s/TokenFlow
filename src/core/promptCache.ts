export function injectAnthropicCache(requestBody: any): any {
  // Only apply to Anthropic model requests
  const model = requestBody.model || '';
  if (!model.includes('claude')) {
    return requestBody;
  }

  // Estimate total input size in characters
  const systemText = typeof requestBody.system === 'string' ? requestBody.system : JSON.stringify(requestBody.system || '');
  const messagesText = JSON.stringify(requestBody.messages || '');
  const totalLength = systemText.length + messagesText.length;

  // Anthropic prompt caching requires minimum 1024 tokens for Sonnet (~4000 characters)
  if (totalLength < 4000) {
    return requestBody;
  }

  // 1. Inject cache breakpoint on the system prompt if present and large
  if (requestBody.system) {
    if (typeof requestBody.system === 'string' && requestBody.system.length > 500) {
      requestBody.system = [
        {
          type: 'text',
          text: requestBody.system,
          cache_control: { type: 'ephemeral' }
        }
      ];
    } else if (Array.isArray(requestBody.system) && requestBody.system.length > 0) {
      const lastIndex = requestBody.system.length - 1;
      requestBody.system[lastIndex] = {
        ...requestBody.system[lastIndex],
        cache_control: { type: 'ephemeral' }
      };
    }
  }

  // 2. Inject cache breakpoints on the message history (max 4 allowed in total)
  if (Array.isArray(requestBody.messages) && requestBody.messages.length > 0) {
    const len = requestBody.messages.length;

    // Cache the most recent message to keep incremental turns cached
    if (len >= 1) {
      const msg = requestBody.messages[len - 1];
      if (typeof msg.content === 'string') {
        requestBody.messages[len - 1] = {
          role: msg.role,
          content: [
            {
              type: 'text',
              text: msg.content,
              cache_control: { type: 'ephemeral' }
            }
          ]
        };
      } else if (Array.isArray(msg.content) && msg.content.length > 0) {
        const lastContentIndex = msg.content.length - 1;
        msg.content[lastContentIndex] = {
          ...msg.content[lastContentIndex],
          cache_control: { type: 'ephemeral' }
        };
      }
    }

    // If history is long, set another breakpoint 4 turns back to keep the sliding window baseline cached
    if (len >= 5) {
      const msg = requestBody.messages[len - 5];
      if (typeof msg.content === 'string') {
        requestBody.messages[len - 5] = {
          role: msg.role,
          content: [
            {
              type: 'text',
              text: msg.content,
              cache_control: { type: 'ephemeral' }
            }
          ]
        };
      }
    }
  }

  return requestBody;
}
