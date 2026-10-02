import { Routes } from '@angular/router';

export const MESSAGE_REFERENCES_ROUTES: Routes = [
  {
    // Reference editor — placeholder replaced by the next unit.
    path: 'projects/:id/references/new',
    loadComponent: () =>
      import('./reference-editor-placeholder.component').then(
        m => m.ReferenceEditorPlaceholderComponent,
      ),
    data: { nav: false },
  },
  {
    // Reference viewer panel
    path: 'projects/:id/references/:referenceId',
    loadComponent: () =>
      import('./reference-viewer.component').then(m => m.ReferenceViewerComponent),
    data: { nav: false },
  },
];
