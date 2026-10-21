import { Controller, Get, Post } from '@nestjs/common';
import { MetadataScanner } from '@nestjs/core';
import { findAccessProblems } from '../../../../src/common/auth/access-declaration.check';
import { Admin, Customer, Public, Staff } from '../../../../src/common/auth/access.decorators';

@Controller('declared')
class DeclaredController {
  @Public() @Get() list(): void {}
  @Customer() @Post() create(): void {}
  helper(): void {}
}

@Staff()
@Controller('on-class')
class ClassDeclaredController {
  @Get() list(): void {}
}

@Controller('broken')
class BrokenController {
  @Get('none') none(): void {}
  @Public() @Admin() @Get('twice') twice(): void {}
}

@Admin()
@Controller('both')
class BothController {
  @Staff() @Get() both(): void {}
}

describe('findAccessProblems', () => {
  const scanner = new MetadataScanner();

  it('accepts routes declared on the method or on the controller; ignores non-route methods', () => {
    expect(findAccessProblems([DeclaredController, ClassDeclaredController], scanner)).toEqual([]);
  });

  it('names each route with no declaration or more than one', () => {
    expect(findAccessProblems([BrokenController, BothController], scanner)).toEqual([
      'BrokenController.none: none',
      'BrokenController.twice: @admin, @public',
      'BothController.both: @staff, @admin',
    ]);
  });
});
