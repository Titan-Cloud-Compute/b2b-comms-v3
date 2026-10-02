import { FileExplorerModule } from './file-explorer/file-explorer.module';

/**
 * Feature module registry.
 *
 * Each story appends its NestJS module to this array.
 * AppModule spreads FEATURE_MODULES so new features are picked up automatically.
 *
 * Example (in features/my-feature/my-feature.module.ts):
 *
 *   import { FEATURE_MODULES } from '../index';
 *   FEATURE_MODULES.push(MyFeatureModule);
 *
 * Or simply add it here directly.
 */
import { ProjectsModule } from './projects/projects.module';
import { GeneralChannelsModule } from './general-channels/general-channels.module';
import { MessageReferencesModule } from './message-references/message-references.module';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const FEATURE_MODULES: any[] = [ProjectsModule, FileExplorerModule, GeneralChannelsModule, MessageReferencesModule];
