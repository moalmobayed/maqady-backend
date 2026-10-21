import { Injectable, type OnApplicationBootstrap, type Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { accessDeclarationsOf } from './access-metadata';
import type { AccessLevel } from './types';

/**
 * The boot-time route check (design §10.3): the app refuses to start when any HTTP route has no
 * access declaration, or more than one (counting the method and its controller together). A
 * missing declaration can then never quietly mean "open".
 */
@Injectable()
export class AccessDeclarationCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  onApplicationBootstrap(): void {
    const controllers = this.discovery
      .getControllers()
      .map((wrapper) => wrapper.metatype)
      .filter((metatype): metatype is Type<unknown> => typeof metatype === 'function');
    const problems = findAccessProblems(controllers, this.scanner);
    if (problems.length > 0) {
      throw new Error(
        `Every route must declare exactly one of @Public, @Guest, @Customer, @Staff or @Admin:\n${problems
          .map((problem) => `- ${problem}`)
          .join('\n')}`,
      );
    }
  }
}

/** One line per route whose declarations are not exactly one, such as `HomeController.getHome: none`. */
export function findAccessProblems(
  controllers: readonly Type<unknown>[],
  scanner: MetadataScanner,
): string[] {
  const problems: string[] = [];
  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    const onClass = accessDeclarationsOf(controller);
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name];
      if (typeof handler !== 'function' || !Reflect.hasMetadata(PATH_METADATA, handler)) continue;
      const declared: readonly AccessLevel[] = [...accessDeclarationsOf(handler), ...onClass];
      if (declared.length !== 1) {
        const found =
          declared.length === 0 ? 'none' : declared.map((level) => `@${level}`).join(', ');
        problems.push(`${controller.name}.${name}: ${found}`);
      }
    }
  }
  return problems;
}
