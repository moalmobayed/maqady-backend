import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { API_PREFIX } from '../../src/app.constants';
import { accessDeclarationsOf } from '../../src/common/auth/access-metadata';
import type { HttpRoute, TestApp } from './types';

/**
 * Every HTTP route the app serves, read from the Nest router's metadata, with its declared access.
 * Suites that must cover "every Admin route" enumerate this list, so a route added later is
 * covered without editing the test.
 */
export function listHttpRoutes(testApp: TestApp): HttpRoute[] {
  const discovery = testApp.app.get(DiscoveryService);
  const scanner = testApp.app.get(MetadataScanner);
  const routes: HttpRoute[] = [];
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as Type<unknown> | null;
    if (typeof controller !== 'function') continue;
    const prototype = controller.prototype as Record<string, unknown>;
    const onClass = accessDeclarationsOf(controller);
    for (const controllerPath of pathsOf(controller)) {
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function' || !Reflect.hasMetadata(PATH_METADATA, handler)) {
          continue;
        }
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const access = [...accessDeclarationsOf(handler), ...onClass][0];
        for (const handlerPath of pathsOf(handler)) {
          routes.push({
            method: method ?? 'UNKNOWN',
            path: joinPath(API_PREFIX, controllerPath, handlerPath),
            access,
            handler: `${controller.name}.${name}`,
          });
        }
      }
    }
  }
  return routes;
}

/** A concrete path for a route: every `:param` becomes `1`. */
export function samplePath(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, '1');
}

function pathsOf(target: object): string[] {
  const value = Reflect.getMetadata(PATH_METADATA, target) as string | string[] | undefined;
  if (value === undefined) return [''];
  return Array.isArray(value) ? value : [value];
}

function joinPath(...parts: string[]): string {
  const segments = parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '');
  return `/${segments.join('/')}`;
}
