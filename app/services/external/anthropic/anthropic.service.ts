import Logger from 'bunyan';
import Anthropic from '@anthropic-ai/sdk';
import { envVariables } from '@shared/config';
import { createLogger, containsPII, redactPII } from '@utils/index';

export interface AnthropicMessageResult {
  outputTokens: number;
  inputTokens: number;
  content: string;
  model: string;
}

export interface AnthropicMessageOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export type AnthropicContentBlock = Anthropic.Messages.ContentBlockParam;

export class AnthropicService {
  private readonly log: Logger;
  private readonly client: Anthropic;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;

  constructor() {
    this.log = createLogger('AnthropicService');

    if (!envVariables.ANTHROPIC.API_KEY) {
      this.log.warn('ANTHROPIC_API_KEY is not set — AI features will be unavailable');
    }

    this.client = new Anthropic({
      apiKey: envVariables.ANTHROPIC.API_KEY || 'missing',
    });
    this.defaultModel = envVariables.ANTHROPIC.MODEL;
    this.defaultMaxTokens = envVariables.ANTHROPIC.MAX_TOKENS;
  }

  async createMessage(
    systemPrompt: string,
    userContent: string,
    opts?: AnthropicMessageOptions
  ): Promise<AnthropicMessageResult> {
    // Safety net: redact PII from all input regardless of what the caller sent
    const safeSystem = redactPII(systemPrompt);
    const safeUser = redactPII(userContent);

    if (containsPII(userContent)) {
      this.log.warn('PII patterns detected in AI input — redacted before sending');
    }

    const model = opts?.model ?? this.defaultModel;
    const maxTokens = opts?.maxTokens ?? this.defaultMaxTokens;

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: opts?.temperature ?? 0.3,
      system: safeSystem,
      messages: [{ role: 'user', content: safeUser }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const content = textBlock?.type === 'text' ? textBlock.text : '';

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
    };
  }

  /**
   * Send a vision/document message (image or PDF content blocks) to Claude.
   *
   * WARNING: Binary content (images, PDFs) cannot be text-redacted before transmission.
   * Only call this method with explicit user consent and after verifying your data-processing
   * obligations (DPA, GDPR, etc.). The caller is responsible for ensuring the document
   * does not contain PII that must not leave the application boundary.
   *
   * The system prompt is still redacted before sending.
   */
  async createVisionMessage(
    systemPrompt: string,
    contentBlocks: AnthropicContentBlock[],
    opts?: AnthropicMessageOptions
  ): Promise<AnthropicMessageResult> {
    const safeSystem = redactPII(systemPrompt);

    if (containsPII(systemPrompt)) {
      this.log.warn('PII patterns detected in AI vision system prompt — redacted before sending');
    }

    // Binary content blocks (images/PDFs) are transmitted as-is to Anthropic.
    // Callers must ensure this is permissible under the applicable data-handling policy.
    this.log.warn(
      { contentBlockCount: contentBlocks.length },
      'Sending binary content to Anthropic vision API — caller asserts consent and data-handling compliance'
    );

    const model = opts?.model ?? this.defaultModel;
    const maxTokens = opts?.maxTokens ?? this.defaultMaxTokens;

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: opts?.temperature ?? 0.1,
      system: safeSystem,
      messages: [{ role: 'user', content: contentBlocks as any }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const content = textBlock?.type === 'text' ? textBlock.text : '';

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
    };
  }
}
