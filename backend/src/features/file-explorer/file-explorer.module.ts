import { Module } from '@nestjs/common';
import { FileExplorerController } from './file-explorer.controller';
import { FileExplorerService } from './file-explorer.service';

/**
 * Story: File Explorer — folders, files, versions and presigned downloads.
 * JwtAuthGuard is a global APP_GUARD (401); project membership (403) is
 * enforced in FileExplorerService. MinioService comes from the global
 * IntegrationsModule.
 */
@Module({
  controllers: [FileExplorerController],
  providers: [FileExplorerService],
})
export class FileExplorerModule {}
