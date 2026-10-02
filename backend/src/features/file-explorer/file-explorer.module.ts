import { Module } from '@nestjs/common';
import { FileExplorerService } from './file-explorer.service';
import { FilesController, FoldersController, ProjectFilesController } from './file-explorer.controller';

@Module({
  controllers: [ProjectFilesController, FilesController, FoldersController],
  providers: [FileExplorerService],
  exports: [FileExplorerService],
})
export class FileExplorerModule {}
