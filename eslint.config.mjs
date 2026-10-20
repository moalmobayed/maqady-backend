// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// CLAUDE.md "Anti-patterns": repositories name their columns, so `SELECT *` never appears.
const noSelectStar = [
  {
    selector: 'Literal[value=/\\bselect\\s+\\*/i]',
    message: 'Name the columns explicitly; SELECT * is forbidden (CLAUDE.md).',
  },
  {
    selector: 'TemplateElement[value.raw=/\\bselect\\s+\\*/i]',
    message: 'Name the columns explicitly; SELECT * is forbidden (CLAUDE.md).',
  },
  {
    selector: "CallExpression[callee.property.name=/^(select|returning)$/] > Literal[value='*']",
    message: 'Name the columns explicitly; select("*") is forbidden (CLAUDE.md).',
  },
];

// CLAUDE.md "Inline types are forbidden": types live in the module's types.ts.
const noInlineTypes = [
  {
    selector: 'TSInterfaceDeclaration',
    message: "Declare interfaces in the module's types.ts (CLAUDE.md: inline types are forbidden).",
  },
  {
    selector: 'TSTypeAliasDeclaration',
    message: "Declare types in the module's types.ts (CLAUDE.md: inline types are forbidden).",
  },
];

// CLAUDE.md "Database": Knex is reached only through the shared provider, by repositories.
const knexOnlyInRepositories = {
  paths: [
    {
      name: 'knex',
      message: 'Only repositories, common/database and migrations use Knex (CLAUDE.md).',
    },
  ],
  patterns: [
    {
      group: ['**/common/database', '**/common/database/*'],
      importNames: ['KNEX'],
      message: 'Only repositories inject Knex (CLAUDE.md).',
    },
  ],
};

// CLAUDE.md "Errors": services throw AppError, never Nest's HttpException family.
const nestHttpExceptions = [
  'HttpException',
  'BadRequestException',
  'UnauthorizedException',
  'ForbiddenException',
  'NotFoundException',
  'ConflictException',
  'GoneException',
  'PayloadTooLargeException',
  'UnprocessableEntityException',
  'InternalServerErrorException',
  'ServiceUnavailableException',
  'NotAcceptableException',
  'RequestTimeoutException',
  'MethodNotAllowedException',
  'UnsupportedMediaTypeException',
  'NotImplementedException',
  'BadGatewayException',
  'GatewayTimeoutException',
  'PreconditionFailedException',
  'ImATeapotException',
  'HttpVersionNotSupportedException',
  'MisdirectedException',
];
const noHttpExceptions = {
  name: '@nestjs/common',
  importNames: nestHttpExceptions,
  message: 'Throw AppError from src/common/errors instead (CLAUDE.md).',
};

const layerFiles = 'src/**/*.{service,controller,repository,gateway,guard,interceptor,filter}.ts';

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'contracts/'] },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noSelectStar],
      'no-restricted-imports': ['error', knexOnlyInRepositories],
    },
  },
  {
    files: [layerFiles],
    rules: {
      'no-restricted-syntax': ['error', ...noSelectStar, ...noInlineTypes],
    },
  },
  {
    files: ['src/**/*.{service,controller,gateway}.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...knexOnlyInRepositories.paths, noHttpExceptions],
          patterns: knexOnlyInRepositories.patterns,
        },
      ],
    },
  },
  {
    files: ['src/**/*.repository.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [noHttpExceptions] }],
    },
  },
  {
    files: ['src/common/database/**/*.ts', 'src/migrations/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // Process entry points report boot failures before the logger exists.
    files: ['src/main.ts', 'src/cli/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      // supertest bodies are untyped, and expect(mock.method) is the Jest idiom.
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  prettier,
);
