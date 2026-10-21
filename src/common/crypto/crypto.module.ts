import { Global, Module } from '@nestjs/common';
import { DataEncryptionService } from './data-encryption.service';

/** Encryption at rest (design §14.1). The hashing helpers are plain functions in `hashing.ts`. */
@Global()
@Module({
  providers: [DataEncryptionService],
  exports: [DataEncryptionService],
})
export class CryptoModule {}
