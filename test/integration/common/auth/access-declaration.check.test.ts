import { Controller, Get, Module, Post } from '@nestjs/common';
import { Admin, Public } from '../../../../src/common/auth/access.decorators';
import { createTestApp } from '../../../support/test-app';

@Controller('test-undeclared')
class UndeclaredController {
  @Public()
  @Get('fine')
  fine(): string {
    return 'ok';
  }

  @Post('forgotten')
  forgotten(): string {
    return 'open?';
  }
}

@Module({ controllers: [UndeclaredController] })
class UndeclaredModule {}

@Public()
@Controller('test-doubly-declared')
class DoublyDeclaredController {
  @Admin()
  @Get()
  both(): string {
    return 'which?';
  }
}

@Module({ controllers: [DoublyDeclaredController] })
class DoublyDeclaredModule {}

describe('Boot-time access check (integration)', () => {
  it('refuses to start when a route declares no access, naming it', async () => {
    await expect(createTestApp({ resetData: false, imports: [UndeclaredModule] })).rejects.toThrow(
      /exactly one of @Public, @Guest, @Customer, @Staff or @Admin:\n- UndeclaredController\.forgotten: none$/,
    );
  });

  it('refuses to start when a route declares access twice, on the method and its controller', async () => {
    await expect(
      createTestApp({ resetData: false, imports: [DoublyDeclaredModule] }),
    ).rejects.toThrow('- DoublyDeclaredController.both: @admin, @public');
  });

  it('starts when every route declares exactly one access level', async () => {
    const testApp = await createTestApp({ resetData: false });
    try {
      expect((await testApp.http().get('/api/v1/health')).status).toBe(200);
    } finally {
      await testApp.close();
    }
  });
});
