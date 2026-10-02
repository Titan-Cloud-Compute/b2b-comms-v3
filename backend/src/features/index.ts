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
import { AuthenticationAndRolesModule } from './authentication-and-roles/authentication-and-roles.module';
import { ProjectsAndExternalOrganizationSpacesModule } from './projects-and-external-organization-spaces/projects-and-external-organization-spaces.module';
import { FileExplorerModule } from './file-explorer/file-explorer.module';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const FEATURE_MODULES: any[] = [
  AuthenticationAndRolesModule,
  ProjectsAndExternalOrganizationSpacesModule,
  FileExplorerModule,
];
