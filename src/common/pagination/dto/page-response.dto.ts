import { type Type as ClassType } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import type { Page } from '../types';

const pageClasses = new Map<ClassType<unknown>, ClassType<Page<unknown>>>();

/**
 * The response DTO of a list: `{ items, nextCursor, total }` with `items` typed as `Item`. The
 * class is named `<Item>Page` (for example `BookingSummaryPage`), which becomes its OpenAPI
 * schema name, and is created once per item class.
 *
 * @example @ApiOkResponse({ type: PageResponseOf(BookingSummary) })
 */
export function PageResponseOf<Item>(item: ClassType<Item>): ClassType<Page<Item>> {
  const existing = pageClasses.get(item);
  if (existing) return existing as ClassType<Page<Item>>;

  class PageResponse implements Page<Item> {
    @ApiProperty({
      type: () => item,
      isArray: true,
      nullable: false,
      description: 'This page, in list order. Empty when nothing matches.',
    })
    items!: Item[];

    @ApiProperty({
      type: String,
      nullable: true,
      example: 'WyIyMDI2LTEwLTE2VDE5OjMwOjAwKzAzOjAwIiw0Ml0',
      description: 'Pass as `cursor` to get the next page; null on the last page.',
    })
    nextCursor!: string | null;

    @ApiProperty({
      type: 'integer',
      minimum: 0,
      nullable: false,
      example: 42,
      description: 'How many items the whole list has, with the same filters.',
    })
    total!: number;
  }
  Object.defineProperty(PageResponse, 'name', { value: `${item.name}Page` });
  pageClasses.set(item, PageResponse);
  return PageResponse;
}
