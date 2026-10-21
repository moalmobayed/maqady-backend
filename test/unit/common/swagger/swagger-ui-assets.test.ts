import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { SWAGGER_UI_ASSETS } from '../../../../src/common/swagger/swagger.setup';

describe('SWAGGER_UI_ASSETS', () => {
  it('names every file the Swagger UI page loads, each present in swagger-ui-dist', () => {
    // The page links these (swagger-ui-init.js is generated): a traced deployment ships only them.
    expect(SWAGGER_UI_ASSETS.map((path) => basename(path)).sort()).toEqual([
      'favicon-16x16.png',
      'favicon-32x32.png',
      'swagger-ui-bundle.js',
      'swagger-ui-standalone-preset.js',
      'swagger-ui.css',
    ]);
    for (const path of SWAGGER_UI_ASSETS)
      expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
  });
});
