import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { MESSAGE_CHANNELS } from './enums';
import { TEMPLATE_NAME_PATTERN } from './messaging.constants';
import type { MessageTemplate, RegisteredTemplate, TemplateParams } from './types';

/**
 * Every message template the app can send, by name. The module that owns a trigger defines its
 * templates and registers them in its `onModuleInit()`, so `messaging` depends on no feature
 * module (design §5, §13.1). The drain looks templates up by the name stored on each message.
 */
@Injectable()
export class MessageTemplateRegistry {
  private readonly templates = new Map<string, RegisteredTemplate>();

  /** Registers a template at boot; a malformed or duplicate name is a programming error. */
  register<P extends TemplateParams<P>>(template: MessageTemplate<P>): void {
    if (!TEMPLATE_NAME_PATTERN.test(template.name) || template.name.length > 64) {
      throw new AppError(
        'INTERNAL',
        `Message template name "${template.name}" must be <owner>.<event> in lower case.`,
      );
    }
    if (!(MESSAGE_CHANNELS as readonly string[]).includes(template.channel)) {
      throw new AppError('INTERNAL', `Message template "${template.name}" has no valid channel.`);
    }
    if (this.templates.has(template.name)) {
      throw new AppError('INTERNAL', `Message template "${template.name}" is registered twice.`);
    }
    // The parameters' type is checked where the template is queued; stored payloads are parsed
    // back into the same shape before `render` sees them.
    this.templates.set(template.name, template as unknown as RegisteredTemplate);
  }

  get(name: string): RegisteredTemplate | undefined {
    return this.templates.get(name);
  }

  /** True when `template` is the very object registered under its name. */
  isRegistered<P extends TemplateParams<P>>(template: MessageTemplate<P>): boolean {
    return this.templates.get(template.name) === (template as unknown as RegisteredTemplate);
  }

  names(): string[] {
    return [...this.templates.keys()].sort();
  }
}
