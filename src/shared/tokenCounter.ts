import Anthropic from '@anthropic-ai/sdk';

/**
 * Token counting utilities for managing Anthropic API token limits
 */

// Claude Sonnet 4.5 has a 200k token context window
export const MAX_CONTEXT_TOKENS = 200000;
// Reserve tokens for the response (4000 max_tokens in API call)
export const RESERVED_OUTPUT_TOKENS = 4000;
// Reserve tokens for system prompt and overhead
export const RESERVED_SYSTEM_TOKENS = 5000;
// Effective max tokens we can use for input
export const MAX_INPUT_TOKENS = MAX_CONTEXT_TOKENS - RESERVED_OUTPUT_TOKENS - RESERVED_SYSTEM_TOKENS;

export interface TokenCountResult {
  totalTokens: number;
  withinLimit: boolean;
  maxTokens: number;
  percentUsed: number;
}

/**
 * Count tokens in a text string using approximation
 * Claude's tokenizer averages ~4 characters per token for English text
 * This is a conservative estimate that works in browser environments
 */
export function countTextTokens(text: string): number {
  // Approximate: 1 token ≈ 4 characters for English text
  // We use 3.5 to be slightly conservative
  return Math.ceil(text.length / 3.5);
}

/**
 * Count tokens in Anthropic message parameters
 */
export function countMessageTokens(messages: Anthropic.MessageParam[], systemPrompt?: string): TokenCountResult {
  let totalTokens = 0;

  // Count system prompt tokens
  if (systemPrompt) {
    totalTokens += countTextTokens(systemPrompt);
  }

  // Count message tokens
  for (const message of messages) {
    if (typeof message.content === 'string') {
      totalTokens += countTextTokens(message.content);
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text') {
          totalTokens += countTextTokens(block.text);
        } else if (block.type === 'image') {
          // Approximate token count for images
          // Base64 images are roughly 1.4x the original size
          // Claude counts ~1 token per 750 bytes for images
          // This is a rough estimate
          if ('source' in block && block.source.type === 'base64') {
            const base64Length = block.source.data.length;
            const estimatedBytes = (base64Length * 3) / 4; // Convert base64 to bytes
            const imageTokens = Math.ceil(estimatedBytes / 750);
            totalTokens += imageTokens;
          }
        } else if (block.type === 'tool_use') {
          // Count tool use tokens
          totalTokens += countTextTokens(JSON.stringify(block));
        } else if (block.type === 'tool_result') {
          // Count tool result tokens
          totalTokens += countTextTokens(block.content as string);
        }
      }
    }
  }

  const withinLimit = totalTokens <= MAX_INPUT_TOKENS;
  const percentUsed = (totalTokens / MAX_INPUT_TOKENS) * 100;

  return {
    totalTokens,
    withinLimit,
    maxTokens: MAX_INPUT_TOKENS,
    percentUsed
  };
}

/**
 * Truncate text to fit within a token limit
 */
export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const currentTokens = countTextTokens(text);
  
  if (currentTokens <= maxTokens) {
    return text;
  }

  // Approximate character limit based on token limit
  // Using 3.5 chars per token
  const maxChars = Math.floor(maxTokens * 3.5);
  
  if (text.length <= maxChars) {
    return text;
  }

  return text.substring(0, maxChars) + '\n<!-- ... content truncated to fit token limit ... -->';
}

/**
 * Estimate tokens for a DOM snapshot
 */
export function estimateDOMSnapshotTokens(snapshot: any): number {
  // Convert the snapshot to a string representation
  const snapshotString = JSON.stringify(snapshot);
  return countTextTokens(snapshotString);
}

/**
 * Log token usage information
 */
export function logTokenUsage(result: TokenCountResult, context: string): void {
  console.log(`[Token Counter] ${context}:`);
  console.log(`  Total tokens: ${result.totalTokens.toLocaleString()}`);
  console.log(`  Max allowed: ${result.maxTokens.toLocaleString()}`);
  console.log(`  Usage: ${result.percentUsed.toFixed(1)}%`);
  console.log(`  Within limit: ${result.withinLimit ? '✓' : '✗'}`);
  
  if (!result.withinLimit) {
    const excess = result.totalTokens - result.maxTokens;
    console.warn(`  ⚠️ EXCEEDS LIMIT BY ${excess.toLocaleString()} tokens!`);
  }
}
